import test from 'node:test'
import assert from 'node:assert/strict'
import mapping from '../dist/mapping.js'

const { toUnit } = mapping

/* 실제 문서에서 추린 모양 — 필드 이름·중첩 구조를 바꾸지 말 것 */
const DOC = {
  product_id: 'A000000253102',
  name: '센카 퍼펙트 휩 페이셜 워시 FA 120g',
  brand: '센카',
  price: 18200,
  image_url: 'https://image.oliveyoung.co.kr/x.jpg',
  options: [],
  formulation: '폼',
  ingredient_tags: ['판테놀'],
  sub_type: '클렌징폼',
  inferred_category: '클렌징',
  body_part: '얼굴전체',
  skin_types: ['모든피부'],
  skin_types_primary: '모든피부',
  concerns: ['수분부족', '모공부각'],
  concerns_primary: '수분부족',
  results: ['보송'],
  results_primary: null,
  conditions: ['데일리'],
  conditions_primary: null,
  confidence: 'low',
  rationale: '이미지에서 폼 제형 확인',
  usage_method: '적당량을 덜어 거품을 내 사용',
  product_info: { '제품 주요 사양': '약산성 아미노산 세안제' },
  review_ai_summary: { features: [{ title: '풍성한 거품', description: '거품이 조밀하다' }] },
  review_stats: { count: 2371, avg_rating: 4.8 },
  review_status: 'reviewed',
}

test('toUnit — 7필드와 대표(★)를 화면 형태로 옮긴다', () => {
  const unit = toUnit(DOC)
  assert.equal(unit.id, 'A000000253102')
  assert.deepEqual(unit.fields.category.selected, ['클렌징'])
  assert.deepEqual(unit.fields.concern.selected, ['수분부족', '모공부각'])
  assert.equal(unit.fields.concern.rep, '수분부족')
  /* 단일 선택은 대표가 자동으로 그 값이다 (화면의 fd() 규칙과 같다) */
  assert.equal(unit.fields.result.rep, '보송')
  assert.equal(unit.fields.area.selected.length, 1)
})

test('toUnit — 확신도는 문서 단위 등급을 0~100으로 환산한다', () => {
  const unit = toUnit(DOC)
  assert.equal(unit.confidenceLevel, 'low')
  assert.equal(unit.confidence, 45)
  assert.equal(unit.rationale, '이미지에서 폼 제형 확인')
})

test('toUnit — review_status가 화면 결정으로 바뀐다', () => {
  assert.equal(toUnit(DOC).decision, 'approved')
  assert.equal(toUnit({ ...DOC, review_status: 'needs_fix' }).decision, 'rejected')
  assert.equal(toUnit({ ...DOC, review_status: 'auto_ok' }).decision, null)
  assert.equal(toUnit({ ...DOC, review_status: null }).decision, null)
})

test('toUnit — 검토 이력이 없으면 필드는 미검토, reviewed면 완료로 연다', () => {
  assert.equal(toUnit({ ...DOC, review_status: null }).fields.category.status, 'unreviewed')
  assert.equal(toUnit(DOC).fields.category.status, 'done')
  /* review_meta가 있으면 그쪽이 이긴다 */
  const withMeta = { ...DOC, review_meta: { fieldStatus: { category: 'fix' }, fieldOrigin: { category: 'human' } } }
  assert.equal(toUnit(withMeta).fields.category.status, 'fix')
  assert.equal(toUnit(withMeta).fields.category.origin, 'human')
})

test('toUnit — 상품 정보와 리뷰 요약을 화면 문구로 만든다', () => {
  const unit = toUnit(DOC)
  assert.equal(unit.copy, '약산성 아미노산 세안제')
  assert.match(unit.review, /풍성한 거품/)
  assert.match(unit.review, /2,371건/)
  assert.equal(unit.option, '단일 옵션')
  assert.deepEqual(unit.catalogTags, ['클렌징폼', '폼', '판테놀'])
})

test('toUnit — aiFields는 사람이 손대기 전 값이다', () => {
  const edited = {
    ...DOC,
    concerns: ['트러블'],
    review_meta: { aiOriginal: { concern: { selected: ['수분부족', '모공부각'], rep: '수분부족' } } },
  }
  const unit = toUnit(edited)
  assert.deepEqual(unit.fields.concern.selected, ['트러블'])
  assert.deepEqual(unit.aiFields.concern.selected, ['수분부족', '모공부각'])
  /* 스냅샷이 없으면 현재 값이 곧 AI 원본이다 */
  assert.deepEqual(toUnit(DOC).aiFields.concern.selected, ['수분부족', '모공부각'])
})
