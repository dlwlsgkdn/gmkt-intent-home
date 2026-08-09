import type { CatalogProduct, PlanContentItem, PlanSectionWire } from '@ddak/schema'
import type { ContentsSectionGen, ProductsSectionGen } from '../schemas'
import { CATALOG_BY_ID } from '../catalog'

/*
 * 검증 게이트(전략 문서 6단계)의 그라운딩 가드 — LLM이 만든 상품·콘텐츠 섹션을
 * 목록·URL 규칙과 대조해 통과분만 wire 섹션으로 확정한다. 순수 함수라 스트림 조각과
 * 최종 결과가 일치하고(§4-3), 그래프 노드·스튜디오 dry-run·테스트가 그대로 재사용한다.
 * 드롭은 로그 대신 GroundingDrop으로 반환한다 — 호출자가 로깅하고, 전략 문서 p.11의
 * "드롭 사유는 그대로 품질 로그로"는 이 목록을 스텝 payload(dropLog)에 실어 구현한다(페이즈 3).
 */

export type GroundingDrop = {
  code: 'catalog-miss' | 'invalid-url' | 'search-like-url'
  message: string
}

export type GroundingResult = { section: PlanSectionWire | null; drops: GroundingDrop[] }

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
 * 상품이 하나도 안 남으면 section=null(드롭) */
export function groundProductsSection(s: ProductsSectionGen, sectionIndex: number): GroundingResult {
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
  // 외부몰 우선 정책: 웹 상품(올리브영 등)을 앞에 싣고 카탈로그(지마켓)는 뒤에 보조로 붙인다
  const products: CatalogProduct[] = []
  s.webProducts.forEach((w, webIndex) => {
    const url = parseHttpUrl(w.url)
    if (!url) {
      drops.push({ code: 'invalid-url', message: `웹 상품 URL 검증 실패로 드롭: ${w.name} (${w.url})` })
      return
    }
    if (isSearchLikeUrl(url)) {
      drops.push({
        code: 'search-like-url',
        message: `웹 상품 URL이 검색/목록 페이지로 보여 드롭 (PDP만 허용): ${w.name} (${w.url})`,
      })
      return
    }
    // 썸네일도 http(s) 검증 통과분만 — 실패해도 상품은 싣는다 (FE가 이모지 목업 폴백)
    const imageUrl = parseHttpUrl(w.imageUrl) ? w.imageUrl : undefined
    products.push({
      id: `web-${sectionIndex}-${webIndex}`,
      name: w.name,
      brand: w.brand,
      price: w.price,
      tags: w.tags,
      url: w.url,
      mall: w.mall.trim() || '외부몰',
      ...(imageUrl ? { imageUrl } : {}),
    })
  })
  products.push(...catalogProducts)
  return {
    section: products.length ? { kind: 'products', title: s.title, reason: s.reason, products } : null,
    drops,
  }
}

/** 참고 콘텐츠 섹션 그라운딩 — url이 http(s)이고 검색/목록 페이지가 아닌 항목만 채택.
 * 항목이 하나도 안 남으면 section=null(드롭) */
export function groundContentsSection(s: ContentsSectionGen): GroundingResult {
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
