// 모의 core + 모의 Anthropic — 엔진 E2E 스모크용 업스트림 (langgraph-smoke.mjs가 스폰).
// core internal API: threads/steps/settings 인메모리, Anthropic: /v1/messages SSE 스트림.
// LLM 판별은 시스템 프롬프트 마커 기반 — 프롬프트 문구가 크게 바뀌면 판별 순서를 함께 점검할 것.
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 19799)

const threads = new Map() // id -> { thread, steps: Map<seq, step> }
const settings = new Map() // key -> value (core 설정 KV 모의 — 지식·가드·엔진 플래그)
let nextId = 2195943212345678900n
export const llmCalls = [] // { type, system, user } — e2e가 프롬프트 주입을 검증한다

const SURVEY_JSON = JSON.stringify({
  intro: '모의 인트로입니다. 여름 쿠션을 찾아볼게요.',
  questions: [
    { question: '피부 타입은 어떻게 되세요?', options: ['지성', '건성', '복합성'], multi: false },
    { question: '가장 큰 고민은 무엇인가요?', options: ['모공', '수분', '지속력'], multi: true },
    { question: '예산은 어느 정도 생각하세요?', options: ['1만원대', '3만원대'], multi: false },
  ],
})

const SKELETON_JSON = JSON.stringify({
  headline: '모의 여름 쿠션 계획',
  summary: '지성 피부를 위한 모의 요약입니다.',
  sections: [
    { kind: 'guide', title: '피부 준비', body: '유분을 잡는 것부터 시작해요.' },
    { kind: 'products', title: '추천 쿠션', reason: '지속력 기준으로 고를 거예요.' },
    { kind: 'steps', title: '사용 순서', steps: ['아침 프라이머', '쿠션 얇게 두 번'] },
  ],
})

const INTENT_JSON = JSON.stringify({
  template: '제품 추천',
  goal: '여름 지속력',
  timing: '지금 바로',
  audience: '본인',
})

const PRODUCTS_JSON = JSON.stringify({
  sections: [
    {
      kind: 'products',
      title: '추천 쿠션',
      reason: '지성 피부 지속력 기준의 모의 추천입니다.',
      productIds: ['p-012'],
      webProducts: [
        {
          name: '모의 세미매트 쿠션',
          brand: '모의브랜드',
          price: 19900,
          mall: '올리브영',
          url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000001',
          imageUrl: '',
          tags: ['지속력', '세미매트'],
        },
        // 의학 단정 차단 대상 — 이름에 '치료' (guard 있을 때만 드롭 — legacy 경로는 통과)
        {
          name: '여드름 치료 크림',
          brand: '모의브랜드',
          price: 15000,
          mall: '올리브영',
          url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000002',
          imageUrl: '',
          tags: ['진정'],
        },
      ],
    },
  ],
})

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function streamAnthropic(res, payload, { delayMs, chunkSize }) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  sseWrite(res, 'message_start', {
    type: 'message_start',
    message: {
      id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-opus-5-mock',
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  })
  sseWrite(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < payload.length; i += chunkSize) {
    sseWrite(res, 'content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: payload.slice(i, i + chunkSize) },
    })
    await new Promise((r) => setTimeout(r, delayMs))
  }
  sseWrite(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sseWrite(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } })
  sseWrite(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const bodyText = Buffer.concat(chunks).toString('utf8')
  const body = bodyText ? JSON.parse(bodyText) : undefined
  const url = req.url ?? ''

  // ── 모의 Anthropic ──────────────────────────────────────────────
  if (url === '/v1/messages' && req.method === 'POST') {
    const system = (body.system ?? []).map((b) => b.text ?? '').join('\n')
    const user = (body.messages ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    // 판별 순서 주의: 상품 시스템에도 '뼈대', 뼈대 시스템에도 '설문' 문구가 있다 —
    // 상품 고유 마커(productIds) → 뼈대 → 설문 순으로 좁힌다
    if (system.includes('productIds')) {
      llmCalls.push({ type: 'products', system, user })
      return streamAnthropic(res, PRODUCTS_JSON, { delayMs: 10, chunkSize: 24 }) // 뼈대보다 늦게 끝나게
    }
    if (system.includes('뼈대')) {
      llmCalls.push({ type: 'skeleton', system, user })
      return streamAnthropic(res, SKELETON_JSON, { delayMs: 4, chunkSize: 18 })
    }
    if (system.includes('정규화한다')) {
      llmCalls.push({ type: 'intent', system, user })
      return streamAnthropic(res, INTENT_JSON, { delayMs: 2, chunkSize: 30 })
    }
    llmCalls.push({ type: 'survey', system, user })
    return streamAnthropic(res, SURVEY_JSON, { delayMs: 4, chunkSize: 18 })
  }

  // ── 모의 core internal API ──────────────────────────────────────
  res.setHeader('content-type', 'application/json')
  const send = (code, data) => { res.writeHead(code); res.end(JSON.stringify(data)) }

  if (url === '/internal/threads' && req.method === 'POST') {
    const id = String(nextId++)
    const thread = {
      id, userId: body.userId, title: body.title ?? null, source: body.source ?? null,
      status: 'active', live: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    threads.set(id, { thread, steps: new Map() })
    return send(201, thread)
  }
  let m
  if ((m = url.match(/^\/internal\/threads\/(\d+)\/steps\/(\d+)$/)) && req.method === 'PUT') {
    const t = threads.get(m[1])
    if (!t) return send(404, { message: 'no thread' })
    const step = { threadId: m[1], seq: Number(m[2]), stage: body.stage, payload: body.payload, llmMeta: body.llmMeta ?? null }
    t.steps.set(step.seq, step)
    return send(200, step)
  }
  if ((m = url.match(/^\/internal\/threads\/(\d+)$/)) && req.method === 'GET') {
    const t = threads.get(m[1])
    if (!t) return send(404, { message: 'no thread' })
    return send(200, { ...t.thread, steps: [...t.steps.values()].sort((a, b) => a.seq - b.seq) })
  }
  if ((m = url.match(/^\/internal\/threads\/(\d+)$/)) && req.method === 'PATCH') {
    const t = threads.get(m[1])
    if (!t) return send(404, { message: 'no thread' })
    Object.assign(t.thread, body, { updatedAt: new Date().toISOString() })
    return send(200, t.thread)
  }
  if ((m = url.match(/^\/internal\/settings\/([^/]+)$/)) && req.method === 'GET') {
    const key = decodeURIComponent(m[1])
    if (!settings.has(key)) return send(404, { message: 'no setting' })
    return send(200, { key, value: settings.get(key), updatedAt: new Date().toISOString() })
  }
  if ((m = url.match(/^\/internal\/settings\/([^/]+)$/)) && req.method === 'PUT') {
    const key = decodeURIComponent(m[1])
    settings.set(key, body.value)
    return send(200, { key, value: body.value, updatedAt: new Date().toISOString() })
  }
  if (url.startsWith('/internal/feedback-steps') && req.method === 'GET') {
    const items = []
    for (const t of threads.values()) {
      for (const step of t.steps.values()) {
        if (step.stage === 'action' && step.payload?.type === 'feedback') items.push({ thread: t.thread, step })
      }
    }
    items.reverse() // 최신 제출 먼저 (삽입 역순 근사)
    return send(200, { items, truncated: false })
  }
  if (url === '/internal/llm-calls' && req.method === 'GET') return send(200, llmCalls)
  if ((m = url.match(/^\/internal\/dump\/(\d+)$/)) && req.method === 'GET') {
    const t = threads.get(m[1])
    return send(200, t ? { thread: t.thread, steps: [...t.steps.values()] } : null)
  }
  send(404, { message: `mock: ${req.method} ${url} 미구현` })
})

server.listen(PORT, () => console.log(`[mock] core+anthropic on :${PORT}`))
