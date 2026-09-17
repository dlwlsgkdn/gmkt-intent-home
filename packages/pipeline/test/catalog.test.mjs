// 내재화 카탈로그 (v29, 2026-09-17) — 검색어 추출·후보 주입·수확·시딩·PDP 보정·후보 대조 그라운딩
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  catalogTermsOf,
  productTypesOf,
  tokenizeKo,
  harvestRowsOf,
  seedProductRowsOf,
  CATALOG_SEED_KEYWORDS,
  CATALOG_SEED_COST_PER_QUERY_USD,
  catalogSeedQueries,
  fnv1a,
  productCandidatesBlock,
  contentCandidatesBlock,
  oliveyoungGoodsNoOf,
  pdpKeyOf,
  pdpVerified,
} from '../dist/catalog-candidates.js'
import { groundContentsSection, groundProductsSection, repairPdpUrl, catalogFallbackSections } from '../dist/guards/grounding.js'
import { buildCatalogSeedRequest, buildPlanContentsRequest, buildPlanProductsRequest, PLAN_PRODUCTS_SYSTEM } from '../dist/prompts.js'
import { planQualityOf } from '../dist/quality.js'

const survey = {
  intro: '',
  questions: [
    { id: 'q1', question: '피부 타입은?', options: ['지성|T존', '건성|당김'], multi: false },
    { id: 'q2', question: '예산은?', options: ['3만원대|가성비'], multi: false },
  ],
}
const answers = [
  { questionId: 'q1', choices: ['지성'] },
  { questionId: 'q2', choices: ['3만원대'] },
]

test('검색어 추출 — 제품 유형 별칭은 정식 이름으로, 조사·상투어는 떼고, 답변 제목이 섞인다', () => {
  assert.deepEqual(productTypesOf('여름에 안 무너지는 썬크림이랑 파데 추천해줘'), ['선크림', '파운데이션'])
  assert.deepEqual(productTypesOf('수분크림 vs 크림'), ['수분크림', '크림'])
  assert.deepEqual(tokenizeKo('지성 피부에 여름 쿠션을 추천해줘'), ['지성', '여름', '쿠션'])
  const terms = catalogTermsOf({ intent: '여름 지성 쿠션 추천해줘', survey, answers, profile: [{ label: '피부타입', value: '지성' }] })
  assert.deepEqual(terms.typeTerms, ['쿠션'])
  assert.ok(terms.terms.includes('쿠션') && terms.terms.includes('여름') && terms.terms.includes('지성'))
  assert.ok(!terms.terms.includes('추천해줘'))
})

const candidate = (id, over = {}) => ({
  id, name: '밀착 쿠션', brand: '모의랩', price: 24900, tags: ['쿠션', '지속력'], url: 'https://item.gmarket.co.kr/Item?goodscode=4400000001',
  mall: '지마켓', imageUrl: 'https://gdimg.gmarket.co.kr/4400000001/still/280', ...over,
})

test('후보 표 — 가변부에 id 표로 실리고 시스템 프롬프트에는 정적 카탈로그가 없다', () => {
  const block = productCandidatesBlock([candidate('gm-4400000001')])
  assert.ok(block.includes('gm-4400000001 | 지마켓 | 모의랩 밀착 쿠션 | 24,900원 | 쿠션,지속력'))
  assert.equal(productCandidatesBlock([]), '')
  const user = buildPlanProductsRequest('쿠션', survey, answers, undefined, undefined, null, { products: [candidate('gm-4400000001')], contents: [] })
  assert.ok(user.includes('내부 카탈로그 후보') && user.includes('productIds'))
  assert.ok(!buildPlanProductsRequest('쿠션', survey, answers).includes('내부 카탈로그 후보'))
  assert.ok(!PLAN_PRODUCTS_SYSTEM.includes('{{CATALOG}}') && PLAN_PRODUCTS_SYSTEM.includes('내부 카탈로그 절반 : 웹 검색 절반'))
  const contents = [{ id: 'ct-abc', type: 'video', source: '유튜브', title: '쿠션 바르는 법', url: 'https://www.youtube.com/watch?v=abc', meta: '2025년 5월' }]
  assert.ok(contentCandidatesBlock(contents).includes('ct-abc | 영상 | 유튜브 | 쿠션 바르는 법 | 2025년 5월'))
  assert.ok(buildPlanContentsRequest('쿠션', survey, answers, undefined, undefined, null, {}, { products: [], contents }).includes('catalogIds'))
})

test('그라운딩 — productIds 는 이 요청의 후보 목록에서 해석되고, 내부 상품은 근거 신뢰 100·웹 상품과 상품 번호가 겹치면 후보로 대체', () => {
  const guard = { candidates: { products: [candidate('gm-4400000001')], contents: [] } }
  const { section, drops } = groundProductsSection(
    {
      kind: 'products', title: '추천 쿠션', reason: '', productIds: ['gm-4400000001', 'gm-없는id'],
      catalogRatings: [{ id: 'gm-4400000001', match: { skin: 4, concern: 5, preference: 4, notes: { skin: 'a', concern: 'b', preference: 'c' } } }],
      webProducts: [
        { name: '밀착 쿠션', brand: '모의랩', price: 25900, mall: 'G마켓', url: 'https://m.gmarket.co.kr/vi/product/4400000001', urlKind: 'pdp', imageUrl: '', tags: [] },
        { name: '올영 쿠션', brand: '브랜드', price: 19900, mall: '올리브영', url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358', urlKind: 'pdp', imageUrl: '', tags: [] },
      ],
    },
    0,
    guard,
  )
  assert.ok(drops.some((d) => d.code === 'catalog-miss'), '후보 밖 id 는 catalog-miss')
  assert.ok(drops.some((d) => d.code === 'duplicate-candidate'), '같은 상품 번호의 웹 상품은 후보로 대체')
  const ids = section.products.map((p) => p.id)
  assert.deepEqual(ids, ['web-0-1', 'gm-4400000001'], '웹(올영) 앞, 내부 후보 뒤 — 중복 웹 상품은 없다')
  const internal = section.products.find((p) => p.id === 'gm-4400000001')
  assert.equal(internal.match.factors.find((f) => f.key === 'evidence').score, 100)
  assert.equal(internal.mall, '지마켓')
  const q = planQualityOf({ headline: '', summary: '', sections: [section] })
  assert.equal(q.webProducts, 1, '품질 KPI 의 웹 상품은 id 접두 web- 만 센다')
})

test('PDP 보정 — 아는 몰인데 상품 번호 형식이 어긋난 주소는 몰 검색 링크(urlKind=search)로 바꿔 싣는다', () => {
  assert.equal(oliveyoungGoodsNoOf('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358'), 'A000000214358')
  assert.equal(oliveyoungGoodsNoOf('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=12345'), null)
  assert.equal(repairPdpUrl(new URL('https://item.gmarket.co.kr/Item?goodscode=4400000001'), '쿠션'), null)
  assert.ok(repairPdpUrl(new URL('https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A12'), '브랜드 쿠션').includes('getSearchMain.do?query='))
  assert.ok(repairPdpUrl(new URL('https://www.coupang.com/vp/products/abc'), '쿠션').includes('/np/search?q='))
  assert.equal(repairPdpUrl(new URL('https://shop.example.com/p/1'), '쿠션'), null, '모르는 몰은 손대지 않는다')
  const { section, drops } = groundProductsSection(
    {
      kind: 'products', title: '추천', reason: '', productIds: [],
      webProducts: [{ name: '형식 깨진 올영 상품', brand: '브랜드', price: 10000, mall: '올리브영', url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A12', urlKind: 'pdp', imageUrl: '', tags: [] }],
    },
    0,
  )
  assert.ok(drops.some((d) => d.code === 'repaired-url'))
  assert.equal(section.products[0].urlKind, 'search')
  assert.ok(section.products[0].url.startsWith('https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query='))
  assert.equal(section.products[0].match.factors.find((f) => f.key === 'evidence').score, 25)
})

test('콘텐츠 그라운딩 — catalogIds 는 후보 목록에서 항목으로 되돌리고 웹 항목보다 앞에 선다', () => {
  const guard = {
    candidates: { products: [], contents: [{ id: 'ct-1', type: 'video', source: '유튜브', title: '내부 영상', url: 'https://www.youtube.com/watch?v=in1', meta: '2025년 5월' }] },
    referenceYear: 2026,
  }
  const { section, drops } = groundContentsSection(
    {
      kind: 'contents', title: '참고', reason: '', catalogIds: ['ct-1', 'ct-없음'],
      items: [
        { type: 'article', source: '블로그', title: '웹 글', url: 'https://blog.example.com/a', imageUrl: '', meta: '2025년 1월', snippet: '', duration: '', why: '' },
        { type: 'video', source: '유튜브', title: '내부 영상(중복)', url: 'https://www.youtube.com/watch?v=in1', imageUrl: '', meta: '', snippet: '', duration: '', why: '' },
      ],
    },
    guard,
  )
  assert.ok(drops.some((d) => d.code === 'catalog-miss'))
  assert.deepEqual(section.items.map((c) => c.title), ['내부 영상', '웹 글'])
})

test('폴백 풀 — 상품 검색 실패 시 뼈대 자리를 내부 후보(+데모 카탈로그)에서 채운다', () => {
  const guard = { candidates: { products: [candidate('gm-4400000001', { tags: ['쿠션', '밀착'] })], contents: [] } }
  const { sections, note } = catalogFallbackSections(
    [{ kind: 'guide', title: '베이스', subtitle: '', body: '' }, { kind: 'products', title: '밀착 쿠션 고르기', reason: '지성' }],
    guard,
  )
  assert.equal(note.code, 'catalog-fallback')
  assert.ok(sections[0].products.some((p) => p.id === 'gm-4400000001'))
})

test('PDP 정체 키·검증 판정 — 지마켓·올리브영·쿠팡은 번호 형식, 그 밖은 썸네일 유무', () => {
  assert.equal(pdpKeyOf('https://m.gmarket.co.kr/vi/product/4400000001'), 'gm:4400000001')
  assert.equal(pdpKeyOf('https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=A000000214358'), 'oy:a000000214358')
  assert.equal(pdpKeyOf('https://www.coupang.com/vp/products/7654321?itemId=1'), 'cp:7654321')
  assert.equal(pdpKeyOf('https://shop.example.com/p/1'), null)
  assert.equal(pdpVerified('https://shop.example.com/p/1', null), false)
  assert.equal(pdpVerified('https://shop.example.com/p/1', 'https://shop.example.com/og.jpg'), true)
  // 올리브영 후보와 같은 goodsNo 의 웹 상품은 후보로 대체된다
  const oy = candidate('oy-a000000214358', { mall: '올리브영', url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358', name: '올영 쿠션' })
  const { section, drops } = groundProductsSection(
    {
      kind: 'products', title: '추천', reason: '', productIds: [],
      webProducts: [{ name: '올영 쿠션', brand: '모의랩', price: 1, mall: '올리브영', url: 'https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=A000000214358', urlKind: 'pdp', imageUrl: '', tags: [] }],
    },
    0,
    { candidates: { products: [oy], contents: [] } },
  )
  assert.ok(drops.some((d) => d.code === 'duplicate-candidate'))
  assert.deepEqual(section.products.map((p) => p.id), ['oy-a000000214358'])
  assert.equal(section.products[0].match.factors.find((f) => f.key === 'evidence').score, 100)
})

test('수확 — 지마켓·올리브영·쿠팡은 번호 형식이면 verified, 그 밖의 몰은 썸네일이 있어야 verified, 검색 링크는 제외, 콘텐츠는 ct- 행', () => {
  const page = {
    headline: '', summary: '',
    sections: [
      { kind: 'products', title: '밀착 쿠션·픽서', reason: '', products: [
        { id: 'web-0-0', name: '쿠션 A', brand: '브랜드', price: 20000, tags: ['쿠션'], url: 'https://item.gmarket.co.kr/Item?goodscode=4400000009', mall: '지마켓' },
        { id: 'web-0-1', name: '올영 B', brand: '브랜드', price: 0, priceUnknown: true, tags: [], url: 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358', mall: '올리브영' },
        { id: 'web-0-2', name: '검색링크 C', brand: '브랜드', price: 1000, tags: [], url: 'https://browse.gmarket.co.kr/search?keyword=c', mall: '지마켓', urlKind: 'search' },
        { id: 'web-0-3', name: '쿠팡 D', brand: '브랜드', price: 9000, tags: [], url: 'https://www.coupang.com/vp/products/7654321', mall: '쿠팡' },
        { id: 'web-0-4', name: '무신사 E', brand: '브랜드', price: 9000, tags: [], url: 'https://www.musinsa.com/products/1', mall: '무신사', imageUrl: 'https://image.musinsa.com/e.jpg' },
        { id: 'web-0-5', name: '무명몰 F', brand: '브랜드', price: 9000, tags: [], url: 'https://shop.example.com/p/f', mall: '무명몰' },
        { id: 'p-012', name: '킬커버', brand: '클리오', price: 32000, tags: ['쿠션'], url: 'https://item.gmarket.co.kr/Item?goodsCode=4123344949', imageUrl: 'https://gdimg.gmarket.co.kr/4123344949/still/280' },
      ] },
      { kind: 'contents', title: '참고', reason: '', items: [{ type: 'video', source: '유튜브', title: '영상', url: 'https://www.youtube.com/watch?v=x', meta: '2025년 5월' }] },
    ],
  }
  const { products, contents } = harvestRowsOf(page, ['쿠션', '지성'], '2026-09-17T00:00:00.000Z')
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  assert.equal(byId['gm-4400000009'].verified, true)
  assert.equal(byId['gm-4400000009'].imageUrl, 'https://gdimg.gmarket.co.kr/4400000009/still/280')
  assert.ok(byId['gm-4400000009'].tags.includes('픽서'), '섹션 제목의 제품 유형도 태그로')
  assert.equal(byId['oy-a000000214358'].verified, true, '올리브영 goodsNo 형식이 맞으면 검증')
  assert.equal(byId['oy-a000000214358'].url, 'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000214358')
  assert.equal(byId['oy-a000000214358'].price, 0)
  assert.equal(byId['cp-7654321'].verified, true)
  assert.equal(byId['cp-7654321'].mall, '쿠팡')
  const musinsa = products.find((p) => p.mall === '무신사')
  assert.ok(musinsa.id.startsWith('web-') && musinsa.verified === true, '썸네일을 받아 온 다른 몰 상품은 검증')
  const unknown = products.find((p) => p.mall === '무명몰')
  assert.equal(unknown.verified, false, '번호 형식도 썸네일도 없으면 미검증')
  assert.ok(!products.some((p) => p.name === '검색링크 C'), '검색 링크 상품은 수확하지 않는다')
  assert.equal(byId['p-012'].source, 'thread')
  assert.equal(contents.length, 1)
  assert.ok(contents[0].id.startsWith('ct-') && contents[0].year === 2025 && contents[0].tags.includes('쿠션'))
})

test('대량 시딩 검색 단위 — 유형 × 조건 축, 결정적 순서, 기본은 유형만', () => {
  const base = catalogSeedQueries()
  assert.equal(base.length, CATALOG_SEED_KEYWORDS.length)
  assert.deepEqual(base[0], { keyword: CATALOG_SEED_KEYWORDS[0], query: CATALOG_SEED_KEYWORDS[0] })
  const some = catalogSeedQueries({ types: ['쿠션'], facets: ['skin', 'mall'] })
  assert.equal(some.length, 1 + 4 + 3)
  assert.deepEqual(some[1], { keyword: '쿠션', query: '지성 피부 쿠션', facet: 'skin' })
  assert.deepEqual(some.at(-1), { keyword: '쿠션', query: '쿠팡 쿠션', facet: 'mall' })
  assert.ok(buildCatalogSeedRequest('쿠션', { query: '지성 피부 쿠션', dense: true }).includes('검색 초점: 지성 피부 쿠션'))
  assert.ok(!buildCatalogSeedRequest('쿠션', { query: '쿠션' }).includes('검색 초점'))
  assert.ok(CATALOG_SEED_COST_PER_QUERY_USD.dense > CATALOG_SEED_COST_PER_QUERY_USD.normal)
})

test('웹 검색 시딩 — 검색 결과 상품이 몰별 id·정식 PDP 주소의 행으로, 검색 페이지·주소 없는 것은 버리고, source 는 search', () => {
  assert.ok(CATALOG_SEED_KEYWORDS.includes('쿠션') && CATALOG_SEED_KEYWORDS.includes('선크림') && CATALOG_SEED_KEYWORDS.length >= 40)
  const rows = seedProductRowsOf('선크림', [
    { name: '[여름 특가] 비오레 UV 아쿠아리치 워터리 에센스', brand: '비오레', price: 12900, mall: 'G마켓', url: 'https://m.gmarket.co.kr/vi/product/3471531930', imageUrl: '', tags: ['수분', '지성'] },
    { name: '라운드랩 자작나무 수분 선크림', brand: '라운드랩', price: 0, mall: '올리브영', url: 'https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=A000000214358', imageUrl: '//image.oliveyoung.co.kr/x.jpg', tags: ['수분'] },
    { name: '쿠팡 선크림', brand: 'x', price: 9900, mall: '쿠팡', url: 'https://www.coupang.com/vp/products/7654321', imageUrl: '', tags: [] },
    { name: '검색 페이지', brand: 'x', price: 1, mall: '지마켓', url: 'https://browse.gmarket.co.kr/search?keyword=x', imageUrl: '', tags: [] },
    { name: '무명몰 상품', brand: 'x', price: 1, mall: '무명몰', url: 'https://shop.example.com/p/1', imageUrl: '', tags: [] },
    { name: '주소 없음', brand: 'x', price: 1, mall: '지마켓', url: '', imageUrl: '', tags: [] },
  ], '2026-09-17T00:00:00.000Z')
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  assert.deepEqual(Object.keys(byId).sort(), ['cp-7654321', 'gm-3471531930', 'oy-a000000214358', `web-${fnv1a('https://shop.example.com/p/1')}`].sort())
  assert.equal(byId['gm-3471531930'].url, 'https://item.gmarket.co.kr/Item?goodscode=3471531930')
  assert.equal(byId['gm-3471531930'].imageUrl, 'https://gdimg.gmarket.co.kr/3471531930/still/280')
  assert.equal(byId['gm-3471531930'].name, '비오레 UV 아쿠아리치 워터리 에센스', '프로모션 대괄호 제거')
  assert.ok(byId['gm-3471531930'].tags.includes('선크림') && byId['gm-3471531930'].tags.includes('에센스'))
  assert.equal(byId['gm-3471531930'].source, 'search')
  assert.equal(byId['oy-a000000214358'].verified, true)
  assert.equal(byId['oy-a000000214358'].price, 0)
  assert.equal(byId['cp-7654321'].verified, true)
  assert.equal(byId[`web-${fnv1a('https://shop.example.com/p/1')}`].verified, false, '번호 형식도 썸네일도 없으면 미검증으로 저장')
  assert.ok(rows.every((r) => r.category === '선크림'))
})
