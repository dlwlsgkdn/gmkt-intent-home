import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import svc from '../dist/catalog/catalog.service.js'

const { CatalogService } = svc

/*
 * CatalogService 를 실제 Mongo 없이 돌린다 — 서비스가 쓰는 연산(find·sort·limit·countDocuments·bulkWrite updateOne upsert·
 * findOneAndUpdate·aggregate $group/$sort·listCollections·createIndex)만 흉내 낸 인메모리 컬렉션이다.
 * 갱신 연산자는 Mongo 규칙대로 적용한다: $setOnInsert 는 새 문서일 때만, 같은 경로를 두 연산자가 잡으면 거부.
 */

const cmp = (a, b) => {
  // Mongo 오름차순: null·없음이 먼저
  const na = a === null || a === undefined
  const nb = b === null || b === undefined
  if (na || nb) return na && nb ? 0 : na ? -1 : 1
  if (a instanceof Date) a = a.getTime()
  if (b instanceof Date) b = b.getTime()
  return a < b ? -1 : a > b ? 1 : 0
}
const eq = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)

function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      if (!cond.some((f) => matches(doc, f))) return false
      continue
    }
    if (key === '$and') {
      if (!cond.every((f) => matches(doc, f))) return false
      continue
    }
    const v = doc[key]
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ('$in' in cond && !cond.$in.some((x) => eq(v, x))) return false
      if ('$regex' in cond && !(typeof v === 'string' && new RegExp(cond.$regex).test(v))) return false
      if ('$lt' in cond && !(v !== null && v !== undefined && cmp(v, cond.$lt) < 0)) return false
      continue
    }
    if (!eq(v, cond)) return false
  }
  return true
}

function applyUpdate(doc, update, inserting) {
  const seen = new Set()
  for (const fields of Object.values(update)) {
    for (const k of Object.keys(fields)) {
      if (seen.has(k)) throw new Error(`ConflictingUpdateOperators: ${k}`)
      seen.add(k)
    }
  }
  const out = { ...doc }
  if (inserting) Object.assign(out, update.$setOnInsert ?? {})
  Object.assign(out, update.$set ?? {})
  for (const [k, n] of Object.entries(update.$inc ?? {})) out[k] = (out[k] ?? 0) + n
  return out
}

class FakeCollection {
  constructor() {
    this.docs = new Map()
    this.indexes = []
  }
  find(filter = {}) {
    let rows = [...this.docs.values()].filter((d) => matches(d, filter)).map((d) => ({ ...d }))
    const cursor = {
      sort: (spec) => {
        const keys = Object.entries(spec)
        rows.sort((a, b) => {
          for (const [k, dir] of keys) {
            const c = cmp(a[k], b[k]) * dir
            if (c) return c
          }
          return 0
        })
        return cursor
      },
      limit: (n) => {
        rows = rows.slice(0, n)
        return cursor
      },
      toArray: async () => rows,
    }
    return cursor
  }
  async countDocuments(filter = {}) {
    return [...this.docs.values()].filter((d) => matches(d, filter)).length
  }
  async bulkWrite(ops) {
    for (const op of ops) {
      if (op.replaceOne) {
        // 시딩·가져오기 경로 — 문서째 덮는다
        const { filter, replacement, upsert } = op.replaceOne
        const hit = [...this.docs.values()].find((d) => matches(d, filter))
        if (hit || upsert) this.docs.set(replacement._id, { ...replacement })
        continue
      }
      const { filter, update, upsert } = op.updateOne
      const hit = [...this.docs.values()].find((d) => matches(d, filter))
      if (hit) this.docs.set(hit._id, applyUpdate(hit, update, false))
      else if (upsert) this.docs.set(filter._id, applyUpdate({ _id: filter._id }, update, true))
    }
  }
  async findOneAndUpdate(filter, update) {
    const hit = [...this.docs.values()].find((d) => matches(d, filter))
    if (!hit) return null
    const next = applyUpdate(hit, update, false)
    this.docs.set(hit._id, next)
    return { ...next }
  }
  aggregate(pipeline) {
    const field = pipeline[0].$group._id.slice(1)
    const counts = new Map()
    for (const d of this.docs.values()) counts.set(d[field] ?? null, (counts.get(d[field] ?? null) ?? 0) + 1)
    const rows = [...counts]
      .map(([_id, count]) => ({ _id, count }))
      .sort((a, b) => b.count - a.count || cmp(a._id, b._id))
    return { toArray: async () => rows }
  }
  async createCollection(name) {
    return name
  }
  async createIndex(spec, opts) {
    this.indexes.push(opts.name)
    return opts.name
  }
}

function fakeMongo() {
  const colls = new Map()
  const collection = (name) => {
    if (!colls.has(name)) colls.set(name, new FakeCollection())
    return colls.get(name)
  }
  const db = {
    collection,
    createCollection: async (name) => collection(name),
    listCollections: (q = {}) => ({
      toArray: async () => [...colls.keys()].filter((name) => !q.name || q.name === name).map((name) => ({ name })),
    }),
  }
  return { colls, collection, db: () => db }
}

const product = (id, extra = {}) => ({
  id,
  mall: '지마켓',
  mallProductId: id.replace('gm-', ''),
  name: `${id} 수분 선크림`,
  brand: '라운드랩',
  price: 18000,
  url: `https://item.gmarket.co.kr/Item?goodscode=${id}`,
  imageUrl: null,
  tags: ['선크림'],
  category: '선크림',
  source: 'search',
  verified: true,
  ...extra,
})

test('Mongo 가 없으면 503 — 부팅은 되고 DB 라우트만 실패한다(쓰레드와 같은 규칙)', async () => {
  const service = new CatalogService({ collection: () => null, db: () => null })
  await assert.rejects(() => service.stats(), /Mongo에 연결되지 않았습니다/)
  await assert.rejects(() => service.ensureSchema(), /Mongo에 연결되지 않았습니다/)
})

test('upsert → 검색 — 점수순, 기본은 검증·active 만, 총계는 active 전체', async () => {
  const service = new CatalogService(fakeMongo())
  await service.upsertProducts([
    product('gm-1', { name: '데일리 쿠션', tags: ['쿠션'], category: '쿠션' }),
    product('gm-2'),
    product('gm-3', { verified: false }),
    product('gm-4', { status: 'dead' }),
  ])
  const r = await service.searchProducts({ terms: ['선크림', '수분'], typeTerms: ['선크림'] })
  assert.deepEqual(r.items.map((i) => i.id), ['gm-2'])
  assert.equal(r.items[0].score, 3)
  assert.equal(r.total, 3) // dead 제외
  const all = await service.searchProducts({ terms: ['선크림'], verifiedOnly: false })
  assert.deepEqual(all.items.map((i) => i.id), ['gm-2', 'gm-3']) // 동률은 검증이 앞선다
})

test('수확(bump) — 노출 횟수는 쌓이고, 검증은 되돌아가지 않고, 태그는 합쳐진다', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  await service.upsertProducts([product('gm-1', { source: 'search', verified: true, tags: ['선크림'] })])
  await service.upsertProducts([product('gm-1', { source: 'thread', verified: false, tags: ['수분'], recommendCount: 1 })], true)
  await service.upsertProducts([product('gm-1', { source: 'thread', verified: false, tags: ['데일리'], recommendCount: 1 })], true)
  const doc = m.collection('catalog_products').docs.get('gm-1')
  assert.equal(doc.recommendCount, 2)
  assert.equal(doc.verified, true)
  assert.equal(doc.source, 'search') // 출처 보존
  assert.deepEqual(doc.tags, ['선크림', '수분', '데일리'])
  assert.match(doc.searchText, /데일리/)
})

test('수확으로 처음 들어온 상품 — 새 문서로 생기고 출처·검증은 들어온 값', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  await service.upsertProducts([product('web-abc', { source: 'thread', verified: false, recommendCount: 1 })], true)
  const doc = m.collection('catalog_products').docs.get('web-abc')
  assert.equal(doc.source, 'thread')
  assert.equal(doc.verified, false)
  assert.equal(doc.recommendCount, 1)
  assert.equal(doc.status, 'active')
  assert.ok(doc.createdAt instanceof Date)
})

test('둘러보기 — updatedAt 내림차순 키셋 커서로 끝까지 겹치지 않고 넘긴다', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  await service.upsertProducts(Array.from({ length: 7 }, (_, i) => product(`gm-${i}`)))
  // 같은 시각에 들어간 행이 섞여도 _id 가 동률을 가른다 — 일부만 시각을 바꿔 둘 다 시험한다
  const coll = m.collection('catalog_products')
  coll.docs.get('gm-5').updatedAt = new Date('2026-09-23T00:00:00Z')
  const seen = []
  let cursor
  for (let page = 0; page < 5; page++) {
    const r = await service.listProducts({ limit: 3, cursor })
    assert.equal(r.total, 7)
    seen.push(...r.items.map((i) => i.id))
    cursor = r.nextCursor
    if (!cursor) break
  }
  assert.equal(seen.length, 7)
  assert.equal(new Set(seen).size, 7)
  assert.equal(seen[0], 'gm-5')
})

test('둘러보기 필터 — 미검증·dead 도 보이고, 검색어는 부분 일치', async () => {
  const service = new CatalogService(fakeMongo())
  await service.upsertProducts([product('gm-1', { verified: false }), product('gm-2', { status: 'dead', name: '데일리 쿠션', tags: [] })])
  assert.equal((await service.listProducts({})).total, 2)
  assert.deepEqual((await service.listProducts({ q: '쿠 션' })).items.map((i) => i.id), ['gm-2'])
  assert.deepEqual((await service.listProducts({ verified: 'false' })).items.map((i) => i.id), ['gm-1'])
})

test('표시(patch) — verified·status 만 바꾸고, 없는 id 는 404', async () => {
  const service = new CatalogService(fakeMongo())
  await service.upsertProducts([product('gm-1')])
  const w = await service.patchProduct('gm-1', { status: 'dead' })
  assert.equal(w.status, 'dead')
  assert.equal(w.verified, true)
  await assert.rejects(() => service.patchProduct('gm-x', { verified: false }), /카탈로그 상품이 없습니다/)
})

test('점검 대상 — active 만, 오래 안 본 순, mall 필터', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  await service.upsertProducts([
    product('gm-1', { lastSeenAt: '2026-09-10T00:00:00Z' }),
    product('gm-2', { lastSeenAt: '2026-09-01T00:00:00Z' }),
    product('oy-a000000000001', { mall: '올리브영', lastSeenAt: '2026-08-01T00:00:00Z' }),
    product('gm-3', { status: 'dead', lastSeenAt: '2026-01-01T00:00:00Z' }),
  ])
  assert.deepEqual((await service.listForVerify('*', 10)).items.map((i) => i.id), ['oy-a000000000001', 'gm-2', 'gm-1'])
  assert.deepEqual((await service.listForVerify('지마켓', 10)).items.map((i) => i.id), ['gm-2', 'gm-1'])
})

test('콘텐츠 — upsert·검색·수확이 상품과 같은 규칙으로 돈다', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  const content = (id, extra = {}) => ({
    id,
    type: 'video',
    source: '유튜브',
    title: '선크림 고르는 법',
    url: `https://youtu.be/${id}`,
    tags: ['선크림'],
    verified: true,
    ...extra,
  })
  await service.upsertContents([content('ct-a', { year: 2024 }), content('ct-b', { year: 2026 }), content('ct-c')])
  await service.upsertContents([content('ct-a', { recommendCount: 1, meta: null, year: null })], true)
  const r = await service.searchContents({ terms: ['선크림'] })
  assert.deepEqual(r.items.map((i) => i.id), ['ct-a', 'ct-b', 'ct-c'])
  assert.equal(m.collection('catalog_contents').docs.get('ct-a').year, 2024) // 연도 없는 수확이 기존 연도를 지우지 않는다
})

test('현황(stats) — 개수·몰별·출처별·검증·dead·최근 갱신', async () => {
  const service = new CatalogService(fakeMongo())
  await service.upsertProducts([
    product('gm-1'),
    product('gm-2', { verified: false, source: 'thread' }),
    product('oy-a000000000001', { mall: '올리브영', source: 'manual', status: 'dead' }),
  ])
  const s = await service.stats()
  assert.equal(s.products.total, 3)
  assert.equal(s.products.verified, 1)
  assert.equal(s.products.dead, 1)
  assert.deepEqual(s.products.byMall, [
    { mall: '지마켓', count: 2 },
    { mall: '올리브영', count: 1 },
  ])
  assert.equal(s.contents.total, 0)
  assert.ok(s.updatedAt)
})

test('인덱스 보장(옛 「표 만들기」) — 멱등, 처음엔 created=true 두 번째엔 false, 계약 { ok, created }', async () => {
  const m = fakeMongo()
  const service = new CatalogService(m)
  assert.deepEqual(await service.ensureSchema(), { ok: true, created: true })
  assert.deepEqual(await service.ensureSchema(), { ok: true, created: false })
  assert.ok(m.collection('catalog_products').indexes.includes('catalog_products_updated_idx'))
  assert.ok(m.collection('catalog_contents').indexes.includes('catalog_contents_updated_idx'))
})
