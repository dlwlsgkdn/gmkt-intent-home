import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  dryRunStage,
  fetchAdminModel,
  fetchAdminPipeline,
  fetchAdminPrompts,
  flowRunPipeline,
  putAdminEngine,
  putAdminKnowledge,
  putAdminModel,
  putAdminPrompt,
} from '../lib/adminApi.js'
import FlowRunPreview from './FlowRunPreview.jsx'
import PipelineFlow, { KIND_LABEL, metaLine } from './PipelineFlow.jsx'

/*
 * 파이프라인 스튜디오 (운영 콘솔 "파이프라인" 탭 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4).
 * 3컬럼: 왼쪽 = 지식 소스 KV, 가운데 = 세로 흐름 다이어그램 카드(PipelineFlow — 히어로) +
 * 런타임 설정(엔진·모델), 오른쪽 = 플레이그라운드. 시스템 프롬프트 패널은 별도 카드가
 * 아니라 다이어그램에 녹아 있다: LLM 노드 클릭 = 단계 레이어 모달(설명·최근 실행·프롬프트
 * 열람·수정). 플레이그라운드는 두 모드다: "단계 단독"은 LLM 단계 하나를 그래프·쓰레드 기록
 * 없이 dry-run하고, "전체 플로우"는 실제 LangGraph 그래프(병렬·interrupt·검증 게이트)를
 * 전용 MemorySaver로 통째로 돌며 **admin 프로필(ops-playground)의 core 쓰레드로 기록**한다
 * — 쓰레드·평가 탭에서 열람·평가·케이스 승격이 가능한 평가 대상이 된다 (core 미연결이면
 * 기록 없는 임시 플로우로 강등). stage 이벤트(단계 수명·실제 프롬프트)·state 이벤트(그래프
 * 상태 채널 패치)는 **가운데 흐름 카드의 "이번 실행 관측"**(타임라인 + 그래프 상태 접기)에
 * 쌓이고, content 이벤트(부분 페이지)는 실렌더 미리보기(FlowRunPreview)가 프로덕션
 * (LivePlayer)과 같은 스트리밍으로 그리며 컴포넌트별 와이어 상세를 말풍선 레일로 보여준다
 * — 단계 단독 모드도 같은 미리보기 한 벌을 쓴다(계획은 뼈대+검색 병합의 FE 합성).
 * 실행 버튼은 진짜 생성이므로 ✦ (스튜디오 왕복 ⇄ 아님 — CLAUDE.md 표기 규칙).
 */

const INJECTION_LABEL = { system: '시스템(캐시)', user: '가변부', guard: '검증 게이트' }

/** 플레이그라운드 프로필 속성(고정 설문) 저장 키 — 계정 서버 동기화 기계 밖 로컬 실험 조건
 * (태깅 검토 스튜디오와 같은 문법). 실행 본문의 profile로 실려 원장 facts가 된다 */
const PROFILE_LS_KEY = 'ddak-ops-pg-profile'

/** 프로필 예시 — 빈 손으로 실험을 시작하는 운영자용 한 번 채우기 */
const PROFILE_PRESET = [
  { label: '피부 타입', value: '지성' },
  { label: '나이대', value: '30대' },
  { label: '예산 성향', value: '가성비 위주' },
]

/** 플로우 실행 로그 타임라인 표시 순서 — 'gate'는 다이어그램 밖 interrupt 표식 */
const FLOW_LOG_ORDER = ['objective', 'intent', 'ledger', 'survey', 'gate', 'plan-skeleton', 'plan-products', 'verify', 'record']

/** 그래프 상태(ThreadGraphState) 패널의 채널 카탈로그 — bff engine/state.ts 선언 순서.
 * sum = 한 줄 요약(없으면 기본 표시), 값 원문은 JSON 펼침으로 본다 */
const STATE_CHANNELS = [
  { key: 'threadId', label: '플로우 id' },
  { key: 'userId', label: '사용자' },
  { key: 'intent', label: '의도 (한 줄 발화)' },
  {
    key: 'intentProfile',
    label: '의도 해석 (1)',
    sum: (v) => (v ? [v.template, v.goal, v.timing, v.audience].filter(Boolean).join(' · ') : null),
  },
  { key: 'intentMeta', label: '의도 해석 메타', sum: (v) => metaLine(v) },
  { key: 'profile', label: '프로필', sum: (v) => (Array.isArray(v) ? `${v.length}항목` : null) },
  {
    key: 'ledger',
    label: '제약 원장 (2)',
    sum: (v) =>
      v ? `사실 ${v.facts?.length ?? 0} · 키워드 ${v.trendKeywords?.length ?? 0} · 기피 ${v.avoid?.length ?? 0}` : null,
  },
  { key: 'blocklist', label: '블록리스트 (guard)', sum: (v) => (Array.isArray(v) ? `${v.length}개` : null) },
  { key: 'survey', label: '설문 페이지 (3)', sum: (v) => (v ? `질문 ${v.questions?.length ?? 0}개` : null) },
  { key: 'surveyMeta', label: '설문 메타', sum: (v) => metaLine(v) },
  { key: 'answers', label: '답변 (interrupt 재개)', sum: (v) => (Array.isArray(v) ? `${v.length}개` : null) },
  { key: 'feedback', label: '재생성 피드백', sum: (v) => (v ? `${v.stage} 피드백` : null) },
  { key: 'prevPlan', label: '직전 계획', sum: (v) => (v ? `${v.headline ?? ''}` : null) },
  { key: 'skeleton', label: '계획 뼈대 (5a)', sum: (v) => (v ? `섹션 ${v.sections?.length ?? 0}` : null) },
  { key: 'skeletonMeta', label: '뼈대 메타', sum: (v) => metaLine(v) },
  {
    key: 'searchSections',
    label: '검색 섹션 원본 (5b)',
    sum: (v) => (Array.isArray(v) ? `${v.length}개 (그라운딩 전)` : null),
  },
  { key: 'productsMeta', label: '검색 메타', sum: (v) => metaLine(v) },
  { key: 'productsFailed', label: '검색 실패', sum: (v) => v || null },
  {
    key: 'page',
    label: '최종 페이지 (6)',
    sum: (v) => (v ? `${v.headline ?? ''} · 섹션 ${v.sections?.length ?? 0}` : null),
  },
  { key: 'dropLog', label: '드롭 로그 (6)', sum: (v) => (Array.isArray(v) ? `${v.length}건` : null) },
]

/** 상태 값 한 줄 표시 — 요약자 우선, 문자열은 그대로(말줄임은 CSS), 그 밖은 타입 표시 */
const stateSummary = (channel, value) => {
  if (value === undefined) return undefined
  if (value === null) return '—'
  const summed = channel.sum?.(value)
  if (summed != null && summed !== '') return summed
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return Array.isArray(value) ? `${value.length}개` : '객체'
}

/** 플로우 실행 중 노드 → 켜지는 연결선 (PipelineFlow의 link id — 노드의 유입선 기준) */
const FLOW_INCOMING = {
  objective: [],
  intent: ['l01'],
  ledger: ['l12'],
  survey: ['l23'],
  gate: ['gate'],
  'plan-skeleton': ['lt-in'],
  candidates: ['lb-in'],
  'plan-products': ['lb-in', 'l45'],
  verify: ['lt-out', 'lb-out', 'l56'],
  record: ['l67'],
}

export default function PipelineStudio({ api }) {
  const [wire, setWire] = useState(null) // AdminPipelineWire
  const [error, setError] = useState(null)
  const [engineSaving, setEngineSaving] = useState(false)
  const [selectedStage, setSelectedStage] = useState(null) // 단계 레이어 모달의 노드 id
  const [knowledgeEdit, setKnowledgeEdit] = useState(null) // AdminKnowledgeEntry
  const [knowledgeText, setKnowledgeText] = useState('')
  const [knowledgeSaving, setKnowledgeSaving] = useState(false)

  /* LLM 모델 — 다이어그램 카드의 런타임 설정 (구 "생성 모델" 카드가 여기로 녹았다) */
  const [model, setModel] = useState(null) // { current, defaultModel, configured, options }
  const [modelChoice, setModelChoice] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  /* 시스템 프롬프트 — 단계 레이어 모달에서 열람·수정 (구 "시스템 프롬프트" 카드가 여기로 녹았다) */
  const [prompts, setPrompts] = useState(null) // AdminPromptsWire { promptVersion, prompts }
  const [promptsError, setPromptsError] = useState(null)
  const [promptText, setPromptText] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  /* 플레이그라운드 — 설문 실행 → 답변 선택 → 뼈대/상품 실행 */
  const [pgTab, setPgTab] = useState('stage') // 'stage'(단계 단독 dry-run) | 'flow'(전체 플로우)
  const [pgIntent, setPgIntent] = useState('여름에 무너지지 않는 쿠션 찾아줘')
  const [pgOverride, setPgOverride] = useState('')
  /* 프로필 속성(고정 설문) — 실험 조건. 실행 본문 profile로 실려 원장 facts가 되고,
     실렌더 미리보기의 프로필 패널·설문 요약에도 그대로 그려진다. localStorage 지속 */
  const [pgProfile, setPgProfile] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_LS_KEY) || '[]')
      return Array.isArray(raw)
        ? raw
            .filter((row) => row && typeof row.label === 'string')
            .map((row) => ({ label: row.label, value: String(row.value ?? '') }))
        : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(pgProfile))
    } catch {
      /* 저장 실패는 무시 — 세션 상태만으로도 동작한다 */
    }
  }, [pgProfile])
  const profileWire = () =>
    pgProfile
      .map((row) => ({ label: row.label.trim(), value: String(row.value || '').trim() }))
      .filter((row) => row.label)
  const patchProfileRow = (index, patch) =>
    setPgProfile((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const [running, setRunning] = useState(null) // 실행 중 stageId
  const [pgStatus, setPgStatus] = useState(null)
  const [pgError, setPgError] = useState(null)
  const [svResult, setSvResult] = useState(null) // { survey, ledger, meta, promptCustom, prompt? }
  const [pgAnswers, setPgAnswers] = useState({}) // { [questionId]: string[] }
  const [skResult, setSkResult] = useState(null) // { skeleton, ledger, meta, prompt? }
  const [prodResult, setProdResult] = useState(null) // { sections, dropLog, ledger, meta, prompt? }

  /* 전체 플로우 실행 (flow-run) — 실제 그래프의 단계 수명·프롬프트가 실시간으로 쌓인다 */
  const [flowRunning, setFlowRunning] = useState(null) // 'survey' | 'plan' | null
  const [flowRunId, setFlowRunId] = useState(null) // 서버가 발급한 플로우 id (plan 재개 키)
  const [flowRunStages, setFlowRunStages] = useState({}) // { [stageId]: { status, meta, prompt, summary, pass, drops } }
  const [flowRunLive, setFlowRunLive] = useState([]) // 실행 중(start~done 사이) 단계 id 목록
  const [flowRunPlan, setFlowRunPlan] = useState(null) // FlowRunResult(phase=plan) — 최종 병합 페이지
  const [flowNote, setFlowNote] = useState(null) // content 스트림 조각 한 줄 표시
  const [flowStateHistory, setFlowStateHistory] = useState([]) // [{ node, id, changedKeys, snapshot }] — state 이벤트 누적
  const [flowStateIdx, setFlowStateIdx] = useState(null) // 고정 선택 인덱스 — null이면 최신 추종

  /* 실렌더 미리보기 (FlowRunPreview) — content 이벤트의 부분 페이지를 LivePlayer와 같은
     문법으로 누적한다: 설문 { intro?, questions[] } | 계획 { headline?, summary?, sections[] },
     계획은 skeleton 이벤트에서 조기 확정(자리 로딩 카드)하고 section 이벤트가 자리를 채운다 */
  const [flowPartial, setFlowPartial] = useState(null) // 생성 중 부분 페이지 (확정 전 미리보기)
  const [flowPlanPage, setFlowPlanPage] = useState(null) // 뼈대 조기 확정 페이지 — result가 최종으로 덮는다
  const [flowPendingSlots, setFlowPendingSlots] = useState([]) // 아직 검색 결과가 안 채운 자리 인덱스
  const [previewStage, setPreviewStage] = useState('survey') // 실렌더 미리보기 단계 seg — 'survey' | 'plan' (두 모드 공용)
  const [flowRecorded, setFlowRecorded] = useState(false) // 플로우가 admin 프로필의 core 쓰레드로 저장됐는지
  const flowSkeletonRef = useRef(false) // 이번 계획 실행에서 skeleton(조기 확정)을 받았는지

  const load = async () => {
    setError(null)
    try {
      setWire(await fetchAdminPipeline())
    } catch (e) {
      setError(e.message)
    }
  }
  const loadModel = async () => {
    try {
      const next = await fetchAdminModel()
      setModel(next)
      setModelChoice(next.configured ?? '')
    } catch (e) {
      api.showToast(`모델 설정을 불러오지 못했어요: ${e.message}`)
    }
  }
  const loadPrompts = async () => {
    setPromptsError(null)
    try {
      setPrompts(await fetchAdminPrompts())
    } catch (e) {
      setPromptsError(e.message)
    }
  }
  useEffect(() => {
    load()
    loadModel()
    loadPrompts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const promptEntryOf = (promptId) => prompts?.prompts?.find((p) => p.id === promptId) || null

  const saveEngine = async (engine) => {
    setEngineSaving(true)
    try {
      setWire(await putAdminEngine(engine))
    } catch (e) {
      setError(e.message)
    } finally {
      setEngineSaving(false)
    }
  }

  const applyModel = async () => {
    setModelSaving(true)
    try {
      const next = await putAdminModel(modelChoice || null)
      setModel(next)
      setModelChoice(next.configured ?? '')
      api.showToast(`생성 모델: ${next.current}${next.configured ? '' : ' (기본값)'} — 새 생성부터 반영돼요.`)
    } catch (e) {
      api.showToast(e.message || '모델을 변경하지 못했어요.')
    } finally {
      setModelSaving(false)
    }
  }

  const openKnowledge = (entry) => {
    setKnowledgeEdit(entry)
    setKnowledgeText(entry.value ?? '')
  }
  const saveKnowledge = async (value) => {
    setKnowledgeSaving(true)
    try {
      setWire(await putAdminKnowledge(knowledgeEdit.id, value))
      setKnowledgeEdit(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setKnowledgeSaving(false)
    }
  }

  /* 단계 레이어 모달 — 선택 노드·프롬프트. 열 때(와 저장 후 prompts 갱신 시) 편집 원문을 저장본으로 리셋 */
  const selected = selectedStage && wire ? wire.stages.find((s) => s.id === selectedStage) || null : null
  const stagePrompt = selected?.promptId ? promptEntryOf(selected.promptId) : null
  useEffect(() => {
    if (!selectedStage) return
    const stage = wire?.stages.find((s) => s.id === selectedStage)
    const entry = stage?.promptId ? prompts?.prompts?.find((p) => p.id === stage.promptId) : null
    setPromptText(entry ? entry.configured ?? entry.defaultText : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStage, prompts])

  const savePrompt = async (textOrNull) => {
    if (!stagePrompt) return
    setPromptSaving(true)
    try {
      const nextPrompts = await putAdminPrompt(stagePrompt.id, textOrNull)
      setPrompts(nextPrompts)
      const updated = nextPrompts.prompts.find((p) => p.id === stagePrompt.id)
      // 노드의 재정의 점 표식(promptCustom)도 파이프라인 와이어 재조회 없이 맞춘다
      setWire((prev) =>
        prev
          ? {
              ...prev,
              stages: prev.stages.map((s) =>
                s.promptId === stagePrompt.id ? { ...s, promptCustom: Boolean(updated?.configured) } : s,
              ),
            }
          : prev,
      )
      api.showToast(
        updated?.configured
          ? `「${stagePrompt.label}」 프롬프트를 재정의했어요 — 새 생성부터 반영돼요.`
          : `「${stagePrompt.label}」 프롬프트를 기본값으로 되돌렸어요.`,
      )
    } catch (e) {
      api.showToast(e.message || '프롬프트를 저장하지 못했어요.')
    } finally {
      setPromptSaving(false)
    }
  }

  const answersList = useMemo(
    () =>
      Object.entries(pgAnswers)
        .filter(([, choices]) => choices.length > 0)
        .map(([questionId, choices]) => ({ questionId, choices })),
    [pgAnswers],
  )

  const runStage = async (stageId) => {
    if (running || flowRunning) return
    setRunning(stageId)
    setPgStatus(null)
    setPgError(null)
    try {
      const body = {
        stageId,
        intent: pgIntent.trim(),
        profile: profileWire(),
        ...(pgOverride.trim() ? { promptOverride: pgOverride } : {}),
        ...(stageId === 'survey' ? {} : { survey: svResult?.survey, answers: answersList }),
      }
      const result = await dryRunStage(body, { onStatus: setPgStatus })
      if (stageId === 'survey') {
        setSvResult(result)
        setPgAnswers({})
        setSkResult(null)
        setProdResult(null)
        setFlowRunPlan(null)
        setFlowPlanPage(null)
        setFlowPendingSlots([])
        setFlowPartial(null)
        setPreviewStage('survey')
        flowSkeletonRef.current = false
      } else if (stageId === 'plan-skeleton') {
        setSkResult(result)
        setPreviewStage('plan')
      } else {
        setProdResult(result)
        setPreviewStage('plan')
      }
    } catch (e) {
      setPgError(e.message)
    } finally {
      setRunning(null)
      setPgStatus(null)
    }
  }

  /* flow-run 이벤트 — stage(단계 수명·프롬프트)는 타임라인·다이어그램에, content(조각)는 한 줄 근황에 */
  const handleFlowEvent = (name, data) => {
    if (name === 'stage') {
      setFlowRunStages((prev) => {
        const cur = prev[data.id] || {}
        return {
          ...prev,
          [data.id]: {
            ...cur,
            status: data.phase === 'done' ? 'done' : cur.status === 'done' ? 'done' : 'start',
            ...(data.meta ? { meta: data.meta } : {}),
            ...(data.prompt ? { prompt: data.prompt } : {}),
            ...(data.summary ? { summary: data.summary } : {}),
            ...(data.pass != null ? { pass: data.pass, drops: data.drops } : {}),
          },
        }
      })
      if (data.phase === 'start') setFlowRunLive((prev) => (prev.includes(data.id) ? prev : [...prev, data.id]))
      else setFlowRunLive((prev) => prev.filter((id) => id !== data.id))
    } else if (name === 'state') {
      // LastValue 채널 — 패치를 누적하면 그 시점의 ThreadGraphState 스냅샷이 된다
      setFlowStateHistory((prev) => {
        const base = prev.length ? prev[prev.length - 1].snapshot : {}
        return [
          ...prev,
          {
            node: data.node,
            id: data.id,
            changedKeys: Object.keys(data.patch || {}),
            snapshot: { ...base, ...(data.patch || {}) },
          },
        ]
      })
    } else if (name === 'content') {
      // 부분 페이지 누적 — 실렌더 미리보기(FlowRunPreview)가 프로덕션(LivePlayer)과 같은
      // 스트리밍으로 그린다. 같은 index 반복 도착 = 자라는 컴포넌트 (도착 즉시 렌더)
      const c = data
      if (c.event === 'head') {
        setFlowNote('인트로 생성 중…')
        if (!flowSkeletonRef.current) setFlowPartial((prev) => ({ ...(prev || {}), ...c.data }))
      } else if (c.event === 'question') {
        setFlowNote(`질문 ${c.data.index + 1} 생성 중 — ${c.data.question?.question ?? ''}`)
        setFlowPartial((prev) => {
          const next = { ...(prev || {}), questions: [...((prev && prev.questions) || [])] }
          next.questions[c.data.index] = c.data.question
          return next
        })
      } else if (c.event === 'skeleton') {
        // 뼈대 조기 확정 — 페이지를 확정 렌더로 전환하고 상품·콘텐츠 자리는 로딩 카드로 남긴다
        setFlowNote(`뼈대 조기 확정 — 상품·콘텐츠 자리 ${c.data.pending?.length ?? 0}개`)
        flowSkeletonRef.current = true
        setFlowPlanPage(c.data.page)
        setFlowPendingSlots(c.data.pending || [])
        setFlowPartial(null)
      } else if (c.event === 'section') {
        setFlowNote(`섹션 ${c.data.index + 1} ${c.data.final ? '도착' : '생성 중'} — ${c.data.section?.title ?? ''}`)
        if (flowSkeletonRef.current) {
          // 조기 확정 뒤 도착한 상품·콘텐츠 — 확정 페이지의 자리를 직접 채운다 (증분은 같은 index 덮어쓰기)
          setFlowPlanPage((prev) => {
            if (!prev) return prev
            const sections = [...(prev.sections || [])]
            sections[c.data.index] = c.data.section
            return { ...prev, sections }
          })
          if (c.data.final) setFlowPendingSlots((prev) => prev.filter((i) => i !== c.data.index))
        } else {
          setFlowPartial((prev) => {
            const next = { ...(prev || {}), sections: [...((prev && prev.sections) || [])] }
            next.sections[c.data.index] = c.data.section
            return next
          })
        }
      } else if (c.event === 'search') {
        setFlowNote(`웹에서 "${c.data.query}" 검색 중…`)
      }
    }
  }

  /** 플로우 1구간 — START→설문, 답변 대기 interrupt에서 멈춘다 */
  const runFlowSurvey = async () => {
    if (running || flowRunning || !pgIntent.trim()) return
    setFlowRunning('survey')
    setPgStatus(null)
    setPgError(null)
    setFlowNote(null)
    setFlowRunStages({})
    setFlowRunLive([])
    setFlowRunId(null)
    setFlowRunPlan(null)
    setFlowStateHistory([])
    setFlowStateIdx(null)
    setSvResult(null)
    setPgAnswers({})
    setSkResult(null)
    setProdResult(null)
    setFlowPartial(null)
    setFlowPlanPage(null)
    setFlowPendingSlots([])
    setPreviewStage('survey')
    setFlowRecorded(false)
    flowSkeletonRef.current = false
    try {
      const result = await flowRunPipeline(
        { phase: 'survey', intent: pgIntent.trim(), profile: profileWire() },
        { onStatus: setPgStatus, onEvent: handleFlowEvent },
      )
      setFlowRunId(result.flowId)
      setFlowRecorded(!!result.recorded)
      setSvResult({ survey: result.survey, ledger: result.ledger, meta: result.meta })
      setFlowPartial(null)
    } catch (e) {
      setPgError(e.message)
      setFlowRunLive([])
    } finally {
      setFlowRunning(null)
      setPgStatus(null)
      setFlowNote(null)
      // 답변 대기 interrupt(gate)만 남긴다 — 답을 고르는 동안 다이어그램이 대기 지점을 맥동한다
      setFlowRunLive((prev) => prev.filter((id) => id === 'gate'))
    }
  }

  /** 플로우 2구간 — interrupt 재개(유실 시 서버가 body 시딩 재실행), 병렬 5a∥5b→검증→기록까지 */
  const runFlowPlan = async () => {
    if (running || flowRunning || !flowRunId || !planReady) return
    setFlowRunning('plan')
    setPgStatus(null)
    setPgError(null)
    setFlowNote(null)
    setFlowRunPlan(null)
    setFlowPartial(null)
    setFlowPlanPage(null)
    setFlowPendingSlots([])
    setPreviewStage('plan')
    flowSkeletonRef.current = false
    try {
      const result = await flowRunPipeline(
        {
          phase: 'plan',
          flowId: flowRunId,
          intent: pgIntent.trim(),
          profile: profileWire(),
          survey: svResult?.survey,
          answers: answersList,
        },
        { onStatus: setPgStatus, onEvent: handleFlowEvent },
      )
      setFlowRunPlan(result)
      // 최종본(권위)으로 갈아끼운다 — 검색이 못 채운 자리는 최종본에서 빠진다 (서버 규칙)
      setFlowPlanPage(result.page)
      setFlowPendingSlots([])
      setFlowPartial(null)
    } catch (e) {
      setPgError(e.message)
      setFlowPendingSlots([])
      setFlowPartial(null)
    } finally {
      setFlowRunning(null)
      setPgStatus(null)
      setFlowNote(null)
      setFlowRunLive([])
    }
  }

  const planReady = Boolean(svResult?.survey) && answersList.length > 0
  const flowBusy = running !== null || flowRunning !== null

  /* ── 실렌더 미리보기(FlowRunPreview) 재료 — 두 모드 공용: 스트리밍 중엔 부분 페이지,
     끝나면 확정본. 단계 단독 모드의 계획은 뼈대+검색 결과를 스튜디오가 자리 규칙대로
     합성한 병합 미리보기다 (검증 게이트 병합의 FE 근사 — 남는 검색 섹션은 끝에 붙는다) ── */
  const surveyPreviewPage =
    flowRunning === 'survey'
      ? flowPartial
        ? { intro: flowPartial.intro || '', questions: (flowPartial.questions || []).filter(Boolean) }
        : null
      : svResult?.survey || null
  const flowPlanPreview = flowPlanPage
    ? { page: flowPlanPage, pending: flowPendingSlots }
    : flowRunning === 'plan' && flowPartial
      ? {
          page: { headline: flowPartial.headline || '', summary: flowPartial.summary || '', sections: flowPartial.sections || [] },
          pending: [],
        }
      : null
  const stagePlanView = useMemo(() => {
    if (!skResult?.skeleton && !prodResult) return null
    const search = [...(prodResult?.sections || [])]
    const takeKind = (kind) => {
      const i = search.findIndex((s) => s.kind === kind)
      return i >= 0 ? search.splice(i, 1)[0] : null
    }
    if (!skResult?.skeleton) return { page: { headline: '', summary: '', sections: search }, pending: [] }
    const sk = skResult.skeleton
    const pending = []
    const sections = sk.sections.map((section, i) => {
      if (section.kind !== 'products' && section.kind !== 'contents') return section
      const filled = takeKind(section.kind)
      if (filled) return filled
      pending.push(i) // 아직 안 채운 자리 — "상품·콘텐츠 실행"이 채운다
      return null
    })
    sections.push(...search)
    return { page: { headline: sk.headline, summary: sk.summary, sections }, pending }
  }, [skResult, prodResult])
  const planPreview = pgTab === 'flow' ? flowPlanPreview : stagePlanView
  const shownStage = previewStage === 'plan' && (planPreview || flowRunning === 'plan') ? 'plan' : 'survey'

  /* ── 말풍선 근거 재료 — "왜 선택·구성됐나"를 답하는 비(非)렌더 데이터 ──
     뼈대(5a)의 자리 선정 기준: 최종 페이지에선 검색(5b) reason이 자리를 차지해 사라지는
     원문 — 그래프 상태(skeleton 채널)·뼈대 dry-run 결과에서 건져 자리 인덱스로 매단다 */
  const planSkeleton = useMemo(() => {
    if (pgTab === 'stage') return skResult?.skeleton || null
    for (let i = flowStateHistory.length - 1; i >= 0; i--) {
      if (flowStateHistory[i].snapshot.skeleton) return flowStateHistory[i].snapshot.skeleton
    }
    return null
  }, [pgTab, skResult, flowStateHistory])
  const slotReasons = useMemo(() => {
    const map = {}
    ;(planSkeleton?.sections || []).forEach((section, i) => {
      if ((section.kind === 'products' || section.kind === 'contents') && section.reason) map[i] = section.reason
    })
    return map
  }, [planSkeleton])
  /* 의도 해석(1단계) — 발화를 어떻게 읽었는지. 전체 플로우의 그래프 상태에만 실린다 */
  const flowIntentLine = useMemo(() => {
    if (pgTab !== 'flow') return null
    for (let i = flowStateHistory.length - 1; i >= 0; i--) {
      const ip = flowStateHistory[i].snapshot.intentProfile
      if (ip) return [ip.template, ip.goal, ip.timing, ip.audience].filter(Boolean).join(' · ')
    }
    return null
  }, [pgTab, flowStateHistory])
  /* 원장 스냅샷 — 이 페이지 생성이 따른 제약 (페이지 전체 말풍선의 근거 접기) */
  const previewLedger =
    shownStage === 'plan'
      ? (pgTab === 'flow' ? flowRunPlan?.ledger : prodResult?.ledger || skResult?.ledger) || svResult?.ledger || null
      : svResult?.ledger || null

  /* 설문 답변 쓰기 — 페이지의 질문 카드(레지스트리 setAnswer: multi 배열·단일 문자열)와
     말풍선 칩이 같은 pgAnswers(배열 맵)에 쓴다 */
  const setFlowAnswer = (questionId, value) => {
    setPgAnswers((prev) => ({
      ...prev,
      [questionId]: Array.isArray(value) ? value.filter(Boolean) : value != null && String(value).length > 0 ? [value] : [],
    }))
  }

  /* 계획 페이지 surveySummary 패널 재료 — 클라이언트 소유분 (LivePlayer summary와 같은 형태).
     프로필도 실험 조건 그대로 — 프로덕션에서 프로필 패널·요약에 실리는 것과 같은 문법 */
  const previewProfileItems = useMemo(
    () =>
      pgProfile
        .map((row) => ({ label: row.label.trim(), value: String(row.value || '').trim() }))
        .filter((row) => row.label),
    [pgProfile],
  )
  const flowSummary = useMemo(
    () => ({
      profile: previewProfileItems,
      questions: (svResult?.survey?.questions || []).map((q) => {
        const arr = pgAnswers[q.id] || []
        return { q: q.question, a: arr.length ? arr.join(', ') : '아무거나' }
      }),
    }),
    [svResult, pgAnswers, previewProfileItems],
  )

  /* 페이지 전체 말풍선 — 단계 산출 메타·원장·검증 게이트 요약 + 실행 액션(모드별).
     플로우 모드는 저장된 쓰레드(admin 프로필) 안내를 함께 싣는다 — 평가의 진입점 */
  const flowVerify = flowRunStages.verify
  const flowSavedLine =
    pgTab === 'flow' && flowRunId
      ? flowRecorded
        ? `쓰레드 ${flowRunId} 저장 — admin 프로필(ops-playground) · 쓰레드·평가 탭에서 평가·케이스 승격`
        : '기록 없음 — core 미연결 임시 플로우'
      : null
  const stageRunButtons = (
    <>
      <button
        type="button"
        className="sb-btn sb-btn--ai sb-btn--tiny"
        disabled={!planReady || flowBusy}
        title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
        onClick={() => runStage('plan-skeleton')}
      >
        {running === 'plan-skeleton' ? '실행 중…' : '✦ 계획 뼈대 실행 (5a)'}
      </button>
      <button
        type="button"
        className="sb-btn sb-btn--ai sb-btn--tiny"
        disabled={!planReady || flowBusy}
        title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
        onClick={() => runStage('plan-products')}
      >
        {running === 'plan-products' ? '실행 중…' : '✦ 상품·콘텐츠 실행 (4+5b→6)'}
      </button>
    </>
  )
  const previewOverall =
    shownStage === 'survey'
      ? {
          label: '설문 페이지',
          chip:
            flowRunning === 'survey'
              ? '생성 중'
              : pgTab === 'stage' && svResult?.promptCustom
                ? '임시/재정의 프롬프트'
                : 'LLM 산출 (3)',
          lines: [
            svResult?.meta ? metaLine(svResult.meta) : null,
            svResult?.survey ? `질문 ${svResult.survey.questions.length}개 · 답변 ${answersList.length}개 선택` : null,
            flowIntentLine ? `의도 해석 (1) — ${flowIntentLine}` : null,
            flowSavedLine,
          ].filter(Boolean),
          ledger: previewLedger,
          foot: !svResult?.survey ? null : pgTab === 'stage' ? (
            stageRunButtons
          ) : (
            <button
              type="button"
              className="sb-btn sb-btn--ai sb-btn--tiny"
              disabled={!planReady || flowBusy || !flowRunId}
              title={
                !flowRunId
                  ? '플로우 시작(설문 구간)부터 실행하세요'
                  : planReady
                    ? undefined
                    : '답변을 하나 이상 선택하세요'
              }
              onClick={runFlowPlan}
            >
              {flowRunning === 'plan' ? '실행 중…' : '✦ 계획 이어서 실행 (5a∥4·5b→6·7)'}
            </button>
          ),
        }
      : pgTab === 'stage'
        ? {
            label: '계획 페이지',
            chip: '뼈대+검색 병합 (스튜디오 합성)',
            lines: [
              [metaLine(skResult?.meta), metaLine(prodResult?.meta)].filter(Boolean).join(' ∥ ') || null,
              prodResult
                ? `검증 게이트 — 섹션 ${(prodResult.sections || []).length}개 통과 · ${(prodResult.dropLog || []).length}건 드롭`
                : '상품·콘텐츠 미실행 — 자리가 비어 있어요',
            ].filter(Boolean),
            ledger: previewLedger,
            dropLog: prodResult?.dropLog || [],
            foot: stageRunButtons,
          }
        : {
            label: '계획 페이지',
            chip: flowRunning === 'plan' ? '생성 중' : '검증 게이트 병합본',
            lines: [
              flowRunPlan
                ? [metaLine(flowRunPlan.skeletonMeta), metaLine(flowRunPlan.productsMeta)].filter(Boolean).join(' ∥ ') || null
                : null,
              flowVerify?.pass != null ? `검증 게이트 — 섹션 ${flowVerify.pass}개 통과 · ${flowVerify.drops}건 드롭` : null,
              flowIntentLine ? `의도 해석 (1) — ${flowIntentLine}` : null,
              flowSavedLine,
            ].filter(Boolean),
            ledger: previewLedger,
            error: flowRunPlan?.productsFailed
              ? `검색 단계 실패 — 상품 없이 병합됐어요: ${flowRunPlan.productsFailed}`
              : null,
            dropLog: flowRunPlan?.dropLog || [],
          }

  /* 흐름 다이어그램에 얹는 실행 결과 요약 — 노드의 ✓ 배지·레이어 모달 "이번 실행"의 원천.
   * 단계 단독 dry-run 결과와 전체 플로우 stage 이벤트를 한 맵으로 겹친다 (나중 실행이 이긴다) */
  const flowResults = useMemo(() => {
    const map = {}
    if (svResult) map.survey = { meta: svResult.meta, custom: svResult.promptCustom, prompt: svResult.prompt }
    if (skResult) map['plan-skeleton'] = { meta: skResult.meta, custom: skResult.promptCustom, prompt: skResult.prompt }
    if (prodResult) {
      map['plan-products'] = { meta: prodResult.meta, custom: prodResult.promptCustom, prompt: prodResult.prompt }
      map.verify = { pass: (prodResult.sections || []).length, drops: (prodResult.dropLog || []).length }
    }
    for (const [id, s] of Object.entries(flowRunStages)) {
      if (id === 'gate') continue
      map[id] = {
        ...map[id],
        ...(s.meta ? { meta: s.meta } : {}),
        ...(s.prompt ? { prompt: s.prompt, custom: s.prompt.custom } : {}),
        ...(s.summary ? { summary: s.summary } : {}),
        ...(s.pass != null ? { pass: s.pass, drops: s.drops } : {}),
      }
    }
    return map
  }, [svResult, skResult, prodResult, flowRunStages])

  /* 플로우 실행 중 다이어그램 라이브 표시 — 켜진 노드와 그 유입 연결선 */
  const flowLiveInfo = useMemo(() => {
    if (!flowRunLive.length) return null
    const nodes = new Set(flowRunLive)
    if (nodes.has('plan-products')) nodes.add('candidates') // 4단계는 5b가 병행 수행 — 함께 흐른다
    const links = new Set()
    for (const id of nodes) for (const l of FLOW_INCOMING[id] || []) links.add(l)
    // plan 구간의 원장 갱신은 답변 대기에서 흘러 들어온다 — 설문 경로 연결선 대신 gate를 켠다
    if (flowRunning === 'plan' && nodes.has('ledger')) {
      links.delete('l12')
      links.add('gate')
    }
    return { nodes: [...nodes], links: [...links] }
  }, [flowRunLive, flowRunning])

  const selectedResult = selected ? flowResults[selected.id] : null
  const modelDirty = model && (model.configured ?? '') !== modelChoice

  return (
    <>
      {error && <p className="sb-admin-gate__error">{error}</p>}

      {/* 지식 소스(왼쪽) ∥ 세로 흐름 카드(가운데 히어로) ∥ 플레이그라운드(오른쪽) —
          실행이 가운데 흐름에 비친다. 배치는 grid-template-areas (admin.css .sb-pipe-layout) */}
      <div className="sb-pipe-layout">
        {/* 지식 소스 — KV 편집 (왼쪽 컬럼) */}
        <div className="sb-admin-card sb-pipe-knowledge-card">
          <p className="sb-panel-label">지식 소스 (팀 데이터 v0 — 설정 KV)</p>
          <p className="sb-admin__muted">
            DB화 전의 수동 입력 자리예요. 시스템 자리표시자 지식은 프롬프트 캐시에 흡수되고, 가변부·게이트 값은 요청마다
            실려요. 편집은 새 생성부터 반영돼요 (서버 캐시 최대 30초).
          </p>
          {wire && (
            <ul className="sb-pipe-knowledge">
              {wire.knowledge.map((entry) => (
                <li key={entry.id} className="sb-pipe-knowledge__row">
                  <div className="sb-pipe-knowledge__main">
                    <div className="sb-pipe-stage__title">
                      <b>{entry.label}</b>
                      <span className="sb-admin-prompt-chip">{INJECTION_LABEL[entry.injection] || entry.injection}</span>
                      {entry.placeholder && <code>{entry.placeholder}</code>}
                      {!entry.editable && <span className="sb-admin-prompt-chip">실데이터 파생</span>}
                      {entry.editable && entry.value && (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">값 있음</span>
                      )}
                    </div>
                    <p className="sb-pipe-stage__note">
                      {entry.editable ? (entry.value ? entry.value.split('\n')[0] : '비어 있음 — 지식 없이 생성돼요') : entry.note}
                    </p>
                  </div>
                  {entry.editable && (
                    <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => openKnowledge(entry)}>
                      편집
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sb-admin-card sb-flow-card">
          <p className="sb-panel-label">생성 파이프라인 (전략 문서 0~7)</p>

          {/* 런타임 설정 — 엔진 플래그·생성 모델 (파이프라인 전체에 걸리는 값이라 다이어그램 머리에) */}
          <div className="sb-flow-config">
            <div className="sb-flow-config__row">
              <span className="sb-flow-config__label">엔진</span>
              {!wire ? (
                <span className="sb-admin__muted">불러오는 중…</span>
              ) : (
                <>
                  <div className="sb-admin-fb-seg" role="group" aria-label="생성 엔진">
                    {['legacy', 'langgraph'].map((engine) => (
                      <button
                        key={engine}
                        type="button"
                        className={'sb-admin-fb-seg__btn' + (wire.engine.current === engine ? ' is-on' : '')}
                        disabled={engineSaving}
                        onClick={() => saveEngine(engine)}
                      >
                        {engine}
                      </button>
                    ))}
                  </div>
                  {wire.engine.configured ? (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--tiny"
                      disabled={engineSaving}
                      onClick={() => saveEngine(null)}
                    >
                      기본값(legacy) 복귀
                    </button>
                  ) : (
                    <span className="sb-admin__muted" title="요청 단위 오버라이드: x-ddak-engine 헤더">기본값 사용 중</span>
                  )}
                </>
              )}
            </div>
            <div className="sb-flow-config__row">
              <span className="sb-flow-config__label">모델</span>
              {!model ? (
                <span className="sb-admin__muted">불러오는 중…</span>
              ) : (
                <>
                  <select value={modelChoice} aria-label="생성 모델" onChange={(event) => setModelChoice(event.target.value)}>
                    <option value="">기본값 — {model.defaultModel}</option>
                    {model.options.map((option) => (
                      <option key={option.id} value={option.id} title={option.note || undefined}>
                        {option.label} ({option.id})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary sb-btn--tiny"
                    disabled={!modelDirty || modelSaving}
                    onClick={applyModel}
                  >
                    {modelSaving ? '적용 중…' : '적용'}
                  </button>
                </>
              )}
            </div>
            {model && (
              <details className="sb-flow-config__more">
                <summary>모델 설명 · 반영 시점</summary>
                <ul className="sb-admin-model__notes">
                  {model.options.map((option) => (
                    <li key={option.id}>
                      <b>{option.label}</b>{option.note ? ` — ${option.note}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="sb-admin__muted">
                  변경은 core 설정(llm-model·llm-prompt-*)에 저장되고 새 생성부터 반영돼요 (서버 캐시 최대 30초).
                  {prompts ? ` 시스템 프롬프트 기본 ${prompts.promptVersion} — LLM 단계 노드를 눌러 열람·수정해요.` : ''}
                </p>
              </details>
            )}
          </div>

          {!wire ? (
            <p className="sb-admin__muted">파이프라인 현황을 불러오는 중…</p>
          ) : (
            <>
              <PipelineFlow
                stages={wire.stages}
                running={running}
                flowLive={flowLiveInfo}
                results={flowResults}
                selectedId={selectedStage}
                onSelect={setSelectedStage}
              />
              {(running || flowRunning) && (
                <p className="sb-flow-status">
                  <i className="sb-flow-status__dot" aria-hidden="true" />
                  {pgStatus || flowNote || (flowRunning ? '플로우를 실행하고 있어요…' : '단계를 실행하고 있어요…')}
                </p>
              )}

              {/* 이번 실행 관측 — 플로우 단계 수명 타임라인 + 그래프 상태. 다이어그램 바로 아래에
                  녹여 실행이 흐름 위에서 그대로 읽히게 한다 (행 클릭 = 단계 레이어 모달) */}
              {FLOW_LOG_ORDER.some((id) => flowRunStages[id]) && (
                <div className="sb-flow-observe">
                  <p className="sb-panel-label">이번 플로우 실행</p>
                  <ol className="sb-pipe-flowlog">
                    {FLOW_LOG_ORDER.filter((id) => flowRunStages[id]).map((id) => {
                      const s = flowRunStages[id]
                      const stageDef = wire?.stages.find((st) => st.id === id)
                      const label = id === 'gate' ? '답변 대기 (interrupt)' : stageDef?.label || id
                      return (
                        <li key={id} className={'sb-pipe-flowlog__row' + (s.status === 'start' ? ' is-live' : ' is-done')}>
                          <button type="button" disabled={!stageDef} onClick={() => stageDef && setSelectedStage(id)}>
                            <i className="sb-pipe-flowlog__dot" aria-hidden="true" />
                            <b>{label}</b>
                            <span className="sb-pipe-flowlog__sub">
                              {s.status === 'start' ? '실행 중…' : s.summary || '완료'}
                              {s.meta ? ` · ${metaLine(s.meta)}` : ''}
                            </span>
                            {s.prompt && <span className="sb-admin-prompt-chip">프롬프트</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ol>

                  {/* 그래프 상태 (ThreadGraphState) — 채널 스냅샷. 간결하게 접힌 채로 둔다 */}
                  {flowStateHistory.length > 0 && (() => {
                    const idx = flowStateIdx == null ? flowStateHistory.length - 1 : Math.min(flowStateIdx, flowStateHistory.length - 1)
                    const entry = flowStateHistory[idx]
                    const stepLabel = (h) =>
                      h.id === 'gate' ? '답변 대기 (interrupt)' : wire?.stages.find((st) => st.id === h.id)?.label || h.node
                    return (
                      <details className="sb-pipe-state">
                        <summary>
                          그래프 상태 (ThreadGraphState){' '}
                          <span className="sb-admin__muted">{idx + 1}/{flowStateHistory.length} 시점 · 채널 스냅샷</span>
                        </summary>
                        <div className="sb-pipe-state__steps" role="group" aria-label="상태 시점 선택">
                          {flowStateHistory.map((h, i) => (
                            <button
                              key={i}
                              type="button"
                              className={'sb-pipe-state__step' + (i === idx ? ' is-on' : '')}
                              title={h.node}
                              onClick={() => setFlowStateIdx(i === flowStateHistory.length - 1 ? null : i)}
                            >
                              {stepLabel(h)}
                            </button>
                          ))}
                        </div>
                        <p className="sb-admin__muted">
                          {entry.node} 시점 — 이번에 덮인 채널: {entry.changedKeys.join(', ') || '없음'}
                          {flowStateIdx != null && ' · 최신 시점을 누르면 실행을 다시 따라가요'}
                        </p>
                        <ul className="sb-pipe-state__list">
                          {STATE_CHANNELS.filter((channel) => entry.snapshot[channel.key] !== undefined).map((channel) => {
                            const value = entry.snapshot[channel.key]
                            const changed = entry.changedKeys.includes(channel.key)
                            const expandable = value != null && typeof value === 'object'
                            return (
                              <li key={channel.key} className={'sb-pipe-state__row' + (changed ? ' is-changed' : '')}>
                                <span className="sb-pipe-state__key">
                                  {channel.label}
                                  {changed && <i className="sb-pipe-state__mark" title="이 단계에서 덮임" />}
                                </span>
                                {expandable ? (
                                  <details className="sb-pipe-state__val">
                                    <summary>{stateSummary(channel, value)}</summary>
                                    <pre>{JSON.stringify(value, null, 2)}</pre>
                                  </details>
                                ) : (
                                  <span className="sb-pipe-state__plain">{stateSummary(channel, value)}</span>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </details>
                    )
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        <div className="sb-pipe-side">
          {/* 플레이그라운드 — 단계 단독 dry-run ∥ 전체 플로우 (실행이 왼쪽 다이어그램에 그대로 비친다) */}
          <div className="sb-admin-card">
            <div className="sb-pipe-play__head">
              <p className="sb-panel-label">플레이그라운드</p>
              <div className="sb-admin-fb-seg" role="group" aria-label="플레이그라운드 모드">
                <button
                  type="button"
                  className={'sb-admin-fb-seg__btn' + (pgTab === 'stage' ? ' is-on' : '')}
                  onClick={() => setPgTab('stage')}
                >
                  단계 단독
                </button>
                <button
                  type="button"
                  className={'sb-admin-fb-seg__btn' + (pgTab === 'flow' ? ' is-on' : '')}
                  onClick={() => setPgTab('flow')}
                >
                  전체 플로우
                </button>
              </div>
            </div>
            <p className="sb-admin__muted">
              {pgTab === 'stage'
                ? 'LLM 단계 하나를 그래프·쓰레드 기록 없이 단독 실행해요 — 임시 프롬프트 what-if는 이 모드 전용이에요.'
                : '실제 그래프(병렬 5a∥5b · 답변 대기 · 검증 게이트)를 통째로 돌고, 실행은 admin 프로필(ops-playground)의 쓰레드로 저장돼 쓰레드·평가 탭에서 평가·케이스 승격에 쓸 수 있어요. 단계별 관측은 가운데 흐름 카드에 실시간으로 쌓여요.'}
            </p>
            <div className="sb-pipe-play__intent">
              <input
                type="text"
                value={pgIntent}
                placeholder="한 줄 의도 — 예: 여름에 무너지지 않는 쿠션 찾아줘"
                onChange={(event) => setPgIntent(event.target.value)}
              />
              {pgTab === 'stage' ? (
                <button
                  type="button"
                  className="sb-btn sb-btn--ai sb-btn--small"
                  disabled={!pgIntent.trim() || running !== null || flowRunning !== null}
                  onClick={() => runStage('survey')}
                >
                  {running === 'survey' ? '실행 중…' : '✦ 설문 실행 (3단계)'}
                </button>
              ) : (
                <button
                  type="button"
                  className="sb-btn sb-btn--ai sb-btn--small"
                  disabled={!pgIntent.trim() || running !== null || flowRunning !== null}
                  onClick={runFlowSurvey}
                >
                  {flowRunning === 'survey' ? '실행 중…' : '✦ 플로우 시작 (0→3 · 답변 대기까지)'}
                </button>
              )}
            </div>
            {/* 프로필 속성(고정 설문) — 실험 조건 편집. 실행 본문 profile로 실려 원장 facts가
                되고 설문은 이 정보를 다시 묻지 않는다. 프로필 패널·설문 요약에도 그대로 렌더 */}
            <details className="sb-pipe-profile">
              <summary>
                프로필 속성 (고정 설문 — 실험 조건)
                <span className="sb-admin__muted">
                  {' '}· {previewProfileItems.length ? `${previewProfileItems.length}항목` : '비어 있음'}
                </span>
              </summary>
              <p className="sb-admin__muted">
                사용자가 이미 알려준 속성으로 실행 시점에 실려요 — 원장 facts가 되고, 설문은 여기 있는 정보를
                다시 묻지 않아요. 실렌더 미리보기의 프로필 패널·설문 요약에도 그대로 그려져요.
              </p>
              {pgProfile.map((row, index) => (
                <div key={index} className="sb-pipe-profile__row">
                  <input
                    type="text"
                    value={row.label}
                    placeholder="속성 — 예: 피부 타입"
                    aria-label={`프로필 속성 ${index + 1} 이름`}
                    onChange={(event) => patchProfileRow(index, { label: event.target.value })}
                  />
                  <input
                    type="text"
                    value={row.value}
                    placeholder="값 — 예: 지성"
                    aria-label={`프로필 속성 ${index + 1} 값`}
                    onChange={(event) => patchProfileRow(index, { value: event.target.value })}
                  />
                  <button
                    type="button"
                    className="sb-icon-btn"
                    aria-label="속성 삭제"
                    onClick={() => setPgProfile((prev) => prev.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="sb-pipe-profile__actions">
                <button
                  type="button"
                  className="sb-btn sb-btn--ghost sb-btn--tiny"
                  onClick={() => setPgProfile((prev) => [...prev, { label: '', value: '' }])}
                >
                  + 속성 추가
                </button>
                {pgProfile.length === 0 && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                    onClick={() => setPgProfile(PROFILE_PRESET.map((row) => ({ ...row })))}
                  >
                    예시로 채우기
                  </button>
                )}
                {pgProfile.length > 0 && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                    onClick={() => setPgProfile([])}
                  >
                    비우기
                  </button>
                )}
              </div>
            </details>

            {pgTab === 'stage' && (
              <details className="sb-pipe-play__override">
                <summary>임시 시스템 프롬프트 (what-if — 다음 실행 1회에 적용, 저장 안 됨)</summary>
                <textarea
                  value={pgOverride}
                  spellCheck={false}
                  placeholder="비워 두면 저장된 프롬프트(재정의 포함)로 실행돼요. {{CATALOG}} 등 자리표시자 치환은 동일하게 적용돼요."
                  onChange={(event) => setPgOverride(event.target.value)}
                />
              </details>
            )}
            {pgStatus && <p className="sb-admin__muted">{pgStatus}</p>}
            {pgTab === 'flow' && flowNote && <p className="sb-admin__muted">{flowNote}</p>}
            {pgError && <p className="sb-admin-gate__error">{pgError}</p>}

            {/* 실렌더 미리보기 — 두 모드 공용: 생성 결과(설문/계획)를 프로덕션(LivePlayer)
                스트리밍 그대로 그리고, 생성 데이터는 오른쪽 컴포넌트별 말풍선으로 연결한다.
                설문 답변 선택(재개·단계 실행 입력)도 이 페이지·말풍선에서 한다 */}
            {(surveyPreviewPage || planPreview || flowRunning) && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>실제 렌더링{pgTab === 'flow' ? ' — 프로덕션 스트리밍 그대로' : ''}</b>
                  <div className="sb-admin-fb-seg" role="group" aria-label="실렌더 미리보기 단계">
                    <button
                      type="button"
                      className={'sb-admin-fb-seg__btn' + (shownStage === 'survey' ? ' is-on' : '')}
                      onClick={() => setPreviewStage('survey')}
                    >
                      설문
                    </button>
                    <button
                      type="button"
                      className={'sb-admin-fb-seg__btn' + (shownStage === 'plan' ? ' is-on' : '')}
                      disabled={!planPreview}
                      title={planPreview ? undefined : '계획 구간을 실행하면 열려요'}
                      onClick={() => setPreviewStage('plan')}
                    >
                      계획
                    </button>
                  </div>
                </div>
                <FlowRunPreview
                  stage={shownStage}
                  page={shownStage === 'survey' ? surveyPreviewPage : planPreview?.page || null}
                  streaming={
                    pgTab === 'flow' &&
                    (shownStage === 'survey'
                      ? flowRunning === 'survey'
                      : flowRunning === 'plan' && !flowSkeletonRef.current)
                  }
                  pendingSlots={shownStage === 'plan' ? planPreview?.pending || [] : []}
                  statusMessage={
                    pgTab === 'flow'
                      ? pgStatus || flowNote
                      : running
                        ? pgStatus
                        : shownStage === 'plan'
                          ? prodResult
                            ? '자리 비어 있음 — 검증 게이트 통과 섹션이 없어요 (드롭 로그 참고)'
                            : '자리 — ✦ 상품·콘텐츠 실행(4+5b→6)이 채워요'
                          : null
                  }
                  answers={pgAnswers}
                  onAnswer={flowBusy ? null : setFlowAnswer}
                  profileItems={previewProfileItems}
                  slotReasons={slotReasons}
                  onOpenStage={setSelectedStage}
                  surveySummary={flowSummary}
                  overall={previewOverall}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 단계 레이어 모달 — 노드 클릭: 설명·최근 실행 + (LLM 단계) 시스템 프롬프트 열람·수정 */}
      {selected && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !promptSaving) setSelectedStage(null)
          }}
        >
          <section
            className={'sb-llm-dialog sb-admin-dialog' + (selected.promptId ? ' sb-admin-prompt-dialog' : ' sb-stage-dialog')}
            role="dialog"
            aria-modal="true"
            aria-label="파이프라인 단계 상세"
          >
            <div className="sb-admin-dialog__head">
              <h2 className="sb-stage-dialog__title">
                <span className="sb-pipe-stage__no">{selected.no}</span>
                {selected.label}
              </h2>
              <div className="sb-admin-dialog__actions">
                <button type="button" className="sb-icon-btn" aria-label="닫기" disabled={promptSaving} onClick={() => setSelectedStage(null)}>×</button>
              </div>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <div className="sb-stage-dialog__chips">
                <span className="sb-admin-prompt-chip">{KIND_LABEL[selected.kind] || selected.kind}</span>
                {selected.effort && <span className="sb-admin-prompt-chip">effort {selected.effort}</span>}
                {selected.status === 'planned' && <span className="sb-admin-prompt-chip">예정</span>}
                {(selected.promptCustom || selectedResult?.custom) && (
                  <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">프롬프트 재정의</span>
                )}
              </div>
              <p className="sb-pipe-stage__note">{selected.note}</p>
              {selectedResult?.meta && <p className="sb-admin__muted">최근 실행: {metaLine(selectedResult.meta)}</p>}
              {selectedResult?.summary && <p className="sb-admin__muted">최근 실행 요약: {selectedResult.summary}</p>}
              {selectedResult?.pass != null && (
                <p className="sb-admin__muted">최근 게이트: 섹션 {selectedResult.pass}개 통과 · {selectedResult.drops}건 드롭</p>
              )}

              {/* 이번 실행 프롬프트 — 플레이그라운드가 실제로 보낸 시스템 전문(치환 완료)·가변부 원문 */}
              {selectedResult?.prompt && (
                <div className="sb-pipe-trace">
                  <div className="sb-stage-dialog__prompt-head">
                    <b>이번 실행 프롬프트</b>
                    <code>{selectedResult.prompt.promptId}</code>
                    {selectedResult.prompt.custom ? (
                      <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의/임시</span>
                    ) : (
                      <span className="sb-admin-prompt-chip">기본값</span>
                    )}
                  </div>
                  <details className="sb-pipe-trace__box">
                    <summary>
                      시스템 프롬프트 전문 — 치환 완료 · {selectedResult.prompt.system.length.toLocaleString('ko-KR')}자
                    </summary>
                    <pre>{selectedResult.prompt.system}</pre>
                  </details>
                  <details className="sb-pipe-trace__box">
                    <summary>요청 가변부 (user) — {selectedResult.prompt.user.length.toLocaleString('ko-KR')}자</summary>
                    <pre>{selectedResult.prompt.user}</pre>
                  </details>
                </div>
              )}

              {selected.promptId && !stagePrompt && (
                <p className={promptsError ? 'sb-admin-gate__error' : 'sb-admin__muted'}>
                  {promptsError ? `프롬프트를 불러오지 못했어요: ${promptsError}` : '프롬프트를 불러오는 중…'}
                </p>
              )}
              {!selected.promptId && (
                <p className="sb-admin__muted">이 단계는 시스템 프롬프트가 없어요 — LLM 호출 없이 코드로 처리돼요.</p>
              )}

              {stagePrompt && (() => {
                const isDefaultText = promptText === stagePrompt.defaultText
                const saved = stagePrompt.configured ?? stagePrompt.defaultText
                const dirtyPrompt = promptText !== saved
                const missingCatalog = stagePrompt.id === 'plan-products' && !promptText.includes('{{CATALOG}}')
                return (
                  <>
                    <div className="sb-stage-dialog__prompt-head">
                      <b>시스템 프롬프트</b>
                      <code>{stagePrompt.id}</code>
                      {stagePrompt.configured ? (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                      ) : (
                        <span className="sb-admin-prompt-chip">기본값{prompts ? ` ${prompts.promptVersion}` : ''}</span>
                      )}
                    </div>
                    <p className="sb-admin__muted">{stagePrompt.note}</p>
                    <textarea
                      className="sb-admin-prompt-dialog__editor"
                      value={promptText}
                      spellCheck={false}
                      onChange={(event) => setPromptText(event.target.value)}
                    />
                    <div className="sb-admin-prompt-dialog__meta">
                      <span className="sb-admin__muted">{promptText.length.toLocaleString('ko-KR')}자</span>
                      {isDefaultText && <span className="sb-admin-prompt-chip">기본값과 동일 — 저장하면 기본값 추종으로 돌아가요</span>}
                      {!isDefaultText && stagePrompt.configured && !dirtyPrompt && (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                      )}
                      {missingCatalog && (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">
                          {'{{CATALOG}}'} 자리표시자가 없어요 — 상품 카탈로그 목록이 프롬프트에서 빠져요
                        </span>
                      )}
                    </div>
                    <div className="sb-json-dialog__actions">
                      {stagePrompt.configured && (
                        <button
                          type="button"
                          className="sb-btn sb-btn--ghost"
                          disabled={promptSaving}
                          onClick={() => savePrompt(null)}
                        >
                          기본값으로 되돌리기
                        </button>
                      )}
                      {!isDefaultText && !stagePrompt.configured && (
                        <button
                          type="button"
                          className="sb-btn sb-btn--ghost"
                          disabled={promptSaving}
                          onClick={() => setPromptText(stagePrompt.defaultText)}
                        >
                          기본값 원문으로 채우기
                        </button>
                      )}
                      <button type="button" className="sb-btn sb-btn--ghost" disabled={promptSaving} onClick={() => setSelectedStage(null)}>닫기</button>
                      <button
                        type="button"
                        className="sb-btn sb-btn--primary"
                        disabled={!dirtyPrompt || promptSaving || !promptText.trim()}
                        onClick={() => savePrompt(promptText)}
                      >
                        {promptSaving ? '저장 중…' : '저장'}
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>
          </section>
        </div>
      )}

      {/* 지식 편집 다이얼로그 */}
      {knowledgeEdit && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !knowledgeSaving) setKnowledgeEdit(null)
          }}
        >
          <section
            className="sb-llm-dialog sb-admin-dialog sb-admin-prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="지식 소스 편집"
          >
            <div className="sb-admin-dialog__head">
              <h2>지식 소스 — {knowledgeEdit.label}</h2>
              <div className="sb-admin-dialog__actions">
                <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setKnowledgeEdit(null)}>×</button>
              </div>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <p className="sb-admin__muted">{knowledgeEdit.note}</p>
              <textarea
                className="sb-admin-prompt-dialog__editor"
                value={knowledgeText}
                spellCheck={false}
                placeholder="비워 두고 저장하면 설정이 지워져요 (지식 없음)"
                onChange={(event) => setKnowledgeText(event.target.value)}
              />
              <div className="sb-json-dialog__actions">
                {knowledgeEdit.value && (
                  <button type="button" className="sb-btn sb-btn--ghost" disabled={knowledgeSaving} onClick={() => saveKnowledge(null)}>
                    비우기 (지식 없음)
                  </button>
                )}
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setKnowledgeEdit(null)}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={knowledgeSaving || knowledgeText === (knowledgeEdit.value ?? '')}
                  onClick={() => saveKnowledge(knowledgeText)}
                >
                  {knowledgeSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
