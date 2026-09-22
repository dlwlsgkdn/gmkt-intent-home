/* 스튜디오 /api/state 목 서버 — 운영 DB 없이 서버 동기화(하이드레이션·업로드)를 검증할 때 쓴다(2026-09-16).
   메모리 Map 이라 프로세스가 죽으면 비워진다. api/state.js 와 같은 계약: GET ?index=1 · ?boot=<계정id> · ?key= · ?keys= · 전체, PUT/POST {key, data} upsert(data:null 삭제).
   실행: PORT=8123 node apps/studio/scripts/mock-state-api.mjs → 개발 서버는 .claude/launch.json 의 scenario-studio-mockdb-mac(VITE_DATA_PROFILE=prod + VITE_API_PROXY) */
import http from 'node:http'
const store = new Map() // key -> { data, updatedAt }
const BODY = /^account:[A-Za-z0-9_-]+$/
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)) }
const index = () => [...store.entries()].map(([key, v]) => ({ key, updatedAt: v.updatedAt }))
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'GET') {
    if (url.searchParams.get('index')) return send(res, 200, index())
    if (url.searchParams.has('boot')) {
      const wanted = ['accounts-meta', 'keywords', 'starters-meta']
      const id = url.searchParams.get('boot')
      if (id && store.has(`account:${id}`)) wanted.push(`account:${id}`)
      if (!wanted.some((k) => BODY.test(k))) {
        const order = store.get('accounts-meta')?.data?.order || []
        const fb = order.map((i) => `account:${i}`).find((k) => store.has(k)) || [...store.keys()].find((k) => BODY.test(k))
        if (fb) wanted.push(fb)
      }
      const rows = {}
      for (const k of wanted) if (store.has(k)) rows[k] = store.get(k)
      return send(res, 200, { index: index(), rows })
    }
    const keys = url.searchParams.get('keys') ? url.searchParams.get('keys').split(',') : url.searchParams.get('key') ? [url.searchParams.get('key')] : [...store.keys()]
    const out = {}
    for (const k of keys) if (store.has(k)) out[k] = store.get(k)
    return send(res, 200, out)
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      const { key, data } = JSON.parse(raw || '{}')
      if (data === null) { store.delete(key); return send(res, 200, { ok: true, deleted: true }) }
      store.set(key, { data, updatedAt: new Date().toISOString() })
      console.log('PUT', key)
      send(res, 200, { ok: true })
    })
    return
  }
  send(res, 405, { error: 'method' })
}).listen(Number(process.env.PORT || 8123), () => console.log('mock state api on', process.env.PORT || 8123))
