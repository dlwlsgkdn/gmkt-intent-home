import { planCasesForScenario } from '../../../lib/store.js'

/*
 * "지금 편집 중인 아이템 목록은 어디서 읽고 어디에 저장하는가" 한 가지만 담당한다.
 *
 * 탐색 단계는 계정이 소유한 공통 페이지, 설문은 시나리오의 stages, 계획은 활성 케이스의 items로
 * 저장 위치가 갈린다. 이 분기가 예전에는 Builder 곳곳의 setItems 호출부에 스며 있었다.
 *
 * setItems  — 사용자 편집. Undo 스냅샷을 남긴다.
 * setItemsFromMeasure — 높이 재측정에 따른 자동 보정. 사용자 편집이 아니므로 Undo에 넣지 않는다.
 *
 * 두 함수 모두 업데이터(함수)만 받는다: 드래그/보정 커밋이 setTimeout으로 미뤄지므로
 * 값으로 덮어쓰면 낡은 클로저가 최신 상태를 지운다.
 */
export function useStageItems({ api, scenario, stageKey, planCaseId, previewMode, pushHistory }) {
  const isExplore = stageKey === 'explore'
  const isPlan = stageKey === 'plan'

  const write = (updater) => {
    if (isExplore) {
      api.updateExplore((prev) => ({ ...prev, items: updater(prev.items || []) }))
      return
    }
    if (isPlan) {
      api.updateScenario(scenario.id, (s) => ({
        ...s,
        planCases: (s.planCases || planCasesForScenario(s)).map((planCase) =>
          planCase.id === planCaseId
            ? { ...planCase, items: updater(planCase.items || []) }
            : planCase
        ),
      }))
      return
    }
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      stages: { ...s.stages, [stageKey]: updater(s.stages[stageKey] || []) },
    }))
  }

  const setItems = (updater) => {
    if (previewMode) return
    pushHistory()
    write(updater)
  }

  const setItemsFromMeasure = (updater) => {
    if (previewMode) return
    write(updater)
  }

  return { setItems, setItemsFromMeasure }
}
