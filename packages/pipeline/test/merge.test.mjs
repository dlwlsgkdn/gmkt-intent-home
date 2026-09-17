// 계획 병합 배정 회귀 — 2026-09 운영 쓰레드 2건(fixtures/plan-threads-2026-09.json)으로 상수를 맞춘 규칙이 유지되는지.
// 실행: npm run test --workspace=@ddak/pipeline (dist 빌드 뒤 node --test)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GeneratedIndexAllocator, PlanPlacer, composePlanSections, mergePlanSections, orderSkeletonSlots, planGroupsOf } from '../dist/guards/merge.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/plan-threads-2026-09.json', import.meta.url), 'utf8'))
const guide = (thread, title) => {
  const s = fixtures[thread].sections.find((x) => x.kind === 'guide' && x.title === title)
  assert.ok(s, `안내 없음: ${title}`)
  return s
}
const gen = (thread, kind, prefix) => {
  const s = fixtures[thread].sections.find((x) => x.kind === kind && x.title.startsWith(prefix))
  assert.ok(s, `검색 섹션 없음: ${kind} ${prefix}`)
  return s
}
const kinds = (sections) => sections.map((s) => (!s ? 'null' : s.kind === 'guide' ? `guide:${s.title}` : s.kind === 'products' || s.kind === 'contents' ? `${s.kind}:${s.title.slice(0, 3)}` : s.kind))

// 메이크업 쓰레드 — 뼈대가 상품 자리를 2단계에만 두고 콘텐츠 자리를 1·2단계에 뒀는데 검색은 상품 2·콘텐츠 2를 만든 경우
const makeupSkeleton = () => [
  fixtures.makeup.sections.find((s) => s.kind === 'look'),
  guide('makeup', '베이스 밀착 준비'),
  { kind: 'contents', title: '베이스 고르기 전에 볼 콘텐츠', reason: '복합성 피부의 지속력 있는 베이스 제형 비교·사용법 영상' },
  guide('makeup', '강렬한 포인트 완성'),
  { kind: 'products', title: '포인트 메이크업 제품', reason: '웜 라이트에 맞는 코랄 계열 섀도·틴트·글로스, 조명 아래서도 발색이 살아남는 것' },
  { kind: 'contents', title: '포인트 발색 튜토리얼', reason: '글리터·틴트 그라데이션 영상과 후기' },
  guide('makeup', '무너짐 방지와 수정'),
  fixtures.makeup.sections.find((s) => s.kind === 'steps'),
]
const makeupGenerated = () => [gen('makeup', 'products', '1단계'), gen('makeup', 'products', '2단계'), gen('makeup', 'contents', '1단계'), gen('makeup', 'contents', '2단계')]

// 토너패드 쓰레드 — 뼈대가 상품·콘텐츠 자리를 2단계에만 뒀는데 검색은 상품 2(준비·마무리)·콘텐츠 1을 만든 경우
const tonerSkeleton = () => [
  guide('toner', '내 얼굴 구역 나누기'),
  guide('toner', '패드 고르고 기본 루틴 세우기'),
  { kind: 'products', title: '복합성에 맞는 토너패드', reason: '진정·모공·수분을 나눠 잡을 수 있게 성격이 다른 패드' },
  { kind: 'contents', title: '토너패드 사용법·비교', reason: '닦토 순서와 제형 비교 영상·글' },
  guide('toner', '매일 닦고 남기기'),
  guide('toner', '주 2회 심화와 관리'),
  fixtures.toner.sections.find((s) => s.kind === 'steps'),
]
const tonerGenerated = () => [gen('toner', 'products', '1단계'), gen('toner', 'products', '2단계'), gen('toner', 'contents', '1단계')]

test('단계 묶음 — guide 가 묶음을 열고 바로 뒤 자리가 속하며, steps 는 연속 구간을 끊는다', () => {
  // planGroupsOf 는 받은 순서 그대로 본다 — 배정기·병합은 언제나 정규화된 뼈대(orderSkeletonSlots)를 넘긴다
  const groups = planGroupsOf(orderSkeletonSlots(makeupSkeleton()))
  assert.equal(groups.length, 4) // 앞머리 + 안내 3
  assert.equal(groups[0].index, -1)
  assert.deepEqual(groups[1].slots, { products: [], contents: [2] })
  assert.deepEqual(groups[1].insertAt, { products: 3, contents: 3 }) // 콘텐츠는 콘텐츠 자리 뒤, 상품은 구간 끝 (콘텐츠 → 상품)
  // 정규화(orderSkeletonSlots)로 2단계는 [콘텐츠 자리(4) → 상품 자리(5)] — 뼈대가 상품을 먼저 뒀어도 콘텐츠가 위
  assert.deepEqual(groups[2].slots, { products: [5], contents: [4] })
  assert.deepEqual(groups[2].insertAt, { products: 6, contents: 5 }) // 콘텐츠는 콘텐츠 자리 뒤(상품 자리 앞), 상품은 구간 끝
  assert.deepEqual(groups[3].insertAt, { products: 7, contents: 7 }) // steps 앞
})

test('메이크업 — 베이스 상품은 첫 단계(자리 없어도 끼움), 포인트 상품은 2단계 자리, 둘째 상품이 steps 뒤에 매달리지 않는다', () => {
  const { sections, pending } = composePlanSections(makeupSkeleton(), makeupGenerated())
  assert.deepEqual(kinds(sections), [
    'look',
    'guide:베이스 밀착 준비',
    'contents:1단계',
    'products:1단계',
    'guide:강렬한 포인트 완성',
    'contents:2단계',
    'products:2단계',
    'guide:무너짐 방지와 수정',
    'steps',
  ])
  assert.deepEqual(pending, [])
  assert.equal(mergePlanSections(makeupSkeleton(), makeupGenerated()).length, 9)
})

test('토너패드 — 패드 상품·콘텐츠는 2단계 자리, 마무리 보습 상품은 3단계(매일 닦고 남기기)에 끼운다', () => {
  const { sections } = composePlanSections(tonerSkeleton(), tonerGenerated())
  assert.deepEqual(kinds(sections), [
    'guide:내 얼굴 구역 나누기',
    'guide:패드 고르고 기본 루틴 세우기',
    'contents:1단계',
    'products:1단계',
    'guide:매일 닦고 남기기',
    'products:2단계',
    'guide:주 2회 심화와 관리',
    'steps',
  ])
})

test('스트리밍 인덱스 — 자리를 받은 섹션은 뼈대 인덱스, 끼워 넣을 섹션은 뼈대 길이 뒤 도착 순', () => {
  const skeleton = makeupSkeleton()
  const allocator = new GeneratedIndexAllocator(skeleton)
  const [p1, p2, c1, c2] = makeupGenerated()
  assert.equal(allocator.next(p1), skeleton.length) // 1단계엔 상품 자리가 없다 → 끝에 보였다가 result 에서 제자리
  assert.equal(allocator.next(c1), 2)
  // 정규화된 뼈대 인덱스 — 2단계는 [콘텐츠 자리 4 → 상품 자리 5]
  assert.equal(allocator.next(p2), 5)
  assert.equal(allocator.next(c2), 4)
  // 같은 순서로 부르면 배정기(PlanPlacer)는 언제나 같은 답 — 부분 스트림과 최종 병합이 어긋나지 않는다
  const a = new PlanPlacer(skeleton)
  const b = new PlanPlacer(skeleton)
  for (const s of [p1, c1, p2, c2]) assert.deepEqual(a.place(s), b.place(s))
})

test('대조할 말이 없으면 옛 규칙 — kind별 k번째 자리, 자리가 모자라면 아직 안 받은 다음 묶음', () => {
  const skeleton = [
    { kind: 'guide', title: 'A', subtitle: '', body: '' },
    { kind: 'products', title: '', reason: '' },
    { kind: 'guide', title: 'B', subtitle: '', body: '' },
    { kind: 'products', title: '', reason: '' },
    { kind: 'guide', title: 'C', subtitle: '', body: '' },
    { kind: 'steps', title: '순서', steps: ['x'] },
  ]
  const p = (n) => ({ kind: 'products', title: '', reason: '', products: [{ id: `p${n}`, name: `상품 ${n}`, brand: '', price: 1, tags: [], url: 'https://x/' + n }] })
  const { sections, pending } = composePlanSections(skeleton, [p(1), p(2), p(3)])
  assert.deepEqual(sections.map((s) => (s ? s.kind + (s.products ? s.products[0].id : '') : null)), ['guide', 'productsp1', 'guide', 'productsp2', 'guide', 'productsp3', 'steps'])
  assert.deepEqual(pending, [])
})

test('안 채워진 자리는 null + pending(미리보기), 최종 병합에서는 빠진다 — 안내 없는 뼈대는 앞머리 묶음에 순서대로', () => {
  const skeleton = [
    { kind: 'look', title: '룩', desc: '', tone: 'coral', points: [] },
    { kind: 'products', title: '이 룩에 쓸 상품', reason: '코랄 기준' },
    { kind: 'contents', title: '참고', reason: '' },
    { kind: 'steps', title: '순서', steps: ['x'] },
  ]
  const p1 = { kind: 'products', title: '코랄 립·치크', reason: '', products: [{ id: 'a', name: 'A', brand: '', price: 1, tags: [], url: 'https://x/a' }] }
  const p2 = { kind: 'products', title: '베이스', reason: '', products: [{ id: 'b', name: 'B', brand: '', price: 1, tags: [], url: 'https://x/b' }] }
  const { sections, pending } = composePlanSections(skeleton, [p1, p2])
  // 정규화로 콘텐츠 자리가 상품 자리 앞으로 온다 — 안 채워진 콘텐츠 자리(null)가 look 바로 뒤
  assert.deepEqual(sections.map((s) => (s ? s.kind : null)), ['look', null, 'products', 'products', 'steps'])
  assert.deepEqual(pending, [1])
  assert.deepEqual(mergePlanSections(skeleton, [p1, p2]).map((s) => s.kind), ['look', 'products', 'products', 'steps'])
})

// 성분 비교표·주의 성분 (v26) — 성분이 기준인 의도에서 뼈대가 [안내 → compare → caution → 상품 자리] 로 두는 단계
const ingredientSkeleton = () => [
  { kind: 'guide', title: '자극 원인 짚기', subtitle: '면도 뒤 붉어짐을 부르는 성분부터', body: '면도 직후 피부 장벽이 약해져 있어요.' },
  {
    kind: 'compare',
    title: '기존 워시와 추천 기준을 성분으로 비교했어요',
    alt: { badge: '기존 제품', name: '일반 올인원 워시', short: '' },
    pick: { badge: '추천 기준', name: '약산성 저자극 쉐이빙 젤', short: '쉐이빙 젤' },
    rows: [
      { ingredient: 'SLS/SLES', alt: '있음', pick: '없음', risk: '높음' },
      { ingredient: '인공향료', alt: '있음', pick: '없음', risk: '중간' },
      { ingredient: '에탄올', alt: '소량', pick: '없음', risk: '낮음' },
    ],
  },
  {
    kind: 'caution',
    title: '주의해서 볼 성분',
    desc: '',
    items: [
      { name: 'SLS (Sodium Lauryl Sulfate)', note: '세정력이 강해 면도 직후엔 자극이 될 수 있어요.' },
      { name: '인공향료 (Fragrance)', note: '민감해진 피부에 자극이 될 수 있어요.' },
    ],
  },
  { kind: 'products', title: '저자극 쉐이빙 젤·폼 고르기', reason: '약산성·무향·SLS 프리 기준으로 고를 거예요.' },
  { kind: 'guide', title: '면도 뒤 진정과 보습', subtitle: '붉어진 피부를 빨리 가라앉히는 마무리', body: '면도 직후엔 알코올 없는 진정 제품으로 마무리해요.' },
  { kind: 'steps', title: '사용 순서', steps: ['미온수로 적시기', '젤을 얇게 펴 바르기'] },
]

test('성분 비교표·주의 성분 — 단계 본문이라 연속 구간을 끊지 않고, 자리 없는 상품·콘텐츠는 그 뒤에 선다', () => {
  const groups = planGroupsOf(ingredientSkeleton())
  assert.equal(groups.length, 3) // 앞머리 + 안내 2
  assert.deepEqual(groups[1].slots, { products: [3], contents: [] })
  assert.deepEqual(groups[1].insertAt, { products: 4, contents: 3 }) // 상품은 상품 자리 뒤(다음 안내 앞), 콘텐츠는 비교표·주의 성분 뒤·상품 자리 앞
  assert.ok(groups[1].text.includes('쉐이빙젤') && groups[1].text.includes('slssles'), '성분·제품 유형이 대조 텍스트에 실린다')
  const products = {
    kind: 'products',
    title: '약산성 저자극 쉐이빙 젤 추천',
    reason: '무향·SLS 프리 기준으로 골랐어요.',
    products: [{ id: 'a', name: 'A', brand: '', price: 1, tags: [], url: 'https://x/a' }],
  }
  const contents = {
    kind: 'contents',
    title: '면도 자극 줄이는 쉐이빙 젤 사용법 영상',
    reason: '붉어짐을 줄이는 면도 순서가 나온 영상이에요.',
    items: [{ type: 'video', source: '유튜브', title: 'T', url: 'https://youtu.be/x' }],
  }
  const { sections, pending } = composePlanSections(ingredientSkeleton(), [products, contents])
  assert.deepEqual(
    sections.map((s) => s && s.kind),
    ['guide', 'compare', 'caution', 'contents', 'products', 'guide', 'steps'],
  )
  assert.deepEqual(pending, [])
})

test('성분 비교표·주의 성분 — 와이어 변환에서 빈 short·desc 가 떨어지고 행·항목은 그대로', () => {
  const { sections } = composePlanSections(ingredientSkeleton(), [])
  const compare = sections[1]
  assert.equal(compare.kind, 'compare')
  assert.equal(compare.alt.short, undefined)
  assert.equal(compare.pick.short, '쉐이빙 젤')
  assert.deepEqual(compare.rows[0], { ingredient: 'SLS/SLES', alt: '있음', pick: '없음', risk: '높음' })
  const caution = sections[2]
  assert.equal(caution.kind, 'caution')
  assert.equal(caution.desc, undefined)
  assert.equal(caution.items.length, 2)
  assert.deepEqual(pendingOf(sections), [3]) // 상품 자리는 비어 있다
})
const pendingOf = (sections) => sections.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0)

test('orderSkeletonSlots — 연속 구간 안에서 콘텐츠 자리가 상품 자리보다 앞, 텍스트 섹션 제자리, 멱등', () => {
  const skeleton = [
    { kind: 'guide', title: 'A', subtitle: '', body: '' },
    { kind: 'products', title: 'pA', reason: '' },
    { kind: 'contents', title: 'cA', reason: '' },
    { kind: 'guide', title: 'B', subtitle: '', body: '' },
    { kind: 'compare', title: '비교', alt: { badge: '', name: 'x', short: '' }, pick: { badge: '', name: 'y', short: '' }, rows: [] },
    { kind: 'products', title: 'pB1', reason: '' },
    { kind: 'products', title: 'pB2', reason: '' },
    { kind: 'contents', title: 'cB', reason: '' },
    { kind: 'steps', title: '순서', steps: ['x'] },
  ]
  const once = orderSkeletonSlots(skeleton)
  assert.deepEqual(once.map((s) => s.title), ['A', 'cA', 'pA', 'B', '비교', 'cB', 'pB1', 'pB2', '순서'])
  assert.deepEqual(orderSkeletonSlots(once), once)
})
