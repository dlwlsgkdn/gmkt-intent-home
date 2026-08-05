import React, { useMemo, useState } from 'react'
import { timeAgo } from '../lib/timeAgo.js'

/*
 * 평가 모아보기 — 관리 페이지(#admin)의 피드백 대시보드 카드.
 * 데이터는 BFF `/api/admin/feedback` 한 응답(제출 1회 = 항목 1개, 최신순, latest=유효본)이고,
 * 집계(평균·분포·낮은 평가)는 여기서 latest 항목만으로 계산한다 — 페이지네이션이 없어
 * 전체가 실려 오기 때문(서버 상한에 걸리면 truncated 안내를 띄운다).
 * 별점 문법은 평가 스튜디오와 동일: null=미평가(회색)·0점(빨강)은 배지가 구분을 맡는다.
 */

const STAGE_LABEL = { survey: '설문', plan: '계획' }
const LOW_SCORE = 2

function fmtAvg(avg) {
  return avg == null ? '—' : `★ ${avg.toFixed(1)}`
}

/** 별점 1칸 — 평가 스튜디오와 같은 구분: null=미평가 배지, 0=빨간 0점 배지, 1~5=별 */
function Score({ score }) {
  if (score == null) return <span className="sb-admin-fb-badge">미평가</span>
  if (score === 0) return <span className="sb-admin-fb-badge sb-admin-fb-badge--zero">0점</span>
  return (
    <span className="sb-admin-fb-stars" title={`${score}점`}>
      {'★'.repeat(score)}
      <span className="sb-admin-fb-stars__rest">{'★'.repeat(5 - score)}</span>
    </span>
  )
}

function hasComment(entry) {
  return Boolean(entry.review.feedback) || entry.components.some((c) => c.feedback)
}

function isLowEntry(entry) {
  return (
    (entry.review.score != null && entry.review.score <= LOW_SCORE) ||
    entry.components.some((c) => c.score != null && c.score <= LOW_SCORE)
  )
}

/** latest(유효본) 항목만으로 요약 통계 — 단계별 평균·분포 + 낮은 평가 */
function buildStats(items) {
  const latest = items.filter((e) => e.latest)
  const perStage = {}
  for (const stage of ['survey', 'plan']) {
    const entries = latest.filter((e) => e.stage === stage)
    const scores = entries.map((e) => e.review.score).filter((s) => s != null)
    const compScores = entries
      .flatMap((e) => e.components.map((c) => c.score))
      .filter((s) => s != null)
    const dist = [0, 0, 0, 0, 0, 0]
    for (const s of scores) dist[s] += 1
    perStage[stage] = {
      count: entries.length,
      avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      compAvg: compScores.length ? compScores.reduce((a, b) => a + b, 0) / compScores.length : null,
      compCount: compScores.length,
      dist,
      distMax: Math.max(1, ...dist),
    }
  }
  return {
    threadCount: new Set(latest.map((e) => e.threadId)).size,
    submissionCount: items.length,
    lowCount: latest.filter(isLowEntry).length,
    perStage,
  }
}

function DistChart({ label, agg }) {
  if (agg.count === 0) return null
  return (
    <div className="sb-admin-fb-dist">
      <span className="sb-admin-fb-dist__label">{label}</span>
      {agg.dist.map((count, score) => (
        <span key={score} className="sb-admin-fb-dist__col" title={`${score}점 ${count}건`}>
          <span
            className={'sb-admin-fb-dist__bar' + (score <= LOW_SCORE ? ' sb-admin-fb-dist__bar--low' : '')}
            style={{ height: `${4 + Math.round((count / agg.distMax) * 26)}px` }}
          />
          <span className="sb-admin-fb-dist__tick">{score}</span>
        </span>
      ))}
    </div>
  )
}

export default function AdminFeedback({ wire, loading, error, onOpenThread }) {
  const [stageFilter, setStageFilter] = useState('all')
  const [includeOld, setIncludeOld] = useState(false)
  const [commentedOnly, setCommentedOnly] = useState(false)
  const [expanded, setExpanded] = useState(null) // `${threadId}:${seq}`

  const items = wire ? wire.items : []
  const stats = useMemo(() => buildStats(items), [items])

  const visible = useMemo(
    () =>
      items.filter(
        (e) =>
          (includeOld || e.latest) &&
          (stageFilter === 'all' || e.stage === stageFilter) &&
          (!commentedOnly || hasComment(e))
      ),
    [items, includeOld, stageFilter, commentedOnly]
  )

  return (
    <div className="sb-admin-card">
      <p className="sb-panel-label">평가 모아보기</p>

      {error && <p className="sb-admin-gate__error">{error}</p>}
      {loading && !wire && <p className="sb-admin__muted">평가 데이터를 불러오는 중…</p>}

      {wire && items.length === 0 && (
        <p className="sb-table__empty">
          아직 평가 제출이 없어요. 라이브 생성 체험의 「💬 평가」에서 제출하면 여기에 쌓여요.
        </p>
      )}

      {wire && items.length > 0 && (
        <>
          {/* 요약 타일 — latest(유효본) 기준 */}
          <div className="sb-admin-fb-tiles">
            <div className="sb-admin-fb-tile">
              <span className="sb-admin-fb-tile__num">{stats.threadCount}</span>
              <span className="sb-admin-fb-tile__label">평가된 쓰레드 · 제출 {stats.submissionCount}건</span>
            </div>
            {['survey', 'plan'].map((stage) => {
              const agg = stats.perStage[stage]
              return (
                <div key={stage} className="sb-admin-fb-tile">
                  <span className="sb-admin-fb-tile__num">{fmtAvg(agg.avg)}</span>
                  <span className="sb-admin-fb-tile__label">
                    {STAGE_LABEL[stage]} 페이지 전체 평균 · {agg.count}건
                    {agg.compAvg != null ? ` (컴포넌트 ${fmtAvg(agg.compAvg)}·${agg.compCount}개)` : ''}
                  </span>
                </div>
              )
            })}
            <div className={'sb-admin-fb-tile' + (stats.lowCount > 0 ? ' sb-admin-fb-tile--low' : '')}>
              <span className="sb-admin-fb-tile__num">{stats.lowCount}</span>
              <span className="sb-admin-fb-tile__label">낮은 평가(≤{LOW_SCORE}★) 포함 제출</span>
            </div>
          </div>

          {/* 별점 분포 — 페이지 전체(review) 별점, latest 기준 */}
          <div className="sb-admin-fb-dists">
            <DistChart label="설문" agg={stats.perStage.survey} />
            <DistChart label="계획" agg={stats.perStage.plan} />
          </div>

          {/* 필터 */}
          <div className="sb-admin-fb-filters">
            <div className="sb-admin-fb-seg" role="group" aria-label="단계 필터">
              {[
                ['all', '전체'],
                ['survey', '설문'],
                ['plan', '계획'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={'sb-admin-fb-seg__btn' + (stageFilter === value ? ' is-on' : '')}
                  onClick={() => setStageFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="sb-admin-fb-check">
              <input
                type="checkbox"
                checked={commentedOnly}
                onChange={(event) => setCommentedOnly(event.target.checked)}
              />
              코멘트 있는 것만
            </label>
            <label className="sb-admin-fb-check">
              <input
                type="checkbox"
                checked={includeOld}
                onChange={(event) => setIncludeOld(event.target.checked)}
              />
              이전 제출 포함
            </label>
            {wire.truncated && <span className="sb-admin__muted">서버 상한에 걸려 최근 제출만 보여요.</span>}
          </div>

          {/* 제출 목록 — 행 클릭 = 펼침 */}
          <div className="sb-table sb-admin-table">
            <div className="sb-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th>시각</th>
                    <th>쓰레드</th>
                    <th>단계</th>
                    <th>페이지 전체</th>
                    <th>컴포넌트</th>
                    <th>코멘트</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => {
                    const key = `${entry.threadId}:${entry.seq}`
                    const isOpen = expanded === key
                    const scored = entry.components.filter((c) => c.score != null)
                    const compAvg = scored.length
                      ? scored.reduce((a, c) => a + c.score, 0) / scored.length
                      : null
                    const excerpt = entry.review.feedback || (entry.components.find((c) => c.feedback) || {}).feedback || ''
                    return (
                      <React.Fragment key={key}>
                        <tr
                          className={
                            'sb-admin-fb-row' +
                            (entry.latest ? '' : ' sb-admin-fb-row--old') +
                            (isOpen ? ' is-open' : '')
                          }
                          onClick={() => setExpanded(isOpen ? null : key)}
                        >
                          <td title={entry.at}>{timeAgo(entry.at, { empty: '—' })}</td>
                          <td className="sb-admin-table__title" title={entry.threadId}>
                            {entry.title || entry.threadId}
                            {entry.threadStatus === 'archived' && (
                              <span className="sb-admin-status sb-admin-status--archived">보관됨</span>
                            )}
                          </td>
                          <td>
                            <span className={`sb-admin-stage sb-admin-stage--${entry.stage}`}>
                              {STAGE_LABEL[entry.stage]}
                            </span>
                            {!entry.latest && <span className="sb-admin-fb-badge">이전</span>}
                          </td>
                          <td><Score score={entry.review.score} /></td>
                          <td>
                            {entry.components.length === 0 ? (
                              <span className="sb-admin__muted">—</span>
                            ) : (
                              <span className={isLowEntry(entry) ? 'sb-admin-fb-low' : undefined}>
                                {entry.components.length}개{compAvg != null ? ` · ${fmtAvg(compAvg)}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="sb-admin-fb-excerpt" title={excerpt}>{excerpt || '—'}</td>
                        </tr>
                        {isOpen && (
                          <tr className="sb-admin-fb-detail">
                            <td colSpan={6}>
                              <div className="sb-admin-fb-detail__body">
                                <div className="sb-admin-fb-detail__row">
                                  <span className="sb-admin-fb-detail__label">페이지 전체</span>
                                  <Score score={entry.review.score} />
                                  {entry.review.feedback && <span>“{entry.review.feedback}”</span>}
                                </div>
                                {entry.components.map((c) => (
                                  <div key={c.id} className="sb-admin-fb-detail__row">
                                    <span className="sb-admin-fb-detail__label" title={c.id}>{c.label}</span>
                                    <Score score={c.score} />
                                    {c.feedback && <span>“{c.feedback}”</span>}
                                  </div>
                                ))}
                                <div className="sb-admin-fb-detail__foot">
                                  <span className="sb-admin__muted">
                                    사용자 <code>{entry.userId}</code> · 스텝 seq {entry.seq}
                                  </span>
                                  <button
                                    type="button"
                                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onOpenThread(entry.threadId)
                                    }}
                                  >
                                    쓰레드 열람
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p className="sb-table__empty">조건에 맞는 제출이 없어요. 필터를 풀어보세요.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
