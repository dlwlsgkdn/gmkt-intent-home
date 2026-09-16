import type { PlanSectionWire } from '@ddak/schema'
import { skeletonSectionWire } from './look'
import {
  CatalogRatingGen,
  CautionItemGen,
  CompareRowGen,
  CompareSideGen,
  ContentItemGen,
  PlanSearchSectionGen,
  PlanSearchSectionPartialGen,
  PlanSectionPartialGen,
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

/** 자라는 중인 뼈대 섹션 조각 → 부분 와이어 섹션 (guide·steps·compare·caution) — 제목이 나오기 시작하면 토큰 단위로
 * 같은 index 에 재전송할 재료다. 상품·콘텐츠 자리는 부분도 내보내지 않는다(검색 단계 결과가 차지할 인덱스), look 은 사양이
 * 닫히기 전엔 합성할 수 없어 최종본(onElement)만 나간다. 표·목록형(compare·caution)은 **완성된 행·항목만** 싣는다 —
 * 복구 파싱은 버퍼상 마지막 키의 값만 잘렸을 수 있으므로 그 키가 배열이면 마지막 원소를 버린다(completeSearchSection 과
 * 같은 근거). 행이 하나도 없으면 null(빈 표를 그리지 않는다). legacy(threads.service)·그래프(graph.ts) 뼈대 노드가 같은 규칙을 쓴다 */
export function partialSkeletonSection(element: unknown): PlanSectionWire | null {
  const parsed = PlanSectionPartialGen.safeParse(element)
  if (!parsed.success) return null
  const s = parsed.data
  if (!s.title) return null
  if (s.kind === 'guide') return { kind: 'guide', title: s.title, ...(s.subtitle ? { subtitle: s.subtitle } : {}), body: s.body ?? '' }
  if (s.kind === 'steps') return { kind: 'steps', title: s.title, steps: (s.steps ?? []).filter(Boolean) }
  const keys = Object.keys(element as Record<string, unknown>)
  const openKey = keys[keys.length - 1]
  const settled = (key: string, list: unknown[] | undefined): unknown[] =>
    key === openKey ? (list ?? []).slice(0, -1) : (list ?? [])
  if (s.kind === 'compare') {
    const alt = CompareSideGen.safeParse(s.alt)
    const pick = CompareSideGen.safeParse(s.pick)
    if (!alt.success || !pick.success) return null
    const rows = settled('rows', s.rows)
      .map((r) => CompareRowGen.safeParse(r))
      .flatMap((r) => (r.success ? [r.data] : []))
    if (!rows.length) return null
    return skeletonSectionWire({ kind: 'compare', title: s.title, alt: alt.data, pick: pick.data, rows })
  }
  if (s.kind === 'caution') {
    const items = settled('items', s.items)
      .map((it) => CautionItemGen.safeParse(it))
      .flatMap((r) => (r.success ? [r.data] : []))
    if (!items.length) return null
    return skeletonSectionWire({ kind: 'caution', title: s.title, desc: s.desc ?? '', items })
  }
  return null
}
