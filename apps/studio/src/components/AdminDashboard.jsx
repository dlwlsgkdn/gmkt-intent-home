import React, { useMemo } from 'react'
import { loadTaggingReview, unitStatusKey } from '../lib/taggingCatalog.js'
import { statusLabel } from '../lib/adminReport.jsx'
import { TREND_KEYWORDS } from '../lib/trendKeywords.js'

const ADMIN_USER = 'ops-playground'

const pct = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

export default function AdminDashboard({ api, threads, feedback, loading, mode, onModeChange }) {
  const tagging = useMemo(() => loadTaggingReview(), [])
  const tagCounts = useMemo(() => tagging.reduce((out, unit) => {
    const key = unitStatusKey(unit)
    out[key] = (out[key] || 0) + 1
    return out
  }, {}), [tagging])

  const realThreads = threads.filter((thread) => thread.userId !== ADMIN_USER)
  const completed = realThreads.filter((thread) => thread.status === 'done').length
  const abandoned = realThreads.filter((thread) => thread.status === 'abandoned').length
  const published = api.scenarios.filter((scenario) => scenario.status === 'published')
  const drafts = api.scenarios.filter((scenario) => scenario.status !== 'published')
  const feedbackItems = feedback?.items || []
  const lowFeedback = feedbackItems.filter((entry) => {
    const scores = [entry.review?.score, ...(entry.components || []).map((item) => item.score)]
    return scores.some((score) => score != null && score <= 2)
  }).length
  const tagQueue = (tagCounts.unreviewed || 0) + (tagCounts.fix || 0)
  const approvedTags = tagCounts.approved || 0
  const activeThreads = realThreads.filter((thread) => !['done', 'abandoned', 'archived'].includes(thread.status)).length
  const completionRate = pct(completed, realThreads.length)
  const reviewRate = pct(approvedTags, tagging.length)

  const cards = mode === 'lab'
    ? [
        { value: tagQueue, label: '태깅 검토 대기', note: `전체 ${tagging.length}개 작업 단위`, tone: tagQueue ? 'warn' : 'good', tab: 'tagging', icon: '✓', progress: reviewRate },
        { value: feedbackItems.length, label: '평가 제출', note: `낮은 평가 ${lowFeedback}건`, tone: lowFeedback ? 'warn' : 'good', tab: 'threads', icon: '★', progress: pct(feedbackItems.length - lowFeedback, feedbackItems.length) },
        { value: drafts.length, label: '작성 중 시나리오', note: `발행 ${published.length}개`, tab: 'studio', icon: '◆', progress: pct(published.length, api.scenarios.length) },
        { value: TREND_KEYWORDS.length, label: '트렌드 키워드', note: '뷰티 트렌드 사전', tab: 'knowledge', icon: '↗', progress: 100 },
      ]
    : [
        { value: realThreads.length, label: '실사용자 여정', note: loading ? '불러오는 중…' : `완료율 ${completionRate}%`, tab: 'threads', icon: '↗', progress: completionRate },
        { value: published.length, label: '운영 시나리오', note: `작성 중 ${drafts.length}개`, tab: 'studio', icon: '◆', progress: pct(published.length, api.scenarios.length) },
        { value: abandoned, label: '이탈 쓰레드', note: `이탈률 ${pct(abandoned, realThreads.length)}%`, tone: abandoned ? 'warn' : 'good', tab: 'threads', icon: '!', progress: pct(abandoned, realThreads.length) },
        { value: lowFeedback, label: '확인할 낮은 평가', note: `전체 제출 ${feedbackItems.length}건`, tone: lowFeedback ? 'warn' : 'good', tab: 'threads', icon: '★', progress: pct(lowFeedback, feedbackItems.length) },
      ]

  const latestThreads = realThreads.slice(0, 5)
  const heroCount = mode === 'lab' ? tagQueue + drafts.length + lowFeedback : abandoned + lowFeedback
  const flowRows = mode === 'lab'
    ? [
        { label: '태그 검토 완료', value: approvedTags, total: tagging.length, tone: 'mint' },
        { label: '시나리오 발행', value: published.length, total: api.scenarios.length, tone: 'blue' },
        { label: '안정 평가', value: Math.max(0, feedbackItems.length - lowFeedback), total: feedbackItems.length, tone: 'violet' },
      ]
    : [
        { label: '진행 중', value: activeThreads, total: realThreads.length, tone: 'blue' },
        { label: '완료', value: completed, total: realThreads.length, tone: 'mint' },
        { label: '이탈', value: abandoned, total: realThreads.length, tone: 'coral' },
      ]

  return (
    <div className="sb-admin-dashboard">
      <header className="sb-admin-pagehead sb-admin-hero">
        <div className="sb-admin-hero__copy">
          <p className="sb-admin-pagehead__eyebrow">{mode === 'lab' ? '출시 전 검증' : '서비스 운영 인사이트'}</p>
          <h1>{mode === 'lab' ? '오늘도 빈틈없이 준비해요' : '고객의 흐름을 놓치지 마세요'}</h1>
          <p>{mode === 'lab' ? '검토가 필요한 항목과 다음 검증 과제를 한눈에 확인하세요.' : '서비스 실행 흐름의 막힘과 우선 확인할 품질 신호를 모았습니다.'}</p>
          <div className="sb-admin-hero__actions">
            <button type="button" className="sb-admin-cta" onClick={() => api.setAdminTab(mode === 'lab' ? (tagQueue ? 'tagging' : 'studio') : 'threads')}>
              {mode === 'lab' ? (tagQueue ? '태깅 검토 시작' : '시나리오 점검') : '고객 여정 확인'} <span>→</span>
            </button>
            <button type="button" className="sb-admin-hero__link" onClick={() => api.setAdminTab('pipeline')}>생성 흐름 보기</button>
          </div>
        </div>
        <div className="sb-admin-hero__visual" aria-hidden="true">
          <span className="sb-admin-hero__bubble">{heroCount > 0 ? <><b>{heroCount}개</b> 우선 확인</> : <><b>안정적</b> 긴급 신호 없음</>}</span>
          <div className="sb-admin-hero__diagram">
            <span><i>01</i><b>{mode === 'lab' ? '검토' : '유입'}</b><em /></span>
            <span><i>02</i><b>{mode === 'lab' ? '검증' : '설문'}</b><em /></span>
            <span><i>03</i><b>{mode === 'lab' ? '발행' : '완료'}</b></span>
          </div>
          <span className="sb-admin-hero__metric"><small>{mode === 'lab' ? '현재 준비도' : '여정 완료율'}</small><b>{mode === 'lab' ? Math.round((reviewRate + pct(published.length, api.scenarios.length)) / 2) : completionRate}%</b></span>
        </div>
        <span className={`sb-admin-health ${mode === 'lab' ? 'is-lab' : 'is-live'}`}><i /> {mode === 'lab' ? '검증 모드' : '운영 데이터'}</span>
      </header>

      <div className="sb-admin-dashboard__mode" role="tablist" aria-label="대시보드 보기">
        <button type="button" role="tab" aria-selected={mode === 'lab'} className={mode === 'lab' ? 'is-on' : ''} onClick={() => onModeChange('lab')}>
          <span>품질 관리</span><small>출시 전 검수와 준비 상태</small>
        </button>
        <button type="button" role="tab" aria-selected={mode === 'ops'} className={mode === 'ops' ? 'is-on' : ''} onClick={() => onModeChange('ops')}>
          <span>운영 인사이트</span><small>고객 행동과 이상 신호</small>
        </button>
      </div>

      <div className="sb-admin-kpis">
        {cards.map((card) => (
          <button key={card.label} type="button" className={`sb-admin-kpi${card.tone ? ` is-${card.tone}` : ''}`} onClick={() => api.setAdminTab(card.tab)}>
            <span className="sb-admin-kpi__top"><i>{card.icon}</i><b>자세히</b></span>
            <span className="sb-admin-kpi__value">{card.value}</span>
            <span className="sb-admin-kpi__label">{card.label}</span>
            <span className="sb-admin-kpi__note">{card.note}<b aria-hidden="true">→</b></span>
            <span className="sb-admin-kpi__track" aria-hidden="true"><i style={{ width: `${Math.max(4, card.progress)}%` }} /></span>
          </button>
        ))}
      </div>

      <section className="sb-admin-card sb-admin-signal-map">
        <div className="sb-admin-sectionhead">
          <div><h2>{mode === 'lab' ? '출시 준비 온도' : '고객 여정 흐름'}</h2><p>숫자만 읽지 않아도 현재 균형과 막힌 지점을 빠르게 파악할 수 있어요.</p></div>
          <span className="sb-admin-signal-map__legend"><i /> 현재 데이터 기준</span>
        </div>
        <div className="sb-admin-signal-map__body">
          <div className="sb-admin-signal-map__ring" style={{ '--progress': `${mode === 'lab' ? Math.round((reviewRate + pct(published.length, api.scenarios.length)) / 2) : completionRate}%` }}>
            <span><b>{mode === 'lab' ? Math.round((reviewRate + pct(published.length, api.scenarios.length)) / 2) : completionRate}%</b><small>{mode === 'lab' ? '준비도' : '완료율'}</small></span>
          </div>
          <div className="sb-admin-signal-map__bars">
            {flowRows.map((row) => (
              <div className={`sb-admin-signal-row is-${row.tone}`} key={row.label}>
                <span><b>{row.label}</b><small>{row.value} / {row.total}</small></span>
                <i><b style={{ width: `${Math.max(row.value ? 5 : 0, pct(row.value, row.total))}%` }} /></i>
              </div>
            ))}
          </div>
          <button type="button" className="sb-admin-signal-map__next" onClick={() => api.setAdminTab(mode === 'lab' ? 'studio' : 'threads')}>
            <i>{mode === 'lab' ? '◆' : '◎'}</i>
            <span><small>추천 다음 행동</small><b>{mode === 'lab' ? (drafts.length ? '작성 중 시나리오를 발행해요' : '새 품질 신호를 점검해요') : (abandoned ? '이탈 여정부터 살펴봐요' : '최근 고객 여정을 읽어봐요')}</b></span>
            <em>→</em>
          </button>
        </div>
      </section>

      <div className="sb-admin-dashboard__grid">
        <section className="sb-admin-card sb-admin-today">
          <div className="sb-admin-sectionhead">
            <div>
              <h2>{mode === 'lab' ? '오늘 먼저 검수할 일' : '운영 이상 신호'}</h2>
              <p>{mode === 'lab' ? '출시 전 확인할 작업을 우선순위대로 모았습니다.' : '고객이 멈추거나 불편을 표시한 지점을 모았습니다.'}</p>
            </div>
          </div>
          <div className="sb-admin-tasklist">
            {mode === 'lab' ? (
              <>
                {tagQueue > 0 && (
                  <button type="button" onClick={() => api.setAdminTab('tagging')}>
                    <span className="sb-admin-tasklist__icon is-warn">⊞</span>
                    <span><b>상품 태그 {tagQueue}건 검토</b><small>미검토·규칙 위반 항목을 승인하거나 수정하세요.</small></span>
                    <em>검토 시작</em>
                  </button>
                )}
                {drafts.length > 0 && (
                  <button type="button" onClick={() => api.setAdminTab('studio')}>
                    <span className="sb-admin-tasklist__icon">◇</span>
                    <span><b>작성 중 시나리오 {drafts.length}개 확인</b><small>내용을 검수하고 고객에게 보여줄 버전을 발행하세요.</small></span>
                    <em>스튜디오 열기</em>
                  </button>
                )}
                {tagQueue === 0 && (
                  <div className="sb-admin-empty-good"><b>대기 중인 태그 검수가 없습니다.</b><span>작성 중인 시나리오만 확인하면 됩니다.</span></div>
                )}
              </>
            ) : (
              <>
                {abandoned > 0 && (
                  <button type="button" onClick={() => api.setAdminTab('threads')}>
                    <span className="sb-admin-tasklist__icon is-warn">!</span>
                    <span><b>중간 이탈 {abandoned}건 확인</b><small>고객이 어느 단계에서 멈췄는지 확인하세요.</small></span>
                    <em>여정 보기</em>
                  </button>
                )}
                {lowFeedback > 0 && (
                  <button type="button" onClick={() => api.setAdminTab('threads')}>
                    <span className="sb-admin-tasklist__icon is-danger">!</span>
                    <span><b>낮은 평가 {lowFeedback}건 원인 확인</b><small>2점 이하 평가와 고객 의견을 확인하세요.</small></span>
                    <em>평가 보기</em>
                  </button>
                )}
                {abandoned === 0 && lowFeedback === 0 && (
                  <div className="sb-admin-empty-good"><b>우선 확인할 이상 신호가 없습니다.</b><span>새 고객 여정이 쌓이면 이곳에서 바로 알려드려요.</span></div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="sb-admin-card sb-admin-journey-card">
          <div className="sb-admin-sectionhead">
            <div>
              <h2>{mode === 'lab' ? '검증 준비 상태' : '최근 고객 여정'}</h2>
              <p>{mode === 'lab' ? '시나리오 작성과 발행 현황입니다.' : '실사용자 쓰레드 기준입니다.'}</p>
            </div>
            <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => api.setAdminTab(mode === 'lab' ? 'studio' : 'threads')}>
              {mode === 'lab' ? '스튜디오 열기' : '전체 보기'}
            </button>
          </div>
          {mode === 'lab' ? (
            <div className="sb-admin-empty-good">
              <b>발행 {published.length}개 · 작성 중 {drafts.length}개</b>
              <span>{drafts.length > 0 ? '작성 중인 시나리오를 검증하고 발행할 수 있어요.' : '모든 시나리오가 발행 준비를 마쳤습니다.'}</span>
            </div>
          ) : latestThreads.length === 0 ? (
            <p className="sb-admin__muted">아직 로드된 실사용자 쓰레드가 없어요.</p>
          ) : (
            <ol className="sb-admin-recent">
              {latestThreads.map((thread) => (
                <li key={thread.id}>
                  <span className={`sb-admin-status sb-admin-status--${thread.status}`}>{statusLabel(thread.status)}</span>
                  <span><b>{thread.title || thread.source?.query || '제목 없는 여정'}</b><small>{thread.userId}</small></span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {mode === 'lab' && (
        <section className="sb-admin-card sb-admin-release-flow">
          <div className="sb-admin-sectionhead"><div><h2>안전한 반영 흐름</h2><p>검증되지 않은 변경이 운영 환경에 바로 반영되지 않도록 단계별로 확인합니다.</p></div></div>
          <div className="sb-admin-release-flow__steps">
            {[
              ['1', '운영 지식 정리', '키워드·태그 기준'],
              ['2', '플레이그라운드', '실데이터 없는 단독 실행'],
              ['3', '실사용자 신호 확인', '쓰레드·피드백'],
              ['4', '운영 반영', '새 생성부터 적용'],
            ].map(([no, title, note], index) => (
              <React.Fragment key={no}>
                {index > 0 && <span className="sb-admin-release-flow__arrow">→</span>}
                <div><i>{no}</i><span><b>{title}</b><small>{note}</small></span></div>
              </React.Fragment>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
