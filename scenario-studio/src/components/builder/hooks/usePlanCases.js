import { createPlanCase, planCasesForScenario, uid } from '../../../lib/store.js'
import {
  EVALUATION_CASE_SLOTS,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  recommendSignificantCaseIds,
  remapCaseEvaluation,
} from '../../../lib/evaluation.js'
import { applyLlmRevisionsToPlanCases } from '../../../lib/prompt/revision.js'

/*
 * 계획 케이스(설문 답변 조합 → 계획 화면) 목록의 CRUD와 평가 상태를 담당한다.
 *
 * 케이스 목록에는 지켜야 할 규칙이 몇 개 있고, 그 규칙이 예전에는 Builder의 여러 핸들러에
 * 흩어져 있었다:
 *   · 폴백(조건 미일치 시 실행) 케이스는 언제나 정확히 하나, 항상 목록의 끝
 *   · 새/복제/생성 케이스는 폴백 앞에 들어간다 (앞 케이스가 우선 적용되므로)
 *   · 케이스를 복제하면 아이템 id를 새로 발급하고 parentId·평가 기록까지 새 id로 다시 매단다
 * 여기 모아 두면 삽입 위치를 잘못 잡아 폴백이 중간에 끼는 사고를 한 곳에서 막을 수 있다.
 */
export function usePlanCases({
  api,
  scenario,
  planCases,
  planCaseId,
  activePlanCase,
  setPlanCaseId,
  previewMode,
  pushHistory,
}) {
  const updatePlanCases = (updater) => {
    if (previewMode) return
    pushHistory()
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      planCases: updater(s.planCases || planCasesForScenario(s)),
    }))
  }

  /* 폴백 앞(= 일반 케이스의 맨 뒤)에 끼워 넣는다 */
  const insertBeforeFallback = (list, entries) => {
    const fallbackIndex = list.findIndex((planCase) => planCase.isFallback)
    const next = [...list]
    next.splice(fallbackIndex >= 0 ? fallbackIndex : next.length, 0, ...entries)
    return next
  }

  const updateActivePlanCase = (patch) => {
    updatePlanCases((current) => current.map((planCase) =>
      planCase.id === planCaseId ? { ...planCase, ...patch } : planCase
    ))
  }

  const addPlanCase = () => {
    const next = createPlanCase({ name: `계획 케이스 ${planCases.length + 1}` })
    updatePlanCases((current) => insertBeforeFallback(current, [next]))
    setPlanCaseId(next.id)
    return next
  }

  /* AI가 만든 초안 케이스를 일괄 삽입 */
  const applyGeneratedCases = (generatedCases) => {
    if (!Array.isArray(generatedCases) || generatedCases.length === 0) return
    updatePlanCases((current) => insertBeforeFallback(current, generatedCases))
    setPlanCaseId(generatedCases[0].id)
    api.showToast(`케이스 ${generatedCases.length}개를 초안으로 추가했어요. 평가 탭에서 검수해주세요.`)
  }

  const duplicatePlanCase = () => {
    if (!activePlanCase) return
    const idMap = {}
    activePlanCase.items.forEach((item) => { idMap[item.id] = uid() })
    const itemsCopy = activePlanCase.items.map((item) => ({
      ...item,
      id: idMap[item.id],
      parentId: item.parentId ? idMap[item.parentId] : undefined,
      props: JSON.parse(JSON.stringify(item.props || {})),
      style: item.style ? { ...item.style } : undefined,
    }))
    const copy = createPlanCase({
      ...activePlanCase,
      id: uid(),
      name: `${activePlanCase.name} 복사본`,
      isFallback: false,
      conditions: (activePlanCase.conditions || []).map((condition) => ({
        ...condition,
        id: uid(),
        values: [...(condition.values || [])],
      })),
      items: itemsCopy,
      evaluation: remapCaseEvaluation(activePlanCase.evaluation, idMap, { selected: false, slot: null }),
    })
    updatePlanCases((current) => {
      const index = current.findIndex((planCase) => planCase.id === activePlanCase.id)
      const fallbackIndex = current.findIndex((planCase) => planCase.isFallback)
      const lastRegular = fallbackIndex >= 0 ? fallbackIndex : current.length
      const next = [...current]
      // 폴백을 복제하면 일반 케이스의 맨 뒤로, 그 외에는 원본 바로 뒤로
      next.splice(activePlanCase.isFallback ? lastRegular : Math.min(index + 1, lastRegular), 0, copy)
      return next
    })
    setPlanCaseId(copy.id)
    api.showToast(`"${copy.name}" 케이스를 만들었어요.`)
  }

  const removePlanCase = () => {
    if (!activePlanCase || planCases.length <= 1) return false
    if (!window.confirm(`"${activePlanCase.name}" 계획 케이스를 삭제할까요?`)) return false
    const index = planCases.findIndex((planCase) => planCase.id === activePlanCase.id)
    const remaining = planCases.filter((planCase) => planCase.id !== activePlanCase.id)
    // 폴백을 지웠으면 마지막 케이스가 새 폴백이 된다 — 폴백 없는 상태를 만들지 않는다
    if (activePlanCase.isFallback && remaining.length > 0) {
      remaining[remaining.length - 1] = { ...remaining[remaining.length - 1], isFallback: true }
    }
    updatePlanCases(() => remaining)
    setPlanCaseId(remaining[Math.min(index, remaining.length - 1)]?.id || null)
    return true
  }

  const setFallbackPlanCase = () => {
    updatePlanCases((current) => {
      const target = current.find((planCase) => planCase.id === planCaseId)
      if (!target) return current
      const regular = current
        .filter((planCase) => planCase.id !== planCaseId)
        .map((planCase) => ({ ...planCase, isFallback: false }))
      return [...regular, { ...target, isFallback: true }]
    })
  }

  const movePlanCase = (delta) => {
    if (activePlanCase?.isFallback) return
    const from = planCases.findIndex((planCase) => planCase.id === planCaseId)
    const lastRegularIndex = Math.max(0, planCases.findIndex((planCase) => planCase.isFallback) - 1)
    const to = Math.max(0, Math.min(lastRegularIndex, from + delta))
    if (from < 0 || from === to) return
    updatePlanCases((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  /* ── 평가 ── */

  const updateComponentEvaluation = (caseId, itemId, patch) => {
    updatePlanCases((current) => current.map((planCase) => {
      if (planCase.id !== caseId) return planCase
      const evaluation = normalizeCaseEvaluation(planCase.evaluation)
      const review = normalizeComponentEvaluation(evaluation.components[itemId])
      const now = new Date().toISOString()
      return {
        ...planCase,
        evaluation: {
          ...evaluation,
          components: { ...evaluation.components, [itemId]: { ...review, ...patch, updatedAt: now } },
          updatedAt: now,
        },
      }
    }))
  }

  /* 평가 스튜디오는 언제나 정확히 3개 CASE(A/B/C) — 답변 조합이 가장 다른 케이스를 고른다 */
  const recommendPlanCases = () => {
    const recommendation = recommendSignificantCaseIds(planCases, 3)
    const recommendedIds = new Set(recommendation)
    const slotById = Object.fromEntries(
      recommendation.map((caseId, index) => [caseId, EVALUATION_CASE_SLOTS[index] || null])
    )
    updatePlanCases((current) => current.map((planCase) => ({
      ...planCase,
      evaluation: {
        ...normalizeCaseEvaluation(planCase.evaluation),
        selected: recommendedIds.has(planCase.id),
        slot: slotById[planCase.id] || null,
        updatedAt: new Date().toISOString(),
      },
    })))
    const first = planCases.find((planCase) => planCase.id === recommendation[0])
    if (first) setPlanCaseId(first.id)
    api.showToast(`평가할 CASE A/B/C ${recommendedIds.size}개를 추천했어요.`)
  }

  /* AI가 돌려준 수정안 적용 — 검증은 lib/prompt/revision.js가 이미 끝냈고,
     여기서는 "적용 시점에도 값이 그대로인가"만 한 번 더 확인된 결과를 반영한다 */
  const applyRevisions = (revisions) => {
    const result = applyLlmRevisionsToPlanCases(planCases, revisions)
    if (result.applied === 0) {
      api.showToast('현재 값과 일치하는 수정안이 없어 적용하지 않았어요.')
      return
    }
    updatePlanCases(() => result.planCases)
    api.showToast(
      result.skipped > 0
        ? `AI 수정안 ${result.applied}개를 적용하고, 값이 바뀐 ${result.skipped}개는 건너뛰었어요.`
        : `AI 수정안 ${result.applied}개를 적용했어요. 실제 화면을 검수해주세요.`
    )
  }

  return {
    updatePlanCases,
    updateActivePlanCase,
    addPlanCase,
    applyGeneratedCases,
    duplicatePlanCase,
    removePlanCase,
    setFallbackPlanCase,
    movePlanCase,
    updateComponentEvaluation,
    recommendPlanCases,
    applyRevisions,
  }
}
