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
/* 폭은 실기기 CSS 뷰포트(px) 기준. 기존 key는 저장된 시나리오가 참조하므로 바꾸지 말 것 */
export const DEVICE_PRESETS = [
  { key: 'desktop', label: '데스크톱', w: 720, icon: '🖥️' },
  { key: 'galaxy-fold-cover', label: '갤럭시 Z 폴드 커버 (344)', w: 344, icon: '📱' },
  { key: 'galaxy', label: '갤럭시 S (360)', w: 360, icon: '📱' },
  { key: 'iphone-se', label: 'iPhone SE (375)', w: 375, icon: '📱' },
  { key: 'galaxy-s-ultra', label: '갤럭시 S 울트라 (384)', w: 384, icon: '📱' },
  { key: 'iphone-15', label: 'iPhone 15 (390)', w: 390, icon: '📱' },
  { key: 'iphone-16-pro', label: 'iPhone 16 Pro (402)', w: 402, icon: '📱' },
  { key: 'galaxy-a-flip', label: '갤럭시 플립·A·노트 (412)', w: 412, icon: '📱' },
  { key: 'iphone-pro-max', label: 'iPhone Pro Max (430)', w: 430, icon: '📱' },
  { key: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max (440)', w: 440, icon: '📱' },
  { key: 'galaxy-fold-open', label: '갤럭시 Z 폴드 펼침 (690)', w: 690, icon: '📱' },
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

/* 컨테이너 자식은 슬롯 순서가 배치를 결정하므로 x/y를 갖지 않는다.
   좌표가 남아 있으면 레이아웃 연산이 자식을 캔버스 아이템으로 착각할 여지가 생기므로
   읽어 들이는 지점에서 0으로 되돌린다. (자식까지 컴팩트에 넘기던 옛 버전이 남긴 좌표 복구) */
export function normalizeItems(list) {
  return (Array.isArray(list) ? list : []).map((item) => (
    item && item.parentId && (item.x || item.y) ? { ...item, x: 0, y: 0 } : item
  ))
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
      survey: normalizeItems(stages.survey),
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

/* 목록형 텍스트의 공통 청크 분리 — 줄바꿈이 있으면 줄 단위(항목 안 쉼표 허용), 없으면 쉼표 구분 */
export function splitTextList(text) {
  const raw = String(text || '')
  return raw.includes('\n')
    ? raw.split('\n').map((part) => part.trim()).filter(Boolean)
    : splitList(raw)
}

/* 목록형 직렬화의 공통 마무리 — GUI 편집기가 만든 줄 목록을 저장 문자열로.
   한 줄뿐인데 쉼표가 들어 있으면 끝에 줄바꿈을 붙여 줄 단위 파싱을 강제한다 (쉼표 분리 오파싱 방지) */
export function joinTextList(items) {
  const lines = (items || []).map((item) => String(item || '').trim()).filter(Boolean)
  const text = lines.join('\n')
  return lines.length === 1 && text.includes(',') ? `${text}\n` : text
}

/* "메인|서브|상세" 형태 옵션 파싱 */
export function splitOptions(text) {
  return splitTextList(text).map((chunk) => {
    const parts = chunk.split('|').map((part) => part.trim())
    return { main: parts[0], sub: parts[1] || '', desc: parts.slice(2).join('|').trim() }
  })
}

/* splitOptions의 역방향 — 줄바꿈 구분으로 직렬화해 상세 설명의 쉼표를 보존한다 */
export function joinOptions(rows) {
  return joinTextList(
    (rows || [])
      .map((row) => ({
        main: String(row?.main || '').trim(),
        sub: String(row?.sub || '').trim(),
        desc: String(row?.desc || '').trim(),
      }))
      .filter((row) => row.main || row.sub || row.desc)
      .map((row) => (row.desc ? `${row.main}|${row.sub}|${row.desc}` : row.sub ? `${row.main}|${row.sub}` : row.main))
  )
}
