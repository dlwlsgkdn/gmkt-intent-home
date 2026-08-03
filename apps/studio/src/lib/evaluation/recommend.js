import { caseHasEvaluationInput } from './model.js'

/*
 * 대표 케이스 추천 — "사람이 다 볼 수 없으니 무엇을 보여줄 것인가"의 규칙.
 *
 * 자동 점수(rankSignificantCases) 위에 두 단계가 얹힌다:
 *   · MMR 다양화(recommendSignificantCaseIds): 유사 조합만 뽑히지 않게
 *   · 로테이션(recommendRotationCaseIds): 이미 평가한 케이스는 후보에서 제외
 */

const conditionTokens = (planCase) => {
  if (planCase?.isFallback) return new Set(['__fallback__'])
  const tokens = new Set()
  ;(planCase?.conditions || []).forEach((condition) => {
    if (!condition.questionId) return
    const values = Array.isArray(condition.values) && condition.values.length > 0
      ? condition.values
      : ['__answer_state__']
    values.forEach((value) => {
      tokens.add(`${condition.questionId}:${condition.operator || 'includesAny'}:${String(value)}`)
    })
  })
  return tokens
}

const similarity = (left, right) => {
  if (left.size === 0 && right.size === 0) return 1
  let overlap = 0
  left.forEach((token) => {
    if (right.has(token)) overlap++
  })
  const union = new Set([...left, ...right]).size
  return union > 0 ? overlap / union : 0
}

const hasMeaningfulContent = (item) =>
  Object.values(item?.props || {}).some((value) =>
    typeof value === 'string' ? value.trim().length >= 4 : value != null
  )

/*
 * 대표 케이스 추천 점수(100점):
 * - 세그먼트 구체성 30: 질문·조건·선택값이 실제로 정의됐는지
 * - 콘텐츠 완성도 34: 노출 컴포넌트 수·종류·실제 문구
 * - 케이스 차별성 24: 다른 조건 조합과 얼마나 겹치지 않는지
 * - 운영 중요도 12: 조건 케이스의 실행 가능성 또는 기본 폴백 역할
 *
 * 사용자가 입력한 1~5점은 추천 순위에 섞지 않는다. 추천과 평가를 분리해야
 * 낮게 평가한 중요 케이스도 다음 보강 대상으로 계속 남기 때문이다.
 */
export function rankSignificantCases(planCases = []) {
  const signatures = planCases.map(conditionTokens)
  return planCases
    .map((planCase, index) => {
      const conditions = (planCase.conditions || []).filter((condition) => condition.questionId)
      const questionCount = new Set(conditions.map((condition) => condition.questionId)).size
      const valueCount = conditions.reduce(
        (sum, condition) => sum + Math.max(1, (condition.values || []).length),
        0
      )
      const visibleItems = (planCase.items || []).filter((item) => !item.hidden)
      const typeCount = new Set(visibleItems.map((item) => item.type)).size
      const filledCount = visibleItems.filter(hasMeaningfulContent).length

      const segmentScore = planCase.isFallback
        ? 10
        : Math.min(14, conditions.length * 5)
          + Math.min(10, questionCount * 5)
          + Math.min(6, valueCount * 2)
      const contentScore =
        Math.min(18, visibleItems.length * 3)
        + Math.min(10, Math.round(typeCount * 2.5))
        + Math.min(6, filledCount)

      const peers = signatures.filter((_, peerIndex) => peerIndex !== index)
      const maxSimilarity = peers.length > 0
        ? Math.max(...peers.map((peer) => similarity(signatures[index], peer)))
        : 0.25
      const differentiationScore = Math.round((1 - maxSimilarity) * 24)
      const operationalScore = planCase.isFallback
        ? 12
        : Math.min(12, (conditions.length > 0 ? 8 : 0) + (questionCount > 1 ? 2 : 0) + (valueCount > 1 ? 2 : 0))
      const score = Math.max(0, Math.min(100, segmentScore + contentScore + differentiationScore + operationalScore))

      const reasons = []
      if (planCase.isFallback) reasons.push('모든 조건 미일치 사용자를 받는 기본 안전망')
      else if (questionCount >= 2) reasons.push(`${questionCount}개 설문 축을 조합한 구체적인 세그먼트`)
      else if (conditions.length > 0) reasons.push('명시적인 설문 조건으로 타깃이 정의됨')
      if (visibleItems.length >= 4) reasons.push(`노출 컴포넌트 ${visibleItems.length}개 · ${typeCount}종으로 구성`)
      else if (visibleItems.length > 0) reasons.push(`핵심 컴포넌트 ${visibleItems.length}개로 구성`)
      if (differentiationScore >= 18 && planCases.length > 1) reasons.push('다른 케이스와 조건 중복이 낮음')

      const issues = []
      if (visibleItems.length === 0) issues.push('실행 화면이 비어 있음')
      if (!planCase.isFallback && conditions.length === 0) issues.push('유효한 설문 조건이 없음')
      if (visibleItems.length > 0 && filledCount < visibleItems.length) {
        issues.push(`내용을 더 채울 컴포넌트 ${visibleItems.length - filledCount}개`)
      }

      return {
        caseId: planCase.id,
        index,
        score,
        reasons: reasons.slice(0, 3),
        issues,
        metrics: { conditions: conditions.length, questions: questionCount, items: visibleItems.length, types: typeCount },
      }
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
}

export function recommendSignificantCaseIds(planCases, count) {
  const limit = Math.max(1, Math.min(planCases.length, Number(count) || 1))
  const ranked = rankSignificantCases(planCases)
  if (ranked.length <= 1) return ranked.map((entry) => entry.caseId)

  /*
   * 조합형 시나리오는 완성도가 같은 케이스가 수십 개일 수 있다.
   * 단순 상위 N개를 자르면 인접한 유사 조합만 뽑히므로, 첫 케이스 이후에는
   * 자동 점수 + 이미 고른 조건들과의 최소 차별성을 함께 최대화한다(MMR 방식).
   */
  const byId = Object.fromEntries(planCases.map((planCase) => [planCase.id, planCase]))
  const selected = [ranked[0]]
  while (selected.length < limit) {
    const next = ranked
      .filter((entry) => !selected.some((chosen) => chosen.caseId === entry.caseId))
      .map((entry) => {
        const signature = conditionTokens(byId[entry.caseId])
        const closestSimilarity = Math.max(
          ...selected.map((chosen) => similarity(signature, conditionTokens(byId[chosen.caseId])))
        )
        return {
          entry,
          shortlistScore: entry.score + Math.round((1 - closestSimilarity) * 24),
        }
      })
      .sort((left, right) =>
        (right.shortlistScore - left.shortlistScore)
        || (right.entry.score - left.entry.score)
        || (left.entry.index - right.entry.index)
      )[0]
    if (!next) break
    selected.push(next.entry)
  }
  return selected.map((entry) => entry.caseId)
}

/*
 * 미평가 케이스 로테이션: 재선정은 평가 흔적이 있는 케이스를 후보에서 빼고 뽑는다 —
 * 이미 본 케이스를 다시 뽑으면 평가의 정보 이득이 없기 때문. 미평가가 모자라면
 * 평가된 케이스로 채워 A/B/C 3개 구성은 항상 유지한다.
 */
export function recommendRotationCaseIds(planCases, count) {
  const fresh = planCases.filter((planCase) => !caseHasEvaluationInput(planCase))
  const ids = fresh.length > 0
    ? recommendSignificantCaseIds(fresh, Math.min(count, fresh.length))
    : []
  const freshCount = ids.length
  if (ids.length < count) {
    const picked = new Set(ids)
    const rest = planCases.filter((planCase) => !picked.has(planCase.id))
    if (rest.length > 0) ids.push(...recommendSignificantCaseIds(rest, count - ids.length))
  }
  return { ids: ids.slice(0, count), freshCount }
}
