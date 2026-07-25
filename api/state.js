/* DDAK Scenario Studio 서버 영속화 API — Neon Postgres(jsonb 문서 저장).
   GET  /api/state            → { accounts?: {data, updatedAt}, keywords?: {data, updatedAt} }
   PUT  /api/state {key,data} → 해당 키 문서를 통째로 upsert (last-write-wins) */
import { neon } from '@neondatabase/serverless'

const VALID_KEYS = new Set(['accounts', 'keywords'])

let readyPromise
function getSql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!url) throw new Error('DATABASE_URL이 설정되지 않았어요. Vercel 프로젝트에 Neon 데이터베이스를 연결해 주세요.')
  return neon(url)
}

async function ensureTable(sql) {
  if (!readyPromise) {
    readyPromise = sql`CREATE TABLE IF NOT EXISTS app_state (
      key text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`.catch((e) => {
      readyPromise = undefined
      throw e
    })
  }
  await readyPromise
}

export default async function handler(req, res) {
  // GitHub Pages 등 다른 오리진에서도 같은 DB를 쓸 수 있게 CORS 허용
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  try {
    const sql = getSql()
    await ensureTable(sql)

    if (req.method === 'GET') {
      const rows = await sql`SELECT key, data, updated_at FROM app_state`
      const out = {}
      for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updated_at }
      res.status(200).json(out)
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const { key, data } = req.body || {}
      if (!VALID_KEYS.has(key) || data === undefined) {
        res.status(400).json({ error: 'key(accounts|keywords)와 data가 필요해요.' })
        return
      }
      await sql`INSERT INTO app_state (key, data, updated_at)
                VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
      res.status(200).json({ ok: true })
      return
    }

    res.setHeader('Allow', 'GET, PUT, POST')
    res.status(405).json({ error: 'method not allowed' })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
