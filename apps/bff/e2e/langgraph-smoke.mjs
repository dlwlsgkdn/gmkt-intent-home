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
    OPENAI_BASE_URL: MOCK, // 가상 메이크업 정밀 렌더 — 모의 이미지 편집 엔드포인트
    OPENAI_API_KEY: 'mock-image-key',
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
  ok(svResult?.questions?.[0]?.options?.[0] === '지성|오후만 되면 T존이 번들거려요', '선택지 제목|부제 와이어 직렬화')
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
  {
    const match = prodSection?.products?.[0]?.match
    ok(
      Number.isInteger(match?.score) && match.score >= 0 && match.score <= 100 && match.factors?.length === 5,
      `매칭율 계산·기록 — ${match?.score}% (항목 ${match?.factors?.length})`,
    )
    ok(match?.factors?.some((f) => f.key === 'skin' && f.note), '매칭율 항목 근거(LLM notes) 전달')
    ok(planPage?.sections?.find((s) => s.kind === 'guide')?.subtitle === '유분만 덜어내고 결은 남기는 준비', '단계 안내 서브타이틀 전달')
  }
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

  // ── 8.5 가상 메이크업 저니 — 사진 질문 스캐폴드 + 가상 메이크업 결과(look) 섹션 ──
  console.log('8.5) 가상 메이크업 저니 (graph)')
  const startM = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query: '소개팅 가상 메이크업 해보고 싶어' }),
  }).then((r) => r.json())
  const svM = await sse(`/api/threads/${startM.threadId}/survey`, {}, H)
  const svMPage = last(svM, 'result')?.data?.page
  ok(svMPage?.questions?.length === 3, `사진 질문 포함 3문항 (${svMPage?.questions?.length})`)
  const photoQ = svMPage?.questions?.[0]
  ok(photoQ?.kind === 'photo' && photoQ?.id === 'p1', `첫 질문이 사진 질문 (${photoQ?.id}/${photoQ?.kind})`)
  ok((photoQ?.options ?? []).length === 0, '사진 질문은 선택지가 없다')
  ok(svMPage?.questions?.[1]?.id === 'q1', '선택지 질문 id는 q1부터 — 자리만 한 칸 밀린다')
  ok(
    svM.some((e) => e.event === 'question' && e.data.index === 0 && e.data.question?.kind === 'photo'),
    '사진 질문이 스트리밍 index 0으로 도착',
  )
  ok(
    svM.some((e) => e.event === 'question' && e.data.index === 1 && e.data.question?.id === 'q1'),
    '스트리밍 자리도 확정 페이지와 같게 밀린다',
  )
  const planM = await sse(
    `/api/threads/${startM.threadId}/plan`,
    {
      answers: [
        { questionId: 'p1', choices: ['사진 제출됨'] }, // 사진 원본이 아니라 표식만 온다
        { questionId: 'q1', choices: ['데이트'] },
      ],
    },
    H,
  )
  const planMPage = last(planM, 'result')?.data?.page
  ok(planMPage?.sections?.[0]?.kind === 'look', `가상 메이크업 결과가 계획 맨 앞 (${planMPage?.sections?.[0]?.kind})`)
  const look = planMPage?.sections?.[0]
  ok(look?.tone === 'coral', `룩 색조 전달 (${look?.tone})`)
  ok((look?.points ?? []).length === 2, `룩 포인트 유지 (${(look?.points ?? []).length})`)
  ok(planMPage?.sections?.some((s) => s.kind === 'products'), 'look과 상품 섹션이 함께 병합')
  {
    const skCall = (await llmCalls()).filter((c) => c.type === 'skeleton').at(-1)
    ok(skCall?.user?.includes('얼굴 사진을 올렸습니다'), '사진 제출이 계획 가변부에 말로 실림')
    ok(!skCall?.user?.includes('data:image'), '사진 원본은 프롬프트에 실리지 않는다')
  }

  // ── 8.7 가상 메이크업 정밀 렌더 (이미지 편집 모델) ──
  console.log('8.7) 가상 메이크업 정밀 렌더')
  // 1x1 PNG data URL — 왕복·기록 검증용 (합성 품질은 브라우저에서 본다)
  const tinyPhoto =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const renderRes = await fetch(`${BFF}/api/threads/${startM.threadId}/look-render`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ photo: tinyPhoto, tone: 'coral', title: '코랄 생기 데일리 룩', points: ['립 — 코랄 틴트'] }),
  })
  const render = await renderRes.json()
  ok(renderRes.status === 201, `정밀 렌더 응답 201 (${renderRes.status})`)
  ok(String(render?.image || '').startsWith('data:image/png;base64,'), '편집된 이미지 data URL 수신')
  ok(!!render?.model, `사용 모델 각인 (${render?.model})`)
  {
    const editCall = (await llmCalls()).filter((c) => c.type === 'image-edit').at(-1)
    ok(!!editCall, '이미지 편집 모델 호출됨')
    ok((editCall?.user || '').includes('same person'), '편집 지시문에 동일성 보존 지시 포함')
    ok((editCall?.user || '').includes('coral'), '편집 지시문에 룩 색조 반영')
    ok((editCall?.user || '').includes('opaque coral lipstick'), '편집 지시문 기본 강도 strong (진한 메이크업)')
  }
  {
    const dumpM = await fetch(MOCK + `/internal/dump/${startM.threadId}`).then((r) => r.json())
    const renderStep = (dumpM?.steps ?? []).find((s) => s.payload?.type === 'look-render')
    ok(!!renderStep, '정밀 렌더가 action 스텝으로 기록')
    ok(renderStep?.payload?.data?.tone === 'coral', '기록에 룩 색조 포함')
    // 얼굴 사진은 어떤 스텝에도 남지 않는다 — 기본 경로와 같은 원칙
    ok(!JSON.stringify(dumpM?.steps ?? []).includes('data:image/'), '사진 원본은 스텝에 남지 않는다')
  }

  {
    const caps = await fetch(BFF + '/api/threads/capabilities', { headers: H }).then((r) => r.json())
    ok(caps?.imageEdit === true, `정밀 렌더 가용성 노출 (imageEdit=${caps?.imageEdit})`)
  }

  // ── 9. 파이프라인 스튜디오 API (페이즈 4) ──
  console.log('9) 파이프라인 스튜디오 API')
  const pipe = await fetch(BFF + '/api/admin/pipeline').then((r) => r.json())
  ok(pipe?.stages?.length === 9, `단계 카탈로그 9개 (${pipe?.stages?.length})`)
  ok(pipe?.stages?.some((s) => s.no === '5a') && pipe?.stages?.some((s) => s.no === '5b'), '병렬 5a/5b 표기')
  ok(pipe?.knowledge?.some((k) => k.id === 'guard-blocklist' && k.value), '블록리스트 KV가 지식 목록에 노출')
  const promptWire = await fetch(BFF + '/api/admin/prompts').then((r) => r.json())
  const productPrompt = promptWire?.prompts?.find((p) => p.id === 'plan-products')
  const assistRes = await fetch(BFF + '/api/admin/prompts/plan-products/assist', {
    method: 'POST',
    headers: plain,
    body: JSON.stringify({
      instruction: '추천 이유를 세 문장 이하로 제한해줘',
      currentText: productPrompt.defaultText,
    }),
  })
  const assisted = await assistRes.json()
  ok(assistRes.status === 201, `Claude 지시서 수정안 응답 (${assistRes.status})`)
  ok(assisted?.proposedText?.includes('세 문장 이하'), '자연어 요청이 수정안에 반영')
  ok(assisted?.proposedText?.includes('{{CATALOG}}'), '수정안이 필수 자리표시자 보존')
  const savedPrompts = await fetch(BFF + '/api/admin/prompts/plan-products', {
    method: 'PUT',
    headers: plain,
    body: JSON.stringify({ text: assisted.proposedText, note: assisted.summary }),
  }).then((r) => r.json())
  const savedProductPrompt = savedPrompts?.prompts?.find((p) => p.id === 'plan-products')
  ok(savedProductPrompt?.configured === assisted.proposedText, '승인한 수정안만 운영 설정에 저장')
  ok(savedProductPrompt?.history?.[0]?.note === assisted.summary, '수정 요약이 버전 기록에 남음')
  const restoredPrompts = await fetch(BFF + '/api/admin/prompts/plan-products', {
    method: 'PUT',
    headers: plain,
    body: JSON.stringify({ text: null, note: '기본 지시서로 복구' }),
  }).then((r) => r.json())
  const restoredProductPrompt = restoredPrompts?.prompts?.find((p) => p.id === 'plan-products')
  ok(restoredProductPrompt?.configured === null, '이전 기본 지시서로 복구')
  ok((restoredProductPrompt?.history?.length ?? 0) >= 2, '저장·복구가 버전 기록으로 누적')
  const dr = await sse('/api/admin/pipeline/dry-run', { stageId: 'survey', intent: '가을 파운데이션 추천' }, plain)
  const drResult = last(dr, 'result')?.data
  ok(drResult?.survey?.questions?.length === 3, `dry-run 설문 3문항 (${drResult?.survey?.questions?.length})`)
  ok(drResult?.ledger?.trendKeywords?.includes('스킨플러딩'), 'dry-run 원장에 트렌드 키워드 주입')
  ok(!last(dr, 'error'), 'dry-run 오류 없음')
  ok(drResult?.prompt?.promptId === 'survey', 'dry-run 결과에 실제 프롬프트 노출 (promptId)')
  ok(drResult?.prompt?.system?.includes('무너짐'), 'dry-run 프롬프트 — 치환 완료 시스템 전문 (지식 KV 포함)')
  ok(drResult?.prompt?.user?.includes('가을 파운데이션 추천'), 'dry-run 프롬프트 — 요청 가변부 원문')

  // ── 9.5 전체 플로우 실행 (flow-run) — 실제 그래프 + admin 프로필(ops-playground) 쓰레드로 실기록.
  //     (core 미연결 환경에서만 flow- 임시 id로 강등된다 — 모의 core는 쓰레드를 받아 주므로 여기선 기록된다) ──
  console.log('9.5) 전체 플로우 실행 (flow-run)')
  const callsBeforeFlow = await llmCalls()
  const fr1 = await sse('/api/admin/pipeline/flow-run', { phase: 'survey', intent: '여름 쿠션 플로우 확인' }, plain)
  const fr1Result = last(fr1, 'result')?.data
  ok(!last(fr1, 'error'), '플로우 설문 구간 오류 없음')
  ok(/^\d{19}$/.test(fr1Result?.flowId ?? ''), `flowId = core 쓰레드 id (${fr1Result?.flowId})`)
  ok(fr1Result?.recorded === true, 'flow-run 실기록 플래그(recorded)')
  ok(fr1Result?.survey?.questions?.length === 3, `플로우 설문 3문항 (${fr1Result?.survey?.questions?.length})`)
  ok(fr1Result?.ledger?.trendKeywords?.includes('스킨플러딩'), '플로우 원장에 트렌드 키워드 주입')
  const fr1Stages = fr1.filter((e) => e.event === 'stage').map((e) => e.data)
  const stageOf = (list, id, phase) => list.find((s) => s.id === id && s.phase === phase)
  ok(!!stageOf(fr1Stages, 'objective', 'done'), 'stage 이벤트 — 목적어 가드 done')
  ok(stageOf(fr1Stages, 'intent', 'done')?.meta?.latencyMs != null, 'stage 이벤트 — 의도 정규화 meta')
  ok(!!stageOf(fr1Stages, 'ledger', 'done')?.summary, 'stage 이벤트 — 원장 요약')
  ok(stageOf(fr1Stages, 'survey', 'start')?.prompt?.system?.includes('무너짐'), 'stage 이벤트 — 설문 시작에 실제 시스템 전문')
  ok(stageOf(fr1Stages, 'survey', 'start')?.prompt?.user?.includes('여름 쿠션 플로우 확인'), 'stage 이벤트 — 설문 시작에 가변부 원문')
  ok(stageOf(fr1Stages, 'survey', 'done')?.meta?.latencyMs != null, 'stage 이벤트 — 설문 done meta')
  ok(!!stageOf(fr1Stages, 'gate', 'start'), 'stage 이벤트 — 답변 대기 interrupt')
  ok(count(fr1, 'content') >= 3, `content 조각 수신 ${count(fr1, 'content')}회`)
  const fr1States = fr1.filter((e) => e.event === 'state').map((e) => e.data)
  ok(fr1States[0]?.node === '(시작 입력)' && fr1States[0]?.patch?.intent === '여름 쿠션 플로우 확인', 'state 이벤트 — 시작 입력 스냅샷')
  ok(fr1States.some((s) => s.id === 'ledger' && s.patch?.ledger), 'state 이벤트 — 원장 채널 패치')
  ok(fr1States.some((s) => s.id === 'survey' && s.patch?.survey?.questions?.length === 3), 'state 이벤트 — 설문 채널 패치')

  const fr2 = await sse(
    '/api/admin/pipeline/flow-run',
    {
      phase: 'plan',
      flowId: fr1Result.flowId,
      intent: '여름 쿠션 플로우 확인',
      survey: fr1Result.survey,
      answers: [{ questionId: 'q1', choices: ['지성'] }],
    },
    plain,
  )
  const fr2Result = last(fr2, 'result')?.data
  ok(!last(fr2, 'error'), '플로우 계획 구간 오류 없음')
  ok(fr2Result?.page?.sections?.length === 3, `플로우 최종 병합 페이지 (${fr2Result?.page?.sections?.length}섹션)`)
  ok((fr2Result?.dropLog ?? []).some((d) => d.code === 'blocklist'), '플로우 dropLog에 검증 게이트 기록')
  const fr2Stages = fr2.filter((e) => e.event === 'stage').map((e) => e.data)
  ok(stageOf(fr2Stages, 'plan-skeleton', 'start')?.prompt?.promptId === 'plan-skeleton', 'stage 이벤트 — 뼈대 시작 프롬프트')
  ok(stageOf(fr2Stages, 'plan-products', 'start')?.prompt?.user?.includes('지성'), 'stage 이벤트 — 상품 가변부에 답변 반영')
  ok(stageOf(fr2Stages, 'plan-skeleton', 'done') && stageOf(fr2Stages, 'plan-products', 'done'), 'stage 이벤트 — 병렬 5a·5b done')
  const verifyStage = stageOf(fr2Stages, 'verify', 'done')
  ok(verifyStage?.pass === 3 && verifyStage?.drops >= 1, `stage 이벤트 — 검증 게이트 통과 ${verifyStage?.pass}·드롭 ${verifyStage?.drops}`)
  ok(
    (stageOf(fr2Stages, 'record', 'done')?.summary ?? '').includes('admin 프로필(ops-playground)'),
    'stage 이벤트 — admin 프로필 쓰레드로 기록',
  )
  // 기록이 말뿐이 아닌지 core에서 되읽는다 — 쓰레드·평가 탭이 이 스텝을 그린다
  const flowThread = await fetch(`${MOCK}/internal/threads/${fr1Result.flowId}`).then((r) => r.json())
  ok(flowThread?.userId === 'ops-playground', `플로우 쓰레드 소유자 (${flowThread?.userId})`)
  const flowStages = (flowThread?.steps ?? []).map((s) => s.stage)
  ok(flowStages.includes('survey') && flowStages.includes('plan'), `플로우 스텝 기록 (${flowStages.join(',')})`)
  const fr2States = fr2.filter((e) => e.event === 'state').map((e) => e.data)
  ok(fr2States[0]?.node === '(체크포인트 재개)' && fr2States[0]?.patch?.survey, 'state 이벤트 — 재개 스냅샷 (설문 포함)')
  ok(fr2States.some((s) => s.node === 'await-answers' && s.patch?.answers?.length === 1), 'state 이벤트 — 답변 주입 패치')
  ok(fr2States.some((s) => s.id === 'plan-skeleton' && s.patch?.skeleton), 'state 이벤트 — 뼈대 채널 패치')
  ok(fr2States.some((s) => s.id === 'verify' && s.patch?.page && s.patch?.dropLog), 'state 이벤트 — 최종 페이지·드롭 로그 패치')
  {
    const callsAfterFlow = await llmCalls()
    const delta = (type) => callsAfterFlow.filter((c) => c.type === type).length - callsBeforeFlow.filter((c) => c.type === type).length
    ok(delta('intent') === 1 && delta('survey') === 1, `플로우 LLM 호출 — intent ${delta('intent')}·survey ${delta('survey')}`)
    ok(delta('skeleton') === 1 && delta('products') === 1, `플로우 LLM 호출 — skeleton ${delta('skeleton')}·products ${delta('products')}`)
  }

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
    body: JSON.stringify({
      score: 4,
      comment: '기본 설정 무난',
      components: [{ id: 'sec-1', label: '상품 · 추천 쿠션', score: 3, feedback: '상품 폭이 좁아요' }],
    }),
  }).then((r) => r.json())
  ok(scored?.score === 4 && scored?.comment === '기본 설정 무난', '채점 저장')
  ok(scored?.components?.length === 1 && scored.components[0].id === 'sec-1', '섹션별 채점(components) 저장')
  const runsWire = await fetch(BFF + `/api/admin/eval/cases/${promo.id}/runs`).then((r) => r.json())
  ok(runsWire?.items?.length === 1 && runsWire.items[0].score === 4, '실행 기록 목록 + 채점 반영')

  // ── 10.5 자동 채점 (judge) — 평가 레코드 문법의 source 축 ──
  console.log('10.5) 자동 채점 (judge)')
  const judgeEvents = await sse(`/api/admin/eval/runs/${run.id}/judge`, {}, plain)
  const judged = last(judgeEvents, 'result')?.data?.run
  ok(judged?.judge?.score === 4, `judge 종합 별점 저장 (${judged?.judge?.score})`)
  ok((judged?.judge?.rubric || []).length === 4, `루브릭 4차원 (${judged?.judge?.rubric?.length})`)
  ok(judged?.judge?.rubric?.[0]?.key === 'grounding' && judged.judge.rubric[0].label === '근거 충실', '루브릭 key·label 매핑')
  ok(judged?.score === 4 && judged?.components?.length === 1, 'judge가 사람 채점을 덮지 않음 (source 분리)')
  ok(judged?.judge?.meta?.model != null, 'judge 호출 메타 기록')
  {
    const judgeCalls = (await llmCalls()).filter((c) => c.type === 'judge')
    ok(judgeCalls.length === 1, 'judge LLM 1회 호출')
    ok(judgeCalls[0]?.user?.includes('심사 대상'), '심사 요청에 결과 페이지 전문 포함')
    ok(judgeCalls[0]?.user?.includes('드롭 로그'), '심사 요청에 검증 게이트 드롭 로그 포함')
  }

  // ── 10.7 단계 축 — 설문 단계 실행 + 설문 judge (다른 루브릭) ──
  console.log('10.7) 설문 단계 실행·판정 (stage=survey)')
  const svRunEvents = await sse(`/api/admin/eval/cases/${promo.id}/run`, { stage: 'survey', label: '설문 회귀' }, plain)
  const svRun = last(svRunEvents, 'result')?.data?.run
  ok(svRun?.config?.stage === 'survey', 'config.stage=survey 각인')
  ok(svRun?.page?.questions?.length === 3, `설문 페이지 저장 (질문 ${svRun?.page?.questions?.length})`)
  ok(svRun?.page?.questions?.[0]?.id === 'q1', '질문 id 부여(q1) — 채점 앵커')
  const svJudgeEvents = await sse(`/api/admin/eval/runs/${svRun.id}/judge`, {}, plain)
  const svJudged = last(svJudgeEvents, 'result')?.data?.run
  ok(svJudged?.judge?.score === 4, `설문 judge 종합 별점 (${svJudged?.judge?.score})`)
  ok(svJudged?.judge?.rubric?.[0]?.key === 'necessity' && svJudged.judge.rubric[0].label === '질문 절제', '설문 루브릭(질문 절제) 매핑')
  {
    const sjCalls = (await llmCalls()).filter((c) => c.type === 'judge-survey')
    ok(sjCalls.length === 1, 'judge-survey LLM 1회 호출')
    ok(sjCalls[0]?.user?.includes('심사 대상'), '설문 심사 요청에 설문 전문 포함')
  }
  const engineMetrics = await fetch(BFF + '/api/admin/metrics/engines').then((r) => r.json())
  const lg = engineMetrics?.engines?.find((e) => e.engine === 'langgraph')
  const legacyM = engineMetrics?.engines?.find((e) => e.engine === 'legacy')
  ok(lg?.count >= 1, `전환 계기판 — langgraph 표본 (${lg?.count})`)
  ok(legacyM?.count >= 1, `전환 계기판 — legacy 표본 (${legacyM?.count})`)
  ok(lg?.promptVersions?.includes('v18'), 'promptVersion 각인 (v18)')
} finally {
  shutdown()
}

console.log(failures === 0 ? '\n🎉 전부 통과' : `\n💥 실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
