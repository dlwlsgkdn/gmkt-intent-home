# 태깅 검토 단위를 카탈로그로 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 태깅 검토 스튜디오의 작업 단위를 몰 리스팅(`products` 1011건)에서 카탈로그(`catalog` 946건)로 옮기고, 묶인 몰 리스팅을 판단 근거로 화면에 붙인다.

**Architecture:** `apps/tagging-api`가 `catalog`와 `products`를 각각 투영 질의로 한 번씩 읽어 `catalog_id` 기준으로 메모리에서 조인한다. 문서↔화면 변환과 되쓰기 화이트리스트는 지금처럼 `src/mapping.ts` 순수 함수 한 곳에 둔다 — 그래야 Mongo 없이 `node --test`로 검증된다. FE는 좌측 상품 정보 패널에 몰별 리스팅 카드를 세우고, 이미 만들어져 있으나 `source !== 'remote'` 가드로 가려져 있던 필드별 확신도 UI를 연다.

**Tech Stack:** NestJS 11 · mongodb 6 · React 18 + Vite 5 · `node --test` (추가 의존 없음) · `compression` 1.8.1 (신규, 사내 미러 확인됨)

**Spec:** [docs/superpowers/specs/2026-09-09-catalog-tagging-design.md](../specs/2026-09-09-catalog-tagging-design.md)

## Global Constraints

- **되쓰기 화이트리스트는 `src/mapping.ts` 밖에 두지 않는다.** 수집 파이프라인이 채운 필드를 검토 화면이 덮는 사고를 구조로 막는 장치다.
- **테스트는 Mongo·네트워크에 붙지 않는다.** `node --test test/*.test.mjs`, 순수 함수만. (`test/` 전체 경로가 아니라 glob인 이유: 이 머신 Node 22.14에서 디렉터리 인자가 실패한다.)
- **`review_status` 값은 Flask 대시보드와 공유한다** — `reviewed` / `needs_fix` / `auto_ok` / `unreviewed` 외의 값을 쓰지 않는다.
- **`nowIso()` 형식을 바꾸지 않는다** — Python `store.py`의 `_now()`와 같아야 한다 (`2026-09-09T01:02:03+00:00`).
- **Node ≥ 20** (루트 `package.json` engines).
- 커밋 메시지는 한국어, 본문에 "왜"를 적는다. 기존 이력 참고.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `apps/tagging-api/src/mapping.ts` | 문서↔화면 변환·화이트리스트 (순수) | 수정 |
| `apps/tagging-api/test/mapping.test.mjs` | 위 검증 | 수정 |
| `apps/tagging-api/src/tagging.service.ts` | Mongo I/O·조인 | 수정 |
| `apps/tagging-api/src/tagging.controller.ts` | 라우트 (`:productId` → `:catalogId`) | 수정 |
| `apps/tagging-api/src/main.ts` | gzip 미들웨어 | 수정 |
| `apps/tagging-api/.env.example` | `CATALOG_COLL` | 수정 |
| `apps/studio/src/components/TaggingStudio.jsx` | 리스팅 카드·확신도 노출·미연결 필터 | 수정 |
| `apps/studio/src/lib/taggingCatalog.js` | `EMPTY_UNIT` 확장·부트스트랩 반환 | 수정 |
| `apps/studio/src/styles/tagging.css` | 리스팅 카드 스타일 | 수정 |
| `CLAUDE.md` · `TAGGING-DATA-CONTRACT.md` | 계약 문서 | 수정 |

---

## Task 1: 카탈로그 문서 → 화면 단위 변환

**Files:**
- Modify: `apps/tagging-api/src/mapping.ts`
- Test: `apps/tagging-api/test/mapping.test.mjs`

**Interfaces:**
- Consumes: 기존 `FIELD_SLOTS`·`FIELD_KEYS`·`asList`·`repOf`·`CONFIDENCE_PCT`
- Produces:
  - `toListingCard(productDoc): ListingCard` — `{ productId, mall, brand, price, url, imageUrl, optionCount, copy, review }`
  - `toCatalogUnit(catalogDoc, listings: any[]): Unit` — 기존 `toUnit` 반환에 `listings`·필드별 `confidence`/`rationale`·`ingredients`·`volumeMl` 추가, `id`는 `catalog_id`
  - `joinListings(catalogDocs, productDocs): { units, unlinked }`
  - `toUnlinkedCard(productDoc)` — `{ productId, mall, name, brand, imageUrl }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/tagging-api/test/mapping.test.mjs` 끝에 붙인다. 상단 구조분해에 새 이름을 추가한다:

```js
const { toUnit, toDocPatch, sanitizeTaxonomyDoc, readCacheEnvelope,
        toCatalogUnit, toListingCard, toUnlinkedCard, joinListings } = mapping
```

```js
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

test('toCatalogUnit — field_confidence 에 없는 필드는 문서 단위 confidence 로 떨어진다', () => {
  const u = toCatalogUnit(CAT, [])
  assert.equal(u.fields.condition.confidence, 90) // 문서 confidence='high'
  assert.equal(u.fields.condition.rationale, '상품명에 선스틱이 명시됨')
})

test('toListingCard — 몰 배지는 source, 없으면 oliveyoung', () => {
  assert.equal(toListingCard(OY).mall, 'oliveyoung')
  assert.equal(toListingCard(GM).mall, 'gmarket')
})

test('toListingCard — 지마켓은 url 이 없어 null 이다 (PDP 버튼을 감추는 근거)', () => {
  assert.equal(toListingCard(GM).url, null)
  assert.equal(toListingCard(OY).url, 'https://www.oliveyoung.co.kr/p/1')
})

test('toListingCard — 리뷰·상세문구는 있는 리스팅에만', () => {
  assert.match(toListingCard(OY).review, /리뷰 1,204건/)
  assert.equal(toListingCard(OY).copy, '가벼운 마무리')
  assert.equal(toListingCard(GM).review, '')
  assert.equal(toListingCard(GM).copy, '')
})

test('toCatalogUnit — 대표 리스팅(올리브영 우선)의 문구를 상단에 올린다', () => {
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

test('joinListings — 어느 카탈로그에도 안 묶인 리스팅은 unlinked 로만 나온다', () => {
  const orphan = { product_id: 'A999', name: '미연결', image_url: null }
  const { units, unlinked } = joinListings([CAT], [OY, orphan])
  assert.equal(units.length, 1)
  assert.deepEqual(unlinked.map((u) => u.productId), ['A999'])
  assert.equal(unlinked[0].mall, 'oliveyoung')
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: FAIL — `toCatalogUnit is not a function`

- [ ] **Step 3: 최소 구현을 쓴다**

`apps/tagging-api/src/mapping.ts`의 `toUnit` **아래**에 붙인다. 기존 `toUnit`·`toDocPatch`는 손대지 않는다 (`toDocPatch`는 문서 모양을 가리지 않아 카탈로그에도 그대로 쓰인다).

```ts
/* ── 카탈로그 단위 ──────────────────────────────────────────────────────
 * 검토 단위는 카탈로그(몰 중립 상품 실체)이고, 몰 리스팅은 판단 근거로 붙는다.
 * 카탈로그엔 가격·PDP·리뷰가 하나도 없다(실측 0/946) — 전부 리스팅에서 온다.
 */

const mallOf = (doc: any): string => doc.source || 'oliveyoung'

export function toListingCard(doc: any) {
  return {
    productId: doc.product_id,
    mall: mallOf(doc),
    brand: doc.brand_name || doc.brand || doc.inferred_brand || '',
    price: typeof doc.price === 'number' ? doc.price : null,
    url: doc.url || null,
    imageUrl: doc.image_url || null,
    optionCount: Array.isArray(doc.options) ? doc.options.length : 0,
    copy: doc.product_info?.['제품 주요 사양'] || doc.usage_method || '',
    review: reviewText(doc),
  }
}

export function toUnlinkedCard(doc: any) {
  return {
    productId: doc.product_id,
    mall: mallOf(doc),
    name: doc.name || '',
    brand: doc.brand_name || doc.brand || doc.inferred_brand || '',
    imageUrl: doc.image_url || null,
  }
}

/* 문구·리뷰는 올리브영 리스팅에만 있다. 대표를 하나 골라 상단 줄에 쓴다. */
const primaryListing = (cards: ReturnType<typeof toListingCard>[]) =>
  cards.find((c) => c.mall === 'oliveyoung' && (c.copy || c.review)) ||
  cards.find((c) => c.copy || c.review) ||
  cards[0] ||
  null

export function toCatalogUnit(doc: any, listings: any[]) {
  const base = toUnit(doc)
  const cards = listings.map(toListingCard)
  const primary = primaryListing(cards)
  const docPct = CONFIDENCE_PCT[doc.confidence] ?? 0

  const fields = {} as Record<FieldKey, Field & { confidence: number; rationale: string }>
  for (const key of FIELD_KEYS) {
    const fc = doc.field_confidence?.[key]
    fields[key] = {
      ...base.fields[key],
      confidence: fc ? (CONFIDENCE_PCT[fc.level] ?? 0) : docPct,
      rationale: (fc && typeof fc.rationale === 'string' ? fc.rationale : doc.rationale) || '',
    }
  }

  return {
    ...base,
    fields,
    id: doc.catalog_id,
    brand: doc.brand_name || doc.brand || doc.inferred_brand || '',
    option: cards.length ? `리스팅 ${cards.length}곳` : '리스팅 없음',
    price: null,
    url: null,
    copy: primary?.copy || '',
    review: primary?.review || '',
    ingredients: Array.isArray(doc.ingredients_from_spec) ? doc.ingredients_from_spec : [],
    volumeMl: typeof doc.volume_ml === 'number' ? doc.volume_ml : null,
    listings: cards,
  }
}

/* 두 컬렉션을 한 번씩 읽어 메모리에서 맞춘다 — products.catalog_ids 에 인덱스가 없어
   카탈로그마다 질의하면 느리다(실측: 조인 7ms). */
export function joinListings(catalogDocs: any[], productDocs: any[]) {
  const byCatalog = new Map<string, any[]>()
  const bound = new Set<string>()
  for (const p of productDocs) {
    const ids = Array.isArray(p.catalog_ids) ? p.catalog_ids : []
    if (ids.length) bound.add(p.product_id)
    for (const id of ids) {
      const list = byCatalog.get(id)
      if (list) list.push(p)
      else byCatalog.set(id, [p])
    }
  }
  const units = catalogDocs
    .filter((d) => !d.merged_into) // 병합으로 흡수된 묘비 문서(실측 14건)
    .map((d) => toCatalogUnit(d, byCatalog.get(d.catalog_id) || []))
  const unlinked = productDocs.filter((p) => !bound.has(p.product_id)).map(toUnlinkedCard)
  return { units, unlinked }
}
```

`toUnit`이 `CONFIDENCE_PCT`를 이미 쓰므로 추가 import는 없다.

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: PASS — 기존 42개 + 신규 9개 = 51개

- [ ] **Step 5: 커밋**

```bash
git add apps/tagging-api/src/mapping.ts apps/tagging-api/test/mapping.test.mjs
git commit -m "feat(tagging): 카탈로그 문서를 검토 단위로 변환하는 순수 함수

검토 단위를 몰 리스팅에서 카탈로그로 옮기기 위한 첫 조각이다. 카탈로그엔
가격·PDP·리뷰가 하나도 없어(실측 0/946) 묶인 리스팅에서 가져와야 하고,
브랜드는 지마켓 리스팅 89건이 숫자 id 라 brand_name 을 우선한다.

field_confidence 는 화면과 같은 7키로 필드별 확신도·근거를 갖는다 — 없는
필드만 문서 단위 confidence 로 떨어뜨린다.

되쓰기(toDocPatch)는 문서 모양을 가리지 않아 그대로 쓴다."
```

---

## Task 2: 서비스·라우트를 카탈로그로 전환

**Files:**
- Modify: `apps/tagging-api/src/tagging.service.ts`
- Modify: `apps/tagging-api/src/tagging.controller.ts`
- Modify: `apps/tagging-api/.env.example`

**Interfaces:**
- Consumes: Task 1의 `joinListings`
- Produces: `GET /api/tagging/bootstrap` → `{ taxonomy, taxonomyMeta, units, unlinked }`; `PATCH|POST /api/tagging/units/:catalogId`

- [ ] **Step 1: `.env.example`에 컬렉션 이름을 추가한다**

`apps/tagging-api/.env.example`의 `MONGO_COLL=products` 줄 **아래**에 붙인다:

```
# 검토 단위인 카탈로그(몰 중립 상품 실체) 컬렉션. MONGO_COLL 은 몰 리스팅으로 계속 쓴다 —
# 가격·PDP·리뷰가 카탈로그엔 없어 리스팅에서 읽는다.
CATALOG_COLL=catalog
```

- [ ] **Step 2: 서비스를 카탈로그 기준으로 다시 쓴다**

`apps/tagging-api/src/tagging.service.ts` 전문을 아래로 바꾼다:

```ts
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { decisionToReview, joinListings, nowIso, toCatalogUnit, toDocPatch } from './mapping'

/* 화면이 쓰는 필드만 가져온다. 투영이 없으면 11.53MB 를 통째로 끌어와 2.7초가 걸린다
   (실측) — toUnit 이 대부분 버리는데도. 투영 후 두 질의 병렬로 276ms. */
const CATALOG_FIELDS = [
  'catalog_id', 'merged_into', 'name', 'brand', 'brand_name', 'inferred_brand', 'image_url',
  'ingredients_from_spec', 'volume_ml', 'formulation', 'ingredient_tags',
  'confidence', 'field_confidence', 'rationale', 'review_status', 'review_meta',
  'inferred_category', 'sub_type', 'body_part',
  'skin_types', 'skin_types_primary', 'concerns', 'concerns_primary',
  'results', 'results_primary', 'conditions', 'conditions_primary',
]
const LISTING_FIELDS = [
  'product_id', 'catalog_ids', 'source', 'name', 'brand', 'brand_name', 'inferred_brand',
  'price', 'url', 'image_url', 'options', 'product_info', 'usage_method',
  'review_stats', 'review_ai_summary',
]
const projection = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, 1]))

@Injectable()
export class TaggingService {
  constructor(private readonly mongo: MongoService, private readonly taxonomy: TaxonomyService) {}

  private catalog() {
    const collection = this.mongo.collection(process.env.CATALOG_COLL || 'catalog')
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  private listings() {
    const collection = this.mongo.collection()
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  /* 카탈로그 946건 + 리스팅 요약을 한 번에 보낸다(gzip 후 506KB). 목록/상세를 나누지
     않는 이유: 병목은 건수가 아니라 투영 누락이었다 — 설계 문서 §4-5. */
  async bootstrap() {
    const [catalogDocs, productDocs] = await Promise.all([
      this.catalog().find({}, { projection: projection(CATALOG_FIELDS) }).toArray(),
      this.listings().find({ status: 'analyzed' }, { projection: projection(LISTING_FIELDS) }).toArray(),
    ])
    const { units, unlinked } = joinListings(catalogDocs, productDocs)
    const { taxonomy, source, rev, updatedAt, cachedAt } = await this.taxonomy.read()
    return { taxonomy, units, unlinked, taxonomyMeta: { source, rev, updatedAt, cachedAt } }
  }

  /* 대시보드 타일용 — 본문을 받지 않으려고 따로 둔다. */
  async summary() {
    const docs = await this.catalog()
      .find({ merged_into: { $exists: false } }, { projection: { review_status: 1 } })
      .toArray()
    const counts = { done: 0, unreviewed: 0, approved: 0, rejected: 0 }
    for (const doc of docs) {
      if (doc.review_status === 'reviewed') counts.approved += 1
      else if (doc.review_status === 'needs_fix') counts.rejected += 1
      else if (doc.review_status === 'auto_ok') counts.done += 1
      else counts.unreviewed += 1
    }
    return { counts, total: docs.length }
  }

  private async findUnit(catalogId: string) {
    const doc = await this.catalog().findOne({ catalog_id: catalogId })
    if (!doc) throw new NotFoundException(`카탈로그 ${catalogId}을(를) 찾을 수 없습니다`)
    return doc
  }

  /* 되쓰기 뒤 화면에 돌려줄 단위를 만들 때도 묶인 리스팅을 다시 붙인다 —
     응답 모양이 bootstrap 과 같아야 FE 가 한 규칙으로 읽는다. */
  private async withListings(doc: any) {
    const listings = await this.listings()
      .find({ catalog_ids: doc.catalog_id }, { projection: projection(LISTING_FIELDS) })
      .toArray()
    return toCatalogUnit(doc, listings)
  }

  async saveUnit(catalogId: string, patch: unknown) {
    const doc = await this.findUnit(catalogId)
    const set = toDocPatch(patch, doc)
    await this.catalog().updateOne({ catalog_id: catalogId }, { $set: set })
    return this.withListings({ ...doc, ...set })
  }

  async setDecision(catalogId: string, decision: unknown) {
    const doc = await this.findUnit(catalogId)
    const set = { ...decisionToReview(decision), updated_at: nowIso() }
    await this.catalog().updateOne({ catalog_id: catalogId }, { $set: set })
    return this.withListings({ ...doc, ...set })
  }
}
```

- [ ] **Step 3: 라우트 파라미터 이름을 맞춘다**

`apps/tagging-api/src/tagging.controller.ts`의 18~26행을 바꾼다 (경로 문자열은 그대로 — FE가 부르는 주소는 변하지 않는다):

```ts
  @Patch('units/:catalogId')
  save(@Param('catalogId') catalogId: string, @Body() body: unknown) {
    return this.tagging.saveUnit(catalogId, body)
  }

  @Post('units/:catalogId/review')
  review(@Param('catalogId') catalogId: string, @Body() body: { decision?: unknown }) {
    return this.tagging.setDecision(catalogId, body?.decision ?? null)
  }
```

- [ ] **Step 4: 빌드·테스트가 통과하는지 본다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: PASS 51개 (Task 1과 동일 — 서비스는 순수 함수가 아니라 테스트가 없다)

- [ ] **Step 5: 실제 Mongo로 확인한다**

```bash
cd apps/tagging-api && PORT=8799 node dist/main.js &
sleep 4
curl -s http://127.0.0.1:8799/api/tagging/bootstrap \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
      console.log('units', j.units.length, '· unlinked', j.unlinked.length);
      console.log('첫 단위 id', j.units[0].id, '· 리스팅', j.units[0].listings.length);
      console.log('리스팅 없는 단위', j.units.filter(u=>!u.listings.length).length)})"
curl -s http://127.0.0.1:8799/api/tagging/summary
lsof -ti tcp:8799 | xargs -r kill
```

Expected: `units 946 · unlinked 82`, 첫 단위 id가 `c-`로 시작, **리스팅 없는 단위 0**, summary `total: 946`

- [ ] **Step 6: 커밋**

```bash
git add apps/tagging-api/src/tagging.service.ts apps/tagging-api/src/tagging.controller.ts apps/tagging-api/.env.example
git commit -m "feat(tagging): 검토 단위를 카탈로그로 — 리스팅은 근거로 붙인다

같은 상품이 여러 몰에 걸리면 리스팅마다 따로 검토하게 되던 문제를 없앤다
(실측: 한 카탈로그에 두 몰이 묶인 14건 중 12건이 한쪽만 검토된 상태였다).

두 컬렉션을 투영 질의로 한 번씩 병렬로 읽어 메모리에서 조인한다 —
products.catalog_ids 에 인덱스가 없어 카탈로그마다 질의하면 느리다.
투영이 핵심이다: 없으면 11.53MB 를 끌어와 2.7초, 있으면 276ms."
```

---

## Task 3: 응답 gzip 압축

**Files:**
- Modify: `apps/tagging-api/src/main.ts`
- Modify: `apps/tagging-api/package.json`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (전송 계층)

- [ ] **Step 1: 의존성을 추가한다**

```bash
npm install --workspace=ddak-tagging-api --save compression@^1.8.1
npm install --workspace=ddak-tagging-api --save-dev @types/compression
```

- [ ] **Step 2: 미들웨어를 단다**

`apps/tagging-api/src/main.ts`에서 import를 추가하고,

```ts
import compression from 'compression'
```

`app.use('/api/bff', proxy)` **다음**, `app.use(json(...))` **앞**에 넣는다:

```ts
  /* 부트스트랩 응답이 2.29MB 라 압축이 크게 듣는다(실측 506KB). BFF 프록시 뒤에 두는
     이유: 프록시는 상류 응답을 그대로 흘려야 하고(SSE), 이미 압축된 것을 다시 건드리지
     않는다. */
  app.use(compression())
```

- [ ] **Step 3: 실제로 압축되는지 확인한다**

```bash
npm run build --workspace=apps/tagging-api
cd apps/tagging-api && PORT=8799 node dist/main.js &
sleep 4
curl -s -D- -o /dev/null -H 'accept-encoding: gzip' http://127.0.0.1:8799/api/tagging/bootstrap | grep -i 'content-encoding'
curl -s -H 'accept-encoding: gzip' -o /dev/null -w '압축 후 %{size_download} bytes\n' http://127.0.0.1:8799/api/tagging/bootstrap
lsof -ti tcp:8799 | xargs -r kill
```

Expected: `content-encoding: gzip`, 크기 약 500KB (압축 전 2.29MB)

- [ ] **Step 4: 커밋**

```bash
git add apps/tagging-api/src/main.ts apps/tagging-api/package.json package-lock.json
git commit -m "perf(tagging): 응답을 gzip 압축한다 — 2.29MB에서 506KB로

압축이 아예 꺼져 있었다(NestJS 기본은 무압축). 부트스트랩이 카탈로그 946건과
리스팅 요약을 한 번에 보내므로 사내망 원격 접속에서 체감 차이가 크다.

BFF 프록시 뒤에 둔다 — 프록시는 상류 응답을 버퍼링 없이 흘려야 한다(SSE)."
```

---

## Task 4: 화면에 몰 리스팅 카드를 세우고 필드별 확신도를 연다

**Files:**
- Modify: `apps/studio/src/components/TaggingStudio.jsx`
- Modify: `apps/studio/src/lib/taggingCatalog.js`
- Modify: `apps/studio/src/styles/tagging.css`

**Interfaces:**
- Consumes: Task 2의 `unit.listings[]`, `unit.fields[k].confidence|rationale`
- Produces: 없음 (화면)

- [ ] **Step 1: `EMPTY_UNIT`에 새 키를 추가한다**

`apps/studio/src/components/TaggingStudio.jsx` 32~38행의 `EMPTY_UNIT`에서 첫 줄을 바꾼다:

```js
  id: null, brand: '', name: '', option: '', price: null, imageUrl: null, catalogTags: [],
  listings: [], ingredients: [], volumeMl: null,
```

- [ ] **Step 2: 상품 정보 패널의 가격 줄을 리스팅 카드로 바꾼다**

`TaggingStudio.jsx`의 `<dt>가격</dt><dd>{formatPrice(unit.price)}</dd>` 두 줄을 아래로 교체한다:

```jsx
              <dt>판매 중인 몰</dt>
              <dd className="sb-tagging-listings">
                {unit.listings.length === 0 && <span className="sb-tagging-listings__none">묶인 리스팅이 없어요.</span>}
                {unit.listings.map((l) => (
                  <div key={l.productId} className="sb-tagging-listing">
                    <span className={`sb-tagging-mall sb-tagging-mall--${l.mall}`}>
                      {l.mall === 'gmarket' ? '지마켓' : '올리브영'}
                    </span>
                    <b>{formatPrice(l.price)}</b>
                    {l.optionCount > 1 && <em>옵션 {l.optionCount}개</em>}
                    {l.url
                      ? <a href={l.url} target="_blank" rel="noreferrer">상세페이지</a>
                      : <span className="sb-tagging-listing__nolink">상세페이지 없음</span>}
                  </div>
                ))}
              </dd>
```

- [ ] **Step 3: 필드별 확신도·근거의 remote 가드를 뗀다**

같은 파일에서 두 곳을 고친다.

676행 부근 — `{source !== 'remote' && (` 로 시작해 확신도 `<span>`을 감싸는 조건을 없앤다:

```jsx
                    <span
                      className={`sb-tagging-conf sb-tagging-conf--${confLevel(field.confidence)}`}
                      title="AI 확신도"
                    >
                      <i style={{ width: `${field.confidence}%` }} />
                      <b>{field.confidence}%</b>
                    </span>
```

767행 — 근거 접기에서 `source !== 'remote' &&` 를 뺀다:

```jsx
                {openWhy[def.key] && <p className="sb-tagging-rationale">{field.rationale}</p>}
```

- [ ] **Step 4: 스타일을 넣는다**

`apps/studio/src/styles/tagging.css` **끝**에 붙인다:

```css
/* 묶인 몰 리스팅 — 카탈로그엔 가격·PDP가 없어 여기가 유일한 출처다 */
.sb-tagging-listings { display: grid; gap: 6px; }
.sb-tagging-listings__none { color: var(--sb-muted); }
.sb-tagging-listing { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sb-tagging-listing b { font-weight: 500; }
.sb-tagging-listing em { font-style: normal; color: var(--sb-muted); font-size: var(--sb-t-micro); }
.sb-tagging-listing__nolink { color: var(--sb-subtle); font-size: var(--sb-t-micro); }
.sb-tagging-mall {
  padding: 1px 7px; border-radius: var(--sb-r-pill);
  font-size: var(--sb-t-micro); background: var(--sb-n-100); color: var(--sb-ink-2);
}
.sb-tagging-mall--gmarket { background: var(--sb-info-soft, var(--sb-n-100)); }
```

- [ ] **Step 5: 실제 데이터로 확인한다**

`.claude/launch.json`의 `scenario-studio`(5173)를 띄우고 `apps/tagging-api`(8790)도 함께 실행한 뒤 `http://localhost:5173/#tagging`을 연다.

확인할 것:
- 좌측 목록 건수가 **946**이다 (기존 1011이 아니다)
- 상품 정보에 **판매 중인 몰** 카드가 뜨고, 지마켓 카드는 "상세페이지 없음"이다
- 각 필드 카드에 확신도 바와 % 가 보인다 (예전에는 remote 모드에서 가려졌다)
- 「왜?」를 펴면 그 필드의 근거 문장이 나온다

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/components/TaggingStudio.jsx apps/studio/src/styles/tagging.css
git commit -m "feat(tagging): 화면에 묶인 몰 리스팅과 필드별 확신도를 보여준다

가격·PDP는 카탈로그에 없고 리스팅에만 있으므로(실측 0/946) 상품 정보의 가격 줄을
몰별 리스팅 카드로 바꾼다. 지마켓 리스팅은 url 이 전부 없어 죽은 링크 대신
'상세페이지 없음'으로 둔다.

필드별 확신도 UI 는 이미 있었는데 source!=='remote' 가드로 가려져 있었다 —
서버가 안 줬기 때문이다. 카탈로그의 field_confidence 가 그 자리를 채운다."
```

---

## Task 5: 「카탈로그 미연결」 필터

**Files:**
- Modify: `apps/studio/src/components/TaggingStudio.jsx`
- Modify: `apps/studio/src/styles/tagging.css`

**Interfaces:**
- Consumes: Task 2의 `unlinked[]` (`{ productId, mall, name, brand, imageUrl }`)
- Produces: 없음

- [ ] **Step 1: 부트스트랩 응답에서 `unlinked`를 상태로 받는다**

`TaggingStudio.jsx`에서 `units` 상태를 세우는 곳 옆에 추가한다:

```js
  const [unlinked, setUnlinked] = useState([])
```

원격 로드 성공 처리에서 함께 채운다 (`setUnits(...)` 바로 뒤):

```js
      setUnlinked(Array.isArray(data.unlinked) ? data.unlinked : [])
```

- [ ] **Step 2: 헤더에 필터 알약을 추가한다**

기존 「미검토」 알약(517~521행) **다음**에 붙인다:

```jsx
          {unlinked.length > 0 && (
            <button
              type="button"
              className={'sb-tagging-pill sb-tagging-pill--unlinked' + (listFilter === 'unlinked' ? ' is-on' : '')}
              onClick={() => setListFilter((prev) => (prev === 'unlinked' ? 'all' : 'unlinked'))}
              title="카탈로그에 아직 묶이지 않은 몰 리스팅이에요. 묶는 일은 대시보드에서 합니다."
            >
              카탈로그 미연결 <b>{unlinked.length}</b>
            </button>
          )}
```

- [ ] **Step 3: 미연결 목록을 읽기 전용으로 그린다**

작업 단위 목록(`{listed.map((u) => ...)}`)을 감싼 `<div className="sb-tagging-units">` 안에서, 목록 렌더 **앞**에 분기를 둔다:

```jsx
              {listFilter === 'unlinked' ? (
                <>
                  <p className="sb-tagging-unlinked__note">
                    카탈로그에 묶이지 않아 여기서는 태깅하지 않아요. 묶는 것은 대시보드의
                    「카탈로그 연결」에서 합니다.
                  </p>
                  {unlinked.map((u) => (
                    <div key={u.productId} className="sb-tagging-unlinked">
                      {u.imageUrl
                        ? <img src={u.imageUrl} alt="" loading="lazy" />
                        : <span className="sb-tagging-unlinked__noimg">🧴</span>}
                      <div>
                        <b>{u.name}</b>
                        <small>
                          <span className={`sb-tagging-mall sb-tagging-mall--${u.mall}`}>
                            {u.mall === 'gmarket' ? '지마켓' : '올리브영'}
                          </span>
                          {u.brand}
                        </small>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                /* 기존 listed.map(...) 블록을 이 자리에 그대로 둔다 */
                <>{/* … */}</>
              )}
```

기존 `listed.length === 0` 빈 안내는 `else` 가지 안에 남긴다.

- [ ] **Step 4: 스타일을 넣는다**

`apps/studio/src/styles/tagging.css` 끝에 붙인다:

```css
/* 카탈로그에 안 묶인 리스팅 — 읽기 전용. 묶는 일은 Flask 대시보드 몫이다 */
.sb-tagging-unlinked__note {
  padding: 8px 10px; margin: 0 0 8px;
  background: var(--sb-n-50); border-radius: var(--sb-r-sm);
  color: var(--sb-muted); font-size: var(--sb-t-micro); line-height: 1.5;
}
.sb-tagging-unlinked { display: flex; gap: 8px; align-items: center; padding: 6px 4px; }
.sb-tagging-unlinked img,
.sb-tagging-unlinked__noimg {
  width: 34px; height: 34px; border-radius: var(--sb-r-sm);
  object-fit: cover; display: grid; place-items: center; background: var(--sb-n-100);
}
.sb-tagging-unlinked b { display: block; font-weight: 400; }
.sb-tagging-unlinked small { display: flex; gap: 6px; align-items: center; color: var(--sb-muted); }
```

- [ ] **Step 5: 확인한다**

5173에서 `#tagging`을 열고 「카탈로그 미연결」을 누른다.

확인할 것: 배지가 **82**, 누르면 안내 문구와 읽기 전용 카드가 뜨고 **클릭해도 편집 화면이 바뀌지 않는다**. 다시 누르면 전체 목록으로 돌아온다.

- [ ] **Step 6: 커밋**

```bash
git add apps/studio/src/components/TaggingStudio.jsx apps/studio/src/styles/tagging.css
git commit -m "feat(tagging): 카탈로그에 안 묶인 리스팅 82건을 별도 필터로 보여준다

검토 단위가 카탈로그로 바뀌면서 목록에서 빠지는 리스팅들이다. 그냥 사라지면
검토자가 존재를 모르므로 필터로 남기되 태깅은 하지 않는다 — 묶는 일은 Flask
/catalog/pending 의 몫이고, 우리가 리스팅에 태그를 쓰면 다음 빌드 때 어느 쪽이
정본인지 다시 흐려진다."
```

---

## Task 6: 계약 문서 갱신

**Files:**
- Modify: `CLAUDE.md`
- Modify: `TAGGING-DATA-CONTRACT.md`

**Interfaces:**
- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: `CLAUDE.md`의 태깅 스튜디오 항목을 고친다**

`components/TaggingStudio.jsx` 항목에서 데이터 원천 문장을 찾아 바꾼다. 기존:

> 데이터 원천은 **사내망 Mongo(`<MONGO_DB>.products`)**다

바꿀 내용:

> 데이터 원천은 **사내망 Mongo의 `<MONGO_DB>.catalog`**(몰 중립 상품 실체, 946건 — `merged_into` 붙은 병합 묘비 14건 제외)다. 같은 상품이 올리브영·지마켓에 각각 걸려도 **검토는 한 번**이다. 가격·PDP·리뷰·옵션은 카탈로그에 하나도 없어(실측 0/946) 묶인 몰 리스팅(`<MONGO_DB>.products`, `catalog_ids`로 연결)에서 읽어 상품 정보 패널의 몰 카드로 보여준다. 확신도는 카탈로그의 `field_confidence`(화면과 같은 7키, `level`+`rationale`)로 **필드별**이다. 카탈로그에 안 묶인 리스팅 82건은 「카탈로그 미연결」 필터에 읽기 전용으로 남는다 — 묶는 일은 Flask 대시보드(`/catalog/pending`)의 몫이다.

- [ ] **Step 2: 빌더 충돌 경고를 `TAGGING-DATA-CONTRACT.md`에 남긴다**

문서 맨 끝에 붙인다:

```markdown
## ⚠️ 카탈로그 빌더와의 충돌 (미해결)

카탈로그 빌더(`oliveyoung-collector-poc` 쪽, 이 저장소 밖)가 재빌드 때
`review_status`를 묶인 리스팅에서 다시 복사한다. 2026-09-09 실측으로 946건 중
934건이 리스팅과 값이 같았다 — 검토 결과가 아니라 복사본이라는 뜻이다.

**그대로 두면 다음 재빌드가 이 화면의 검토 결과를 덮는다.** 빌더 쪽에 한 줄이
필요하다:

> 이미 `review_meta`가 있는(= 사람이 검토한) 카탈로그 문서는 `review_status`를 덮지 않는다.

저장소가 달라 여기서 고치지 않는다. 해당 저장소 담당에게 전달할 것.
```

- [ ] **Step 3: 커밋**

```bash
git add CLAUDE.md TAGGING-DATA-CONTRACT.md
git commit -m "docs: 태깅 검토 단위가 카탈로그임을 계약 문서에 반영

빌더가 재빌드 때 review_status 를 리스팅에서 복사해 우리 검토 결과를 덮는
문제는 다른 저장소라 여기서 못 고친다 — 경고로 남겨 담당에게 전달한다."
```

---

## Self-Review 결과

**스펙 커버리지**

| 스펙 절 | 담당 태스크 |
|---|---|
| §4-1 검토 단위·되쓰기 | Task 1·2 |
| §4-2 리스팅 근거 카드 | Task 1(변환)·4(화면) |
| §4-3 필드별 확신도 | Task 1(서버)·4(가드 해제) |
| §4-4 미연결 82건 | Task 1(`unlinked`)·2(응답)·5(화면) |
| §4-5 투영·gzip·메모리 조인 | Task 2·3 |
| §4-6 `CATALOG_COLL` | Task 2 |
| §5-1 빌더 충돌 | Task 6 (문서로만 — 저장소 밖) |
| §6 테스트 | Task 1 (9개) |

**타입 일관성** — `toCatalogUnit(doc, listings)`·`joinListings(catalogDocs, productDocs)`·`toListingCard(doc)`·`toUnlinkedCard(doc)` 이름과 인자가 Task 1 정의와 Task 2 사용처에서 일치한다. FE가 읽는 `unit.listings[].mall|price|url|optionCount`, `unit.fields[k].confidence|rationale`, `unlinked[].productId|mall|name|brand|imageUrl`도 Task 1 반환 모양과 같다.

**미결(계획 밖)** — 빌더 수정은 다른 저장소라 Task 6의 문서 전달로 끝난다. 라이브 생성 카탈로그(`packages/pipeline/src/catalog.ts`)와의 연결은 별개 과제다.
