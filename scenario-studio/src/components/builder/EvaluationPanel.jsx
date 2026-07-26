import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  componentEvaluationStructureForCase,
  evaluationCasesFor,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  structuredComponentEvaluationStats,
} from '../../lib/evaluation.js'
import { sortByPosition } from '../../lib/store.js'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'
import LlmRevisionDialog from './LlmRevisionDialog.jsx'
import AiFixChooser from './AiFixChooser.jsx'

/*
 * 평가 스튜디오 — 주석(annotation) 방식.
 *
 * 왼쪽에 케이스 페이지를 실제 모습 그대로 렌더하고, 오른쪽 레일에 컴포넌트마다
 * 말풍선(별점 + 코멘트)을 띄운다. 디자인 리뷰 도구(Figma 코멘트)와 같은 문법이라
 * "무엇을 평가하는지"가 화면에서 바로 보인다.
 *
 * 말풍선 위치는 컴포넌트의 실제 렌더 높이를 측정해 맞춘다. 컨테이너 안 자식
 * (상품 카드 등)은 컨테이너가 통째로 렌더하므로 자식 말풍선은 부모 위치에 앵커되고,
 * 겹치면 아래로 밀려 순서대로 쌓인다.
 */

const SCORE_GUIDE = [
  { score: 5, title: '완벽 · 그대로 사용', desc: '수정하거나 추가할 의견이 전혀 없습니다.' },
  { score: 4, title: '충분히 좋음 · 더 나은 대안 있음', desc: '오류는 없지만 추가 아이디어나 더 좋은 대안이 있습니다.' },
  { score: 3, title: '방향은 맞음 · 일부 수정 필요', desc: '중요한 정보가 부족하거나 일부 내용을 수정해야 합니다.' },
  { score: 2, title: '핵심 오류·누락', desc: '일부는 맞지만 상당한 수정이 필요합니다.' },
  { score: 1, title: '거의 다시 작성', desc: '대부분 부정확하거나 적절하지 않습니다.' },
  { score: 0, title: '사용 불가', desc: '결과가 없거나 완전히 잘못되었습니다.' },
]

/* 별점 — 데이터는 기존 0~5 그대로. 별 1~5를 누르면 점수, 같은 별을 다시 누르면
   별을 다 끈 0점(사용 불가)이 된다. 빈 별만으로는 "0점"과 "아직 평가 안 함"이
   구분되지 않으므로, 옆 배지가 그 상태를 말한다: 미평가(회색) / 0점(빨강).
   배지를 누르면 언제든 미평가로 초기화된다. */
function StarRating({ value, onChange, label }) {
  return (
    <div
      className={'sb-stars' + (value == null ? ' is-unrated' : '')}
      role="radiogroup"
      aria-label={`${label} 별점`}
    >
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={'sb-star' + (value != null && value >= score ? ' is-on' : '')}
          aria-label={`${score}점`}
          aria-pressed={value === score}
          title={value === score
            ? '다시 누르면 별을 모두 끈 0점(사용 불가)이 돼요'
            : SCORE_GUIDE.find((guide) => guide.score === score)?.title}
          onClick={() => onChange(value === score ? 0 : score)}
        >
          ★
        </button>
      ))}
      <button
        type="button"
        className={
          'sb-star-state'
          + (value == null ? ' is-unrated' : '')
          + (value === 0 ? ' is-zero' : '')
        }
        aria-pressed={value == null}
        title={value == null
          ? '아직 평가하지 않은 상태예요'
          : '누르면 미평가로 초기화돼요'}
        onClick={() => onChange(null)}
      >
        {value === 0 ? '0점' : '미평가'}
      </button>
    </div>
  )
}

function Rubric({ onClose }) {
  return (
    <section className="sb-qa-rubric" aria-label="별점 기준">
      <div className="sb-qa-rubric__head">
        <div>
          <span>SCORING RUBRIC</span>
          <h3>별점 기준</h3>
        </div>
        <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="평가 기준 닫기">×</button>
      </div>
      <p className="sb-qa-rubric__howto">
        별 1~5를 눌러 점수를 매기고, 같은 별을 다시 누르면 별을 모두 끈 <b>0점(사용 불가)</b>이 됩니다.
        옆 배지는 상태 표시 — <b>미평가</b>(회색)·<b>0점</b>(빨강)이며, 누르면 미평가로 초기화돼요.
      </p>
      <div className="sb-qa-rubric__distinction">
        <strong>★5와 ★4의 차이</strong>
        <span><b>★5</b> 수정·추가 의견이 전혀 없음</span>
        <span><b>★4</b> 틀린 것은 없지만 더 좋은 대안·추가 아이디어가 있음</span>
      </div>
      <div className="sb-qa-rubric__grid">
        {SCORE_GUIDE.map((guide) => (
          <div key={guide.score} className={`sb-qa-rubric__row sb-qa-rubric__row--${guide.score}`}>
            <strong>{guide.score === 0 ? '0' : '★'.repeat(guide.score)}</strong>
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

/* 말풍선 하나 — 위치(top)는 부모의 레이아웃 함수가 잡아 준다 */
function CommentBubble({
  bubbleRef,
  active,
  review,
  icon,
  label,
  isCase = false,
  onActivate,
  onScore,
  onFeedback,
  onEdit,
  onResolve,
}) {
  const warn = review.score === 5 && review.feedback.trim()
  return (
    <div
      ref={bubbleRef}
      className={
        'sb-bubble'
        + (active ? ' is-active' : '')
        + (isCase ? ' sb-bubble--case' : '')
        + (review.resolved ? ' is-resolved' : '')
      }
      onClick={onActivate}
    >
      <div className="sb-bubble__head">
        <span className="sb-bubble__label">{icon} {label}</span>
        <StarRating value={review.score} label={label} onChange={onScore} />
      </div>
      <textarea
        rows={2}
        value={review.feedback}
        placeholder={isCase
          ? '케이스 전체 피드백 — 예: 참고 영상 붙여줘, CTA 빼줘'
          : '피드백 — 오류·누락·더 좋은 대안'}
        onChange={(event) => onFeedback(event.target.value)}
        onClick={(event) => event.stopPropagation()}
      />
      {warn && <p className="sb-bubble__warn">★5는 수정 의견이 없는 결과예요 — 피드백을 비우거나 별점을 낮춰주세요.</p>}
      {!isCase && (
        <div className="sb-bubble__foot">
          {review.resolved && <em>✓ 반영 완료</em>}
          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }}>수정하러 가기</button>
          <button
            type="button"
            disabled={!review.feedback.trim()}
            className={review.resolved ? 'is-on' : ''}
            onClick={(event) => { event.stopPropagation(); onResolve() }}
          >
            {review.resolved ? '반영 해제' : '반영 완료'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function EvaluationPanel({
  planCases,
  activeCaseId,
  onSelectCase,
  onRecommend,
  onUpdateComponent,
  onUpdateCase,
  onEditCase,
  onReviseCase,
  onEditComponent,
  onApplyLlmRevisions,
  onToast,
  profile,
  summaryPreview,
  deviceW = 430,
}) {
  const [rubricOpen, setRubricOpen] = useState(false)
  const [llmDialogOpen, setLlmDialogOpen] = useState(false)
  const [fixChooserOpen, setFixChooserOpen] = useState(false) // 문구 다듬기 / 페이지 재구성 선택
  const [activeId, setActiveId] = useState(null) // 선택된 말풍선(=컴포넌트) — '__case__' 포함
  const selectedCases = evaluationCasesFor(planCases)
  const stats = structuredComponentEvaluationStats(planCases)
  const activeSelected = selectedCases.find((planCase) => planCase.id === activeCaseId)
  const [activeSlot, setActiveSlot] = useState(
    () => normalizeCaseEvaluation(activeSelected?.evaluation).slot || 'A'
  )

  const pageRef = useRef(null)
  const railRef = useRef(null)
  const anchorRefs = useRef({}) // 최상위 아이템 id → 페이지의 래퍼 엘리먼트
  const bubbleRefs = useRef({}) // 말풍선 id → 엘리먼트

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
  /* 평가 대상을 화면 순서대로 평탄화 — 자식은 부모 최상위 아이템에 앵커된다 */
  const evaluables = useMemo(() => structure.flatMap((section) => section.components), [structure])
  const anchorIdOf = (component) => component.item.parentId || component.itemId

  /* 페이지에 그릴 최상위 아이템 (실행 화면과 동일: 숨김 제외, 위→아래) */
  const pageItems = useMemo(
    () => sortByPosition((activeCase?.items || []).filter((item) => !item.parentId && !item.hidden)),
    [activeCase]
  )

  const pageCtx = useMemo(() => {
    const safeSummary = {
      profile: Array.isArray(summaryPreview?.profile) ? summaryPreview.profile : [],
      questions: Array.isArray(summaryPreview?.questions) ? summaryPreview.questions : [],
    }
    return {
      mode: 'canvas',
      canvasView: 'preview',
      allItems: activeCase?.items || [],
      selectedIds: [],
      chips: [],
      profile: profile || { name: '사용자', items: [] },
      summaryPreview: safeSummary,
      updateProps: () => {},
      player: {
        query: '', setQuery: () => {}, submitQuery: () => {},
        answers: {}, setAnswer: () => {},
        excludedProfile: [], toggleProfileItem: () => {},
        summary: safeSummary,
        addToCart: () => {}, openExternal: () => {}, showKeyword: () => {}, complete: () => {},
      },
    }
  }, [activeCase, profile, summaryPreview])

  /* ── 말풍선 배치: 앵커의 실제 렌더 높이에 맞추고, 겹치면 아래로 밀어 쌓는다 ── */
  const layoutBubbles = () => {
    const page = pageRef.current
    const rail = railRef.current
    if (!page || !rail) return
    const order = ['__case__', ...evaluables.map((component) => component.itemId)]
    if (window.matchMedia('(max-width: 1100px)').matches) {
      // 좁은 화면: 말풍선을 일반 흐름으로 두는 CSS로 전환되므로 인라인 배치를 걷어낸다
      order.forEach((id) => {
        const bubble = bubbleRefs.current[id]
        if (bubble) bubble.style.top = ''
      })
      rail.style.height = ''
      return
    }
    let cursor = 0
    order.forEach((id) => {
      const bubble = bubbleRefs.current[id]
      if (!bubble) return
      const component = evaluables.find((entry) => entry.itemId === id)
      const anchorEl = component ? anchorRefs.current[anchorIdOf(component)] : null
      const top = Math.max(anchorEl ? anchorEl.offsetTop : 0, cursor)
      bubble.style.top = `${top}px`
      cursor = top + bubble.offsetHeight + 12
    })
    rail.style.height = `${Math.max(page.offsetHeight, cursor)}px`
  }

  /* 매 렌더 동기 배치 + 다음 프레임 보정(이미지 로딩으로 높이가 늦게 잡히는 경우).
     rAF만 쓰면 연속 렌더에서 cleanup이 계속 취소해 한 번도 실행되지 못할 수 있다. */
  const layoutRef = useRef(layoutBubbles)
  layoutRef.current = layoutBubbles
  useEffect(() => {
    layoutRef.current()
    const raf = requestAnimationFrame(() => layoutRef.current())
    return () => cancelAnimationFrame(raf)
  })

  useEffect(() => {
    const page = pageRef.current
    if (!page) return undefined
    const run = () => layoutRef.current()
    const observer = new ResizeObserver(run)
    observer.observe(page)
    window.addEventListener('resize', run)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', run)
    }
  }, [activeCase?.id])

  /* 페이지 아이템 클릭 → 그 아이템(또는 그 안 첫 컴포넌트)의 말풍선으로 */
  const focusFromPage = (topId) => {
    const target = evaluables.find((component) => anchorIdOf(component) === topId)
    if (!target) return
    setActiveId(target.itemId)
    bubbleRefs.current[target.itemId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  /* 말풍선 클릭 → 페이지의 해당 컴포넌트 강조 */
  const focusFromBubble = (component) => {
    setActiveId(component ? component.itemId : '__case__')
    if (!component) return
    anchorRefs.current[anchorIdOf(component)]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const activeAnchorId = useMemo(() => {
    const component = evaluables.find((entry) => entry.itemId === activeId)
    return component ? anchorIdOf(component) : null
  }, [activeId, evaluables])

  const chooseCase = (caseStat) => {
    setActiveSlot(caseStat.slot)
    setActiveId(null)
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
      {/* 한 줄 툴바 — 진행률·평균과 액션만. 큰 머리말은 두지 않는다 */}
      <section className="sb-qa-toolbar" aria-label="평가 현황과 도구">
        <div
          className="sb-qa-toolbar__ring"
          style={{ '--sb-qa-progress': `${stats.progress * 3.6}deg` }}
          aria-label={`평가 진행률 ${stats.progress}%`}
        >
          <strong>{stats.progress}%</strong>
        </div>
        <div className="sb-qa-toolbar__stat">
          <strong>{stats.completed}<small> / {stats.total}</small></strong>
          <span>평가 완료</span>
        </div>
        <div className="sb-qa-toolbar__stat">
          <strong className="sb-qa-toolbar__avg">
            ★ {stats.average == null ? '—' : stats.average.toFixed(1)}
          </strong>
          <span>평균 · 총점 {stats.score}/{stats.maxScore}</span>
        </div>
        <div className="sb-qa-toolbar__actions">
          <button
            type="button"
            className="sb-btn sb-btn--ai"
            title="문구만 다듬을지, 케이스 페이지를 통째로 재구성할지 골라서 프롬프트를 만들어 드려요."
            onClick={() => setFixChooserOpen(true)}
          >
            ⇄ AI에게 수정 요청
          </button>
          <button type="button" className="sb-btn" onClick={rerunRecommendation}>다시 선정</button>
          <button
            type="button"
            className={'sb-btn' + (rubricOpen ? ' sb-btn--open' : '')}
            onClick={() => setRubricOpen((open) => !open)}
          >
            별점 기준
          </button>
        </div>
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
            <small>{caseStat.completed}/{caseStat.total} 완료</small>
          </button>
        ))}
        {activeCase && (
          <button type="button" className="sb-btn sb-qa-case-tabs__open" onClick={() => onEditCase(activeCase.id)}>
            전체 결과 화면 열기
          </button>
        )}
      </section>

      {/* 왼쪽 = 실제 페이지, 오른쪽 = 말풍선 레일 */}
      <section className="sb-annotate">
        <div className="sb-annotate__page" ref={pageRef} style={{ width: deviceW }}>
          {pageItems.map((item) => {
            const noted = evaluables.some((component) =>
              anchorIdOf(component) === item.id
              && normalizeComponentEvaluation(activeEvaluation.components[component.itemId]).feedback.trim()
            )
            return (
              <div
                key={item.id}
                ref={(el) => { anchorRefs.current[item.id] = el }}
                className={
                  'sb-annotate__item'
                  + (activeAnchorId === item.id ? ' is-active' : '')
                  + (noted ? ' is-noted' : '')
                }
                style={{ maxWidth: item.w || undefined }}
                onClick={() => focusFromPage(item.id)}
              >
                <EvaluationPreviewBoundary resetKey={`${item.id}:${item.type}`}>
                  {renderItem(item, pageCtx)}
                </EvaluationPreviewBoundary>
              </div>
            )
          })}
          {pageItems.length === 0 && (
            <div className="sb-qa-empty-components">이 CASE에는 평가할 수 있는 노출 컴포넌트가 없습니다.</div>
          )}
        </div>

        <div className="sb-annotate__rail" ref={railRef}>
          {activeCase && (
            <CommentBubble
              bubbleRef={(el) => { bubbleRefs.current.__case__ = el }}
              active={activeId === '__case__'}
              isCase
              icon="🗂"
              label="케이스 전체"
              review={{ score: activeEvaluation.score, feedback: activeEvaluation.feedback, resolved: false }}
              onActivate={() => focusFromBubble(null)}
              onScore={(score) => onUpdateCase(activeCase.id, { score })}
              onFeedback={(feedback) => onUpdateCase(activeCase.id, { feedback })}
            />
          )}
          {evaluables.map((component) => {
            const review = normalizeComponentEvaluation(activeEvaluation.components[component.itemId])
            const def = LIBRARY[component.type]
            return (
              <CommentBubble
                key={component.itemId}
                bubbleRef={(el) => { bubbleRefs.current[component.itemId] = el }}
                active={activeId === component.itemId}
                icon={def?.icon}
                label={def?.label || component.type}
                review={review}
                onActivate={() => focusFromBubble(component)}
                onScore={(score) => onUpdateComponent(activeCase.id, component.itemId, { score })}
                onFeedback={(feedback) => onUpdateComponent(activeCase.id, component.itemId, {
                  feedback,
                  resolved: false,
                })}
                onEdit={() => onEditComponent(activeCase.id, component)}
                onResolve={() => onUpdateComponent(activeCase.id, component.itemId, { resolved: !review.resolved })}
              />
            )
          })}
        </div>
      </section>

      {fixChooserOpen && (
        <AiFixChooser
          activeCaseName={activeCase?.name || '평가 케이스'}
          activeSlot={activeSlot}
          onPickPolish={() => { setFixChooserOpen(false); setLlmDialogOpen(true) }}
          onPickRebuild={() => {
            setFixChooserOpen(false)
            if (activeCase) onReviseCase(activeCase.id)
          }}
          onClose={() => setFixChooserOpen(false)}
        />
      )}

      {llmDialogOpen && (
        <LlmRevisionDialog
          planCases={planCases}
          onApply={onApplyLlmRevisions}
          onClose={() => setLlmDialogOpen(false)}
          onToast={onToast}
          onSwitchToRevise={activeCase ? () => {
            setLlmDialogOpen(false)
            onReviseCase(activeCase.id)
          } : undefined}
        />
      )}
    </main>
  )
}
