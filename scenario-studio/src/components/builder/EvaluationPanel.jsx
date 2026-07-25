import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  componentEvaluationStructureForCase,
  evaluationCasesFor,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  structuredComponentEvaluationStats,
} from '../../lib/evaluation.js'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'
import LlmRevisionDialog from './LlmRevisionDialog.jsx'

const SCORE_GUIDE = [
  { score: 5, title: '완벽 · 그대로 사용', desc: '수정하거나 추가할 의견이 전혀 없습니다.' },
  { score: 4, title: '충분히 좋음 · 더 나은 대안 있음', desc: '오류는 없지만 추가 아이디어나 더 좋은 대안이 있습니다.' },
  { score: 3, title: '방향은 맞음 · 일부 수정 필요', desc: '중요한 정보가 부족하거나 일부 내용을 수정해야 합니다.' },
  { score: 2, title: '핵심 오류·누락', desc: '일부는 맞지만 상당한 수정이 필요합니다.' },
  { score: 1, title: '거의 다시 작성', desc: '대부분 부정확하거나 적절하지 않습니다.' },
  { score: 0, title: '사용 불가', desc: '결과가 없거나 완전히 잘못되었습니다.' },
]

function ScorePicker({ value, onChange, label }) {
  return (
    <div className="sb-qa-score-picker" role="group" aria-label={`${label} 점수`}>
      {[0, 1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={
            'sb-qa-score'
            + (value === score ? ' sb-qa-score--active' : '')
            + (score === 5 ? ' sb-qa-score--best' : '')
          }
          aria-label={`${label} ${score}점`}
          aria-pressed={value === score}
          title={SCORE_GUIDE.find((guide) => guide.score === score)?.title}
          onClick={() => onChange(score)}
        >
          {score}
        </button>
      ))}
    </div>
  )
}

function Rubric({ onClose }) {
  return (
    <section className="sb-qa-rubric" aria-label="0~5점 평가 기준">
      <div className="sb-qa-rubric__head">
        <div>
          <span>SCORING RUBRIC</span>
          <h3>0~5점 평가 기준</h3>
        </div>
        <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="평가 기준 닫기">×</button>
      </div>
      <div className="sb-qa-rubric__distinction">
        <strong>5점과 4점의 차이</strong>
        <span><b>5점</b> 수정·추가 의견이 전혀 없음</span>
        <span><b>4점</b> 틀린 것은 없지만 더 좋은 대안·추가 아이디어가 있음</span>
      </div>
      <div className="sb-qa-rubric__grid">
        {SCORE_GUIDE.map((guide) => (
          <div key={guide.score} className={`sb-qa-rubric__row sb-qa-rubric__row--${guide.score}`}>
            <strong>{guide.score}점</strong>
            <div>
              <b>{guide.title}</b>
              <p>{guide.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const scoreHint = (review) => {
  if (review.score === 5 && review.feedback.trim()) {
    return { tone: 'warning', text: '5점은 수정·추가 의견이 전혀 없는 결과예요. 수정사항을 비워주세요.' }
  }
  if (review.score === 4 && !review.feedback.trim()) {
    return { tone: 'info', text: '4점이라면 더 좋은 대안이나 추가 아이디어를 수정사항에 남겨주세요.' }
  }
  if (review.score != null && review.score <= 3 && !review.feedback.trim()) {
    return { tone: 'info', text: '보강할 오류·누락·대안 문구를 수정사항에 남기면 바로 반영할 수 있어요.' }
  }
  return null
}

class EvaluationPreviewBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(previousProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="sb-qa-live-preview__fallback">
          이 컴포넌트의 미리보기를 표시할 수 없습니다. 평가는 계속할 수 있어요.
        </div>
      )
    }
    return this.props.children
  }
}

function EvaluationPreviewRenderer({ item, context }) {
  return renderItem(item, context)
}

function EvaluationComponentPreview({ planCase, component, profile, summaryPreview }) {
  const item = component.item
  const def = LIBRARY[item.type]
  const safeSummaryPreview = {
    profile: Array.isArray(summaryPreview?.profile) ? summaryPreview.profile : [],
    questions: Array.isArray(summaryPreview?.questions) ? summaryPreview.questions : [],
  }
  const previewCtx = {
    mode: 'canvas',
    canvasView: 'preview',
    allItems: planCase?.items || [],
    selectedIds: [],
    chips: [],
    profile: profile || { name: '사용자', items: [] },
    summaryPreview: safeSummaryPreview,
    updateProps: () => {},
    player: {
      query: '',
      setQuery: () => {},
      submitQuery: () => {},
      answers: {},
      setAnswer: () => {},
      excludedProfile: [],
      toggleProfileItem: () => {},
      summary: safeSummaryPreview,
      addToCart: () => {},
      openExternal: () => {},
      showKeyword: () => {},
      complete: () => {},
    },
  }

  return (
    <div className={`sb-qa-live-preview sb-qa-live-preview--component sb-qa-live-preview--${item.type}`}>
      <div className="sb-qa-live-preview__head">
        <span>ACTUAL COMPONENT</span>
        <em>{def?.icon} {def?.label || item.type} 전체</em>
      </div>
      <div className="sb-qa-live-preview__viewport" aria-label={`${def?.label || item.type} 실제 컴포넌트 미리보기`}>
        <div
          className="sb-qa-live-preview__item"
          style={{ width: item.w ? Math.min(item.w, 520) : '100%', maxWidth: '100%' }}
        >
          <EvaluationPreviewBoundary resetKey={`${item.id}:${item.type}`}>
            <EvaluationPreviewRenderer item={item} context={previewCtx} />
          </EvaluationPreviewBoundary>
        </div>
      </div>
      <p className="sb-qa-live-preview__caption">{component.preview}</p>
    </div>
  )
}

function ComponentReview({
  planCase,
  component,
  slot,
  review,
  onUpdateComponent,
  onEditComponent,
  profile,
  summaryPreview,
  product = false,
}) {
  const def = LIBRARY[component.type]
  const hint = scoreHint(review)
  const label = def?.label || component.type
  return (
    <section
      className={
        'sb-qa-review'
        + (product ? ' sb-qa-review--product' : '')
        + (review.score != null ? ' sb-qa-review--scored' : '')
      }
    >
      <div className="sb-qa-review__source">
        <div className="sb-qa-review__label">
          <span>{component.index + 1}</span>
          <strong>{def?.icon} {label}</strong>
          {review.resolved && <em>반영 완료</em>}
        </div>
        <EvaluationComponentPreview
          planCase={planCase}
          component={component}
          profile={profile}
          summaryPreview={summaryPreview}
        />
      </div>

      <div className="sb-qa-review__input">
        <div className="sb-qa-review__score-row">
          <span>점수</span>
          <ScorePicker
            value={review.score}
            label={`CASE ${slot} ${label}`}
            onChange={(score) => onUpdateComponent(planCase.id, component.itemId, { score })}
          />
          <strong>{review.score == null ? '미평가' : `${review.score}점`}</strong>
        </div>
        <label>
          <span>컴포넌트 수정사항</span>
          <textarea
            rows={3}
            value={review.feedback}
            placeholder={`${label} 전체를 기준으로 오류, 누락, 더 좋은 대안과 수정 내용을 기록하세요.`}
            onChange={(event) => onUpdateComponent(planCase.id, component.itemId, {
              feedback: event.target.value,
              resolved: false,
            })}
          />
        </label>
        {hint && <p className={`sb-qa-review__hint sb-qa-review__hint--${hint.tone}`}>{hint.text}</p>}
        <div className="sb-qa-review__actions">
          <span>{review.updatedAt ? '자동 저장됨' : '입력 대기'}</span>
          <button
            type="button"
            className="sb-btn sb-btn--ghost"
            onClick={() => onEditComponent(planCase.id, component)}
          >
            컴포넌트 수정
          </button>
          <button
            type="button"
            className={review.resolved ? 'sb-btn sb-btn--compact-on' : 'sb-btn'}
            disabled={!review.feedback.trim()}
            onClick={() => onUpdateComponent(planCase.id, component.itemId, { resolved: !review.resolved })}
          >
            {review.resolved ? '✓ 반영 완료' : '반영 완료 표시'}
          </button>
        </div>
      </div>
    </section>
  )
}

function ProductReviewTrack({ children, count }) {
  const trackRef = useRef(null)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return undefined
    const onWheel = (event) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      const max = Math.max(0, track.scrollWidth - track.clientWidth)
      const next = Math.max(0, Math.min(max, track.scrollLeft + delta))
      if (next === track.scrollLeft) return
      event.preventDefault()
      track.scrollLeft = next
    }
    track.addEventListener('wheel', onWheel, { passive: false })
    return () => track.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (event) => {
    const track = trackRef.current
    if (
      !track
      || event.pointerType !== 'mouse'
      || event.button !== 0
      || event.target.closest('button, input, textarea, label')
    ) return
    const startX = event.clientX
    const startScroll = track.scrollLeft
    let moved = false
    const move = (nextEvent) => {
      const delta = nextEvent.clientX - startX
      if (Math.abs(delta) > 4) moved = true
      if (moved) track.scrollLeft = startScroll - delta
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    trackRef.current?.scrollBy({
      left: event.key === 'ArrowLeft' ? -520 : 520,
      behavior: 'smooth',
    })
  }

  return (
    <div className="sb-qa-product-reviews">
      <div className="sb-qa-product-reviews__head">
        <div>
          <strong>추천 상품 컴포넌트 {count}개</strong>
          <small>각 상품 카드를 독립적으로 평가합니다.</small>
        </div>
        <span>← 드래그 · 휠 · 방향키 →</span>
      </div>
      <div
        ref={trackRef}
        className="sb-qa-product-reviews__track"
        tabIndex={0}
        role="region"
        aria-label={`추천 상품 컴포넌트 ${count}개 가로 목록`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

export default function EvaluationPanel({
  planCases,
  activeCaseId,
  onSelectCase,
  onRecommend,
  onUpdateComponent,
  onEditCase,
  onEditComponent,
  onApplyLlmRevisions,
  onToast,
  profile,
  summaryPreview,
}) {
  const [rubricOpen, setRubricOpen] = useState(false)
  const [llmDialogOpen, setLlmDialogOpen] = useState(false)
  const selectedCases = evaluationCasesFor(planCases)
  const stats = structuredComponentEvaluationStats(planCases)
  const activeSelected = selectedCases.find((planCase) => planCase.id === activeCaseId)
  const [activeSlot, setActiveSlot] = useState(
    () => normalizeCaseEvaluation(activeSelected?.evaluation).slot || 'A'
  )

  useEffect(() => {
    const slot = normalizeCaseEvaluation(activeSelected?.evaluation).slot
    if (slot) setActiveSlot(slot)
  }, [activeCaseId, activeSelected])

  const activeCaseStat = stats.caseStats.find((caseStat) => caseStat.slot === activeSlot)
    || stats.caseStats[0]
  const activeCase = activeCaseStat?.planCase || null
  const activeEvaluation = normalizeCaseEvaluation(activeCase?.evaluation)
  const structure = useMemo(
    () => componentEvaluationStructureForCase(activeCase),
    [activeCase]
  )

  const chooseCase = (caseStat) => {
    setActiveSlot(caseStat.slot)
    if (caseStat.planCase) onSelectCase(caseStat.planCase.id)
  }

  const rerunRecommendation = () => {
    if (stats.completed > 0) {
      const ok = window.confirm(
        '평가할 CASE A/B/C를 다시 선정할까요?\n현재 케이스에 작성한 평가는 보존되지만 새 선정 화면에서는 빠질 수 있어요.'
      )
      if (!ok) return
    }
    onRecommend()
  }

  if (selectedCases.length < 3) {
    return (
      <main className="sb-evaluation sb-qa-setup">
        <span className="sb-qa-setup__mark">QA</span>
        <p className="sb-panel-label">EVALUATION STUDIO</p>
        <h2>평가할 CASE A / B / C를 준비하고 있어요.</h2>
        <p>전체 계획 케이스 중 품질과 조건 다양성이 높은 3개를 자동으로 선정합니다.</p>
        <button type="button" className="sb-btn sb-btn--primary" onClick={onRecommend}>
          대표 3개 CASE 선정
        </button>
      </main>
    )
  }

  return (
    <main className="sb-evaluation sb-qa">
      <section className="sb-qa-intro">
        <div>
          <p className="sb-panel-label">COMPONENT-LEVEL RESULT QA</p>
          <h2>Evaluation Studio</h2>
          <p>대표 CASE 3개의 실제 콘텐츠 컴포넌트를 인스턴스별로 한 번씩 평가하고 수정합니다.</p>
        </div>
        <div className="sb-qa-intro__actions">
          <button type="button" className="sb-btn sb-btn--ai" onClick={() => setLlmDialogOpen(true)}>
            ✦ AI 수정 요청
          </button>
          <button type="button" className="sb-btn" onClick={rerunRecommendation}>CASE A/B/C 다시 선정</button>
        </div>
      </section>

      <section className="sb-qa-sticky" aria-label="전체 평가 현황">
        <div className="sb-qa-progress">
          <div
            className="sb-qa-progress__ring"
            style={{ '--sb-qa-progress': `${stats.progress * 3.6}deg` }}
            aria-label={`평가 진행률 ${stats.progress}%`}
          >
            <strong>{stats.progress}%</strong>
          </div>
          <div>
            <span>전체 진행률</span>
            <strong>{stats.completed} / {stats.total} 컴포넌트</strong>
          </div>
        </div>
        <div className="sb-qa-metric">
          <span>총점</span>
          <strong>{stats.score}<small> / {stats.maxScore}</small></strong>
        </div>
        <div className="sb-qa-metric">
          <span>평균점수</span>
          <strong>{stats.average == null ? '—' : stats.average.toFixed(1)}<small> / 5</small></strong>
        </div>
        <div className="sb-qa-autosave">
          <span>✓</span>
          <div><strong>자동 저장</strong><small>컴포넌트 ID별로 현재 프로필에 보관</small></div>
        </div>
        <button
          type="button"
          className={'sb-btn sb-qa-rubric-toggle' + (rubricOpen ? ' sb-btn--open' : '')}
          onClick={() => setRubricOpen((open) => !open)}
        >
          0~5 평가 기준
        </button>
      </section>

      {rubricOpen && <Rubric onClose={() => setRubricOpen(false)} />}

      <section className="sb-qa-case-tabs" role="tablist" aria-label="평가 케이스">
        {stats.caseStats.map((caseStat) => (
          <button
            key={caseStat.slot}
            type="button"
            role="tab"
            aria-selected={activeSlot === caseStat.slot}
            className={'sb-qa-case-tab' + (activeSlot === caseStat.slot ? ' sb-qa-case-tab--active' : '')}
            onClick={() => chooseCase(caseStat)}
          >
            <span>CASE {caseStat.slot}</span>
            <strong>{caseStat.planCase?.name || '케이스 준비 중'}</strong>
            <small>{caseStat.completed}/{caseStat.total} 완료 · {caseStat.score}/{caseStat.maxScore}점</small>
          </button>
        ))}
      </section>

      <section className="sb-qa-target-stats" aria-label="컴포넌트 유형별 평균">
        <div className="sb-qa-target-stats__title">
          <span>컴포넌트 유형별 평균</span>
          <small>낮은 유형부터 보강하세요</small>
        </div>
        {stats.typeStats.map((target) => (
          <div key={target.type} className="sb-qa-target-stat">
            <span>{LIBRARY[target.type]?.icon} {LIBRARY[target.type]?.label || target.type}</span>
            <div><i style={{ width: `${((target.average || 0) / 5) * 100}%` }} /></div>
            <strong>{target.average == null ? '—' : target.average.toFixed(1)}</strong>
          </div>
        ))}
      </section>

      <section className="sb-qa-case">
        <div className="sb-qa-case__head">
          <div className="sb-qa-case__identity">CASE {activeSlot}</div>
          <div>
            <h3>{activeCase?.name || '평가 케이스'}</h3>
            <p>실제 콘텐츠 컴포넌트 {activeCaseStat?.total || 0}개 · 최대 {activeCaseStat?.maxScore || 0}점</p>
          </div>
          {activeCase && (
            <button type="button" className="sb-btn" onClick={() => onEditCase(activeCase.id)}>
              전체 결과 화면 열기
            </button>
          )}
        </div>

        <div className="sb-qa-steps">
          {structure.map((section) => {
            const sectionStat = activeCaseStat?.sectionStats.find((stat) => stat.key === section.key)
            const regularComponents = section.components.filter((component) => component.type !== 'productCard')
            const productComponents = section.components.filter((component) => component.type === 'productCard')
            return (
              <article key={section.key} className="sb-qa-step">
                <div className="sb-qa-step__head">
                  <div className="sb-qa-step__number">{section.step || '•'}</div>
                  <div>
                    <span>{section.step ? `STEP ${section.step}` : 'COMMON'}</span>
                    <strong>{section.title}</strong>
                  </div>
                  <div className="sb-qa-step__score">
                    <span>{sectionStat?.completed || 0}/{sectionStat?.total || 0} 완료</span>
                    <strong>{sectionStat?.score || 0}<small>/{sectionStat?.maxScore || 0}</small></strong>
                  </div>
                </div>

                {regularComponents.length > 0 && (
                  <div className="sb-qa-review-list">
                    {regularComponents.map((component) => (
                      <ComponentReview
                        key={component.itemId}
                        planCase={activeCase}
                        component={component}
                        slot={activeSlot}
                        review={normalizeComponentEvaluation(activeEvaluation.components[component.itemId])}
                        onUpdateComponent={onUpdateComponent}
                        onEditComponent={onEditComponent}
                        profile={profile}
                        summaryPreview={summaryPreview}
                      />
                    ))}
                  </div>
                )}

                {productComponents.length > 0 && (
                  <ProductReviewTrack count={productComponents.length}>
                    {productComponents.map((component) => (
                      <div key={component.itemId} className="sb-qa-product-reviews__slide">
                        <ComponentReview
                          planCase={activeCase}
                          component={component}
                          slot={activeSlot}
                          product
                          review={normalizeComponentEvaluation(activeEvaluation.components[component.itemId])}
                          onUpdateComponent={onUpdateComponent}
                          onEditComponent={onEditComponent}
                          profile={profile}
                          summaryPreview={summaryPreview}
                        />
                      </div>
                    ))}
                  </ProductReviewTrack>
                )}
              </article>
            )
          })}
          {structure.length === 0 && (
            <div className="sb-qa-empty-components">
              이 CASE에는 평가할 수 있는 노출 컴포넌트가 없습니다.
            </div>
          )}
        </div>
      </section>

      {llmDialogOpen && (
        <LlmRevisionDialog
          planCases={planCases}
          onApply={onApplyLlmRevisions}
          onClose={() => setLlmDialogOpen(false)}
          onToast={onToast}
        />
      )}
    </main>
  )
}
