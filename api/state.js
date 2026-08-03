/* DDAK Scenario Studio 서버 영속화 API — Neon Postgres(jsonb 문서 저장).
   GET  /api/state                → 전체 덤프 { <key>: {data, updatedAt}, ... } (구버전 클라이언트 호환)
   GET  /api/state?index=1        → [{ key, updatedAt }] 목록만 (본문 없이 어떤 행이 있는지)
   GET  /api/state?key=<k>        → 해당 키 하나만 { <key>: {data, updatedAt} }
   GET  /api/state?keys=<k1,k2>   → 여러 키 배치 조회 (최대 32개)
   GET  /api/state?boot=<계정id>  → 부트 한 방: { index, rows: {메타·키워드·계정 본문 하나} } —
                                    요청 id가 없으면 메타 순서의 첫 계정 본문을 대신 담는다.
                                    홈 첫 페인트가 이 한 왕복으로 끝난다
   PUT  /api/state {key, data}    → 해당 키 문서를 통째로 upsert (문서 단위 last-write-wins)
   PUT  /api/state {key, data: null} → 해당 키 삭제

   키 체계: 'accounts-meta'(계정 순서) · 'account:<id>'(셸 본문 — 프로필·탐색·시나리오 칩 메타)
   · 'account:<id>:scenario:<sid>'(시나리오 콘텐츠: stages·planCases) · 'account:<id>:versions:<sid>'
   (발행 버전 스냅샷 — 빌더 전용) · 'account:<id>:threads'(쓰레드) · 'keywords'
   · 'starters-meta'(기본 시나리오 목록 — 제목·원천 정보) · 'starter:<id>'(기본 시나리오
   스냅샷 본문 — 새 프로필 생성 때만 읽는 불변 사본, last-write-wins).
   'accounts'는 구 통짜 블롭(마이그레이션 후 삭제됨). 행을 화면 필요 단위로 쪼갠 이유:
   통짜는 Vercel 함수 본문 한도(4.5MB)에 닿았고, 첫 접속이 홈에 필요 없는 무거운 데이터
   (케이스·버전 스냅샷·쓰레드)까지 기다리게 했다. */
import { neon } from '@neondatabase/serverless'

const KEY_PATTERN = /^(accounts|keywords|accounts-meta|starters-meta|starter:[A-Za-z0-9_-]{1,64}|account:[A-Za-z0-9_-]{1,64}(?::threads|:(?:versions|scenario):[A-Za-z0-9_-]{1,64})?)$/
const BODY_KEY_PATTERN = /^account:[A-Za-z0-9_-]{1,64}$/

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
      const { key, keys, index, boot } = req.query || {}
      if (index) {
        const rows = await sql`SELECT key, updated_at FROM app_state`
        res.status(200).json(rows.map((r) => ({ key: r.key, updatedAt: r.updated_at })))
        return
      }
      if (boot !== undefined) {
        const all = await sql`SELECT key, updated_at FROM app_state`
        const have = new Set(all.map((r) => r.key))
        const wanted = ['accounts-meta', 'keywords', 'starters-meta']
        const bootId = typeof boot === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(boot) ? boot : null
        if (bootId && have.has(`account:${bootId}`)) wanted.push(`account:${bootId}`)
        let rows = await sql`SELECT key, data, updated_at FROM app_state WHERE key = ANY(${wanted})`
        // 요청한 본문이 없으면(새 기기 등) 메타 순서의 첫 계정 → 아무 계정 순으로 폴백
        if (!rows.some((r) => BODY_KEY_PATTERN.test(r.key))) {
          const meta = rows.find((r) => r.key === 'accounts-meta')
          const order = meta && meta.data && Array.isArray(meta.data.order) ? meta.data.order : []
          const fallback = order.map((id) => `account:${id}`).find((k) => have.has(k))
            || all.map((r) => r.key).find((k) => BODY_KEY_PATTERN.test(k))
          if (fallback) {
            rows = rows.concat(await sql`SELECT key, data, updated_at FROM app_state WHERE key = ${fallback}`)
          }
        }
        const out = {}
        for (const r of rows) out[r.key] = { data: r.data, updatedAt: r.updated_at }
        res.status(200).json({ index: all.map((r) => ({ key: r.key, updatedAt: r.updated_at })), rows: out })
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
