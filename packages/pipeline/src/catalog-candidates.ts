import type {
  Answer,
  CatalogContentRow,
  CatalogProduct,
  CatalogProductRow,
  PlanContentItem,
  PlanPageWire,
  Profile,
  SurveyPageWire,
} from '@ddak/schema'
import { CATALOG } from './catalog'
import type { ConstraintLedger } from './ledger'

/*
 * 내재화 카탈로그 — 후보 조회·주입·수확의 순수 로직 (2026-09-17). 전략 문서 4단계(근거 수집)의 첫 실구현이다:
 * 계획 생성이 웹 검색만으로 상품·콘텐츠를 찾던 것을 **내부 DB 후보 절반 + 웹 검색 절반**으로 바꾼다.
 *
 *  - 검색어 추출(catalogTermsOf): 의도·답변·프로필·원장에서 낱말을 뽑고, 제품 유형 어휘(쿠션·선크림…)를 별도로 골라낸다.
 *    core 는 이 낱말들로 search_text 부분 일치 개수를 세어 순위를 매긴다 (형태소 분석 없음 — 어휘 표가 그 몫을 한다).
 *  - 후보 투영(candidateProductOf/candidateContentOf): DB 행 → 와이어(CatalogProduct·PlanContentItem). 프롬프트 가변부에
 *    id 표로 실리고(candidatesBlock), 모델은 id 만 적는다 — 주소·가격을 되받아 적지 않으니 지어낸 PDP 가 끼어들 틈이 없다.
 *  - 수확(harvestRowsOf): 검증 게이트를 통과한 계획 페이지의 상품·콘텐츠를 DB 행으로 — 지마켓·올리브영·쿠팡은 상품 번호 형식이
 *    맞으면 verified(주소가 번호로 결정된다), 그 밖의 몰은 썸네일(og:image)을 받아 왔으면 verified, 아니면 unverified(운영자 표시로
 *    승격). 계획이 만들어질수록 표가 자란다. 올리브영은 사내 Mongo(tagging-api `scripts/export-catalog.mjs`)로도 시딩할 수 있다.
 *  - 시딩(seedProductRowsOf): 시딩 실행 시 제품 유형별 실제 웹 검색 배치(BFF LLM+web_search)의 결과를 행으로. 재료는 이것과 올리브영
 *    사내 Mongo 내보내기·지난 쓰레드 수확 세 가지다 — 스튜디오 SRP 스냅샷은 SRP 목업 전용이라 시딩에 쓰지 않는다.
 *
 * FE(운영 콘솔)·BFF·스크립트가 같은 함수를 쓴다 — node 내장 모듈을 쓰지 않는다.
 */

/** 제품 유형 어휘 — 정식 이름 → 별칭. 검색어·답변에서 이 낱말이 보이면 typeTerms 로 가중하고, 정식 이름 목록이 곧 시딩 웹 검색 배치의 검색 단위
 * (CATALOG_SEED_KEYWORDS)다. 스튜디오 `lib/searchCatalog.js` SEARCH_VOCAB 과 같은 어휘 — 새 어휘는 같이 */
export const PRODUCT_TYPE_VOCAB: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['쿠션', ['쿠션팩트', '쿠션 팩트']],
  ['파운데이션', ['파데', '파운데']],
  ['컨실러', []],
  ['파우더', ['팩트', '루스파우더']],
  ['프라이머', []],
  ['픽서', ['픽싱', '세팅 스프레이', '픽싱 미스트']],
  ['선크림', ['썬크림', '자외선차단제', '자외선 차단제', '선케어', '썬케어', '선블록', '썬블록', '선로션']],
  ['선스틱', ['썬스틱']],
  ['톤업크림', ['톤업', '톤업 크림']],
  ['메이크업 베이스', ['메이크업베이스']],
  ['토너패드', ['토너 패드', '패드']],
  ['토너', ['스킨토너', '스킨']],
  ['세럼', []],
  ['앰플', []],
  ['에센스', []],
  ['수분크림', ['수분 크림']],
  ['크림', ['보습크림', '진정크림', '장벽크림', '아이크림']],
  ['로션', ['에멀전', '에멀젼']],
  ['미스트', []],
  ['마스크팩', ['마스크 팩', '시트팩', '시트 마스크', '팩']],
  ['클렌징 폼', ['클렌징폼', '폼클렌저', '폼 클렌저', '폼클렌징']],
  ['클렌징 오일', ['클렌징오일']],
  ['클렌저', ['클렌징', '세안제', '세안']],
  ['립스틱', ['립']],
  ['틴트', []],
  ['립밤', ['립 밤']],
  ['립글로스', ['글로스']],
  ['아이섀도', ['아이섀도우', '섀도우', '섀도', '아이쉐도우']],
  ['아이라이너', ['라이너']],
  ['마스카라', []],
  ['아이브로우', ['눈썹']],
  ['블러셔', ['블러쉬', '치크']],
  ['하이라이터', []],
  ['컨투어', ['쉐딩', '셰딩', '쉐이딩']],
  ['바디워시', ['바디 워시', '샤워젤', '바디클렌저']],
  ['바디로션', ['바디 로션', '바디크림']],
  ['샴푸', []],
  ['트리트먼트', ['헤어팩', '헤어 트리트먼트']],
  ['헤어 오일', ['헤어오일', '헤어에센스', '헤어 에센스']],
  ['향수', ['퍼퓸']],
  ['핸드크림', ['핸드 크림']],
  ['쉐이빙 젤', ['쉐이빙', '셰이빙', '면도', '애프터쉐이브']],
]

const TYPE_ALIASES: ReadonlyArray<[string, string]> = (() => {
  const out: [string, string][] = []
  for (const [canon, aliases] of PRODUCT_TYPE_VOCAB) {
    out.push([canon, canon])
    for (const alias of aliases) out.push([alias, canon])
  }
  // 긴 별칭이 먼저 잡히게 (「수분크림」이 「크림」보다, 「토너패드」가 「토너」보다)
  return out.sort((a, b) => b[0].length - a[0].length)
})()

/** 검색어에서 뺄 낱말 — 추천 요청 상투어·조사·너무 흔한 말 */
const STOP_WORDS = new Set([
  '추천', '추천해줘', '추천해', '추천해주세요', '찾아줘', '알려줘', '골라줘', '좋은', '좋을까', '있는', '없는', '위한', '위해', '제품', '상품',
  '으로', '에서', '그리고', '해줘', '주세요', '싶어요', '싶어', '싶은', '어요', '것', '거', '좀', '더', '정도', '가장', '제일', '사용', '중',
  '및', '그', '이', '저', '때', '용', '무엇', '어떤', '어디', '하나', '정말', '너무', '많이', '조금', '잘', '안', '못', '요', '뭐', '어떻게',
  '해서', '해도', '인데', '지만', '까지', '부터', '보다', '처럼', '같은', '같이', '대해', '대한', '관련', '기준', '이유', '방법', '해요',
])
const PARTICLES = ['으로', '에서', '이랑', '하고', '에게', '까지', '부터', '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '과', '와', '만', '요']

const normalize = (text: string) => String(text || '').replace(/\s+/g, '').toLowerCase()

/** 문장 → 낱말 후보 — 구두점 분리, 조사 떼기, 상투어 제거. 2~12자 한글·영문·숫자만 */
export function tokenizeKo(text: string): string[] {
  const out: string[] = []
  for (const raw of String(text || '').split(/[\s,.·/()\[\]{}|"'`!?~+&:;…—–\-]+/)) {
    let token = raw.trim().toLowerCase()
    if (!token) continue
    if (/추천|해줘|주세요|싶|알려|찾아/.test(token)) continue
    for (const p of PARTICLES) {
      if (token.length - p.length >= 2 && token.endsWith(p)) {
        token = token.slice(0, -p.length)
        break
      }
    }
    if (token.length < 2 || token.length > 12) continue
    if (!/^[가-힣a-z0-9]+$/.test(token)) continue
    if (STOP_WORDS.has(token)) continue
    if (/^\d+$/.test(token)) continue
    if (!out.includes(token)) out.push(token)
  }
  return out
}

/** 텍스트에서 제품 유형(정식 이름) 골라내기 — 별칭은 정식 이름으로, 긴 별칭 우선 */
export function productTypesOf(text: string): string[] {
  const hay = normalize(text)
  const found: string[] = []
  let rest = hay
  for (const [alias, canon] of TYPE_ALIASES) {
    const key = normalize(alias)
    if (!key || !rest.includes(key)) continue
    if (!found.includes(canon)) found.push(canon)
    rest = rest.split(key).join(' ') // 잡힌 자리를 지워 「수분크림」 뒤에 「크림」이 또 잡히지 않게
  }
  return found
}

export type CatalogTerms = {
  /** 낱말 전체 (제품 유형 포함) — core 검색의 부분 일치 재료 */
  terms: string[]
  /** 제품 유형 정식 이름 — 이름·태그에 맞으면 가중 */
  typeTerms: string[]
}

/** 의도·설문 답변·프로필·원장 → 검색어. 답변은 제목만(선택지 부제는 판단 기준 문장이라 뺀다) */
export function catalogTermsOf(input: {
  intent: string
  survey?: SurveyPageWire | null
  answers?: Answer[] | null
  profile?: Profile | null
  ledger?: ConstraintLedger | null
}): CatalogTerms {
  const parts: string[] = [input.intent]
  for (const a of input.answers ?? []) {
    const q = input.survey?.questions.find((x) => x.id === a.questionId)
    if (q?.kind === 'photo') continue
    parts.push(...a.choices)
  }
  for (const p of input.profile ?? []) if (/피부|톤|컬러|고민|타입/.test(p.label)) parts.push(p.value)
  for (const f of input.ledger?.facts ?? []) if (f.source === 'intent' && f.label === '목적') parts.push(f.value)
  const text = parts.join(' ')
  const typeTerms = productTypesOf(text)
  const terms = [...typeTerms]
  for (const token of tokenizeKo(text)) if (!terms.includes(token)) terms.push(token)
  return { terms: terms.slice(0, 24), typeTerms: typeTerms.slice(0, 12) }
}

/* ── 후보 (검색 결과 → 와이어) ───────────────────────────────────────────── */

export type CatalogCandidates = {
  products: CatalogProduct[]
  contents: (PlanContentItem & { id: string })[]
}

export const emptyCandidates = (): CatalogCandidates => ({ products: [], contents: [] })

/** DB 행 → 계획 와이어 상품. id 는 행 id 그대로(웹 상품 `web-` 접두와 갈린다 — 근거 신뢰 점수·품질 KPI 가 접두로 내부/웹을 가른다) */
export function candidateProductOf(row: CatalogProductRow): CatalogProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    price: row.price,
    ...(row.price > 0 ? {} : { priceUnknown: true }),
    tags: row.tags,
    url: row.url,
    mall: row.mall,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
  }
}

export function candidateContentOf(row: CatalogContentRow): PlanContentItem & { id: string } {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    title: row.title,
    url: row.url,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
    ...(row.meta ? { meta: row.meta } : {}),
    ...(row.snippet ? { snippet: row.snippet } : {}),
    ...(row.duration ? { duration: row.duration } : {}),
  }
}

/** DB 후보가 하나도 없을 때(마이그레이션 전·core 미연결) 데모 카탈로그로 대신 — 옛 {{CATALOG}} 시스템 블록과 같은 상품 */
export function staticCandidates(): CatalogCandidates {
  return { products: CATALOG.filter((p) => p.url), contents: [] }
}

const won = (n: number) => (n > 0 ? `${n.toLocaleString('ko-KR')}원` : '가격 미확인')

/** 상품 후보 표 — 가변부(사용자 메시지)에 실린다. 시스템 프롬프트는 바이트 고정이라 요청별 후보는 여기 */
export function productCandidatesBlock(products: CatalogProduct[]): string {
  if (!products.length) return ''
  const rows = products.map(
    (p) => `${p.id} | ${p.mall ?? '지마켓'} | ${[p.brand, p.name].filter(Boolean).join(' ')} | ${won(p.price)} | ${(p.tags ?? []).slice(0, 6).join(',')}`,
  )
  return `\n\n내부 카탈로그 후보 (검증된 판매 상품 — id | 몰 | 브랜드 상품명 | 가격 | 태그):\n${rows.join('\n')}\n이 후보에서 고른 상품은 productIds 에 **id 만** 적는다(이름·가격·주소를 다시 적지 않는다 — 화면이 카탈로그 값을 그대로 쓴다). 섹션마다 상품의 **절반(3~4개)을 이 후보에서**, 나머지 절반을 웹 검색(외부몰)에서 고른다. 후보 중 그 섹션 용도에 맞는 상품이 모자라면 맞는 것만 고르고 웹 검색 몫을 늘린다 — 용도가 다른 후보로 개수를 채우지 않는다.`
}

/** 콘텐츠 후보 표 — 5c 가변부 */
export function contentCandidatesBlock(contents: CatalogCandidates['contents']): string {
  if (!contents.length) return ''
  const rows = contents.map(
    (c) => `${c.id} | ${c.type === 'video' ? '영상' : '게시글'} | ${c.source} | ${c.title}${c.meta ? ` | ${c.meta}` : ''}`,
  )
  return `\n\n내부 콘텐츠 후보 (이전 계획에서 확인된 게시글·영상 — id | 종류 | 출처 | 제목 | 부가 정보):\n${rows.join('\n')}\n이 후보에서 고른 콘텐츠는 섹션의 catalogIds 에 **id 만** 적는다(items 에 다시 적지 않는다). 주제에 맞는 후보가 있으면 섹션마다 항목의 **절반은 이 후보에서**, 나머지 절반은 웹 검색으로 새로 찾는다 — 후보만으로 채우거나 후보를 무시하지 않는다. 주제가 안 맞는 후보는 고르지 않는다.`
}

/* ── 수확 (계획 페이지 → DB 행) ───────────────────────────────────────────── */

/** FNV-1a 32비트 — node crypto 없이 FE·BFF 가 같은 id 를 만든다 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** 지마켓 상품 번호 — guards/grounding.gmarketGoodsCodeOf 와 같은 규칙 (순환 import 를 피해 여기 한 벌 더) */
export function goodsCodeOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!/(^|\.)gmarket\.co\.kr$/i.test(url.hostname)) return null
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === 'goodscode' && /^\d{6,}$/.test(value)) return value
  const m = url.pathname.match(/\/vi\/product\/(\d{6,})/i) ?? url.pathname.match(/\/item\/(\d{6,})/i)
  return m ? m[1] : null
}

/** 올리브영 goodsNo — `getGoodsDetail.do?goodsNo=A000000214358` 꼴(A + 숫자 12자리)만 */
export function oliveyoungGoodsNoOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!/(^|\.)oliveyoung\.co\.kr$/i.test(url.hostname)) return null
  if (!/getGoodsDetail/i.test(url.pathname)) return null
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === 'goodsno' && /^A\d{12}$/i.test(value)) return value.toUpperCase()
  return null
}

/** 쿠팡 상품 번호 — `/vp/products/<번호>` */
export function coupangProductIdOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!/(^|\.)coupang\.com$/i.test(url.hostname)) return null
  const m = url.pathname.match(/\/vp\/products\/(\d{5,})/)
  return m ? m[1] : null
}

/** PDP 정체 키 — 같은 상품을 다른 주소 형태(지마켓 item/m·올리브영 www/m)로 적어도 같은 키. 몰별 상품 번호 형식이 맞을 때만 */
export function pdpKeyOf(raw: string): string | null {
  const gm = goodsCodeOf(raw)
  if (gm) return `gm:${gm}`
  const oy = oliveyoungGoodsNoOf(raw)
  if (oy) return `oy:${oy.toLowerCase()}`
  const cp = coupangProductIdOf(raw)
  if (cp) return `cp:${cp}`
  return null
}

/** 내부 카탈로그의 「검증됨」 판정 — 몰별 상품 번호 형식이 맞으면(지마켓·올리브영·쿠팡 — 주소가 상품 번호로 결정된다) 검증,
 * 그 밖의 몰은 썸네일(og:image)을 받아 왔으면(= 페이지가 200 으로 열렸다) 검증. 형식도 그림도 없으면 미검증 — 후보 표에서 빠지고
 * 운영자 표시(PATCH verified)·점검으로만 승격된다 (2026-09-17: 올리브영·다른 몰도 내부 후보가 되게 지마켓 한정에서 넓혔다) */
export function pdpVerified(url: string, imageUrl?: string | null): boolean {
  return Boolean(pdpKeyOf(url)) || Boolean(imageUrl)
}

export const gmarketPdpUrl = (code: string) => `https://item.gmarket.co.kr/Item?goodscode=${code}`
export const gmarketThumb = (code: string) => `https://gdimg.gmarket.co.kr/${code}/still/280`
export const oliveyoungPdpUrl = (goodsNo: string) => `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo.toUpperCase()}`

const tagsOf = (list: string[]) => [...new Set(list.map((t) => t.trim()).filter((t) => t.length >= 2))]

/** 계획 페이지의 상품 하나 → 카탈로그 행. 검색 링크(urlKind=search)·주소 없는 상품은 null (내재화 대상이 아니다) */
export function harvestProductRow(p: CatalogProduct, terms: string[], now: string): CatalogProductRow | null {
  if (!p.url || p.urlKind === 'search') return null
  const tags = tagsOf([...(p.tags ?? []), ...terms]).slice(0, 30)
  const base = {
    name: p.name,
    brand: p.brand,
    price: p.priceUnknown ? 0 : p.price,
    tags,
    recommendCount: 1,
    lastSeenAt: now,
  }
  if (!p.id.startsWith('web-')) {
    // 내부 후보·데모 카탈로그가 다시 실린 것 — 같은 id 로 올려 count 만 오른다 (bump upsert 가 source·verified 는 보존)
    const key = pdpKeyOf(p.url)
    return {
      id: p.id,
      mall: p.mall ?? '지마켓',
      mallProductId: key ? key.slice(3) : null,
      url: p.url,
      imageUrl: p.imageUrl ?? null,
      source: 'thread',
      verified: pdpVerified(p.url, p.imageUrl),
      ...base,
    }
  }
  const code = goodsCodeOf(p.url)
  if (code) {
    return {
      id: `gm-${code}`,
      mall: '지마켓',
      mallProductId: code,
      url: gmarketPdpUrl(code),
      imageUrl: p.imageUrl ?? gmarketThumb(code),
      source: 'thread',
      verified: true,
      ...base,
    }
  }
  const goodsNo = oliveyoungGoodsNoOf(p.url)
  if (goodsNo) {
    // 올리브영 — goodsNo(A+12자리) 형식이 맞으면 주소가 결정되므로 검증 (2026-09-17: 지마켓과 같은 대우)
    return {
      id: `oy-${goodsNo.toLowerCase()}`,
      mall: '올리브영',
      mallProductId: goodsNo,
      url: oliveyoungPdpUrl(goodsNo),
      imageUrl: p.imageUrl ?? null,
      source: 'thread',
      verified: true,
      ...base,
    }
  }
  const cp = coupangProductIdOf(p.url)
  if (cp) {
    return {
      id: `cp-${cp}`,
      mall: '쿠팡',
      mallProductId: cp,
      url: p.url,
      imageUrl: p.imageUrl ?? null,
      source: 'thread',
      verified: true,
      ...base,
    }
  }
  // 그 밖의 몰(무신사·화해·백화점몰…) — 썸네일(og:image)을 받아 왔으면 페이지가 실제로 열린 것이라 검증
  return {
    id: `web-${fnv1a(p.url)}`,
    mall: p.mall ?? '외부몰',
    mallProductId: null,
    url: p.url,
    imageUrl: p.imageUrl ?? null,
    source: 'thread',
    verified: pdpVerified(p.url, p.imageUrl),
    ...base,
  }
}

const yearOf = (meta: string | undefined): number | null => {
  const m = String(meta || '').match(/(20\d{2})\s*(?:년|[.\-/])/)
  return m ? Number(m[1]) : null
}

export function harvestContentRow(c: PlanContentItem & { id?: string }, terms: string[], now: string): CatalogContentRow | null {
  if (!/^https?:\/\//.test(c.url)) return null
  return {
    id: c.id && !c.id.startsWith('web-') ? c.id : `ct-${fnv1a(c.url)}`,
    type: c.type,
    source: c.source,
    title: c.title,
    url: c.url,
    imageUrl: c.imageUrl ?? null,
    meta: c.meta ?? null,
    snippet: c.snippet ?? null,
    duration: c.duration ?? null,
    tags: tagsOf(terms).slice(0, 40),
    year: yearOf(c.meta),
    verified: true,
    recommendCount: 1,
    lastSeenAt: now,
  }
}

/** 최종 계획 페이지 → 수확 행. terms 는 이 계획의 검색어(catalogTermsOf) — 다음 검색이 이 상품·콘텐츠를 찾는 태그가 된다 */
export function harvestRowsOf(
  page: PlanPageWire,
  terms: string[],
  now = new Date().toISOString(),
): { products: CatalogProductRow[]; contents: CatalogContentRow[] } {
  const products = new Map<string, CatalogProductRow>()
  const contents = new Map<string, CatalogContentRow>()
  for (const section of page.sections) {
    if (section.kind === 'products') {
      // 섹션 제목의 제품 유형도 태그로 — 「밀착 쿠션·유분 제어 파우더」 자리에 실린 상품은 쿠션·파우더 검색에 걸려야 한다
      const sectionTerms = [...terms, ...productTypesOf(section.title)]
      for (const p of section.products) {
        const row = harvestProductRow(p, sectionTerms, now)
        if (row && !products.has(row.id)) products.set(row.id, row)
      }
    } else if (section.kind === 'contents') {
      for (const c of section.items) {
        const row = harvestContentRow(c, terms, now)
        if (row && !contents.has(row.id)) contents.set(row.id, row)
      }
    }
  }
  return { products: [...products.values()], contents: [...contents.values()] }
}

/* ── 시딩 (웹 검색 배치 → 행) ───────────────────────────────────────────────
 * 시딩 재료는 셋이다 (2026-09-17 결정): ① 올리브영 사내 Mongo 내보내기(tagging-api scripts/export-catalog.mjs → JSON 가져오기),
 * ② 지난 쓰레드의 계획(수확 — harvestRowsOf), ③ 시딩 실행 시 제품 유형별 **실제 웹 검색 배치** — 운영 콘솔이 어휘 표를 몇 개씩 잘라
 * BFF `POST /api/admin/catalog/seed-search` 를 부르고, BFF 가 유형마다 LLM+web_search 1회(CATALOG_SEED_SYSTEM)로 판매 상품을 모아
 * 아래 seedProductRowsOf 로 행을 만든다. 스튜디오 SRP 스냅샷·데모 카탈로그는 더 이상 시딩 재료가 아니다(스냅샷은 SRP 목업 전용). */

/** 웹 검색 시딩의 기본 검색 단위 — 제품 유형 어휘의 정식 이름 전부 */
export const CATALOG_SEED_KEYWORDS: readonly string[] = PRODUCT_TYPE_VOCAB.map(([canon]) => canon)

/** 웹 검색 시딩 LLM 이 돌려주는 상품 하나 (schemas.ts CatalogSeedProductGen 과 같은 모양) */
export type CatalogSeedProduct = {
  name: string
  brand: string
  price: number
  mall: string
  url: string
  imageUrl: string
  tags: string[]
}

/** 검색 배치 결과 → 카탈로그 행. 주소가 http(s) 가 아니거나 검색·목록 페이지면 버리고, 몰별 상품 번호 형식(지마켓·올리브영·쿠팡)이 맞으면
 * verified, 그 밖의 몰은 썸네일이 있으면 verified. 같은 정체 키(pdpKeyOf)는 한 번만. source 는 'search', category 는 검색 유형 */
export function seedProductRowsOf(keyword: string, products: CatalogSeedProduct[], now = new Date().toISOString()): CatalogProductRow[] {
  const rows = new Map<string, CatalogProductRow>()
  for (const p of products) {
    const url = String(p.url || '').trim()
    if (!/^https?:\/\//.test(url)) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (/\/(search|srchall|category|display)\b/i.test(parsed.pathname)) continue
    const name = String(p.name || '').replace(/^(?:\[[^\]]*\]\s*)+/, '').trim()
    if (!name) continue
    const key = pdpKeyOf(url)
    const gm = goodsCodeOf(url)
    const oy = oliveyoungGoodsNoOf(url)
    const cp = coupangProductIdOf(url)
    const id = gm ? `gm-${gm}` : oy ? `oy-${oy.toLowerCase()}` : cp ? `cp-${cp}` : `web-${fnv1a(url)}`
    if (rows.has(id)) continue
    const imageUrl = /^https?:\/\//.test(String(p.imageUrl || '')) ? p.imageUrl : gm ? gmarketThumb(gm) : null
    const mall = gm ? '지마켓' : oy ? '올리브영' : cp ? '쿠팡' : String(p.mall || '').trim() || '외부몰'
    rows.set(id, {
      id,
      mall,
      mallProductId: key ? key.slice(3) : null,
      name,
      brand: String(p.brand || '').trim(),
      price: Number.isFinite(p.price) && p.price > 0 ? Math.round(p.price) : 0,
      url: gm ? gmarketPdpUrl(gm) : oy ? oliveyoungPdpUrl(oy) : url,
      imageUrl,
      tags: tagsOf([keyword, ...productTypesOf(name), ...(p.tags ?? [])]).slice(0, 30),
      category: keyword,
      source: 'search',
      verified: pdpVerified(url, imageUrl),
      status: 'active',
      meta: null,
      recommendCount: 0,
      lastSeenAt: now,
    })
  }
  return [...rows.values()]
}

/* ── 대량 시딩 — 검색 단위 생성 (2026-09-17) ───────────────────────────────────
 * 유형 하나에 검색 1회면 8~12개라 42개 유형으로는 400여 개에 그친다. 대량으로 채우려면 검색 단위를 **유형 × 조건**으로 펼친다:
 * 조건은 피부 타입·고민·가격대·몰 네 축이고, 축을 고를수록 검색 수가 곱해진다(유형 42 × 조건 15 ≈ 630 검색 ≈ 상품 5,000개 안팎).
 * 같은 상품이 여러 검색에 걸리면 id(몰별 상품 번호)로 한 행에 합쳐진다. 운영 콘솔·배치 스크립트(apps/bff/scripts/seed-search.mjs)가 같은 목록을 만든다 */

export type CatalogSeedFacetKey = 'skin' | 'concern' | 'price' | 'mall'

/** 조건 축 — 검색어 앞에 붙는 수식 (「지성 피부 쿠션」·「올리브영 쿠션」). 제품 유형과 무관하게 붙여도 말이 되는 것만 */
export const CATALOG_SEED_FACETS: Record<CatalogSeedFacetKey, { label: string; values: readonly string[] }> = {
  skin: { label: '피부 타입', values: ['지성 피부', '건성 피부', '복합성 피부', '민감성 피부'] },
  concern: { label: '고민', values: ['수분', '진정', '미백', '주름', '모공', '트러블'] },
  price: { label: '가격대', values: ['가성비', '프리미엄'] },
  mall: { label: '몰', values: ['올리브영', '지마켓', '쿠팡'] },
}

export type CatalogSeedQuery = {
  /** 제품 유형(정식 이름) — 행의 category·태그 */
  keyword: string
  /** 실제 검색 초점 문구 — 유형만이면 keyword 와 같다 */
  query: string
  facet?: CatalogSeedFacetKey
}

/** 검색 단위 목록 — types(기본 어휘 전부) × (기본 1 + 고른 조건 축의 값들). 결정적 순서라 배치 스크립트가 진행 위치를 저장하고 이어 돌 수 있다 */
export function catalogSeedQueries(opts: { types?: readonly string[]; facets?: readonly CatalogSeedFacetKey[] } = {}): CatalogSeedQuery[] {
  const types = (opts.types?.length ? opts.types : CATALOG_SEED_KEYWORDS).filter((t) => t && t.trim())
  const facets = opts.facets ?? []
  const out: CatalogSeedQuery[] = []
  for (const keyword of types) {
    out.push({ keyword, query: keyword })
    for (const facet of facets) {
      for (const value of CATALOG_SEED_FACETS[facet]?.values ?? []) out.push({ keyword, query: `${value} ${keyword}`, facet })
    }
  }
  return out
}

/** 검색 1회의 대략 비용(달러) — 검색 3회($0.03) + Opus 입력 약 12K($0.06) + 출력 약 2K($0.05). dense 는 검색 4회·출력 16개라 조금 더 */
export const CATALOG_SEED_COST_PER_QUERY_USD = { normal: 0.14, dense: 0.18 } as const
