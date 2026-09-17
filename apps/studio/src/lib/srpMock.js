/*
 * 검색 결과 페이지(SRP) 목업의 결과 조립 — 검색어 하나로 화면 전체(상품·쇼츠·라이브·뷰티톡·연관 검색어·개수)를 만든다.
 *
 * 상품은 **실제 지마켓 검색 결과 스냅샷**(`data/srpSnapshot.json` — `scripts/snapshot-srp.mjs` 가 모바일 검색 공개 페이지에서
 * 뷰티 상품만 굳힌 것: 이름·브랜드·가격·할인·별점·리뷰·구매 수·배송·엠블럼·광고 표식, 검색어당 24개)이고 썸네일·상세 주소는 상품
 * 번호로 결정된다(gdimg / m.gmarket PDP). 스냅샷은 SRP 청크에서만 쓰이도록 동적 import 로 받는다(`loadSrpSnapshot`).
 * 쇼츠·라이브·뷰티톡은 서버가 없어 **카테고리 묶음별 문구 풀**에서 검색어 해시로 뽑는다 — 같은 검색어면 늘 같은 화면, 다른
 * 검색어면 다른 화면. 검색어를 기계적으로 끼워 넣지 않고(옛 「촉촉한 {검색어}」식) 실제 크리에이터 제목처럼 읽히는 문장을 두되,
 * 브랜드·상품은 그 검색 결과의 실제 상품에서 가져온다(뷰티톡 사진 = 그 상품 사진).
 */
import { SEARCH_VOCAB, SEARCH_CATALOG, COMBOS, searchProducts, autocomplete } from './searchCatalog.js'

let snapshotPromise = null
/* 스냅샷 지연 로드 — 첫 호출만 청크를 받고 그 뒤는 같은 프로미스 */
export function loadSrpSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = import('../data/srpSnapshot.json').then((m) => m.default || m).catch(() => ({ keywords: {} }))
  }
  return snapshotPromise
}

/* ── 검색어 → 스냅샷 키 ── */
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '')
/* 흔한 표기 차이 — 스냅샷 키의 별칭 (공백은 norm 이 지운다) */
const ALIASES = {
  썬크림: '선크림', 썬스틱: '선스틱', 선쿠션: '쿠션', 쿠션팩트: '쿠션', 파데: '파운데이션', 립틴트: '틴트', 섀도우: '아이섀도', 아이섀도우: '아이섀도',
  아이쉐도우: '아이섀도', 쉐도우: '아이섀도', 팩: '마스크팩', 시트팩: '마스크팩', 클렌징폼: '클렌징 폼', 클렌징오일: '클렌징 오일', 폼클렌징: '클렌징 폼',
  헤어오일: '헤어 오일', 메이크업베이스: '메이크업 베이스', 톤업: '톤업크림', 립: '립스틱', 브로우: '아이브로우', 치크: '블러셔', 블러쉬: '블러셔',
  쉐딩: '컨투어', 셰딩: '컨투어', 향: '향수', 퍼퓸: '향수', 스킨: '토너', 패드: '토너패드', 바디: '바디로션', 핸드: '핸드크림', 린스: '트리트먼트',
}
/* 카테고리 묶음 — 문구 풀 선택 단위 */
const GROUP_OF = {}
const GROUPS = {
  base: ['쿠션', '파운데이션', '컨실러', '파우더', '프라이머', '픽서', '메이크업 베이스', '톤업크림'],
  sun: ['선크림', '선스틱'],
  skin: ['토너', '토너패드', '세럼', '앰플', '에센스', '크림', '수분크림', '로션', '미스트', '마스크팩'],
  cleanse: ['클렌징 폼', '클렌징 오일', '클렌저'],
  lip: ['립스틱', '틴트', '립밤', '립글로스'],
  eye: ['아이섀도', '아이라이너', '마스카라', '아이브로우'],
  cheek: ['블러셔', '하이라이터', '컨투어'],
  body: ['바디워시', '바디로션', '핸드크림'],
  hair: ['샴푸', '트리트먼트', '헤어 오일'],
  scent: ['향수'],
}
for (const [g, list] of Object.entries(GROUPS)) for (const k of list) GROUP_OF[k] = g

/* 검색어 안의 스냅샷 키 — 어휘와 별칭을 한 후보로 두고 가장 긴 것(「수분크림」이 「크림」보다, 「썬크림」(별칭)이 「크림」보다) */
export function resolveSrpKeyword(query, keys = SEARCH_VOCAB) {
  const nq = norm(query)
  if (!nq) return null
  let best = null
  let bestLen = 0
  const consider = (needle, key) => {
    if (needle && nq.includes(needle) && needle.length > bestLen) {
      best = key
      bestLen = needle.length
    }
  }
  for (const k of keys) consider(norm(k), k)
  for (const [alias, k] of Object.entries(ALIASES)) if (keys.includes(k)) consider(norm(alias), k)
  return best
}

/* ── 결정적 난수 — 검색어가 시드 ── */
function hashOf(s) {
  let h = 2166136261
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}
function rng(seed) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)]
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
/* 풀에서 n개를 겹치지 않게 — 풀이 모자라면 앞에서 다시 */
function sample(r, arr, n) {
  const pool = [...arr]
  const out = []
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0])
  for (let i = 0; out.length < n; i++) out.push(arr[i % arr.length])
  return out
}

/* 큰 수 표기 — 1,234 · 1.2만 · 23.5만 (쇼츠 조회수·좋아요) */
export function compactCount(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}만`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}천`
  return String(v)
}
export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`

/* ── 상품 ── */
const PRODUCT_URL = (no) => `https://item.gmarket.co.kr/Item?goodscode=${no}`
const THUMB_URL = (no) => `https://gdimg.gmarket.co.kr/${no}/still/280`

/* 수식어 → 상품명에서 찾을 말 (「촉촉한 쿠션」이면 수분·글로우가 든 상품을 앞으로) */
const MODIFIER_TERMS = [
  [/촉촉|수분|보습|글로우|물광|광채/, ['촉촉', '수분', '보습', '글로우', '물광', '광채', '모이스', '하이드라']],
  [/커버|커버력/, ['커버', '풀커버', '컨실']],
  [/지성|매트|번들|피지|세범/, ['매트', '세범', '지성', '피지', '노세범', '벨벳']],
  [/건성|속건조/, ['수분', '보습', '리치', '건성']],
  [/오래|지속|롱|래스팅/, ['래스팅', '지속', '롱', '픽스', '워터프루프']],
  [/톤업/, ['톤업']],
  [/무기자차|미네랄/, ['무기자차', '미네랄', '논나노']],
  [/진정|시카|트러블|여드름/, ['진정', '시카', '어성초', '카밍', '트러블', '레드']],
  [/미백|잡티|비타/, ['미백', '비타', '브라이트', '잡티', '화이트']],
  [/약산성|순한|저자극|민감/, ['약산성', '저자극', '순한', '민감', '마일드']],
  [/탄력|주름|안티에이징|레티놀/, ['탄력', '주름', '레티놀', '리프팅', '콜라겐', '펩타이드']],
  [/기획|세트|1\+1|리필/, ['기획', '세트', '1+1', '리필', '증정']],
  [/대용량/, ['대용량', '500', '1000']],
  [/남자|남성/, ['남성', '맨', '옴므']],
]

function matchTerms(query, keyword) {
  const rest = norm(query).replace(norm(keyword), '')
  const terms = []
  for (const [re, words] of MODIFIER_TERMS) if (re.test(rest)) terms.push(...words)
  return terms
}
/* 검색어의 나머지 어절 — 브랜드·색·이름 조각(「헤라 블랙쿠션」 → 헤라 · 블랙). 어휘 자체와 두 글자 미만은 뺀다 */
function queryTokens(query, keyword) {
  const nk = norm(keyword)
  const out = []
  for (const raw of String(query || '').toLowerCase().split(/\s+/)) {
    for (const t of [raw, nk ? raw.replace(nk, '') : raw]) {
      const v = t.trim()
      if (v.length >= 2 && v !== nk && !out.includes(v)) out.push(v)
    }
  }
  return out
}

/* 지마켓 상품명 정리 — 앞머리 광고 문구·괄호 옵션을 걷어 카드 두 줄에 맞는 이름 (「26FW최신상에이지투웨니스 골드볼륨샷 팩트 본품2+리필3」 → 그대로 두되 SEO 슬래시 나열만 자른다) */
export function tidyName(name) {
  let s = String(name || '').replace(/\s+/g, ' ').trim()
  s = s.replace(/^\[[^\]]*\]\s*/, '')
  if ((s.match(/\//g) || []).length >= 3) s = s.split('/').slice(0, 2).join(' ').trim()
  return s
}
/* 뷰티톡·라이브 문장에 넣을 짧은 상품 이름 — 브랜드 + 첫 두세 어절 */
function shortName(p) {
  const base = tidyName(p.name)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/(^|\s)x?\d+(\.\d+)?(ml|g|호|개|매|입|종|p|팩|장)?(?=\s|$)/gi, ' ') // 15g · 2개 · x1개 · 21호 같은 수량 어절
    .replace(/[_+]/g, ' ')
  const words = base.split(/\s+/).filter(Boolean)
  const drop = /^(백화점|정품|최신|신상|NEW|기획|본품|리필|세트|증정|무료배송|당일발송|정가|공식)/i
  const kept = words.filter((w) => !drop.test(w) && !(p.brand && w === p.brand))
  const head = kept.slice(0, 3).join(' ')
  return (p.brand ? `${p.brand} ${head}` : head).trim().slice(0, 22)
}

function toProduct(it) {
  return {
    id: it.no,
    name: tidyName(it.name),
    brand: it.brand || '',
    price: it.price,
    before: it.before || 0,
    dc: it.dc || (it.before && it.before > it.price ? Math.round((1 - it.price / it.before) * 100) : 0),
    star: it.star || 0,
    reviews: it.reviews || 0,
    buys: it.buys || 0,
    ship: it.ship, // 'free' | 배송비 숫자
    smile: !!it.smile,
    today: !!it.today,
    official: it.official || '',
    emblem: it.emblem || '',
    ad: !!it.ad,
    soldOut: !!it.soldOut,
    isNew: !!it.isNew,
    related: !!it.related,
    imageUrl: THUMB_URL(it.no),
    url: PRODUCT_URL(it.no),
    mall: '지마켓',
  }
}
/* FE 데모 카탈로그(14종)를 같은 모양으로 — 스냅샷에 없는 검색어의 마지막 폴백 */
function fromCatalog(p, i) {
  const code = (String(p.url || '').match(/(\d{9,11})/) || [])[1]
  return {
    id: p.id, name: p.name, brand: p.brand || '', price: p.price, before: 0, dc: 0,
    star: [4.8, 4.7, 4.9, 4.6][i % 4], reviews: [1284, 356, 2210, 94, 731][i % 5], buys: [5320, 1290, 8800, 410, 2600][i % 5],
    ship: i % 4 === 3 ? 3000 : 'free', smile: i % 3 === 0, today: i % 2 === 1, official: i % 5 === 0 ? '공식' : '', emblem: i % 4 === 0 ? '빅세일' : '',
    ad: false, soldOut: false, isNew: false, related: false,
    imageUrl: p.imageUrl || (code ? THUMB_URL(code) : ''), url: p.url, mall: '지마켓',
  }
}

/* 상품 순위 — 스냅샷 노출 순서를 뼈대로, 검색어 어절(브랜드·이름 조각 +2)·수식어 동의어(+1)가 이름에 걸린 상품을 앞으로, 광고는 둘까지, 품절은 뒤로 */
function rankProducts(items, query, keyword) {
  const terms = matchTerms(query, keyword)
  const tokens = queryTokens(query, keyword)
  const scored = items.map((it, i) => {
    const hay = `${it.name} ${it.brand || ''}`.toLowerCase()
    const hit = tokens.reduce((n, t) => n + (hay.includes(t) ? 2 : 0), 0) + terms.reduce((n, t) => n + (hay.includes(t.toLowerCase()) ? 1 : 0), 0)
    return { it, i, hit }
  })
  let ads = 0
  const kept = scored.filter((s) => {
    if (!s.it.ad) return true
    ads += 1
    return ads <= 2
  })
  kept.sort((a, b) => Number(!!a.it.soldOut) - Number(!!b.it.soldOut) || b.hit - a.hit || a.i - b.i)
  return kept.map((s) => s.it)
}

/* ── 문구 풀 ── */
const CREATORS = [
  '민지의 화장대', '코덕언니', 'Glow by Haeun', '지우 zziu', '레나 뷰티랩', '메이크업아티스트 준', '피부과 옆집 수아', '유리의 파우치',
  '뷰티에디터 한', '리뷰하는 도연', '올리브톡 다은', '소윤 SOYUN', '진아의 실착', '화장품 읽어주는 남자', '마이 뷰티 노트', '연우 YEONU',
]
const TALKERS = [
  '뷰티코덕언니', '쿠션덕후마미', '핑크코덕', '글로시뷰티', '수분충전중', '민감피부생존기', '지성러의하루', '건성건성', '파우치정리', '레드립매니아',
  '퇴근후화장대', '뷰티 입문 3개월', '올영세일알리미', '피부과다니는중', '결혼준비뷰티', '30대 직장인 뷰티',
]
const LIVE_HOSTS = ['지마켓 뷰티 LIVE', '뷰티 MD 지은', '쇼호스트 하나', '브랜드 라이브', '뷰티 큐레이터 민']
const AGO = ['1일 전', '2일 전', '3일 전', '4일 전', '6일 전', '1주 전', '2주 전', '3주 전']

/* 쇼츠 제목 — {k} 검색어(어휘) · {b} 결과 상위 브랜드 · {p} 결과 상품 짧은 이름. 검색어를 안 쓰는 문장도 섞어 기계적으로 보이지 않게 */
const SHORTS = {
  base: [
    '지성 피부 8시간 실착 | 안 무너지는 {k} 드디어 찾음', '물광 vs 매트 {k}, 내 피부엔 뭐가 맞을까?', '{k} 하나로 1분 데일리 베이스 끝내기',
    '{b} 신상 {k} 솔직 리뷰 (광고 아님)', '여름 마스크에도 안 묻는 베이스 TOP3', '호수 고르는 법, 이거 모르면 얼굴만 떠요',
    '{p} 한 달 써본 후기', '커버력 미친 {k} 3개 블라인드 비교', '다크닝 없는 베이스 찾는 분들 보세요', '겉광속촉 베이스 레이어링 순서',
  ],
  sun: [
    '{k} 백탁·밀림 실험 | 8종 비교', '무기자차 vs 유기자차 5초 정리', '눈 안 시린 {k} 드디어 찾았다', '{b} {k} 한 달 실사용 후기',
    '메이크업 위에 덧바르는 선케어 루틴', '{p} 솔직 리뷰 — 톤업 되는데 회끼 없음', '지성 피부 여름 {k} 3개 추천', '아이들도 쓰는 순한 {k} 고르는 기준',
  ],
  skin: [
    '속건조 3주 만에 잡은 루틴 공개', '{k} 흡수 잘 되게 바르는 손기술', '{b} {k} 성분 분석해봤어요', '{p} 공병 3개째 쓰는 이유',
    '민감성 피부 진정 루틴 (겉바속촉 아님, 진짜 진정)', '피부과 선생님이 알려준 {k} 고르는 법', '가성비 vs 백화점 {k} 블라인드 테스트', '아침 저녁 {k} 다르게 써야 하는 이유',
  ],
  cleanse: [
    '{k} 하나로 선크림까지 지워질까? 실험', '약산성 {k} 5종 pH 직접 측정', '모공 속 블랙헤드, {k} 마사지 2분이면 끝', '{b} {k} 세정력 vs 자극 비교',
    '이중세안 꼭 해야 해요? 피부과 답변', '{p} 한 통 다 쓴 후기', '건성 피부 세안 후 당김 없는 {k}', '메이크업 지우는 순서 이렇게 바꿔보세요',
  ],
  lip: [
    '{k} 발색 비교 | 웜톤·쿨톤 다 발라봤다', 'MLBB 립 5개 블라인드 스와치', '{b} 신상 {k} 전 색상 발색', '마스크에 안 묻는 {k} 테스트',
    '{p} 실착 (형광등·자연광 비교)', '입술 각질 없이 {k} 바르는 법', '데일리 립 하나만 산다면? 정착템 공개', '겹쳐 바르기로 만드는 그라데이션 립',
  ],
  eye: [
    '{k} 번짐 12시간 테스트 (지성 눈꺼풀)', '{b} {k} 발색·지속력 실험', '무쌍이 쓰기 좋은 {k} 5개', '눈 커 보이는 {k} 포인트 3가지',
    '{p} 한 달 사용 후기', '데일리 음영 메이크업 3분 컷', '속눈썹 처짐 없는 마스카라 고르기', '아이라인 흔들리지 않게 그리는 법',
  ],
  cheek: [
    '{k} 위치만 바꿨는데 얼굴형이 달라짐', '{b} {k} 발색 비교 | 웜·쿨', '물광 치크 vs 파우더 치크 지속력', '{p} 실착 리뷰',
    '자연스러운 윤곽 만드는 {k} 순서', '피부 톤별 {k} 컬러 추천', '하이라이터 번들거림 없이 광 내는 법', '5초 컷 데일리 치크 루틴',
  ],
  body: [
    '향 좋은 {k} 5종 비교 (잔향 몇 시간?)', '{b} {k} 쓰고 팔꿈치 각질 사라짐', '샤워 후 3분 안에 바르는 이유', '{p} 대용량 한 달 써본 후기',
    '건조한 계절 바디 루틴 이렇게 바꿔보세요', '민감 피부 순한 {k} 고르는 기준', '가성비 {k} 블라인드 테스트', '향수 대신 쓰는 {k} 레이어링',
  ],
  hair: [
    '두피 열 잡는 {k} 3주 후기', '{b} {k} 써보고 정착', '드라이 전 {k} 바르는 순서', '{p} 한 달 사용 후기',
    '탈모 샴푸 진짜 효과 있을까? 성분 정리', '손상모 살리는 홈케어 루틴', '머리 감고 나서 물기 제거법이 90%', '가성비 vs 살롱 {k} 비교',
  ],
  scent: [
    '{k} 잔향 12시간 추적 (겨울 vs 여름)', '데일리 {k} 5개 시향 후기', '{b} {k} 층 별 노트 정리', '{p} 시향 리뷰',
    '뿌리는 위치만 바꿔도 지속력 2배', '첫 {k} 고르는 법 (실패 없는 3가지)', '취향 없는 사람이 골라도 좋은 {k}', '니치 vs 디자이너 {k}, 뭐가 다른가',
  ],
  default: [
    '{k} 5종 비교 | 솔직 후기', '{b} {k} 한 달 실사용', '{p} 리뷰 (광고 아님)', '{k} 고르는 기준 3가지',
    '가성비 vs 백화점 {k} 블라인드 테스트', '피부 타입별 {k} 추천', '{k} 이렇게 쓰면 효과 2배', '요즘 제일 많이 묻는 {k} 질문 정리',
  ],
}
const LIVES = {
  any: [
    '[{b}] {k} 신상 첫 공개 라이브 🎁 선착순 사은품', '{b} 브랜드데이 — 오늘만 최대 40% + 무료배송', '지마켓 뷰티 LIVE | {k} 1+1 특가 (라이브 한정)',
    '{k} 실시간 Q&A · 내 피부에 맞는 걸 찍어드려요', '{p} 라이브 단독 구성 (본품+리필+미니어처)', '퇴근길 뷰티 라이브 — {k} 베스트 5 총정리',
    '[{b}] 공식 라이브 · 라이브 쿠폰 15%', '뷰티 MD 픽 {k} 특가 라이브',
  ],
}
const POSTS = {
  base: [
    '{k} 3종 비교해봤어요 🔍 커버력 차이가 진짜 크더라고요. 피부 타입별로 추천이 달라요',
    '{p} 3개월 연속 재구매 🔥 지성인데 오후까지 다크닝 없어서 정착했어요',
    '{b} 신상 {k} 발라봤는데 밀착력이 확실히 좋아졌어요. 결 정돈 안 해도 티 안 남',
    '호수 고민하시는 분들 — 저 21호랑 23호 사이인데 매장 가서 목에 발라보고 골랐어요. 얼굴 아니고 목!',
    '여름에 무너지는 거 때문에 {k} 5개 갈아탔는데, 결국 픽서 뿌리는 게 답이었음 😂',
    '민감성인데 이 {k} 쓰고 트러블 안 났어요. 성분표 보고 산 게 처음으로 맞은 듯',
    '{p} 리필 구성으로 사면 훨씬 이득이에요. 본품 케이스 재활용하는 팁 공유',
    '베이스 얇게 바르고 싶은 분들 — 퍼프 말고 브러시로 두드려보세요, {k} 발림이 완전 달라요',
  ],
  sun: [
    '{k} 백탁 심한 거 싫어서 6개 써봤는데 결국 이걸로 정착 ☀️ 톤업인데 회끼 없음',
    '{b} {k} 쓰고 나서 눈 시림이 사라졌어요. 여름에 땀나면 눈 아팠던 분들 추천',
    '{p} 리필 세트로 사서 1년치 확보했습니다. 매일 손가락 두 마디 양은 진짜 필요해요',
    '메이크업 위에 덧바르는 용도로는 스틱형이 최고예요. 쿠션 위에 문질러도 안 밀림',
    '무기자차인데 이렇게 촉촉한 거 처음 봄. 건성 겨울에도 당김 없어요',
    '아이들 쓰는 {k:로} 같이 쓰는데 향도 없고 순해서 온 가족 공용 중',
    '2주 실험: 왼쪽 볼만 {k} 안 발랐더니 톤 차이가… 여러분 매일 바르세요 🙏',
    '{k} 유통기한 확인하세요! 지난해 거 쓰고 있었는데 차단력 떨어진대요',
  ],
  skin: [
    '속건조로 3년 고생했는데 {k} 바꾸고 2주 만에 당김이 없어졌어요. 성분은 히알루론산+세라마이드',
    '{p} 공병 3개째 💧 아침엔 얇게 저녁엔 두 번 레이어링',
    '{b} {k} 성분표 보고 샀는데 향료 없고 순해서 민감성인 저도 잘 맞았어요',
    '피부과 선생님이 알려준 순서: 토너 → 세럼 → 크림, 그리고 {k:는} 손바닥 온기로 흡수시키기',
    '진정 루틴 필요하신 분 — 시카·어성초 든 {k:로} 2주만 써보세요. 붉은기 확실히 줄어요',
    '{k} 가성비 vs 백화점 블라인드 테스트 해봤는데 저는 솔직히 가성비 손 들었어요 😅',
    '수부지 피부(속건조+겉번들)면 무겁지 않은 젤 타입 {k} 추천. 오후 번들거림도 덜해요',
    '{p} 한 달 쓰고 남편도 같이 써요. 남자 피부에도 끈적임 없이 잘 맞더라고요',
  ],
  cleanse: [
    '약산성 {k:로} 바꾸고 세안 후 당김이 없어졌어요. pH 5.5 표기 있는 거 찾아보세요',
    '{p} 한 통 다 썼는데 선크림까지 깨끗하게 지워져서 이중세안 안 해도 되더라고요',
    '{b} {k} 거품이 진짜 조밀해서 소량으로도 충분해요. 3개월은 쓸 듯',
    '블랙헤드 고민이면 {k:로} 2분 마사지 후 미온수 — 이게 스크럽보다 나아요',
    '건성인데 세정력 강한 거 쓰다가 각질 폭발… {k:는} 순한 걸로 바꾸고 회복 중',
    '아침엔 물세안, 저녁엔 {k} — 피부과에서 권한 루틴인데 트러블이 확 줄었어요',
    '{k} 향 좋은 거 찾는 분들, 이건 은은해서 남편도 같이 써요',
    '메이크업 지울 때 눈 화장은 따로 리무버 쓰는 게 {k} 자극 덜해요',
  ],
  lip: [
    '{k} 웜톤·쿨톤 다 발라봤는데 MLBB는 이 컬러가 실패 없어요 💄 사진은 자연광',
    '{p} 발색 실착 — 형광등 아래랑 자연광에서 색이 이렇게 다르네요',
    '{b} 신상 {k} 3색 스와치. 마스크에 거의 안 묻어서 놀랐어요',
    '입술 각질 정리 후 {k} 바르면 발색이 확 달라요. 립 스크럽 필수',
    '겹쳐 바르기로 그라데이션 만들기 — 안쪽 진하게, 바깥으로 손가락 톡톡',
    '지속력 8시간 테스트: 점심 먹고도 안쪽 색 살아 있었어요. {k} 정착',
    '데일리 립은 하나만 — 저는 {p:로} 정착했어요. 화장 안 한 날에도 이것만 바름',
    '건조한 입술이면 밤 먼저 얇게 바르고 {k} 얹으면 갈라짐이 없어요',
  ],
  eye: [
    '{k} 지성 눈꺼풀 12시간 번짐 테스트 — 저녁까지 안 번진 건 두 개였어요',
    '{p} 한 달 후기. 발색이 뭉치지 않고 결이 고와요',
    '{b} {k} 무쌍이 써도 자연스러워서 정착. 무쌍 분들 참고하세요',
    '눈 커 보이는 포인트: 애교살 밝게, 삼각존 음영, 언더 라인 3분의 1만',
    '속눈썹 처짐 없는 마스카라 찾다가 워터프루프로 갈아탔어요. 클렌징은 오일로!',
    '데일리 음영 3분 컷 — 브라운 두 색이면 충분해요. {k} 여러 개 사지 마세요',
    '아이라인 흔들릴 때는 팔꿈치를 책상에 고정하고 점 찍어 잇기. {k} 붓펜형 추천',
    '{k} 컬러 고민이면 눈동자 색이랑 비슷한 톤부터 시작해보세요',
  ],
  cheek: [
    '{k} 위치를 광대 위에서 애플존으로 바꿨는데 얼굴이 어려 보여요 🙈',
    '{p} 발색 비교 — 웜톤 저에겐 코랄이 딱이었어요',
    '{b} {k} 크림 타입인데 지성도 안 뜨고 자연스럽게 밀착됨',
    '물광 치크 vs 파우더 치크 지속력 비교했는데 레이어링이 답이었어요',
    '하이라이터 번들거림 없이 광 내는 법: 콧대 아니고 코끝 위 살짝만',
    '컨투어 색 고르는 팁 — 회끼 도는 쿨브라운이면 그림자처럼 자연스러워요',
    '{k} 브러시 대신 손가락으로 톡톡하면 피부에 더 스며들어요',
    '5초 컷 데일리 치크: 크림 치크 두 번 톡톡, 끝. {k} 이거면 충분',
  ],
  body: [
    '향 좋은 {k} 찾다가 정착 — 잔향이 4시간 넘게 가요. 향수 안 뿌려도 될 정도',
    '{p} 대용량으로 사서 온 가족 공용. 끈적임 없어 여름에도 좋아요',
    '{b} {k} 쓰고 팔꿈치·무릎 각질이 정리됐어요. 샤워 후 3분 안에 바르는 게 포인트',
    '건조한 계절엔 바디 오일 → {k} 순서로 레이어링하면 아침까지 촉촉',
    '민감 피부인데 향료 없는 {k:로} 바꾸고 가려움이 사라졌어요',
    '핸드크림은 손등만 아니라 손톱 큐티클까지 — 네일 오래 가요',
    '{k} 가성비 3개 블라인드 테스트 해봤는데 저는 향으로 골랐어요 😆',
    '샤워 후 물기 다 닦지 말고 {k} 바르면 보습이 두 배',
  ],
  hair: [
    '두피 열 심했는데 {k} 바꾸고 3주 만에 가려움이 없어졌어요',
    '{p} 한 달 후기 — 드라이 전 모발 끝에만 바르면 갈라짐이 확 줄어요',
    '{b} {k} 향이 오래 남아서 향수 안 뿌려도 돼요',
    '손상모 살리는 홈케어: 샴푸 → 트리트먼트 5분 방치 → 찬물 마무리',
    '탈모 {k} 진짜 효과? 성분 보고 골랐는데 빠지는 양이 줄긴 했어요',
    '머리 감고 타월로 비비지 말고 눌러 닦기 — 이것만 바꿔도 결이 달라요',
    '{k} 가성비 vs 살롱 제품 비교, 저는 살롱 승… 대신 아껴 써요',
    '두피랑 모발 {k} 따로 쓰는 게 맞대요. 두피는 세정, 모발은 영양',
  ],
  scent: [
    '{k} 잔향 12시간 추적 — 겨울엔 오래 가고 여름엔 4시간이면 사라지네요',
    '{p} 시향 후기: 탑은 시트러스, 미들은 화이트 플로럴, 잔향은 머스크',
    '{b} {k} 층 별 노트 정리해봤어요. 취향 없는 분도 실패 없을 향',
    '뿌리는 위치만 바꿔도 지속력 2배 — 손목 말고 목 뒤·옷 안쪽',
    '첫 {k} 고르는 법: 시향지 아니고 피부에, 30분 뒤 결정',
    '데일리 {k} 5개 시향 — 사무실용은 은은한 게 최고',
    '니치 vs 디자이너 {k}, 솔직히 차이는 지속력이었어요',
    '{k} 여러 개 사지 말고 하나를 오래 쓰는 게 나만의 향이 된대요',
  ],
  default: [
    '{k} 5종 비교 솔직 후기 🔍 저는 가성비 손 들었어요',
    '{p} 한 달 실사용 후기. 광고 아니고 내돈내산',
    '{b} {k} 써봤는데 기대 이상이었어요. 재구매 예정',
    '{k} 고를 때 성분표 먼저 보는 습관 들이니 실패가 줄었어요',
    '피부 타입별로 {k} 추천이 다르대요. 저는 지성이라 가벼운 텍스처로',
    '{k} 이렇게 쓰면 효과 두 배 — 순서와 양이 중요해요',
    '{p} 리필로 사면 훨씬 이득. 본품 케이스 재활용 중',
    '요즘 제일 많이 묻는 {k} 질문 정리해봤어요. 궁금한 거 댓글로!',
  ],
}

/* 조사 — 받침에 따라 은/는·이/가·을/를·으로/로 (ㄹ 받침은 '로'). 영문·숫자로 끝나면 받침 없음으로 본다 */
const JOSA = { 는: ['은', '는'], 가: ['이', '가'], 를: ['을', '를'], 로: ['으로', '로'] }
export function josa(word, kind) {
  const pair = JOSA[kind]
  if (!pair) return kind
  const ch = String(word || '').trim().slice(-1)
  const code = ch.charCodeAt(0)
  if (!(code >= 0xac00 && code <= 0xd7a3)) return pair[1]
  const jong = (code - 0xac00) % 28
  if (jong === 0 || (kind === '로' && jong === 8)) return pair[1]
  return pair[0]
}
/* {k} 검색어(어휘) · {b} 브랜드 · {p} 상품 짧은 이름 — `{k:는}` 처럼 조사를 달면 받침에 맞춘다 */
const fill = (tpl, ctx) =>
  tpl.replace(/\{([kbp])(?::(는|가|를|로))?\}/g, (_, key, j) => {
    const v = key === 'p' ? ctx.p() : ctx[key]
    return j ? v + josa(v, j) : v
  })

/* ── 연관 검색어 — 결과 상위 브랜드 + 어휘 조합(COMBOS) + 카테고리 수식 (검색어 자신·어절만 뒤집힌 중복은 뺀다) ── */
const tokenKey = (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ')
function relatedFor(query, keyword, products, recents) {
  const out = []
  const push = (t) => {
    const s = String(t || '').trim()
    if (s && tokenKey(s) !== tokenKey(query) && norm(s) !== norm(query) && !out.some((o) => tokenKey(o) === tokenKey(s))) out.push(s)
  }
  if (keyword) {
    const brandCount = new Map()
    for (const p of products) if (p.brand) brandCount.set(p.brand, (brandCount.get(p.brand) || 0) + 1)
    const brands = [...brandCount.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b)
    const extras = {
      base: ['리필', '기획세트', '21호', '23호'], sun: ['톤업', '무기자차', '스틱'], skin: ['대용량', '기획', '민감성', '수부지'], cleanse: ['약산성', '대용량', '기획'],
      lip: ['MLBB', '웜톤', '쿨톤', '신상'], eye: ['워터프루프', '브라운', '무쌍'], cheek: ['크림', '웜톤', '쿨톤'], body: ['대용량', '향 좋은', '민감성'],
      hair: ['탈모', '손상모', '두피'], scent: ['니치', '남자', '여자', '데일리'], default: ['추천', '기획', '세트'],
    }[GROUP_OF[keyword] || 'default']
    // 브랜드·조합·수식을 번갈아 — 실제 연관 검색어의 뒤섞인 결
    const q1 = brands.slice(0, 3).map((b) => `${b} ${keyword}`)
    const q2 = [`${keyword} 추천`, ...(COMBOS[keyword] || []), ...extras.map((e) => (/^\d/.test(e) || e.length <= 3 ? `${keyword} ${e}` : `${e} ${keyword}`))]
    for (let i = 0; out.length < 8 && (i < q1.length || i < q2.length); i++) {
      if (i < q2.length) push(q2[i])
      if (i < q1.length) push(q1[i])
    }
  } else {
    for (const r of autocomplete(query, recents)) push(r.text)
    push(`${query} 추천`)
    push(`${query} 기획세트`)
  }
  return out.slice(0, 8)
}

/* ── 결과 조립 ── */
const FACES = ['./sample-faces/face-1.jpg', './sample-faces/face-2.jpg', './sample-faces/face-3.jpg', './sample-faces/face-4.jpg']
const face = (n) => FACES[((Math.floor(n) % FACES.length) + FACES.length) % FACES.length]

export function buildSrpResults(query, snapshot, { recents = [] } = {}) {
  const term = String(query || '').trim()
  const keys = Object.keys((snapshot && snapshot.keywords) || {})
  const keyword = resolveSrpKeyword(term, keys.length ? keys : SEARCH_VOCAB)
  const seed = hashOf(term)
  const r = rng(seed)

  /* 상품 — 스냅샷 키 → 키 없으면 이름 토큰으로 전 스냅샷 대조 → 그래도 없으면 데모 카탈로그 */
  let items = []
  let total = 0
  let exact = true
  let contextKey = null // 어휘 밖 검색어의 문구 풀 기준 어휘
  if (keyword && snapshot?.keywords?.[keyword]?.items?.length) {
    const snap = snapshot.keywords[keyword]
    items = rankProducts(snap.items, term, keyword).map(toProduct)
    total = snap.total || items.length * 640
    if (norm(term) !== norm(keyword)) total = Math.max(items.length, Math.round(total * (0.06 + r() * 0.24)))
  } else if (keys.length) {
    const tokens = norm(term).length >= 2 ? term.toLowerCase().split(/\s+/).filter((t) => t.length >= 2) : []
    const seen = new Set()
    const hits = []
    for (const k of keys) {
      for (const it of snapshot.keywords[k].items || []) {
        const name = String(it.name).toLowerCase()
        const score = tokens.reduce((n, t) => n + (name.includes(t) ? 1 : 0), 0)
        if (score > 0 && !seen.has(it.no) && !it.ad) {
          seen.add(it.no)
          hits.push({ it, score, k })
        }
      }
    }
    hits.sort((a, b) => b.score - a.score)
    items = hits.slice(0, 24).map((h) => toProduct(h.it))
    total = items.length ? items.length * between(r, 40, 400) : 0
    exact = false
    // 걸린 상품이 많이 나온 어휘를 문구 풀의 기준으로 (「비오레 워터리」 → 선크림 이야기)
    const byKey = new Map()
    for (const h of hits.slice(0, 24)) byKey.set(h.k, (byKey.get(h.k) || 0) + 1)
    contextKey = [...byKey.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)[0] || null
  }
  if (!items.length) {
    const { hits, others } = searchProducts(term)
    items = [...hits, ...others].slice(0, 8).map(fromCatalog)
    total = hits.length ? hits.length * between(r, 30, 200) : between(r, 120, 900)
    exact = false
  }

  const k = keyword || contextKey || term
  const group = GROUP_OF[keyword || contextKey] || 'default'
  const brands = [...new Set(items.map((p) => p.brand).filter(Boolean))]
  const brandOf = () => (brands.length ? pick(r, brands) : '지마켓 뷰티')
  const productPool = items.filter((p) => !p.soldOut)
  const ctx = { k, b: brandOf(), p: () => (productPool.length ? shortName(pick(r, productPool)) : k) }

  /* 쇼츠 8 — 썸네일은 크리에이터 얼굴(샘플 4종)과 상품 사진을 번갈아(리뷰 쇼츠는 상품 클로즈업이 흔하다) */
  const shortsPool = SHORTS[group] || SHORTS.default
  const shorts = sample(r, shortsPool, 8).map((tpl, i) => {
    const prod = productPool[(i * 3 + 1) % Math.max(1, productPool.length)]
    const useFace = i % 2 === 0 || !prod
    return {
      id: `s${i}`,
      title: fill(tpl, { ...ctx, b: brandOf() }),
      image: useFace ? face((i / 2) * 3 + seed) : prod.imageUrl, // ×3 — 샘플 4종(남 2·여 2 인접)을 건너뛰며 돌아 이웃 카드가 다른 인상
      product: useFace ? null : prod,
      avatar: face(i + 1 + (seed >>> 3)),
      who: CREATORS[(i + seed) % CREATORS.length],
      views: compactCount(between(r, 1800, 980000)),
      ago: pick(r, AGO),
    }
  })

  /* 라이브 4 — 앞 둘은 진행 중(시청자 수), 뒤 둘은 예정(시각) */
  const lives = sample(r, LIVES.any, 4).map((tpl, i) => {
    const prod = productPool[(i * 5 + 2) % Math.max(1, productPool.length)]
    const live = i < 2
    const hour = between(r, 12, 22)
    return {
      id: `l${i}`,
      title: fill(tpl, { ...ctx, b: brandOf() }),
      image: i % 2 === 1 && prod ? prod.imageUrl : face(i * 3 + 2 + (seed >>> 5)),
      product: i % 2 === 1 && prod ? prod : null,
      avatar: face(i + 3),
      who: pick(r, LIVE_HOSTS),
      live,
      viewers: live ? Number(between(r, 320, 8400)).toLocaleString('ko-KR') : '',
      startsAt: live ? '' : `${i === 2 ? '오늘' : '내일'} ${hour >= 12 ? '오후' : '오전'} ${hour > 12 ? hour - 12 : hour}시`,
    }
  })

  /* 뷰티톡 8 — 글마다 사진은 그 글이 말하는 상품 */
  const postsPool = POSTS[group] || POSTS.default
  const posts = sample(r, postsPool, 8).map((tpl, i) => {
    const prod = productPool[(i * 7 + 3) % Math.max(1, productPool.length)]
    const bound = { ...ctx, b: prod?.brand || brandOf(), p: () => (prod ? shortName(prod) : k) }
    return {
      id: `p${i}`,
      body: fill(tpl, bound),
      name: TALKERS[(i * 3 + seed) % TALKERS.length],
      avatar: face(i + (seed >>> 7)),
      image: prod ? prod.imageUrl : face(i),
      product: prod || null,
      likes: compactCount(between(r, 12, 42000)),
      comments: compactCount(between(r, 0, 1800)),
      ago: pick(r, AGO),
    }
  })

  return {
    term,
    keyword,
    exact,
    group,
    total,
    products: items,
    related: relatedFor(term, keyword || contextKey, items, recents),
    shorts,
    lives,
    posts,
    counts: {
      products: total,
      shorts: between(r, 120, 2400),
      lives: between(r, 3, 18),
      posts: between(r, 60, 3800),
    },
  }
}

/* 추천 상품 탭 정렬·필터 */
export const SORTS = [
  { id: 'rank', label: '랭킹순' },
  { id: 'priceAsc', label: '낮은 가격순' },
  { id: 'priceDesc', label: '높은 가격순' },
  { id: 'reviews', label: '리뷰 많은순' },
]
export function sortProducts(list, sort) {
  const arr = [...list]
  if (sort === 'priceAsc') arr.sort((a, b) => a.price - b.price)
  else if (sort === 'priceDesc') arr.sort((a, b) => b.price - a.price)
  else if (sort === 'reviews') arr.sort((a, b) => b.reviews - a.reviews || b.buys - a.buys)
  return arr
}
export function filterProducts(list, { freeShip, smile } = {}) {
  return list.filter((p) => (!freeShip || p.ship === 'free') && (!smile || p.smile))
}

export { SEARCH_CATALOG }
