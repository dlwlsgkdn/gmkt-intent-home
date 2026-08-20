import React, { useMemo } from 'react'
import { loadTaggingReview, unitStatusKey } from '../lib/taggingCatalog.js'
import { statusLabel } from '../lib/adminReport.jsx'
import { TREND_KEYWORDS } from '../lib/trendKeywords.js'

const ADMIN_USER = 'ops-playground'

const pct = (value, total) => (total > 0 ? Math.round((value / total) * 100) : 0)

export default function AdminDashboard({ api, threads, feedback, loading, mode }) {
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

  const cards = mode === 'lab'
    ? [
        { value: tagQueue, label: '태깅 검토 대기', note: `전체 ${tagging.length}개 작업 단위`, tone: tagQueue ? 'warn' : 'good', tab: 'tagging' },
        { value: feedbackItems.length, label: '평가 제출', note: `낮은 평가 ${lowFeedback}건`, tone: lowFeedback ? 'warn' : 'good', tab: 'threads' },
        { value: drafts.length, label: '작성 중 시나리오', note: `발행 ${published.length}개`, tab: 'experiment' },
        { value: TREND_KEYWORDS.length, label: '트렌드 키워드', note: '뷰티 트렌드 사전', tab: 'knowledge' },
      ]
    : [
        { value: realThreads.length, label: '실사용자 여정', note: loading ? '불러오는 중…' : `완료율 ${pct(completed, realThreads.length)}%`, tab: 'threads' },
        { value: published.length, label: '운영 시나리오', note: `작성 중 ${drafts.length}개`, tab: 'experiment' },
        { value: abandoned, label: '이탈 쓰레드', note: `이탈률 ${pct(abandoned, realThreads.length)}%`, tone: abandoned ? 'warn' : 'good', tab: 'threads' },
        { value: lowFeedback, label: '확인할 낮은 평가', note: `전체 제출 ${feedbackItems.length}건`, tone: lowFeedback ? 'warn' : 'good', tab: 'threads' },
      ]

  const latestThreads = realThreads.slice(0, 5)

  return (
    <div className="sb-admin-dashboard">
      <header className="sb-admin-pagehead">
        <div>
          <p className="sb-admin-pagehead__eyebrow">{mode === 'lab' ? '출시 전 검증' : '서비스 운영 인사이트'}</p>
          <h1>{mode === 'lab' ? '품질 관리 현황' : '운영 현황'}</h1>
          <p>{mode === 'lab' ? '검토가 필요한 항목과 다음 검증 과제를 한눈에 확인하세요.' : '서비스 실행 흐름의 막힘과 우선 확인할 품질 신호를 모았습니다.'}</p>
        </div>
        <span className={`sb-admin-health ${mode === 'lab' ? 'is-lab' : 'is-live'}`}>
          <i /> {mode === 'lab' ? '검증 모드' : '운영 데이터'}
        </span>
      </header>

      <div className="sb-admin-kpis">
        {cards.map((card) => (
          <button key={card.label} type="button" className={`sb-admin-kpi${card.tone ? ` is-${card.tone}` : ''}`} onClick={() => api.setAdminTab(card.tab)}>
            <span className="sb-admin-kpi__value">{card.value}</span>
            <span className="sb-admin-kpi__label">{card.label}</span>
            <span className="sb-admin-kpi__note">{card.note}<b aria-hidden="true">→</b></span>
          </button>
        ))}
      </div>

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
                <button type="button" onClick={() => api.setAdminTab('experiment')}>
                  <span className="sb-admin-tasklist__icon">◇</span>
                  <span><b>변경 전 회귀 실험</b><small>골든 케이스를 현재 설정으로 다시 실행하고 비교하세요.</small></span>
                  <em>실험 열기</em>
                </button>
                {tagQueue === 0 && (
                  <div className="sb-admin-empty-good"><b>대기 중인 태그 검수가 없습니다.</b><span>다음 반영 전 골든 케이스만 확인하면 됩니다.</span></div>
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
              ['3', '골든 케이스 실험', '회귀·자동 채점'],
              ['4', '실사용자 신호 확인', '쓰레드·피드백'],
              ['5', '운영 반영', '새 생성부터 적용'],
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
