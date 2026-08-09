// LangGraph 엔진 E2E 스모크 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 2 완료 기준의 오프라인 검증).
// 모의 core+Anthropic 위에서 빌드된 bff를 스폰해 라이브 플로우 전 구간을 몰아 확인한다:
//   설문 생성(interrupt 멈춤·부분 스트리밍) → 계획(Command 재개·뼈대∥검색 병렬·그라운딩·병합)
//   → core 기록 → 피드백 재생성(재실행 경로·survey 멱등 스킵) → 설문 재요청 멱등 → legacy 회귀.
// 실행: npm run build && npm run e2e:mock  (외부 네트워크·API 키 불필요)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const MOCK_PORT = 19799
const BFF_PORT = 18788
const MOCK = `http://localhost:${MOCK_PORT}`
const BFF = `http://localhost:${BFF_PORT}`
const H = { 'content-type': 'application/json', 'x-ddak-engine': 'langgraph' }

let failures = 0
const ok = (cond, label) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}`)
  if (!cond) failures++
}

async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      /* 재시도 */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`기동 대기 초과: ${url}`)
}

async function sse(pathName, body, headers) {
  const res = await fetch(BFF + pathName, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  const events = []
  for (const block of text.split('\n\n')) {
    const ev = block.match(/^event: (.+)$/m)?.[1]
    const data = block.match(/^data: (.+)$/m)?.[1]
    if (ev && data) events.push({ event: ev, data: JSON.parse(data) })
  }
  return events
}
const last = (events, name) => events.filter((e) => e.event === name).at(-1)
const count = (events, name) => events.filter((e) => e.event === name).length
const llmCalls = async () => (await fetch(MOCK + '/internal/llm-calls')).json()

const mock = spawn('node', [path.join(here, 'mock-upstream.mjs')], {
  env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
  stdio: 'ignore',
})
const bff = spawn('node', [path.join(here, '..', 'dist', 'main.js')], {
  env: {
    ...process.env,
    PORT: String(BFF_PORT),
    CORE_URL: MOCK,
    ANTHROPIC_BASE_URL: MOCK,
    ANTHROPIC_API_KEY: 'mock-key',
    LANGGRAPH_DATABASE_URL: '', // MemorySaver — interrupt/재개는 프로세스 내에서 검증
    BFF_SERVICE_TOKEN: '',
  },
  stdio: 'ignore',
})
const shutdown = () => {
  mock.kill()
  bff.kill()
}
process.on('exit', shutdown)

try {
  await waitFor(MOCK + '/internal/llm-calls')
  await waitFor(BFF + '/healthz')

  // ── 1. 쓰레드 시작 ──
  const start = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query: '여름에 무너지지 않는 쿠션 찾아줘' }),
  }).then((r) => r.json())
  const tid = start.threadId
  console.log('1) 쓰레드 시작:', tid)
  ok(/^\d{19}$/.test(tid ?? ''), 'threadId 발급')

  // ── 2. 설문 생성 (langgraph) — interrupt에서 멈추고 설문 반환 ──
  console.log('2) 설문 생성 (graph)')
  const sv = await sse(`/api/threads/${tid}/survey`, {}, H)
  const svResult = last(sv, 'result')?.data?.page
  ok(!!svResult && svResult.questions?.length === 3, `result 설문 3문항 (${svResult?.questions?.length})`)
  ok(svResult?.questions?.[0]?.id === 'q1', '질문 id 부여(q1)')
  ok(count(sv, 'question') >= 3, `question 부분 스트리밍 ${count(sv, 'question')}회`)
  ok(count(sv, 'head') >= 1, `head(intro) 스트리밍 ${count(sv, 'head')}회`)
  ok(!last(sv, 'error'), '오류 없음')

  // ── 3. 계획 생성 — 살아 있는 interrupt를 Command로 재개 ──
  console.log('3) 계획 생성 (graph — Command 재개)')
  const plan = await sse(`/api/threads/${tid}/plan`, { answers: [{ questionId: 'q1', choices: ['지성'] }] }, H)
  const planPage = last(plan, 'result')?.data?.page
  ok(!!planPage, 'result 계획 수신')
  ok(planPage?.headline === '모의 여름 쿠션 계획', `headline (${planPage?.headline})`)
  ok(planPage?.sections?.length === 3, `섹션 3개 병합 (${planPage?.sections?.length})`)
  const prodSection = planPage?.sections?.find((s) => s.kind === 'products')
  ok(prodSection?.products?.length === 2, `상품 그라운딩 통과 2개 — 웹+카탈로그 (${prodSection?.products?.length})`)
  ok(prodSection?.products?.[0]?.mall === '올리브영', '웹 상품이 앞자리')
  const sk = last(plan, 'skeleton')?.data
  ok(!!sk && sk.pending?.length === 1 && sk.pending[0] === 1, `skeleton 조기 확정 + pending [1] (${JSON.stringify(sk?.pending)})`)
  const secFinal = plan.filter((e) => e.event === 'section' && e.data.final)
  ok(secFinal.some((e) => e.data.index === 1 && e.data.section.kind === 'products'), '검색 섹션이 자리 index 1에 final 도착')
  ok(!last(plan, 'error'), '오류 없음')

  let calls = await llmCalls()
  ok(calls.filter((c) => c.type === 'survey').length === 1, `LLM survey 호출 1회 (${calls.filter((c) => c.type === 'survey').length})`)
  ok(calls.filter((c) => c.type === 'skeleton').length === 1, 'LLM skeleton 호출 1회')
  ok(calls.filter((c) => c.type === 'products').length === 1, 'LLM products 호출 1회')

  // ── 4. core 기록 확인 (record 노드) ──
  console.log('4) core 스텝 기록')
  const dump = await fetch(MOCK + `/internal/dump/${tid}`).then((r) => r.json())
  ok(dump?.thread?.status === 'planning', `status=planning (${dump?.thread?.status})`)
  const seqs = dump?.steps?.map((s) => s.seq).sort().join(',')
  ok(seqs === '1,2,3,4', `스텝 seq 1~4 기록 (${seqs})`)
  const planStep = dump?.steps?.find((s) => s.seq === 4)
  ok(planStep?.llmMeta?.phases?.skeletonMs != null, 'llmMeta.phases 결합 기록')

  // ── 5. 피드백 반영 재생성 — 완주한 쓰레드 재실행 (survey 재생성 없어야 함) ──
  console.log('5) 피드백 반영 재생성 (graph — 재실행 경로)')
  const regen = await sse(
    `/api/threads/${tid}/plan`,
    {
      answers: [{ questionId: 'q1', choices: ['지성'] }],
      feedback: { stage: 'plan', review: { score: 2, feedback: '향이 강한 제품은 빼 주세요' }, components: [] },
    },
    H,
  )
  ok(!!last(regen, 'result')?.data?.page, '재생성 result 수신')
  ok(!last(regen, 'error'), '오류 없음')
  calls = await llmCalls()
  ok(calls.filter((c) => c.type === 'survey').length === 1, '재생성에서 survey 재호출 없음 (멱등 스킵)')
  ok(calls.filter((c) => c.type === 'skeleton').length === 2, 'skeleton 2회(초회+재생성)')

  // ── 6. 설문 재요청 멱등 — 재생성 없이 core 시딩으로 재응답 ──
  console.log('6) 설문 재요청 (graph — 멱등)')
  const sv2 = await sse(`/api/threads/${tid}/survey`, {}, H)
  ok(last(sv2, 'result')?.data?.page?.questions?.length === 3, '기존 설문 재응답')
  calls = await llmCalls()
  ok(calls.filter((c) => c.type === 'survey').length === 1, 'survey LLM 재호출 없음')

  // ── 7. legacy 경로 무영향 (헤더 없음 = 기본 legacy) ──
  console.log('7) legacy 엔진 회귀 확인')
  const plain = { 'content-type': 'application/json' }
  const startB = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: plain,
    body: JSON.stringify({ query: '레거시 확인용' }),
  }).then((r) => r.json())
  const svB = await sse(`/api/threads/${startB.threadId}/survey`, {}, plain)
  ok(last(svB, 'result')?.data?.page?.questions?.length === 3, 'legacy 설문 생성 정상')
  const planB = await sse(`/api/threads/${startB.threadId}/plan`, { answers: [{ questionId: 'q1', choices: ['건성'] }] }, plain)
  ok(last(planB, 'result')?.data?.page?.sections?.length === 3, 'legacy 계획 생성 정상')
} finally {
  shutdown()
}

console.log(failures === 0 ? '\n🎉 전부 통과' : `\n💥 실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
