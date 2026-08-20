import React, { useMemo } from 'react'
import { statusLabel } from '../lib/adminReport.jsx'
import { timeAgo } from '../lib/timeAgo.js'

const ADMIN_USER = 'ops-playground'
const ACTIVE_STATUSES = new Set(['exploring', 'surveying', 'planning'])

const pct = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

function lowFeedback(entry) {
  const scores = [entry.review?.score, ...(entry.components || []).map((component) => component.score)]
  return scores.some((score) => score != null && score <= 2)
}

export default function AdminJourneyOverview({ threads, feedback, loading, onOpenThread, onFilterStatus }) {
  const insights = useMemo(() => {
    const userThreads = threads.filter((thread) => thread.userId !== ADMIN_USER && thread.status !== 'archived')
    const completed = userThreads.filter((thread) => thread.status === 'done')
    const abandoned = userThreads.filter((thread) => thread.status === 'abandoned')
    const active = userThreads.filter((thread) => ACTIVE_STATUSES.has(thread.status))
    const feedbackItems = (feedback?.items || []).filter((entry) => entry.latest && entry.userId !== ADMIN_USER)
    const evaluatedIds = new Set(feedbackItems.map((entry) => entry.threadId))
    const lowIds = new Set(feedbackItems.filter(lowFeedback).map((entry) => entry.threadId))
    const byId = new Map(userThreads.map((thread) => [thread.id, thread]))
    const lowThreads = [...lowIds].map((id) => byId.get(id)).filter(Boolean)
    const staleAt = Date.now() - 24 * 60 * 60 * 1000
    const stale = active.filter((thread) => {
      const at = new Date(thread.updatedAt).getTime()
      return Number.isFinite(at) && at < staleAt
    })

    const funnel = [
      { key: 'exploring', label: '탐색 진입', value: userThreads.length },
      { key: 'surveying', label: '설문 도달', value: userThreads.filter((thread) => ['surveying', 'planning', 'done'].includes(thread.status)).length },
      { key: 'planning', label: '계획 도달', value: userThreads.filter((thread) => ['planning', 'done'].includes(thread.status)).length },
      { key: 'done', label: '완료', value: completed.length },
    ]

    const intents = new Map()
    for (const thread of userThreads) {
      const label = thread.title || thread.source?.query || '의도 미기록'
      intents.set(label, (intents.get(label) || 0) + 1)
    }
    const topIntents = [...intents.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'ko'))
      .slice(0, 5)

    const priorities = [
      ...lowThreads.slice(0, 3).map((thread) => ({
        key: `low:${thread.id}`,
        tone: 'danger',
        label: '낮은 평가',
        title: thread.title || thread.source?.query || thread.id,
        note: '2점 이하 평가가 있어 원문 확인이 필요해요.',
        thread,
      })),
      ...abandoned.slice(0, Math.max(0, 3 - lowThreads.length)).map((thread) => ({
        key: `drop:${thread.id}`,
        tone: 'warn',
        label: '여정 이탈',
        title: thread.title || thread.source?.query || thread.id,
        note: `${timeAgo(thread.updatedAt, { empty: '시각 미기록' })}에 이탈했어요.`,
        thread,
      })),
      ...stale.slice(0, Math.max(0, 3 - lowThreads.length - abandoned.length)).map((thread) => ({
        key: `stale:${thread.id}`,
        tone: 'info',
        label: '24시간 정체',
        title: thread.title || thread.source?.query || thread.id,
        note: `${statusLabel(thread.status)} 단계에서 진행이 멈췄어요.`,
        thread,
      })),
    ].slice(0, 3)

    return {
      userThreads,
      completed,
      abandoned,
      active,
      evaluatedIds,
      lowIds,
      funnel,
      topIntents,
      priorities,
    }
  }, [threads, feedback])

  const total = insights.userThreads.length

  return (
    <div className="sb-journey-overview">
      <header className="sb-admin-pagehead sb-journey-overview__head">
        <div>
          <p className="sb-admin-pagehead__eyebrow">실사용자 흐름과 품질 신호</p>
          <h1>고객 여정·평가</h1>
          <p>어디에서 멈추고 무엇을 불편해하는지 확인한 뒤, 고칠 순서대로 처리해요.</p>
        </div>
        <span className="sb-admin-health is-live"><i /> {loading ? '데이터 불러오는 중' : `${total}개 여정 분석`}</span>
      </header>

      <div className="sb-journey-kpis" aria-label="고객 여정 핵심 지표">
        <button type="button" onClick={() => onFilterStatus('done')}>
          <b>{pct(insights.completed.length, total)}%</b><span>완료율</span><small>{insights.completed.length}/{total}개 완료</small>
        </button>
        <button type="button" className={insights.abandoned.length ? 'is-warn' : ''} onClick={() => onFilterStatus('abandoned')}>
          <b>{pct(insights.abandoned.length, total)}%</b><span>이탈률</span><small>{insights.abandoned.length}개 확인 필요</small>
        </button>
        <button type="button" onClick={() => onFilterStatus('all')}>
          <b>{pct(insights.evaluatedIds.size, total)}%</b><span>평가 수집률</span><small>{insights.evaluatedIds.size}개 여정 평가됨</small>
        </button>
        <button type="button" className={insights.lowIds.size ? 'is-danger' : ''} onClick={() => onFilterStatus('all')}>
          <b>{insights.lowIds.size}</b><span>낮은 평가</span><small>2점 이하 포함 여정</small>
        </button>
      </div>

      <div className="sb-journey-overview__grid">
        <section className="sb-admin-card sb-journey-funnel">
          <div className="sb-admin-sectionhead"><div><h2>여정 퍼널</h2><p>실사용자가 어느 단계까지 도달했는지 보여줍니다.</p></div></div>
          <div className="sb-journey-funnel__steps">
            {insights.funnel.map((stage, index) => {
              const previous = index === 0 ? stage.value : insights.funnel[index - 1].value
              const drop = Math.max(0, previous - stage.value)
              return (
                <React.Fragment key={stage.key}>
                  {index > 0 && <span className="sb-journey-funnel__drop">−{drop}</span>}
                  <button type="button" onClick={() => onFilterStatus(index === 0 ? 'all' : stage.key)}>
                    <b>{stage.value}</b><span>{stage.label}</span><small>{pct(stage.value, total)}%</small>
                  </button>
                </React.Fragment>
              )
            })}
          </div>
          <div className="sb-journey-funnel__bar" aria-hidden="true">
            {insights.funnel.map((stage) => <i key={stage.key} style={{ width: `${pct(stage.value, total)}%` }} />)}
          </div>
        </section>

        <section className="sb-admin-card sb-journey-priority">
          <div className="sb-admin-sectionhead"><div><h2>먼저 확인할 여정</h2><p>낮은 평가 → 이탈 → 장기 정체 순서입니다.</p></div></div>
          {insights.priorities.length === 0 ? (
            <div className="sb-admin-empty-good"><b>급한 문제가 없습니다.</b><span>새 평가와 이탈 기록이 생기면 여기에 표시돼요.</span></div>
          ) : (
            <div className="sb-journey-priority__list">
              {insights.priorities.map((item) => (
                <button key={item.key} type="button" onClick={() => onOpenThread(item.thread.id)}>
                  <span className={`is-${item.tone}`}>{item.label}</span>
                  <b>{item.title}</b>
                  <small>{item.note}</small>
                  <i aria-hidden="true">→</i>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="sb-admin-card sb-journey-intents">
          <div className="sb-admin-sectionhead"><div><h2>많이 들어온 의도</h2><p>검색어·여정 제목 기준 상위 항목입니다.</p></div></div>
          {insights.topIntents.length === 0 ? (
            <p className="sb-admin__muted">아직 실사용자 검색 기록이 없어요.</p>
          ) : (
            <ol>
              {insights.topIntents.map((intent, index) => (
                <li key={intent.label}><span>{index + 1}</span><b>{intent.label}</b><em>{intent.count}건</em></li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}
