import test from 'node:test'
import assert from 'node:assert/strict'
import mapping from '../dist/mapping.js'

const { toUnit, toDocPatch, sanitizeTaxonomyDoc, readCacheEnvelope } = mapping

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

const PATCH = {
  fields: {
    category: { selected: ['클렌징'], rep: '클렌징', status: 'done', origin: 'human' },
    subtype: { selected: ['클렌징폼'], rep: '클렌징폼', status: 'done', origin: 'ai' },
    area: { selected: ['얼굴전체'], rep: '얼굴전체', status: 'done', origin: 'ai' },
    type: { selected: ['건성', '민감성'], rep: '민감성', status: 'done', origin: 'human' },
    concern: { selected: ['트러블'], rep: '트러블', status: 'done', origin: 'human' },
    result: { selected: ['진정됨'], rep: '진정됨', status: 'done', origin: 'ai' },
    condition: { selected: [], rep: null, status: 'done', origin: 'ai' },
  },
  tagRequest: { concern: true },
  note: '민감성 후기 근거로 추가',
}

test('toDocPatch — 화면 필드를 문서 필드로 되돌린다', () => {
  const set = toDocPatch(PATCH, DOC)
  assert.equal(set.inferred_category, '클렌징')
  assert.deepEqual(set.skin_types, ['건성', '민감성'])
  assert.equal(set.skin_types_primary, '민감성')
  assert.deepEqual(set.conditions, [])
  assert.equal(set.conditions_primary, null)
})

test('toDocPatch — 화이트리스트 밖은 절대 나가지 않는다', () => {
  const set = toDocPatch({ ...PATCH, status: 'new', name: '조작', embedding_text: 'x' }, DOC)
  assert.equal('status' in set, false)
  assert.equal('name' in set, false)
  assert.equal('embedding_text' in set, false)
})

test('toDocPatch — 첫 저장에서 AI 원본을 스냅샷한다', () => {
  const set = toDocPatch(PATCH, DOC)
  assert.deepEqual(set.review_meta.aiOriginal.concern.selected, ['수분부족', '모공부각'])
  /* 이미 스냅샷이 있으면 덮지 않는다 — 두 번째 저장이 사람이 고친 값을 원본으로 굳히면
     '되돌리기'가 영원히 망가진다 */
  const already = { ...DOC, review_meta: { aiOriginal: { concern: { selected: ['각질'], rep: '각질' } } } }
  assert.deepEqual(toDocPatch(PATCH, already).review_meta.aiOriginal.concern.selected, ['각질'])
})

test('toDocPatch — 화면 전용 상태는 review_meta 한 곳에만 담는다', () => {
  const set = toDocPatch(PATCH, DOC)
  assert.equal(set.review_meta.note, '민감성 후기 근거로 추가')
  assert.equal(set.review_meta.fieldOrigin.type, 'human')
  assert.equal(set.review_meta.fieldStatus.category, 'done')
  assert.deepEqual(set.review_meta.tagRequest, { concern: true })
})

test('toDocPatch — tagRequest는 FIELD_KEYS 밖 키를 버리고 값을 boolean으로 강제한다', () => {
  const patch = { ...PATCH, tagRequest: { concern: 1, evil: true, category: 0 } }
  const set = toDocPatch(patch, DOC)
  assert.deepEqual(set.review_meta.tagRequest, { concern: true, category: false })
  assert.equal('evil' in set.review_meta.tagRequest, false)
})

test('toDocPatch — note는 상한(2000자)에서 자른다', () => {
  const patch = { ...PATCH, note: 'a'.repeat(2500) }
  const set = toDocPatch(patch, DOC)
  assert.equal(set.review_meta.note.length, 2000)
})

test('toDocPatch — 대표(★)가 선택 목록 밖이면 비운다', () => {
  const bad = { ...PATCH, fields: { ...PATCH.fields, type: { selected: ['건성'], rep: '지성', status: 'done', origin: 'human' } } }
  assert.equal(toDocPatch(bad, DOC).skin_types_primary, '건성')
})

test('toDocPatch — updated_at은 store.py의 _now()와 같은 형식이다', () => {
  assert.match(toDocPatch(PATCH, DOC).updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/)
})

test('toDocPatch — 태그를 바꾼 패치는 review_status를 unreviewed로 리셋한다 (reviewed 문서)', () => {
  const set = toDocPatch(PATCH, DOC)
  assert.equal(set.review_status, 'unreviewed')
  assert.equal(set.reviewed_at, null)
})

test('toDocPatch — 태그를 그대로 두고 메모만 바꾼 패치는 review_status를 건드리지 않는다', () => {
  /* DOC의 현재 값과 동일한 선택·대표를 7필드에 채워 보낸다 (화면은 항상 전 필드를 재전송) */
  const unchangedPatch = {
    fields: {
      category: { selected: ['클렌징'], rep: '클렌징', status: 'done', origin: 'ai' },
      subtype: { selected: ['클렌징폼'], rep: '클렌징폼', status: 'done', origin: 'ai' },
      area: { selected: ['얼굴전체'], rep: '얼굴전체', status: 'done', origin: 'ai' },
      type: { selected: ['모든피부'], rep: '모든피부', status: 'done', origin: 'ai' },
      concern: { selected: ['수분부족', '모공부각'], rep: '수분부족', status: 'done', origin: 'ai' },
      result: { selected: ['보송'], rep: null, status: 'done', origin: 'ai' },
      condition: { selected: ['데일리'], rep: null, status: 'done', origin: 'ai' },
    },
    note: '메모만 수정',
  }
  const set = toDocPatch(unchangedPatch, DOC)
  assert.equal('review_status' in set, false)
  assert.equal('reviewed_at' in set, false)
})

test('toDocPatch — 문서가 이미 미검토면 태그를 바꿔도 review_status를 리셋하지 않는다', () => {
  const unreviewed = { ...DOC, review_status: null }
  const set = toDocPatch(PATCH, unreviewed)
  /* 태그가 바뀌었지만 doc.review_status가 null이므로 리셋 조건이 없다 */
  assert.equal('review_status' in set, false)
  assert.equal('reviewed_at' in set, false)
})

const TAXONOMY_DOC = {
  _id: 'current',
  _rev: 2,
  updated_at: '2026-09-07T00:11:54.540175+00:00',
  categories: ['클렌징', '스킨케어'],
  sub_types: ['클렌징폼', '토너'],
}

test('sanitizeTaxonomyDoc — 메타 세 필드를 빼고 택소노미 키는 그대로 둔다', () => {
  const result = sanitizeTaxonomyDoc(TAXONOMY_DOC)
  assert.equal('_id' in result.taxonomy, false)
  assert.equal('_rev' in result.taxonomy, false)
  assert.equal('updated_at' in result.taxonomy, false)
  assert.deepEqual(result.taxonomy.categories, ['클렌징', '스킨케어'])
  assert.deepEqual(result.taxonomy.sub_types, ['클렌징폼', '토너'])
  assert.equal(result.rev, 2)
  assert.equal(result.updatedAt, '2026-09-07T00:11:54.540175+00:00')
})

test('sanitizeTaxonomyDoc — categories가 비어 있거나 없으면 무효로 판정한다', () => {
  assert.equal(sanitizeTaxonomyDoc({ ...TAXONOMY_DOC, categories: [] }), null)
  const { categories, ...withoutCategories } = TAXONOMY_DOC
  assert.equal(sanitizeTaxonomyDoc(withoutCategories), null)
})

test('sanitizeTaxonomyDoc — null·undefined 문서는 무효로 판정한다', () => {
  assert.equal(sanitizeTaxonomyDoc(null), null)
  assert.equal(sanitizeTaxonomyDoc(undefined), null)
})

test('decisionToReview — 화면 결정을 Flask와 공유하는 review_status로 되돌린다', () => {
  const { decisionToReview } = mapping
  assert.equal(decisionToReview('approved').review_status, 'reviewed')
  assert.match(decisionToReview('approved').reviewed_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(decisionToReview('rejected').review_status, 'needs_fix')
  /* 반려·해제는 검토 시각을 남기지 않는다 (store.py set_review_status와 같은 규칙) */
  assert.equal(decisionToReview('rejected').reviewed_at, null)
  assert.equal(decisionToReview(null).review_status, 'unreviewed')
  assert.equal(decisionToReview(null).reviewed_at, null)
})

const CACHE_ENVELOPE = {
  taxonomy: { categories: ['클렌징', '스킨케어'], sub_types: ['클렌징폼', '토너'] },
  rev: 2,
  updatedAt: '2026-09-07T00:11:54.540175+00:00',
  cachedAt: '2026-09-07T03:20:00.000Z',
}

test('readCacheEnvelope — 정상 봉투를 그대로 복원하고 택소노미에 메타 키가 없다', () => {
  const result = readCacheEnvelope(CACHE_ENVELOPE)
  assert.deepEqual(result, CACHE_ENVELOPE)
  assert.equal('_id' in result.taxonomy, false)
  assert.equal('_rev' in result.taxonomy, false)
  assert.equal('updated_at' in result.taxonomy, false)
})

test('readCacheEnvelope — categories가 비었거나 없으면 무효로 판정한다', () => {
  assert.equal(readCacheEnvelope({ ...CACHE_ENVELOPE, taxonomy: { categories: [] } }), null)
  const { categories, ...taxonomyWithoutCategories } = CACHE_ENVELOPE.taxonomy
  assert.equal(readCacheEnvelope({ ...CACHE_ENVELOPE, taxonomy: taxonomyWithoutCategories }), null)
  assert.equal(readCacheEnvelope({ ...CACHE_ENVELOPE, taxonomy: null }), null)
})

test('readCacheEnvelope — 봉투가 아닌 값은 무효로 판정한다', () => {
  assert.equal(readCacheEnvelope(null), null)
  assert.equal(readCacheEnvelope('current'), null)
  assert.equal(readCacheEnvelope([CACHE_ENVELOPE]), null)
  assert.equal(readCacheEnvelope(42), null)
})

test('readCacheEnvelope — cachedAt이 없거나 문자열이 아니면 무효로 판정한다', () => {
  const { cachedAt, ...withoutCachedAt } = CACHE_ENVELOPE
  assert.equal(readCacheEnvelope(withoutCachedAt), null)
  assert.equal(readCacheEnvelope({ ...CACHE_ENVELOPE, cachedAt: 12345 }), null)
})
