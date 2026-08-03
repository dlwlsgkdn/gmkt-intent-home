import { useEffect, useState } from 'react'
import { LIBRARY } from '../../../lib/registry.jsx'
import { normalizeCaseEvaluation, normalizeComponentEvaluation } from '../../../lib/evaluation.js'

/*
 * 평가 ↔ 편집 이동 — 평가 탭에서 "반영하러 가기"로 넘어올 때의 문맥을 갖는다:
 *   · feedbackTarget: 어느 케이스의 어느 컴포넌트 피드백을 반영하러 왔는가
 *     (계획 편집기 상단 FeedbackFocusBar와 자동 선택의 근거)
 *   · 인스펙터 포커스 신호(focusTick/focusFieldKey): 더블클릭·이동 직후
 *     정확한 입력란으로 커서를 보낸다
 */
export function useEvaluationBridge({
  planCases, planCaseId, setPlanCaseId, activePlanCase,
  stageKey, setStageKey, setCanvasView, setSelectedIds,
  previewMode, openCaseRevision, showToast,
}) {
  const [feedbackTarget, setFeedbackTarget] = useState(null) // { caseId, itemId, fieldKey, label }
  const [focusFieldKey, setFocusFieldKey] = useState(null) // 평가에서 인스펙터의 정확한 필드로 이동
  const [focusTick, setFocusTick] = useState(0) // 더블클릭 → 인스펙터 포커스 신호

  /* 인스펙터 첫 입력란(또는 지정 필드)으로 포커스를 보내 달라는 신호 */
  const focusInspector = (fieldKey = null) => {
    setFocusFieldKey(fieldKey)
    setFocusTick((tick) => tick + 1)
  }

  const editEvaluatedCase = (caseId) => {
    setFeedbackTarget(null)
    setFocusFieldKey(null)
    setCanvasView('edit')
    setPlanCaseId(caseId)
    setStageKey('plan')
    setSelectedIds([])
  }

  /* 평가 탭에서 "이 케이스 다시 만들기" — 대상 케이스를 활성화한 뒤 재구성 다이얼로그를 연다 */
  const reviseEvaluatedCase = (caseId) => {
    setPlanCaseId(caseId)
    openCaseRevision()
  }

  const editEvaluatedComponent = (caseId, component) => {
    const label = LIBRARY[component.type]?.label || component.type
    setCanvasView('edit')
    setPlanCaseId(caseId)
    setFeedbackTarget({ caseId, itemId: component.itemId, fieldKey: null, label })
    setFocusFieldKey(null)
    setStageKey('plan')
    setSelectedIds([component.itemId])
    showToast(`${label} 컴포넌트와 피드백을 열었어요.`)
  }

  /* 평가의 "피드백 반영하러 가기"가 단계 전환 초기화 뒤에도 정확한 컴포넌트를 선택하게 한다 */
  useEffect(() => {
    if (stageKey !== 'plan' || !feedbackTarget || feedbackTarget.caseId !== planCaseId) return
    if (!(activePlanCase?.items || []).some((item) => item.id === feedbackTarget.itemId)) return
    setSelectedIds([feedbackTarget.itemId])
    setFocusFieldKey(feedbackTarget.fieldKey || null)
    setFocusTick((tick) => tick + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, planCaseId, feedbackTarget?.caseId, feedbackTarget?.itemId, feedbackTarget?.fieldKey])

  /* 더블클릭 시 인스펙터 첫 입력란(또는 지정된 필드)에 포커스 */
  useEffect(() => {
    if (previewMode || !focusTick) return
    const selector = focusFieldKey
      ? `.sb-inspector [data-fkey="${focusFieldKey}"]`
      : '.sb-inspector input[type="text"], .sb-inspector textarea'
    const el = document.querySelector(selector)
    if (el) {
      el.focus()
      if (el.select) el.select()
    }
  }, [focusTick, previewMode, focusFieldKey])

  /* 반영 중인 피드백의 현재 값 — FeedbackFocusBar와 자동 선택이 읽는다 */
  const feedbackPlanCase = feedbackTarget ? planCases.find((planCase) => planCase.id === feedbackTarget.caseId) : null
  const feedbackItem = feedbackPlanCase
    ? (feedbackPlanCase.items || []).find((item) => item.id === feedbackTarget.itemId)
    : null
  const feedbackReview = feedbackPlanCase && feedbackTarget
    ? normalizeComponentEvaluation(normalizeCaseEvaluation(feedbackPlanCase.evaluation).components[feedbackTarget.itemId])
    : null

  return {
    feedbackTarget,
    focusInspector,
    editEvaluatedCase,
    reviseEvaluatedCase,
    editEvaluatedComponent,
    feedbackPlanCase,
    feedbackItem,
    feedbackReview,
  }
}
