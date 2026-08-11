import React, { useEffect, useState } from 'react'
import {
  deleteEvalCase,
  fetchAdminPrompts,
  fetchEngineMetrics,
  fetchEvalCases,
  fetchEvalRuns,
  judgeEvalRun,
  putAdminPrompt,
  runEvalCase,
  scoreEvalRun,
} from '../lib/adminApi.js'

/*
 * 실험 탭 (관리 페이지 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 5).
 * 골든 케이스(쓰레드 상세에서 승격한 입력 스냅샷)에 설정을 바꿔 가며 실행하고 채점해
 * 프롬프트·설정 변경의 회귀를 잰다. 채점은 평가 레코드 문법 한 벌(라이브 피드백과 동일):
 * 사람 = 전체 별점·코멘트 + 섹션별 components, 자동 = judge(루브릭 4차원 — source 축 분리,
 * 절대 합산·덮어쓰기 없음). 전환 판정 카드는 실주행 plan 스텝 llmMeta(engine 각인) 집계.
 */

const timeShort = (iso) => (iso ? iso.slice(5, 16).replace('T', ' ') : '—')

function metaLine(meta) {
  if (!meta) return null
  const parts = []
  if (meta.model) parts.push(meta.model)
  if (meta.latencyMs != null) parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`)
  if (meta.usage?.outputTokens != null) parts.push(`out ${meta.usage.outputTokens.toLocaleString('ko-KR')}`)
  if (meta.usage?.webSearchRequests) parts.push(`검색 ${meta.usage.webSearchRequests}회`)
  return parts.join(' · ')
}

const SECTION_KIND_LABEL = { guide: '안내', products: '상품', contents: '콘텐츠', steps: '순서' }

/** 실행 페이지 → 채점 앵커 목록 — components의 id·label 원천 (실행 결과는 불변 스냅샷이라 안정적).
 * 단계 축에 따라 계획 = 섹션(sec-<index>), 설문 = 질문(와이어 질문 id — 라이브 피드백과 같은 규칙) */
const runAnchors = (run) => {
  const page = run.page
  if (!page) return []
  if (page.questions) return page.questions.map((q) => ({ id: q.id, label: `질문 · ${q.question}` }))
  return (page.sections || []).map((s, i) => ({
    id: `sec-${i}`,
    label: `${SECTION_KIND_LABEL[s.kind] || s.kind} · ${s.title}`,
  }))
}

/** 별점 표시 한 조각 — 미채점/0점 배지 구분은 평가 스튜디오 문법 그대로 */
function ScoreBadge({ score }) {
  if (score == null) return <span className="sb-admin-fb-badge">미채점</span>
  if (score === 0) return <span className="sb-admin-fb-badge sb-admin-fb-badge--zero">0점</span>
  return (
    <span className="sb-admin-fb-stars" title={`${score}점`}>
      {'★'.repeat(score)}
      <span className="sb-admin-fb-stars__rest">{'★'.repeat(5 - score)}</span>
    </span>
  )
}

export default function ExperimentStudio() {
  const [cases, setCases] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [error, setError] = useState(null)
  const [runsByCase, setRunsByCase] = useState({}) // caseId -> EvalRun[]
  const [expanded, setExpanded] = useState({}) // caseId -> bool
  const [running, setRunning] = useState(null) // 실행 중 caseId
  const [status, setStatus] = useState(null)
  const [override, setOverride] = useState('')
  const [label, setLabel] = useState('')
  const [runStage, setRunStage] = useState('plan') // 실행 단계 축 — 'plan' | 'survey'
  const [batch, setBatch] = useState(false) // 전수 판정 진행 중
  const [batchResult, setBatchResult] = useState(null)
  const [scoreDraft, setScoreDraft] = useState({}) // runId -> { score, comment, components: {id: {score, feedback}}, saving }
  const [detailOpen, setDetailOpen] = useState({}) // runId -> bool (섹션별 채점 펼침)
  const [judging, setJudging] = useState(null) // 자동 채점 중 runId
  const [judgePrompts, setJudgePrompts] = useState([]) // AdminPromptEntry[] (id가 judge*) — 계획·설문 심사관
  const [judgeDrafts, setJudgeDrafts] = useState({}) // promptId -> 편집 원문
  const [judgeSaving, setJudgeSaving] = useState(null) // 저장 중 promptId

  const load = async () => {
    setError(null)
    try {
      const [caseWire, metricWire] = await Promise.all([fetchEvalCases(), fetchEngineMetrics()])
      setCases(caseWire.items)
      setMetrics(metricWire)
    } catch (e) {
      setError(e.message)
    }
    // judge 프롬프트는 부가 기능 — 조회 실패해도 탭은 동작한다
    try {
      const wire = await fetchAdminPrompts()
      const entries = wire.prompts.filter((p) => p.id.startsWith('judge'))
      setJudgePrompts(entries)
      setJudgeDrafts(Object.fromEntries(entries.map((e) => [e.id, e.configured ?? e.defaultText])))
    } catch {
      setJudgePrompts([])
    }
  }
  useEffect(() => {
    load()
  }, [])

  const loadRuns = async (caseId) => {
    try {
      const wire = await fetchEvalRuns(caseId)
      setRunsByCase((prev) => ({ ...prev, [caseId]: wire.items }))
    } catch (e) {
      setError(e.message)
    }
  }

  const toggleExpand = (caseId) => {
    setExpanded((prev) => ({ ...prev, [caseId]: !prev[caseId] }))
    if (!runsByCase[caseId]) loadRuns(caseId)
  }

  const run = async (caseId) => {
    if (running) return
    setRunning(caseId)
    setStatus(null)
    setError(null)
    try {
      await runEvalCase(
        caseId,
        {
          ...(override.trim() ? { promptOverride: override } : {}),
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(runStage === 'survey' ? { stage: 'survey' } : {}),
        },
        { onStatus: setStatus },
      )
      setExpanded((prev) => ({ ...prev, [caseId]: true }))
      await loadRuns(caseId)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(null)
      setStatus(null)
    }
  }

  const savedComponentsMap = (runRow) => {
    const map = {}
    for (const c of runRow.components || []) map[c.id] = { score: c.score, feedback: c.feedback || '' }
    return map
  }

  const draftOf = (runRow) =>
    scoreDraft[runRow.id] ?? {
      score: runRow.score,
      comment: runRow.comment || '',
      components: savedComponentsMap(runRow),
      saving: false,
    }

  const patchComponentDraft = (runRow, anchorId, patch) => {
    const draft = draftOf(runRow)
    const cur = draft.components[anchorId] ?? { score: null, feedback: '' }
    setScoreDraft((prev) => ({
      ...prev,
      [runRow.id]: { ...draft, components: { ...draft.components, [anchorId]: { ...cur, ...patch } } },
    }))
  }

  /** 드래프트 → 전송 payload — 별점이나 코멘트가 있는 항목만 싣는다 (라이브 피드백과 같은 규칙) */
  const componentsPayload = (runRow, draft) =>
    runAnchors(runRow)
      .map((a) => ({ anchor: a, entry: draft.components[a.id] }))
      .filter(({ entry }) => entry && (entry.score != null || entry.feedback.trim()))
      .map(({ anchor, entry }) => ({ id: anchor.id, label: anchor.label, score: entry.score, feedback: entry.feedback }))

  const scoreDirty = (runRow, draft) =>
    draft.score !== runRow.score ||
    draft.comment !== (runRow.comment || '') ||
    JSON.stringify(componentsPayload(runRow, draft)) !==
      JSON.stringify(componentsPayload(runRow, { components: savedComponentsMap(runRow) }))

  const saveScore = async (runRow, caseId) => {
    const draft = draftOf(runRow)
    setScoreDraft((prev) => ({ ...prev, [runRow.id]: { ...draft, saving: true } }))
    try {
      await scoreEvalRun(runRow.id, draft.score, draft.comment, componentsPayload(runRow, draft))
      setScoreDraft((prev) => {
        const next = { ...prev }
        delete next[runRow.id]
        return next
      })
      await loadRuns(caseId)
    } catch (e) {
      setError(e.message)
      setScoreDraft((prev) => ({ ...prev, [runRow.id]: { ...draft, saving: false } }))
    }
  }

  const judge = async (runRow, caseId) => {
    if (judging) return
    setJudging(runRow.id)
    setError(null)
    try {
      await judgeEvalRun(runRow.id, { onStatus: setStatus })
      await loadRuns(caseId)
    } catch (e) {
      setError(e.message)
    } finally {
      setJudging(null)
      setStatus(null)
    }
  }

  /** 전수 판정 — 케이스별 최신 실행 중 미판정분을 순차 judge (회귀 라운드 1회 = 버튼 1번).
   * 순차인 이유: LLM 동시 호출 비용·레이트 제어. 이미 판정된 실행은 건너뛴다(재판정은 행 버튼) */
  const batchJudge = async () => {
    if (running || judging || batch) return
    setBatch(true)
    setError(null)
    setBatchResult(null)
    let judged = 0
    let skipped = 0
    let failed = 0
    const list = cases || []
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      setStatus(`전수 판정 ${i + 1}/${list.length} — ${c.title || c.intent}`)
      try {
        const wire = await fetchEvalRuns(c.id)
        setRunsByCase((prev) => ({ ...prev, [c.id]: wire.items }))
        const latest = wire.items[0]
        if (!latest || !latest.page || latest.judge) {
          skipped++
          continue
        }
        await judgeEvalRun(latest.id, {})
        const refreshed = await fetchEvalRuns(c.id)
        setRunsByCase((prev) => ({ ...prev, [c.id]: refreshed.items }))
        judged++
      } catch {
        failed++
      }
    }
    setBatch(false)
    setStatus(null)
    setBatchResult(`전수 판정 완료 — 판정 ${judged} · 건너뜀 ${skipped}${failed ? ` · 실패 ${failed}` : ''}`)
  }

  /** 설정별 채점 요약 — 불러온 실행 전체를 config 축(단계·promptVersion·what-if)으로 묶어
   * 사람 평균과 judge 평균을 나란히 (합산하지 않는다 — source 축 분리) */
  const summaryRows = (() => {
    const all = Object.values(runsByCase).flat()
    if (!all.length) return []
    const groups = new Map()
    for (const r of all) {
      const key = `${r.config?.stage === 'survey' ? '설문' : '계획'} · ${r.config?.promptVersion || '—'}${
        r.config?.promptOverride ? ' (what-if)' : ''
      }`
      let g = groups.get(key)
      if (!g) {
        g = { key, count: 0, human: [], judge: [] }
        groups.set(key, g)
      }
      g.count++
      if (r.score != null) g.human.push(r.score)
      if (r.judge?.score != null) g.judge.push(r.judge.score)
    }
    const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null)
    return [...groups.values()].map((g) => ({
      key: g.key,
      count: g.count,
      human: avg(g.human),
      humanN: g.human.length,
      judge: avg(g.judge),
      judgeN: g.judge.length,
    }))
  })()

  const judgePromptDirty = (entry) => judgeDrafts[entry.id] !== (entry.configured ?? entry.defaultText)

  const saveJudgePrompt = async (id, text) => {
    setJudgeSaving(id)
    setError(null)
    try {
      const wire = await putAdminPrompt(id, text)
      const entries = wire.prompts.filter((p) => p.id.startsWith('judge'))
      setJudgePrompts(entries)
      setJudgeDrafts(Object.fromEntries(entries.map((e) => [e.id, e.configured ?? e.defaultText])))
    } catch (e) {
      setError(e.message)
    } finally {
      setJudgeSaving(null)
    }
  }

  const removeCase = async (caseId) => {
    try {
      await deleteEvalCase(caseId)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <>
      {error && <p className="sb-admin-gate__error">{error}</p>}

      {/* 전환 판정 계기판 — 실주행 엔진 비교 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">전환 판정 계기판 (실주행 plan 스텝 {metrics ? metrics.sampled : '…'}개 표본)</p>
        <p className="sb-admin__muted">
          engine 플래그·x-ddak-engine 헤더로 흘린 실주행 기록을 엔진별로 비교해요 — 게이트: 지연 +20% 이내·캐시 적중
          유지·가드 통과 동등이면 기본 엔진을 langgraph로 전환.
        </p>
        {metrics && metrics.engines.length === 0 && <p className="sb-admin__muted">아직 표본이 없어요.</p>}
        {metrics && metrics.engines.length > 0 && (() => {
          /* 지연 3종을 전 엔진 공통 축으로 그린다 — 막대 길이가 곧 비교라 표보다 판정이 빠르다 */
          const latMax = Math.max(
            1,
            ...metrics.engines.flatMap((m) => [m.avgLatencyMs || 0, m.avgSkeletonMs || 0, m.avgProductsMs || 0]),
          )
          const latencyBar = (label, value, mod) => (
            <div className="sb-exp-bar">
              <span className="sb-exp-bar__label">{label}</span>
              <span className="sb-exp-bar__track">
                {value != null && (
                  <span
                    className={'sb-exp-bar__fill' + (mod ? ` sb-exp-bar__fill--${mod}` : '')}
                    style={{ width: `${Math.max(2, Math.round((value / latMax) * 100))}%` }}
                  />
                )}
              </span>
              <span className="sb-exp-bar__val">{value != null ? `${(value / 1000).toFixed(1)}s` : '—'}</span>
            </div>
          )
          return (
            <>
              <div className="sb-exp-engines">
                {metrics.engines.map((m) => (
                  <div key={m.engine} className="sb-exp-engine">
                    <div className="sb-exp-engine__head">
                      <code>{m.engine}</code>
                      <span className="sb-admin__muted">표본 {m.count}개</span>
                    </div>
                    {latencyBar('전체', m.avgLatencyMs)}
                    {latencyBar('뼈대', m.avgSkeletonMs, 'skeleton')}
                    {latencyBar('상품', m.avgProductsMs, 'products')}
                    <div className="sb-exp-bar">
                      <span className="sb-exp-bar__label">캐시</span>
                      <span className="sb-exp-bar__track">
                        {m.cacheHitRate != null && (
                          <span
                            className="sb-exp-bar__fill sb-exp-bar__fill--cache"
                            style={{ width: `${Math.round(m.cacheHitRate * 100)}%` }}
                          />
                        )}
                      </span>
                      <span className="sb-exp-bar__val">
                        {m.cacheHitRate != null ? `${Math.round(m.cacheHitRate * 100)}%` : '—'}
                      </span>
                    </div>
                    {(m.promptVersions || []).length > 0 && (
                      <div className="sb-exp-engine__foot">
                        {m.promptVersions.map((v) => (
                          <span key={v} className="sb-admin-prompt-chip">{v}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="sb-admin__muted">지연 막대는 짧을수록 좋아요 — 세 지표 모두 엔진 공통 축이라 길이로 바로 비교돼요.</p>
            </>
          )
        })()}
      </div>

      {/* 골든 케이스 */}
      <div className="sb-admin-card">
        <p className="sb-panel-label">골든 케이스 {cases ? `(${cases.length})` : ''}</p>
        <p className="sb-admin__muted">
          쓰레드 상세의 「평가 케이스로 저장」이 여기로 쌓여요. 실행은 뼈대+상품 dry-run(쓰레드 기록 없음) —
          같은 케이스를 설정만 바꿔 다시 돌리고 채점으로 비교하세요. 채점은 전체 별점·코멘트에 섹션별 채점을
          더할 수 있고, 자동 채점(판정)은 별도 축으로 나란히 쌓여요.
        </p>
        <details className="sb-pipe-play__override">
          <summary>실행 설정 — 단계·임시 프롬프트(what-if)·라벨 (다음 실행에 적용)</summary>
          <div className="sb-admin-fb-seg sb-exp-stagepick" role="radiogroup" aria-label="실행 단계">
            <button
              type="button"
              className={'sb-admin-fb-seg__btn' + (runStage === 'plan' ? ' is-on' : '')}
              onClick={() => setRunStage('plan')}
            >
              계획 (뼈대+상품)
            </button>
            <button
              type="button"
              className={'sb-admin-fb-seg__btn' + (runStage === 'survey' ? ' is-on' : '')}
              title="케이스의 의도·프로필만으로 설문 페이지를 재생성해요 — 설문·답변 스냅샷이 없는 케이스도 실행돼요"
              onClick={() => setRunStage('survey')}
            >
              설문
            </button>
          </div>
          <input
            type="text"
            className="sb-exp-label"
            placeholder="실행 라벨 (예: 프롬프트 A안)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <textarea
            value={override}
            spellCheck={false}
            placeholder="임시 시스템 프롬프트 — 비우면 저장값(재정의 포함)으로 실행. 해당 단계의 LLM 호출 전부에 적용돼요."
            onChange={(event) => setOverride(event.target.value)}
          />
        </details>
        {judgePrompts.map((entry) => (
          <details key={entry.id} className="sb-pipe-play__override">
            <summary>
              채점 기준 — {entry.label}
              {entry.configured != null && (
                <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의</span>
              )}
            </summary>
            <p className="sb-admin__muted">{entry.note}</p>
            <textarea
              value={judgeDrafts[entry.id] ?? ''}
              spellCheck={false}
              onChange={(event) => setJudgeDrafts((prev) => ({ ...prev, [entry.id]: event.target.value }))}
            />
            <div className="sb-exp-judge-prompt__actions">
              <button
                type="button"
                className="sb-btn sb-btn--primary sb-btn--tiny"
                disabled={!judgePromptDirty(entry) || judgeSaving !== null}
                onClick={() => saveJudgePrompt(entry.id, judgeDrafts[entry.id])}
              >
                {judgeSaving === entry.id ? '저장 중…' : '저장'}
              </button>
              <button
                type="button"
                className="sb-btn sb-btn--ghost sb-btn--tiny"
                disabled={judgeSaving !== null || entry.configured == null}
                onClick={() => saveJudgePrompt(entry.id, null)}
              >
                기본값 복귀
              </button>
            </div>
          </details>
        ))}
        {(cases || []).length > 0 && (
          <div className="sb-exp-batch">
            <button
              type="button"
              className="sb-btn sb-btn--ai sb-btn--tiny"
              disabled={batch || running !== null || judging !== null}
              title="케이스별 최신 실행 중 아직 판정이 없는 것을 순서대로 자동 채점해요 — 프롬프트·설정을 바꾼 뒤의 회귀 라운드"
              onClick={batchJudge}
            >
              {batch ? '전수 판정 중…' : '✦ 전수 판정'}
            </button>
            {batchResult && <span className="sb-admin__muted">{batchResult}</span>}
          </div>
        )}
        {summaryRows.length > 0 && (
          <div className="sb-exp-summary">
            <p className="sb-panel-label">설정별 채점 요약 (불러온 실행 기준 — 전수 판정이 전 케이스를 불러와요)</p>
            <ul>
              {summaryRows.map((row) => (
                <li key={row.key} className="sb-exp-summary__row">
                  <span className="sb-exp-summary__key">{row.key}</span>
                  <span className="sb-admin__muted">실행 {row.count}</span>
                  <span className="sb-exp-summary__stat">
                    사람 {row.human != null ? `★${row.human}` : '—'}
                    <i>({row.humanN})</i>
                  </span>
                  <span className="sb-exp-summary__stat sb-exp-summary__stat--judge">
                    판정 {row.judge != null ? `★${row.judge}` : '—'}
                    <i>({row.judgeN})</i>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {status && (
          <p className="sb-flow-status">
            <i className="sb-flow-status__dot" aria-hidden="true" />
            {status}
          </p>
        )}
        {cases && cases.length === 0 && (
          <p className="sb-table__empty">아직 케이스가 없어요 — 쓰레드·평가 탭에서 쓰레드를 열어 「평가 케이스로 저장」을 누르세요.</p>
        )}
        <ul className="sb-pipe-knowledge">
          {(cases || []).map((c) => (
            <li key={c.id}>
              <div className="sb-pipe-knowledge__row">
                <div className="sb-pipe-knowledge__main">
                  <div className="sb-pipe-stage__title">
                    <b>{c.title || c.intent}</b>
                    {!c.survey && <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">설문 스냅샷 없음</span>}
                    {c.sourceThreadId && <code>{c.sourceThreadId}</code>}
                    {(runsByCase[c.id] || []).length > 0 && (
                      <span className="sb-exp-trend" title="실행 채점 추이 (왼쪽 = 오래된 실행)">
                        {[...runsByCase[c.id]].reverse().map((r) => (
                          <i
                            key={r.id}
                            className={
                              'sb-exp-trend__dot' +
                              (r.score == null
                                ? ' sb-exp-trend__dot--none'
                                : r.score <= 2
                                  ? ' sb-exp-trend__dot--low'
                                  : '')
                            }
                            title={r.score == null ? '미채점' : `★${r.score}`}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                  <p className="sb-pipe-stage__note">
                    {c.intent} · {timeShort(c.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="sb-btn sb-btn--ai sb-btn--tiny"
                  disabled={running !== null || batch || (runStage === 'plan' && (!c.survey || !(c.answers || []).length))}
                  title={
                    runStage === 'plan' && !c.survey
                      ? '설문·답변 스냅샷이 없어 계획 실행을 할 수 없어요 — 실행 설정에서 설문 단계로 바꾸면 실행돼요'
                      : undefined
                  }
                  onClick={() => run(c.id)}
                >
                  {running === c.id ? '실행 중…' : runStage === 'survey' ? '✦ 설문 실행' : '✦ 실행'}
                </button>
                <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => toggleExpand(c.id)}>
                  기록{runsByCase[c.id] ? ` ${runsByCase[c.id].length}` : ''}
                </button>
                <button type="button" className="sb-btn sb-btn--danger sb-btn--tiny" onClick={() => removeCase(c.id)}>
                  삭제
                </button>
              </div>
              {expanded[c.id] && (
                <ul className="sb-exp-runs">
                  {(runsByCase[c.id] || []).map((r) => {
                    const draft = draftOf(r)
                    const dirty = scoreDirty(r, draft)
                    const anchors = runAnchors(r)
                    const savedCompCount = (r.components || []).length
                    return (
                      <li key={r.id} className="sb-exp-run">
                        <div className="sb-pipe-stage__title">
                          <ScoreBadge score={r.score} />
                          {r.judge && (
                            <span
                              className="sb-exp-judge-chip"
                              title={`자동 채점(judge) ${r.judge.score}점 — 사람 채점과 별도 축`}
                            >
                              판정 ★{r.judge.score}
                            </span>
                          )}
                          {r.config?.label && <b>{r.config.label}</b>}
                          {r.config?.stage === 'survey' && (
                            <span className="sb-admin-prompt-chip sb-admin-prompt-chip--stage">설문 단계</span>
                          )}
                          <span className="sb-admin-prompt-chip">{r.config?.engine || '—'}</span>
                          {r.config?.promptVersion && <span className="sb-admin-prompt-chip">{r.config.promptVersion}</span>}
                          {r.config?.promptOverride && (
                            <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">임시 프롬프트</span>
                          )}
                          <span className="sb-admin__muted">{metaLine(r.meta)}</span>
                          <span className="sb-admin__muted">드롭 {(r.dropLog || []).length}</span>
                          <span className="sb-admin__muted">{timeShort(r.createdAt)}</span>
                        </div>
                        {r.page && (
                          <p className="sb-pipe-stage__note">
                            {r.page.questions
                              ? `${r.page.intro} — 질문 ${r.page.questions.length}개`
                              : `${r.page.headline} — 섹션 ${r.page.sections.length}개`}
                          </p>
                        )}
                        {r.judge && (
                          <div className="sb-exp-judge">
                            <div className="sb-exp-judge__rubric">
                              {(r.judge.rubric || []).map((axis) => (
                                <span key={axis.key} className="sb-exp-judge__axis" title={axis.note}>
                                  {axis.label} <b>★{axis.score}</b>
                                </span>
                              ))}
                            </div>
                            <p className="sb-exp-judge__verdict">{r.judge.verdict}</p>
                          </div>
                        )}
                        <div className="sb-exp-score">
                          <select
                            value={draft.score == null ? '' : String(draft.score)}
                            onChange={(event) =>
                              setScoreDraft((prev) => ({
                                ...prev,
                                [r.id]: { ...draft, score: event.target.value === '' ? null : Number(event.target.value) },
                              }))
                            }
                          >
                            <option value="">미채점</option>
                            {[5, 4, 3, 2, 1, 0].map((n) => (
                              <option key={n} value={n}>{'★'.repeat(n) || '0점'}</option>
                            ))}
                          </select>
                          <input
                            type="text"
                            placeholder="전체 코멘트"
                            value={draft.comment}
                            onChange={(event) =>
                              setScoreDraft((prev) => ({ ...prev, [r.id]: { ...draft, comment: event.target.value } }))
                            }
                          />
                          {anchors.length > 0 && (
                            <button
                              type="button"
                              className="sb-btn sb-btn--ghost sb-btn--tiny"
                              onClick={() => setDetailOpen((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                            >
                              섹션별 채점{savedCompCount ? ` ${savedCompCount}` : ''}
                            </button>
                          )}
                          <button
                            type="button"
                            className="sb-btn sb-btn--primary sb-btn--tiny"
                            disabled={!dirty || draft.saving}
                            onClick={() => saveScore(r, c.id)}
                          >
                            {draft.saving ? '저장 중…' : '채점 저장'}
                          </button>
                          <button
                            type="button"
                            className="sb-btn sb-btn--ai sb-btn--tiny"
                            disabled={judging !== null || batch || !r.page}
                            title="LLM 심사관이 루브릭 4차원(근거 충실·맞춤성·단계 구성·실행 가능성)으로 채점해요 — 사람 채점과 별도로 저장돼요"
                            onClick={() => judge(r, c.id)}
                          >
                            {judging === r.id ? '채점 중…' : r.judge ? '✦ 다시 판정' : '✦ 자동 채점'}
                          </button>
                        </div>
                        {detailOpen[r.id] && anchors.length > 0 && (
                          <ul className="sb-exp-comps">
                            {anchors.map((anchor) => {
                              const entry = draft.components[anchor.id] ?? { score: null, feedback: '' }
                              return (
                                <li key={anchor.id} className="sb-exp-comp">
                                  <span className="sb-exp-comp__label" title={anchor.label}>
                                    {anchor.label}
                                  </span>
                                  <select
                                    value={entry.score == null ? '' : String(entry.score)}
                                    onChange={(event) =>
                                      patchComponentDraft(r, anchor.id, {
                                        score: event.target.value === '' ? null : Number(event.target.value),
                                      })
                                    }
                                  >
                                    <option value="">미채점</option>
                                    {[5, 4, 3, 2, 1, 0].map((n) => (
                                      <option key={n} value={n}>{'★'.repeat(n) || '0점'}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    placeholder="이 섹션에 대한 코멘트"
                                    value={entry.feedback}
                                    onChange={(event) => patchComponentDraft(r, anchor.id, { feedback: event.target.value })}
                                  />
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                  {(runsByCase[c.id] || []).length === 0 && (
                    <li className="sb-admin__muted">아직 실행 기록이 없어요.</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
