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

const EXPLORE_KEY = 'ddak-explore-page-v1'

export function loadExplore() {
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

export function saveExplore(cfg) {
  try {
    localStorage.setItem(EXPLORE_KEY, JSON.stringify(cfg))
  } catch (e) {
    /* ignore */
  }
}

export function createScenario(partial = {}) {
  return {
    id: uid(),
    title: '새 시나리오',
    chip: '새_시나리오',
    query: '',
    device: 'desktop',
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

export function loadScenarios() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

export function saveScenarios(scenarios) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios))
  } catch (e) {
    /* storage full or unavailable — mockup tool, ignore */
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
