import test from 'node:test'
import assert from 'node:assert/strict'
import mapping from '../dist/mapping.js'

const { toUnit, toDocPatch, sanitizeTaxonomyDoc, readCacheEnvelope,
        toCatalogUnit, toListingCard, toUnlinkedCard, joinListings, catalogDisplayName,
        cleanListingName } = mapping

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

/* 실제 catalog 문서에서 추린 모양 — 필드 이름을 바꾸지 말 것 */
const CAT = {
  catalog_id: 'c-000242',
  name: '가히 에어리 핏 선스틱',
  brand: '68851',
  brand_name: '가히',
  image_url: 'https://image.oliveyoung.co.kr/x.jpg',
  volume_ml: 50,
  ingredients_from_spec: ['병풀(시카)', '판테놀'],
  inferred_category: '선케어',
  sub_type: '선스틱',
  formulation: '스틱',
  ingredient_tags: ['시카'],
  body_part: '얼굴전체',
  skin_types: ['모든피부'], skin_types_primary: '모든피부',
  concerns: ['모공부각', '유분과다'], concerns_primary: '모공부각',
  results: ['지속력'], results_primary: '지속력',
  conditions: ['야외·땀'], conditions_primary: '야외·땀',
  confidence: 'high',
  rationale: '상품명에 선스틱이 명시됨',
  field_confidence: {
    category: { level: 'medium', rationale: '스킨케어 성분으로 추론' },
    subtype: { level: 'high', rationale: "상품명에 '선스틱'이 명시됨" },
  },
  review_status: 'unreviewed',
}

const OY = {
  product_id: 'A000000211648', catalog_ids: ['c-000242'],
  price: 18200, url: 'https://www.oliveyoung.co.kr/p/1',
  image_url: 'https://image.oliveyoung.co.kr/oy.jpg',
  options: [{}, {}],
  product_info: { '제품 주요 사양': '가벼운 마무리' },
  review_stats: { count: 1204, avg_rating: 4.6 },
}

const GM = {
  product_id: 'gm-4448101605', catalog_ids: ['c-000242'], source: 'gmarket',
  price: 17900, brand: '68851', brand_name: '가히',
  image_url: 'https://gdimg.gmarket.co.kr/1/still/280',
}

test('toCatalogUnit — id는 catalog_id, 7필드를 그대로 읽는다', () => {
  const u = toCatalogUnit(CAT, [])
  assert.equal(u.id, 'c-000242')
  assert.deepEqual(u.fields.concern.selected, ['모공부각', '유분과다'])
  assert.equal(u.fields.concern.rep, '모공부각')
  assert.equal(u.fields.category.selected[0], '선케어')
})

test('toCatalogUnit — 브랜드는 brand_name 우선 (brand 가 숫자 id 인 문서가 있다)', () => {
  assert.equal(toCatalogUnit(CAT, []).brand, '가히')
})

test('toCatalogUnit — field_confidence 가 있으면 필드별로 싣는다', () => {
  const u = toCatalogUnit(CAT, [])
  assert.equal(u.fields.subtype.confidence, 90)
  assert.equal(u.fields.subtype.rationale, "상품명에 '선스틱'이 명시됨")
  assert.equal(u.fields.category.confidence, 70)
})

test('toCatalogUnit — field_confidence 에 없는 필드는 문서 단위 confidence 로 떨어지고 근거는 비운다', () => {
  const u = toCatalogUnit(CAT, [])
  assert.equal(u.fields.condition.confidence, 90) // 문서 confidence='high'
  assert.equal(u.fields.condition.rationale, '') // 문서 rationale은 다른 필드 얘기일 수 있어 채우지 않는다
})

test('toListingCard — 몰 배지는 source, 없으면 oliveyoung', () => {
  assert.equal(toListingCard(OY).mall, 'oliveyoung')
  assert.equal(toListingCard(GM).mall, 'gmarket')
})

test('toListingCard — 지마켓은 url 이 없어 null 이다 (PDP 버튼을 감추는 근거)', () => {
  assert.equal(toListingCard(GM).url, null)
  assert.equal(toListingCard(OY).url, 'https://www.oliveyoung.co.kr/p/1')
})

test('toListingCard — 리뷰·상세문구는 있는 상품에만', () => {
  assert.match(toListingCard(OY).review, /리뷰 1,204건/)
  assert.equal(toListingCard(OY).copy, '가벼운 마무리')
  assert.equal(toListingCard(GM).review, '')
  assert.equal(toListingCard(GM).copy, '')
})

test('toCatalogUnit — 대표 상품(올리브영 우선)의 문구를 상단에 올린다', () => {
  const u = toCatalogUnit(CAT, [GM, OY])
  assert.equal(u.copy, '가벼운 마무리')
  assert.match(u.review, /리뷰 1,204건/)
  assert.equal(u.listings.length, 2)
})

test('joinListings — catalog_id 로 묶고 merged_into 는 뺀다', () => {
  const tomb = { catalog_id: 'c-000999', merged_into: 'c-000242', name: '흡수됨' }
  const { units, unlinked } = joinListings([CAT, tomb], [OY, GM])
  assert.equal(units.length, 1)
  assert.equal(units[0].id, 'c-000242')
  assert.equal(units[0].listings.length, 2)
  assert.equal(unlinked.length, 0)
})

test('joinListings — 어느 카탈로그에도 안 묶인 상품은 unlinked 로만 나온다', () => {
  const orphan = { product_id: 'A999', name: '미연결', image_url: null }
  const { units, unlinked } = joinListings([CAT], [OY, orphan])
  assert.equal(units.length, 1)
  assert.deepEqual(unlinked.map((u) => u.productId), ['A999'])
  assert.equal(unlinked[0].mall, 'oliveyoung')
})

test('joinListings — 묘비만 가리키는 상품은 unlinked 로 나온다 (살아있는 카탈로그가 하나도 없다)', () => {
  const tomb = { catalog_id: 'c-000999', merged_into: 'c-000242', name: '흡수됨' }
  const onlyTomb = { product_id: 'A777', catalog_ids: ['c-000999'], name: '묘비만 참조' }
  const { units, unlinked } = joinListings([tomb], [onlyTomb])
  assert.equal(units.length, 0)
  assert.deepEqual(unlinked.map((u) => u.productId), ['A777'])
})

test('joinListings — 묘비와 살아있는 카탈로그를 함께 가리키면 살아있는 쪽 unit에 묶이고 unlinked엔 안 나온다', () => {
  const tomb = { catalog_id: 'c-000999', merged_into: 'c-000242', name: '흡수됨' }
  const both = { product_id: 'A778', catalog_ids: ['c-000999', 'c-000242'], name: '묘비+살아있음' }
  const { units, unlinked } = joinListings([CAT, tomb], [both])
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].listings.map((l) => l.productId), ['A778'])
  assert.equal(unlinked.length, 0)
})

/* ── 대표 상품의 출처·결정성 (코드리뷰 지적) ────────────────────────── */

test('toCatalogUnit — 상단 문구·리뷰에 출처 몰을 함께 싣는다', () => {
  const u = toCatalogUnit(CAT, [GM, OY])
  assert.equal(u.copySource, 'oliveyoung')
  assert.equal(u.reviewSource, 'oliveyoung')
})

test('toCatalogUnit — 문구·리뷰가 없으면 출처도 null', () => {
  const u = toCatalogUnit(CAT, [GM])
  assert.equal(u.copy, '')
  assert.equal(u.copySource, null)
  assert.equal(u.reviewSource, null)
})

test('toCatalogUnit — 후보가 여럿이면 상품 순서가 아니라 product_id 로 정해진다', () => {
  const a = { ...OY, product_id: 'A000000000001', product_info: { '제품 주요 사양': '먼저' } }
  const b = { ...OY, product_id: 'A000000000002', product_info: { '제품 주요 사양': '나중' } }
  /* 어느 순서로 들어와도 같은 상품이 뽑혀야 한다 — Mongo 반환 순서에 흔들리지 않게 */
  assert.equal(toCatalogUnit(CAT, [a, b]).copy, '먼저')
  assert.equal(toCatalogUnit(CAT, [b, a]).copy, '먼저')
})

/* ── 사람이 고친 카탈로그 이름 (Flask display_name) ──────────────────── */

test('toCatalogUnit — display_name 이 있으면 그 이름을 쓴다', () => {
  const u = toCatalogUnit({ ...CAT, display_name: 'AHC 프로샷 포어이레이저 세럼 30ml' }, [])
  assert.equal(u.name, 'AHC 프로샷 포어이레이저 세럼 30ml')
})

test('toCatalogUnit — display_name 이 없거나 공백뿐이면 다듬은 name 을 쓴다', () => {
  /* Flask catalog_display_name 과 같은 값이다(실제로 돌려 대조함). */
  const expected = '가히 에어리 핏 선스틱 50ml'
  assert.equal(toCatalogUnit(CAT, []).name, expected)
  assert.equal(toCatalogUnit({ ...CAT, display_name: '   ' }, []).name, expected)
  assert.equal(toCatalogUnit({ ...CAT, display_name: null }, []).name, expected)
})

test('catalogDisplayName — 고친 이름에 용량이 없으면 붙인다 (Flask 와 같은 규칙)', () => {
  assert.equal(catalogDisplayName({ display_name: '홀리카홀리카 마이페이브 피스', volume_ml: 1.7, volume_unit: 'g' }),
               '홀리카홀리카 마이페이브 피스 1.7g')
  assert.equal(catalogDisplayName({ display_name: '설화수 자음수 EX', volume_ml: 150 }), '설화수 자음수 EX 150ml')
})

test('catalogDisplayName — 고친 이름이 없으면 상품 제목을 다듬어 쓴다', () => {
  /* 실측: display_name 은 903 건 중 182 건에만 있다. 나머지는 이 경로로 그려지므로 여기가
     원문이면 대시보드와 이름이 갈린다(「[7월 올영픽][한교동 …]」 대 「메디큐브 에이지알 …」). */
  assert.equal(
    catalogDisplayName({ name: '[7월 올영픽][한교동 장바구니백 증정] 메디큐브 에이지알 미니플러스 한교동 에디션/짱구 에디션/핑크/베이지 택 1' }),
    '메디큐브 에이지알 미니플러스 한교동 에디션/짱구 에디션/핑크/베이지')
  /* 다듬기가 용량 앞에서 자르므로 덧붙여도 겹치지 않는다(예전엔 "… 100mL 100ml" 이 됐다). */
  assert.equal(catalogDisplayName({ name: '식물나라 워터프루프 선 크림 100mL', volume_ml: 100 }),
               '식물나라 워터프루프 선 크림 100ml')
  /* 다듬은 결과가 너무 짧으면(4 자 미만) 규칙이 헛나간 것으로 보고 원문을 쓴다. */
  assert.equal(catalogDisplayName({ name: '원문만', volume_ml: 50 }), '원문만 50ml')
})

test('cleanListingName — app.py clean_listing_name 과 같은 결과', () => {
  /* 아래 기대값은 Flask 의 clean_listing_name 을 실제로 돌려 받은 것이다. 규칙이 두 벌이라
     한쪽만 고치면 두 화면의 이름이 갈린다 — 바꿀 일이 생기면 양쪽을 같이 고칠 것. */
  assert.equal(cleanListingName('[NEW컬러] 투크 워터프루프 슬림 아이라이너 15 colors'),
               '투크 워터프루프 슬림 아이라이너')
  assert.equal(cleanListingName('토리든 다이브인 세럼 50ml 기획'), '토리든 다이브인 세럼')
  /* 앞머리 블록은 붙어 있는 만큼 반복해 떼어낸다. */
  assert.equal(cleanListingName('[7월 올영픽][한교동 장바구니백 증정] 메디큐브 에이지알 미니플러스 한교동 에디션/짱구 에디션/핑크/베이지 택 1'),
               '메디큐브 에이지알 미니플러스 한교동 에디션/짱구 에디션/핑크/베이지')
  /* 영문 단위 뒤 경계 — 파이썬 \b 는 유니코드라 한글이 이어지면 안 자른다. JS \b 를 그대로
     쓰면 "15ml짜리" 가 잘려 두 구현이 갈린다. */
  assert.equal(cleanListingName('바이오더마 이드라비오 H2O 옹까'), '바이오더마 이드라비오 H2O 옹까')
  assert.equal(cleanListingName('원문만'), '원문만')   // 4 자 미만이면 원문
  assert.equal(cleanListingName(null), '')
})

test('catalogDisplayName — 이름에 이미 용량이 있으면 덧붙이지 않는다', () => {
  assert.equal(catalogDisplayName({ display_name: 'AHC 프로샷 포어이레이저 세럼 30ml', volume_ml: 30 }),
               'AHC 프로샷 포어이레이저 세럼 30ml')
  assert.equal(catalogDisplayName({ display_name: '리얼 네이처 수딩젤 1000ml', volume_ml: 1000 }),
               '리얼 네이처 수딩젤 1000ml')
})

test('catalogDisplayName — 용량을 모르면 이름만', () => {
  assert.equal(catalogDisplayName({ display_name: '이름만', volume_ml: null }), '이름만')
  assert.equal(catalogDisplayName({ name: '원문만' }), '원문만')
})

test('catalogDisplayName — 단위 뒤에 글자가 붙은 건 용량으로 치지 않는다', () => {
  /* Flask 의 (?![a-z가-힣]) 와 같은 판정 — "30ml리필"의 ml 은 걸리지만 "5g램프"의 g 는 아니다 */
  assert.equal(catalogDisplayName({ display_name: '샘플 5그램짜리', volume_ml: 5, volume_unit: 'g' }),
               '샘플 5그램짜리 5g')
})
