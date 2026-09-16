// LangGraph 엔진 E2E 스모크 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 2 완료 기준의 오프라인 검증).
// 모의 core+Anthropic 위에서 빌드된 bff를 스폰해 라이브 플로우 전 구간을 몰아 확인한다:
//   설문 생성(interrupt 멈춤·부분 스트리밍) → 계획(Command 재개·뼈대∥검색 병렬·그라운딩·병합)
//   → core 기록 → 피드백 재생성(재실행 경로·survey 멱등 스킵) → 설문 재요청 멱등 → legacy 회귀.
// 실행: npm run build && npm run e2e:mock  (외부 네트워크·API 키 불필요)
import { spawn } from 'node:child_process'
import { PROMPT_VERSION } from '@ddak/pipeline'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
// 포트는 환경변수로 바꿀 수 있다 — 같은 머신에서 스모크 두 벌이 동시에 돌면(세션 두 개) 모의 서버를 공유해 호출 횟수가 2배로 집계된다
const MOCK_PORT = Number(process.env.SMOKE_MOCK_PORT ?? 19799)
const BFF_PORT = Number(process.env.SMOKE_BFF_PORT ?? 18788)
const MOCK = `http://localhost:${MOCK_PORT}`
const BFF = `http://localhost:${BFF_PORT}`
const H = { 'content-type': 'application/json', 'x-ddak-engine': 'langgraph' }

let failures = 0
const ok = (cond, label) => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}`)
  if (!cond) failures++
}

async function waitFor(url, tries = 120) {
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

const mock = spawn(process.execPath, [path.join(here, 'mock-upstream.mjs')], {
  env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
  stdio: 'ignore',
})
const bff = spawn(process.execPath, [path.join(here, '..', 'dist', 'main.js')], {
  env: {
    ...process.env,
    PORT: String(BFF_PORT),
    CORE_URL: MOCK,
    ANTHROPIC_BASE_URL: MOCK,
    ANTHROPIC_API_KEY: 'mock-key',
    OPENAI_BASE_URL: MOCK, // 가상 메이크업 정밀 렌더 — 모의 이미지 편집 엔드포인트
    OPENAI_API_KEY: 'mock-image-key',
    WEATHER_API_URL: MOCK + '/v1/weather', // 홈 인사말 날씨 — 모의 Open-Meteo
    LANGGRAPH_DATABASE_URL: '', // MemorySaver — interrupt/재개는 프로세스 내에서 검증
    BFF_SERVICE_TOKEN: '',
    ENRICH_FETCH: '0', // 썸네일 og:image 보강은 실 네트워크 — 오프라인 스모크에서는 끈다
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
  ok(planPage?.sections?.length === 4, `섹션 4개 병합 — 뼈대 3 + 5c 콘텐츠(자리 없어 단계 묶음 끝에 끼움) (${planPage?.sections?.length})`)
  ok(
    (planPage?.sections ?? []).map((s) => s.kind).join(',') === 'guide,products,contents,steps',
    `자리 없는 콘텐츠 섹션은 끝이 아니라 그 단계 묶음(steps 앞)에 끼워진다 (${(planPage?.sections ?? []).map((s) => s.kind).join(',')})`,
  )
  {
    const contSection = planPage?.sections?.find((s) => s.kind === 'contents')
    ok(contSection?.items?.length === 3, `참고 콘텐츠 3개 — 2020년 글(stale)·같은 출처 3개째(duplicate-source) 드롭 (${contSection?.items?.length})`)
    ok(contSection?.items?.[0]?.why === '지성 피부에 얇게 여러 겹 올리는 순서가 나온 영상이에요', '콘텐츠 항목의 고른 이유(why) 전달')
    const detail = await fetch(BFF + `/api/admin/threads/${tid}`, { headers: H }).then((r) => r.json())
    const planStep = detail?.steps?.find((s) => s.stage === 'plan')
    const codes = (planStep?.payload?.dropLog || []).map((d) => d.code)
    ok(codes.includes('stale-content') && codes.includes('duplicate-source'), `콘텐츠 게이트 드롭 로그 기록 (${codes.join(',')})`)
    ok((planStep?.payload?.dropLog || []).some((d) => d.code === 'blocklist' && d.message.includes('모의브랜드 모의 세미매트 쿠션') && !d.message.includes('[')),
      '웹 상품 이름 정규화 — 대괄호 프로모션·브랜드 중복을 뗀 뒤 블록리스트 대조')
    const q = planStep?.llmMeta?.quality
    ok(q && q.productSections === 1 && q.contentSections === 1 && q.contentItems === 3 && q.priceUnknown === 1, `llmMeta.quality 품질 요약 기록 (${JSON.stringify(q)})`)
    ok(typeof planStep?.llmMeta?.phases?.contentsMs === 'number' && planStep?.llmMeta?.usage?.webSearchRequests == null, '메타 결합 — 5c 소요(phases.contentsMs)')
  }
  const prodSection = planPage?.sections?.find((s) => s.kind === 'products')
  ok(
    prodSection?.products?.length === 2,
    `확장 게이트 통과 2개 — 블록리스트·의학 단정 드롭 뒤 검색 링크 상품 + 카탈로그 (${prodSection?.products?.length})`,
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
  ok(prodSection?.products?.[0]?.urlKind === 'search' && prodSection?.products?.[0]?.mall === '지마켓', '검색 링크 상품(urlKind=search)이 게이트를 통과')
  ok(prodSection?.products?.[0]?.priceUnknown === true && prodSection?.products?.[0]?.price === 0, '판매가 0 → priceUnknown 표식')
  ok(prodSection?.products?.[0]?.match?.factors?.find((f) => f.key === 'price')?.note?.includes('확인하지 못했'), '가격 미확인 상품의 가격 적합 근거')
  ok(prodSection?.products?.[0]?.match?.factors?.find((f) => f.key === 'evidence')?.score === 25, '검색 링크 상품의 근거 신뢰 25점')
  ok(prodSection?.products?.[1]?.id === 'p-012', '카탈로그 p-012 가 뒤에 붙는다')
  const sk = last(plan, 'skeleton')?.data
  ok(!!sk && sk.pending?.length === 1 && sk.pending[0] === 1, `skeleton 조기 확정 + pending [1] (${JSON.stringify(sk?.pending)})`)
  const secFinal = plan.filter((e) => e.event === 'section' && e.data.final)
  ok(secFinal.some((e) => e.data.index === 1 && e.data.section.kind === 'products'), '검색 섹션이 자리 index 1에 final 도착')
  ok(!last(plan, 'error'), '오류 없음')

  let calls = await llmCalls()
  ok(calls.filter((c) => c.type === 'survey').length === 1, `LLM survey 호출 1회 (${calls.filter((c) => c.type === 'survey').length})`)
  ok(calls.filter((c) => c.type === 'skeleton').length === 1, 'LLM skeleton 호출 1회')
  ok(calls.filter((c) => c.type === 'products').length === 1, 'LLM products 호출 1회')
  ok(calls.filter((c) => c.type === 'contents').length === 1, 'LLM contents(5c) 호출 1회 — 상품과 분리')

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
  ok(last(planB, 'result')?.data?.page?.sections?.length === 4, `legacy 계획 생성 정상 — 5c 콘텐츠 포함 (${last(planB, 'result')?.data?.page?.sections?.length})`)

  // ── 8.3 성분 비교표·주의 성분 저니 (v26) — 성분이 기준인 의도면 뼈대가 [안내 → compare → caution → 상품 자리] 를 두고,
  //    5c 콘텐츠는 그 단계 끝(steps 앞)에 끼며, 빈 short·desc 는 와이어에서 떨어진다 ──
  console.log('8.3) 성분 비교표·주의 성분 저니 (graph)')
  {
    const startI = await fetch(BFF + '/api/threads', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ query: '면도하면 늘 붉어지고 따가워요 성분 비교표를 구성해서 비교해줘' }),
    }).then((r) => r.json())
    const svI = await sse(`/api/threads/${startI.threadId}/survey`, {}, H)
    ok(last(svI, 'result')?.data?.page?.questions?.length === 3, '성분 비교 저니 — 설문 생성')
    const planI = await sse(`/api/threads/${startI.threadId}/plan`, { answers: [{ questionId: 'q1', choices: ['건성'] }] }, H)
    const pageI = last(planI, 'result')?.data?.page
    const kindsI = (pageI?.sections ?? []).map((s) => s.kind).join(',')
    // 5c 콘텐츠는 여기서 빠진다 — 같은 모의 URL 을 앞 쓰레드(3·8단계, 같은 사용자)에서 이미 보여줘 검증 게이트가 duplicate-recent 로 드롭한다
    ok(kindsI === 'guide,compare,caution,products,steps', `성분 비교표·주의 성분이 단계 안내 뒤·상품 자리 앞에 선다 (${kindsI})`)
    const cmp = pageI?.sections?.find((s) => s.kind === 'compare')
    ok(cmp?.rows?.length === 3 && cmp?.pick?.short === '쉐이빙 젤' && cmp?.alt?.short === undefined && cmp?.rows?.[0]?.risk === '높음', '비교표 와이어 — 행 3 · 빈 short 제거 · 위험도')
    const cau = pageI?.sections?.find((s) => s.kind === 'caution')
    ok(cau?.items?.length === 2 && cau?.desc === undefined, '주의 성분 와이어 — 항목 2 · 빈 desc 제거')
    ok(planI.some((e) => e.event === 'section' && e.data.section?.kind === 'compare' && e.data.final === true && e.data.index === 1), '비교표가 뼈대 index 1 에 final 도착')
    const skI = last(planI, 'skeleton')?.data
    ok(
      skI?.page?.sections?.[1]?.kind === 'compare' && skI?.page?.sections?.[2]?.kind === 'caution' && JSON.stringify(skI?.pending) === '[3]',
      `skeleton 조기 확정에 비교표·주의 성분 포함 + pending [3] (${JSON.stringify(skI?.pending)})`,
    )
    ok(!last(planI, 'error'), '오류 없음')
    const detailI = await fetch(BFF + `/api/admin/threads/${startI.threadId}`, { headers: H }).then((r) => r.json())
    const planStepI = detailI?.steps?.find((s) => s.stage === 'plan')
    ok(planStepI?.payload?.page?.sections?.[1]?.kind === 'compare', 'core 기록에도 비교표 섹션이 남는다')
    const codesI = (planStepI?.payload?.dropLog || []).map((d) => d.code)
    ok(codesI.includes('duplicate-recent'), `콘텐츠는 최근 쓰레드에서 보여준 URL 이라 duplicate-recent 로 드롭 (${[...new Set(codesI)].join(',')})`)
    // 심사관·재생성 요청이 새 종류를 [성분 비교]·[주의 성분] 줄로 싣는지는 packages/pipeline/test/prompts-compare.test.mjs 가 본다
    // (여기서 judge 를 부르면 10.5 의 judge 호출 1회 계수가 흔들린다)
  }

  // ── 8.5 가상 메이크업 저니 — 사진 질문 스캐폴드 + 가상 메이크업 결과(look) 섹션 ──
  console.log('8.5) 가상 메이크업 저니 (graph)')
  const startM = await fetch(BFF + '/api/threads', {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ query: '소개팅 가상 메이크업 해보고 싶어' }),
  }).then((r) => r.json())
  const svM = await sse(`/api/threads/${startM.threadId}/survey`, {}, H)
  const svMPage = last(svM, 'result')?.data?.page
  ok(svMPage?.questions?.length === 4, `범위·사진 질문 포함 4문항 (${svMPage?.questions?.length})`)
  const scopeQ = svMPage?.questions?.[0]
  ok(scopeQ?.id === 's1' && scopeQ?.kind === 'choice' && scopeQ?.multi === false, `첫 질문이 스타일링 범위 질문 (${scopeQ?.id}/${scopeQ?.kind})`)
  ok((scopeQ?.options ?? []).map((o) => o.split('|')[0]).join(',') === '메이크업만,메이크업 + 헤어,메이크업 + 헤어 + 옷차림', '범위 선택지 3개 — 제목|부제 문법')
  const photoQ = svMPage?.questions?.[1]
  ok(photoQ?.kind === 'photo' && photoQ?.id === 'p1', `둘째 질문이 사진 질문 (${photoQ?.id}/${photoQ?.kind})`)
  ok((photoQ?.options ?? []).length === 0, '사진 질문은 선택지가 없다')
  ok(svMPage?.questions?.[2]?.id === 'q1', '선택지 질문 id는 q1부터 — 자리만 두 칸 밀린다')
  ok(
    svM.some((e) => e.event === 'question' && e.data.index === 0 && e.data.question?.id === 's1') &&
      svM.some((e) => e.event === 'question' && e.data.index === 1 && e.data.question?.kind === 'photo'),
    '범위·사진 질문이 스트리밍 index 0·1로 도착',
  )
  ok(
    svM.some((e) => e.event === 'question' && e.data.index === 2 && e.data.question?.id === 'q1'),
    '스트리밍 자리도 확정 페이지와 같게 밀린다',
  )
  const planM = await sse(
    `/api/threads/${startM.threadId}/plan`,
    {
      answers: [
        { questionId: 's1', choices: ['메이크업 + 헤어'] }, // 스타일링 범위 — 뼈대가 spec.scope 로 옮긴다
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
  ok(look?.spec?.lip?.finish === 'tint' && look?.spec?.intensity === 'natural', '룩 사양(spec)이 와이어에 실림')
  ok(look?.spec?.lip?.color === '#f4553a', `깨진 립 색이 tone 기본색으로 정규화 (${look?.spec?.lip?.color})`)
  ok(look?.spec?.cheek?.color === '#ff8f6d', `치크 색 소문자 정규화 (${look?.spec?.cheek?.color})`)
  ok((look?.points ?? []).length === 5 && look.points[0] === '립 — 코랄 틴트를 안쪽부터 번지듯' && look.points[4].startsWith('헤어 — '), `룩 포인트를 사양 note 에서 파생 — 범위 안 헤어 포함 (${(look?.points ?? []).length})`)
  ok(look?.spec?.scope === 'hair' && look?.spec?.hair?.style === 'wavy' && look?.spec?.hair?.color === 'keep' && !look?.spec?.outfit, '범위 hair — 헤어 사양은 실리고 옷차림은 뗀다')
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
    body: JSON.stringify({ photo: tinyPhoto, tone: 'coral', title: '코랄 생기 데일리 룩', points: look?.points, spec: look?.spec }),
  })
  const render = await renderRes.json()
  ok(renderRes.status === 201, `정밀 렌더 응답 201 (${renderRes.status})`)
  ok(String(render?.image || '').startsWith('data:image/png;base64,'), '편집된 이미지 data URL 수신')
  ok(!!render?.model, `사용 모델 각인 (${render?.model})`)
  {
    const editCall = (await llmCalls()).filter((c) => c.type === 'image-edit').at(-1)
    ok(!!editCall, '이미지 편집 모델 호출됨')
    ok((editCall?.user || '').includes('same person'), '편집 지시문에 동일성 보존 지시 포함')
    ok((editCall?.user || '').includes('#f4553a') && (editCall?.user || '').includes('Korean gradient lip'), '편집 지시문이 사양(립 hex·그라데이션)에서 생성됨')
    ok((editCall?.user || '').includes('no eyeshadow') && !(editCall?.user || '').includes('full-glam'), '사양에 없는 섀도·풀글램 템플릿을 싣지 않는다')
    ok((editCall?.user || '').includes('- Hair: restyle the hair to soft loose waves') && (editCall?.user || '').includes('light see-through bangs'), '범위 hair — 편집 지시문에 헤어 지시가 실린다')
    ok(/Keep exactly:[^\n]*clothing, pose/.test(editCall?.user || '') && !/Keep exactly:[^\n]*hair,/.test(editCall?.user || ''), '헤어는 보존 목록에서 빠지고 옷은 남는다')
    ok((editCall?.user || '').includes('coral'), '편집 지시문에 룩 색조 반영')
    ok((editCall?.user || '').includes('Overall intensity: medium'), '강도는 사양(intensity=natural)이 정한다')
  }
  {
    // 사양 없는 옛 호출(v22 이전 페이지)은 풀글램 템플릿을 그대로 쓴다 — 호환 경로 회귀
    const legacyRes = await fetch(`${BFF}/api/threads/${startM.threadId}/look-render`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ photo: tinyPhoto, tone: 'coral', title: '코랄 생기 데일리 룩', points: ['립 — 코랄 틴트'] }),
    })
    ok(legacyRes.status === 201, `사양 없는 정밀 렌더 응답 201 (${legacyRes.status})`)
    const legacyCall = (await llmCalls()).filter((c) => c.type === 'image-edit').at(-1)
    ok((legacyCall?.user || '').includes('opaque coral lipstick') && (legacyCall?.user || '').includes('full-glam'), '사양 없는 호출은 풀글램 템플릿 유지')
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
  ok(pipe?.stages?.length === 10, `단계 카탈로그 10개 — 5c 참고 콘텐츠 포함 (${pipe?.stages?.length})`)
  ok(pipe?.stages?.some((s) => s.no === '5a') && pipe?.stages?.some((s) => s.no === '5b'), '병렬 5a/5b 표기')
  ok(pipe?.knowledge?.some((k) => k.id === 'guard-blocklist' && k.value), '블록리스트 KV가 지식 목록에 노출')
  ok(pipe?.knowledge?.some((k) => k.id === 'guard-content-hosts' && k.injection === 'guard'), '콘텐츠 저신뢰 출처 KV 행 노출')
  ok(pipe?.stages?.some((st) => st.id === 'plan-contents' && st.promptId === 'plan-contents'), '5c 참고 콘텐츠 단계가 카탈로그에 등록')
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
  ok(fr2Result?.page?.sections?.length === 4, `플로우 최종 병합 페이지 (${fr2Result?.page?.sections?.length}섹션)`)
  ok((fr2Result?.dropLog ?? []).some((d) => d.code === 'blocklist'), '플로우 dropLog에 검증 게이트 기록')
  const fr2Stages = fr2.filter((e) => e.event === 'stage').map((e) => e.data)
  ok(stageOf(fr2Stages, 'plan-skeleton', 'start')?.prompt?.promptId === 'plan-skeleton', 'stage 이벤트 — 뼈대 시작 프롬프트')
  ok(stageOf(fr2Stages, 'plan-products', 'start')?.prompt?.user?.includes('지성'), 'stage 이벤트 — 상품 가변부에 답변 반영')
  ok(stageOf(fr2Stages, 'plan-skeleton', 'done') && stageOf(fr2Stages, 'plan-products', 'done'), 'stage 이벤트 — 병렬 5a·5b done')
  const verifyStage = stageOf(fr2Stages, 'verify', 'done')
  ok(verifyStage?.pass === 4 && verifyStage?.drops >= 1, `stage 이벤트 — 검증 게이트 통과 ${verifyStage?.pass}·드롭 ${verifyStage?.drops}`)
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
  ok(run?.page?.sections?.length === 4, `케이스 실행 — 병합 페이지 (${run?.page?.sections?.length})`)
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
  console.log('10.6) 홈 검색 라우팅·추천')
  {
    const srp = await fetch(BFF + '/api/search/route', { method: 'POST', headers: plain, body: JSON.stringify({ query: '바디워시' }) }).then((r) => r.json())
    ok(srp?.ddak === false && srp?.source === 'llm', `상품 종류 검색어는 SRP (ddak=${srp?.ddak}, ${srp?.source})`)
    const ddak = await fetch(BFF + '/api/search/route', { method: 'POST', headers: plain, body: JSON.stringify({ query: '여드름 트러블 피부 기초 메이크업', profile: [{ label: '피부타입', value: '지성' }] }) }).then((r) => r.json())
    ok(ddak?.ddak === true && ddak?.normalized?.includes('메이크업'), `고민형 검색어는 DDAK (ddak=${ddak?.ddak})`)
    const sug = await fetch(BFF + '/api/search/suggest', { method: 'POST', headers: plain, body: JSON.stringify({ query: '쿠션' }) }).then((r) => r.json())
    ok(sug?.suggestions?.length === 3 && sug.suggestions.every((s) => s.includes('쿠션')), `AI 검색어 추천 3개 (${sug?.suggestions?.length})`)
    const bad = await fetch(BFF + '/api/search/route', { method: 'POST', headers: plain, body: JSON.stringify({ query: '' }) })
    ok(bad.status === 400, `빈 검색어는 400 (${bad.status})`)
    const calls = await llmCalls()
    ok(calls.some((c) => c.type === 'search-route') && calls.some((c) => c.type === 'search-suggest'), '라우터·추천 LLM 호출 기록')
  }

  // ── 10.6b 홈 개인화(인사말·보라 칩) + 인기 검색어(파랑 칩) ──
  console.log('10.6b) 홈 개인화 인사말·인기 검색어')
  {
    const home = await fetch(BFF + '/api/search/home', {
      method: 'POST', headers: plain,
      body: JSON.stringify({
        name: '유진', profile: [{ label: '피부타입', value: '복합성' }],
        now: { iso: '2026-09-13T15:20:00+09:00', hour: 15, weekday: 0 },
        threads: [{ title: '여름 쿠션 지속력', stage: 'plan', status: 'ongoing', live: true, cart: ['모의 쿠션'], answers: ['복합성', '지속력'] }],
        recentSearches: ['여름 쿠션 지속력'],
      }),
    }).then((r) => r.json())
    ok(home?.source === 'llm' && /유진님/.test(home?.greeting || ''), `개인화 인사말 LLM (${home?.greeting})`)
    ok(home?.threadIndex === 1 && /「[^」]+」/.test(home?.greeting || ''), `인사말이 최근 쓰레드를 「」로 가리키고 threadIndex=1 (${home?.threadIndex})`)
    ok(home?.suggestions?.length === 3, `개인화 추천 검색어 3개 (${home?.suggestions?.length})`)
    ok(home?.weather?.label === '대체로 맑음' && home?.weather?.tempC === 24.5, `날씨 조회·라벨 (${home?.weather?.label} ${home?.weather?.tempC})`)
    const homeCall = (await llmCalls()).find((c) => c.type === 'home-personalize')
    ok(!!homeCall && homeCall.user.includes('담은 상품: 모의 쿠션') && homeCall.user.includes('대체로 맑음'), '홈 인사 요청에 쓰레드 요약·날씨 포함')
    const badHome = await fetch(BFF + '/api/search/home', { method: 'POST', headers: plain, body: JSON.stringify({ now: { iso: 'x', hour: 25, weekday: 0 } }) })
    ok(badHome.status === 400, `시각 범위 밖은 400 (${badHome.status})`)

    const pop = await fetch(BFF + '/api/search/popular?limit=3').then((r) => r.json())
    ok(pop?.items?.length === 3 && pop.items[0].count >= pop.items[1].count && pop.items[1].count >= pop.items[2].count, `인기 검색어 상위 3 내림차순 (${pop?.items?.map((i) => i.keyword).join(', ')})`)
    ok(pop?.source === 'seed' || pop?.source === 'kv', `원천 표식 (${pop?.source})`)
    const top = pop.items[0]
    await fetch(BFF + '/api/search/route', { method: 'POST', headers: plain, body: JSON.stringify({ query: top.keyword }) })
    await new Promise((r) => setTimeout(r, 300))
    const pop2 = await fetch(BFF + '/api/search/popular?limit=3').then((r) => r.json())
    ok(pop2?.items?.[0]?.keyword === top.keyword && pop2.items[0].count === top.count + 1, `후보 표 검색어 제출 시 count+1 (${top.count} → ${pop2?.items?.[0]?.count})`)
    const kv = await fetch(MOCK + '/internal/settings/search-popular').then((r) => r.json())
    ok(Array.isArray(kv?.value) && kv.value.some((row) => row.keyword === top.keyword && row.count === top.count + 1), 'core KV search-popular 에 표 시딩·반영')
    const popMax = await fetch(BFF + '/api/search/popular?limit=99').then((r) => r.json())
    ok(popMax?.items?.length === 10, `limit 상한 10 (${popMax?.items?.length})`)
  }

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
  ok(lg?.promptVersions?.includes(PROMPT_VERSION), `promptVersion 각인 (${PROMPT_VERSION})`)

  {
  console.log('11) 전체 지시서 요청·묶음 적용·충돌 보호')
  const flowWire = await fetch(BFF + '/api/admin/prompts').then((r) => r.json())
  const prompts = ['survey', 'plan-skeleton', 'plan-products'].map((id) => {
    const p = flowWire.prompts.find((entry) => entry.id === id)
    return { id, text: p.configured ?? p.defaultText }
  })
  const flowReq = (path, body, method = 'POST') => fetch(BFF + '/api/admin/' + path, { method, headers: plain, body: JSON.stringify(body) })
  const proposalRes = await flowReq('prompt-flow/assist', { instruction: '실전 팁으로 쉽게 알려줘', focus: ['plan-skeleton', 'plan-products'], prompts })
  const proposal = await proposalRes.json()
  ok(proposalRes.status === 201 && proposal.changes?.length === 3, '한 요청으로 세 지시서 수정안 생성')
  ok(proposal.changes?.every((change) => change.baseText === prompts.find((p) => p.id === change.id).text), '원본 기준선은 서버가 부착')
  const unchanged = await fetch(BFF + '/api/admin/prompts').then((r) => r.json())
  ok(unchanged.prompts.every((p) => p.configured === flowWire.prompts.find((old) => old.id === p.id).configured), '시험안 생성은 운영값을 쓰지 않음')
  const calls = (await llmCalls()).filter((call) => call.type === 'flow-assist')
  ok(calls.length === 1 && JSON.parse(calls[0].user).focus.length === 2, '선택사항 여러 개와 전체 문맥을 한 호출에 전달')
  ok(proposal.review?.score === 86 && proposal.review?.scoreParts?.request === 34, 'AI 점수는 세 평가 항목을 합산한 100점 척도')
  ok(proposal.summary.length <= 60 && ['good','bad','risks'].every(key => proposal.review[key].length <= 1 && proposal.review[key].every(text => text.length <= 55)), '한 줄 요약과 항목별 짧은 점검')
  ok(proposal.review?.good?.length && proposal.review?.bad?.length && proposal.review?.risks?.length, '수정안에 좋은 점·아쉬운 점·주의할 점 포함')
  const refinementRes = await flowReq('prompt-flow/assist', { instruction: '실전 팁으로 쉽게 알려줘', prompts, previousChanges: proposal.changes, refinements: ['설명은 더 짧게 해줘'] })
  const refined = await refinementRes.json()
  ok(refinementRes.status === 201 && refined.changes?.every((c) => c.proposedText.includes('실전 팁으로 쉽게 알려줘') && c.proposedText.includes('설명은 더 짧게 해줘')), '추가 요청이 직전 수정안을 유지하며 반영')
  ok(refined.changes?.every((c) => c.baseText === prompts.find((p) => p.id === c.id).text), '반복 수정 후에도 운영 기준선 보존')
  const duplicate = await flowReq('prompt-flow/assist', { instruction: '잘 알려줘', prompts: [prompts[0], prompts[0], prompts[2]] })
  ok(duplicate.status === 400, '중복·누락 지시서 거부')
  const invalid = await flowReq('prompt-flow/assist', { instruction: '필수 자리 삭제 시험', prompts })
  ok(invalid.status === 503, '필수 자리표시자를 지운 AI 수정안 거부')
  const threadRes = await flowReq('prompt-trials', {
    promptId: proposal.changes[0].id, promptLabel: '전체 흐름', instruction: '실전 팁으로 쉽게 알려줘',
    summary: proposal.summary, warnings: [], ...proposal.changes[0], changes: proposal.changes, prompts, focus: [], review: proposal.review, refinements: ['더 쉽게 해줘'],
    intent: '쿠션 추천', baseline: {}, trial: {}, evaluation: { score: 4, comment: '함께 좋아졌어요' },
  })
  const trialThread = await threadRes.json()
  ok(trialThread.steps?.[0]?.payload?.data?.review?.score === 86 && trialThread.steps?.[0]?.payload?.data?.review?.risks?.length && trialThread.steps?.[0]?.payload?.data?.refinements?.length === 1, 'AI 점검과 추가 요청 이력 함께 저장')
  ok(threadRes.status === 201 && trialThread.steps?.[0]?.payload?.data?.changes?.length === 3, '묶음과 기준선이 시험 쓰레드에 함께 저장')
  const applyBody = { changes: proposal.changes, prompts, summary: proposal.summary }
  await putSetting('llm-prompt-survey', prompts[0].text + '\n다른 운영자 수정')
  const conflict = await flowReq('prompt-flow', applyBody, 'PUT')
  ok(conflict.status === 400, '세 지시서 중 하나라도 바뀌면 쓰기 전에 충돌 차단')
  const afterConflict = await fetch(BFF + '/api/admin/prompts').then((r) => r.json())
  ok(afterConflict.prompts.find((p) => p.id === 'plan-products').configured === flowWire.prompts.find((p) => p.id === 'plan-products').configured, '충돌 시 다른 지시서도 미적용')
  await putSetting('llm-prompt-survey', prompts[0].text)
  const appliedFlow = await flowReq('threads/' + trialThread.id + '/prompt-trial/decision', { decision: 'applied' })
  ok(appliedFlow.status === 201, '저장된 시험에서 세 지시서 함께 적용')
  const appliedWire = await fetch(BFF + '/api/admin/prompts').then((r) => r.json())
  ok(proposal.changes.every((c) => appliedWire.prompts.find((p) => p.id === c.id).configured === c.proposedText), '실제 운영 설정 세 곳에 수정값 반영')
  ok((await flowReq('prompt-flow', applyBody, 'PUT')).status === 200, '동일 묶음 재시도 허용')
  const noAnswers = await sse('/api/admin/pipeline/dry-run', { stageId: 'plan-skeleton', intent: '쿠션 추천', survey: { ...drResult.survey, questions: [{ id: 'p1', kind: 'photo', question: '사진을 올려주세요', options: [], multi: false }] }, answers: [] }, plain)
  ok(Boolean(last(noAnswers, 'result')?.data?.skeleton), '사진만 있는 설문도 건너뛰고 계획까지 진행')
  }

  // ── 11. 계획 뼈대 재시도 — 실제 그래프(flow-run)에서 뼈대 호출만 529 를 4번 연속 받으면
  //    SDK 자동 재시도(maxRetries 3 = 4번 시도)가 다 실패하고, bff llm/retry.ts 가 2초 뒤 한 번 더 불러 5번째에 성공한다.
  //    상품·콘텐츠 호출은 건드리지 않는다(only: 'skeleton')
  console.log('11) 계획 뼈대 재시도')
  {
    const before = await llmCalls()
    const rs = await sse('/api/admin/pipeline/flow-run', { phase: 'survey', intent: '재시도 플로우 확인' }, plain)
    const rsResult = last(rs, 'result')?.data
    ok(Boolean(rsResult?.flowId), '재시도 플로우 — 설문 구간')
    await fetch(MOCK + '/internal/mock/llm-fail', { method: 'PUT', headers: plain, body: JSON.stringify({ count: 4, status: 529, only: 'skeleton' }) })
    const rp = await sse(
      '/api/admin/pipeline/flow-run',
      { phase: 'plan', flowId: rsResult.flowId, intent: '재시도 플로우 확인', survey: rsResult.survey, answers: [{ questionId: 'q1', choices: ['지성'] }] },
      plain,
    )
    const failState = await fetch(MOCK + '/internal/mock/llm-fail').then((r) => r.json())
    ok(!last(rp, 'error') && (last(rp, 'result')?.data?.page?.sections?.length ?? 0) >= 3, `뼈대 529 4연속 뒤 재시도로 계획 완성 (${last(rp, 'result')?.data?.page?.sections?.length}섹션)`)
    ok(failState.failed === 4 && failState.count === 0, `모의 실패 4회 소진 (failed ${failState.failed}, 남음 ${failState.count})`)
    ok(rp.some((e) => e.event === 'status' && /다시 만들고/.test(e.data?.message ?? '')), '재시도 안내 status 이벤트')
    const after = await llmCalls()
    const delta = (type) => after.filter((c) => c.type === type).length - before.filter((c) => c.type === type).length
    ok(delta('skeleton') === 1 && delta('products') === 1 && delta('contents') === 1, `성공 호출만 기록 — skeleton ${delta('skeleton')}·products ${delta('products')}·contents ${delta('contents')}`)
    ok(stageOf(rp.filter((e) => e.event === 'stage').map((e) => e.data), 'plan-skeleton', 'done'), '재시도 뒤 뼈대 stage done')
  }
} finally {
  shutdown()
}

console.log(failures === 0 ? '\n🎉 전부 통과' : `\n💥 실패 ${failures}건`)
process.exit(failures === 0 ? 0 : 1)
