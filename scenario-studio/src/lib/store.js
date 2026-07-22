const STORAGE_KEY = 'ddak-scenarios-v1'

export function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)
}

/* 캔버스/플레이어 기기 프리셋 (논리 픽셀 너비) */
export const DEVICE_PRESETS = [
  { key: 'desktop', label: '데스크톱', w: 720, icon: '🖥️' },
  { key: 'galaxy', label: '갤럭시 S (360)', w: 360, icon: '📱' },
  { key: 'iphone-se', label: 'iPhone SE (375)', w: 375, icon: '📱' },
  { key: 'iphone-15', label: 'iPhone 15 (390)', w: 390, icon: '📱' },
  { key: 'iphone-pro-max', label: 'iPhone Pro Max (430)', w: 430, icon: '📱' },
  { key: 'tablet', label: '태블릿 (768)', w: 768, icon: '💻' },
]

/* 시나리오 칩 색상 프리셋 */
export const CHIP_COLORS = [
  { key: 'sage', label: '세이지', color: '#5f7465' },
  { key: 'rose', label: '로즈', color: '#b45a6b' },
  { key: 'blue', label: '블루', color: '#4a6b8a' },
  { key: 'amber', label: '앰버', color: '#a9762c' },
  { key: 'plum', label: '플럼', color: '#7b5a86' },
  { key: 'slate', label: '슬레이트', color: '#5b6673' },
]

export function hexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return `rgba(95, 116, 101, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/* 시나리오가 소유하는 단계: 설문 → 계획.
   탐색(홈)은 모든 시나리오가 공유하는 공통 페이지로, 칩 클릭이 곧 탐색 완료다. */
export const STAGES = [
  { key: 'survey', label: '설문', desc: '사용자에게 물어볼 질문 구성' },
  { key: 'plan', label: '계획', desc: '설문 후 보여줄 맞춤 계획' },
]

/* ── 공통 탐색(홈) 페이지 설정 ── */
export const DEFAULT_EXPLORE = {
  greeting: '유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?',
  searchPlaceholder: '예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업',
  searchOverflow: 'ellipsis', // 검색창 긴 텍스트 처리: 'ellipsis'(한 줄 말줄임) | 'multiline'(여러 줄)
  stories: [
    {
      kicker: 'Base Notes',
      title: '속광은 남기고 유분만 덜어내는 베이스',
      desc: '최근 쓰레드에서 반복된 키워드: 무너짐, 들뜸, 얇은 커버.',
      imageUrl: './makeup-clone-assets/d9b261330f3ffccf.avif',
    },
    {
      kicker: 'Color Mood',
      title: '맑은 로즈 한 끗',
      desc: '',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    {
      kicker: 'Pouch Edit',
      title: '1박 2일 파우치 최소 구성',
      desc: '',
      imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif',
    },
  ],
}

/* ── 사용자 프로필 (고정 설문 정보) — 모든 시나리오가 공유 ── */
export const DEFAULT_PROFILE = {
  name: '유진',
  items: [
    { label: '나이대', value: '20대 후반' },
    { label: '성별', value: '여성' },
    { label: '피부타입', value: '복합성' },
    { label: '퍼스널 컬러', value: '웜톤 봄 라이트' },
  ],
}

const PROFILE_KEY = 'ddak-profile-v1'

/* 구(v1 단일 키) 프로필 — loadAccounts 마이그레이션 전용 */
function loadLegacyProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return DEFAULT_PROFILE
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_PROFILE,
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items : DEFAULT_PROFILE.items,
    }
  } catch (e) {
    return DEFAULT_PROFILE
  }
}

/* 프로필 요약 패널 기준 노출 프로필 항목 —
   설문 단계 profilePanel 컴포넌트들이 숨긴 라벨을 제외한다 (플레이어·빌더 요약 공용) */
export function visibleProfileItems(profile, scenario) {
  const items = ((profile && profile.items) || []).filter((it) => it.label && it.label.trim())
  const hidden = (scenario.stages.survey || [])
    .filter((it) => it.type === 'profilePanel')
    .flatMap((it) => String(it.props.hidden || '').split(',').map((s) => s.trim()).filter(Boolean))
  return items.filter((it) => !hidden.includes(it.label))
}

/* ── 뷰어 기기 설정 — 탐색/설문/계획 실행 화면의 모바일 프레임 폭 ── */
const VIEWER_KEY = 'ddak-viewer-device-v1'

export function loadViewerDevice() {
  try {
    const key = localStorage.getItem(VIEWER_KEY)
    return DEVICE_PRESETS.some((d) => d.key === key) ? key : 'iphone-15'
  } catch (e) {
    return 'iphone-15'
  }
}

export function saveViewerDevice(key) {
  try {
    localStorage.setItem(VIEWER_KEY, key)
  } catch (e) {
    /* ignore */
  }
}

/* ── 키워드 사전 — 텍스트 안 [[키워드]]에 점선 밑줄 + 클릭 시 설명 모달 ── */
export const DEFAULT_KEYWORDS = [
  {
    word: '프라이머',
    desc: '메이크업 전에 피부 결과 모공을 매끈하게 정돈해 베이스의 밀착력을 높여주는 제품이에요.',
    points: '커버보다 결 정돈이 목적, T존 위주로 얇게, 손보다 퍼프 마무리',
  },
  {
    word: '픽서',
    desc: '완성한 메이크업 위에 분사해 고정력을 높여주는 스프레이예요. 유분·마찰에 의한 무너짐을 줄여줘요.',
    points: '얼굴에서 20cm 거리 유지, T존 위주로 한 번 더, 흔들어서 사용',
  },
  {
    word: '세라마이드',
    desc: '피부 장벽을 구성하는 지질 성분으로, 수분 손실을 막고 민감해진 피부를 진정시키는 데 도움을 줘요.',
    points: '건조·민감 피부에 적합, 레티놀과 함께 쓰기 좋은 진정 성분',
  },
]

const KEYWORDS_KEY = 'ddak-keywords-v1'

export function loadKeywords() {
  try {
    const raw = localStorage.getItem(KEYWORDS_KEY)
    if (!raw) return DEFAULT_KEYWORDS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_KEYWORDS
  } catch (e) {
    return DEFAULT_KEYWORDS
  }
}

export function saveKeywords(list) {
  try {
    localStorage.setItem(KEYWORDS_KEY, JSON.stringify(list))
  } catch (e) {
    /* ignore */
  }
}

/* ── 탐색(홈) 페이지의 캔버스 아이템 ──
   탐색 콘텐츠도 설문/계획과 같은 아이템 모델로 자유 배치·편집한다.
   구버전 설정(greeting/searchPlaceholder/stories)은 최초 1회 아이템으로 변환 */
export function exploreItemsFrom(config) {
  const cfg = { ...DEFAULT_EXPLORE, ...(config || {}) }
  const stories = Array.isArray(cfg.stories) && cfg.stories.length === 3 ? cfg.stories : DEFAULT_EXPLORE.stories
  const mk = (type, y, props, w = 672) => ({ id: uid(), type, x: 24, y, w, h: null, props })
  return [
    mk('greeting', 24, { text: cfg.greeting }),
    mk('searchBox', 170, { placeholder: cfg.searchPlaceholder, multiline: cfg.searchOverflow === 'multiline' }),
    mk('scenarioChips', 290, {}),
    mk('storyFeature', 380, { ...stories[0] }),
    mk('storyCard', 900, { kicker: stories[1].kicker, title: stories[1].title, imageUrl: stories[1].imageUrl }),
    mk('storyCard', 1300, { kicker: stories[2].kicker, title: stories[2].title, imageUrl: stories[2].imageUrl }),
  ]
}

/* ── 사용자 프로필별 워크스페이스(계정) ──
   계정 = 프로필 + 탐색(DDAK) 페이지 + 시나리오 + 쓰레드 묶음.
   프로필을 전환하면 네 가지가 함께 바뀐다. */
const ACCOUNTS_KEY = 'ddak-accounts-v1'
export const BACKUP_FORMAT = 'ddak-scenario-studio-backup'
export const BACKUP_VERSION = 1

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

/* 계정 보정: 탐색 페이지에 아이템이 없으면 기존 설정으로부터 생성 */
function normalizeAccount(a) {
  const acc = { ...createAccount(), ...a }
  if (!acc.explore || typeof acc.explore !== 'object') acc.explore = JSON.parse(JSON.stringify(DEFAULT_EXPLORE))
  if (!Array.isArray(acc.explore.items) || acc.explore.items.length === 0) {
    acc.explore = { ...acc.explore, items: exploreItemsFrom(acc.explore) }
  }
  return acc
}

export function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.accounts) && parsed.accounts.length > 0) {
        const accounts = parsed.accounts.map(normalizeAccount)
        const activeId = accounts.some((a) => a.id === parsed.activeId)
          ? parsed.activeId
          : accounts[0].id
        return { accounts, activeId }
      }
    }
  } catch (e) {
    /* 손상 시 아래 마이그레이션 경로로 */
  }
  // 최초 실행: 기존 단일 저장소(v1 키들)를 첫 계정으로 마이그레이션 (원본 키는 남겨둠)
  const first = normalizeAccount({
    profile: loadLegacyProfile(),
    explore: loadLegacyExplore(),
    scenarios: loadLegacyScenarios(),
    threads: loadLegacyThreads(),
  })
  return { accounts: [first], activeId: first.id }
}

export function saveAccounts(accounts, activeId) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ accounts, activeId }))
  } catch (e) {
    /* ignore */
  }
}

/* ── 전체 로컬 데이터 JSON 백업 ──
   현재 사용하는 localStorage 상태(accounts/keywords/viewerDevice)를 한 파일로 묶는다. */
export function createDataBackup({ accounts, activeAccountId, keywords, viewerDevice }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { accounts, activeAccountId, keywords, viewerDevice },
  }
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/* 외부 JSON을 앱 상태에 넣기 전 최소 구조를 검증하고 기존 데이터 모델로 보정한다. */
export function parseDataBackup(payload) {
  if (!isObject(payload) || payload.format !== BACKUP_FORMAT) {
    throw new Error('DDAK 전체 백업 파일이 아니에요.')
  }
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(`지원하지 않는 백업 버전이에요. (버전 ${payload.version || '없음'})`)
  }

  const data = payload.data
  if (!isObject(data) || !Array.isArray(data.accounts) || data.accounts.length === 0) {
    throw new Error('백업에 프로필 계정 정보가 없어요.')
  }
  if (!Array.isArray(data.keywords)) {
    throw new Error('백업의 키워드 사전 형식이 올바르지 않아요.')
  }
  if (!DEVICE_PRESETS.some((d) => d.key === data.viewerDevice)) {
    throw new Error('백업의 기기 설정이 올바르지 않아요.')
  }

  const accounts = data.accounts.map((raw, index) => {
    if (!isObject(raw) || !isObject(raw.profile) || !Array.isArray(raw.profile.items)) {
      throw new Error(`${index + 1}번째 프로필 정보가 올바르지 않아요.`)
    }
    if (!isObject(raw.explore) || !Array.isArray(raw.scenarios) || !Array.isArray(raw.threads)) {
      throw new Error(`${index + 1}번째 워크스페이스 정보가 올바르지 않아요.`)
    }
    if (raw.scenarios.some((s) => !isObject(s) || !isObject(s.stages))) {
      throw new Error(`${index + 1}번째 프로필의 시나리오 형식이 올바르지 않아요.`)
    }
    return normalizeAccount({ ...raw, id: String(raw.id || uid()) })
  })

  const activeId = accounts.some((a) => a.id === data.activeAccountId)
    ? data.activeAccountId
    : accounts[0].id

  return {
    accounts,
    activeId,
    keywords: data.keywords,
    viewerDevice: data.viewerDevice,
  }
}

/* 구(v1 단일 키) 쓰레드 — loadAccounts 마이그레이션 전용 */
const THREADS_KEY = 'ddak-threads-v1'

function loadLegacyThreads() {
  try {
    const raw = localStorage.getItem(THREADS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

/* 구(v1 단일 키) 탐색 페이지 — loadAccounts 마이그레이션 전용 */
const EXPLORE_KEY = 'ddak-explore-page-v1'

function loadLegacyExplore() {
  try {
    const raw = localStorage.getItem(EXPLORE_KEY)
    if (!raw) return DEFAULT_EXPLORE
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_EXPLORE,
      ...parsed,
      stories: Array.isArray(parsed.stories) && parsed.stories.length === 3
        ? parsed.stories
        : DEFAULT_EXPLORE.stories,
    }
  } catch (e) {
    return DEFAULT_EXPLORE
  }
}

export function createScenario(partial = {}) {
  return {
    id: uid(),
    title: '새 시나리오',
    chip: '새_시나리오',
    query: '',
    device: 'desktop',
    color: '#5f7465',
    compact: 'vertical', // 컴팩트 방향: 'vertical'(위로 스택) | 'horizontal'(왼쪽) | 'none' — 빌더 상단 바
    versions: [], // 발행 시점 스냅샷 (최근 10개)
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: { survey: [], plan: [] },
    ...partial,
  }
}

export function createItem(type, defaults, index = 0) {
  return {
    id: uid(),
    type,
    x: 0,
    y: 24 + index * 40,
    w: 672,
    h: null, // null = 자동 높이
    props: { ...defaults },
  }
}

/* 구(v1 단일 키) 시나리오 — loadAccounts 마이그레이션 전용 */
function loadLegacyScenarios() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

export function sortByPosition(items) {
  return [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x))
}

export function splitList(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// "메인|서브" 형태 옵션 파싱
export function splitOptions(text) {
  return splitList(text).map((chunk) => {
    const [main, sub] = chunk.split('|').map((s) => s.trim())
    return { main, sub: sub || '' }
  })
}
