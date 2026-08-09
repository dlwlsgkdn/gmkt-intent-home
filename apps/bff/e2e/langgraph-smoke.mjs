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

  // ── 0. 지식·가드 KV 시딩 (페이즈 3 — 관리 편집 모의) ──
  const putSetting = (key, value) =>
    fetch(`${MOCK}/internal/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
  await putSetting('knowledge-trend-keywords', '스킨플러딩')
  await putSetting('knowledge-consumer-vocab', '무너짐: 지속력 저하를 뜻하는 소비자 말 (내부 태그 durability_low)')
  await putSetting('guard-blocklist', '모의브랜드 모의 세미매트 쿠션')

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
  {
    const calls0 = await llmCalls()
    const surveyCall = calls0.find((c) => c.type === 'survey')
    ok(surveyCall?.system?.includes('무너짐'), '지식 KV(어휘 사전)가 시스템 자리표시자로 주입')
    ok(surveyCall?.user?.includes('스킨플러딩'), '트렌드 키워드가 원장 경유 가변부로 주입')
    ok(calls0.filter((c) => c.type === 'intent').length === 1, '의도 정규화(1단계) LLM 1회')
    ok(surveyCall?.user?.includes('의도 해석'), '의도 해석이 설문 가변부에 주입')
    ok(surveyCall?.user?.includes('여름 지속력'), '의도 목적(goal)이 원장 경유로 실림')
  }

  // ── 3. 계획 생성 — 살아 있는 interrupt를 Command로 재개 ──
  console.log('3) 계획 생성 (graph — Command 재개)')
  const plan = await sse(`/api/threads/${tid}/plan`, { answers: [{ questionId: 'q1', choices: ['지성'] }] }, H)
  const planPage = last(plan, 'result')?.data?.page
  ok(!!planPage, 'result 계획 수신')
  ok(planPage?.headline === '모의 여름 쿠션 계획', `headline (${planPage?.headline})`)
  ok(planPage?.sections?.length === 3, `섹션 3개 병합 (${planPage?.sections?.length})`)
  const prodSection = planPage?.sections?.find((s) => s.kind === 'products')
  ok(
    prodSection?.products?.length === 1,
    `확장 게이트 통과 1개 — 블록리스트·의학 단정 드롭 후 카탈로그만 (${prodSection?.products?.length})`,
  )
  ok(prodSection?.products?.[0]?.id === 'p-012', '남은 상품은 카탈로그 p-012')
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
  const dropCodes = (planStep?.payload?.dropLog ?? []).map((d) => d.code)
  ok(dropCodes.includes('blocklist'), `dropLog에 블록리스트 드롭 기록 (${dropCodes.join(',')})`)
  ok(dropCodes.includes('medical-claim'), 'dropLog에 의학 단정 드롭 기록')
  ok(planStep?.payload?.ledger?.trendKeywords?.includes('스킨플러딩'), '원장 스냅샷이 payload에 기록')
  ok((planStep?.payload?.ledger?.facts ?? []).some((f) => f.source === 'answer'), '원장 facts에 설문 답변 반영')

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
  ok(calls.filter((c) => c.type === 'intent').length === 1, '재생성에서 intent 재호출 없음 (멱등 스킵)')
  ok(calls.filter((c) => c.type === 'skeleton').length === 2, 'skeleton 2회(초회+재생성)')

  // ── 6. 설문 재요청 멱등 — 재생성 없이 core 시딩으로 재응답 ──
  console.log('6) 설문 재요청 (graph — 멱등)')
  const sv2 = await sse(`/api/threads/${tid}/survey`, {}, H)
  ok(last(sv2, 'result')?.data?.page?.questions?.length === 3, '기존 설문 재응답')
  calls = await llmCalls()
  ok(calls.filter((c) => c.type === 'survey').length === 1, 'survey LLM 재호출 없음')
  ok(calls.filter((c) => c.type === 'skeleton').length === 2, '설문 재요청이 계획을 재생성하지 않음')

  // ── 7. 직전 쓰레드 피드백 압축 — 같은 사용자의 새 쓰레드 가변부에 실린다 ──
  console.log('7) 직전 쓰레드 피드백 → 새 쓰레드 원장')
  await fetch(`${BFF}/api/threads/${tid}/events`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      type: 'feedback',
      data: { stage: 'plan', review: { score: 1, feedback: '향 강한 제품은 별로였어요' }, components: [] },
    }),
  })
  const startC = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query: '가을 파운데이션 추천' }),
  }).then((r) => r.json())
  const svC = await sse(`/api/threads/${startC.threadId}/survey`, {}, H)
  ok(!!last(svC, 'result')?.data?.page, '새 쓰레드 설문 생성')
  {
    const surveyCallsAll = (await llmCalls()).filter((c) => c.type === 'survey')
    ok(surveyCallsAll.length === 2, `survey LLM 총 2회 (${surveyCallsAll.length})`)
    const lastSurvey = surveyCallsAll.at(-1)
    ok(lastSurvey?.user?.includes('향 강한'), '직전 쓰레드 피드백 압축이 가변부에 주입')
    ok(lastSurvey?.user?.includes('★1'), '별점 압축 표기(★1)')
  }

  // ── 7.5 목적어 가드 (0단계) — 막연한 발화는 LLM 호출 전에 되돌린다 ──
  console.log('7.5) 목적어 가드 (graph)')
  const startVague = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query: '예뻐지고 싶어' }),
  }).then((r) => r.json())
  const svVague = await sse(`/api/threads/${startVague.threadId}/survey`, {}, H)
  const vagueError = last(svVague, 'error')?.data
  ok(vagueError?.code === 'llm_refused' && !vagueError?.retryable, '막연 발화 → llm_refused 비재시도')
  ok((vagueError?.message || '').includes('구체적'), '유도 문구 포함')
  {
    const callsAfterVague = await llmCalls()
    ok(callsAfterVague.filter((c) => c.type === 'intent').length === 2, '가드 차단 시 LLM 미호출 (intent 2회 유지)')
  }

  // ── 8. legacy 경로 무영향 (헤더 없음 = 기본 legacy) ──
  console.log('8) legacy 엔진 회귀 확인')
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

  // ── 9. 파이프라인 스튜디오 API (페이즈 4) ──
  console.log('9) 파이프라인 스튜디오 API')
  const pipe = await fetch(BFF + '/api/admin/pipeline').then((r) => r.json())
  ok(pipe?.stages?.length === 9, `단계 카탈로그 9개 (${pipe?.stages?.length})`)
  ok(pipe?.stages?.some((s) => s.no === '5a') && pipe?.stages?.some((s) => s.no === '5b'), '병렬 5a/5b 표기')
  ok(pipe?.knowledge?.some((k) => k.id === 'guard-blocklist' && k.value), '블록리스트 KV가 지식 목록에 노출')
  const dr = await sse('/api/admin/pipeline/dry-run', { stageId: 'survey', intent: '가을 파운데이션 추천' }, plain)
  const drResult = last(dr, 'result')?.data
  ok(drResult?.survey?.questions?.length === 3, `dry-run 설문 3문항 (${drResult?.survey?.questions?.length})`)
  ok(drResult?.ledger?.trendKeywords?.includes('스킨플러딩'), 'dry-run 원장에 트렌드 키워드 주입')
  ok(!last(dr, 'error'), 'dry-run 오류 없음')

  // ── 10. 평가·실험 API (페이즈 5) ──
  console.log('10) 평가·실험 API')
  const promo = await fetch(BFF + '/api/admin/eval/cases', {
    method: 'POST',
    headers: plain,
    body: JSON.stringify({ threadId: tid }),
  }).then((r) => r.json())
  ok(/^\d{19}$/.test(promo?.id ?? ''), '쓰레드 → 케이스 승격')
  ok(promo?.survey?.questions?.length === 3, '설문 스냅샷 포함')
  ok((promo?.answers || []).length >= 1, '답변 스냅샷 포함')
  const runEvents = await sse(`/api/admin/eval/cases/${promo.id}/run`, { label: '기본 설정' }, plain)
  const run = last(runEvents, 'result')?.data?.run
  ok(run?.page?.sections?.length === 3, `케이스 실행 — 병합 페이지 (${run?.page?.sections?.length})`)
  ok(run?.config?.engine === 'dry-run' && run?.config?.label === '기본 설정', '실행 config 스냅샷')
  ok((run?.dropLog || []).some((d) => d.code === 'blocklist'), '실행 dropLog에 검증 게이트 기록')
  ok(run?.meta?.phases?.skeletonMs != null, '실행 meta phases 결합')
  const scored = await fetch(BFF + `/api/admin/eval/runs/${run.id}`, {
    method: 'PATCH',
    headers: plain,
    body: JSON.stringify({ score: 4, comment: '기본 설정 무난' }),
  }).then((r) => r.json())
  ok(scored?.score === 4 && scored?.comment === '기본 설정 무난', '채점 저장')
  const runsWire = await fetch(BFF + `/api/admin/eval/cases/${promo.id}/runs`).then((r) => r.json())
  ok(runsWire?.items?.length === 1 && runsWire.items[0].score === 4, '실행 기록 목록 + 채점 반영')
  const engineMetrics = await fetch(BFF + '/api/admin/metrics/engines').then((r) => r.json())
  const lg = engineMetrics?.engines?.find((e) => e.engine === 'langgraph')
  const legacyM = engineMetrics?.engines?.find((e) => e.engine === 'legacy')
  ok(lg?.count >= 1, `전환 계기판 — langgraph 표본 (${lg?.count})`)
  ok(legacyM?.count >= 1, `전환 계기판 — legacy 표본 (${legacyM?.count})`)
  ok(lg?.promptVersions?.includes('v15'), 'promptVersion 각인 (v15)')
} finally {
  shutdown()
}

console.log(failures === 0 ? '\n🎉 전부 통과' : `\n💥 실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
