import type { CatalogProduct, PlanContentItem, PlanSectionWire } from '@ddak/schema'
import type { ContentsSectionGen, ProductRatingGen, ProductsSectionGen } from '../schemas'
import type { ConstraintLedger } from '../ledger'
import { CATALOG_BY_ID } from '../catalog'
import { findMedicalClaim } from './claims'
import { scoreProductMatch } from './match'

/*
 * 검증 게이트(전략 문서 6단계)의 그라운딩 가드 — LLM이 만든 상품·콘텐츠 섹션을
 * 목록·URL 규칙과 대조해 통과분만 wire 섹션으로 확정한다. 순수 함수라 스트림 조각과
 * 최종 결과가 일치하고(§4-3), 그래프 노드·스튜디오 dry-run·테스트가 그대로 재사용한다.
 * 드롭은 로그 대신 GroundingDrop으로 반환한다 — 호출자가 로깅하고, 전략 문서 p.11의
 * "드롭 사유는 그대로 품질 로그로"는 이 목록을 plan 스텝 payload(dropLog)에 싣는 것으로 구현한다.
 * guard(선택)는 확장 게이트: 블록리스트 정확 매칭·의학 단정 차단·원장 역대조(예산·기피) —
 * 없으면 기본 그라운딩만 (legacy 경로 동작 불변).
 */

export type GroundingDrop = {
  code:
    | 'catalog-miss'
    | 'invalid-url'
    | 'search-like-url'
    | 'blocklist'
    | 'medical-claim'
    | 'ledger-budget'
    | 'ledger-avoid'
  message: string
}

/** 확장 게이트 입력 — 생성과 검증이 같은 값을 본다 (원장 = 구조체, 블록리스트 = KV) */
export type GuardContext = { blocklist?: string[]; ledger?: ConstraintLedger | null }

/** 블록리스트 KV 저장 키 — 쓰레드 피드백에서 증류한 상품명(줄바꿈 구분, 정확 매칭) */
export const GUARD_BLOCKLIST_SETTING_KEY = 'guard-blocklist'

export type GroundingResult = { section: PlanSectionWire | null; drops: GroundingDrop[] }

/** 상품 하나의 확장 게이트 판정 — 걸리면 드롭 사유, 통과면 null */
function productGuardDrop(product: CatalogProduct, guard?: GuardContext): GroundingDrop | null {
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
  return null
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

/** 상품 섹션 그라운딩 — 카탈로그 밖 id는 버리고, 웹 상품은 URL(http/https+PDP) 검증 통과분만 채택.
 * 상세 페이지(url) 없는 상품은 카탈로그 상품이라도 추천하지 않는다 — 상세보기가 열리는 상품만 싣는다.
 * guard가 있으면 확장 게이트(블록리스트·의학 단정·원장 역대조)를 상품 단위로 추가 대조한다.
 * 상품이 하나도 안 남으면 section=null(드롭) */
export function groundProductsSection(
  s: ProductsSectionGen,
  sectionIndex: number,
  guard?: GuardContext,
): GroundingResult {
  const drops: GroundingDrop[] = []
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
  const admit = (product: CatalogProduct, rating?: ProductRatingGen) => {
    const guardDrop = productGuardDrop(product, guard)
    if (guardDrop) drops.push(guardDrop)
    else products.push({ ...product, match: scoreProductMatch(product, rating, guard?.ledger) })
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
    // 썸네일도 http(s) 검증 통과분만 — 실패해도 상품은 싣는다 (FE가 이모지 목업 폴백)
    const imageUrl = parseHttpUrl(w.imageUrl) ? w.imageUrl : undefined
    admit(
      {
        id: `web-${sectionIndex}-${webIndex}`,
        name: w.name,
        brand: w.brand,
        price: w.price,
        tags: w.tags,
        url: w.url,
        mall: w.mall.trim() || '외부몰',
        ...(searchLink ? { urlKind: 'search' as const } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
      w.match,
    )
  })
  catalogProducts.forEach((product) => admit(product, s.catalogRatings?.find((r) => r.id === product.id)?.match))
  return {
    section: products.length ? { kind: 'products', title: s.title, reason: s.reason, products } : null,
    drops,
  }
}

/** 참고 콘텐츠 섹션 그라운딩 — url이 http(s)이고 검색/목록 페이지가 아닌 항목만 채택.
 * guard가 있으면 제목·미리보기의 의학 단정 표현도 차단한다. 항목이 하나도 안 남으면 section=null(드롭) */
export function groundContentsSection(s: ContentsSectionGen, guard?: GuardContext): GroundingResult {
  const drops: GroundingDrop[] = []
  const items: PlanContentItem[] = []
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
    }
    // 썸네일도 http(s) 검증 통과분만 — 실패해도 항목은 싣는다 (FE가 폴백 이미지)
    const imageUrl = parseHttpUrl(c.imageUrl) ? c.imageUrl : undefined
    items.push({
      type: c.type,
      source: c.source.trim() || (c.type === 'video' ? '영상' : '게시글'),
      title: c.title,
      url: c.url,
      ...(imageUrl ? { imageUrl } : {}),
      ...(c.meta.trim() ? { meta: c.meta.trim() } : {}),
      ...(c.snippet.trim() ? { snippet: c.snippet.trim() } : {}),
      ...(c.duration.trim() ? { duration: c.duration.trim() } : {}),
    })
  })
  return {
    section: items.length ? { kind: 'contents', title: s.title, reason: s.reason, items } : null,
    drops,
  }
}
