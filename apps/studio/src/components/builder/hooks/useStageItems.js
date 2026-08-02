import { planCasesForScenario } from '../../../lib/store.js'

/*
 * "지금 편집 중인 아이템 목록은 어디서 읽고 어디에 저장하는가" 한 가지만 담당한다.
 *
 * 탐색 단계는 계정이 소유한 공통 페이지, 설문은 시나리오의 stages, 계획은 활성 케이스의 items로
 * 저장 위치가 갈린다. 이 분기가 예전에는 Builder 곳곳의 setItems 호출부에 스며 있었다.
 *
 * setItems — 사용자 편집. Undo 스냅샷을 남긴다. 업데이터(함수)만 받는다:
 * 드래그 커밋이 setTimeout으로 미뤄지므로 값으로 덮어쓰면 낡은 클로저가 최신 상태를 지운다.
 */
export function useStageItems({ api, scenario, stageKey, planCaseId, previewMode, pushHistory }) {
  const isExplore = stageKey === 'explore'
  const isPlan = stageKey === 'plan'

  /* 업데이터가 같은 참조를 돌려주면 바깥 객체도 그대로 둔다 — updateScenario/patchActive의
     동일 참조 스킵과 한 몸이다. 이 사슬이 끊기면 무변경 쓰기가 updatedAt을 다시 찍고
     서버 미저장 배지를 켠다 */
  const write = (updater) => {
    if (isExplore) {
      api.updateExplore((prev) => {
        const items = prev.items || []
        const next = updater(items)
        return next === items ? prev : { ...prev, items: next }
      })
      return
    }
    if (isPlan) {
      api.updateScenario(scenario.id, (s) => {
        const base = s.planCases || planCasesForScenario(s)
        let changed = false
        const planCases = base.map((planCase) => {
          if (planCase.id !== planCaseId) return planCase
          const items = planCase.items || []
          const next = updater(items)
          if (next === items) return planCase
          changed = true
          return { ...planCase, items: next }
        })
        return changed || base !== s.planCases ? { ...s, planCases } : s
      })
      return
    }
    api.updateScenario(scenario.id, (s) => {
      const items = s.stages[stageKey] || []
      const next = updater(items)
      return next === items ? s : { ...s, stages: { ...s.stages, [stageKey]: next } }
    })
  }

  const setItems = (updater) => {
    if (previewMode) return
    pushHistory()
    write(updater)
  }

  return { setItems }
}
