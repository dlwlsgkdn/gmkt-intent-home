import {
  CatalogRatingGen,
  ContentItemGen,
  PlanSearchSectionGen,
  PlanSearchSectionPartialGen,
  WebProductGen,
} from './schemas'

/** 자라는 중인 검색 섹션 조각 → 완성된 항목만 남긴 본 스키마 형태 (상품·콘텐츠 항목 단위 증분).
 * 복구 파싱은 열린 괄호를 닫아 만든 것이라 버퍼상 마지막 키의 값만 잘렸을 수 있다 — 그 키가
 * 배열이면 마지막 원소를 무조건 버리고(앞 원소들은 이미 닫힌 완전한 JSON — stream-parse §안전 근거),
 * 남은 항목을 항목 스키마로 개별 검증한다. 버린 원소는 다음 조각이나 완성 시점(onElement)에 실린다 */
export function completeSearchSection(element: unknown): PlanSearchSectionGen | null {
  const parsed = PlanSearchSectionPartialGen.safeParse(element)
  if (!parsed.success) return null
  const s = parsed.data
  if (!s.title || s.reason === undefined) return null
  const keys = Object.keys(element as Record<string, unknown>)
  const openKey = keys[keys.length - 1] // JSON.parse가 버퍼 키 순서를 보존한다 — 마지막 키만 미완성 후보
  const settled = (key: string, list: unknown[] | undefined): unknown[] =>
    key === openKey ? (list ?? []).slice(0, -1) : (list ?? [])
  if (s.kind === 'products') {
    return {
      kind: 'products',
      title: s.title,
      reason: s.reason,
      productIds: settled('productIds', s.productIds).filter((v): v is string => typeof v === 'string'),
      webProducts: settled('webProducts', s.webProducts)
        .map((v) => WebProductGen.safeParse(v))
        .flatMap((r) => (r.success ? [r.data] : [])),
      // 카탈로그 매칭 평가도 완성된 항목만 — 아직 안 온 평가는 가드가 태그 대조 폴백으로 채운다
      catalogRatings: settled('catalogRatings', s.catalogRatings)
        .map((v) => CatalogRatingGen.safeParse(v))
        .flatMap((r) => (r.success ? [r.data] : [])),
    }
  }
  const items = settled('items', s.items)
    .map((v) => ContentItemGen.safeParse(v))
    .flatMap((r) => (r.success ? [r.data] : []))
  return items.length ? { kind: 'contents', title: s.title, reason: s.reason, items } : null
}
