import test from 'node:test'
import assert from 'node:assert/strict'
import logicModule from '../dist/catalog/catalog.logic.js'
import wireModule from '../dist/db/wire.js'

const {
  productSearchText,
  contentSearchText,
  scoreSearchText,
  termsRegexSource,
  escapeRegex,
  unionTags,
  mergeProductDoc,
  mergeContentDoc,
  foldProductRows,
  parseListCursor,
  listCursorOf,
  compareProductHits,
  compareContentHits,
  PRODUCT_TAG_CAP,
  CONTENT_TAG_CAP,
} = logicModule
const { catalogProductToWire, catalogContentToWire } = wireModule

const NOW = new Date('2026-09-22T00:00:00.000Z')
const EARLIER = new Date('2026-09-01T00:00:00.000Z')

const productRow = (over = {}) => ({
  id: 'gm-100',
  mall: '지마켓',
  name: '촉촉 수분 크림',
  brand: '모의랩',
  price: 19900,
  url: 'https://item.gmarket.co.kr/Item?goodscode=100',
  tags: ['수분크림', '건성'],
  source: 'search',
  verified: true,
  ...over,
})

const contentRow = (over = {}) => ({
  id: 'ct-abc',
  type: 'video',
  source: 'YouTube',
  title: '건성 피부 수분 크림 추천',
  url: 'https://www.youtube.com/watch?v=abc',
  tags: ['수분크림'],
  verified: true,
  ...over,
})

/* ── 검색 텍스트·점수 ─────────────────────────────────────────── */

test('productSearchText — 이름·브랜드·태그·카테고리·몰을 소문자·공백 없이 이어 붙인다', () => {
  const text = productSearchText({ name: 'Real Cream', brand: 'A Lab', tags: ['수분 크림'], category: '크림', mall: '지마켓' })
  assert.equal(text, 'realcreamalab수분크림크림지마켓')
})

test('contentSearchText — 요약은 200자까지만 재료로 쓴다', () => {
  const text = contentSearchText({ title: '제목', source: '출처', tags: ['t'], snippet: 'x'.repeat(300) })
  assert.equal(text, '제목출처t' + 'x'.repeat(200))
})

test('scoreSearchText — 부분 일치 1점, 제품 유형 낱말은 2점, 없는 낱말은 0, 같은 낱말은 두 번 센다', () => {
  const text = productSearchText(productRow())
  assert.equal(scoreSearchText(text, { terms: ['수분크림', '건성', '없는말'], typeTerms: ['수분크림'] }), 3)
  assert.equal(scoreSearchText(text, { terms: ['수분 크림'], typeTerms: [] }), 1)
  assert.equal(scoreSearchText(text, { terms: ['건성', '건성'] }), 2)
  assert.equal(scoreSearchText(text, { terms: ['없는말'] }), 0)
})

test('termsRegexSource — 정규식 메타문자를 이스케이프하고 중복·빈 검색어를 거른다', () => {
  assert.equal(termsRegexSource(['a.b', 'a.b', ' ', 'c+']), 'a\\.b|c\\+')
  assert.equal(termsRegexSource(['', '  ']), null)
  assert.equal(escapeRegex('(x)'), '\\(x\\)')
  assert.match('a.bcd', new RegExp(termsRegexSource(['a.b'])))
  assert.doesNotMatch('axbcd', new RegExp(termsRegexSource(['a.b'])))
})

/* ── upsert 병합 ──────────────────────────────────────────────── */

test('mergeProductDoc — 새 문서: 기본값(status active·recommendCount 0·brand)과 시각을 채운다', () => {
  const doc = mergeProductDoc(null, productRow({ brand: undefined, lastSeenAt: undefined }), false, NOW)
  assert.equal(doc._id, 'gm-100')
  assert.equal(doc.brand, '')
  assert.equal(doc.status, 'active')
  assert.equal(doc.recommendCount, 0)
  assert.equal(doc.createdAt, NOW)
  assert.equal(doc.lastSeenAt, NOW)
  assert.equal(doc.searchText, productSearchText(productRow({ brand: '' })))
})

test('mergeProductDoc — bump 없음(시딩·가져오기): 값을 덮되 category 는 새 값이 없으면 보존, createdAt·recommendCount 보존', () => {
  const prev = { ...mergeProductDoc(null, productRow({ category: '크림', recommendCount: 7 }), false, EARLIER) }
  const next = mergeProductDoc(prev, productRow({ name: '새 이름', price: 100, verified: false, source: 'manual' }), false, NOW)
  assert.equal(next.name, '새 이름')
  assert.equal(next.price, 100)
  assert.equal(next.verified, false)
  assert.equal(next.source, 'manual')
  assert.equal(next.category, '크림')
  assert.equal(next.recommendCount, 7)
  assert.equal(next.createdAt, EARLIER)
  assert.equal(next.updatedAt, NOW)
  const withCategory = mergeProductDoc(prev, productRow({ category: '로션' }), false, NOW)
  assert.equal(withCategory.category, '로션')
})

test('mergeProductDoc — bump(수확): 이름·가격·주소만 덮고 출처·검증(OR)·상태·meta 보존, 태그 합집합, 노출 횟수 누적, searchText 재구성', () => {
  const prev = mergeProductDoc(
    null,
    productRow({ source: 'manual', verified: true, status: 'dead', meta: { reviews: 3 }, tags: ['수분크림', '건성'], imageUrl: 'https://img/a.jpg', recommendCount: 2 }),
    false,
    EARLIER,
  )
  const next = mergeProductDoc(
    prev,
    productRow({ name: '갱신 이름', price: 5, source: 'thread', verified: false, status: 'active', tags: ['건성', '진정'], imageUrl: null, recommendCount: 1 }),
    true,
    NOW,
  )
  assert.equal(next.name, '갱신 이름')
  assert.equal(next.price, 5)
  assert.equal(next.source, 'manual')
  assert.equal(next.status, 'dead')
  assert.deepEqual(next.meta, { reviews: 3 })
  assert.equal(next.verified, true)
  assert.equal(next.imageUrl, 'https://img/a.jpg')
  assert.deepEqual(next.tags, ['수분크림', '건성', '진정'])
  assert.equal(next.recommendCount, 3)
  assert.equal(next.createdAt, EARLIER)
  assert.equal(next.lastSeenAt, NOW)
  // 검색 재료 = 새 행의 searchText + 기존 태그 집합(정규화) — 기존 searchText 를 이어 붙이지 않는다
  const freshText = productSearchText(productRow({ name: '갱신 이름', tags: ['건성', '진정'] }))
  assert.equal(next.searchText, freshText + '수분크림건성')
})

test('unionTags — 처음 본 순서로 합치고 상한에서 자른다 (상품 30·콘텐츠 40)', () => {
  assert.deepEqual(unionTags(['a', 'b'], ['b', 'c', 'a'], 10), ['a', 'b', 'c'])
  const many = Array.from({ length: 50 }, (_, i) => `t${i}`)
  assert.equal(unionTags([], many, PRODUCT_TAG_CAP).length, 30)
  assert.equal(unionTags(many.slice(0, 35), many, CONTENT_TAG_CAP).length, 40)
  const bumped = mergeProductDoc(mergeProductDoc(null, productRow({ tags: many.slice(0, 28) }), false, EARLIER), productRow({ tags: many.slice(20) }), true, NOW)
  assert.equal(bumped.tags.length, PRODUCT_TAG_CAP)
  assert.deepEqual(bumped.tags.slice(0, 3), ['t0', 't1', 't2'])
})

test('mergeContentDoc — bump 는 없던 썸네일·메타·요약·연도만 채우고 종류·출처·주소는 보존', () => {
  const prev = mergeContentDoc(null, contentRow({ imageUrl: null, meta: null, year: null, snippet: '옛 요약', recommendCount: 1 }), false, EARLIER)
  const next = mergeContentDoc(
    prev,
    contentRow({ type: 'article', source: '다른곳', url: 'https://other', title: '새 제목', imageUrl: 'https://img/c.jpg', meta: '2025', year: 2025, snippet: null, recommendCount: 1 }),
    true,
    NOW,
  )
  assert.equal(next.type, 'video')
  assert.equal(next.source, 'YouTube')
  assert.equal(next.url, 'https://www.youtube.com/watch?v=abc')
  assert.equal(next.title, '새 제목')
  assert.equal(next.imageUrl, 'https://img/c.jpg')
  assert.equal(next.meta, '2025')
  assert.equal(next.year, 2025)
  assert.equal(next.snippet, '옛 요약')
  assert.equal(next.recommendCount, 2)
  const plain = mergeContentDoc(prev, contentRow({ title: '덮기', recommendCount: 9 }), false, NOW)
  assert.equal(plain.title, '덮기')
  assert.equal(plain.recommendCount, 1)
  assert.equal(plain.createdAt, EARLIER)
})

test('foldProductRows — 같은 요청 안의 같은 id 는 순서대로 접히고 기존 문서 위에 병합된다', () => {
  const prev = new Map([['gm-100', mergeProductDoc(null, productRow({ recommendCount: 1 }), false, EARLIER)]])
  const docs = foldProductRows(prev, [productRow({ recommendCount: 1, tags: ['a'] }), productRow({ recommendCount: 1, tags: ['b'] }), productRow({ id: 'gm-200', recommendCount: 0 })], true, NOW)
  assert.equal(docs.length, 2)
  const merged = docs.find((d) => d._id === 'gm-100')
  assert.equal(merged.recommendCount, 3)
  assert.deepEqual(merged.tags, ['수분크림', '건성', 'a', 'b'])
  assert.equal(docs.find((d) => d._id === 'gm-200').createdAt, NOW)
})

/* ── 둘러보기 커서·정렬 ───────────────────────────────────────── */

test('parseListCursor/listCursorOf — `<updatedAt ISO>|<id>` 왕복, 깨진 커서는 null(첫 페이지)', () => {
  const doc = { updatedAt: NOW, _id: 'gm-1|x' }
  const cursor = listCursorOf(doc)
  assert.equal(cursor, '2026-09-22T00:00:00.000Z|gm-1|x')
  const parsed = parseListCursor(cursor)
  assert.equal(parsed.at.getTime(), NOW.getTime())
  assert.equal(parsed.id, 'gm-1|x')
  assert.equal(parseListCursor(undefined), null)
  assert.equal(parseListCursor('nodelimiter'), null)
  assert.equal(parseListCursor('|gm-1'), null)
  assert.equal(parseListCursor('not-a-date|gm-1'), null)
  assert.equal(parseListCursor('2026-09-22T00:00:00.000Z|'), null)
})

test('compareProductHits — 점수 ↓, 검증 ↓, 노출 횟수 ↓, 리뷰 수 ↓, id ↑', () => {
  const doc = (over) => ({ _id: 'x', verified: true, recommendCount: 0, meta: null, ...over })
  const hits = [
    { doc: doc({ _id: 'd', verified: false }), score: 2 },
    { doc: doc({ _id: 'c', recommendCount: 1 }), score: 2 },
    { doc: doc({ _id: 'b', meta: { reviews: '10' } }), score: 2 },
    { doc: doc({ _id: 'a' }), score: 2 },
    { doc: doc({ _id: 'z' }), score: 3 },
  ]
  assert.deepEqual([...hits].sort(compareProductHits).map((h) => h.doc._id), ['z', 'c', 'b', 'a', 'd'])
})

test('compareContentHits — 점수 ↓, 노출 횟수 ↓, 연도 ↓(없으면 뒤), id ↑', () => {
  const doc = (over) => ({ _id: 'x', recommendCount: 0, year: null, ...over })
  const hits = [
    { doc: doc({ _id: 'old', year: 2020 }), score: 1 },
    { doc: doc({ _id: 'none' }), score: 1 },
    { doc: doc({ _id: 'new', year: 2026 }), score: 1 },
    { doc: doc({ _id: 'pop', recommendCount: 5 }), score: 1 },
  ]
  assert.deepEqual([...hits].sort(compareContentHits).map((h) => h.doc._id), ['pop', 'new', 'old', 'none'])
})

/* ── 와이어 변환 ─────────────────────────────────────────────── */

test('catalogProductToWire — _id → id, Date → ISO, score 는 있을 때만', () => {
  const doc = mergeProductDoc(null, productRow({ lastSeenAt: '2026-09-10T00:00:00.000Z' }), false, NOW)
  const w = catalogProductToWire(doc)
  assert.equal(w.id, 'gm-100')
  assert.equal('_id' in w, false)
  assert.equal('score' in w, false)
  assert.equal(w.createdAt, '2026-09-22T00:00:00.000Z')
  assert.equal(w.lastSeenAt, '2026-09-10T00:00:00.000Z')
  assert.equal(catalogProductToWire(doc, 4).score, 4)
  assert.equal(catalogProductToWire({ ...doc, lastSeenAt: null }).lastSeenAt, null)
})

test('catalogContentToWire — 문서 필드를 계약 이름 그대로 옮긴다', () => {
  const doc = mergeContentDoc(null, contentRow({ year: 2025, duration: '12:30' }), false, NOW)
  const w = catalogContentToWire(doc, 2)
  assert.equal(w.id, 'ct-abc')
  assert.equal(w.type, 'video')
  assert.equal(w.year, 2025)
  assert.equal(w.duration, '12:30')
  assert.equal(w.score, 2)
  assert.equal(w.updatedAt, '2026-09-22T00:00:00.000Z')
})
