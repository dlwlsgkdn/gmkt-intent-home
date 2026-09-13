// 계획 병합 배정 회귀 — 2026-09 운영 쓰레드 2건(fixtures/plan-threads-2026-09.json)으로 상수를 맞춘 규칙이 유지되는지.
// 실행: npm run test --workspace=@ddak/pipeline (dist 빌드 뒤 node --test)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GeneratedIndexAllocator, PlanPlacer, composePlanSections, mergePlanSections, planGroupsOf } from '../dist/guards/merge.js'

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
  const groups = planGroupsOf(makeupSkeleton())
  assert.equal(groups.length, 4) // 앞머리 + 안내 3
  assert.equal(groups[0].index, -1)
  assert.deepEqual(groups[1].slots, { products: [], contents: [2] })
  assert.deepEqual(groups[1].insertAt, { products: 2, contents: 3 }) // 상품은 안내 바로 뒤, 콘텐츠는 구간 끝
  assert.deepEqual(groups[2].slots, { products: [4], contents: [5] })
  assert.deepEqual(groups[3].insertAt, { products: 7, contents: 7 }) // steps 앞
})

test('메이크업 — 베이스 상품은 첫 단계(자리 없어도 끼움), 포인트 상품은 2단계 자리, 둘째 상품이 steps 뒤에 매달리지 않는다', () => {
  const { sections, pending } = composePlanSections(makeupSkeleton(), makeupGenerated())
  assert.deepEqual(kinds(sections), [
    'look',
    'guide:베이스 밀착 준비',
    'products:1단계',
    'contents:1단계',
    'guide:강렬한 포인트 완성',
    'products:2단계',
    'contents:2단계',
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
    'products:1단계',
    'contents:1단계',
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
  assert.equal(allocator.next(p2), 4)
  assert.equal(allocator.next(c2), 5)
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
  assert.deepEqual(sections.map((s) => (s ? s.kind : null)), ['look', 'products', 'products', null, 'steps'])
  assert.deepEqual(pending, [3])
  assert.deepEqual(mergePlanSections(skeleton, [p1, p2]).map((s) => s.kind), ['look', 'products', 'products', 'steps'])
})
