// 모의 core + 모의 Anthropic — 엔진 E2E 스모크용 업스트림 (langgraph-smoke.mjs가 스폰).
// core internal API: threads/steps/settings 인메모리, Anthropic: /v1/messages SSE 스트림.
// LLM 판별은 시스템 프롬프트 마커 기반 — 프롬프트 문구가 크게 바뀌면 판별 순서를 함께 점검할 것.
import http from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 19799)

const threads = new Map() // id -> { thread, steps: Map<seq, step> }
const settings = new Map() // key -> value (core 설정 KV 모의 — 지식·가드·엔진 플래그)
const evalCases = new Map() // id -> case row
const evalRuns = new Map() // id -> run row
let nextId = 2195943212345678900n
export const llmCalls = [] // { type, system, user } — e2e가 프롬프트 주입을 검증한다

const SURVEY_JSON = JSON.stringify({
  intro: '모의 인트로입니다. 여름 쿠션을 찾아볼게요.',
  photoQuestion: '', // 사진이 필요 없는 의도 — 사진 질문 자리가 생기지 않는다
  questions: [
    // 선택지는 제목+부제 객체 — BFF(optionWire)가 와이어 "제목|부제" 문자열로 직렬화한다
    {
      question: '피부 타입은 어떻게 되세요?',
      options: [
        { label: '지성', desc: '오후만 되면 T존이 번들거려요' },
        { label: '건성', desc: '세안 뒤 당기고 각질이 일어나요' },
        { label: '복합성', desc: 'T존은 번들, 볼은 건조해요' },
      ],
      multi: false,
    },
    {
      question: '가장 큰 고민은 무엇인가요?',
      options: [
        { label: '모공', desc: '코·볼 모공이 두드러져요' },
        { label: '수분', desc: '속건조로 메이크업이 들떠요' },
        { label: '지속력', desc: '점심 지나면 무너져요' },
      ],
      multi: true,
    },
    {
      question: '예산은 어느 정도 생각하세요?',
      options: [
        { label: '1만원대', desc: '부담 없이 써 볼 가격' },
        { label: '3만원대', desc: '한 단계 좋은 제형까지' },
      ],
      multi: false,
    },
  ],
})

/* 가상 메이크업 저니 — 얼굴을 봐야 답이 달라지는 의도라 사진 질문(머리 필드)이 붙는다.
   BFF가 이 문구를 첫 질문(id=p1, kind=photo) 자리로 세운다 */
const SURVEY_PHOTO_JSON = JSON.stringify({
  intro: '올려주신 얼굴에 어울리는 룩을 찾아볼게요.',
  photoQuestion: '얼굴이 잘 보이는 정면 사진을 올려주세요',
  questions: [
    {
      question: '어떤 자리에 갈 계획인가요?',
      options: [
        { label: '데일리', desc: '출근·수업처럼 매일 가는 자리' },
        { label: '데이트', desc: '가까이서 봐도 예쁜 룩' },
        { label: '행사', desc: '사진이 많이 남는 자리' },
      ],
      multi: false,
    },
    {
      question: '평소 선호하는 색조는?',
      options: [
        { label: '코랄', desc: '생기 있는 오렌지 기운' },
        { label: '로즈', desc: '차분한 핑크 기운' },
        { label: '뉴트럴', desc: '피부에 스미는 MLBB' },
      ],
      multi: false,
    },
  ],
})

/* 사진을 받은 계획 — 첫 섹션이 가상 메이크업 결과(look)다 (화면이 올린 사진에 tone을 올린다) */
const SKELETON_LOOK_JSON = JSON.stringify({
  headline: '모의 가상 메이크업 계획',
  summary: '코랄 톤으로 생기를 올리는 모의 요약입니다.',
  sections: [
    {
      kind: 'look',
      title: '코랄 생기 데일리 룩',
      desc: '데일리를 고르셔서 과하지 않은 코랄로 잡았어요.',
      tone: 'coral',
      points: ['립 — 코랄 틴트를 안쪽부터', '볼 — 같은 톤으로 얇게'],
    },
    { kind: 'guide', title: '베이스 정돈', subtitle: '룩이 잘 얹히도록 결부터 고르는 준비', body: '결을 먼저 정리해요.' },
    { kind: 'products', title: '이 룩에 쓸 상품', reason: '코랄 톤 기준으로 고를 거예요.' },
  ],
})

const SKELETON_JSON = JSON.stringify({
  headline: '모의 여름 쿠션 계획',
  summary: '지성 피부를 위한 모의 요약입니다.',
  sections: [
    { kind: 'guide', title: '피부 준비', subtitle: '유분만 덜어내고 결은 남기는 준비', body: '유분을 잡는 것부터 시작해요.' },
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

const JUDGE_SURVEY_JSON = JSON.stringify({
  necessity: { score: 5, note: '세 질문 모두 계획을 바꾸는 질문입니다.' },
  relevance: { score: 4, note: '첫 질문이 피부 타입 축을 짚습니다.' },
  answerability: { score: 4, note: '선택지가 짧은 명사구입니다.' },
  tone: { score: 5, note: '담백한 존댓말입니다.' },
  overall: 4,
  verdict: '모의 설문 심사평: 질문 절제가 좋습니다.',
})

const JUDGE_JSON = JSON.stringify({
  grounding: { score: 4, note: '추천 쿠션 섹션의 상품이 카탈로그로 확인되나 드롭이 있었습니다.' },
  personalization: { score: 5, note: '지성 답변이 안내와 선정 근거에 반영됐습니다.' },
  structure: { score: 4, note: '안내 → 상품 → 순서 흐름이 유지됩니다.' },
  actionability: { score: 3, note: '사용 순서가 짧아 아침·저녁 구분이 없습니다.' },
  overall: 4,
  verdict: '모의 심사평: 맞춤성은 좋으나 드롭된 상품 자리를 보완하면 좋겠습니다.',
})

const PRODUCTS_JSON = JSON.stringify({
  sections: [
    {
      kind: 'products',
      title: '추천 쿠션',
      reason: '지성 피부 지속력 기준의 모의 추천입니다.',
      productIds: ['p-012'],
      // 매칭 평가(match) — 검증 게이트가 가중 합산해 매칭율(%)을 붙인다 (guards/match.ts)
      catalogRatings: [
        {
          id: 'p-012',
          match: {
            skin: 4, concern: 4, preference: 3, price: 4,
            notes: { skin: '지성 피부에 무리 없는 가벼운 제형이에요', concern: '지속력 고민에 맞춘 픽서 쿠션이에요', preference: '10분 루틴엔 한 단계 더 필요해요' },
          },
        },
      ],
      webProducts: [
        {
          name: '모의 세미매트 쿠션',
          brand: '모의브랜드',
          price: 19900,
          mall: '올리브영',
          url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000001',
          urlKind: 'pdp',
          imageUrl: '',
          tags: ['지속력', '세미매트'],
          match: {
            skin: 5, concern: 4, preference: 4,
            notes: { skin: '지성 피부에 맞는 세미매트 마감이에요', concern: '번들거림 고민에 맞춘 지속력이에요', preference: '10분 루틴에 맞는 간단한 사용감이에요' },
          },
        },
        // 의학 단정 차단 대상 — 이름에 '치료' (guard 있을 때만 드롭 — legacy 경로는 통과)
        {
          name: '여드름 치료 크림',
          brand: '모의브랜드',
          price: 15000,
          mall: '올리브영',
          url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000002',
          urlKind: 'pdp',
          imageUrl: '',
          tags: ['진정'],
        },
        // PDP 를 못 찾은 상품 — 몰 검색 결과 주소 + urlKind=search (게이트가 검색 페이지 주소를 이 표식으로만 통과시킨다)
        {
          name: '모의 픽서 미스트',
          brand: '모의브랜드',
          price: 12000,
          mall: '지마켓',
          url: 'https://browse.gmarket.co.kr/search?keyword=%EB%AA%A8%EC%9D%98%20%ED%94%BD%EC%84%9C%20%EB%AF%B8%EC%8A%A4%ED%8A%B8',
          urlKind: 'search',
          imageUrl: '',
          tags: ['픽서', '지속력'],
          match: {
            skin: 4, concern: 5, preference: 4,
            notes: { skin: '지성 피부에 산뜻한 미스트예요', concern: '지속력 고민에 직접 닿는 픽서예요', preference: '한 번 뿌리는 간단한 사용감이에요' },
          },
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
  // 이미지 편집은 multipart라 JSON 파싱을 하면 안 된다 — content-type으로 가른다
  const isJson = (req.headers['content-type'] ?? '').includes('application/json')
  const body = isJson && bodyText ? JSON.parse(bodyText) : undefined
  const url = req.url ?? ''

  // ── 모의 이미지 편집 (OpenAI images.edits) ──────────────────────
  if (url === '/v1/images/edits' && req.method === 'POST') {
    // multipart 본문에서 프롬프트만 건져 기록한다 (e2e가 동일성 보존 지시를 검증한다)
    const prompt = /name="prompt"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(bodyText)?.[1] ?? ''
    llmCalls.push({ type: 'image-edit', system: '', user: prompt })
    res.setHeader('content-type', 'application/json')
    res.writeHead(200)
    // 1x1 투명 PNG — 내용이 아니라 왕복·기록을 검증하는 자리다
    res.end(
      JSON.stringify({
        data: [
          {
            b64_json:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          },
        ],
      }),
    )
    return
  }

  // ── 모의 Anthropic ──────────────────────────────────────────────
  if (url === '/v1/messages' && req.method === 'POST') {
    const system = (body.system ?? []).map((b) => b.text ?? '').join('\n')
    const user = (body.messages ?? [])
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n')
    // 판별 순서 주의: 상품 시스템에도 '뼈대', 뼈대 시스템에도 '설문' 문구가 있다 —
    // 상품 고유 마커(productIds) → 뼈대 → 설문 순으로 좁힌다
    if (system.includes('설문 심사관')) {
      llmCalls.push({ type: 'judge-survey', system, user })
      return streamAnthropic(res, JUDGE_SURVEY_JSON, { delayMs: 2, chunkSize: 40 })
    }
    if (system.includes('품질 심사관')) {
      llmCalls.push({ type: 'judge', system, user })
      return streamAnthropic(res, JUDGE_JSON, { delayMs: 2, chunkSize: 40 })
    }
    if (system.includes('시스템 프롬프트 편집자')) {
      llmCalls.push({ type: 'prompt-assist', system, user })
      const input = JSON.parse(user)
      const output = JSON.stringify({
        proposedText: `${input.currentText}\n\n추가 운영 규칙: ${input.instruction}`,
        summary: input.instruction.slice(0, 200),
        warnings: [],
      })
      return streamAnthropic(res, output, { delayMs: 2, chunkSize: 40 })
    }
    if (system.includes('productIds')) {
      llmCalls.push({ type: 'products', system, user })
      return streamAnthropic(res, PRODUCTS_JSON, { delayMs: 10, chunkSize: 24 }) // 뼈대보다 늦게 끝나게
    }
    if (system.includes('뼈대')) {
      llmCalls.push({ type: 'skeleton', system, user })
      // 사진을 받은 쓰레드면 가상 메이크업 결과(look)로 여는 뼈대를 돌려준다
      const lookPlan = user.includes('얼굴 사진을 올렸습니다')
      return streamAnthropic(res, lookPlan ? SKELETON_LOOK_JSON : SKELETON_JSON, { delayMs: 4, chunkSize: 18 })
    }
    if (system.includes('정규화한다')) {
      llmCalls.push({ type: 'intent', system, user })
      return streamAnthropic(res, INTENT_JSON, { delayMs: 2, chunkSize: 30 })
    }
    llmCalls.push({ type: 'survey', system, user })
    // 가상 메이크업 의도만 사진 질문을 요청하는 설문을 돌려준다 (그 밖에는 photoQuestion='')
    const wantsPhoto = user.includes('메이크업')
    return streamAnthropic(res, wantsPhoto ? SURVEY_PHOTO_JSON : SURVEY_JSON, { delayMs: 4, chunkSize: 18 })
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
  if ((m = url.match(/^\/internal\/users\/([^/?]+)\/threads(?:\?(.*))?$/)) && req.method === 'GET') {
    const params = new URLSearchParams(m[2] || '')
    const limit = Number(params.get('limit') || 20)
    const cursor = params.get('cursor')
    const uid = decodeURIComponent(m[1])
    const real = [...threads.values()].map((t) => t.thread).filter((t) => t.userId === uid)
    const fake = Array.from({ length: 45 }, (_, i) => ({
      id: String(9000000000 + i), userId: uid, title: `모의 지난 쓰레드 ${i + 1}`, source: { kind: 'search', query: `모의 지난 쓰레드 ${i + 1}` },
      status: i % 3 === 0 ? 'done' : 'planning',
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 3600_000 + 60_000).toISOString(),
    }))
    const all = [...real, ...fake].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    const filtered = cursor ? all.filter((t) => t.updatedAt < cursor) : all
    const items = filtered.slice(0, limit)
    return send(200, { items, nextCursor: filtered.length > limit ? items[items.length - 1].updatedAt : null })
  }
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
  if ((m = url.match(/^\/internal\/settings\/([^/]+)$/)) && req.method === 'DELETE') {
    settings.delete(decodeURIComponent(m[1]))
    res.writeHead(204)
    res.end()
    return
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
  // ── 평가·실험 (페이즈 5) ──
  if (url.startsWith('/internal/eval/cases') || url.startsWith('/internal/eval/runs')) {
    if (url === '/internal/eval/cases' && req.method === 'POST') {
      const row = { id: String(nextId++), title: body.title ?? null, intent: body.intent, profile: body.profile ?? null, survey: body.survey ?? null, answers: body.answers ?? null, sourceThreadId: body.sourceThreadId ?? null, createdAt: new Date().toISOString() }
      evalCases.set(row.id, row)
      return send(201, row)
    }
    if (url.startsWith('/internal/eval/cases?') || url === '/internal/eval/cases') {
      return send(200, { items: [...evalCases.values()].reverse() })
    }
    if ((m = url.match(/^\/internal\/eval\/cases\/(\d+)\/runs$/)) && req.method === 'POST') {
      const row = { id: String(nextId++), caseId: m[1], config: body.config, page: body.page ?? null, dropLog: body.dropLog ?? [], meta: body.meta ?? null, score: null, comment: '', components: [], judge: null, createdAt: new Date().toISOString() }
      evalRuns.set(row.id, row)
      return send(201, row)
    }
    if ((m = url.match(/^\/internal\/eval\/cases\/(\d+)\/runs$/)) && req.method === 'GET') {
      return send(200, { items: [...evalRuns.values()].filter((r) => r.caseId === m[1]).reverse() })
    }
    if ((m = url.match(/^\/internal\/eval\/cases\/(\d+)$/)) && req.method === 'DELETE') {
      evalCases.delete(m[1])
      return send(200, { ok: true })
    }
    if ((m = url.match(/^\/internal\/eval\/runs\/(\d+)$/)) && req.method === 'GET') {
      const row = evalRuns.get(m[1])
      if (!row) return send(404, { message: 'no run' })
      return send(200, { run: row, case: evalCases.get(row.caseId) ?? null })
    }
    if ((m = url.match(/^\/internal\/eval\/runs\/(\d+)$/)) && req.method === 'PATCH') {
      const row = evalRuns.get(m[1])
      if (!row) return send(404, { message: 'no run' })
      row.score = body.score
      if (body.comment !== undefined) row.comment = body.comment
      if (body.components !== undefined) row.components = body.components
      return send(200, row)
    }
    if ((m = url.match(/^\/internal\/eval\/runs\/(\d+)\/judge$/)) && req.method === 'PUT') {
      const row = evalRuns.get(m[1])
      if (!row) return send(404, { message: 'no run' })
      row.judge = body.judge
      return send(200, row)
    }
  }
  if (url.startsWith('/internal/plan-metas') && req.method === 'GET') {
    const items = []
    for (const t of threads.values()) {
      for (const step of t.steps.values()) {
        if (step.stage === 'plan') items.push({ threadId: t.thread.id, createdAt: new Date().toISOString(), llmMeta: step.llmMeta ?? null })
      }
    }
    return send(200, { items })
  }
  if (url === '/internal/llm-calls' && req.method === 'GET') return send(200, llmCalls)
  if ((m = url.match(/^\/internal\/dump\/(\d+)$/)) && req.method === 'GET') {
    const t = threads.get(m[1])
    return send(200, t ? { thread: t.thread, steps: [...t.steps.values()] } : null)
  }
  send(404, { message: `mock: ${req.method} ${url} 미구현` })
})

server.listen(PORT, () => console.log(`[mock] core+anthropic on :${PORT}`))
