import { planCasesForScenario } from '../store.js'

/*
 * 발행 · 버전 스냅샷 — 시나리오를 "내보내기 직전"에 검사하고 굳히는 규칙.
 *
 * 발행은 되돌리기 어려운 동작(홈에 칩이 뜬다)이라 사전 점검과 스냅샷 보관이 붙어 있다.
 * 판단 로직만 여기 두고, 확인 대화상자와 토스트는 호출부가 담당한다.
 */

/* 발행 전 점검 — 막지는 않고 사용자에게 보여줄 경고 문구만 만든다 */
export function publishWarnings(scenario, planCases) {
  const warnings = []
  if ((scenario.stages.survey || []).length === 0) warnings.push('설문 단계가 비어 있어요.')

  const empty = planCases.filter((planCase) => (planCase.items || []).length === 0)
  if (empty.length > 0) warnings.push(`빈 계획 케이스: ${empty.map((planCase) => planCase.name).join(', ')}`)

  const incomplete = planCases.filter((planCase) =>
    !planCase.isFallback && (
      !planCase.conditions.length
      || planCase.conditions.some((condition) => {
        // answered/unanswered는 값 없이 성립하는 조건이라 값 검사에서 제외한다
        const needsValues = !['answered', 'unanswered'].includes(condition.operator)
        return !condition.questionId || (needsValues && (!condition.values || condition.values.length === 0))
      })
    )
  )
  if (incomplete.length > 0) {
    warnings.push(`조건 미완성 케이스: ${incomplete.map((planCase) => planCase.name).join(', ')}`)
  }
  return warnings
}

/* 칩 라벨이 비어 있으면 제목에서 만들어 채운다 (홈에 빈 "✦#" 칩이 뜨지 않게) */
export function resolveChipLabel(scenario) {
  const cleaned = (scenario.chip || '').replace(/^#+/, '').trim()
  const fallback = (scenario.title || '').trim().replace(/\s+/g, '_') || '시나리오'
  return cleaned || fallback
}

/* 발행 시점 스냅샷 — 최근 10개만 보관한다 */
export function publishSnapshot(scenario, planCases, chip) {
  return {
    at: new Date().toISOString(),
    title: scenario.title,
    chip,
    device: scenario.device,
    stages: JSON.parse(JSON.stringify(scenario.stages)),
    planCases: JSON.parse(JSON.stringify(planCases)),
  }
}

export const VERSION_LIMIT = 10

/* 스냅샷 → 시나리오 패치. 깊은 복사해야 복원본과 스냅샷이 편집을 공유하지 않는다 */
export function scenarioFromSnapshot(snapshot) {
  return {
    title: snapshot.title,
    chip: snapshot.chip,
    device: snapshot.device,
    stages: JSON.parse(JSON.stringify(snapshot.stages)),
    planCases: JSON.parse(JSON.stringify(planCasesForScenario({
      stages: snapshot.stages,
      planCases: snapshot.planCases,
    }))),
  }
}

/* 기기 폭 전환: 모든 아이템의 x/w를 비율로 환산 (스냅샷 저장 형식은 그대로) */
export function rescaleForDevice(scenario, preset, { pad, minItemW, currentCanvasW }) {
  const ratio = (preset.w - pad * 2) / (currentCanvasW - pad * 2)
  const maxItemW = preset.w - pad * 2
  const resize = (list) => (list || []).map((item) => {
    const w = Math.max(minItemW, Math.min(maxItemW, Math.round(item.w * ratio)))
    const x = Math.max(0, Math.min(preset.w - pad - w, Math.round(pad + (item.x - pad) * ratio)))
    return { ...item, w, x }
  })
  const stages = {}
  Object.keys(scenario.stages).forEach((key) => { stages[key] = resize(scenario.stages[key]) })
  return {
    device: preset.key,
    stages,
    planCases: (scenario.planCases || planCasesForScenario(scenario)).map((planCase) => ({
      ...planCase,
      items: resize(planCase.items),
    })),
  }
}
