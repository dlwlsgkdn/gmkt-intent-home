/*
 * 홈 검색창·검색 결과 목업(SRP)의 재료 — 서버 없이 만드는 자동완성 어휘와 데모 카탈로그.
 * 카탈로그는 @ddak/pipeline catalog.ts 의 FE 사본(같은 14종 — 상품이 바뀌면 같이 맞출 것). 자동완성은 이 어휘 +
 * 최근 검색어로 즉시 만들고, "검색어 추천(AI)" 행만 BFF(`/api/search/suggest`)를 부른다.
 */

export const SEARCH_CATALOG = [
  { id: 'p-001', name: '자작나무 수분 토너 300ml', brand: '라운드랩', price: 16900, tags: ['토너', '수분', '진정', '민감성'], url: 'https://m.gmarket.co.kr/vi/product/4075320386', imageUrl: 'https://gdimg.gmarket.co.kr/4075320386/still/280' },
  { id: 'p-002', name: '어성초 스팟 토너 패드 카밍터치 (본품+리필)', brand: '아비브', price: 19800, tags: ['토너패드', '진정', '트러블'], url: 'https://m.gmarket.co.kr/vi/product/4446018108', imageUrl: 'https://gdimg.gmarket.co.kr/4446018108/still/280' },
  { id: 'p-003', name: '다이브인 저분자 히알루론산 세럼 100ml+20ml', brand: '토리든', price: 38500, tags: ['세럼', '수분', '속건조'], url: 'https://item.gmarket.co.kr/Item?goodsCode=3694639295', imageUrl: 'https://gdimg.gmarket.co.kr/3694639295/still/280' },
  { id: 'p-004', name: '레티놀 시카 흔적 앰플 50ml', brand: '이니스프리', price: 42750, tags: ['세럼', '주름', '탄력', '레티놀'], url: 'https://m.gmarket.co.kr/vi/product/3775017167', imageUrl: 'https://gdimg.gmarket.co.kr/3775017167/still/280' },
  { id: 'p-005', name: '청귤 비타C 잡티 케어 세럼 30ml', brand: '구달', price: 22000, tags: ['세럼', '미백', '잡티', '비타민'], url: 'https://m.gmarket.co.kr/vi/product/4468727856', imageUrl: 'https://gdimg.gmarket.co.kr/4468727856/still/280' },
  { id: 'p-006', name: '레드 블레미쉬 클리어 수딩 크림 50ml 듀오', brand: '닥터지', price: 28000, tags: ['크림', '진정', '수분', '민감성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=3463379181', imageUrl: 'https://gdimg.gmarket.co.kr/3463379181/still/280' },
  { id: 'p-007', name: '아토베리어365 크림 80ml', brand: '에스트라', price: 25000, tags: ['크림', '장벽', '건성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=2715265644' },
  { id: 'p-008', name: '브라이트닝 업 선 플러스 SPF50+ 50ml', brand: '닥터지', price: 21900, tags: ['선크림', '톤업', '무기자차', '민감성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=2258029039' },
  { id: 'p-009', name: 'UV 아쿠아리치 워터리 에센스 선크림 70g', brand: '비오레', price: 12900, tags: ['선크림', '수분', '지성'], url: 'https://m.gmarket.co.kr/vi/product/3471531930', imageUrl: 'https://gdimg.gmarket.co.kr/3471531930/still/280' },
  { id: 'p-010', name: '1025 독도 클렌저 200ml', brand: '라운드랩', price: 14000, tags: ['클렌저', '약산성', '민감성'], url: 'https://m.gmarket.co.kr/vi/product/3209544905', imageUrl: 'https://gdimg.gmarket.co.kr/3209544905/still/280' },
  { id: 'p-011', name: '퓨어 클렌징 오일 200ml 더블 기획 (+55ml)', brand: '마녀공장', price: 33000, tags: ['클렌징오일', '모공', '블랙헤드'], url: 'https://m.gmarket.co.kr/vi/product/4419642825', imageUrl: 'https://gdimg.gmarket.co.kr/4419642825/still/280' },
  { id: 'p-012', name: '킬커버 더뉴 파운웨어 쿠션 (본품+리필)', brand: '클리오', price: 32000, tags: ['쿠션', '베이스', '커버', '지속력'], url: 'https://item.gmarket.co.kr/Item?goodsCode=4123344949', imageUrl: 'https://gdimg.gmarket.co.kr/4123344949/still/280' },
  { id: 'p-013', name: '노세범 미네랄 파우더 팩트 8.5g', brand: '이니스프리', price: 12000, tags: ['파우더', '픽서', '유분', '지속력'], url: 'https://m.gmarket.co.kr/vi/product/4314605095', imageUrl: 'https://gdimg.gmarket.co.kr/4314605095/still/280' },
  { id: 'p-014', name: '더 쥬시 래스팅 틴트', brand: '롬앤', price: 13000, tags: ['립', '틴트', '보습'], url: 'https://m.gmarket.co.kr/vi/product/4252936476' },
]

/* 자동완성 어휘 — 뷰티 상품 종류 (Figma 1-3: "쿠션" → 쿠션 · 쿠션 추천 · 파운데이션 쿠션 · 촉촉한 쿠션) */
export const SEARCH_VOCAB = [
  '쿠션', '파운데이션', '컨실러', '파우더', '프라이머', '픽서', '선크림', '선스틱', '토너', '토너패드', '세럼', '앰플', '에센스',
  '크림', '수분크림', '로션', '미스트', '마스크팩', '클렌징 폼', '클렌징 오일', '클렌저', '립스틱', '틴트', '립밤', '립글로스',
  '아이섀도', '아이라이너', '마스카라', '아이브로우', '블러셔', '하이라이터', '컨투어', '바디워시', '바디로션', '샴푸',
  '트리트먼트', '헤어 오일', '향수', '핸드크림', '메이크업 베이스', '톤업크림',
]

/* 어휘별 조합 — 앞에 오는 수식·품목 조합 (없는 어휘는 수식어 목록으로 만든다) */
const COMBOS = {
  '쿠션': ['파운데이션 쿠션', '촉촉한 쿠션', '커버력 좋은 쿠션', '지성 쿠션'],
  '파운데이션': ['촉촉한 파운데이션', '커버력 좋은 파운데이션', '가벼운 파운데이션'],
  '선크림': ['톤업 선크림', '무기자차 선크림', '지성 선크림'],
  '토너': ['수분 토너', '진정 토너', '약산성 토너'],
  '세럼': ['수분 세럼', '미백 세럼', '레티놀 세럼'],
  '틴트': ['촉촉한 틴트', '오래가는 틴트', 'MLBB 틴트'],
  '클렌징 폼': ['약산성 클렌징 폼', '순한 클렌징 폼'],
  '바디워시': ['향 좋은 바디워시', '순한 바디워시'],
}
const MODIFIERS = ['촉촉한', '커버력 좋은', '가벼운', '순한', '오래가는', '지성', '건성', '데일리']

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')

/* 입력어가 들어 있는 구간 — 행에서 굵게 그릴 자리 [시작, 길이] (없으면 null) */
function matchRange(text, query) {
  const q = String(query || '').trim()
  if (!q) return null
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  return i >= 0 ? [i, q.length] : null
}

/* 자동완성 — 입력어 그대로 → "어휘 추천" → 어휘 조합 → 입력어를 품은 다른 어휘·최근 검색어 순, 최대 4개 */
export function autocomplete(query, extras = []) {
  const q = String(query || '').trim()
  if (!q) return []
  const nq = norm(q)
  const rows = []
  const push = (text) => {
    const t = String(text || '').trim()
    if (!t || rows.some((r) => norm(r.text) === norm(t))) return
    rows.push({ text: t, match: matchRange(t, q) })
  }
  push(q)
  const base = SEARCH_VOCAB.find((t) => norm(t) === nq) || SEARCH_VOCAB.find((t) => norm(t).startsWith(nq))
  if (base) {
    push(`${base} 추천`)
    for (const c of COMBOS[base] || []) push(c)
    for (const m of MODIFIERS) push(`${m} ${base}`)
  }
  for (const t of SEARCH_VOCAB) if (norm(t).includes(nq)) push(t)
  for (const r of extras) if (norm(r).includes(nq)) push(r)
  return rows.slice(0, 4)
}

/* 검색 결과 목업 — 이름·브랜드·태그에 검색어 토큰이 걸린 상품(hits, 많이 걸린 순)과 나머지(others — "함께 보면 좋은 상품").
   데모 카탈로그가 14종뿐이라 정확히 걸리는 상품이 한둘이어도 화면이 비지 않게 나머지를 뒤에 잇는다 */
export function searchProducts(query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 1)
  const scored = SEARCH_CATALOG.map((p, i) => {
    const hay = [p.name, p.brand, ...(p.tags || [])].join(' ').toLowerCase()
    const score = tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
    return { p, score, i }
  })
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.p)
  const others = scored.filter((s) => s.score === 0).map((s) => s.p)
  return { hits, others }
}

/* LLM 라우터가 막혔을 때의 진입 분기 휴리스틱 — BFF search.controller 의 heuristicRoute 와 같은 규칙.
   고민·상황·요청형 표현이나 긴 문장은 DDAK, 상품 종류·이름 조회는 SRP */
export function heuristicRoute(query) {
  const q = String(query || '').trim()
  const asks = /추천|어울리|좋은|좋을까|루틴|메이크업|피부|고민|무너|찾아|해줘|어떤|비교|트러블|여드름|건조|번들|출근|데이트|결혼|여름|겨울|톤/.test(q)
  const ddak = asks || q.replace(/\s+/g, '').length >= 10
  return { ddak, reason: ddak ? '고민·상황·요청형 표현이 있어 설문으로 상황을 묻는 편이 낫다' : '상품 종류·이름 조회로 보여 검색 결과가 빠르다' }
}

/* AI 추천이 막혔을 때의 대체 문장 — BFF heuristicSuggest 와 같은 규칙 */
export function fallbackSuggest(query, profile = []) {
  const q = String(query || '').trim()
  const skin = (profile.find((it) => /피부/.test(it.label)) || {}).value
  return [skin ? `${skin} 피부에 쓰기 좋은 ${q} 추천해줘` : `지성피부에 쓰기 좋은 ${q} 추천해줘`, `데일리로 무난하게 쓸 ${q} 추천해줘`, `오래 가는 ${q} 찾아줘`]
}
