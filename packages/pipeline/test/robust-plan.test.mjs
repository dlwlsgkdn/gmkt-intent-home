// 상품·콘텐츠가 웬만해선 나오도록 (2026-09-17): 5c 빈 결과 재시도 가변부(prompts.ts CONTENTS_RETRY_HINT)와
// 5b 실패 시 뼈대 자리 카탈로그 폴백(guards/grounding.ts catalogFallbackSections).
// 실행: npm run test --workspace=@ddak/pipeline
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTENTS_RETRY_HINT, PLAN_CONTENTS_SYSTEM, buildPlanContentsRequest, catalogFallbackSections, assembleLedger, planQualityOf, isInfoDrop, slotOverlap, CATALOG } from '../dist/index.js'

const survey = { intro: '', questions: [{ id: 'q1', question: '고민', options: ['각질|', '당김|'], multi: false }] }
const answers = [{ questionId: 'q1', choices: ['각질'] }]

test('콘텐츠 가변부 — retry 일 때만 검색 전략 변경 힌트가 끝에 붙는다 (일반·피드백 재생성 둘 다)', () => {
  const plain = buildPlanContentsRequest('저녁 루틴', survey, answers)
  assert.ok(!plain.includes(CONTENTS_RETRY_HINT) && plain.endsWith('참고 콘텐츠 섹션을 만들어 주세요.'))
  const retry = buildPlanContentsRequest('저녁 루틴', survey, answers, undefined, undefined, null, { retry: true })
  assert.ok(retry.endsWith(CONTENTS_RETRY_HINT) && retry.includes('직전 시도에서는'))
  const revision = { feedback: { stage: 'plan', review: { score: 2, feedback: '영상이 별로' }, components: [] }, prevPlan: null }
  const revised = buildPlanContentsRequest('저녁 루틴', survey, answers, undefined, revision, null, { retry: true })
  assert.ok(revised.includes('피드백을 반영해') && revised.endsWith(CONTENTS_RETRY_HINT))
})

test('콘텐츠 시스템 프롬프트 v27 — 검색 3~4회·검색어 중복 금지·느슨한 확인 기준, 모의 서버 판별 마커 유지', () => {
  assert.ok(PLAN_CONTENTS_SYSTEM.includes('웹 검색(web_search)을 3~4회'))
  assert.ok(PLAN_CONTENTS_SYSTEM.includes('전부 서로 달라야 한다'))
  assert.ok(PLAN_CONTENTS_SYSTEM.includes('확인의 기준은 느슨하다'))
  assert.ok(PLAN_CONTENTS_SYSTEM.includes('참고 콘텐츠 수집'))
})

const slots = [
  { kind: 'guide', title: '세안', subtitle: '순하게', body: '약산성으로' },
  { kind: 'products', title: '저녁 세안용 클렌저·토너', reason: '민감성이라 약산성' },
  { kind: 'guide', title: '보습', subtitle: '장벽', body: '크림으로' },
  { kind: 'products', title: '장벽 크림', reason: '진정' },
  { kind: 'steps', title: '순서', steps: ['세안', '토너'] },
]
const byId = (id) => CATALOG.find((p) => p.id === id)

test('카탈로그 폴백 — 자리 텍스트(제목+기준)와 태그·이름이 겹치는 상품만, 겹침이 고민·목적 근거가 되어 원장 없이도(legacy) 60% 를 넘는다', () => {
  const { sections, note } = catalogFallbackSections(slots)
  assert.ok(note?.code === 'catalog-fallback', JSON.stringify(note))
  assert.equal(sections.length, 2)
  const [cleanse, cream] = sections
  assert.equal(cleanse.title, '저녁 세안용 클렌저·토너')
  // 클렌저·토너 자리 = 클렌저(p-010)·토너(p-001)·토너패드(p-002) 계열만, 크림·선크림·쿠션은 없음
  const cleanseTags = cleanse.products.flatMap((p) => p.tags)
  assert.ok(cleanse.products.every((p) => slotOverlap(p, '저녁 세안용 클렌저·토너').length > 0), cleanse.products.map((p) => p.name).join(','))
  assert.ok(!cleanseTags.includes('크림') && !cleanseTags.includes('선크림') && !cleanseTags.includes('쿠션'))
  // 크림 자리 = 크림 태그 상품만(p-006·p-007), 클렌저는 없음
  assert.ok(cream.products.length >= 1 && cream.products.every((p) => p.tags.includes('크림')), cream.products.map((p) => p.name).join(','))
  assert.ok(cream.products.every((p) => !p.tags.includes('클렌저')))
  // 근거가 매칭율 항목에 남는다
  const concern = cleanse.products[0].match.factors.find((f) => f.key === 'concern')
  assert.ok(concern.score >= 75 && /상품 자리 기준과 겹치는 태그/.test(concern.note), JSON.stringify(concern))
  assert.ok(sections.flatMap((s) => s.products).every((p) => p.match.score >= 60))
  assert.ok(sections.every((s) => s.products.length <= 3))
})

test('카탈로그 폴백 — 원장 사실이 겹치면 점수가 더 오르고 순서에 반영, 자리 사이 중복 없음', () => {
  const ledger = assembleLedger({ profile: [{ label: '피부타입', value: '민감성' }], survey, answers, trendKeywords: [] })
  const { sections } = catalogFallbackSections(slots, { ledger })
  const all = sections.flatMap((s) => s.products)
  assert.equal(new Set(all.map((p) => p.id)).size, all.length, '자리 사이 중복 없음')
  // 민감성 태그를 가진 클렌저(p-010)·토너(p-001)가 클렌저·토너 자리 앞줄(원장 없는 폴백보다 점수가 오른다)
  const top = sections[0].products.slice(0, 2).map((p) => p.id)
  assert.ok(top.includes('p-010') && top.includes('p-001'), sections[0].products.map((p) => `${p.id}:${p.match.score}`).join(','))
  const plainScore = catalogFallbackSections(slots).sections[0].products.find((p) => p.id === 'p-010').match.score
  assert.ok(sections[0].products.find((p) => p.id === 'p-010').match.score > plainScore)
  // 기준(reason)의 '민감성' 만으로는 크림이 클렌저 자리에 들어오지 않는다
  assert.ok(sections[0].products.every((p) => !p.tags.includes('크림')), sections[0].products.map((p) => p.name).join(','))
})

test('카탈로그 폴백 — 자리와 겹치는 상품이 없으면 그 자리는 비우고, 상품 자리가 없으면 비운다, 담은 상품은 제외', () => {
  const noMatch = [{ kind: 'products', title: '향수 고르기', reason: '데이트용 잔향' }]
  assert.deepEqual(catalogFallbackSections(noMatch), { sections: [], note: null })
  assert.deepEqual(catalogFallbackSections(slots.filter((s) => s.kind !== 'products')), { sections: [], note: null })
  const ledger = assembleLedger({ profile: [], survey, answers, trendKeywords: [], selectionSignals: [{ action: 'cartAdd', name: byId('p-010').name }] })
  const names = catalogFallbackSections(slots, { ledger }).sections.flatMap((s) => s.products.map((p) => p.name))
  assert.ok(!names.includes(byId('p-010').name), `담은 상품 제외: ${names.join(',')}`)
})

test('정보 기록(contents-empty-retry·catalog-fallback)은 품질 KPI drops 에서 빠진다', () => {
  const page = { headline: '', summary: '', sections: [] }
  const dropLog = [{ code: 'contents-empty-retry', message: '' }, { code: 'catalog-fallback', message: '' }, { code: 'stale-content', message: '' }]
  assert.equal(planQualityOf(page, dropLog).drops, 1)
  assert.deepEqual(dropLog.map(isInfoDrop), [true, true, false])
})
