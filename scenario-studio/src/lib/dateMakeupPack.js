import bundledScenarios from '../data/scenarios/date-makeup-plan-cases.json' with { type: 'json' }
import { createAccount, normalizeScenario } from './store.js'

export const DATE_MAKEUP_PACK_ID = 'date-makeup-plan-cases-with-content-v1'
export const DATE_MAKEUP_CASE_COUNT = 72

const LEGACY_PACK_IDS = new Set([
  'date-makeup-all-cases-v1',
  'date-makeup-all-cases-v1-merged-plan-cases',
])
const ALL_PACK_IDS = new Set([DATE_MAKEUP_PACK_ID, ...LEGACY_PACK_IDS])
const QUERY = '소개팅 때 안 무너지는 메이크업 추천'

const clone = (value) => JSON.parse(JSON.stringify(value))
const isPackScenario = (scenario) => ALL_PACK_IDS.has(scenario?.sourcePackId)
const isConditionalScenario = (scenario) =>
  Array.isArray(scenario?.planCases) && scenario.planCases.filter((planCase) => !planCase.isFallback).length > 1
export const isDefaultScenario = (scenario) => scenario?.isDefaultScenario === true

/*
 * 초기 시나리오는 src/data/scenarios의 JSON을 단일 소스로 사용한다.
 * 호출할 때마다 복제·정규화하여 React 상태에서 번들 원본이 변형되지 않게 한다.
 */
export function buildDateMakeupScenarios() {
  return bundledScenarios.map((raw) => normalizeScenario({
    ...clone(raw),
    sourcePackId: DATE_MAKEUP_PACK_ID,
    isDefaultScenario: true,
    status: 'published',
  }))
}

function withDateMakeupExplore(account) {
  const greeting = '선아님, 소개팅 끝까지 안 무너지는 메이크업 플랜을 골라볼까요?'
  return {
    ...account,
    explore: {
      ...account.explore,
      greeting,
      searchPlaceholder: QUERY,
      items: (account.explore?.items || []).map((item) => {
        if (item.type === 'greeting') return { ...item, props: { ...item.props, text: greeting } }
        if (item.type === 'searchBox') return { ...item, props: { ...item.props, placeholder: QUERY } }
        return item
      }),
    },
  }
}

export function buildDateMakeupAccount() {
  const account = createAccount({
    sourcePackId: DATE_MAKEUP_PACK_ID,
    profile: {
      name: '선아',
      items: [
        { label: '나이대', value: '20대 후반' },
        { label: '성별', value: '여성' },
        { label: '피부타입', value: '수부지' },
        { label: '퍼스널 컬러', value: '여름 쿨톤' },
        { label: '뷰티관심도', value: '중상' },
      ],
    },
    scenarios: buildDateMakeupScenarios(),
    threads: [],
  })
  return withDateMakeupExplore(account)
}

/*
 * 한 계정에 존재하는 구 72개 팩과 수동 가져오기 통합본을 하나로 정리한다.
 * 이미 새 팩 또는 조건부 통합본을 편집했다면 그 데이터를 우선 보존하고,
 * 구 72개밖에 없을 때만 번들 JSON을 새로 설치한다.
 */
export function installDateMakeupScenario(account) {
  const scenarios = Array.isArray(account.scenarios) ? account.scenarios : []
  const packScenarios = scenarios.filter((scenario) => isPackScenario(scenario) || isDefaultScenario(scenario))
  const reusable =
    packScenarios.find(isDefaultScenario)
    || packScenarios.find((scenario) => scenario.sourcePackId === DATE_MAKEUP_PACK_ID)
    || packScenarios.find(isConditionalScenario)
  const installed = reusable
    ? normalizeScenario({
        ...clone(reusable),
        sourcePackId: DATE_MAKEUP_PACK_ID,
        isDefaultScenario: true,
        status: 'published',
      })
    : buildDateMakeupScenarios()[0]

  return {
    ...account,
    scenarios: [
      ...scenarios.filter((scenario) => !isPackScenario(scenario) && !isDefaultScenario(scenario)),
      installed,
    ],
  }
}

/*
 * 모든 프로필 워크스페이스에 기본 시나리오를 하나씩 설치한다.
 * 과거 72개 개별 팩이나 수동 통합본이 있는 프로필은 해당 데이터를 재사용하고,
 * 없는 프로필은 번들 JSON으로 새로 설치한다.
 */
export function installDateMakeupPack(initial) {
  const sourceAccounts = Array.isArray(initial.accounts) && initial.accounts.length > 0
    ? initial.accounts
    : [createAccount()]
  const accounts = sourceAccounts.map(installDateMakeupScenario)
  const activeId = accounts.some((account) => account.id === initial.activeId)
    ? initial.activeId
    : accounts[0].id
  return { ...initial, accounts, activeId }
}
