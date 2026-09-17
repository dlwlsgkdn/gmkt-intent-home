/*
 * 내재화 카탈로그 시딩 — 행 JSON 파일을 catalog_products 에 upsert 한다 (2026-09-17).
 * 시딩 재료는 셋이다: ① 올리브영 사내 Mongo 내보내기(`npm run export:catalog --workspace=apps/tagging-api -- --out oy.json` → 이 스크립트 --file)
 * ② 지난 쓰레드의 계획(운영 콘솔 「쓰레드에서 수확」 — BFF 가 core 를 통해 한다) ③ 시딩 실행 시 실제 웹 검색 배치(운영 콘솔 「웹 검색으로 시딩」 —
 * BFF LLM 이 필요해 이 스크립트에는 없다). 이 스크립트는 ① 처럼 미리 만든 행 파일을 DB 에 직접 쓰는 용도다(core 가 떠 있을 필요 없음,
 * DATABASE_URL 은 migrate.mjs 와 같은 .env/.env.local 로드). 파일 형식은 `{ products: CatalogProductRow[] }` 또는 행 배열.
 *
 *   npm run db:migrate --workspace=apps/core                         # 0005 마이그레이션 먼저 (pg_trgm + catalog_* 표)
 *   npm run seed:catalog --workspace=apps/core -- --file ./oy.json   # 멱등 — 다시 돌리면 같은 id 를 덮는다
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['.env', '.env.local']) {
  const p = path.join(coreDir, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 없습니다 — apps/core/.env 또는 .env.local 확인 (vercel env pull)')
  process.exit(1)
}

const fileIdx = process.argv.indexOf('--file')
const filePath = fileIdx >= 0 ? process.argv[fileIdx + 1] : null
if (!filePath) {
  console.error('사용법: npm run seed:catalog --workspace=apps/core -- --file <행 JSON>  (올리브영은 apps/tagging-api export:catalog 로 만든다)')
  process.exit(1)
}
const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'))
const rows = Array.isArray(parsed) ? parsed : parsed.products ?? []
if (!rows.length) {
  console.error(`${filePath} 에 products 행이 없습니다`)
  process.exit(1)
}
const now = new Date().toISOString()

const searchText = (row) =>
  [row.name, row.brand, ...(row.tags ?? []), row.category, row.mall]
    .filter((p) => typeof p === 'string' && p.trim())
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, '')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const CHUNK = 200
try {
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const params = []
    const tuples = chunk.map((row) => {
      const base = params.length
      params.push(
        row.id, row.mall, row.mallProductId ?? null, row.name, row.brand ?? '', row.price ?? 0, row.url, row.imageUrl ?? null,
        row.tags ?? [], row.category ?? null, row.source ?? 'manual', Boolean(row.verified), row.status ?? 'active', row.meta ? JSON.stringify(row.meta) : null,
        row.recommendCount ?? 0, searchText(row), row.lastSeenAt ?? now,
      )
      return `(${Array.from({ length: 17 }, (_, k) => `$${base + k + 1}`).join(',')})`
    })
    await pool.query(
      `INSERT INTO catalog_products (id, mall, mall_product_id, name, brand, price, url, image_url, tags, category, source, verified, status, meta, recommend_count, search_text, last_seen_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (id) DO UPDATE SET mall = excluded.mall, mall_product_id = excluded.mall_product_id, name = excluded.name, brand = excluded.brand,
         price = excluded.price, url = excluded.url, image_url = excluded.image_url, tags = excluded.tags, category = coalesce(excluded.category, catalog_products.category),
         source = excluded.source, verified = excluded.verified, status = excluded.status, meta = excluded.meta, search_text = excluded.search_text,
         last_seen_at = excluded.last_seen_at, updated_at = now()`,
      params,
    )
    done += chunk.length
    console.log(`  ${done}/${rows.length}`)
  }
  const { rows: stat } = await pool.query(
    `select count(*)::int as total, count(*) filter (where verified)::int as verified from catalog_products`,
  )
  console.log(`✔ 시딩 완료 — 상품 ${stat[0].total}개 (검증 ${stat[0].verified})`)
} finally {
  await pool.end()
}
