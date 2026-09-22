// 뼈대 호출 스키마 갈래 (schemas.ts planSkeletonGenFor · survey-wire.ts hasPhotoAnswer) — 2026-09-17.
// 구조화 출력 문법은 크기 상한이 있어(API 400 「The compiled grammar is too large」) 7종 합집합을 통째로 보내면
// 뼈대 호출이 즉시 거절된다. 요청마다 look 갈래(사진 있음) | compare·caution 갈래(사진 없음) 하나만 실린다.
// 실행: npm run test --workspace=@ddak/pipeline
import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  PlanSkeletonGen,
  PlanSkeletonPhotoGen,
  PlanSkeletonPlainGen,
  PlanSkeletonSectionGen,
  planSkeletonGenFor,
  hasPhotoAnswer,
  buildPlanSkeletonRequest,
} from '../dist/index.js'

const kindsOf = (union) => union.options.map((o) => o.shape.kind.value)
const sectionsUnion = (schema) => schema.shape.sections.element

test('갈래 구성원 — 사진 갈래는 look, 평문 갈래는 compare·caution, 합집합은 7종 전부', () => {
  assert.deepEqual(kindsOf(sectionsUnion(PlanSkeletonPhotoGen)), ['guide', 'look', 'products', 'contents', 'steps'])
  assert.deepEqual(kindsOf(sectionsUnion(PlanSkeletonPlainGen)), ['guide', 'compare', 'caution', 'products', 'contents', 'steps'])
  assert.deepEqual(kindsOf(PlanSkeletonSectionGen), ['guide', 'look', 'compare', 'caution', 'products', 'contents', 'steps'])
  // 두 갈래의 합이 정확히 합집합이다 — 새 섹션 종류를 더하면서 갈래에 빠뜨리면 여기서 걸린다
  const both = new Set([...kindsOf(sectionsUnion(PlanSkeletonPhotoGen)), ...kindsOf(sectionsUnion(PlanSkeletonPlainGen))])
  assert.deepEqual([...both].sort(), kindsOf(PlanSkeletonSectionGen).sort())
})

test('planSkeletonGenFor — 사진 여부로 고른다', () => {
  assert.equal(planSkeletonGenFor({ photo: true }), PlanSkeletonPhotoGen)
  assert.equal(planSkeletonGenFor({ photo: false }), PlanSkeletonPlainGen)
})

test('갈래 문법 크기 — 어느 갈래도 전체 합집합보다 작고, 평문 갈래는 사진 갈래보다 작다 (JSON 스키마 객체 수 기준)', () => {
  const objectCount = (schema) => (JSON.stringify(z.toJSONSchema(schema, { reused: 'ref' })).match(/"properties"/g) || []).length
  const all = objectCount(PlanSkeletonGen)
  const photo = objectCount(PlanSkeletonPhotoGen)
  const plain = objectCount(PlanSkeletonPlainGen)
  assert.ok(photo < all && plain < all, `photo=${photo} plain=${plain} all=${all}`)
  assert.ok(plain < photo, `plain=${plain} photo=${photo}`)
})

test('갈래 출력은 합집합 타입에 그대로 대입된다 — 각 갈래가 받는 페이지를 합집합도 받는다', () => {
  const base = { headline: '계획', summary: '요약' }
  const guide = { kind: 'guide', title: '준비', subtitle: '유분 정돈', body: '지성 피부라' }
  const steps = { kind: 'steps', title: '순서', steps: ['세안', '토너'] }
  const compare = {
    kind: 'compare',
    title: '비교',
    alt: { badge: '기존 제품', name: '일반 워시', short: '' },
    pick: { badge: '추천 기준', name: '약산성 젤', short: '젤' },
    rows: [
      { ingredient: 'SLS', alt: '있음', pick: '없음', risk: '높음' },
      { ingredient: '향료', alt: '있음', pick: '없음', risk: '중간' },
      { ingredient: '알코올', alt: '소량', pick: '없음', risk: '중간' },
    ],
  }
  const caution = { kind: 'caution', title: '주의', desc: '', items: [{ name: '향료', note: '자극' }, { name: 'SLS', note: '건조' }] }
  const plain = PlanSkeletonPlainGen.parse({ ...base, sections: [guide, compare, caution, steps] })
  assert.ok(PlanSkeletonGen.safeParse(plain).success)
  // 평문 갈래는 look 을, 사진 갈래는 compare 를 판별자(kind)에서 거부한다
  const look = { kind: 'look', title: '룩', desc: '이유', tone: 'coral', spec: {} }
  const plainLook = PlanSkeletonPlainGen.safeParse({ ...base, sections: [guide, look] })
  assert.equal(plainLook.success, false)
  assert.deepEqual(plainLook.error.issues[0].path, ['sections', 1, 'kind'])
  const photoCompare = PlanSkeletonPhotoGen.safeParse({ ...base, sections: [guide, compare] })
  assert.equal(photoCompare.success, false)
  assert.deepEqual(photoCompare.error.issues[0].path, ['sections', 1, 'kind'])
})

test('hasPhotoAnswer — 사진 질문(kind=photo)에 답이 있어야 참, 질문 없음·답 없음은 거짓', () => {
  const survey = {
    intro: '',
    questions: [
      { id: 's1', question: '어디까지', options: ['메이크업만|', '메이크업 + 헤어|'], multi: false },
      { id: 'p1', question: '사진', kind: 'photo', options: [], multi: false },
      { id: 'q1', question: '자리', options: ['출근|', '데이트|'], multi: false },
    ],
  }
  assert.equal(hasPhotoAnswer(survey, [{ questionId: 'p1', choices: ['사진 제출됨'] }, { questionId: 'q1', choices: ['출근'] }]), true)
  assert.equal(hasPhotoAnswer(survey, [{ questionId: 'q1', choices: ['출근'] }]), false)
  assert.equal(hasPhotoAnswer({ intro: '', questions: survey.questions.filter((q) => q.kind !== 'photo') }, [{ questionId: 'p1', choices: ['사진 제출됨'] }]), false)
  assert.equal(hasPhotoAnswer(survey, []), false)
  assert.equal(hasPhotoAnswer(null, [{ questionId: 'p1', choices: ['사진 제출됨'] }]), false)
})

test('뼈대 가변부 — 사진 있는 요청에만 compare·caution 금지 한 줄이 붙는다 (look 갈래 스키마와 프롬프트를 맞춘다)', () => {
  const survey = {
    intro: '',
    questions: [
      { id: 'p1', question: '사진', kind: 'photo', options: [], multi: false },
      { id: 'q1', question: '자리', options: ['출근|', '데이트|'], multi: false },
    ],
  }
  const note = '성분 비교표(compare)·주의 성분(caution) 섹션을 만들지 않습니다'
  const withPhoto = buildPlanSkeletonRequest('결혼식 메이크업', survey, [{ questionId: 'p1', choices: ['사진 제출됨'] }, { questionId: 'q1', choices: ['출근'] }])
  assert.ok(withPhoto.includes('얼굴 사진을 올렸습니다') && withPhoto.endsWith(`${note} — 성분 기준이 필요하면 단계 안내(guide) 본문에 녹입니다.`), withPhoto.slice(-200))
  const noPhoto = buildPlanSkeletonRequest('면도 자극 케어', survey, [{ questionId: 'q1', choices: ['출근'] }])
  assert.ok(!noPhoto.includes(note) && noPhoto.endsWith('뼈대를 만들어 주세요.'))
  // 피드백 재생성 요청에도 같은 규칙
  const revision = { feedback: { stage: 'plan', review: { score: 2, feedback: '순서가 어색해요' }, components: [] }, prevPlan: null }
  const revised = buildPlanSkeletonRequest('결혼식 메이크업', survey, [{ questionId: 'p1', choices: ['사진 제출됨'] }], undefined, revision)
  assert.ok(revised.includes('직전 계획에 대한 사용자 피드백') && revised.includes(note))
})
