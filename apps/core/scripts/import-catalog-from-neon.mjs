#!/usr/bin/env node
/*
 * 내재화 카탈로그 Neon Postgres → 사내 Mongo 이관 — 일회성 스크립트 (2026-09-22).
 *
 * 옛 저장소(github.com dlwlsgkdn/gmkt-intent-home)는 카탈로그를 Neon 표 `catalog_products`·`catalog_contents`
 * (마이그레이션 0005)에 쌓았다 — 웹 검색 시딩 네 축 672단위 등. 이 저장소의 core 는 사내 Mongo 라 같은 행을
 * 같은 이름의 컬렉션으로 옮긴다. 행 모양은 src/db/schema.ts CatalogProductDoc·CatalogContentDoc (_id = 옛 id).
 * 값은 그대로 옮긴다(recommend_count·created_at·updated_at 포함) — 새로 계산하는 것은 없다.
 *
 *   DATABASE_URL=<neon> MONGO_URI=<사내 mongo> node apps/core/scripts/import-catalog-from-neon.mjs --dry-run
 *     → Neon 표별 행 수 + Mongo 에 이미 같은 _id 가 몇 개 있는지만 센다 (쓰지 않는다)
 *   DATABASE_URL=<neon> MONGO_URI=<사내 mongo> node apps/core/scripts/import-catalog-from-neon.mjs --overwrite
 *     → _id 로 replaceOne(upsert) — 재실행해도 멱등. Mongo 쪽에서 그 사이 수확으로 바뀐 행은 Neon 값으로 덮인다
 *
 * --overwrite 없이 그냥 실행하면 거부한다(운영 컬렉션을 실수로 덮지 않게 — import-from-neon.mjs 와 같은 안전장치).
 * @neondatabase/serverless 는 core 의존성이 아니다 — 루트 package.json 이 api/state.js 용으로 갖고 있어 호이스팅된
 * node_modules 에서 resolve 된다(import-from-neon.mjs 와 같은 사정). Pool 은 WebSocket 을 쓰므로 Node 22+.
 */
import { Pool } from '@neondatabase/serverless'
import { MongoClient } from 'mongodb'

const DATABASE_URL = process.env.DATABASE_URL
const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'eevee'
const dryRun = process.argv.includes('--dry-run')
const overwrite = process.argv.includes('--overwrite')

if (!DATABASE_URL) {
  console.error('DATABASE_URL이 없습니다 (옛 저장소 core 의 Neon 접속 문자열)')
  process.exit(1)
}
if (!MONGO_URI) {
  console.error('MONGO_URI가 없습니다 (사내 Mongo — dry-run 도 기존 _id 를 세려고 읽는다)')
  process.exit(1)
}
if (!dryRun && !overwrite) {
  console.error('실제 적재에는 --overwrite가 필요합니다 (안전장치). 건수만 보려면 --dry-run')
  process.exit(1)
}

const date = (v) => (v == null ? null : new Date(v))
const int = (v, d = 0) => (v == null ? d : Number(v))

/** Neon 행(snake_case) → Mongo 문서. 컬럼은 옛 0005 DDL 그대로 */
const TABLES = [
  {
    table: 'catalog_products',
    toDoc: (r) => ({
      _id: r.id,
      mall: r.mall,
      mallProductId: r.mall_product_id ?? null,
      name: r.name,
      brand: r.brand ?? '',
      price: int(r.price),
      url: r.url,
      imageUrl: r.image_url ?? null,
      tags: r.tags ?? [],
      category: r.category ?? null,
      source: r.source,
      verified: Boolean(r.verified),
      status: r.status ?? 'active',
      meta: r.meta ?? null,
      recommendCount: int(r.recommend_count),
      searchText: r.search_text ?? '',
      lastSeenAt: date(r.last_seen_at),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
    }),
  },
  {
    table: 'catalog_contents',
    toDoc: (r) => ({
      _id: r.id,
      type: r.type,
      source: r.source ?? '',
      title: r.title,
      url: r.url,
      imageUrl: r.image_url ?? null,
      meta: r.meta ?? null,
      snippet: r.snippet ?? null,
      duration: r.duration ?? null,
      tags: r.tags ?? [],
      year: r.year == null ? null : int(r.year),
      verified: Boolean(r.verified),
      status: r.status ?? 'active',
      recommendCount: int(r.recommend_count),
      searchText: r.search_text ?? '',
      lastSeenAt: date(r.last_seen_at),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
    }),
  },
]

const pool = new Pool({ connectionString: DATABASE_URL })
const mongo = await new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 }).connect()
try {
  const db = mongo.db(MONGO_DB)
  for (const { table, toDoc } of TABLES) {
    const exists = (await pool.query(`select to_regclass('public.${table}') as t`)).rows[0]?.t
    if (!exists) {
      console.log(`${table}: Neon 에 표가 없음 — 건너뜀`)
      continue
    }
    const { rows } = await pool.query(`select * from ${table} order by id`)
    const docs = rows.map(toDoc)
    const coll = db.collection(table)
    const already = docs.length ? await coll.countDocuments({ _id: { $in: docs.map((d) => d._id) } }) : 0
    const verified = docs.filter((d) => d.verified).length
    const dead = docs.filter((d) => d.status === 'dead').length
    console.log(`${table}: Neon ${docs.length}행 (검증 ${verified} · dead ${dead}) — Mongo 에 이미 같은 _id ${already}개`)
    if (dryRun || !docs.length) continue
    const CHUNK = 500
    for (let i = 0; i < docs.length; i += CHUNK) {
      const ops = docs.slice(i, i + CHUNK).map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }))
      await coll.bulkWrite(ops, { ordered: false })
    }
    console.log(`  → ${docs.length}행 적재`)
  }
  console.log(dryRun ? '건수 확인 완료 (dry-run — Mongo 에 쓰지 않았습니다)' : '이관 완료 — core 가 기동 때 인덱스를 보장한다(또는 운영 콘솔 「여기서 표 만들기」 = ensure-schema)')
} finally {
  await pool.end()
  await mongo.close()
}
