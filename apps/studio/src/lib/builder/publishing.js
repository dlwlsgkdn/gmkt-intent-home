import { normalizeItems, planCasesForScenario } from '../store.js'

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

/* 발행 시점 스냅샷 — 최근 5개만 보관한다. 스냅샷은 시나리오 전체 사본이라(케이스 73개면
   개당 ~0.6MB) 개수가 곧 저장 페이로드 크기다 — 서버 미러링이 계정 행 단위(Vercel 본문
   한도 4.5MB)라 한도를 넉넉히 잡으면 발행 몇 번에 계정 행이 한도를 넘는다 */
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

export const VERSION_LIMIT = 5

/* 스냅샷 → 시나리오 패치. 깊은 복사해야 복원본과 스냅샷이 편집을 공유하지 않는다.
   versionAt은 "현재 편집본이 어느 발행 버전에서 왔는지" 표시 — 발행·복원 때만 갱신된다.
   구 좌표 모델 시절의 스냅샷은 normalizeItems가 복원 시점에 순서 모델로 이관한다
   (스냅샷 원본은 불변 기록으로 그대로 둔다 — 여기서 만드는 사본만 이관). */
export function scenarioFromSnapshot(snapshot) {
  const stages = JSON.parse(JSON.stringify(snapshot.stages))
  Object.keys(stages).forEach((key) => { stages[key] = normalizeItems(stages[key]) })
  return {
    versionAt: snapshot.at,
    title: snapshot.title,
    chip: snapshot.chip,
    device: snapshot.device,
    stages,
    planCases: JSON.parse(JSON.stringify(planCasesForScenario({
      stages,
      planCases: snapshot.planCases,
    }))),
  }
}
