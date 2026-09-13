// 룩 사양(LookSpec) 규칙 — 설문 앞머리(범위 s1 → 사진 p1) 조립, 사양 정규화·범위 필터, 포인트 파생, 정밀 렌더 지시문 분기.
// 실행: npm run test --workspace=@ddak/pipeline (dist 빌드 뒤 node --test)
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSurveyPage, lookScopeFromAnswer, lookScopeOfAnswers, surveyStreamHandlers } from '../dist/survey-wire.js'
import { lookPointsOf, lookSpecSummary, sanitizeLookSpec, skeletonSectionWire } from '../dist/look.js'
import { buildLookRenderPrompt } from '../dist/image-edit.js'

const baseSpec = {
  intensity: 'natural',
  lip: { color: '#E8705C', finish: 'tint', technique: 'gradient', note: '안쪽부터 번지듯' },
  cheek: { color: '#f2917e', placement: 'apples', strength: 'light', note: '볼 앞쪽에만' },
  eye: { shadow: ['#e6c3ad', 'pink'], liner: 'none', lashes: 'natural', brow: 'natural', note: '섀도 한 겹' },
  base: { finish: 'dewy', coverage: 'light', contour: false, highlight: true, note: '얇게' },
}

test('사진을 받는 설문은 [범위 s1, 사진 p1, q1…] 순 — 사진이 없으면 앞머리 자체가 없다', () => {
  const gen = { intro: '인트로', photoQuestion: '정면 사진을 올려주세요', questions: [{ question: '상황은?', options: [{ label: '데이트', desc: '저녁' }, { label: '출근', desc: '아침' }], multi: false }] }
  const page = buildSurveyPage(gen)
  assert.deepEqual(page.questions.map((q) => q.id), ['s1', 'p1', 'q1'])
  assert.equal(page.questions[0].kind, 'choice')
  assert.equal(page.questions[0].options.length, 3)
  assert.equal(page.questions[1].kind, 'photo')
  const noPhoto = buildSurveyPage({ ...gen, photoQuestion: '' })
  assert.deepEqual(noPhoto.questions.map((q) => q.id), ['q1'])
})

test('스트리밍 자리도 같은 규칙 — 머리 필드가 오면 s1(0)·p1(1), 선택지 질문은 두 칸 밀린다', () => {
  const got = []
  const h = surveyStreamHandlers({ onQuestion: (q, i) => got.push([i, q.id]) })
  h.onHead('photoQuestion', '사진을 올려주세요')
  h.onElement({ question: '상황은?', options: [{ label: '데이트', desc: '저녁' }, { label: '출근', desc: '아침' }], multi: false }, 0)
  assert.deepEqual(got, [[0, 's1'], [1, 'p1'], [2, 'q1']])
})

test('범위 답 → scope: 제목 대조, 모르는 값·없음은 makeup', () => {
  assert.equal(lookScopeFromAnswer('메이크업만'), 'makeup')
  assert.equal(lookScopeFromAnswer('메이크업 + 헤어|헤어스타일·컬러까지 제안받을게요'), 'hair')
  assert.equal(lookScopeFromAnswer('메이크업 + 헤어 + 옷차림'), 'outfit')
  assert.equal(lookScopeFromAnswer(undefined), 'makeup')
  assert.equal(lookScopeOfAnswers([{ questionId: 's1', choices: ['메이크업 + 헤어'] }]), 'hair')
  assert.equal(lookScopeOfAnswers([{ questionId: 'q1', choices: ['데이트'] }]), 'makeup')
})

test('sanitizeLookSpec — hex 정규화·깨진 색은 tone 기본색·범위 밖 부위 제거·범위 안 빈 부위는 keep', () => {
  const s = sanitizeLookSpec({ ...baseSpec, scope: 'hair', outfit: { top: 'tee', color: '#ffffff', fit: 'regular', neckline: 'crew', note: '흰 티' } }, 'coral')
  assert.equal(s.scope, 'hair')
  assert.equal(s.lip.color, '#e8705c')
  assert.deepEqual(s.eye.shadow, ['#e6c3ad'])
  assert.equal(s.outfit, undefined, '범위 hair 에서는 outfit 을 뗀다')
  assert.deepEqual(s.hair, { style: 'keep', length: 'keep', color: 'keep', bangs: 'keep', note: '' }, '범위 안인데 비웠으면 keep 사양')
  const t = sanitizeLookSpec({ ...baseSpec, lip: { ...baseSpec.lip, color: 'coral' } }, 'rose')
  assert.equal(t.scope, 'makeup')
  assert.equal(t.lip.color, '#d94b73')
  assert.equal(t.hair, undefined)
})

test('lookPointsOf — 부위별 note 를 "라벨 — note" 로, 헤어·옷은 범위 안일 때만', () => {
  const s = sanitizeLookSpec({ ...baseSpec, scope: 'outfit', hair: { style: 'wavy', length: 'keep', color: 'keep', bangs: 'keep', note: '웨이브' }, outfit: { top: 'knit', color: '#c8b6a6', fit: 'oversized', neckline: 'crew', note: '베이지 니트' } }, 'coral')
  assert.deepEqual(lookPointsOf(s), ['립 — 안쪽부터 번지듯', '치크 — 볼 앞쪽에만', '눈 — 섀도 한 겹', '베이스 — 얇게', '헤어 — 웨이브', '옷 — 베이지 니트'])
  assert.match(lookSpecSummary(s), /범위 outfit.*헤어 wavy.*옷 knit/)
})

test('skeletonSectionWire — look 은 정규화된 spec + 파생 points, 자리 kind 는 null', () => {
  const wire = skeletonSectionWire({ kind: 'look', title: '룩', desc: '이유', tone: 'coral', spec: { ...baseSpec, scope: 'makeup' } })
  assert.equal(wire.kind, 'look')
  assert.equal(wire.points.length, 4)
  assert.equal(wire.spec.lip.color, '#e8705c')
  assert.equal(skeletonSectionWire({ kind: 'products', title: '자리', reason: '기준' }), null)
})

test('buildLookRenderPrompt — 범위별로 헤어·옷 지시가 실리고 보존 목록에서 빠진다', () => {
  const makeup = buildLookRenderPrompt({ tone: 'coral', spec: sanitizeLookSpec({ ...baseSpec, scope: 'makeup' }, 'coral') })
  assert.match(makeup, /Keep exactly:[^\n]*hair, clothing, pose/)
  assert.doesNotMatch(makeup, /Styling beyond makeup/)
  const hair = buildLookRenderPrompt({ tone: 'coral', spec: sanitizeLookSpec({ ...baseSpec, scope: 'hair', hair: { style: 'wavy', length: 'medium', color: '#5a3a2a', bangs: 'see-through', note: '' } }, 'coral') })
  assert.match(hair, /- Hair: restyle the hair to soft loose waves, medium \(shoulder-length\) length, hair color #5a3a2a, light see-through bangs/)
  assert.match(hair, /Keep exactly:[^\n]*clothing, pose/)
  assert.doesNotMatch(hair, /Keep exactly:[^\n]*hair,/)
  const outfit = buildLookRenderPrompt({ tone: 'coral', spec: sanitizeLookSpec({ ...baseSpec, scope: 'outfit', hair: { style: 'keep', length: 'keep', color: 'keep', bangs: 'keep', note: '' }, outfit: { top: 'blouse', color: '#f5efe6', fit: 'fitted', neckline: 'v', note: '' } }, 'coral') })
  assert.match(outfit, /- Outfit: change only the clothing on the upper body to a fitted silhouette blouse in #f5efe6 with a V-neckline/)
  assert.match(outfit, /Keep exactly:[^\n]*hair, pose/, '헤어는 전부 keep 이라 보존 목록에 남는다')
  assert.doesNotMatch(outfit, /Keep exactly:[^\n]*clothing/)
  const legacy = buildLookRenderPrompt({ tone: 'coral', points: ['립 — 코랄 틴트'] })
  assert.match(legacy, /full-glam/)
})
