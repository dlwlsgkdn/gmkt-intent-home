import {
  EVALUATION_CASE_SLOTS,
  caseHasEvaluationInput,
  liveComponentEntries,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
} from './model.js'
import { componentEvaluationStructureForCase } from './structure.js'

/*
 * 쌓인 평가의 집계 — 평가 화면이 읽는 뷰.
 *
 * 선정된 CASE A/B/C의 진행률(structuredComponentEvaluationStats)과, 로테이션으로
 * 누적된 전체 케이스의 리더보드(evaluationLeaderboard)를 만든다. 리더보드 순위는
 * 피드백 전체 반영(propagation)의 씨앗 우선순위로 그대로 쓰인다.
 */

export function evaluationCasesFor(planCases = []) {
  const selected = planCases.filter(
    (planCase) => normalizeCaseEvaluation(planCase.evaluation).selection.active
  )
  return [...selected].sort((left, right) => {
    const leftSlot = EVALUATION_CASE_SLOTS.indexOf(normalizeCaseEvaluation(left.evaluation).selection.slot)
    const rightSlot = EVALUATION_CASE_SLOTS.indexOf(normalizeCaseEvaluation(right.evaluation).selection.slot)
    const safeLeft = leftSlot >= 0 ? leftSlot : 999
    const safeRight = rightSlot >= 0 ? rightSlot : 999
    return safeLeft - safeRight
  })
}

/* 평가된 케이스를 평균 별점 내림차순으로 — 로테이션 라운드가 쌓여도 평가 자산이 흩어지지 않는 자리.
   집계는 live 레코드만 센다 — 삭제·재구성으로 화면에서 사라진 컴포넌트의 고아 평가가
   평균과 개수를 부풀리지 않게 */
export function evaluationLeaderboard(planCases = []) {
  return planCases
    .map((planCase, index) => ({ planCase, index }))
    .filter(({ planCase }) => caseHasEvaluationInput(planCase))
    .map(({ planCase, index }) => {
      const evaluation = normalizeCaseEvaluation(planCase.evaluation)
      const reviews = liveComponentEntries(planCase).map(([, review]) => review)
      const ratings = reviews
        .filter((review) => review.score != null)
        .map((review) => review.score)
      if (evaluation.review.score != null) ratings.push(evaluation.review.score)
      const feedbackCount = reviews.filter((review) => review.feedback.trim()).length
        + (evaluation.review.feedback.trim() ? 1 : 0)
      const round = Math.max(
        evaluation.review.round,
        ...reviews.map((review) => review.round),
        0
      )
      return {
        caseId: planCase.id,
        planCase,
        index,
        slot: evaluation.selection.active ? evaluation.selection.slot : null,
        round: round > 0 ? round : null,
        average: ratings.length > 0
          ? Math.round((ratings.reduce((sum, score) => sum + score, 0) / ratings.length) * 10) / 10
          : null,
        ratedCount: ratings.length,
        feedbackCount,
      }
    })
    .sort((left, right) =>
      ((right.average ?? -1) - (left.average ?? -1))
      || (right.feedbackCount - left.feedbackCount)
      || (left.index - right.index)
    )
    .map((entry, order) => ({ ...entry, rank: order + 1 }))
}

/* 선정된 CASE A/B/C의 컴포넌트 단위 진행률·평균과 컴포넌트 타입별 집계 */
export function structuredComponentEvaluationStats(planCases = []) {
  const selectedCases = evaluationCasesFor(planCases)
  const caseStats = EVALUATION_CASE_SLOTS.map((slot) => {
    const planCase = selectedCases.find(
      (candidate) => normalizeCaseEvaluation(candidate.evaluation).selection.slot === slot
    ) || null
    const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
    const sections = componentEvaluationStructureForCase(planCase)
    const sectionStats = sections.map((section) => {
      const componentStats = section.components.map((component) => ({
        component,
        review: normalizeComponentEvaluation(evaluation.components[component.itemId]),
      }))
      const completed = componentStats.filter(({ review }) => review.score != null).length
      const score = componentStats.reduce((sum, { review }) => sum + (review.score ?? 0), 0)
      return {
        ...section,
        componentStats,
        completed,
        total: componentStats.length,
        score,
        maxScore: componentStats.length * 5,
      }
    })
    return {
      slot,
      planCase,
      sections,
      sectionStats,
      completed: sectionStats.reduce((sum, section) => sum + section.completed, 0),
      total: sectionStats.reduce((sum, section) => sum + section.total, 0),
      score: sectionStats.reduce((sum, section) => sum + section.score, 0),
      maxScore: sectionStats.reduce((sum, section) => sum + section.maxScore, 0),
    }
  })

  const byType = new Map()
  caseStats.forEach((caseStat) => {
    caseStat.sectionStats.forEach((section) => {
      section.componentStats.forEach(({ component, review }) => {
        const stat = byType.get(component.type) || {
          type: component.type,
          completed: 0,
          total: 0,
          score: 0,
        }
        stat.total++
        if (review.score != null) {
          stat.completed++
          stat.score += review.score
        }
        byType.set(component.type, stat)
      })
    })
  })
  const typeStats = [...byType.values()].map((stat) => ({
    ...stat,
    average: stat.completed > 0
      ? Math.round((stat.score / stat.completed) * 10) / 10
      : null,
  }))
  const completed = caseStats.reduce((sum, caseStat) => sum + caseStat.completed, 0)
  const total = caseStats.reduce((sum, caseStat) => sum + caseStat.total, 0)
  const score = caseStats.reduce((sum, caseStat) => sum + caseStat.score, 0)
  const maxScore = caseStats.reduce((sum, caseStat) => sum + caseStat.maxScore, 0)
  return {
    completed,
    total,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    score,
    maxScore,
    average: completed > 0 ? Math.round((score / completed) * 10) / 10 : null,
    caseStats,
    typeStats,
  }
}
