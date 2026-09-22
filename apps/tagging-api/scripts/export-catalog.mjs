#!/usr/bin/env node
/* 사내 Mongo(올리브영 상품 컬렉션) → 내재화 카탈로그 행(JSON) 내보내기 (2026-09-17).
   태깅 스튜디오가 읽는 것과 같은 문서(product_id·name·brand·price·url·image_url·sub_type·formulation·ingredient_tags·
   skin_types·concerns·results·inferred_category·review_stats)를 @ddak/schema CatalogProductRow 모양으로 바꿔 파일에 쓴다.
   그 파일은 core 시딩 스크립트(`npm run seed:catalog --workspace=apps/core -- --file <path>`)나 운영 콘솔
   「내재화 카탈로그」 카드의 「JSON 가져오기」로 올린다 — 사내망 밖(Vercel)에서는 Mongo 에 닿지 못하므로 두 단계다.

   사용법:
     node scripts/export-catalog.mjs --out ./oliveyoung-catalog.json          # 전체
     node scripts/export-catalog.mjs --out ./oy.json --reviewed               # 검토 완료(reviewed·auto_ok)만
     node scripts/export-catalog.mjs --out ./oy.json --limit 2000

   환경변수(.env 또는 셸): MONGO_URI(필수) · MONGO_DB(기본 eevee) · MONGO_COLL(기본 products)
   행 규칙: id = oy-<goodsNo 소문자>(url 의 goodsNo, 없으면 oy-<product_id>), mall 올리브영, verified = goodsNo 형식(A+12자리)이
   맞을 때, tags = 세부유형·제형·성분 태그·피부 타입·고민·결과·대분류 + 이름에서 읽은 제품 유형(@ddak/pipeline productTypesOf),
   meta = 리뷰 수·평점. 읽기만 한다 — Mongo 에 쓰지 않는다. */
import 'dotenv/config'
import { writeFile } from 'node:fs/promises'
import { MongoClient } from 'mongodb'
import { oliveyoungGoodsNoOf, oliveyoungPdpUrl, productTypesOf } from '@ddak/pipeline'

function parseArgs(argv) {
  const out = { out: './oliveyoung-catalog.json', reviewed: false, limit: 0 }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--out') out.out = argv[++i]
    else if (a === '--reviewed') out.reviewed = true
    else if (a === '--limit') out.limit = Number(argv[++i]) || 0
  }
  return out
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [])

function rowOf(doc, now) {
  const name = str(doc.name)
  const url = str(doc.url)
  if (!name || !url || !/^https?:\/\//.test(url)) return null
  const goodsNo = oliveyoungGoodsNoOf(url)
  const id = goodsNo ? `oy-${goodsNo.toLowerCase()}` : `oy-${String(doc.product_id || '').toLowerCase().replace(/[^a-z0-9-]/g, '')}`
  if (id === 'oy-') return null
  const tags = [
    ...productTypesOf(name),
    str(doc.sub_type),
    str(doc.formulation),
    ...list(doc.ingredient_tags),
    ...list(doc.skin_types),
    ...list(doc.concerns),
    ...list(doc.results),
    str(doc.inferred_category),
  ].filter(Boolean)
  const meta = {}
  if (doc.review_stats?.count) meta.reviews = Number(doc.review_stats.count)
  if (doc.review_stats?.avg_rating) meta.star = Number(doc.review_stats.avg_rating)
  if (doc.review_status) meta.reviewStatus = doc.review_status
  return {
    id,
    mall: '올리브영',
    mallProductId: goodsNo ?? (doc.product_id ? String(doc.product_id) : null),
    name,
    brand: str(doc.brand) || str(doc.inferred_brand),
    price: typeof doc.price === 'number' && doc.price > 0 ? Math.round(doc.price) : 0,
    url: goodsNo ? oliveyoungPdpUrl(goodsNo) : url,
    imageUrl: str(doc.image_url) || null,
    tags: [...new Set(tags)].slice(0, 30),
    category: productTypesOf(name)[0] ?? null,
    source: 'manual',
    verified: Boolean(goodsNo),
    status: 'active',
    meta,
    recommendCount: 0,
    lastSeenAt: now,
  }
}

const args = parseArgs(process.argv.slice(2))
if (!process.env.MONGO_URI) {
  console.error('MONGO_URI 가 없습니다 — 사내망에서 .env 를 채워 주세요')
  process.exit(1)
}
const client = await new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }).connect()
try {
  const coll = client.db(process.env.MONGO_DB || 'eevee').collection(process.env.MONGO_COLL || 'products')
  const filter = args.reviewed ? { review_status: { $in: ['reviewed', 'auto_ok'] } } : {}
  let cursor = coll.find(filter, {
    projection: {
      product_id: 1, name: 1, brand: 1, inferred_brand: 1, price: 1, url: 1, image_url: 1, sub_type: 1, formulation: 1,
      ingredient_tags: 1, skin_types: 1, concerns: 1, results: 1, inferred_category: 1, review_stats: 1, review_status: 1,
    },
  })
  if (args.limit > 0) cursor = cursor.limit(args.limit)
  const now = new Date().toISOString()
  const rows = new Map()
  let scanned = 0
  for await (const doc of cursor) {
    scanned += 1
    const row = rowOf(doc, now)
    if (row && !rows.has(row.id)) rows.set(row.id, row)
  }
  const products = [...rows.values()]
  await writeFile(args.out, JSON.stringify({ exportedAt: now, source: 'oliveyoung-mongo', products }, null, 0) + '\n')
  const verified = products.filter((p) => p.verified).length
  console.log(`✔ ${args.out} — 문서 ${scanned}개 중 상품 행 ${products.length}개 (goodsNo 검증 ${verified})`)
} finally {
  await client.close()
}
