import type { CatalogProduct, PlanContentItem, PlanSectionWire } from '@ddak/schema'
import type { ContentsSectionGen, PlanSkeletonSectionGen, ProductRatingGen, ProductsSectionGen } from '../schemas'
import type { ConstraintLedger } from '../ledger'
import { cartedNames } from '../ledger'
import { CATALOG, CATALOG_BY_ID } from '../catalog'
import { findMedicalClaim } from './claims'
import { scoreProductMatch, withMatchFactor } from './match'

/*
 * 검증 게이트(전략 문서 6단계)의 그라운딩 가드 — LLM이 만든 상품·콘텐츠 섹션을
 * 목록·URL 규칙과 대조해 통과분만 wire 섹션으로 확정한다. 순수 함수라 스트림 조각과
 * 최종 결과가 일치하고(§4-3), 그래프 노드·스튜디오 dry-run·테스트가 그대로 재사용한다.
 * 드롭은 로그 대신 GroundingDrop으로 반환한다 — 호출자가 로깅하고, 전략 문서 p.11의
 * "드롭 사유는 그대로 품질 로그로"는 이 목록을 plan 스텝 payload(dropLog)에 싣는 것으로 구현한다.
 * guard(선택)는 확장 게이트: 블록리스트 정확 매칭·의학 단정 차단·원장 역대조(예산·기피·담은 상품) —
 * 없으면 기본 그라운딩만 (legacy 경로 동작 불변).
 *
 * 2026-09 운영 기록 분석 뒤 추가된 규칙:
 *  - 웹 상품 이름 정규화(프로모션 대괄호·브랜드 중복 제거)와 가격 미확인(0원) 표식
 *  - 카탈로그 보충은 매칭 60% 이상·섹션당 3개까지 — 용도가 다른 카탈로그 상품이 빈자리를 채우던 것을 막는다
 *  - 콘텐츠는 3년 넘은 것·저신뢰 출처(KV guard-content-hosts)·같은 출처 3개째·최근 쓰레드에서 이미 보여준 URL 을 드롭
 */

export type GroundingDrop = {
  code:
    | 'catalog-miss'
    | 'catalog-low-match'
    | 'catalog-overflow'
    | 'invalid-url'
    | 'search-like-url'
    | 'blocklist'
    | 'medical-claim'
    | 'ledger-budget'
    | 'ledger-avoid'
    | 'already-in-cart'
    | 'stale-content'
    | 'low-trust-source'
    | 'duplicate-source'
    | 'duplicate-recent'
    /** 정보 기록(드롭 아님) — 5c 첫 호출이 콘텐츠를 못 찾아 검색어를 바꿔 한 번 더 불렀다 */
    | 'contents-empty-retry'
    /** 정보 기록(드롭 아님) — 상품 검색(5b)이 상품 섹션을 하나도 못 만들어 뼈대 자리를 카탈로그 매칭으로 채웠다 */
    | 'catalog-fallback'
  message: string
}

/** 확장 게이트 입력 — 생성과 검증이 같은 값을 본다 (원장 = 구조체, 블록리스트·저신뢰 출처 = KV) */
export type GuardContext = {
  blocklist?: string[]
  ledger?: ConstraintLedger | null
  /** 콘텐츠 저신뢰 출처 도메인 (KV guard-content-hosts, 줄바꿈 구분 — 접미 일치) */
  contentBlockHosts?: string[]
  /** 콘텐츠 신선도 기준 연도 — 기본은 오늘 (테스트에서 고정) */
  referenceYear?: number
}

/** 블록리스트 KV 저장 키 — 쓰레드 피드백에서 증류한 상품명(줄바꿈 구분, 정확 매칭) */
export const GUARD_BLOCKLIST_SETTING_KEY = 'guard-blocklist'
/** 콘텐츠 저신뢰 출처 KV 저장 키 — 도메인(줄바꿈 구분, 접미 일치). SEO 어필리에이트 블로그처럼 목록만 나열하는 출처를 운영자가 적는다 */
export const GUARD_CONTENT_HOSTS_SETTING_KEY = 'guard-content-hosts'

/** 카탈로그 보충 상품의 최소 매칭율 — 이 아래면 용도가 안 맞는 것으로 보고 드롭 */
export const CATALOG_MIN_MATCH = 60
/** 섹션당 카탈로그 보충 상한 (프롬프트 규칙과 한 벌) */
export const CATALOG_MAX_PER_SECTION = 3
/** 참고 콘텐츠 신선도 — 이 햇수를 넘은 콘텐츠는 드롭 */
export const CONTENT_MAX_AGE_YEARS = 3
/** 섹션당 같은 출처(도메인) 상한 */
export const CONTENT_MAX_PER_HOST = 2

export type GroundingResult = { section: PlanSectionWire | null; drops: GroundingDrop[] }

const normalizeName = (text: string) => String(text || '').replace(/\s+/g, '').toLowerCase()

/** 웹 상품 이름 정규화 — "[8월올영픽/대용량140매] 넘버즈인 1번 패드" → "1번 패드" (브랜드는 brand 필드에 있다).
 * 앞머리 대괄호 프로모션 문구를 전부 떼고, 이름이 브랜드로 시작하면(중복) 그 브랜드를 뗀다. 상품명 본문의 괄호(기획 구성 등)는 남긴다 */
export function normalizeWebProductName(name: string, brand?: string): string {
  let text = String(name || '').replace(/\s+/g, ' ').trim()
  text = text.replace(/^(?:\[[^\]]*\]\s*)+/, '').trim()
  const b = String(brand || '').trim()
  if (b) {
    const key = normalizeName(b)
    for (let i = 0; i < 2; i += 1) {
      if (key && normalizeName(text).startsWith(key) && text.length > b.length) {
        // 브랜드 글자 수만큼 앞에서 걷어낸다 (공백·대소문자 차이 흡수)
        let consumed = 0
        let idx = 0
        while (idx < text.length && consumed < key.length) {
          const ch = text[idx]
          if (!/\s/.test(ch)) consumed += 1
          idx += 1
        }
        const rest = text.slice(idx).replace(/^[\s\-–·]+/, '').trim()
        if (rest) text = rest
        else break
      } else break
    }
  }
  return text || String(name || '').trim()
}

/** 상품 하나의 확장 게이트 판정 — 걸리면 드롭 사유, 통과면 null */
function productGuardDrop(product: CatalogProduct, guard: GuardContext | undefined, carted: Set<string>): GroundingDrop | null {
  if (!guard) return null
  const label = `${product.brand ?? ''} ${product.name}`.trim()
  if (guard.blocklist?.some((b) => b && (product.name === b || label === b))) {
    return { code: 'blocklist', message: `블록리스트 정확 매칭으로 드롭: ${label}` }
  }
  const claim = findMedicalClaim([product.name, ...(product.tags ?? [])].join(' '))
  if (claim) {
    return { code: 'medical-claim', message: `의학적 효능 단정 표현("${claim}")으로 드롭: ${label}` }
  }
  const budget = guard.ledger?.budgetKrw
  if (budget != null && product.price > budget) {
    return {
      code: 'ledger-budget',
      message: `원장 예산 상한(${budget.toLocaleString('ko-KR')}원) 초과로 드롭: ${label} (${product.price.toLocaleString('ko-KR')}원)`,
    }
  }
  const avoided = guard.ledger?.avoid.find(
    (a) => a && (product.name.includes(a) || (product.tags ?? []).some((t) => t.includes(a))),
  )
  if (avoided) {
    return { code: 'ledger-avoid', message: `원장 기피 항목(${avoided}) 위반으로 드롭: ${label}` }
  }
  if (carted.has(normalizeName(product.name)) || carted.has(normalizeName(label))) {
    return { code: 'already-in-cart', message: `이미 담은 상품이라 드롭: ${label}` }
  }
  return null
}

/** 지마켓 상품 번호(goodscode) — item.gmarket.co.kr/Item?goodscode=… · m.gmarket.co.kr/vi/product/… (대소문자 무관) */
export function gmarketGoodsCodeOf(raw: string | URL): string | null {
  const url = typeof raw === 'string' ? parseHttpUrl(raw) : raw
  if (!url || !/(^|\.)gmarket\.co\.kr$/i.test(url.hostname)) return null
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === 'goodscode' && /^\d{6,}$/.test(value)) return value
  const m = url.pathname.match(/\/vi\/product\/(\d{6,})/i) ?? url.pathname.match(/\/item\/(\d{6,})/i)
  return m ? m[1] : null
}

/** 지마켓 썸네일 — 카탈로그와 같은 규격 gdimg.gmarket.co.kr/{goodscode}/still/280. 상품 번호를 아는 지마켓 상품은 페이지를 안 받아도
 * 썸네일이 결정적으로 나온다(2026-09-14 — 웹 검색 상품의 썸네일이 거의 비어 있던 것의 지마켓 몫) */
export function gmarketThumbnailOf(raw: string | URL): string | null {
  const code = gmarketGoodsCodeOf(raw)
  return code ? `https://gdimg.gmarket.co.kr/${code}/still/280` : null
}

/** 판매처 이름 정규화 — 주소 호스트가 말해 주는 몰은 그 이름으로 통일한다(모델이 "G마켓"·"Gmarket"·"올영"처럼 제각각 적는다 —
 * 화면의 몰 톤·담은 상품 시트·지마켓 50 : 외부몰 50 구성 확인이 같은 이름을 본다). 그 밖의 몰은 모델이 적은 이름 그대로 */
const MALL_BY_HOST: [RegExp, string][] = [
  [/(^|\.)gmarket\.co\.kr$/i, '지마켓'],
  [/(^|\.)oliveyoung\.co\.kr$/i, '올리브영'],
  [/(^|\.)coupang\.com$/i, '쿠팡'],
  [/(^|\.)musinsa\.com$/i, '무신사'],
  [/(^|\.)hwahae\.co\.kr$/i, '화해'],
]
export function normalizeMallName(mall: string, url: URL): string {
  for (const [re, name] of MALL_BY_HOST) if (re.test(url.hostname)) return name
  return mall.trim() || '외부몰'
}

export function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

/** 검색 결과·목록 페이지로 보이는 URL 판정 — 상세보기는 PDP만 허용한다 (프롬프트 지시의 서버측 가드).
 * 검색어 쿼리 키나 /search 경로가 있으면 검색 페이지로 본다 — PDP는 보통 상품 번호 키(goodsNo 등)를 쓴다 */
const SEARCH_QUERY_KEYS = new Set(['q', 'query', 'keyword', 'kwd', 'searchterm', 'searchkeyword', 'searchword', 'search_query', 'sq', 'k'])
export function isSearchLikeUrl(url: URL): boolean {
  if (/\/(search|srchall|category|display)\b/i.test(url.pathname)) return true
  for (const key of url.searchParams.keys()) {
    if (SEARCH_QUERY_KEYS.has(key.toLowerCase())) return true
  }
  return false
}

/** 상품 섹션 그라운딩 — 카탈로그 밖 id는 버리고, 웹 상품은 URL(http/https+PDP 또는 urlKind=search) 검증 통과분만 채택.
 * 상세 페이지(url) 없는 상품은 카탈로그 상품이라도 추천하지 않는다 — 상세보기가 열리는 상품만 싣는다.
 * guard가 있으면 확장 게이트(블록리스트·의학 단정·원장 역대조·담은 상품)를 상품 단위로 추가 대조한다.
 * 카탈로그 상품은 매칭율 CATALOG_MIN_MATCH 이상만, 매칭율 순으로 섹션당 CATALOG_MAX_PER_SECTION 개까지 —
 * 용도가 다른 카탈로그 상품이 빈자리를 채우던 것(2026-09 분석: 상품의 57%가 14개 카탈로그 반복)을 막는다.
 * 상품이 하나도 안 남으면 section=null(드롭) */
export function groundProductsSection(
  s: ProductsSectionGen,
  sectionIndex: number,
  guard?: GuardContext,
): GroundingResult {
  const drops: GroundingDrop[] = []
  const carted = new Set(cartedNames(guard?.ledger).map(normalizeName))
  const catalogProducts: CatalogProduct[] = s.productIds
    .map((id) => CATALOG_BY_ID.get(id))
    .filter((p): p is NonNullable<ReturnType<typeof CATALOG_BY_ID.get>> => Boolean(p && p.url))
  if (catalogProducts.length < s.productIds.length) {
    drops.push({
      code: 'catalog-miss',
      message: `카탈로그 밖이거나 PDP url 없는 상품 id ${s.productIds.length - catalogProducts.length}건 드롭`,
    })
  }
  // 외부몰 우선 정책: 웹 상품(올리브영 등)을 앞에 싣고 카탈로그(지마켓)는 뒤에 보조로 붙인다.
  // 통과한 상품에는 매칭율(항목 점수·가중 합산)을 붙여 페이지에 그대로 남긴다 — LLM 평가(rating)가 없으면 폴백 대조
  const products: CatalogProduct[] = []
  const admit = (product: CatalogProduct, rating?: ProductRatingGen): CatalogProduct | null => {
    const guardDrop = productGuardDrop(product, guard, carted)
    if (guardDrop) {
      drops.push(guardDrop)
      return null
    }
    return { ...product, match: scoreProductMatch(product, rating, guard?.ledger) }
  }
  s.webProducts.forEach((w, webIndex) => {
    const url = parseHttpUrl(w.url)
    if (!url) {
      drops.push({ code: 'invalid-url', message: `웹 상품 URL 검증 실패로 드롭: ${w.name} (${w.url})` })
      return
    }
    // 검색/목록 페이지 주소는 상품이 그렇다고 표시한 경우(urlKind=search — PDP 를 못 찾은 대체 링크)만 통과시킨다.
    // PDP 라고 하면서 검색 페이지를 준 것은 예전처럼 드롭 — "PDP 만" 정책은 표시 없는 링크에 그대로 남는다 (2026-09)
    const searchLink = w.urlKind === 'search'
    if (!searchLink && isSearchLikeUrl(url)) {
      drops.push({
        code: 'search-like-url',
        message: `웹 상품 URL이 검색/목록 페이지로 보여 드롭 (PDP 또는 urlKind=search 만 허용): ${w.name} (${w.url})`,
      })
      return
    }
    // 썸네일도 http(s) 검증 통과분만 — 실패해도 상품은 싣는다 (FE가 이모지 목업 폴백). 프로토콜 생략(//…)은 https 로 받고,
    // 지마켓 상품은 상품 번호로 gdimg 썸네일을 결정적으로 채운다 (썸네일 보강 fetch 가 실패해도 지마켓 몫은 언제나 그림이 있다)
    const rawImage = w.imageUrl.trim().startsWith('//') ? `https:${w.imageUrl.trim()}` : w.imageUrl
    const imageUrl = parseHttpUrl(rawImage) ? rawImage : gmarketThumbnailOf(url) ?? undefined
    const priceUnknown = !(Number.isFinite(w.price) && w.price > 0)
    const admitted = admit(
      {
        id: `web-${sectionIndex}-${webIndex}`,
        name: normalizeWebProductName(w.name, w.brand),
        brand: w.brand.trim(),
        price: priceUnknown ? 0 : w.price,
        ...(priceUnknown ? { priceUnknown: true } : {}),
        tags: w.tags,
        url: w.url,
        mall: normalizeMallName(w.mall, url),
        ...(searchLink ? { urlKind: 'search' as const } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
      w.match,
    )
    if (admitted) products.push(admitted)
  })
  // 카탈로그 보충 — 매칭율 기준 미달은 드롭, 순위 상위 3개까지
  const catalogAdmitted: CatalogProduct[] = []
  for (const product of catalogProducts) {
    const rating = s.catalogRatings?.find((r) => r.id === product.id)?.match
    const admitted = admit(product, rating)
    if (!admitted) continue
    const score = admitted.match?.score ?? 0
    const concern = rating?.concern
    if (score < CATALOG_MIN_MATCH || (concern != null && concern <= 2)) {
      drops.push({
        code: 'catalog-low-match',
        message: `카탈로그 보충 상품의 매칭율이 낮아 드롭 (${score}%${concern != null ? ` · 고민 적합 ${concern}/5` : ''}): ${product.brand} ${product.name}`,
      })
      continue
    }
    catalogAdmitted.push(admitted)
  }
  catalogAdmitted.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
  if (catalogAdmitted.length > CATALOG_MAX_PER_SECTION) {
    const overflow = catalogAdmitted.splice(CATALOG_MAX_PER_SECTION)
    drops.push({
      code: 'catalog-overflow',
      message: `카탈로그 보충은 섹션당 ${CATALOG_MAX_PER_SECTION}개까지 — ${overflow.map((p) => p.name).join(', ')} 드롭`,
    })
  }
  products.push(...catalogAdmitted)
  return {
    section: products.length ? { kind: 'products', title: s.title, reason: s.reason, products } : null,
    drops,
  }
}

/** 정보 기록 코드 — 드롭이 아니라 「이런 보정이 있었다」는 표식. 품질 KPI(planQualityOf drops)·드롭 개수 집계에서 뺀다 */
export const INFO_DROP_CODES: ReadonlySet<GroundingDrop['code']> = new Set(['contents-empty-retry', 'catalog-fallback'])
export const isInfoDrop = (d: { code: string }): boolean => INFO_DROP_CODES.has(d.code as GroundingDrop['code'])

const normalizeText = (text: string) => String(text ?? '').replace(/\s+/g, '').toLowerCase()

/** 상품 자리(제목+기준) 텍스트와 겹치는 상품 태그·이름 단어 — 자리 용도 적합의 근거 */
export function slotOverlap(product: CatalogProduct, slotText: string): string[] {
  const hay = normalizeText(slotText)
  if (!hay) return []
  const words = [...(product.tags ?? []), ...String(product.name ?? '').split(/[\s()+·,]+/)]
  const hits = words.map((w) => w.trim()).filter((w) => w.length >= 2 && /[가-힣a-z]/i.test(w) && hay.includes(normalizeText(w)))
  return [...new Set(hits)]
}

/** 상품 검색(5b)이 상품 섹션을 **하나도** 못 만들었을 때의 결정적 폴백 (2026-09-17) — 뼈대의 상품 자리(제목·기준)마다
 * 카탈로그(지마켓)에서 **자리 제목과 태그·이름이 겹치는 상품만**(용도 적합 — 클렌저 자리에 크림을 넣지 않는다) 골라, 제목·기준
 * 겹침을 고민·목적 항목의 근거(1개 겹침 4/5, 2개 이상 5/5)로 삼은 매칭율이 CATALOG_MIN_MATCH 이상인 것을 매칭율 순으로
 * CATALOG_MAX_PER_SECTION 개까지 채운다(확장 게이트·담기 제외는 guard 가 있을 때 그대로, 자리 사이 중복 없음). 원장(guard.ledger)이
 * 없어도(legacy) 자리 겹침만으로 동작한다. 자리 제목을 그대로 쓰므로 병합 배정이 그 자리에 앉힌다. 겹치는 상품이 없는 자리는
 * 비운다(용도와 무관한 상품으로 채우지 않는다 — 옛 catalog-overflow 교훈). 5b 가 섹션을 하나라도 만들었으면 쓰지 않는다 —
 * 그 경우의 카탈로그 보충은 groundProductsSection 이 섹션 안에서 한다 */
export function catalogFallbackSections(
  skeleton: ReadonlyArray<PlanSkeletonSectionGen>,
  guard?: GuardContext,
): { sections: PlanSectionWire[]; note: GroundingDrop | null } {
  const slots = skeleton.filter((s): s is Extract<PlanSkeletonSectionGen, { kind: 'products' }> => s.kind === 'products')
  if (!slots.length) return { sections: [], note: null }
  const carted = new Set(cartedNames(guard?.ledger).map(normalizeName))
  const used = new Set<string>()
  const sections: PlanSectionWire[] = []
  for (const slot of slots) {
    // 용도 판정은 **제목**(제품 유형)과의 겹침이 필수 — 기준(reason)은 "민감성이라 약산성"처럼 피부 조건 단어가 섞여 있어
    // 겹침만으로는 크림을 클렌저 자리에 앉힐 수 있다. reason 겹침은 근거 개수(4/5→5/5)에만 더한다
    const picked = CATALOG.filter((p) => p.url && !used.has(p.id))
      .filter((p) => !productGuardDrop(p, guard, carted))
      .map((p) => {
        const titleHits = slotOverlap(p, slot.title)
        return { product: p, hits: [...new Set([...titleHits, ...slotOverlap(p, slot.reason)])], titleHits }
      })
      .filter(({ titleHits }) => titleHits.length > 0)
      .map(({ product, hits }) => {
        const base = scoreProductMatch(product, undefined, guard?.ledger)
        const match = withMatchFactor(base, 'concern', hits.length >= 2 ? 100 : 75, `상품 자리 기준과 겹치는 태그: ${hits.join(', ')} (자동 대조)`)
        return { ...product, match }
      })
      .filter((p) => (p.match?.score ?? 0) >= CATALOG_MIN_MATCH)
      .sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
      .slice(0, CATALOG_MAX_PER_SECTION)
    if (!picked.length) continue
    picked.forEach((p) => used.add(p.id))
    sections.push({ kind: 'products', title: slot.title, reason: slot.reason, products: picked })
  }
  if (!sections.length) return { sections: [], note: null }
  const count = sections.reduce((n, s) => n + (s.kind === 'products' ? s.products.length : 0), 0)
  return {
    sections,
    note: {
      code: 'catalog-fallback',
      message: `상품 검색이 상품 섹션을 만들지 못해 뼈대 자리 ${sections.length}개를 카탈로그 매칭(${CATALOG_MIN_MATCH}% 이상) 상품 ${count}개로 채웠다`,
    },
  }
}

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^(www|m)\./, '')

/** 콘텐츠 meta 의 연도 — "2025년 4월"·"2020.08"·"2019-04" 꼴. 없으면 null (신선도 판정 불가 = 통과) */
export function contentYearOf(meta: string | undefined): number | null {
  const m = String(meta || '').match(/(20\d{2})\s*(?:년|[.\-/])/)
  if (!m) return null
  const year = Number(m[1])
  return year >= 2000 && year <= 2100 ? year : null
}

/** 참고 콘텐츠 섹션 그라운딩 — url이 http(s)이고 검색/목록 페이지가 아닌 항목만 채택.
 * guard가 있으면 제목·미리보기의 의학 단정 표현, 3년 넘은 콘텐츠, 저신뢰 출처, 같은 출처 3개째, 최근 쓰레드에서 이미
 * 보여준 URL 도 드롭한다. 항목이 하나도 안 남으면 section=null(드롭) */
export function groundContentsSection(s: ContentsSectionGen, guard?: GuardContext): GroundingResult {
  const drops: GroundingDrop[] = []
  const items: PlanContentItem[] = []
  const referenceYear = guard?.referenceYear ?? new Date().getFullYear()
  const blockHosts = (guard?.contentBlockHosts ?? []).map((h) => h.trim().toLowerCase().replace(/^(www|m)\./, '')).filter(Boolean)
  const recent = new Set((guard?.ledger?.recentContentUrls ?? []).map((u) => u.trim()))
  const perHost = new Map<string, number>()
  s.items.forEach((c) => {
    const url = parseHttpUrl(c.url)
    if (!url || isSearchLikeUrl(url)) {
      drops.push({
        code: !url ? 'invalid-url' : 'search-like-url',
        message: `콘텐츠 URL 검증 실패로 드롭: ${c.title} (${c.url})`,
      })
      return
    }
    if (guard) {
      const claim = findMedicalClaim(`${c.title} ${c.snippet}`)
      if (claim) {
        drops.push({ code: 'medical-claim', message: `의학적 효능 단정 표현("${claim}")으로 드롭: ${c.title}` })
        return
      }
      const year = contentYearOf(c.meta)
      if (year != null && referenceYear - year > CONTENT_MAX_AGE_YEARS) {
        drops.push({ code: 'stale-content', message: `${year}년 콘텐츠 — ${CONTENT_MAX_AGE_YEARS}년 넘게 지나 드롭: ${c.title}` })
        return
      }
      const host = hostOf(url)
      if (blockHosts.some((b) => host === b || host.endsWith(`.${b}`))) {
        drops.push({ code: 'low-trust-source', message: `저신뢰 출처(${host})라 드롭: ${c.title}` })
        return
      }
      if (recent.has(c.url.trim())) {
        drops.push({ code: 'duplicate-recent', message: `최근 쓰레드에서 이미 보여준 콘텐츠라 드롭: ${c.title}` })
        return
      }
      const count = perHost.get(host) ?? 0
      if (count >= CONTENT_MAX_PER_HOST) {
        drops.push({ code: 'duplicate-source', message: `같은 출처(${host}) ${CONTENT_MAX_PER_HOST}개 초과로 드롭: ${c.title}` })
        return
      }
      perHost.set(host, count + 1)
    }
    // 썸네일도 http(s) 검증 통과분만 — 실패해도 항목은 싣는다 (FE가 폴백 이미지)
    const imageUrl = parseHttpUrl(c.imageUrl) ? c.imageUrl : undefined
    const why = String(c.why || '').trim()
    items.push({
      type: c.type,
      source: c.source.trim() || (c.type === 'video' ? '영상' : '게시글'),
      title: c.title,
      url: c.url,
      ...(imageUrl ? { imageUrl } : {}),
      ...(c.meta.trim() ? { meta: c.meta.trim() } : {}),
      ...(c.snippet.trim() ? { snippet: c.snippet.trim() } : {}),
      ...(c.duration.trim() ? { duration: c.duration.trim() } : {}),
      ...(why ? { why } : {}),
    })
  })
  return {
    section: items.length ? { kind: 'contents', title: s.title, reason: s.reason, items } : null,
    drops,
  }
}
