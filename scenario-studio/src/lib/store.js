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

export const STAGES = [
  { key: 'explore', label: '탐색', desc: '홈에서 시나리오가 시작되는 첫 화면' },
  { key: 'survey', label: '설문', desc: '사용자에게 물어볼 질문 구성' },
  { key: 'plan', label: '계획', desc: '설문 후 보여줄 맞춤 계획' },
]

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
    stages: { explore: [], survey: [], plan: [] },
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
