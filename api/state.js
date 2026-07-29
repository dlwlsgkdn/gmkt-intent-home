/* DDAK Scenario Studio 서버 영속화 API — Neon Postgres(jsonb 문서 저장).
   GET  /api/state                → 전체 덤프 { <key>: {data, updatedAt}, ... } (구버전 클라이언트 호환)
   GET  /api/state?index=1        → [{ key, updatedAt }] 목록만 (본문 없이 어떤 행이 있는지)
   GET  /api/state?key=<k>        → 해당 키 하나만 { <key>: {data, updatedAt} }
   PUT  /api/state {key, data}    → 해당 키 문서를 통째로 upsert (문서 단위 last-write-wins)
   PUT  /api/state {key, data: null} → 해당 키 삭제

   키 체계: 'accounts'(구 통짜 블롭 — 마이그레이션 후 삭제됨) · 'accounts-meta'(계정 순서·활성 id)
   · 'account:<id>'(계정 하나) · 'keywords'. 계정 단위로 쪼갠 이유: Vercel 함수의 요청/응답
   본문 한도(4.5MB)를 통짜 블롭이 넘어서면서 프로필 추가 같은 저장이 조용히 거부됐다. */
import { neon } from '@neondatabase/serverless'

const KEY_PATTERN = /^(accounts|keywords|accounts-meta|account:[A-Za-z0-9_-]{1,64})$/

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
      const { key, index } = req.query || {}
      if (index) {
        const rows = await sql`SELECT key, updated_at FROM app_state`
        res.status(200).json(rows.map((r) => ({ key: r.key, updatedAt: r.updated_at })))
        return
      }
      if (key) {
        if (!KEY_PATTERN.test(key)) {
          res.status(400).json({ error: '알 수 없는 key 형식이에요.' })
          return
        }
        const rows = await sql`SELECT key, data, updated_at FROM app_state WHERE key = ${key}`
        const out = {}
        for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updated_at }
        res.status(200).json(out)
        return
      }
      const rows = await sql`SELECT key, data, updated_at FROM app_state`
      const out = {}
      for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updated_at }
      res.status(200).json(out)
      return
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const { key, data } = req.body || {}
      if (!KEY_PATTERN.test(String(key || '')) || data === undefined) {
        res.status(400).json({ error: 'key와 data가 필요해요. (삭제는 data: null)' })
        return
      }
      if (data === null) {
        await sql`DELETE FROM app_state WHERE key = ${key}`
        res.status(200).json({ ok: true, deleted: true })
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
