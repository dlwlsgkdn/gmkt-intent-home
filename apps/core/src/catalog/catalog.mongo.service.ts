import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { AnyBulkWriteOperation, Collection, Filter } from 'mongodb'
import type {
  CatalogContentRow,
  CatalogListQuery,
  CatalogProductRow,
  CatalogSearchQuery,
  CatalogStatsWire,
  PatchCatalogRowBody,
} from '@ddak/schema'
import { MongoService, ensureCatalogIndexes } from '../db/mongo.service'
import { CatalogService } from './catalog.service'
import { CATALOG_CONTENTS_COLL, CATALOG_PRODUCTS_COLL, type CatalogContentDoc, type CatalogProductDoc } from '../db/schema'
import { catalogContentToWire, catalogProductToWire, paginate } from '../db/wire'
import {
  compareContentHits,
  compareProductHits,
  escapeRegex,
  foldContentRows,
  foldProductRows,
  harvestDeltasOf,
  harvestUpdateOf,
  listCursorOf,
  normalizeTerm,
  parseListCursor,
  scoreSearchText,
  termsRegexSource,
} from './catalog.logic'

/*
 * 내재화 카탈로그 저장·검색 (2026-09-17 · Mongo 포팅 2026-09-22) — 추천 상품·참고 콘텐츠의 내부 표. core 원칙대로 내용은 해석하지
 * 않는다: 검색어 추출·후보 주입·검증은 BFF/@ddak/pipeline 몫이고, 여기서는
 *  - upsert: id 충돌이면 덮는다. bump=true(수확)면 recommendCount 를 더하고 source·verified(OR)·tags(합집합)·status 는 보존한다
 *    (병합 규칙은 catalog.logic.ts). 기존 문서를 읽어 병합하되, **수확은 replaceOne 이 아니라 updateOne 으로 쓴다** — 노출 횟수는
 *    `$inc`, 검증은 true 일 때만 `$set` 이라 같은 id 를 두 요청이 동시에 수확해도 +1 이 묻히거나 검증이 되돌아가지 않는다
 *    (harvestUpdateOf). 태그 합집합·searchText 만 읽은 값에서 계산해 남는 경합이고, 그건 다음 수확에 복구된다
 *  - search: searchText 에 검색어 어느 하나라도 들어 있는 문서를 정규식으로 거른 뒤 Node 에서 점수(부분 일치 개수, 제품 유형 2점)와
 *    동률 규칙으로 정렬한다. pg_trgm 이 없어 인덱스를 못 타지만 수천~수만 행이면 수십 ms 안이다(SEARCH_SCAN_CAP 으로 상한)
 */

/** 정규식으로 거른 후보를 메모리에서 점수 매기는 상한 — 이보다 많이 걸리면 검색어가 너무 넓은 것이다 */
const SEARCH_SCAN_CAP = 5000
const NOT_CONNECTED = 'Mongo에 연결되지 않았습니다'

@Injectable()
export class CatalogMongoService extends CatalogService {
  constructor(private readonly mongo: MongoService) {
    super()
  }

  private products(): Collection<CatalogProductDoc> {
    const c = this.mongo.collection<CatalogProductDoc>(CATALOG_PRODUCTS_COLL)
    if (!c) throw new ServiceUnavailableException(NOT_CONNECTED)
    return c
  }

  private contents(): Collection<CatalogContentDoc> {
    const c = this.mongo.collection<CatalogContentDoc>(CATALOG_CONTENTS_COLL)
    if (!c) throw new ServiceUnavailableException(NOT_CONNECTED)
    return c
  }

  /** 둘러보기 — 운영 콘솔 표. updatedAt 내림차순 키셋 커서(`<updatedAt ISO>|<id>`), 검색과 달리 미검증·dead 도 보인다 */
  async listProducts(q: CatalogListQuery) {
    const col = this.products()
    const filter: Filter<CatalogProductDoc> = {}
    if (q.q?.trim()) filter.searchText = { $regex: escapeRegex(normalizeTerm(q.q)) }
    if (q.mall) filter.mall = q.mall
    if (q.source) filter.source = q.source
    if (q.verified) filter.verified = q.verified === 'true'
    if (q.status) filter.status = q.status
    const limit = q.limit ?? 40
    const [rows, total] = await Promise.all([
      col.find(withCursor(filter, parseListCursor(q.cursor))).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray(),
      col.countDocuments(filter),
    ])
    const { items, nextCursor } = paginate(rows, limit, listCursorOf)
    return { items: items.map((d) => catalogProductToWire(d)), nextCursor, total }
  }

  async listContents(q: CatalogListQuery) {
    const col = this.contents()
    const filter: Filter<CatalogContentDoc> = {}
    if (q.q?.trim()) filter.searchText = { $regex: escapeRegex(normalizeTerm(q.q)) }
    if (q.source) filter.source = q.source
    if (q.type) filter.type = q.type
    if (q.verified) filter.verified = q.verified === 'true'
    if (q.status) filter.status = q.status
    const limit = q.limit ?? 40
    const [rows, total] = await Promise.all([
      col.find(withCursor(filter, parseListCursor(q.cursor))).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray(),
      col.countDocuments(filter),
    ])
    const { items, nextCursor } = paginate(rows, limit, listCursorOf)
    return { items: items.map((d) => catalogContentToWire(d)), nextCursor, total }
  }

  /** 일괄 upsert (≤500) — 기존 문서를 한 번에 읽어 병합하고 replaceOne 으로 쓴다. 반환 upserted = 받은 행 수 (SQL 과 동일) */
  async upsertProducts(items: CatalogProductRow[], bump = false): Promise<{ upserted: number }> {
    const col = this.products()
    const now = new Date()
    const prev = await this.existing(col, items.map((r) => r.id))
    const docs = foldProductRows(prev, items, bump, now)
    if (bump) await this.harvestAll(col, docs, harvestDeltasOf(items))
    else await this.replaceAll(col, docs)
    return { upserted: items.length }
  }

  async upsertContents(items: CatalogContentRow[], bump = false): Promise<{ upserted: number }> {
    const col = this.contents()
    const now = new Date()
    const prev = await this.existing(col, items.map((r) => r.id))
    const docs = foldContentRows(prev, items, bump, now)
    if (bump) await this.harvestAll(col, docs, harvestDeltasOf(items))
    else await this.replaceAll(col, docs)
    return { upserted: items.length }
  }

  private async existing<T extends { _id: string }>(col: Collection<T>, ids: string[]): Promise<Map<string, T>> {
    const unique = [...new Set(ids)]
    if (!unique.length) return new Map()
    const docs = await col.find({ _id: { $in: unique } } as Filter<T>).toArray()
    return new Map(docs.map((d) => [d._id, d as T]))
  }

  /** 수확 쓰기 — 노출 횟수·검증만 연산자로 갈라 원자적으로 (harvestUpdateOf). 나머지는 병합 결과 그대로 */
  private async harvestAll<T extends { _id: string; recommendCount: number; verified: boolean; createdAt: Date }>(
    col: Collection<T>,
    docs: T[],
    deltas: Map<string, { count: number; verified: boolean }>,
  ) {
    if (!docs.length) return
    const ops = docs.map((doc): AnyBulkWriteOperation<T> => ({
      updateOne: {
        filter: { _id: doc._id } as Filter<T>,
        update: harvestUpdateOf(doc, deltas.get(doc._id) ?? { count: 0, verified: doc.verified }) as never,
        upsert: true,
      },
    }))
    await col.bulkWrite(ops, { ordered: false })
  }

  private async replaceAll<T extends { _id: string }>(col: Collection<T>, docs: T[]) {
    if (!docs.length) return
    const ops = docs.map((doc): AnyBulkWriteOperation<T> => ({
      replaceOne: { filter: { _id: doc._id } as Filter<T>, replacement: doc, upsert: true },
    }))
    await col.bulkWrite(ops, { ordered: false })
  }

  /** 상품 검색 — 기본 verified·active 만, mall 필터. total 은 검색어와 무관한 active 전체(표가 비었는지·검색이 빗나갔는지 가른다) */
  async searchProducts(q: CatalogSearchQuery) {
    const col = this.products()
    const filter: Filter<CatalogProductDoc> = { status: 'active' }
    if (q.verifiedOnly !== false) filter.verified = true
    if (q.mall) filter.mall = q.mall
    const source = termsRegexSource(q.terms)
    const [candidates, total] = await Promise.all([
      source ? col.find({ ...filter, searchText: { $regex: source } }).limit(SEARCH_SCAN_CAP).toArray() : Promise.resolve([]),
      col.countDocuments({ status: 'active' }),
    ])
    const hits = candidates
      .map((doc) => ({ doc, score: scoreSearchText(doc.searchText, q) }))
      .filter((h) => h.score > 0)
      .sort(compareProductHits)
    return { items: hits.slice(0, q.limit ?? 24).map((h) => catalogProductToWire(h.doc, h.score)), total }
  }

  async searchContents(q: CatalogSearchQuery) {
    const col = this.contents()
    const filter: Filter<CatalogContentDoc> = { status: 'active' }
    if (q.verifiedOnly !== false) filter.verified = true
    const source = termsRegexSource(q.terms)
    const [candidates, total] = await Promise.all([
      source ? col.find({ ...filter, searchText: { $regex: source } }).limit(SEARCH_SCAN_CAP).toArray() : Promise.resolve([]),
      col.countDocuments({ status: 'active' }),
    ])
    const hits = candidates
      .map((doc) => ({ doc, score: scoreSearchText(doc.searchText, q) }))
      .filter((h) => h.score > 0)
      .sort(compareContentHits)
    return { items: hits.slice(0, q.limit ?? 12).map((h) => catalogContentToWire(h.doc, h.score)), total }
  }

  async patchProduct(id: string, patch: PatchCatalogRowBody) {
    const row = await this.products().findOneAndUpdate(
      { _id: id },
      { $set: { ...patchSet(patch), updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!row) throw new NotFoundException('카탈로그 상품이 없습니다')
    return catalogProductToWire(row)
  }

  async patchContent(id: string, patch: PatchCatalogRowBody) {
    const row = await this.contents().findOneAndUpdate(
      { _id: id },
      { $set: { ...patchSet(patch), updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!row) throw new NotFoundException('카탈로그 콘텐츠가 없습니다')
    return catalogContentToWire(row)
  }

  /** 점검 대상 — 오래 안 본(lastSeenAt 오래된) 순. mall='*' 면 전 몰 (어느 주소를 두드릴지는 BFF 가 몰별로 정한다) */
  async listForVerify(mall = '*', limit = 50) {
    const filter: Filter<CatalogProductDoc> = { status: 'active' }
    if (mall && mall !== '*') filter.mall = mall
    const rows = await this.products().find(filter).sort({ lastSeenAt: 1, _id: 1 }).limit(limit).toArray()
    return { items: rows.map((d) => catalogProductToWire(d)) }
  }

  /** 표 만들기 — Postgres 시절엔 마이그레이션 0005 DDL 이었고, Mongo 에선 컬렉션·인덱스 보장(멱등)이다. 컬렉션은 첫 쓰기에 저절로
   * 생기지만 운영 콘솔 「여기서 표 만들기」가 같은 API 를 부르므로 created(이번에 새로 생겼는가)를 그대로 돌려준다 */
  async ensureSchema(): Promise<{ ok: true; created: boolean }> {
    const db = this.mongo.db()
    if (!db) throw new ServiceUnavailableException(NOT_CONNECTED)
    const existed = (await db.listCollections({ name: CATALOG_PRODUCTS_COLL }, { nameOnly: true }).toArray()).length > 0
    if (!existed) {
      try {
        await db.createCollection(CATALOG_PRODUCTS_COLL)
      } catch (e) {
        if ((e as { code?: number })?.code !== 48) throw e // 48 = NamespaceExists (다른 요청이 먼저 만들었다)
      }
    }
    await ensureCatalogIndexes(db)
    return { ok: true, created: !existed }
  }

  async stats(): Promise<CatalogStatsWire> {
    const products = this.products()
    const contents = this.contents()
    const [pTotal, pVerified, pDead, byMall, bySource, cTotal, cVerified, cDead, byType, pLatest, cLatest] = await Promise.all([
      products.countDocuments({}),
      products.countDocuments({ verified: true, status: 'active' }),
      products.countDocuments({ status: 'dead' }),
      groupCount(products, 'mall'),
      groupCount(products, 'source'),
      contents.countDocuments({}),
      contents.countDocuments({ verified: true, status: 'active' }),
      contents.countDocuments({ status: 'dead' }),
      groupCount(contents, 'type'),
      latestUpdatedAt(products),
      latestUpdatedAt(contents),
    ])
    const latest = [pLatest, cLatest].filter((d): d is Date => d instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0]
    return {
      products: {
        total: pTotal,
        verified: pVerified,
        dead: pDead,
        byMall: byMall.map((r) => ({ mall: r.key, count: r.count })),
        bySource: bySource.map((r) => ({ source: r.key, count: r.count })),
      },
      contents: {
        total: cTotal,
        verified: cVerified,
        dead: cDead,
        byType: byType.map((r) => ({ type: r.key, count: r.count })),
      },
      updatedAt: latest ? latest.toISOString() : null,
    }
  }
}

/** 키셋 커서 조건 — (updatedAt, _id) 내림차순에서 커서보다 뒤 */
function withCursor<T extends { updatedAt: Date; _id: string }>(filter: Filter<T>, cursor: { at: Date; id: string } | null): Filter<T> {
  if (!cursor) return filter
  const after = { $or: [{ updatedAt: { $lt: cursor.at } }, { updatedAt: cursor.at, _id: { $lt: cursor.id } }] } as Filter<T>
  return { $and: [filter, after] } as Filter<T>
}

function patchSet(patch: PatchCatalogRowBody): Partial<{ verified: boolean; status: string }> {
  const set: Partial<{ verified: boolean; status: string }> = {}
  if (patch.verified !== undefined) set.verified = patch.verified
  if (patch.status !== undefined) set.status = patch.status
  return set
}

/** 필드 값별 개수 — 많은 순, 같으면 값 순 (SQL GROUP BY … ORDER BY count DESC) */
async function groupCount<T extends { _id: string }>(col: Collection<T>, field: string): Promise<{ key: string; count: number }[]> {
  const rows = await col
    .aggregate<{ _id: string | null; count: number }>([{ $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }])
    .toArray()
  return rows.map((r) => ({ key: r._id ?? '', count: r.count }))
}

async function latestUpdatedAt<T extends { _id: string; updatedAt: Date }>(col: Collection<T>): Promise<Date | null> {
  const [row] = await col.find({}, { projection: { updatedAt: 1 } }).sort({ updatedAt: -1 }).limit(1).toArray()
  return row?.updatedAt ?? null
}
