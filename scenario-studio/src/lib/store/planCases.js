import { normalizeCaseEvaluation } from '../evaluation.js'
import { uid } from './model.js'

/*
 * 계획 케이스 — 조건의 형태와 평가 규칙.
 *
 * 계획은 화면 하나가 아니라 조건과 독립 캔버스를 가진 여러 케이스다.
 * 일반 케이스를 위에서부터 평가해 첫 일치를 쓰고, 아무것도 맞지 않으면 폴백을 쓴다.
 * 폴백은 언제나 정확히 하나이고 목록의 끝에 온다 — 그 불변식은 planCasesForScenario가 지킨다.
 */

export const PLAN_CONDITION_OPERATORS = [
  { key: 'includesAny', label: '다음 중 하나를 선택', needsValues: true },
  { key: 'includesAll', label: '다음을 모두 선택', needsValues: true },
  { key: 'excludesAny', label: '다음을 하나도 선택하지 않음', needsValues: true },
  { key: 'answered', label: '응답함', needsValues: false },
  { key: 'unanswered', label: '응답하지 않음', needsValues: false },
]

export function createPlanCondition(partial = {}) {
  return {
    id: uid(),
    questionId: '',
    operator: 'includesAny',
    values: [],
    ...partial,
  }
}

export function createPlanCase(partial = {}) {
  return {
    id: uid(),
    name: '새 계획 케이스',
    conditionMode: 'all', // 'all'(AND) | 'any'(OR)
    conditions: [],
    isFallback: false,
    items: [],
    evaluation: normalizeCaseEvaluation(),
    ...partial,
  }
}

function normalizePlanCondition(raw) {
  const operator = PLAN_CONDITION_OPERATORS.some((op) => op.key === raw?.operator)
    ? raw.operator
    : 'includesAny'
  return createPlanCondition({
    ...(raw || {}),
    id: String(raw?.id || uid()),
    questionId: String(raw?.questionId || ''),
    operator,
    values: Array.isArray(raw?.values)
      ? raw.values.map(String)
      : raw?.value != null
        ? [String(raw.value)] // 구버전 단일 값 형식
        : [],
  })
}

function normalizePlanCase(raw, index) {
  return createPlanCase({
    ...(raw || {}),
    id: String(raw?.id || uid()),
    name: String(raw?.name || `계획 케이스 ${index + 1}`),
    conditionMode: raw?.conditionMode === 'any' ? 'any' : 'all',
    conditions: Array.isArray(raw?.conditions) ? raw.conditions.map(normalizePlanCondition) : [],
    isFallback: !!raw?.isFallback,
    items: Array.isArray(raw?.items) ? raw.items : [],
    evaluation: normalizeCaseEvaluation(raw?.evaluation),
  })
}

/* 구 데이터(stages.plan[])를 기본 케이스 하나로 무손실 변환하고,
   폴백이 정확히 하나·맨 끝이라는 불변식을 강제한다. */
export function planCasesForScenario(scenario) {
  const source = Array.isArray(scenario?.planCases) && scenario.planCases.length > 0
    ? scenario.planCases
    : [createPlanCase({
        name: '기본 계획',
        isFallback: true,
        items: Array.isArray(scenario?.stages?.plan) ? scenario.stages.plan : [],
      })]
  const cases = source.map(normalizePlanCase)
  const fallbackIndex = cases.findIndex((planCase) => planCase.isFallback)
  const keepFallback = fallbackIndex >= 0 ? fallbackIndex : cases.length - 1
  const marked = cases.map((planCase, index) => ({ ...planCase, isFallback: index === keepFallback }))
  const fallback = marked.find((planCase) => planCase.isFallback)
  return [...marked.filter((planCase) => !planCase.isFallback), fallback]
}

const answerValues = (answer) => {
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean)
  if (answer == null || answer === '') return []
  return [String(answer)]
}

export function planConditionMatches(condition, answers) {
  if (!condition?.questionId) return false
  const selected = answerValues(answers?.[condition.questionId])
  const values = Array.isArray(condition.values) ? condition.values.map(String).filter(Boolean) : []
  if (condition.operator === 'answered') return selected.length > 0
  if (condition.operator === 'unanswered') return selected.length === 0
  if (values.length === 0) return false
  if (condition.operator === 'includesAll') return values.every((value) => selected.includes(value))
  if (condition.operator === 'excludesAny') return values.every((value) => !selected.includes(value))
  return values.some((value) => selected.includes(value))
}

export function planCaseMatches(planCase, answers) {
  if (!planCase || planCase.isFallback || !Array.isArray(planCase.conditions) || planCase.conditions.length === 0) {
    return false
  }
  const results = planCase.conditions.map((condition) => planConditionMatches(condition, answers))
  return planCase.conditionMode === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/* 조건이 겹치면 배열 순서가 우선순위다. 미일치 시 기본 케이스, 그것도 없으면 첫 케이스. */
export function resolvePlanCase(scenario, answers) {
  const cases = planCasesForScenario(scenario)
  return cases.find((planCase) => planCaseMatches(planCase, answers))
    || cases.find((planCase) => planCase.isFallback)
    || cases[0]
}
