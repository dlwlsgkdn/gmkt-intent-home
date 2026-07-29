/*
 * 데이터 계층 진입점 — 네 개 모듈을 하나로 묶어 내보낸다.
 *
 *   store/model.js       데이터 형태 (아이템·시나리오·표시 상수)
 *   store/planCases.js   계획 케이스의 조건 형태와 평가 규칙
 *   store/defaults.js    첫 실행 기본값 (탐색 페이지·프로필·키워드)
 *   store/persistence.js localStorage·계정·전체 백업
 *
 * 앱 코드는 계속 'lib/store.js'에서 가져오면 되고, 어느 모듈이 무엇을 책임지는지는
 * 위 목록으로 확인한다. 새 함수를 넣을 때는 이 파일이 아니라 해당 모듈에 넣을 것.
 */
export {
  uid,
  DEVICE_PRESETS,
  CHIP_COLORS,
  hexToRgba,
  STAGES,
  createItem,
  createScenario,
  normalizeScenario,
  sortByPosition,
  splitList,
  splitTextList,
  joinTextList,
  splitOptions,
  joinOptions,
} from './store/model.js'

export {
  PLAN_CONDITION_OPERATORS,
  createPlanCondition,
  createPlanCase,
  planCasesForScenario,
  planConditionMatches,
  planCaseMatches,
  resolvePlanCase,
} from './store/planCases.js'

export {
  DEFAULT_EXPLORE,
  DEFAULT_PROFILE,
  DEFAULT_KEYWORDS,
  exploreItemsFrom,
  visibleProfileItems,
} from './store/defaults.js'

export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  createAccount,
  normalizeAccountsState,
  loadAccounts,
  saveAccounts,
  loadKeywords,
  saveKeywords,
  loadViewerDevice,
  saveViewerDevice,
  createDataBackup,
  createScenariosExport,
  classifyImportPayload,
  parseDataBackup,
} from './store/persistence.js'
