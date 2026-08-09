import React, { useEffect, useState } from 'react'
import {
  deleteEvalCase,
  fetchEngineMetrics,
  fetchEvalCases,
  fetchEvalRuns,
  runEvalCase,
  scoreEvalRun,
} from '../lib/adminApi.js'

/*
 * 실험 탭 (관리 페이지 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 5).
 * 골든 케이스(쓰레드 상세에서 승격한 입력 스냅샷)에 설정을 바꿔 가며 실행하고,
 * 사람이 별점으로 채점해 프롬프트·설정 변경의 회귀를 잰다. 전환 판정 카드는 실주행
 * plan 스텝 llmMeta(engine 각인)를 엔진별로 집계 — legacy↔langgraph 게이트의 실측 재료.
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
  const [scoreDraft, setScoreDraft] = useState({}) // runId -> { score, comment, saving }

  const load = async () => {
    setError(null)
    try {
      const [caseWire, metricWire] = await Promise.all([fetchEvalCases(), fetchEngineMetrics()])
      setCases(caseWire.items)
      setMetrics(metricWire)
    } catch (e) {
      setError(e.message)
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

  const draftOf = (runRow) =>
    scoreDraft[runRow.id] ?? { score: runRow.score, comment: runRow.comment || '', saving: false }

  const saveScore = async (runRow, caseId) => {
    const draft = draftOf(runRow)
    setScoreDraft((prev) => ({ ...prev, [runRow.id]: { ...draft, saving: true } }))
    try {
      await scoreEvalRun(runRow.id, draft.score, draft.comment)
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
          같은 케이스를 설정만 바꿔 다시 돌리고 별점으로 비교하세요.
        </p>
        <details className="sb-pipe-play__override">
          <summary>실행 설정 — 임시 프롬프트(what-if)·라벨 (다음 실행에 적용)</summary>
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
            placeholder="임시 시스템 프롬프트 — 비우면 저장값(재정의 포함)으로 실행. 뼈대·상품 두 단계에 적용돼요."
            onChange={(event) => setOverride(event.target.value)}
          />
        </details>
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
                  disabled={running !== null || !c.survey || !(c.answers || []).length}
                  title={c.survey ? undefined : '설문·답변 스냅샷이 없어 실행할 수 없어요'}
                  onClick={() => run(c.id)}
                >
                  {running === c.id ? '실행 중…' : '✦ 실행'}
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
                    const dirty = draft.score !== r.score || draft.comment !== (r.comment || '')
                    return (
                      <li key={r.id} className="sb-exp-run">
                        <div className="sb-pipe-stage__title">
                          {r.score == null ? (
                            <span className="sb-admin-fb-badge">미채점</span>
                          ) : r.score === 0 ? (
                            <span className="sb-admin-fb-badge sb-admin-fb-badge--zero">0점</span>
                          ) : (
                            <span className="sb-admin-fb-stars" title={`${r.score}점`}>
                              {'★'.repeat(r.score)}
                              <span className="sb-admin-fb-stars__rest">{'★'.repeat(5 - r.score)}</span>
                            </span>
                          )}
                          {r.config?.label && <b>{r.config.label}</b>}
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
                            {r.page.headline} — 섹션 {r.page.sections.length}개
                          </p>
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
                            placeholder="코멘트"
                            value={draft.comment}
                            onChange={(event) =>
                              setScoreDraft((prev) => ({ ...prev, [r.id]: { ...draft, comment: event.target.value } }))
                            }
                          />
                          <button
                            type="button"
                            className="sb-btn sb-btn--primary sb-btn--tiny"
                            disabled={!dirty || draft.saving}
                            onClick={() => saveScore(r, c.id)}
                          >
                            {draft.saving ? '저장 중…' : '채점 저장'}
                          </button>
                        </div>
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
