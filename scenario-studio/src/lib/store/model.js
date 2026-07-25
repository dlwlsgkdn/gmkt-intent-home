import { planCasesForScenario } from './planCases.js'

/*
 * 데이터 모델 — 아이템과 시나리오의 "형태".
 *
 * 여기 있는 함수는 값을 만들고 보정하기만 한다. 저장 위치(persistence.js),
 * 조건 평가(planCases.js), 첫 실행 기본값(defaults.js)은 각자 다른 파일 소관이다.
 */

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
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!match) return `rgba(95, 116, 101, ${alpha})`
  const value = parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/* 시나리오가 소유하는 단계: 설문 → 계획.
   탐색(홈)은 모든 시나리오가 공유하는 공통 페이지로, 칩 클릭이 곧 탐색 완료다. */
export const STAGES = [
  { key: 'survey', label: '설문', desc: '사용자에게 물어볼 질문 구성' },
  { key: 'plan', label: '계획', desc: '설문 조건에 따라 선택되는 여러 맞춤 계획 케이스' },
]

export function createItem(type, defaults, index = 0) {
  return {
    id: uid(),
    type,
    x: 0,
    y: 24 + index * 40,
    w: 672,
    h: null, // null = 자동 높이 (실제 높이는 캔버스가 측정한다)
    props: { ...defaults },
  }
}

/* 어떤 경로로 들어온 시나리오든(생성·가져오기·복원·서버 동기화) 이 함수를 통과한다 */
export function normalizeScenario(input = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const now = new Date().toISOString()
  const stages = raw.stages && typeof raw.stages === 'object' ? raw.stages : {}
  const scenario = {
    title: '새 시나리오',
    chip: '새_시나리오',
    query: '',
    device: 'desktop',
    color: '#5f7465',
    compact: 'vertical', // 'vertical'(위로 스택) | 'horizontal'(왼쪽) | 'none'
    versions: [], // 발행 시점 스냅샷 (최근 10개)
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...raw,
    id: String(raw.id || uid()),
    versions: Array.isArray(raw.versions) ? raw.versions : [],
    stages: {
      ...stages,
      survey: Array.isArray(stages.survey) ? stages.survey : [],
      // 구버전 호환 입력만 받으며, 실제 계획 아이템은 planCases[].items에 저장한다.
      plan: [],
    },
  }
  return { ...scenario, planCases: planCasesForScenario({ ...scenario, stages }) }
}

export function createScenario(partial = {}) {
  return normalizeScenario(partial)
}

export function sortByPosition(items) {
  return [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x))
}

export function splitList(text) {
  return String(text || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

/* "메인|서브" 형태 옵션 파싱 */
export function splitOptions(text) {
  return splitList(text).map((chunk) => {
    const [main, sub] = chunk.split('|').map((part) => part.trim())
    return { main, sub: sub || '' }
  })
}
