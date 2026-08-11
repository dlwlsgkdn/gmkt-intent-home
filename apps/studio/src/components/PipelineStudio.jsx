import React, { useEffect, useMemo, useState } from 'react'
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
import AdminThreadPreview from './AdminThreadPreview.jsx'
import PipelineFlow, { KIND_LABEL, metaLine } from './PipelineFlow.jsx'

/*
 * 파이프라인 스튜디오 (운영 콘솔 "파이프라인" 탭 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4).
 * 왼쪽 = 세로 흐름 다이어그램 카드(PipelineFlow — 히어로) + 런타임 설정(엔진·모델),
 * 오른쪽 = 플레이그라운드·지식 KV. 시스템 프롬프트 패널은 별도 카드가 아니라 다이어그램에
 * 녹아 있다: LLM 노드 클릭 = 단계 레이어 모달(설명·최근 실행·프롬프트 열람·수정).
 * 플레이그라운드는 두 모드다: "단계 단독"은 LLM 단계 하나를 그래프·쓰레드 기록 없이
 * dry-run하고, "전체 플로우"는 실제 LangGraph 그래프(병렬·interrupt·검증 게이트)를 스텁
 * core+MemorySaver로 통째로 돌며 stage 이벤트(단계 수명·실제 프롬프트·데이터)를 실시간으로
 * 받는다 — 실행 중에는 다이어그램 위로 경로가 흐르고, 단계별 프롬프트·메타는 노드 레이어
 * 모달의 "이번 실행" 섹션과 실행 로그 타임라인에 남는다.
 * 실행 버튼은 진짜 생성이므로 ✦ (스튜디오 왕복 ⇄ 아님 — CLAUDE.md 표기 규칙).
 */

const INJECTION_LABEL = { system: '시스템(캐시)', user: '가변부', guard: '검증 게이트' }

/** 플로우 실행 로그 타임라인 표시 순서 — 'gate'는 다이어그램 밖 interrupt 표식 */
const FLOW_LOG_ORDER = ['objective', 'intent', 'ledger', 'survey', 'gate', 'plan-skeleton', 'plan-products', 'verify', 'record']

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

  const toggleAnswer = (question, option) => {
    setPgAnswers((prev) => {
      const current = prev[question.id] || []
      let next
      if (question.multi) next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option]
      else next = current[0] === option ? [] : [option]
      return { ...prev, [question.id]: next }
    })
  }

  const runStage = async (stageId) => {
    if (running || flowRunning) return
    setRunning(stageId)
    setPgStatus(null)
    setPgError(null)
    try {
      const body = {
        stageId,
        intent: pgIntent.trim(),
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
      } else if (stageId === 'plan-skeleton') setSkResult(result)
      else setProdResult(result)
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
    } else if (name === 'content') {
      const c = data
      if (c.event === 'head') setFlowNote('인트로 생성 중…')
      else if (c.event === 'question') setFlowNote(`질문 ${c.data.index + 1} 생성 중 — ${c.data.question?.question ?? ''}`)
      else if (c.event === 'skeleton') setFlowNote(`뼈대 조기 확정 — 상품·콘텐츠 자리 ${c.data.pending?.length ?? 0}개`)
      else if (c.event === 'section')
        setFlowNote(`섹션 ${c.data.index + 1} ${c.data.final ? '도착' : '생성 중'} — ${c.data.section?.title ?? ''}`)
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
    setSvResult(null)
    setPgAnswers({})
    setSkResult(null)
    setProdResult(null)
    try {
      const result = await flowRunPipeline(
        { phase: 'survey', intent: pgIntent.trim() },
        { onStatus: setPgStatus, onEvent: handleFlowEvent },
      )
      setFlowRunId(result.flowId)
      setSvResult({ survey: result.survey, ledger: result.ledger, meta: result.meta })
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
    try {
      const result = await flowRunPipeline(
        {
          phase: 'plan',
          flowId: flowRunId,
          intent: pgIntent.trim(),
          survey: svResult?.survey,
          answers: answersList,
        },
        { onStatus: setPgStatus, onEvent: handleFlowEvent },
      )
      setFlowRunPlan(result)
    } catch (e) {
      setPgError(e.message)
    } finally {
      setFlowRunning(null)
      setPgStatus(null)
      setFlowNote(null)
      setFlowRunLive([])
    }
  }

  /* 설문 미리보기용 합성 쓰레드 — AdminThreadPreview(실렌더)를 그대로 재사용한다 */
  const previewThread = useMemo(() => {
    if (!svResult?.survey) return null
    return {
      steps: [
        { stage: 'survey', payload: { page: svResult.survey } },
        ...(answersList.length ? [{ stage: 'answers', payload: { answers: answersList } }] : []),
      ],
    }
  }, [svResult, answersList])

  /* 플로우 최종 계획 미리보기 — 설문·답변·병합 페이지를 합성 쓰레드로 만들어 실렌더 재사용 */
  const flowPlanPreviewThread = useMemo(() => {
    if (!flowRunPlan?.page || !svResult?.survey) return null
    return {
      steps: [
        { stage: 'survey', payload: { page: svResult.survey } },
        ...(answersList.length ? [{ stage: 'answers', payload: { answers: answersList } }] : []),
        { stage: 'plan', payload: { page: flowRunPlan.page } },
      ],
    }
  }, [flowRunPlan, svResult, answersList])

  const planReady = Boolean(svResult?.survey) && answersList.length > 0

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

      {/* 세로 흐름 카드(왼쪽 레일) ∥ 플레이그라운드·지식(오른쪽) — 실행이 왼쪽 흐름에 비친다 */}
      <div className="sb-pipe-layout">
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
            </>
          )}
        </div>

        <div className="sb-pipe-side">
          {/* 플레이그라운드 — 단계 단독 dry-run ∥ 전체 플로우 (실행이 왼쪽 다이어그램에 그대로 비친다) */}
          <div className="sb-admin-card">
            <div className="sb-pipe-play__head">
              <p className="sb-panel-label">플레이그라운드 (쓰레드 기록 없음)</p>
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
                ? 'LLM 단계 하나를 그래프 없이 단독 실행해요 — 임시 프롬프트 what-if는 이 모드 전용이에요.'
                : '실제 그래프(병렬 5a∥5b · 답변 대기 · 검증 게이트)를 통째로 돌아요 — 단계별 실제 프롬프트·데이터가 실시간으로 남고, 노드를 누르면 "이번 실행"으로 볼 수 있어요.'}
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

            {/* 플로우 실행 로그 — 단계 수명 타임라인 (행 클릭 = 단계 레이어 모달의 "이번 실행") */}
            {pgTab === 'flow' && FLOW_LOG_ORDER.some((id) => flowRunStages[id]) && (
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
            )}

            {svResult?.survey && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>설문 결과</b>
                  <span className="sb-admin__muted">{metaLine(svResult.meta)}</span>
                  {svResult.promptCustom && <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">임시/재정의 프롬프트</span>}
                </div>
                <p className="sb-pipe-play__intro">{svResult.survey.intro}</p>
                <div className="sb-pipe-play__grid">
                  <div className="sb-pipe-play__answers">
                    {svResult.survey.questions.map((question) => (
                      <div key={question.id} className="sb-pipe-play__q">
                        <p>
                          {question.question}
                          {question.multi && <span className="sb-admin__muted"> (복수)</span>}
                        </p>
                        <div className="sb-pipe-play__opts">
                          {question.options.map((option) => {
                            const on = (pgAnswers[question.id] || []).includes(option)
                            return (
                              <button
                                key={option}
                                type="button"
                                className={'sb-pipe-play__opt' + (on ? ' is-on' : '')}
                                onClick={() => toggleAnswer(question, option)}
                              >
                                {option}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="sb-pipe-play__actions">
                      {pgTab === 'stage' ? (
                        <>
                          <button
                            type="button"
                            className="sb-btn sb-btn--ai sb-btn--small"
                            disabled={!planReady || running !== null || flowRunning !== null}
                            title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
                            onClick={() => runStage('plan-skeleton')}
                          >
                            {running === 'plan-skeleton' ? '실행 중…' : '✦ 계획 뼈대 실행 (5a)'}
                          </button>
                          <button
                            type="button"
                            className="sb-btn sb-btn--ai sb-btn--small"
                            disabled={!planReady || running !== null || flowRunning !== null}
                            title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
                            onClick={() => runStage('plan-products')}
                          >
                            {running === 'plan-products' ? '실행 중…' : '✦ 상품·콘텐츠 실행 (4+5b→6)'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="sb-btn sb-btn--ai sb-btn--small"
                          disabled={!planReady || running !== null || flowRunning !== null || !flowRunId}
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
                      )}
                    </div>
                    {svResult.ledger?.trendKeywords?.length > 0 && (
                      <p className="sb-admin__muted">원장 키워드: {svResult.ledger.trendKeywords.join(', ')}</p>
                    )}
                  </div>
                  {previewThread && (
                    <div className="sb-pipe-play__preview">
                      <AdminThreadPreview thread={previewThread} stage="survey" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {skResult?.skeleton && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>계획 뼈대 결과</b>
                  <span className="sb-admin__muted">{metaLine(skResult.meta)}</span>
                </div>
                <p className="sb-pipe-play__intro">
                  <b>{skResult.skeleton.headline}</b> — {skResult.skeleton.summary}
                </p>
                <ul className="sb-pipe-sections">
                  {skResult.skeleton.sections.map((section, index) => (
                    <li key={index} className="sb-pipe-sections__row">
                      <span className="sb-admin-prompt-chip">{section.kind}</span>
                      <div>
                        <b>{section.title}</b>
                        {section.kind === 'guide' && <p>{section.body}</p>}
                        {section.kind === 'steps' && <p>{(section.steps || []).join(' → ')}</p>}
                        {(section.kind === 'products' || section.kind === 'contents') && (
                          <p className="sb-admin__muted">자리 — 검색 단계가 채워요 · 기준: {section.reason}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {prodResult && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>상품·콘텐츠 결과 (검증 게이트 통과분)</b>
                  <span className="sb-admin__muted">{metaLine(prodResult.meta)}</span>
                </div>
                {(prodResult.sections || []).map((section, index) => (
                  <div key={index} className="sb-pipe-play__section">
                    <p>
                      <span className="sb-admin-prompt-chip">{section.kind}</span> <b>{section.title}</b>{' '}
                      <span className="sb-admin__muted">{section.reason}</span>
                    </p>
                    {section.kind === 'products' && (
                      <ul className="sb-pipe-products">
                        {section.products.map((product) => (
                          <li key={product.id}>
                            <b>{product.brand}</b> {product.name}
                            <span className="sb-admin__muted">
                              {' '}
                              {product.price?.toLocaleString('ko-KR')}원 · {product.mall || '지마켓'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {section.kind === 'contents' && (
                      <ul className="sb-pipe-products">
                        {section.items.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            <b>{item.source}</b> {item.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {(prodResult.sections || []).length === 0 && (
                  <p className="sb-admin__muted">검증 게이트를 통과한 섹션이 없어요 — 아래 드롭 사유를 확인하세요.</p>
                )}
                <div className="sb-pipe-play__droplog">
                  <p className="sb-panel-label">드롭 로그 ({(prodResult.dropLog || []).length})</p>
                  {(prodResult.dropLog || []).length === 0 && <p className="sb-admin__muted">드롭 없음</p>}
                  <ul>
                    {(prodResult.dropLog || []).map((drop, dropIndex) => (
                      <li key={dropIndex}>
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">{drop.code}</span> {drop.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* 전체 플로우 최종 계획 — 검증 게이트까지 지난 병합본 + 실렌더 미리보기 */}
            {flowRunPlan?.page && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>플로우 최종 계획 (검증 게이트 병합본)</b>
                  <span className="sb-admin__muted">
                    {[metaLine(flowRunPlan.skeletonMeta), metaLine(flowRunPlan.productsMeta)].filter(Boolean).join(' ∥ ')}
                  </span>
                </div>
                {flowRunPlan.productsFailed && (
                  <p className="sb-admin-gate__error">검색 단계 실패 — 상품 없이 병합됐어요: {flowRunPlan.productsFailed}</p>
                )}
                <p className="sb-pipe-play__intro">
                  <b>{flowRunPlan.page.headline}</b> — {flowRunPlan.page.summary}
                </p>
                <div className="sb-pipe-play__grid">
                  <div>
                    <ul className="sb-pipe-sections">
                      {flowRunPlan.page.sections.map((section, index) => (
                        <li key={index} className="sb-pipe-sections__row">
                          <span className="sb-admin-prompt-chip">{section.kind}</span>
                          <div>
                            <b>{section.title}</b>
                            {section.kind === 'guide' && <p>{section.body}</p>}
                            {section.kind === 'steps' && <p>{(section.steps || []).join(' → ')}</p>}
                            {section.kind === 'products' && (
                              <p className="sb-admin__muted">
                                상품 {(section.products || []).length}개{section.reason ? ` — ${section.reason}` : ''}
                              </p>
                            )}
                            {section.kind === 'contents' && (
                              <p className="sb-admin__muted">
                                콘텐츠 {(section.items || []).length}개{section.reason ? ` — ${section.reason}` : ''}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="sb-pipe-play__droplog">
                      <p className="sb-panel-label">드롭 로그 ({(flowRunPlan.dropLog || []).length})</p>
                      {(flowRunPlan.dropLog || []).length === 0 && <p className="sb-admin__muted">드롭 없음</p>}
                      <ul>
                        {(flowRunPlan.dropLog || []).map((drop, dropIndex) => (
                          <li key={dropIndex}>
                            <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">{drop.code}</span>{' '}
                            {drop.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {flowPlanPreviewThread && (
                    <div className="sb-pipe-play__preview">
                      <AdminThreadPreview thread={flowPlanPreviewThread} stage="plan" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 지식 소스 — KV 편집 */}
          <div className="sb-admin-card">
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
