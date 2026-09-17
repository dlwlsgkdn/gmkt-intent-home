import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import type {
  CatalogContentRow,
  CatalogListQuery,
  CatalogProductRow,
  CatalogSearchQuery,
  CatalogStatsWire,
  PatchCatalogRowBody,
} from '@ddak/schema'
import { DB, type DbOrNull } from '../db/db.module'
import type { Db } from '../db/client'
import { catalogContents, catalogProducts, type CatalogContentDbRow, type CatalogProductDbRow } from '../db/schema'

/*
 * 내재화 카탈로그 저장·검색 (2026-09-17) — 추천 상품·참고 콘텐츠의 내부 표. core 원칙대로 내용은 해석하지 않는다:
 * 검색어 추출·후보 주입·검증은 BFF/@ddak/pipeline 몫이고, 여기서는
 *  - upsert: id 충돌이면 덮는다. bump=true(수확)면 recommendCount 를 더하고 source·verified(OR)·tags(합집합)·status 는 보존한다
 *  - search: search_text(정규화 연결 문자열)에 검색어가 부분 일치하는 개수로 점수를 매긴다 — 제품 유형 낱말(typeTerms)은 2배,
 *    verified·recommendCount·리뷰 수가 동률을 가른다. pg_trgm GIN 인덱스가 ILIKE 를 받는다(마이그레이션 0005)
 * Neon(Postgres) 이면 충분한 규모다: 수천~수만 행에서 한 자리 ms. 의미 검색이 필요해지면 pgvector 컬럼을 더한다.
 */

const normalizeText = (parts: (string | null | undefined)[]) =>
  parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, '')

const productSearchText = (row: CatalogProductRow) => normalizeText([row.name, row.brand, ...(row.tags ?? []), row.category, row.mall])
const contentSearchText = (row: CatalogContentRow) => normalizeText([row.title, row.source, ...(row.tags ?? []), row.snippet?.slice(0, 200)])

/** 마이그레이션 0005 (drizzle/0005_catalog_internalize.sql) 와 같은 DDL — 멱등(IF NOT EXISTS). 파일을 고치면 여기와 아래 hash 도 같이 */
const CATALOG_SCHEMA_DDL: readonly string[] = [
  'CREATE EXTENSION IF NOT EXISTS "pg_trgm"',
  `CREATE TABLE IF NOT EXISTS "catalog_products" (
	"id" text PRIMARY KEY NOT NULL,
	"mall" text NOT NULL,
	"mall_product_id" text,
	"name" text NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"category" text,
	"source" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"meta" jsonb,
	"recommend_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "catalog_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"image_url" text,
	"meta" text,
	"snippet" text,
	"duration" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"year" integer,
	"verified" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recommend_count" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
)`,
  'CREATE INDEX IF NOT EXISTS "catalog_products_mall_idx" ON "catalog_products" USING btree ("mall","verified")',
  'CREATE INDEX IF NOT EXISTS "catalog_products_search_trgm_idx" ON "catalog_products" USING gin ("search_text" gin_trgm_ops)',
  'CREATE INDEX IF NOT EXISTS "catalog_contents_type_idx" ON "catalog_contents" USING btree ("type","verified")',
  'CREATE INDEX IF NOT EXISTS "catalog_contents_search_trgm_idx" ON "catalog_contents" USING gin ("search_text" gin_trgm_ops)',
]
/** 저널 항목(meta/_journal.json idx 5)의 when 과 SQL 파일 sha256 — ensureSchema 가 drizzle 이력에 남기는 값 */
const CATALOG_MIGRATION = { when: 1789000000000, hash: 'c34a00428750fb1c3019a1cffba4bb0eda257adc328934737c997bcd8ee88b5d' } as const

/** 둘러보기 커서 `<updatedAt ISO>|<id>` → 값. 깨진 커서는 첫 페이지 */
const parseCursor = (raw?: string): { at: string; id: string } | null => {
  if (!raw) return null
  const i = raw.indexOf('|')
  if (i <= 0) return null
  const at = raw.slice(0, i)
  const id = raw.slice(i + 1)
  return Number.isNaN(Date.parse(at)) || !id ? null : { at, id }
}

/** ILIKE 패턴용 이스케이프 — %·_·\ 를 문자 그대로 */
const like = (term: string) => `%${term.toLowerCase().replace(/\s+/g, '').replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`

@Injectable()
export class CatalogService {
  constructor(@Inject(DB) private readonly db: DbOrNull) {}

  private conn(): Db {
    if (!this.db) throw new ServiceUnavailableException('DATABASE_URL이 설정되지 않았습니다')
    return this.db
  }

  /** 행 → 와이어 (Date → ISO, null 보존) */
  private productWire(row: CatalogProductDbRow, score?: number) {
    return {
      id: row.id,
      mall: row.mall,
      mallProductId: row.mallProductId,
      name: row.name,
      brand: row.brand,
      price: row.price,
      url: row.url,
      imageUrl: row.imageUrl,
      tags: row.tags,
      category: row.category,
      source: row.source as CatalogProductRow['source'],
      verified: row.verified,
      status: row.status as CatalogProductRow['status'],
      meta: row.meta,
      recommendCount: row.recommendCount,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(score !== undefined ? { score } : {}),
    }
  }

  private contentWire(row: CatalogContentDbRow, score?: number) {
    return {
      id: row.id,
      type: row.type as CatalogContentRow['type'],
      source: row.source,
      title: row.title,
      url: row.url,
      imageUrl: row.imageUrl,
      meta: row.meta,
      snippet: row.snippet,
      duration: row.duration,
      tags: row.tags,
      year: row.year,
      verified: row.verified,
      status: row.status as CatalogContentRow['status'],
      recommendCount: row.recommendCount,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(score !== undefined ? { score } : {}),
    }
  }

  /** 둘러보기 — 운영 콘솔 표. updated_at 내림차순 키셋 커서(`<updatedAt ISO>|<id>`), 검색과 달리 미검증·dead 도 보인다 */
  async listProducts(q: CatalogListQuery) {
    const db = this.conn()
    const conds: SQL[] = []
    if (q.q?.trim()) conds.push(sql`${catalogProducts.searchText} ILIKE ${like(q.q)}`)
    if (q.mall) conds.push(eq(catalogProducts.mall, q.mall))
    if (q.source) conds.push(eq(catalogProducts.source, q.source))
    if (q.verified) conds.push(eq(catalogProducts.verified, q.verified === 'true'))
    if (q.status) conds.push(eq(catalogProducts.status, q.status))
    const pageConds = [...conds]
    const cursor = parseCursor(q.cursor)
    if (cursor) {
      pageConds.push(
        sql`(date_trunc('milliseconds', ${catalogProducts.updatedAt}), ${catalogProducts.id}) < (${cursor.at}::timestamptz, ${cursor.id})`,
      )
    }
    const limit = q.limit ?? 40
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(catalogProducts)
        .where(pageConds.length ? and(...pageConds) : undefined)
        .orderBy(desc(catalogProducts.updatedAt), desc(catalogProducts.id))
        .limit(limit + 1),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(catalogProducts)
        .where(conds.length ? and(...conds) : undefined),
    ])
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    return {
      items: items.map((r) => this.productWire(r)),
      nextCursor: rows.length > limit && last ? `${last.updatedAt.toISOString()}|${last.id}` : null,
      total: Number(total),
    }
  }

  async listContents(q: CatalogListQuery) {
    const db = this.conn()
    const conds: SQL[] = []
    if (q.q?.trim()) conds.push(sql`${catalogContents.searchText} ILIKE ${like(q.q)}`)
    if (q.source) conds.push(eq(catalogContents.source, q.source))
    if (q.type) conds.push(eq(catalogContents.type, q.type))
    if (q.verified) conds.push(eq(catalogContents.verified, q.verified === 'true'))
    if (q.status) conds.push(eq(catalogContents.status, q.status))
    const pageConds = [...conds]
    const cursor = parseCursor(q.cursor)
    if (cursor) {
      pageConds.push(
        sql`(date_trunc('milliseconds', ${catalogContents.updatedAt}), ${catalogContents.id}) < (${cursor.at}::timestamptz, ${cursor.id})`,
      )
    }
    const limit = q.limit ?? 40
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(catalogContents)
        .where(pageConds.length ? and(...pageConds) : undefined)
        .orderBy(desc(catalogContents.updatedAt), desc(catalogContents.id))
        .limit(limit + 1),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(catalogContents)
        .where(conds.length ? and(...conds) : undefined),
    ])
    const items = rows.slice(0, limit)
    const last = items[items.length - 1]
    return {
      items: items.map((r) => this.contentWire(r)),
      nextCursor: rows.length > limit && last ? `${last.updatedAt.toISOString()}|${last.id}` : null,
      total: Number(total),
    }
  }

  async upsertProducts(items: CatalogProductRow[], bump = false): Promise<{ upserted: number }> {
    const db = this.conn()
    const now = new Date()
    const values = items.map((row) => ({
      id: row.id,
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
      updatedAt: now,
    }))
    // Neon HTTP 드라이버는 문장 하나씩 — 500행 상한(계약)이라 한 문장 다중 VALUES 로 보낸다
    const existing = catalogProducts
    await db
      .insert(catalogProducts)
      .values(values)
      .onConflictDoUpdate({
        target: catalogProducts.id,
        set: bump
          ? {
              // 수확: 최신 이름·가격·주소·썸네일은 덮고, 출처·검증·상태는 보존, 태그는 합집합, 노출 횟수는 누적
              name: sql`excluded.name`,
              brand: sql`excluded.brand`,
              price: sql`excluded.price`,
              url: sql`excluded.url`,
              imageUrl: sql`coalesce(excluded.image_url, ${existing.imageUrl})`,
              // 합집합은 처음 본 순서로 계약 상한(30)까지만 — 무한정 자라면 행을 다시 upsert 할 때 계약 검증(400)에 걸린다(운영 2026-09-18)
              tags: sql`(SELECT ARRAY(SELECT t FROM unnest(${existing.tags} || excluded.tags) WITH ORDINALITY AS u(t, ord) GROUP BY t ORDER BY min(ord) LIMIT 30))`,
              verified: sql`${existing.verified} OR excluded.verified`,
              recommendCount: sql`${existing.recommendCount} + excluded.recommend_count`,
              // 검색 재료 = 새 값(이름·브랜드·이번 태그) + 기존 태그 집합 — 매번 기존 값에서 다시 만들어 무한히 자라지 않는다
              searchText: sql`excluded.search_text || lower(replace(array_to_string(${existing.tags}, ''), ' ', ''))`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: now,
            }
          : {
              mall: sql`excluded.mall`,
              mallProductId: sql`excluded.mall_product_id`,
              name: sql`excluded.name`,
              brand: sql`excluded.brand`,
              price: sql`excluded.price`,
              url: sql`excluded.url`,
              imageUrl: sql`excluded.image_url`,
              tags: sql`excluded.tags`,
              category: sql`coalesce(excluded.category, ${existing.category})`,
              source: sql`excluded.source`,
              verified: sql`excluded.verified`,
              status: sql`excluded.status`,
              meta: sql`excluded.meta`,
              searchText: sql`excluded.search_text`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: now,
            },
      })
    return { upserted: values.length }
  }

  async upsertContents(items: CatalogContentRow[], bump = false): Promise<{ upserted: number }> {
    const db = this.conn()
    const now = new Date()
    const values = items.map((row) => ({
      id: row.id,
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
      updatedAt: now,
    }))
    const existing = catalogContents
    await db
      .insert(catalogContents)
      .values(values)
      .onConflictDoUpdate({
        target: catalogContents.id,
        set: bump
          ? {
              title: sql`excluded.title`,
              imageUrl: sql`coalesce(excluded.image_url, ${existing.imageUrl})`,
              meta: sql`coalesce(excluded.meta, ${existing.meta})`,
              snippet: sql`coalesce(excluded.snippet, ${existing.snippet})`,
              duration: sql`coalesce(excluded.duration, ${existing.duration})`,
              // 합집합은 처음 본 순서로 계약 상한(40)까지만 (상품과 같은 이유)
              tags: sql`(SELECT ARRAY(SELECT t FROM unnest(${existing.tags} || excluded.tags) WITH ORDINALITY AS u(t, ord) GROUP BY t ORDER BY min(ord) LIMIT 40))`,
              year: sql`coalesce(excluded.year, ${existing.year})`,
              verified: sql`${existing.verified} OR excluded.verified`,
              recommendCount: sql`${existing.recommendCount} + excluded.recommend_count`,
              // 태그가 합쳐졌으니 검색 재료도 새 값 + 기존 태그 집합으로 (기존 search_text 를 이어 붙이면 수확마다 자란다)
              searchText: sql`excluded.search_text || lower(replace(array_to_string(${existing.tags}, ''), ' ', ''))`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: now,
            }
          : {
              type: sql`excluded.type`,
              source: sql`excluded.source`,
              title: sql`excluded.title`,
              url: sql`excluded.url`,
              imageUrl: sql`excluded.image_url`,
              meta: sql`excluded.meta`,
              snippet: sql`excluded.snippet`,
              duration: sql`excluded.duration`,
              tags: sql`excluded.tags`,
              year: sql`excluded.year`,
              verified: sql`excluded.verified`,
              status: sql`excluded.status`,
              searchText: sql`excluded.search_text`,
              lastSeenAt: sql`excluded.last_seen_at`,
              updatedAt: now,
            },
      })
    return { upserted: values.length }
  }

  /** 검색어 부분 일치 점수 — 제품 유형 낱말은 2점, 그 밖 1점. 점수 0 은 제외 */
  private scoreExpr(column: typeof catalogProducts.searchText | typeof catalogContents.searchText, q: CatalogSearchQuery) {
    const typeSet = new Set((q.typeTerms ?? []).map((t) => t.toLowerCase().replace(/\s+/g, '')))
    const parts = q.terms.map((term) => {
      const weight = typeSet.has(term.toLowerCase().replace(/\s+/g, '')) ? 2 : 1
      return sql`(CASE WHEN ${column} ILIKE ${like(term)} THEN ${weight} ELSE 0 END)`
    })
    return sql<number>`(${sql.join(parts, sql` + `)})`
  }

  async searchProducts(q: CatalogSearchQuery) {
    const db = this.conn()
    const score = this.scoreExpr(catalogProducts.searchText, q)
    const conds = [eq(catalogProducts.status, 'active'), sql`${score} > 0`]
    if (q.verifiedOnly !== false) conds.push(eq(catalogProducts.verified, true))
    if (q.mall) conds.push(eq(catalogProducts.mall, q.mall))
    const limit = q.limit ?? 24
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ row: catalogProducts, score })
        .from(catalogProducts)
        .where(and(...conds))
        .orderBy(
          desc(score),
          desc(catalogProducts.verified),
          desc(catalogProducts.recommendCount),
          desc(sql`coalesce((${catalogProducts.meta}->>'reviews')::int, 0)`),
          asc(catalogProducts.id),
        )
        .limit(limit),
      db.select({ total: sql<number>`count(*)::int` }).from(catalogProducts).where(eq(catalogProducts.status, 'active')),
    ])
    return { items: rows.map(({ row, score: s }) => this.productWire(row, Number(s))), total: Number(total) }
  }

  async searchContents(q: CatalogSearchQuery) {
    const db = this.conn()
    const score = this.scoreExpr(catalogContents.searchText, q)
    const conds = [eq(catalogContents.status, 'active'), sql`${score} > 0`]
    if (q.verifiedOnly !== false) conds.push(eq(catalogContents.verified, true))
    const limit = q.limit ?? 12
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ row: catalogContents, score })
        .from(catalogContents)
        .where(and(...conds))
        .orderBy(desc(score), desc(catalogContents.recommendCount), desc(catalogContents.year), asc(catalogContents.id))
        .limit(limit),
      db.select({ total: sql<number>`count(*)::int` }).from(catalogContents).where(eq(catalogContents.status, 'active')),
    ])
    return { items: rows.map(({ row, score: s }) => this.contentWire(row, Number(s))), total: Number(total) }
  }

  async patchProduct(id: string, patch: PatchCatalogRowBody) {
    const set: Partial<{ verified: boolean; status: string }> = {}
    if (patch.verified !== undefined) set.verified = patch.verified
    if (patch.status !== undefined) set.status = patch.status
    const [row] = await this.conn()
      .update(catalogProducts)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(catalogProducts.id, id))
      .returning()
    if (!row) throw new NotFoundException('카탈로그 상품이 없습니다')
    return this.productWire(row)
  }

  async patchContent(id: string, patch: PatchCatalogRowBody) {
    const set: Partial<{ verified: boolean; status: string }> = {}
    if (patch.verified !== undefined) set.verified = patch.verified
    if (patch.status !== undefined) set.status = patch.status
    const [row] = await this.conn()
      .update(catalogContents)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(catalogContents.id, id))
      .returning()
    if (!row) throw new NotFoundException('카탈로그 콘텐츠가 없습니다')
    return this.contentWire(row)
  }

  /** 점검 대상 — 오래 안 본(last_seen_at 오래된) 순. mall='*' 면 전 몰 (어느 주소를 두드릴지는 BFF 가 몰별로 정한다) */
  async listForVerify(mall = '*', limit = 50) {
    const conds = [eq(catalogProducts.status, 'active')]
    if (mall && mall !== '*') conds.push(eq(catalogProducts.mall, mall))
    const rows = await this.conn()
      .select()
      .from(catalogProducts)
      .where(and(...conds))
      .orderBy(asc(catalogProducts.lastSeenAt), asc(catalogProducts.id))
      .limit(limit)
    return { items: rows.map((r) => this.productWire(r)) }
  }

  /** 표 만들기 — 마이그레이션 0005 와 같은 DDL 을 멱등(IF NOT EXISTS)으로 적용하고 drizzle 이력에도 남긴다. 로컬 Node 없이 운영 콘솔에서
   * 카탈로그 표를 세우는 길 (2026-09-17). 이미 있으면 아무것도 바꾸지 않는다. 이후 `db:migrate` 는 이력 덕에 0005 를 건너뛴다.
   * Neon HTTP 드라이버는 문장 하나씩만 보내므로 순서대로 실행한다 */
  async ensureSchema(): Promise<{ ok: true; created: boolean }> {
    const db = this.conn()
    // neon-http 드라이버의 execute 는 { rows } 를 돌려준다 (배열 직접이 아님) — 형태가 바뀌어도 받게 둘 다 본다
    const rowsOf = <T,>(res: unknown): T[] => (Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] })?.rows ?? []))
    const existed = Boolean(rowsOf<{ t: string | null }>(await db.execute(sql`select to_regclass('public.catalog_products') as t`))[0]?.t)
    for (const statement of CATALOG_SCHEMA_DDL) await db.execute(sql.raw(statement))
    // drizzle 이력 — migrate.mjs --baseline 과 같은 표/행 형식 (created_at = 저널 when, hash = SQL 파일 sha256)
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`)
    await db.execute(
      sql`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    )
    const row = rowsOf<{ n: number }>(
      await db.execute(sql`select count(*)::int as n from "drizzle"."__drizzle_migrations" where created_at = ${CATALOG_MIGRATION.when}`),
    )[0]
    if (!Number(row?.n)) {
      await db.execute(
        sql`insert into "drizzle"."__drizzle_migrations" (hash, created_at) values (${CATALOG_MIGRATION.hash}, ${CATALOG_MIGRATION.when})`,
      )
    }
    return { ok: true, created: !existed }
  }

  async stats(): Promise<CatalogStatsWire> {
    const db = this.conn()
    const [p, pMall, pSource, c, cType, latest] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${catalogProducts.verified} and ${catalogProducts.status} = 'active')::int`,
          dead: sql<number>`count(*) filter (where ${catalogProducts.status} = 'dead')::int`,
        })
        .from(catalogProducts),
      db
        .select({ mall: catalogProducts.mall, count: sql<number>`count(*)::int` })
        .from(catalogProducts)
        .groupBy(catalogProducts.mall)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({ source: catalogProducts.source, count: sql<number>`count(*)::int` })
        .from(catalogProducts)
        .groupBy(catalogProducts.source)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({
          total: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${catalogContents.verified} and ${catalogContents.status} = 'active')::int`,
          dead: sql<number>`count(*) filter (where ${catalogContents.status} = 'dead')::int`,
        })
        .from(catalogContents),
      db
        .select({ type: catalogContents.type, count: sql<number>`count(*)::int` })
        .from(catalogContents)
        .groupBy(catalogContents.type),
      db
        .select({ at: sql<string | null>`greatest((select max(updated_at) from catalog_products), (select max(updated_at) from catalog_contents))` })
        .from(sql`(select 1) as one`),
    ])
    const at = latest[0]?.at
    return {
      products: {
        total: Number(p[0]?.total ?? 0),
        verified: Number(p[0]?.verified ?? 0),
        dead: Number(p[0]?.dead ?? 0),
        byMall: pMall.map((r) => ({ mall: r.mall, count: Number(r.count) })),
        bySource: pSource.map((r) => ({ source: r.source, count: Number(r.count) })),
      },
      contents: {
        total: Number(c[0]?.total ?? 0),
        verified: Number(c[0]?.verified ?? 0),
        dead: Number(c[0]?.dead ?? 0),
        byType: cType.map((r) => ({ type: r.type, count: Number(r.count) })),
      },
      updatedAt: at ? new Date(at).toISOString() : null,
    }
  }
}
