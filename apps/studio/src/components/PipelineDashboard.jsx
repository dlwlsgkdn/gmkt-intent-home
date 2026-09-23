import React, { useEffect, useMemo, useState } from 'react'
import { PIPELINE_STAGES } from '../../../../packages/pipeline/src/stages.ts'
import {
  fetchAdminChanges,
  fetchAdminPipeline,
  fetchAdminPrompts,
  fetchAdminThread,
  fetchAdminThreads,
} from '../lib/adminApi.js'
import { knowledgeRouting } from '../lib/pipelineKnowledge.js'
import PipelineFlow from './PipelineFlow.jsx'

const TEST_USER = 'ops-playground'

const STAGE_DATA = {
  objective: {
    inputs: ['고객 한 줄 요청'],
    data: ['원문 발화', '유효성 판정'],
    uses: ['1단계 의도 파악', '쓰레드 진입 문구'],
  },
  intent: {
    inputs: ['검증된 고객 발화'],
    data: ['의도 유형', '목적·시점·대상'],
    uses: ['2단계 조건 원장', '3단계 질문 생성', '5단계 추천 구성'],
  },
  ledger: {
    inputs: ['의도 해석', '프로필', '설문 답변', '최근 피드백', '트렌드 키워드'],
    data: ['조건 사실 목록', '출처·우선순위'],
    uses: ['3단계 중복 질문 방지', '5a·5b·5c 생성 조건', '6단계 조건 역대조'],
  },
  survey: {
    inputs: ['조건 원장', '설문 프롬프트'],
    data: ['질문 1~3개', '선택지·입력 규칙'],
    uses: ['고객 답변 수집', '2단계 원장 갱신', '5단계 추천 입력'],
  },
  candidates: {
    inputs: ['의도·답변·프로필 검색어', '내부 카탈로그'],
    data: ['상품 후보 최대 32개', '콘텐츠 후보 최대 16개'],
    uses: ['5b 상품 추천', '5c 참고 콘텐츠 추천'],
  },
  'plan-skeleton': {
    inputs: ['조건 원장', '설문·답변'],
    data: ['추천 제목', '단계 순서', '상품·콘텐츠 자리'],
    uses: ['5b·5c 결과 합치기', '고객 화면 조기 표시'],
  },
  'plan-products': {
    inputs: ['조건 원장', '상품 후보', '웹 검색'],
    data: ['단계별 추천 상품', '추천 이유·상품 URL'],
    uses: ['5a 상품 자리 채우기', '6단계 상품 검증'],
  },
  'plan-contents': {
    inputs: ['조건 원장', '콘텐츠 후보', '웹 검색'],
    data: ['영상·게시글', '선정 이유·출처 URL'],
    uses: ['5a 콘텐츠 자리 채우기', '6단계 출처 검증'],
  },
  verify: {
    inputs: ['합쳐진 추천 계획', '조건 원장', '금지 목록'],
    data: ['통과 결과', '제외 항목', '제외 사유 로그'],
    uses: ['7단계 결과 저장', '최종 고객 화면'],
  },
  record: {
    inputs: ['검증 완료 계획', '단계 실행 메타'],
    data: ['쓰레드 스텝', '모델·프롬프트 버전', '추천 결과 원문'],
    uses: ['고객 이어보기', '운영 로그·평가', '다음 추천 피드백'],
  },
}

const formatAt = (at) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

const trialLog = (thread) => {
  const steps = Array.isArray(thread?.steps) ? thread.steps : []
  const trialStep = [...steps].reverse().find((step) => step.stage === 'action' && step.payload?.type === 'prompt-trial')
  if (!trialStep?.payload?.data) return null
  const decisionStep = [...steps].reverse().find((step) => step.stage === 'action' && step.payload?.type === 'prompt-trial-decision')
  const trial = trialStep.payload.data
  const decision = decisionStep?.payload?.data?.decision || null
  return {
    id: thread.id,
    at: trial.savedAt || trialStep.payload.at || thread.updatedAt,
    title: trial.summary || trial.promptLabel || thread.title || '저장된 지시서 시험',
    intent: trial.intent || thread.source?.query || '',
    promptIds: (trial.changes || []).map((change) => change.id).filter(Boolean).length
      ? trial.changes.map((change) => change.id).filter(Boolean)
      : [trial.promptId].filter(Boolean),
    status: decision || 'testing',
  }
}

function LogRow({ item, expert = false, onOpenThread }) {
  const isTrial = item.type === 'trial'
  return (
    <li className={`sb-pipeline-log-row is-${item.status}`}>
      <span className="sb-pipeline-log-row__mark" aria-hidden="true">{item.status === 'testing' ? '…' : '✓'}</span>
      <div>
        <div className="sb-pipeline-log-row__meta">
          <span>{item.status === 'testing' ? '테스트 중' : item.status === 'applied' ? '실제 적용됨' : '적용 안 함'}</span>
          {expert && item.promptIds?.length > 0 && <code>{item.promptIds.join(' · ')}</code>}
        </div>
        <b>{item.title}</b>
        {item.detail && <p>{item.detail}</p>}
        <small>{formatAt(item.at)}</small>
      </div>
      {isTrial && onOpenThread && <button type="button" onClick={() => onOpenThread(item.id)}>쓰레드 열기</button>}
    </li>
  )
}

export default function PipelineDashboard({ api }) {
  const [pipeline, setPipeline] = useState(null)
  const [prompts, setPrompts] = useState(null)
  const [changes, setChanges] = useState([])
  const [trials, setTrials] = useState([])
  const [error, setError] = useState(false)
  const [logError, setLogError] = useState(false)
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logMode, setLogMode] = useState('easy')
  const [hoveredStageId, setHoveredStageId] = useState(null)

  useEffect(() => {
    let active = true
    Promise.allSettled([fetchAdminPipeline(), fetchAdminPrompts()]).then(([pipelineResult, promptResult]) => {
      if (!active) return
      if (pipelineResult.status === 'fulfilled') setPipeline(pipelineResult.value)
      if (promptResult.status === 'fulfilled') setPrompts(promptResult.value)
      setError(pipelineResult.status === 'rejected' || promptResult.status === 'rejected')
    })
    return () => { active = false }
  }, [])

  const loadLogs = async () => {
    setLogsLoading(true)
    setLogError(false)
    const [changeResult, threadResult] = await Promise.allSettled([fetchAdminChanges(), fetchAdminThreads()])
    if (changeResult.status === 'fulfilled') {
      setChanges((changeResult.value.items || []).filter((item) => item.area === 'prompt'))
    }
    if (threadResult.status === 'fulfilled') {
      const candidates = (threadResult.value.items || [])
        .filter((thread) => thread.userId === TEST_USER && /^\[지시서 시험\]/.test(thread.title || ''))
        .slice(0, 12)
      const details = await Promise.allSettled(candidates.map((thread) => fetchAdminThread(thread.id)))
      setTrials(details
        .flatMap((result) => result.status === 'fulfilled' ? [trialLog(result.value)] : [])
        .filter(Boolean)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)))
      if (details.some((result) => result.status === 'rejected')) setLogError(true)
    }
    if (changeResult.status === 'rejected' || threadResult.status === 'rejected') setLogError(true)
    setLogsLoading(false)
  }

  useEffect(() => { loadLogs() }, [])

  const stages = pipeline?.stages || PIPELINE_STAGES
  const knowledge = pipeline?.knowledge || []
  const routing = useMemo(() => knowledgeRouting(knowledge, stages, prompts), [knowledge, stages, prompts])
  const knowledgeById = useMemo(() => new Map(knowledge.map((entry) => [entry.id, entry])), [knowledge])
  const promptById = useMemo(() => new Map((prompts?.prompts || []).map((prompt) => [prompt.id, prompt])), [prompts])
  const inspectByStage = useMemo(() => new Map(stages.map((stage) => {
    const spec = STAGE_DATA[stage.id] || { inputs: [], data: [], uses: [] }
    const prompt = stage.promptId ? promptById.get(stage.promptId) : null
    const linkedKnowledge = (routing.byStage.get(stage.id) || []).map((id) => knowledgeById.get(id)).filter(Boolean)
    const connectedKnowledge = linkedKnowledge.filter((entry) => entry.value).length
    const connectionParts = []
    if (stage.promptId) connectionParts.push(prompt ? `프롬프트 ${prompt.configured ? '수정본' : '기본값'} 연결` : '프롬프트 연결 확인 필요')
    else connectionParts.push('코드 규칙으로 처리')
    if (linkedKnowledge.length) connectionParts.push(`참고자료 ${connectedKnowledge}/${linkedKnowledge.length}개 값 있음`)
    return [stage.id, {
      ...spec,
      status: stage.status === 'planned' ? '준비 중' : '운영 중',
      connection: connectionParts.join(' · '),
      knowledge: linkedKnowledge,
      promptId: stage.promptId || null,
      promptCustom: Boolean(prompt?.configured || stage.promptCustom),
    }]
  })), [stages, promptById, routing.byStage, knowledgeById])
  const hoveredStage = hoveredStageId ? stages.find((stage) => stage.id === hoveredStageId) || null : null
  const hoveredInspection = hoveredStage ? inspectByStage.get(hoveredStage.id) : null
  const configuredPrompts = useMemo(() => (prompts?.prompts || []).filter((prompt) => prompt.configured), [prompts])
  const testingTrials = useMemo(() => trials.filter((trial) => trial.status === 'testing'), [trials])
  const easyApplied = useMemo(() => configuredPrompts.map((prompt) => ({
    id: `current-${prompt.id}`,
    type: 'current',
    status: 'applied',
    at: prompt.history?.[0]?.at || '',
    title: prompt.label,
    detail: prompt.history?.[0]?.note || '수정한 지시서를 현재 사용하고 있어요.',
    promptIds: [prompt.id],
  })), [configuredPrompts])
  const expertApplied = useMemo(() => changes.map((change) => ({
    id: change.id,
    type: 'change',
    status: 'applied',
    at: change.at,
    title: change.targetLabel,
    detail: change.summary,
    promptIds: [change.targetId],
  })), [changes])
  const trialRows = useMemo(() => testingTrials.map((trial) => ({ ...trial, type: 'trial', detail: trial.intent })), [testingTrials])
  const recent = expertApplied[0] || easyApplied[0] || null

  const openThread = (id) => {
    setLogsOpen(false)
    api?.openAdminThread?.(id)
  }

  return (
    <div className="sb-pipeline-dashboard sb-pipeline-dashboard--simple">
      <header className="sb-admin-pagehead">
        <div>
          <p className="sb-admin-pagehead__eyebrow">AI 추천이 완성되는 흐름</p>
          <h1>파이프라인 대시보드</h1>
          <p>고객 요청부터 추천 결과 저장까지, 현재 처리 구조를 한 화면에서 확인합니다.</p>
        </div>
        <span className="sb-pipeline-dashboard__readonly">조회 전용</span>
      </header>

      {error && <p className="sb-pipeline-dashboard__notice">운영 설정을 불러오지 못해 기본 파이프라인 구조를 보여드리고 있어요.</p>}

      <div className="sb-pipeline-dashboard__body">
        <section className="sb-admin-card sb-pipeline-dashboard__map" aria-label="AI 추천 처리 흐름">
          <div className="sb-pipeline-dashboard__map-head">
            <div><h2>추천 생성 파이프라인</h2><p>각 단계가 위에서 아래로 진행되고, 추천 구성은 세 갈래로 동시에 만들어집니다.</p></div>
            <div className="sb-pipeline-dashboard__summary">
              <span><b>{stages.filter((stage) => stage.kind === 'llm').length}</b> AI 작성</span>
              <span><b>{stages.filter((stage) => stage.kind !== 'llm').length}</b> 규칙 처리</span>
              <span><b>{knowledge.length || '—'}</b> 참고자료</span>
            </div>
          </div>
          <div className="sb-pipeline-dashboard__expert-flow">
            <PipelineFlow
              stages={stages}
              results={{}}
              feedByStage={routing.byStage}
              knowledgeById={knowledgeById}
              readOnly
              inspectByStage={inspectByStage}
              onHoverStage={setHoveredStageId}
            />
          </div>
        </section>

        <aside className="sb-admin-card sb-pipeline-dashboard__activity" aria-label="AI 설정 운영 로그 요약">
          {hoveredStage && hoveredInspection ? <>
            <div className="sb-pipeline-dashboard__activity-head"><span>데이터 현황</span><i className={hoveredStage.status === 'planned' ? 'is-planned' : ''}>{hoveredInspection.status}</i></div>
            <div><h2>{hoveredStage.no} · {hoveredStage.label}</h2><p>{hoveredStage.note}</p></div>
            <div className="sb-pipeline-stage-data">
              <section><span>들어오는 데이터</span><div>{hoveredInspection.inputs.map((item) => <em key={item}>{item}</em>)}</div></section>
              <section><span>이 단계에 존재</span><div>{hoveredInspection.data.map((item) => <em key={item}>{item}</em>)}</div></section>
              <section><span>어디에 이용</span><ul>{hoveredInspection.uses.map((item) => <li key={item}>{item}</li>)}</ul></section>
            </div>
            <div className="sb-pipeline-stage-connection">
              <b>현재 연결</b><p>{hoveredInspection.connection}</p>
              {hoveredInspection.promptId && <code>{hoveredInspection.promptId}</code>}
              {hoveredInspection.knowledge.length > 0 && <div>{hoveredInspection.knowledge.map((entry) => <span key={entry.id} className={entry.value ? 'is-filled' : ''}>{entry.label} · {entry.value ? '값 있음' : '비어 있음'}</span>)}</div>}
            </div>
            <small className="sb-pipeline-stage-readonly">조회 전용 · 수정은 쉽게 고치기 또는 전문가용 고치기에서 합니다.</small>
          </> : <>
            <div className="sb-pipeline-dashboard__activity-head"><span>운영 로그</span><i>{logError ? '연결 확인' : '자동 기록'}</i></div>
            <div><h2>최근에 무엇이 바뀌었나요?</h2><p>적용한 지시서와 아직 결정하지 않은 시험을 확인합니다.</p></div>
            <dl>
              <div><dt>현재 적용 중</dt><dd>{logsLoading ? '…' : configuredPrompts.length}</dd><small>수정한 지시서</small></div>
              <div><dt>테스트 중</dt><dd>{logsLoading ? '…' : testingTrials.length}</dd><small>결정 대기 쓰레드</small></div>
            </dl>
            {recent ? <div className="sb-pipeline-dashboard__recent"><span>최근 적용</span><b>{recent.title}</b><p>{recent.detail}</p><small>{formatAt(recent.at)}</small></div>
              : <p className="sb-pipeline-dashboard__activity-empty">{logsLoading ? '로그를 불러오는 중…' : logError ? '운영 로그에 연결하지 못했어요.' : '아직 적용된 수정 기록이 없어요.'}</p>}
            <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setLogsOpen(true)}>로그 보기 <span>→</span></button>
          </>}
        </aside>
      </div>

      {logsOpen && (
        <div className="sb-pipeline-log-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogsOpen(false) }}>
          <aside className="sb-pipeline-log-drawer" role="dialog" aria-modal="true" aria-labelledby="sb-pipeline-log-title">
            <header>
              <div><span>AI 설정 운영 로그</span><h2 id="sb-pipeline-log-title">적용과 시험 기록</h2></div>
              <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setLogsOpen(false)}>×</button>
            </header>
            <div className="sb-pipeline-log-tabs" role="tablist" aria-label="수정 방식별 로그">
              <button type="button" role="tab" aria-selected={logMode === 'easy'} className={logMode === 'easy' ? 'is-on' : ''} onClick={() => setLogMode('easy')}>쉽게 고치기</button>
              <button type="button" role="tab" aria-selected={logMode === 'expert'} className={logMode === 'expert' ? 'is-on' : ''} onClick={() => setLogMode('expert')}>전문가용 고치기</button>
            </div>
            <div className="sb-pipeline-log-drawer__body">
              {logError && <div className="sb-pipeline-log-error"><span>일부 로그를 불러오지 못했어요.</span><button type="button" disabled={logsLoading} onClick={loadLogs}>다시 불러오기</button></div>}
              <section>
                <div className="sb-pipeline-log-section-head">
                  <div><span>실제 적용됨</span><h3>{logMode === 'easy' ? '지금 사용 중인 수정본' : '프롬프트 적용 기록'}</h3></div>
                  <b>{logMode === 'easy' ? easyApplied.length : expertApplied.length}</b>
                </div>
                <p className="sb-pipeline-log-section-note">{logMode === 'easy' ? '고객의 새 추천부터 실제로 사용하는 내용만 보여줘요.' : '프롬프트 ID와 변경 메모를 최신순으로 보여줍니다.'}</p>
                <ol>
                  {(logMode === 'easy' ? easyApplied : expertApplied).slice(0, 20).map((item) => <LogRow key={item.id} item={item} expert={logMode === 'expert'} />)}
                  {!logsLoading && (logMode === 'easy' ? easyApplied : expertApplied).length === 0 && <li className="sb-pipeline-log-empty">현재 적용된 수정 기록이 없어요.</li>}
                </ol>
              </section>
              <section>
                <div className="sb-pipeline-log-section-head">
                  <div><span>테스트 중</span><h3>결정을 기다리는 쓰레드</h3></div>
                  <b>{trialRows.length}</b>
                </div>
                <p className="sb-pipeline-log-section-note">시험 결과만 저장했고 운영에는 아직 적용하지 않은 기록입니다.</p>
                <ol>
                  {trialRows.map((item) => <LogRow key={item.id} item={item} expert={logMode === 'expert'} onOpenThread={api?.openAdminThread ? openThread : null} />)}
                  {!logsLoading && trialRows.length === 0 && <li className="sb-pipeline-log-empty">결정을 기다리는 시험 쓰레드가 없어요.</li>}
                </ol>
              </section>
            </div>
            <footer><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" disabled={logsLoading} onClick={loadLogs}>{logsLoading ? '불러오는 중…' : '새로고침'}</button><span>최근 시험 쓰레드 12개와 적용 기록을 보여줍니다.</span></footer>
          </aside>
        </div>
      )}
    </div>
  )
}
