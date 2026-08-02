import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  caseHasEvaluationInput,
  componentEvaluationStructureForCase,
  evaluationCasesFor,
  evaluationLeaderboard,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  structuredComponentEvaluationStats,
} from '../../lib/evaluation.js'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'
import LlmRevisionDialog from './LlmRevisionDialog.jsx'
import AiFixChooser from './AiFixChooser.jsx'
import PropagationDialog from './PropagationDialog.jsx'
import { collectPropagationSeeds, propagationTargets } from '../../lib/prompt/propagation.js'
import Rubric from './evaluation/Rubric.jsx'
import Leaderboard from './evaluation/Leaderboard.jsx'
import CommentBubble from './evaluation/CommentBubble.jsx'
import PreviewBoundary from './evaluation/PreviewBoundary.jsx'

/*
 * 평가 스튜디오 오케스트레이터 — 주석(annotation) 방식.
 *
 * 왼쪽에 케이스 페이지를 실제 모습 그대로 렌더하고, 오른쪽 레일에 컴포넌트마다
 * 말풍선(별점 + 코멘트)을 띄운다. 디자인 리뷰 도구(Figma 코멘트)와 같은 문법이라
 * "무엇을 평가하는지"가 화면에서 바로 보인다.
 *
 * 말풍선 위치는 컴포넌트의 실제 렌더 높이를 측정해 맞춘다. 컨테이너 안 자식
 * (상품 카드 등)은 컨테이너가 통째로 렌더하므로 자식 말풍선은 부모 위치에 앵커되고,
 * 겹치면 아래로 밀려 순서대로 쌓인다. 별점/루브릭/리더보드/말풍선은
 * ./evaluation/의 표현 컴포넌트가 담당한다.
 */

export default function EvaluationPanel({
  scenario,
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
  const [fixChooserOpen, setFixChooserOpen] = useState(false) // 문구 다듬기 / 페이지 재구성 / 전체 반영 선택
  const [propagationOpen, setPropagationOpen] = useState(false)
  const [activeId, setActiveId] = useState(null) // 선택된 말풍선(=컴포넌트) — '__case__' 포함
  const selectedCases = evaluationCasesFor(planCases)
  const stats = structuredComponentEvaluationStats(planCases)
  const activeSelected = selectedCases.find((planCase) => planCase.id === activeCaseId)
  const [activeSlot, setActiveSlot] = useState(
    () => normalizeCaseEvaluation(activeSelected?.evaluation).selection.slot || 'A'
  )

  const pageRef = useRef(null)
  const railRef = useRef(null)
  const anchorRefs = useRef({}) // 최상위 아이템 id → 페이지의 래퍼 엘리먼트
  const bubbleRefs = useRef({}) // 말풍선 id → 엘리먼트

  useEffect(() => {
    const slot = normalizeCaseEvaluation(activeSelected?.evaluation).selection.slot
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
    () => (activeCase?.items || []).filter((item) => !item.parentId && !item.hidden),
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

  const board = useMemo(() => evaluationLeaderboard(planCases), [planCases])
  const remainingCount = planCases.length - board.length

  const rerunRecommendation = () => {
    if (selectedCases.some(caseHasEvaluationInput)) {
      const ok = window.confirm(
        '평가하지 않은 케이스에서 다음 CASE A/B/C를 선정할까요?\n지금까지의 평가는 리더보드에 남고, 피드백 전체 반영의 씨앗으로 계속 쓰여요.'
      )
      if (!ok) return
    }
    onRecommend()
  }

  if (selectedCases.length < 3) {
    return (
      <main className="sb-evaluation sb-qa-setup">
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
          <button
            type="button"
            className="sb-btn"
            title={remainingCount > 0
              ? `평가 흔적이 있는 케이스는 빼고 미평가 ${remainingCount}개에서 다음 3개를 뽑아요.`
              : '모든 케이스를 평가했어요 — 추천 점수 순으로 다시 뽑아요.'}
            onClick={rerunRecommendation}
          >
            다음 3개 선정
          </button>
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
                onClick={() => focusFromPage(item.id)}
              >
                <PreviewBoundary resetKey={`${item.id}:${item.type}`}>
                  {renderItem(item, pageCtx)}
                </PreviewBoundary>
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
              review={{ score: activeEvaluation.review.score, feedback: activeEvaluation.review.feedback, resolved: false }}
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

        <Leaderboard board={board} remaining={remainingCount} onOpenCase={onEditCase} />
      </section>

      {fixChooserOpen && (() => {
        const seeds = collectPropagationSeeds(planCases)
        return (
          <AiFixChooser
            activeCaseName={activeCase?.name || '평가 케이스'}
            activeSlot={activeSlot}
            seedCount={seeds.componentSeeds.length + seeds.caseNotes.length}
            targetCount={propagationTargets(planCases, seeds).length}
            onPickPolish={() => { setFixChooserOpen(false); setLlmDialogOpen(true) }}
            onPickRebuild={() => {
              setFixChooserOpen(false)
              if (activeCase) onReviseCase(activeCase.id)
            }}
            onPickPropagate={() => { setFixChooserOpen(false); setPropagationOpen(true) }}
            onClose={() => setFixChooserOpen(false)}
          />
        )
      })()}

      {propagationOpen && (
        <PropagationDialog
          scenario={scenario}
          planCases={planCases}
          onApply={onApplyLlmRevisions}
          onClose={() => setPropagationOpen(false)}
          onToast={onToast}
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
