import { DEVICE_PRESETS, normalizeScenario, uid } from './model.js'
import { DEFAULT_EXPLORE, DEFAULT_KEYWORDS, DEFAULT_PROFILE, exploreItemsFrom } from './defaults.js'

/*
 * localStorage 영속화와 계정(프로필별 워크스페이스), 전체 백업.
 *
 * 여기가 브라우저 저장소를 아는 유일한 곳이다. 저장소 접근은 전부 try/catch로 감싼다
 * (프라이빗 모드·용량 초과에서 던지면 앱 전체가 멈춘다).
 *
 * 계정 = 프로필 + 탐색 페이지 + 시나리오 + 쓰레드 묶음. 프로필을 전환하면 넷이 함께 바뀐다.
 * v1 시절의 단일 키들은 최초 실행 시 첫 계정으로 한 번만 이관하고 원본은 남겨 둔다.
 */

const ACCOUNTS_KEY = 'ddak-accounts-v1'
const KEYWORDS_KEY = 'ddak-keywords-v1'
const VIEWER_KEY = 'ddak-viewer-device-v1'
/* 구(v1 단일 키) — 마이그레이션 전용 */
const LEGACY_SCENARIOS_KEY = 'ddak-scenarios-v1'
const LEGACY_PROFILE_KEY = 'ddak-profile-v1'
const LEGACY_EXPLORE_KEY = 'ddak-explore-page-v1'
const LEGACY_THREADS_KEY = 'ddak-threads-v1'

export const BACKUP_FORMAT = 'ddak-scenario-studio-backup'
export const BACKUP_VERSION = 1

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 저장 실패는 무시 — 세션 내 상태로만 동작한다 */
  }
}

/* ── 뷰어 기기 설정 (탐색/설문/계획 실행 화면의 모바일 프레임 폭) ── */
export function loadViewerDevice() {
  try {
    const key = localStorage.getItem(VIEWER_KEY)
    return DEVICE_PRESETS.some((preset) => preset.key === key) ? key : 'iphone-15'
  } catch {
    return 'iphone-15'
  }
}

export function saveViewerDevice(key) {
  try {
    localStorage.setItem(VIEWER_KEY, key)
  } catch {
    /* ignore */
  }
}

/* ── 키워드 사전 ── */
export function loadKeywords() {
  const parsed = readJson(KEYWORDS_KEY, null)
  return Array.isArray(parsed) ? parsed : DEFAULT_KEYWORDS
}

export function saveKeywords(list) {
  writeJson(KEYWORDS_KEY, list)
}

/* ── 계정 ── */
export function createAccount(partial = {}) {
  const explore = JSON.parse(JSON.stringify(DEFAULT_EXPLORE))
  explore.items = exploreItemsFrom(explore)
  return {
    id: uid(),
    profile: JSON.parse(JSON.stringify(DEFAULT_PROFILE)),
    explore,
    scenarios: [],
    threads: [],
    createdAt: new Date().toISOString(),
    ...partial,
  }
}

/* 계정 보정: 탐색 페이지에 아이템이 없으면 기존 설정으로부터 만들고,
   모든 시나리오를 현재 계획 케이스 모델로 이관한다. */
function normalizeAccount(raw) {
  const account = { ...createAccount(), ...raw }
  if (!account.explore || typeof account.explore !== 'object') {
    account.explore = JSON.parse(JSON.stringify(DEFAULT_EXPLORE))
  }
  if (!Array.isArray(account.explore.items) || account.explore.items.length === 0) {
    account.explore = { ...account.explore, items: exploreItemsFrom(account.explore) }
  }
  account.scenarios = Array.isArray(account.scenarios) ? account.scenarios.map(normalizeScenario) : []
  return account
}

/* {accounts[], activeId} 원시 데이터(localStorage/서버 공용)를 보정. 유효하지 않으면 null */
export function normalizeAccountsState(parsed) {
  if (!parsed || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) return null
  const accounts = parsed.accounts.map(normalizeAccount)
  const activeId = accounts.some((account) => account.id === parsed.activeId) ? parsed.activeId : accounts[0].id
  return { accounts, activeId }
}

export function loadAccounts() {
  const state = normalizeAccountsState(readJson(ACCOUNTS_KEY, null))
  if (state) return state
  // 최초 실행: 기존 단일 저장소(v1 키들)를 첫 계정으로 이관 (원본 키는 남겨 둔다)
  const legacyProfile = readJson(LEGACY_PROFILE_KEY, null)
  const legacyExplore = readJson(LEGACY_EXPLORE_KEY, null)
  const legacyScenarios = readJson(LEGACY_SCENARIOS_KEY, null)
  const legacyThreads = readJson(LEGACY_THREADS_KEY, null)
  const first = normalizeAccount({
    profile: legacyProfile
      ? { ...DEFAULT_PROFILE, ...legacyProfile, items: Array.isArray(legacyProfile.items) ? legacyProfile.items : DEFAULT_PROFILE.items }
      : DEFAULT_PROFILE,
    explore: legacyExplore
      ? {
          ...DEFAULT_EXPLORE,
          ...legacyExplore,
          stories: Array.isArray(legacyExplore.stories) && legacyExplore.stories.length === 3
            ? legacyExplore.stories
            : DEFAULT_EXPLORE.stories,
        }
      : DEFAULT_EXPLORE,
    scenarios: Array.isArray(legacyScenarios) ? legacyScenarios : [],
    threads: Array.isArray(legacyThreads) ? legacyThreads : [],
  })
  return { accounts: [first], activeId: first.id }
}

export function saveAccounts(accounts, activeId) {
  writeJson(ACCOUNTS_KEY, { accounts, activeId })
}

/* ── JSON 파일 입출력 (드로어 통합 입출력의 형식 계층) ──
   내보내기는 공통 봉투 { format: 'ddak-export', version, scope, exportedAt, data } 하나로
   통일하고 scope('scenarios' | 'workspace')로 범위를 구분한다. 가져오기는 봉투 없이
   내보냈던 구형 파일(맨 시나리오 배열·빌더의 시나리오 객체·구 백업 봉투)도 계속 인식한다. */
export const EXPORT_FORMAT = 'ddak-export'
export const EXPORT_VERSION = 1

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

export function createScenariosExport(scenarios) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    scope: 'scenarios',
    exportedAt: new Date().toISOString(),
    data: scenarios,
  }
}

export function createDataBackup({ accounts, activeAccountId, keywords, viewerDevice }) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    scope: 'workspace',
    exportedAt: new Date().toISOString(),
    data: { accounts, activeAccountId, keywords, viewerDevice },
  }
}

/* 가져온 JSON이 무엇인지 판별 — 드로어의 단일 가져오기 입구가 확인 다이얼로그를 고르는 근거.
   시나리오 판별 기준(stages 객체)은 빌더 가져오기와 같다. 반환: kind='workspace'(전체 복원,
   payload는 parseDataBackup에 그대로 전달) | 'scenarios'(목록 추가) | 'unknown' */
export function classifyImportPayload(payload) {
  if (Array.isArray(payload)) return { kind: 'scenarios', scenarios: payload } // 구형 목록 내보내기
  if (!isObject(payload)) return { kind: 'unknown' }
  if (payload.format === EXPORT_FORMAT) {
    if (payload.scope === 'workspace') return { kind: 'workspace', payload }
    if (payload.scope === 'scenarios' && Array.isArray(payload.data)) return { kind: 'scenarios', scenarios: payload.data }
    if (payload.scope === 'scenario' && isObject(payload.data)) return { kind: 'scenarios', scenarios: [payload.data] }
    return { kind: 'unknown' }
  }
  if (payload.format === BACKUP_FORMAT) return { kind: 'workspace', payload } // 구형 전체 백업
  if (isObject(payload.stages)) return { kind: 'scenarios', scenarios: [payload] } // 빌더의 시나리오 한 개 파일
  return { kind: 'unknown' }
}

/* 외부 JSON을 앱 상태에 넣기 전 구조를 검증하고 현재 데이터 모델로 보정한다.
   복원은 기존 데이터를 통째로 갈아끼우므로, 통과 조건을 느슨하게 두지 않는다.
   신 봉투(ddak-export/workspace)와 구 봉투(BACKUP_FORMAT) 둘 다 받는다. */
export function parseDataBackup(payload) {
  const isNew = isObject(payload) && payload.format === EXPORT_FORMAT && payload.scope === 'workspace'
  const isLegacy = isObject(payload) && payload.format === BACKUP_FORMAT
  if (!isNew && !isLegacy) {
    throw new Error('DDAK 전체 백업 파일이 아니에요.')
  }
  if (payload.version !== (isNew ? EXPORT_VERSION : BACKUP_VERSION)) {
    throw new Error(`지원하지 않는 백업 버전이에요. (버전 ${payload.version || '없음'})`)
  }

  const data = payload.data
  if (!isObject(data) || !Array.isArray(data.accounts) || data.accounts.length === 0) {
    throw new Error('백업에 프로필 계정 정보가 없어요.')
  }
  if (!Array.isArray(data.keywords)) {
    throw new Error('백업의 키워드 사전 형식이 올바르지 않아요.')
  }
  if (!DEVICE_PRESETS.some((preset) => preset.key === data.viewerDevice)) {
    throw new Error('백업의 기기 설정이 올바르지 않아요.')
  }

  const accounts = data.accounts.map((raw, index) => {
    if (!isObject(raw) || !isObject(raw.profile) || !Array.isArray(raw.profile.items)) {
      throw new Error(`${index + 1}번째 프로필 정보가 올바르지 않아요.`)
    }
    if (!isObject(raw.explore) || !Array.isArray(raw.scenarios) || !Array.isArray(raw.threads)) {
      throw new Error(`${index + 1}번째 워크스페이스 정보가 올바르지 않아요.`)
    }
    if (raw.scenarios.some((scenario) => !isObject(scenario) || !isObject(scenario.stages))) {
      throw new Error(`${index + 1}번째 프로필의 시나리오 형식이 올바르지 않아요.`)
    }
    return normalizeAccount({ ...raw, id: String(raw.id || uid()) })
  })

  const activeId = accounts.some((account) => account.id === data.activeAccountId)
    ? data.activeAccountId
    : accounts[0].id

  return { accounts, activeId, keywords: data.keywords, viewerDevice: data.viewerDevice }
}
