/*
 * 내재화 카탈로그 시딩 — 행 JSON 파일을 catalog_products 컬렉션에 upsert 한다 (2026-09-17, Mongo 포팅 2026-09-22).
 * 시딩 재료는 셋이다: ① 올리브영 사내 Mongo 내보내기(`npm run export:catalog --workspace=apps/tagging-api -- --out oy.json` → 이 스크립트 --file)
 * ② 지난 쓰레드의 계획(운영 콘솔 「쓰레드에서 수확」 — BFF 가 core 를 통해 한다) ③ 시딩 실행 시 실제 웹 검색 배치(운영 콘솔 「데이터 시딩」 —
 * BFF LLM 이 필요해 이 스크립트에는 없다). 이 스크립트는 ① 처럼 미리 만든 행 파일을 컬렉션에 직접 쓰는 용도다(core 가 떠 있을 필요 없음).
 * 파일 형식은 `{ products: CatalogProductRow[] }` 또는 행 배열. 병합 규칙은 core 와 같은 것(dist/catalog/catalog.logic.js — bump 없음:
 * 값 그대로 덮되 category 는 새 값이 없으면 보존, createdAt·recommendCount 보존)을 쓰므로 먼저 빌드가 필요하다.
 *
 *   npm run build --workspace=apps/core
 *   MONGO_URI=<사내 Mongo> npm run seed:catalog --workspace=apps/core -- --file ./oy.json   # 멱등 — 다시 돌리면 같은 id 를 덮는다
 *
 * MONGO_URI·MONGO_DB(기본 eevee)는 환경변수 또는 apps/core/.env(.env.local) 에서 읽는다 — 이미 설정된 process.env 가 우선.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MongoClient } from 'mongodb'

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['.env', '.env.local']) {
  const p = path.join(coreDir, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
if (!process.env.MONGO_URI) {
  console.error('MONGO_URI가 없습니다 — apps/core/.env 또는 환경변수 (사내망에서만 닿는다)')
  process.exit(1)
}
const logicPath = path.join(coreDir, 'dist', 'catalog', 'catalog.logic.js')
if (!fs.existsSync(logicPath)) {
  console.error('빌드 산출물이 없습니다 — 먼저 npm run build --workspace=apps/core (병합 규칙을 dist 에서 읽는다)')
  process.exit(1)
}
const { foldProductRows } = (await import(pathToFileURL(logicPath).href)).default

const fileIdx = process.argv.indexOf('--file')
const filePath = fileIdx >= 0 ? process.argv[fileIdx + 1] : null
if (!filePath) {
  console.error('사용법: npm run seed:catalog --workspace=apps/core -- --file <행 JSON>  (올리브영은 apps/tagging-api export:catalog 로 만든다)')
  process.exit(1)
}
const parsed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8'))
const rows = Array.isArray(parsed) ? parsed : (parsed.products ?? [])
if (!rows.length) {
  console.error(`${filePath} 에 products 행이 없습니다`)
  process.exit(1)
}
const bad = rows.find((r) => !r || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.url !== 'string' || typeof r.mall !== 'string')
if (bad) {
  console.error(`행 형식이 계약(@ddak/schema CatalogProductRow)과 다릅니다: ${JSON.stringify(bad).slice(0, 200)}`)
  process.exit(1)
}

const client = await new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }).connect()
const col = client.db(process.env.MONGO_DB || 'eevee').collection('catalog_products')
const CHUNK = 200
try {
  let done = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const ids = [...new Set(chunk.map((r) => r.id))]
    const prevDocs = await col.find({ _id: { $in: ids } }).toArray()
    const docs = foldProductRows(new Map(prevDocs.map((d) => [d._id, d])), chunk, false, new Date())
    await col.bulkWrite(
      docs.map((doc) => ({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } })),
      { ordered: false },
    )
    done += chunk.length
    console.log(`  ${done}/${rows.length}`)
  }
  const [total, verified] = await Promise.all([col.countDocuments({}), col.countDocuments({ verified: true, status: 'active' })])
  console.log(`✔ 시딩 완료 — catalog_products 전체 ${total}행 (검증 ${verified})`)
} finally {
  await client.close()
}
