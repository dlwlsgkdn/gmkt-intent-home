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
            <PipelineFlow stages={stages} results={{}} feedByStage={routing.byStage} knowledgeById={knowledgeById} readOnly />
          </div>
        </section>

        <aside className="sb-admin-card sb-pipeline-dashboard__activity" aria-label="AI 설정 운영 로그 요약">
          <div className="sb-pipeline-dashboard__activity-head"><span>운영 로그</span><i>{logError ? '연결 확인' : '자동 기록'}</i></div>
          <div><h2>최근에 무엇이 바뀌었나요?</h2><p>적용한 지시서와 아직 결정하지 않은 시험을 확인합니다.</p></div>
          <dl>
            <div><dt>현재 적용 중</dt><dd>{logsLoading ? '…' : configuredPrompts.length}</dd><small>수정한 지시서</small></div>
            <div><dt>테스트 중</dt><dd>{logsLoading ? '…' : testingTrials.length}</dd><small>결정 대기 쓰레드</small></div>
          </dl>
          {recent ? <div className="sb-pipeline-dashboard__recent"><span>최근 적용</span><b>{recent.title}</b><p>{recent.detail}</p><small>{formatAt(recent.at)}</small></div>
            : <p className="sb-pipeline-dashboard__activity-empty">{logsLoading ? '로그를 불러오는 중…' : logError ? '운영 로그에 연결하지 못했어요.' : '아직 적용된 수정 기록이 없어요.'}</p>}
          <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setLogsOpen(true)}>로그 보기 <span>→</span></button>
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
