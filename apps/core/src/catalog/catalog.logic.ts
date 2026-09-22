import type { CatalogContentRow, CatalogProductRow, CatalogSearchQuery } from '@ddak/schema'
import type { CatalogContentDoc, CatalogProductDoc } from '../db/schema'

/*
 * 내재화 카탈로그의 순수 규칙 — IO 없음, Mongo 없이 test/catalog.test.mjs 가 검증한다.
 * GitHub 저장소(Neon/Drizzle)의 catalog.service.ts 가 SQL 로 표현하던 것을 그대로 옮겼다:
 *  - searchText: 이름·브랜드·태그·카테고리(·몰)를 소문자·공백 제거로 이어 붙인 문자열 — 콘텐츠는 제목·출처·태그·요약 200자
 *  - 점수: 검색어가 searchText 에 부분 일치하는 개수. 제품 유형 낱말(typeTerms)은 2점. 같은 검색어가 두 번 오면 두 번 센다(SQL 과 동일)
 *  - upsert 병합: bump=false(시딩·가져오기)는 값 그대로 덮되 category 는 새 값이 없으면 보존하고 createdAt·recommendCount 는 보존한다
 *    (SQL 의 DO UPDATE SET 에 없던 컬럼). bump=true(수확)는 최신 이름·가격·주소만 덮고 출처·검증(OR)·상태는 보존, 태그는 처음 본 순서
 *    합집합(상품 30·콘텐츠 40 — 무한정 자라면 행을 다시 upsert 할 때 계약 검증 400 에 걸린다, 운영 2026-09-18), 노출 횟수 누적,
 *    searchText 는 새 값 + 기존 태그 집합으로 다시 만든다(기존 searchText 에 이어 붙이면 수확마다 자란다)
 *  - 둘러보기 커서: `<updatedAt ISO>|<id>` — updatedAt 내림차순·id 내림차순 키셋
 */

export const PRODUCT_TAG_CAP = 30
export const CONTENT_TAG_CAP = 40

export const normalizeText = (parts: (string | null | undefined)[]): string =>
  parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, '')

export const normalizeTerm = (term: string): string => term.toLowerCase().replace(/\s+/g, '')

export const productSearchText = (row: Pick<CatalogProductRow, 'name' | 'brand' | 'tags' | 'category' | 'mall'>): string =>
  normalizeText([row.name, row.brand, ...(row.tags ?? []), row.category, row.mall])

export const contentSearchText = (row: Pick<CatalogContentRow, 'title' | 'source' | 'tags' | 'snippet'>): string =>
  normalizeText([row.title, row.source, ...(row.tags ?? []), row.snippet?.slice(0, 200)])

/** 정규식 메타문자 이스케이프 — 검색어를 문자 그대로 부분 일치시킨다 (SQL 의 ILIKE 이스케이프에 해당) */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 검색어 목록 → 후보를 미리 거르는 정규식 소스(어느 하나라도 포함). 빈 검색어뿐이면 null */
export function termsRegexSource(terms: string[]): string | null {
  const keys = [...new Set(terms.map(normalizeTerm).filter(Boolean))]
  return keys.length ? keys.map(escapeRegex).join('|') : null
}

/** 검색어 부분 일치 점수 — 제품 유형 낱말은 2점, 그 밖 1점 */
export function scoreSearchText(text: string, q: Pick<CatalogSearchQuery, 'terms' | 'typeTerms'>): number {
  const typeSet = new Set((q.typeTerms ?? []).map(normalizeTerm))
  let score = 0
  for (const term of q.terms) {
    const key = normalizeTerm(term)
    if (key && text.includes(key)) score += typeSet.has(key) ? 2 : 1
  }
  return score
}

/** 태그 합집합 — 처음 본 순서, cap 까지만 (SQL: unnest WITH ORDINALITY … GROUP BY t ORDER BY min(ord) LIMIT cap) */
export function unionTags(prev: readonly string[], next: readonly string[], cap: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const tag of [...prev, ...next]) {
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= cap) break
  }
  return out
}

/** 계약 행 → 새 문서 (createdAt·updatedAt = now, lastSeenAt 은 행 값 없으면 now) */
export function productDocOf(row: CatalogProductRow, now: Date): CatalogProductDoc {
  return {
    _id: row.id,
    mall: row.mall,
    mallProductId: row.mallProductId ?? null,
    name: row.name,
    brand: row.brand ?? '',
    price: row.price,
    url: row.url,
    imageUrl: row.imageUrl ?? null,
    tags: row.tags ?? [],
    category: row.category ?? null,
    source: row.source,
    verified: row.verified,
    status: row.status ?? 'active',
    meta: row.meta ?? null,
    recommendCount: row.recommendCount ?? 0,
    searchText: productSearchText(row),
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : now,
    createdAt: now,
    updatedAt: now,
  }
}

export function contentDocOf(row: CatalogContentRow, now: Date): CatalogContentDoc {
  return {
    _id: row.id,
    type: row.type,
    source: row.source ?? '',
    title: row.title,
    url: row.url,
    imageUrl: row.imageUrl ?? null,
    meta: row.meta ?? null,
    snippet: row.snippet ?? null,
    duration: row.duration ?? null,
    tags: row.tags ?? [],
    year: row.year ?? null,
    verified: row.verified,
    status: row.status ?? 'active',
    recommendCount: row.recommendCount ?? 0,
    searchText: contentSearchText(row),
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : now,
    createdAt: now,
    updatedAt: now,
  }
}

/** upsert 병합 (상품) — prev 가 없으면 새 문서. 규칙은 파일 머리말 */
export function mergeProductDoc(prev: CatalogProductDoc | null, row: CatalogProductRow, bump: boolean, now: Date): CatalogProductDoc {
  const fresh = productDocOf(row, now)
  if (!prev) return fresh
  if (!bump) {
    return { ...fresh, category: fresh.category ?? prev.category, recommendCount: prev.recommendCount, createdAt: prev.createdAt }
  }
  return {
    ...prev,
    name: fresh.name,
    brand: fresh.brand,
    price: fresh.price,
    url: fresh.url,
    imageUrl: fresh.imageUrl ?? prev.imageUrl,
    tags: unionTags(prev.tags, fresh.tags, PRODUCT_TAG_CAP),
    verified: prev.verified || fresh.verified,
    recommendCount: prev.recommendCount + fresh.recommendCount,
    searchText: fresh.searchText + normalizeText(prev.tags),
    lastSeenAt: fresh.lastSeenAt,
    updatedAt: now,
  }
}

/** upsert 병합 (콘텐츠) — bump 는 제목·(없던) 썸네일/메타/요약/길이/연도만 채우고 종류·출처·주소·상태는 보존 */
export function mergeContentDoc(prev: CatalogContentDoc | null, row: CatalogContentRow, bump: boolean, now: Date): CatalogContentDoc {
  const fresh = contentDocOf(row, now)
  if (!prev) return fresh
  if (!bump) return { ...fresh, recommendCount: prev.recommendCount, createdAt: prev.createdAt }
  return {
    ...prev,
    title: fresh.title,
    imageUrl: fresh.imageUrl ?? prev.imageUrl,
    meta: fresh.meta ?? prev.meta,
    snippet: fresh.snippet ?? prev.snippet,
    duration: fresh.duration ?? prev.duration,
    tags: unionTags(prev.tags, fresh.tags, CONTENT_TAG_CAP),
    year: fresh.year ?? prev.year,
    verified: prev.verified || fresh.verified,
    recommendCount: prev.recommendCount + fresh.recommendCount,
    searchText: fresh.searchText + normalizeText(prev.tags),
    lastSeenAt: fresh.lastSeenAt,
    updatedAt: now,
  }
}

/** 같은 요청 안에 같은 id 가 두 번 오면 뒤 행이 앞 행 위에 병합된다 — Postgres 다중 VALUES 는 이 경우 오류였지만 여기선 순서대로 접는다 */
export function foldProductRows(prev: Map<string, CatalogProductDoc>, rows: CatalogProductRow[], bump: boolean, now: Date): CatalogProductDoc[] {
  const merged = new Map<string, CatalogProductDoc>()
  for (const row of rows) merged.set(row.id, mergeProductDoc(merged.get(row.id) ?? prev.get(row.id) ?? null, row, bump, now))
  return [...merged.values()]
}

export function foldContentRows(prev: Map<string, CatalogContentDoc>, rows: CatalogContentRow[], bump: boolean, now: Date): CatalogContentDoc[] {
  const merged = new Map<string, CatalogContentDoc>()
  for (const row of rows) merged.set(row.id, mergeContentDoc(merged.get(row.id) ?? prev.get(row.id) ?? null, row, bump, now))
  return [...merged.values()]
}

/**
 * 수확(bump)을 원자적으로 쓰기 위한 갱신 문서.
 *
 * 병합 결과(mergeProductDoc·mergeContentDoc)를 그대로 replaceOne 으로 쓰면, 같은 상품을 두 계획이 동시에 수확할 때
 * 나중 쓰기가 먼저 쓰기의 노출 횟수 +1 을 덮어 잃는다(읽고-쓰기 사이에 낀 갱신). 검증(verified)도 마찬가지로 true 가
 * false 로 되돌아갈 수 있다. 그래서 그 둘만 연산자로 바꾼다:
 *  - 노출 횟수는 `$inc`(이번 요청이 더할 몫만) — 동시 수확이 겹쳐도 합쳐진다
 *  - 검증은 이번 행이 true 일 때만 `$set` — 읽은 뒤 누가 true 로 바꿨어도 되돌리지 않는다(OR 의미)
 *  - 생성 시각은 새 문서일 때만
 * 나머지 필드는 병합 결과를 그대로 `$set` 한다 — 태그 합집합·searchText 는 여전히 읽은 값에서 계산하므로, 동시 수확이
 * 겹치면 한쪽이 붙인 태그가 빠질 수 있다(검색 보조 재료라 다음 수확에 다시 붙는다).
 */
export interface HarvestDelta {
  /** 이번 요청이 더할 노출 횟수 (같은 id 가 여러 행으로 오면 합) */
  count: number
  /** 이번 요청 행 중 하나라도 검증됨이면 true */
  verified: boolean
}

export function harvestDeltasOf(rows: { id: string; recommendCount?: number; verified: boolean }[]): Map<string, HarvestDelta> {
  const out = new Map<string, HarvestDelta>()
  for (const row of rows) {
    const prev = out.get(row.id) ?? { count: 0, verified: false }
    out.set(row.id, { count: prev.count + (row.recommendCount ?? 0), verified: prev.verified || row.verified })
  }
  return out
}

/** 병합 문서 + 이번 몫 → updateOne 갱신 문서. recommendCount·verified·createdAt 만 연산자로 갈라 낸다 */
export function harvestUpdateOf<T extends { _id: string; recommendCount: number; verified: boolean; createdAt: Date }>(
  doc: T,
  delta: HarvestDelta,
): Record<string, Record<string, unknown>> {
  const { _id, recommendCount, verified, createdAt, ...rest } = doc
  void _id
  void recommendCount
  void verified
  const set: Record<string, unknown> = { ...rest }
  const setOnInsert: Record<string, unknown> = { createdAt }
  if (delta.verified) set.verified = true
  else setOnInsert.verified = false
  return { $set: set, $setOnInsert: setOnInsert, $inc: { recommendCount: delta.count } }
}

/** 둘러보기 커서 `<updatedAt ISO>|<id>` → 값. 깨진 커서는 첫 페이지 */
export function parseListCursor(raw?: string): { at: Date; id: string } | null {
  if (!raw) return null
  const i = raw.indexOf('|')
  if (i <= 0) return null
  const at = new Date(raw.slice(0, i))
  const id = raw.slice(i + 1)
  return Number.isNaN(at.getTime()) || !id ? null : { at, id }
}

export const listCursorOf = (doc: { updatedAt: Date; _id: string }): string => `${doc.updatedAt.toISOString()}|${doc._id}`

export interface ProductHit {
  doc: CatalogProductDoc
  score: number
}
export interface ContentHit {
  doc: CatalogContentDoc
  score: number
}

const reviewsOf = (doc: CatalogProductDoc): number => {
  const n = Number((doc.meta as { reviews?: unknown } | null)?.reviews)
  return Number.isFinite(n) ? n : 0
}
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** 상품 검색 정렬 — 점수 ↓, 검증 ↓, 노출 횟수 ↓, 리뷰 수(meta.reviews) ↓, id ↑ */
export function compareProductHits(a: ProductHit, b: ProductHit): number {
  return (
    b.score - a.score ||
    Number(b.doc.verified) - Number(a.doc.verified) ||
    b.doc.recommendCount - a.doc.recommendCount ||
    reviewsOf(b.doc) - reviewsOf(a.doc) ||
    byId(a.doc._id, b.doc._id)
  )
}

/** 콘텐츠 검색 정렬 — 점수 ↓, 노출 횟수 ↓, 연도 ↓(없으면 뒤), id ↑ */
export function compareContentHits(a: ContentHit, b: ContentHit): number {
  return (
    b.score - a.score ||
    b.doc.recommendCount - a.doc.recommendCount ||
    (b.doc.year ?? -Infinity) - (a.doc.year ?? -Infinity) ||
    byId(a.doc._id, b.doc._id)
  )
}
