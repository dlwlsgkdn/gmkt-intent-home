/* DDAK Scenario Studio 서버 영속화 API — Neon Postgres(jsonb 문서 저장).
   GET  /api/state                → 전체 덤프 { <key>: {data, updatedAt}, ... } (구버전 클라이언트 호환)
   GET  /api/state?index=1        → [{ key, updatedAt }] 목록만 (본문 없이 어떤 행이 있는지)
   GET  /api/state?key=<k>        → 해당 키 하나만 { <key>: {data, updatedAt} }
   GET  /api/state?keys=<k1,k2>   → 여러 키 배치 조회 (최대 32개 — 하이드레이션 1단계용)
   PUT  /api/state {key, data}    → 해당 키 문서를 통째로 upsert (문서 단위 last-write-wins)
   PUT  /api/state {key, data: null} → 해당 키 삭제

   키 체계: 'accounts-meta'(계정 순서) · 'account:<id>'(계정 본문 — 버전·쓰레드 제외)
   · 'account:<id>:threads'(쓰레드) · 'account:<id>:versions:<sid>'(시나리오 하나의 발행 버전
   스냅샷) · 'keywords'. 'accounts'는 구 통짜 블롭(마이그레이션 후 삭제됨). 행을 잘게 쪼갠
   이유 둘: 통짜 블롭이 Vercel 함수 본문 한도(4.5MB)에 닿아 저장이 조용히 거부됐고, 첫 접속
   하이드레이션이 홈에 필요 없는 무거운 데이터(버전 스냅샷·쓰레드)까지 기다리게 했다. */
import { neon } from '@neondatabase/serverless'

const KEY_PATTERN = /^(accounts|keywords|accounts-meta|account:[A-Za-z0-9_-]{1,64}(?::threads|:versions:[A-Za-z0-9_-]{1,64})?)$/

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
      const { key, keys, index } = req.query || {}
      if (index) {
        const rows = await sql`SELECT key, updated_at FROM app_state`
        res.status(200).json(rows.map((r) => ({ key: r.key, updatedAt: r.updated_at })))
        return
      }
      if (keys) {
        const list = String(keys).split(',').map((k) => k.trim()).filter(Boolean)
        if (list.length === 0 || list.length > 32 || list.some((k) => !KEY_PATTERN.test(k))) {
          res.status(400).json({ error: '알 수 없는 keys 형식이에요. (쉼표 구분, 최대 32개)' })
          return
        }
        const rows = await sql`SELECT key, data, updated_at FROM app_state WHERE key = ANY(${list})`
        const out = {}
        for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updated_at }
        res.status(200).json(out)
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
