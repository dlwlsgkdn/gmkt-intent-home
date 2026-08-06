/*
 * 상품 태깅 검토 스튜디오의 데이터 계층.
 *
 * 시드는 BFF 데모 카탈로그(apps/bff/src/llm/catalog.ts)의 FE 사본이다 — 상품별 특징
 * 태그가 라이브 생성의 상품 매칭(그라운딩) 근거라서, 태그가 어긋나면 추천 품질이
 * 바로 흔들린다. 이 스튜디오는 그 태그를 사람이 훑고(승인/수정 필요) 고쳐 보는 곳.
 *
 * 검토 상태는 이 브라우저 localStorage에만 저장한다 — 계정 서버 동기화 기계 밖의
 * 검토 유틸이라서다. 기기 간 이동·카탈로그 반영은 JSON 내보내기가 담당한다.
 * (카탈로그 원본은 코드라 여기서 고친 태그가 BFF에 자동 반영되지는 않는다)
 */

const STORE_KEY = 'ddak-tagging-review-v1'

export const TAGGING_STATUS = {
  pending: '미검토',
  approved: '승인',
  flagged: '수정 필요',
}

const gdimg = (goodsCode) => `https://gdimg.gmarket.co.kr/${goodsCode}/still/280`

/* apps/bff/src/llm/catalog.ts 사본 (2026-08) — 카탈로그가 바뀌면 여기도 맞출 것 */
export const TAGGING_SEED = [
  { id: 'p-001', name: '자작나무 수분 토너 300ml', brand: '라운드랩', price: 16900, tags: ['토너', '수분', '진정', '민감성'], imageUrl: gdimg('4075320386') },
  { id: 'p-002', name: '어성초 스팟 토너 패드 카밍터치 (본품+리필)', brand: '아비브', price: 19800, tags: ['토너패드', '진정', '트러블'], imageUrl: gdimg('4446018108') },
  { id: 'p-003', name: '다이브인 저분자 히알루론산 세럼 100ml+20ml', brand: '토리든', price: 38500, tags: ['세럼', '수분', '속건조'], imageUrl: gdimg('3694639295') },
  { id: 'p-004', name: '레티놀 시카 흔적 앰플 50ml', brand: '이니스프리', price: 42750, tags: ['세럼', '주름', '탄력', '레티놀'], imageUrl: gdimg('3775017167') },
  { id: 'p-005', name: '청귤 비타C 잡티 케어 세럼 30ml', brand: '구달', price: 22000, tags: ['세럼', '미백', '잡티', '비타민'], imageUrl: gdimg('4468727856') },
  { id: 'p-006', name: '레드 블레미쉬 클리어 수딩 크림 50ml 듀오', brand: '닥터지', price: 28000, tags: ['크림', '진정', '수분', '민감성'], imageUrl: gdimg('3463379181') },
  { id: 'p-007', name: '아토베리어365 크림 80ml', brand: '에스트라', price: 25000, tags: ['크림', '장벽', '건성'] },
  { id: 'p-008', name: '브라이트닝 업 선 플러스 SPF50+ 50ml', brand: '닥터지', price: 21900, tags: ['선크림', '톤업', '무기자차', '민감성'] },
  { id: 'p-009', name: 'UV 아쿠아리치 워터리 에센스 선크림 70g', brand: '비오레', price: 12900, tags: ['선크림', '수분', '지성'], imageUrl: gdimg('3471531930') },
  { id: 'p-010', name: '1025 독도 클렌저 200ml', brand: '라운드랩', price: 14000, tags: ['클렌저', '약산성', '민감성'], imageUrl: gdimg('3209544905') },
  { id: 'p-011', name: '퓨어 클렌징 오일 200ml 더블 기획 (+55ml)', brand: '마녀공장', price: 33000, tags: ['클렌징오일', '모공', '블랙헤드'], imageUrl: gdimg('4419642825') },
  { id: 'p-012', name: '킬커버 더뉴 파운웨어 쿠션 (본품+리필)', brand: '클리오', price: 32000, tags: ['쿠션', '베이스', '커버', '지속력'], imageUrl: gdimg('4123344949') },
  { id: 'p-013', name: '노세범 미네랄 파우더 팩트 8.5g', brand: '이니스프리', price: 12000, tags: ['파우더', '픽서', '유분', '지속력'], imageUrl: gdimg('4314605095') },
  { id: 'p-014', name: '더 쥬시 래스팅 틴트', brand: '롬앤', price: 13000, tags: ['립', '틴트', '보습'] },
]

/* 이미지 없는 상품의 이모지 목업 — 대표 태그(첫 태그)에서 고른다 */
const TAG_EMOJI = {
  토너: '🧴', 토너패드: '🧴', 세럼: '💧', 크림: '🫙', 선크림: '🌞',
  클렌저: '🫧', 클렌징오일: '🫧', 쿠션: '🪞', 파우더: '🪞', 립: '💄',
}
export const productEmoji = (tags) => TAG_EMOJI[(tags && tags[0]) || ''] || '🧴'

const freshProduct = (seed) => ({
  ...seed,
  tags: [...seed.tags],
  originalTags: [...seed.tags],
  status: 'pending',
  note: '',
})

/* 저장본을 시드에 겹친다 — 상품 목록의 원천은 언제나 시드, 검토 흔적만 저장본에서 */
export function loadTaggingReview() {
  let stored = null
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
  } catch {
    stored = null
  }
  const byId = new Map(
    stored && Array.isArray(stored.products) ? stored.products.map((p) => [p.id, p]) : []
  )
  return TAGGING_SEED.map((seed) => {
    const saved = byId.get(seed.id)
    if (!saved) return freshProduct(seed)
    return {
      ...freshProduct(seed),
      tags: Array.isArray(saved.tags) ? saved.tags.filter((t) => typeof t === 'string' && t.trim()) : [...seed.tags],
      status: TAGGING_STATUS[saved.status] ? saved.status : 'pending',
      note: typeof saved.note === 'string' ? saved.note : '',
    }
  })
}

export function saveTaggingReview(products) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      products: products.map((p) => ({ id: p.id, tags: p.tags, status: p.status, note: p.note })),
    }))
  } catch {
    /* 저장 실패(용량 등)는 조용히 무시 — 검토 유틸이라 치명적이지 않다 */
  }
}

export function resetTaggingReview() {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* noop */
  }
  return TAGGING_SEED.map(freshProduct)
}

const sameTags = (a, b) => a.length === b.length && a.every((t, i) => t === b[i])

/* 내보내기 봉투 — 검토 결과를 카탈로그(코드)에 반영하거나 다른 기기로 옮길 때 */
export function taggingExportPayload(products) {
  return {
    format: 'ddak-tagging-review',
    version: 1,
    exportedAt: new Date().toISOString(),
    products: products.map((p) => ({
      id: p.id,
      brand: p.brand,
      name: p.name,
      status: p.status,
      tags: p.tags,
      originalTags: p.originalTags,
      tagsChanged: !sameTags(p.tags, p.originalTags),
      note: p.note,
    })),
  }
}

/* 태그 사전 — 전 상품의 태그 빈도 (빈도 내림차순 → 가나다) */
export function tagStats(products) {
  const counts = new Map()
  for (const product of products) {
    for (const tag of product.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'))
}
