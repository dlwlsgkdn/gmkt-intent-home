# 상품 태깅 스튜디오 실데이터 연결 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DDAK 운영 콘솔의 상품 태깅 화면이 Mongo에 쌓인 올리브영 상품 719건을 그리고, 태그 수정·승인·반려를 Mongo에 되쓴다.

**Architecture:** Mongo가 사내망(`172.30.218.x`)이라 Vercel 서버리스에는 접근을 둘 수 없다. Mongo에 닿는 곳에서만 도는 NestJS 서비스 `apps/tagging-api`를 새로 만들어 읽기·쓰기를 맡기고, 스튜디오 FE는 same-origin `/api/tagging/*`만 부른다(개발은 vite 프록시, 운영은 이 서비스가 스튜디오 빌드까지 정적 서빙). 문서↔화면 변환과 되쓰기 화이트리스트는 API의 순수 함수 한 곳(`mapping.ts`)이 소유한다.

**Tech Stack:** NestJS 11 (apps/bff와 동일 구성), mongodb 6, dotenv, React 18 + Vite 5 (apps/studio), 테스트는 Node 내장 `node --test` (모노레포에 테스트 러너가 없어 의존성을 늘리지 않는다)

**Spec:** [docs/superpowers/specs/2026-09-01-tagging-studio-mongo-design.md](../specs/2026-09-01-tagging-studio-mongo-design.md)

## Global Constraints

- Mongo 접속 정보는 코드에 넣지 않는다. `MONGO_URI`·`MONGO_DB`(기본 `oliveyoung`)·`MONGO_COLL`(기본 `products`)·`TAXONOMY_PATH`·`PORT`(기본 8790) 환경변수만 쓴다.
- **되쓰기 화이트리스트를 벗어나는 필드는 절대 `$set` 하지 않는다.** 허용: `inferred_category`, `sub_type`, `body_part`, `skin_types`, `concerns`, `results`, `conditions`, `skin_types_primary`, `concerns_primary`, `results_primary`, `conditions_primary`, `review_meta`, `review_status`, `reviewed_at`, `updated_at`.
- `updated_at`은 Python `store.py`의 `_now()`와 같은 형식이어야 한다: UTC ISO 초 단위 + `+00:00` 오프셋 (예: `2026-09-01T04:56:56+00:00`).
- 화면 전용 상태는 문서에 `review_meta` 객체 **하나**로만 담는다. 기존 필드를 건드리지 않는 추가형이라야 Flask 대시보드·재분석과 충돌하지 않는다.
- FE는 API 실패 시 기존 목업(`TAGGING_SEED`) + 하드코딩 사전으로 폴백해야 한다. Vercel 배포본·사내망 밖에서 화면이 깨지면 안 된다.
- 스튜디오 CSS는 `sb-` 접두사 토큰 체계를 쓴다. 새 규칙은 `apps/studio/src/styles/tagging.css` 끝에 추가한다(파일 간 이동·순서 변경 금지 — @import 순서가 캐스케이드다).
- 커밋은 각 태스크 끝에서 한 번. 브랜치는 `feat/tagging-mongo`.

## File Structure

**신규 — `apps/tagging-api/`** (apps/bff의 구성을 그대로 따른다)

| 파일 | 책임 |
|---|---|
| `package.json` · `tsconfig.json` · `nest-cli.json` · `.env.example` | 워크스페이스 구성 |
| `src/main.ts` | 부팅. 전역 프리픽스 `api/tagging`, `STUDIO_DIST` 있으면 정적 서빙 |
| `src/app.module.ts` | 모듈 배선 |
| `src/mongo.service.ts` | Mongo 클라이언트 수명주기 + 컬렉션 접근자 |
| `src/taxonomy.service.ts` | `TAXONOMY_PATH` JSON 읽기 + mtime 캐시 |
| `src/mapping.ts` | **순수 함수** — `toUnit`/`toDocPatch`/`decisionToReviewStatus` 등. 유일한 테스트 대상 |
| `src/tagging.service.ts` | Mongo·사전·mapping 조합 |
| `src/tagging.controller.ts` | 라우트 4개 |
| `test/mapping.test.mjs` | `node --test` |

**수정 — `apps/studio/`**

| 파일 | 변경 |
|---|---|
| `vite.config.js` | `/api/tagging` 프록시 추가 (`/api`보다 **먼저** 선언) |
| `src/lib/taggingCatalog.js` | 사전을 주입 가능하게(`applyTaxonomy`), 원격 로드·저장 함수 추가. 시드·폴백 경로는 유지 |
| `src/components/TaggingStudio.jsx` | 비동기 로드·저장 배선, AI 원본 되돌리기 재배선, 검색창 |
| `src/components/AdminDashboard.jsx` | 태깅 타일을 요약 API로 |
| `src/styles/tagging.css` | 검색창·폴백 배너 스타일 |

---

### Task 1: tagging-api 스캐폴드 + 읽기 엔드포인트

**Files:**
- Create: `apps/tagging-api/package.json`, `apps/tagging-api/tsconfig.json`, `apps/tagging-api/nest-cli.json`, `apps/tagging-api/.env.example`
- Create: `apps/tagging-api/src/mapping.ts`, `src/mongo.service.ts`, `src/taxonomy.service.ts`, `src/tagging.service.ts`, `src/tagging.controller.ts`, `src/app.module.ts`, `src/main.ts`
- Test: `apps/tagging-api/test/mapping.test.mjs`

**Interfaces:**
- Produces: `toUnit(doc): Unit` — `Unit = { id, brand, name, option, price, imageUrl, catalogTags: string[], copy, review, confidence: number, confidenceLevel: 'high'|'medium'|'low'|null, rationale, decision: 'approved'|'rejected'|null, note: string, tagRequest: Record<string,boolean>, fields: Record<FieldKey, Field>, aiFields: Record<FieldKey, Field> }`, `Field = { selected: string[], rep: string|null, status: 'done'|'unreviewed'|'fix', origin: 'ai'|'human' }`, `FieldKey = 'category'|'subtype'|'area'|'type'|'concern'|'result'|'condition'`
- Produces: `GET /api/tagging/bootstrap` → `{ taxonomy, units }`, `GET /api/tagging/summary` → `{ counts: {done,unreviewed,fix,approved,rejected}, total }`

- [ ] **Step 1: 워크스페이스 구성 파일 4개를 만든다**

`apps/tagging-api/package.json`:
```json
{
  "name": "ddak-tagging-api",
  "version": "0.1.0",
  "private": true,
  "description": "태깅 검토 API — 사내망 Mongo(oliveyoung.products)를 읽고 검토 결과를 되쓴다",
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "npm run build && node --test test/"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "dotenv": "^16.4.5",
    "mongodb": "^6.10.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2"
  }
}
```

`apps/tagging-api/tsconfig.json` — apps/bff/tsconfig.json을 그대로 복사한다.

`apps/tagging-api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

`apps/tagging-api/.env.example`:
```
# 사내망에서만 닿는다. 값은 external-item-collector/.env 와 같다.
MONGO_URI=
MONGO_DB=oliveyoung
MONGO_COLL=products
# Python 저장소의 taxonomy.json 절대경로 — 사본을 만들지 않는다(사전 원천이 하나여야 한다)
TAXONOMY_PATH=/Users/minoh/oliveyoung-collector-poc/taxonomy.json
PORT=8790
# 운영 배치 시에만: 스튜디오 빌드 산출물을 같은 오리진에서 서빙한다
# STUDIO_DIST=/srv/ddak/apps/studio/dist
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/tagging-api/test/mapping.test.mjs`:
```js
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
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: FAIL — `Cannot find module '../dist/mapping.js'` (아직 구현이 없다)

- [ ] **Step 4: mapping.ts를 구현한다**

`apps/tagging-api/src/mapping.ts`:
```ts
/*
 * 문서(Mongo) ↔ 태깅 단위(화면) 변환. 순수 함수만 둔다 — Nest·Mongo를 모르게 해서
 * 테스트가 쉽고, 되쓰기 화이트리스트가 이 파일 하나에만 있게 하려는 것이다.
 */
export type FieldKey = 'category' | 'subtype' | 'area' | 'type' | 'concern' | 'result' | 'condition'
export type Field = { selected: string[]; rep: string | null; status: 'done' | 'unreviewed' | 'fix'; origin: 'ai' | 'human' }

/* 화면 필드 → 문서 필드. scalar는 값 하나(문서에 배열이 아니다), list는 배열+대표. */
type Slot = { scalar?: string; list?: string; primary?: string }
export const FIELD_SLOTS: Record<FieldKey, Slot> = {
  category: { scalar: 'inferred_category' },
  subtype: { scalar: 'sub_type' },
  area: { scalar: 'body_part' },
  type: { list: 'skin_types', primary: 'skin_types_primary' },
  concern: { list: 'concerns', primary: 'concerns_primary' },
  result: { list: 'results', primary: 'results_primary' },
  condition: { list: 'conditions', primary: 'conditions_primary' },
}
export const FIELD_KEYS = Object.keys(FIELD_SLOTS) as FieldKey[]

/* 문서엔 등급 하나뿐이다. 화면의 확신도 바가 0~100을 받으므로 환산해 보낸다. */
const CONFIDENCE_PCT: Record<string, number> = { high: 90, medium: 70, low: 45 }

const asList = (doc: any, slot: Slot): string[] => {
  if (slot.list) return Array.isArray(doc[slot.list]) ? doc[slot.list].filter((v: unknown) => typeof v === 'string') : []
  const v = doc[slot.scalar!]
  return typeof v === 'string' && v ? [v] : []
}

const repOf = (doc: any, slot: Slot, selected: string[]): string | null => {
  if (selected.length === 1) return selected[0]
  const primary = slot.primary ? doc[slot.primary] : null
  return typeof primary === 'string' && selected.includes(primary) ? primary : null
}

const reviewText = (doc: any): string => {
  const features = doc.review_ai_summary?.features
  const lines = Array.isArray(features)
    ? features.map((f: any) => `${f.title} — ${f.description}`)
    : []
  const stats = doc.review_stats
  if (stats?.count) lines.push(`리뷰 ${Number(stats.count).toLocaleString('ko-KR')}건 · 평점 ${stats.avg_rating}`)
  return lines.join('\n')
}

export function toUnit(doc: any) {
  const meta = doc.review_meta || {}
  const reviewed = doc.review_status === 'reviewed' || doc.review_status === 'auto_ok'
  const fields = {} as Record<FieldKey, Field>
  const aiFields = {} as Record<FieldKey, Field>
  for (const key of FIELD_KEYS) {
    const slot = FIELD_SLOTS[key]
    const selected = asList(doc, slot)
    fields[key] = {
      selected,
      rep: repOf(doc, slot, selected),
      status: meta.fieldStatus?.[key] || (reviewed ? 'done' : 'unreviewed'),
      origin: meta.fieldOrigin?.[key] === 'human' ? 'human' : 'ai',
    }
    const snapshot = meta.aiOriginal?.[key]
    aiFields[key] = snapshot
      ? { selected: [...(snapshot.selected || [])], rep: snapshot.rep ?? null, status: 'unreviewed', origin: 'ai' }
      : { ...fields[key], status: 'unreviewed', origin: 'ai', selected: [...selected] }
  }
  return {
    id: doc.product_id,
    brand: doc.brand || doc.inferred_brand || '',
    name: doc.name || '',
    option: doc.options?.length ? `옵션 ${doc.options.length}개` : '단일 옵션',
    price: typeof doc.price === 'number' ? doc.price : null,
    imageUrl: doc.image_url || null,
    url: doc.url || null,
    catalogTags: [doc.sub_type, doc.formulation, ...(doc.ingredient_tags || [])]
      .filter((v: unknown): v is string => typeof v === 'string' && !!v)
      .filter((v, i, all) => all.indexOf(v) === i)
      .slice(0, 5),
    copy: doc.product_info?.['제품 주요 사양'] || doc.usage_method || '',
    review: reviewText(doc),
    confidence: CONFIDENCE_PCT[doc.confidence] ?? 0,
    confidenceLevel: doc.confidence || null,
    rationale: doc.rationale || '',
    decision: doc.review_status === 'reviewed' ? 'approved' : doc.review_status === 'needs_fix' ? 'rejected' : null,
    note: meta.note || '',
    tagRequest: meta.tagRequest || {},
    fields,
    aiFields,
  }
}
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: PASS (6 tests)

- [ ] **Step 6: Mongo·사전 서비스를 만든다**

`apps/tagging-api/src/mongo.service.ts`:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Collection, MongoClient } from 'mongodb'

/* 사내망 replica set에만 닿는다. 연결 실패는 부팅을 막지 않는다 —
   사내망 밖에서 띄웠을 때 서비스가 죽는 대신 라우트가 503을 내는 편이 진단하기 쉽다. */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient | null = null

  async onModuleInit() {
    const uri = process.env.MONGO_URI
    if (!uri) return
    try {
      this.client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect()
    } catch (err) {
      console.error('[mongo] 연결 실패 — 사내망인지 확인하세요:', (err as Error).message)
      this.client = null
    }
  }

  async onModuleDestroy() {
    await this.client?.close()
  }

  collection(): Collection | null {
    if (!this.client) return null
    return this.client.db(process.env.MONGO_DB || 'oliveyoung').collection(process.env.MONGO_COLL || 'products')
  }
}
```

`apps/tagging-api/src/taxonomy.service.ts`:
```ts
import { Injectable } from '@nestjs/common'
import { readFileSync, statSync } from 'node:fs'

/* 사전의 원천은 Python 저장소의 taxonomy.json이다(그쪽 /taxonomy 승격이 이 파일에 쓴다).
   사본을 만들면 조용히 갈라지므로 경로로 읽고 mtime이 바뀔 때만 다시 읽는다. */
@Injectable()
export class TaxonomyService {
  private cache: { mtimeMs: number; data: unknown } | null = null

  read(): unknown | null {
    const path = process.env.TAXONOMY_PATH
    if (!path) return null
    try {
      const { mtimeMs } = statSync(path)
      if (this.cache?.mtimeMs === mtimeMs) return this.cache.data
      const data = JSON.parse(readFileSync(path, 'utf8'))
      this.cache = { mtimeMs, data }
      return data
    } catch (err) {
      console.error('[taxonomy] 읽기 실패:', (err as Error).message)
      return null
    }
  }
}
```

- [ ] **Step 7: 서비스·컨트롤러·부팅을 배선한다**

`apps/tagging-api/src/tagging.service.ts`:
```ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { toUnit } from './mapping'

@Injectable()
export class TaggingService {
  constructor(private readonly mongo: MongoService, private readonly taxonomy: TaxonomyService) {}

  private collection() {
    const collection = this.mongo.collection()
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  /* 719건을 한 번에 보낸다. 응답 1~3MB는 지금 규모에서 충분하다 —
     느려지면 그때 목록/상세를 나눈다. */
  async bootstrap() {
    const docs = await this.collection().find({ status: 'analyzed' }).toArray()
    return { taxonomy: this.taxonomy.read(), units: docs.map(toUnit) }
  }

  /* 대시보드 타일용 — 719건 본문을 받지 않으려고 따로 둔다. */
  async summary() {
    const docs = await this.collection()
      .find({ status: 'analyzed' }, { projection: { review_status: 1 } })
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
}
```

`apps/tagging-api/src/tagging.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common'
import { TaggingService } from './tagging.service'

@Controller()
export class TaggingController {
  constructor(private readonly tagging: TaggingService) {}

  @Get('bootstrap')
  bootstrap() {
    return this.tagging.bootstrap()
  }

  @Get('summary')
  summary() {
    return this.tagging.summary()
  }
}
```

`apps/tagging-api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { TaggingService } from './tagging.service'
import { TaggingController } from './tagging.controller'

@Module({
  controllers: [TaggingController],
  providers: [MongoService, TaxonomyService, TaggingService],
})
export class AppModule {}
```

`apps/tagging-api/src/main.ts`:
```ts
import 'dotenv/config'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.setGlobalPrefix('api/tagging')
  /* 운영 배치: FE와 API가 같은 오리진이어야 한다(https 페이지에서 http 사내 API를
     부르면 mixed content로 막힌다). 그래서 이 서비스가 스튜디오 빌드를 함께 서빙한다. */
  const dist = process.env.STUDIO_DIST
  if (dist) app.useStaticAssets(dist)
  await app.listen(Number(process.env.PORT || 8790))
}
bootstrap()
```

- [ ] **Step 8: 실제 Mongo로 스모크한다**

```bash
cp apps/tagging-api/.env.example apps/tagging-api/.env
```
`.env`의 `MONGO_URI`를 `~/Workspace/external-item-collector/.env`의 값으로 채운 뒤:
```bash
npm install && npm run build --workspace=apps/tagging-api
```
```bash
(cd apps/tagging-api && node dist/main.js &) ; sleep 3 ; curl -s localhost:8790/api/tagging/summary
```
Expected: `{"counts":{"done":140,"unreviewed":264,"approved":316,"rejected":0},"total":719}` (건수는 그날 데이터에 따라 다를 수 있다)

```bash
curl -s localhost:8790/api/tagging/bootstrap | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('units',j.units.length,'taxonomy',Object.keys(j.taxonomy||{}).length);console.log(j.units[0].name, j.units[0].fields.category)})"
```
Expected: `units 719 taxonomy 23` + 첫 상품의 이름과 대분류 필드

- [ ] **Step 9: 커밋**

```bash
git add apps/tagging-api package-lock.json package.json
git commit -m "feat(tagging-api): Mongo 태깅 데이터 읽기 API"
```

---

### Task 2: 태그 저장(PATCH)

**Files:**
- Modify: `apps/tagging-api/src/mapping.ts` (추가), `src/tagging.service.ts`, `src/tagging.controller.ts`
- Test: `apps/tagging-api/test/mapping.test.mjs` (추가)

**Interfaces:**
- Consumes: `FIELD_SLOTS`, `FIELD_KEYS`, `toUnit` (Task 1)
- Produces: `toDocPatch(patch, doc): Record<string, unknown>` — `patch = { fields, tagRequest, note }`. 화이트리스트 밖 키는 버린다. `PATCH /api/tagging/units/:productId` → 갱신된 `Unit`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

`apps/tagging-api/test/mapping.test.mjs` 끝에 붙인다(파일 상단 import에 `toDocPatch`를 더한다: `const { toUnit, toDocPatch } = mapping`):
```js
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

test('toDocPatch — 대표(★)가 선택 목록 밖이면 비운다', () => {
  const bad = { ...PATCH, fields: { ...PATCH.fields, type: { selected: ['건성'], rep: '지성', status: 'done', origin: 'human' } } }
  assert.equal(toDocPatch(bad, DOC).skin_types_primary, '건성')
})

test('toDocPatch — updated_at은 store.py의 _now()와 같은 형식이다', () => {
  assert.match(toDocPatch(PATCH, DOC).updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/)
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: FAIL — `toDocPatch is not a function`

- [ ] **Step 3: mapping.ts에 toDocPatch를 추가한다**

`apps/tagging-api/src/mapping.ts` 끝에 붙인다:
```ts
/* Python store.py의 _now()와 같은 형식이어야 한다 — 두 도구가 같은 필드를 쓴다. */
export const nowIso = () => `${new Date().toISOString().slice(0, 19)}+00:00`

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
        .filter((v, i, all) => all.indexOf(v) === i)
    : []

/*
 * 화면 → 문서. 여기 적힌 필드만 $set 된다 — 수집 파이프라인이 채운 값을 검토 화면이
 * 덮는 사고를 구조로 막는다(그래서 화이트리스트가 이 함수 밖에 없다).
 */
export function toDocPatch(patch: any, doc: any): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  const fieldStatus: Record<string, string> = {}
  const fieldOrigin: Record<string, string> = {}
  const existingOriginal = doc?.review_meta?.aiOriginal
  const aiOriginal: Record<string, unknown> = existingOriginal ? { ...existingOriginal } : {}

  for (const key of FIELD_KEYS) {
    const incoming = patch?.fields?.[key]
    if (!incoming) continue
    const slot = FIELD_SLOTS[key]
    const selected = cleanList(incoming.selected)
    const rep = selected.length === 1 ? selected[0] : (selected.includes(incoming.rep) ? incoming.rep : null)
    if (slot.list) {
      set[slot.list] = selected
      if (slot.primary) set[slot.primary] = rep
    } else {
      set[slot.scalar!] = selected[0] ?? null
    }
    fieldStatus[key] = ['done', 'unreviewed', 'fix'].includes(incoming.status) ? incoming.status : 'unreviewed'
    fieldOrigin[key] = incoming.origin === 'human' ? 'human' : 'ai'
    /* 첫 저장에서만 원본을 굳힌다. 이미 있으면 덮지 않는다 — 두 번째 저장이 사람이
       고친 값을 원본으로 만들면 '되돌리기'가 영영 망가진다. */
    if (!existingOriginal?.[key]) {
      const before = asList(doc || {}, slot)
      aiOriginal[key] = { selected: before, rep: repOf(doc || {}, slot, before) }
    }
  }

  set.review_meta = {
    ...(doc?.review_meta || {}),
    fieldStatus: { ...(doc?.review_meta?.fieldStatus || {}), ...fieldStatus },
    fieldOrigin: { ...(doc?.review_meta?.fieldOrigin || {}), ...fieldOrigin },
    tagRequest: patch?.tagRequest && typeof patch.tagRequest === 'object' ? patch.tagRequest : (doc?.review_meta?.tagRequest || {}),
    note: typeof patch?.note === 'string' ? patch.note : (doc?.review_meta?.note || ''),
    aiOriginal,
  }
  set.updated_at = nowIso()
  return set
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: PASS (12 tests)

- [ ] **Step 5: 라우트를 배선한다**

`apps/tagging-api/src/tagging.service.ts`에 추가:
```ts
  async saveUnit(productId: string, patch: unknown) {
    const collection = this.collection()
    const doc = await collection.findOne({ product_id: productId })
    if (!doc) throw new NotFoundException(`상품 ${productId}을(를) 찾을 수 없습니다`)
    const set = toDocPatch(patch, doc)
    await collection.updateOne({ product_id: productId }, { $set: set })
    return toUnit({ ...doc, ...set })
  }
```
import 두 줄을 고친다: `import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'`, `import { toDocPatch, toUnit } from './mapping'`

`apps/tagging-api/src/tagging.controller.ts`에 추가:
```ts
  @Patch('units/:productId')
  save(@Param('productId') productId: string, @Body() body: unknown) {
    return this.tagging.saveUnit(productId, body)
  }
```
import를 고친다: `import { Body, Controller, Get, Param, Patch } from '@nestjs/common'`

- [ ] **Step 6: 실제 문서로 왕복을 확인한다**

```bash
npm run build --workspace=apps/tagging-api && (cd apps/tagging-api && node dist/main.js &) ; sleep 3
```
```bash
PID=$(curl -s localhost:8790/api/tagging/summary >/dev/null; curl -s localhost:8790/api/tagging/bootstrap | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).units[0].id))") ; echo $PID
```
그 id로 저장을 한 번 보내고 되읽는다(값은 원래대로 되돌려 보낸다 — 실데이터를 바꾸지 않는다):
```bash
curl -s -X PATCH localhost:8790/api/tagging/units/$PID -H 'content-type: application/json' -d '{"note":"왕복 확인","fields":{}}' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).note))"
```
Expected: `왕복 확인`

- [ ] **Step 7: 커밋**

```bash
git add apps/tagging-api
git commit -m "feat(tagging-api): 태그 저장 PATCH — 화이트리스트와 AI 원본 스냅샷"
```

---

### Task 3: 승인·반려(POST)

**Files:**
- Modify: `apps/tagging-api/src/mapping.ts`, `src/tagging.service.ts`, `src/tagging.controller.ts`
- Test: `apps/tagging-api/test/mapping.test.mjs` (추가)

**Interfaces:**
- Produces: `decisionToReview(decision): { review_status, reviewed_at }`, `POST /api/tagging/units/:productId/review` body `{ decision: 'approved'|'rejected'|null }` → 갱신된 `Unit`

- [ ] **Step 1: 실패하는 테스트를 추가한다**

```js
test('decisionToReview — 화면 결정을 Flask와 공유하는 review_status로 되돌린다', () => {
  const { decisionToReview } = mapping
  assert.equal(decisionToReview('approved').review_status, 'reviewed')
  assert.match(decisionToReview('approved').reviewed_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(decisionToReview('rejected').review_status, 'needs_fix')
  /* 반려·해제는 검토 시각을 남기지 않는다 (store.py set_review_status와 같은 규칙) */
  assert.equal(decisionToReview('rejected').reviewed_at, null)
  assert.equal(decisionToReview(null).review_status, 'unreviewed')
})
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: FAIL — `decisionToReview is not a function`

- [ ] **Step 3: 구현한다**

`apps/tagging-api/src/mapping.ts` 끝:
```ts
/* Flask 대시보드와 공유하는 필드다. store.py set_review_status와 같은 규칙으로 쓴다. */
export function decisionToReview(decision: unknown) {
  if (decision === 'approved') return { review_status: 'reviewed', reviewed_at: nowIso() }
  if (decision === 'rejected') return { review_status: 'needs_fix', reviewed_at: null }
  return { review_status: 'unreviewed', reviewed_at: null }
}
```

`apps/tagging-api/src/tagging.service.ts`:
```ts
  async setDecision(productId: string, decision: unknown) {
    const collection = this.collection()
    const doc = await collection.findOne({ product_id: productId })
    if (!doc) throw new NotFoundException(`상품 ${productId}을(를) 찾을 수 없습니다`)
    const set = { ...decisionToReview(decision), updated_at: nowIso() }
    await collection.updateOne({ product_id: productId }, { $set: set })
    return toUnit({ ...doc, ...set })
  }
```
import: `import { decisionToReview, nowIso, toDocPatch, toUnit } from './mapping'`

`apps/tagging-api/src/tagging.controller.ts`:
```ts
  @Post('units/:productId/review')
  review(@Param('productId') productId: string, @Body() body: { decision?: unknown }) {
    return this.tagging.setDecision(productId, body?.decision ?? null)
  }
```
import에 `Post`를 더한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npm run test --workspace=apps/tagging-api`
Expected: PASS (13 tests)

- [ ] **Step 5: Flask와 교차 확인한다**

미검토 상품 하나를 승인으로 바꾸고, Flask 대시보드가 같은 상태로 보는지 확인한다.
```bash
npm run build --workspace=apps/tagging-api && (cd apps/tagging-api && node dist/main.js &) ; sleep 3
```
```bash
curl -s -X POST localhost:8790/api/tagging/units/<미검토상품id>/review -H 'content-type: application/json' -d '{"decision":"approved"}' | head -c 200
```
Flask(`localhost:8021`)의 `/product/<그 id>`를 열어 검토 상태가 "검토완료"로 보이면 통과. 확인 후 원래 상태로 되돌린다:
```bash
curl -s -X POST localhost:8790/api/tagging/units/<그 id>/review -H 'content-type: application/json' -d '{"decision":null}' | head -c 120
```

- [ ] **Step 6: 커밋**

```bash
git add apps/tagging-api
git commit -m "feat(tagging-api): 승인·반려를 review_status로 기록"
```

---

### Task 4: FE — 원격 데이터·사전 로드 (읽기)

**Files:**
- Modify: `apps/studio/vite.config.js`, `apps/studio/src/lib/taggingCatalog.js`, `apps/studio/src/components/TaggingStudio.jsx`, `apps/studio/src/styles/tagging.css`

**Interfaces:**
- Consumes: `GET /api/tagging/bootstrap` (Task 1)
- Produces: `fetchTaggingBootstrap(): Promise<{taxonomy, units}|null>`, `applyTaxonomy(taxonomy): void`, `isRemote(): boolean`

- [ ] **Step 1: vite 프록시를 추가한다**

`apps/studio/vite.config.js`의 `proxy` 블록 **맨 앞**에 넣는다(선언 순서가 매칭 순서라 `/api` 뒤에 두면 삼켜진다):
```js
      // /api/tagging → 로컬 tagging-api (사내망 Mongo). 운영에선 같은 오리진이라 프록시가 없다
      '/api/tagging': {
        target: process.env.VITE_TAGGING_PROXY || 'http://localhost:8790',
        changeOrigin: true,
        secure: false,
      },
```

- [ ] **Step 2: 사전을 주입 가능하게 바꾼다**

`apps/studio/src/lib/taggingCatalog.js`의 `optionsFor` 바로 위에 넣는다:
```js
/* 사전의 원천은 서버가 실어 보내는 taxonomy(=Python 저장소의 taxonomy.json)다.
   위 상수들은 서버가 없을 때(배포본·사내망 밖) 쓰는 폴백으로 남는다. */
let TAXONOMY = null
export function applyTaxonomy(taxonomy) {
  TAXONOMY = taxonomy && Array.isArray(taxonomy.categories) ? taxonomy : null
}

/* 그룹 스코프: 대분류 → 그룹(category_groups) → 그 그룹에 속한 값만(sub_types_groups 등) */
const scoped = (key, groupKey, category) => {
  const all = TAXONOMY[key] || []
  const group = TAXONOMY.category_groups?.[category]
  const groups = TAXONOMY[groupKey]
  if (!group || !groups) return all
  return all.filter((value) => !groups[value] || groups[value].includes(group))
}
```

그리고 `optionsFor`를 갈아끼운다:
```js
export function optionsFor(key, category) {
  if (TAXONOMY) {
    switch (key) {
      case 'category': return TAXONOMY.categories || []
      case 'subtype': return category ? scoped('sub_types', 'sub_types_groups', category) : []
      case 'area': return scoped('body_parts', 'body_parts_groups', category)
      case 'type': return scoped('skin_types', 'skin_types_groups', category)
      case 'concern': return scoped('concerns', 'concerns_groups', category)
      case 'result': return scoped('results', 'results_groups', category)
      case 'condition': return TAXONOMY.conditions || []
      default: return []
    }
  }
  switch (key) {
    case 'category': return CATEGORIES
    case 'subtype': return category ? SUBTYPES[category] || [] : []
    case 'area': return AREAS
    case 'type': return category === '두피·헤어' ? SCALP_TYPES : SKIN_TYPES
    case 'concern': return CONCERNS
    case 'result': return RESULTS
    case 'condition': return CONDITIONS
    default: return []
  }
}
```

- [ ] **Step 3: 원격 로드 함수를 추가한다**

`apps/studio/src/lib/taggingCatalog.js` 끝에 붙인다:
```js
/* ── 원격(사내망 tagging-api) ──
   실패하면 null을 돌려준다 — 호출부가 목업 시드로 폴백해 화면이 깨지지 않게 한다. */
const TAGGING_API = '/api/tagging'
let remote = false
export const isRemote = () => remote

export async function fetchTaggingBootstrap() {
  try {
    const res = await fetch(`${TAGGING_API}/bootstrap`)
    if (!res.ok) throw new Error(`bootstrap ${res.status}`)
    const data = await res.json()
    if (!Array.isArray(data.units)) throw new Error('units 없음')
    applyTaxonomy(data.taxonomy)
    remote = true
    return data
  } catch (err) {
    console.warn('[tagging] 원격 로드 실패 — 목업으로 표시합니다:', err.message)
    remote = false
    return null
  }
}
```

- [ ] **Step 4: TaggingStudio를 비동기 로드로 바꾼다**

`apps/studio/src/components/TaggingStudio.jsx`:

import에 `fetchTaggingBootstrap`, `isRemote`를 더한다.

`const [units, setUnits] = useState(loadTaggingReview)` 를 다음으로 바꾼다:
```jsx
  const [units, setUnits] = useState([])
  const [source, setSource] = useState('loading') // 'loading' | 'remote' | 'local'
```

`useEffect(() => { saveTaggingReview(units) }, [units])` 를 다음으로 바꾼다:
```jsx
  useEffect(() => {
    let alive = true
    fetchTaggingBootstrap().then((boot) => {
      if (!alive) return
      if (boot) {
        setUnits(boot.units)
        setSource('remote')
      } else {
        setUnits(loadTaggingReview())
        setSource('local')
      }
    })
    return () => { alive = false }
  }, [])

  /* 목업 모드에서만 로컬에 남긴다. 원격 모드의 저장은 Task 5의 단건 PATCH가 맡는다. */
  useEffect(() => {
    if (source === 'local') saveTaggingReview(units)
  }, [units, source])
```

`const [selectedId, setSelectedId] = useState(...)` 의 초기값을 `useState(null)`로 바꾸고, 아래에 선택 보정을 넣는다:
```jsx
  useEffect(() => {
    if (selectedId || !units.length) return
    setSelectedId(units.find(needsReviewUnit)?.id ?? units[0].id)
  }, [units, selectedId])
```

`const unit = listed.find(...) || units[0]` 는 목록이 비면 `undefined`가 되고, 바로 아래
파생값 계산(`validateUnit(unit)`·`totalTags(unit)`)이 터진다. **폴백을 그 한 줄에서 끝낸다** —
아래로 이어지는 코드는 손대지 않는다:
```jsx
  const unit = listed.find((u) => u.id === selectedId) || listed[0] || units.find((u) => u.id === selectedId) || units[0] || EMPTY_UNIT
```
파일 상단(`const formatPrice` 정의 위)에 자리표시자를 둔다:
```jsx
/* 로딩 중·빈 목록에서 파생값 계산이 터지지 않게 하는 자리표시자.
   화면 자체는 아래 로딩 가드에서 갈린다 — 이 값이 그려지는 일은 없다. */
const EMPTY_UNIT = {
  id: null, brand: '', name: '', option: '', price: null, imageUrl: null, catalogTags: [],
  copy: '', review: '', confidence: 0, confidenceLevel: null, rationale: '', decision: null,
  note: '', tagRequest: {},
  fields: Object.fromEntries(FIELD_DEFS.map((d) => [d.key, { selected: [], rep: null, status: 'unreviewed', origin: 'ai' }])),
  aiFields: Object.fromEntries(FIELD_DEFS.map((d) => [d.key, { selected: [], rep: null, status: 'unreviewed', origin: 'ai' }])),
}
```

그리고 `return (` 바로 앞에 화면 가드를 넣는다:
```jsx
  if (source === 'loading') {
    return (
      <section className={'sb-tagging' + (embedded ? ' sb-tagging--embedded' : '')}>
        <p className="sb-tagging__loading">태깅 데이터를 불러오는 중…</p>
      </section>
    )
  }
```

- [ ] **Step 5: 목업 폴백 배너를 단다**

`sb-tagging__head` 안, `sb-tagging__title` 다음에 넣는다:
```jsx
        {source === 'local' && (
          <p className="sb-tagging__fallback">
            사내망 태깅 서버에 닿지 못해 <b>예시 데이터</b>를 보고 있어요. 실제 검토는 사내망에서 열어주세요.
          </p>
        )}
```

`apps/studio/src/styles/tagging.css` 끝에 추가한다:
```css
/* 원격 로드 실패·로딩 안내 — 실데이터가 아님을 화면에서 분명히 한다 */
.sb-tagging__fallback {
  margin: 8px 0 0;
  padding: 8px 12px;
  border-radius: var(--sb-r-sm);
  background: var(--sb-n-50);
  color: var(--sb-warn-ink);
  font-size: var(--sb-t-small);
}
.sb-tagging__loading {
  padding: 48px 0;
  text-align: center;
  color: var(--sb-muted);
  font-size: var(--sb-t-body);
}
```

- [ ] **Step 6: 화면으로 확인한다**

tagging-api를 띄운 상태에서 `.claude/launch.json`의 `scenario-studio`를 실행하고 `#ops/tagging`을 연다.
Expected: 목록에 실제 올리브영 상품이 719건 뜨고, 필드 칩이 사전(세부유형 40종·부위 18종) 기준으로 보인다. 콘솔에 에러가 없다.
tagging-api를 끄고 새로고침하면 예시 데이터 배너와 함께 14건이 보인다.

- [ ] **Step 7: 커밋**

```bash
git add apps/studio
git commit -m "feat(tagging): 사내망 API에서 상품·사전을 불러온다 (실패 시 예시 폴백)"
```

---

### Task 5: FE — 저장 배선 (쓰기)

**Files:**
- Modify: `apps/studio/src/lib/taggingCatalog.js`, `apps/studio/src/components/TaggingStudio.jsx`

**Interfaces:**
- Consumes: `PATCH /api/tagging/units/:id` (Task 2), `POST /api/tagging/units/:id/review` (Task 3), `isRemote()` (Task 4)
- Produces: `saveTaggingUnit(unit): Promise<boolean>`, `saveTaggingDecision(id, decision): Promise<boolean>`

- [ ] **Step 1: 저장 함수를 추가한다**

`apps/studio/src/lib/taggingCatalog.js`의 `fetchTaggingBootstrap` 아래:
```js
/* 편집 저장. 서버가 화이트리스트를 들고 있으므로 화면은 필요한 것만 실어 보낸다. */
export async function saveTaggingUnit(unit) {
  const body = {
    fields: Object.fromEntries(FIELD_DEFS.map((d) => {
      const f = unit.fields[d.key]
      return [d.key, { selected: f.selected, rep: f.rep, status: f.status, origin: f.origin }]
    })),
    tagRequest: unit.tagRequest || {},
    note: unit.note || '',
  }
  return postTagging(`/units/${encodeURIComponent(unit.id)}`, 'PATCH', body)
}

export async function saveTaggingDecision(id, decision) {
  return postTagging(`/units/${encodeURIComponent(id)}/review`, 'POST', { decision })
}

async function postTagging(path, method, body) {
  try {
    const res = await fetch(`${TAGGING_API}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${method} ${path} ${res.status}`)
    return true
  } catch (err) {
    console.warn('[tagging] 저장 실패:', err.message)
    return false
  }
}
```

- [ ] **Step 2: 편집 저장을 배선한다 (디바운스)**

`apps/studio/src/components/TaggingStudio.jsx`의 로컬 저장 effect 아래에 넣는다. import에 `saveTaggingUnit`, `saveTaggingDecision`을 더한다:
```jsx
  /* 원격 모드의 저장은 바뀐 단위 한 건만 보낸다. 네트워크 너머라 침묵이 곧 유실이므로
     실패는 토스트로 알린다(로컬 저장 시절엔 조용해도 무방했다). */
  const dirtyRef = useRef(new Map())
  const flushTimer = useRef(null)
  const queueSave = (nextUnit) => {
    if (source !== 'remote' || !nextUnit?.id) return
    dirtyRef.current.set(nextUnit.id, nextUnit)
    window.clearTimeout(flushTimer.current)
    flushTimer.current = window.setTimeout(async () => {
      const pending = [...dirtyRef.current.values()]
      dirtyRef.current.clear()
      for (const item of pending) {
        const ok = await saveTaggingUnit(item)
        if (!ok) api.showToast(`「${item.name}」 저장에 실패했어요. 연결을 확인해주세요.`)
      }
    }, 600)
  }
```

`patchUnit`이 모든 편집의 관문이므로 거기서 부른다:
```jsx
  const patchUnit = (updater) => {
    setUnits((prev) => prev.map((u) => {
      if (u.id !== unit.id) return u
      const next = updater(u)
      queueSave(next)
      return next
    }))
  }
```

- [ ] **Step 3: 승인·반려를 배선한다**

`approve`·`reject`를 고친다:
```jsx
  const approve = async () => {
    if (errs.length) return api.showToast('규칙 위반이 있어 승인할 수 없어요.')
    if (unreviewedFields.length) return api.showToast('미검토 항목이 남아 있어요. 확인 후 승인해주세요.')
    patchUnit((u) => ({ ...u, decision: 'approved' }))
    if (source === 'remote' && !(await saveTaggingDecision(unit.id, 'approved'))) {
      return api.showToast('승인을 저장하지 못했어요. 연결을 확인해주세요.')
    }
    api.showToast('승인 처리되었습니다.')
  }

  const reject = async () => {
    patchUnit((u) => ({ ...u, decision: 'rejected' }))
    if (source === 'remote' && !(await saveTaggingDecision(unit.id, 'rejected'))) {
      return api.showToast('반려를 저장하지 못했어요. 연결을 확인해주세요.')
    }
    api.showToast('반려 처리되었습니다.')
  }
```

- [ ] **Step 4: AI 원본 되돌리기를 서버 값으로 바꾼다**

원격 모드에는 `TAGGING_SEED`가 없다. `restoreAiField`의 시드 조회를 갈아끼운다:
```jsx
  const restoreAiField = (key) => {
    const origin = source === 'remote' ? unit.aiFields : TAGGING_SEED.find((c) => c.id === unit.id)?.fields
    if (!origin) return
    const keys = key === 'category' ? ['category', 'subtype', 'type'] : [key]
    patchUnit((current) => {
      const fields = { ...current.fields }
      const tagRequest = { ...current.tagRequest }
      for (const restoreKey of keys) {
        fields[restoreKey] = { ...origin[restoreKey], selected: [...origin[restoreKey].selected] }
        tagRequest[restoreKey] = false
      }
      return { ...current, fields, tagRequest, decision: null }
    })
    setUnlockedFields((prev) => {
      const next = { ...prev }
      for (const restoreKey of keys) delete next[fieldEditKey(unit.id, restoreKey)]
      return next
    })
    api.showToast(key === 'category' ? '대분류와 연결 항목을 AI 원본으로 되돌렸어요.' : 'AI가 분류한 원본 값으로 되돌렸어요.')
  }
```
`restoreCurrentUnit`·`resetAll`은 원격 모드에서 의미가 달라진다(시드가 없다). 원격이면 되돌리기 대신 서버 재로드로 처리한다:
```jsx
  const restoreCurrentUnit = () => {
    if (!window.confirm(`「${unit.name}」의 담당자 수정·검토 메모를 지우고 AI 원본으로 되돌릴까요?`)) return
    if (source === 'remote') {
      const restored = {
        ...unit,
        fields: Object.fromEntries(FIELD_DEFS.map((d) => [d.key, { ...unit.aiFields[d.key], selected: [...unit.aiFields[d.key].selected] }])),
        tagRequest: {},
        note: '',
        decision: null,
      }
      setUnits((prev) => prev.map((c) => (c.id === unit.id ? restored : c)))
      queueSave(restored)
    } else {
      const fresh = freshSeedUnit(unit.id)
      if (!fresh) return
      setUnits((prev) => prev.map((c) => (c.id === unit.id ? fresh : c)))
    }
    setUnlockedFields((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${unit.id}:`))))
    setOpenWhy({})
    api.showToast('선택한 상품을 AI 원본으로 되돌렸어요.')
  }
```
`resetAll` 버튼은 원격 모드에서 숨긴다(719건을 한 번에 되돌리는 버튼은 사고만 부른다). 버튼 렌더 자리에 `{source !== 'remote' && (…)}`를 두른다.

- [ ] **Step 5: 화면으로 왕복을 확인한다**

`#ops/tagging`에서 상품 하나의 고민 태그를 바꾸고 1초 기다린 뒤 새로고침한다.
Expected: 바뀐 값이 그대로 있다.
승인 버튼을 누르고 Flask(`localhost:8021`)의 그 상품 페이지에서 "검토완료"인지 확인한다.
tagging-api를 끈 채 태그를 바꾸면 저장 실패 토스트가 뜬다.

- [ ] **Step 6: 커밋**

```bash
git add apps/studio
git commit -m "feat(tagging): 편집·승인·반려를 Mongo에 저장"
```

---

### Task 6: FE — 검색창·대시보드 타일·문서

**Files:**
- Modify: `apps/studio/src/components/TaggingStudio.jsx`, `apps/studio/src/components/AdminDashboard.jsx`, `apps/studio/src/styles/tagging.css`, `CLAUDE.md`

**Interfaces:**
- Consumes: `GET /api/tagging/summary` (Task 1)

- [ ] **Step 1: 검색창을 단다**

`TaggingStudio.jsx`에 상태를 더한다: `const [query, setQuery] = useState('')`

`listed` 필터에 검색을 더한다:
```jsx
  const needle = query.trim().toLowerCase()
  const listed = units.filter((u) => {
    if (needle && !`${u.brand} ${u.name}`.toLowerCase().includes(needle)) return false
    if (listFilter === 'all') return true
    if (listFilter === 'needs-review') return needsReviewUnit(u)
    return statusById.get(u.id) === listFilter
  })
```

`sb-tagging__filters` 앞에 입력을 넣는다:
```jsx
        <input
          className="sb-tagging__search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="브랜드·상품명 검색"
        />
```

`apps/studio/src/styles/tagging.css` 끝:
```css
/* 719건에서 한 건을 찾는 입구 — 상태 필터 알약만으로는 못 찾는다 */
.sb-tagging__search {
  min-width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--sb-n-200);
  border-radius: var(--sb-r-sm);
  background: var(--sb-surface);
  color: var(--sb-ink);
  font-size: var(--sb-t-small);
}
```

- [ ] **Step 2: 대시보드 타일을 요약 API로 바꾼다**

`AdminDashboard.jsx:11-16`의 `tagging`·`tagCounts` 두 `useMemo`를 지우고 다음으로 바꾼다
(719건 본문을 대시보드가 받지 않게 요약 API를 쓴다):
```jsx
  const [tagSummary, setTagSummary] = useState({ counts: {}, total: 0 })
  useEffect(() => {
    let alive = true
    fetch('/api/tagging/summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive) return
        if (data) return setTagSummary(data)
        /* 사내망 밖: 예시 데이터로 타일을 채운다 */
        const local = loadTaggingReview()
        const counts = local.reduce((out, unit) => {
          const key = unitStatusKey(unit)
          out[key] = (out[key] || 0) + 1
          return out
        }, {})
        setTagSummary({ counts, total: local.length })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const tagCounts = tagSummary.counts
  const tagTotal = tagSummary.total
```
`import React, { useMemo } from 'react'` 를 `import React, { useEffect, useMemo, useState } from 'react'` 로 바꾼다.

`tagging.length`를 읽는 세 자리(`AdminDashboard.jsx:32`, `:36`, `:52`)를 `tagTotal`로 바꾼다:
```jsx
  const reviewRate = pct(approvedTags, tagTotal)
```
```jsx
        { value: tagQueue, label: '태깅 검토 대기', note: `전체 ${tagTotal}개 작업 단위`, tone: tagQueue ? 'warn' : 'good', tab: 'tagging', icon: '✓', progress: reviewRate },
```
```jsx
        { label: '태그 검토 완료', value: approvedTags, total: tagTotal, tone: 'mint' },
```
`:28`의 `tagCounts.fix`는 서버 요약에 없는 값이라 `|| 0` 폴백이 그대로 동작한다 — 손대지 않는다.


- [ ] **Step 3: 화면으로 확인한다**

`#ops`(대시보드)에서 "태깅 검토 대기" 타일이 719건 기준 숫자로 바뀌었는지, `#ops/tagging`에서 브랜드명으로 검색이 되는지 확인한다.

- [ ] **Step 4: 확신도·근거를 상품 단위로 옮긴다**

문서에는 확신도·근거가 **상품당 하나씩**만 있다(`confidence`·`rationale`). 지금 화면은 필드마다
확신도 바와 근거 접기를 그리는데, `toUnit`은 필드에 그 값을 넣지 않으므로 원격 모드에서
`field.confidence`가 `undefined`가 되어 바가 깨진다. 상품 패널로 한 번만 올리고 필드에서는 뺀다.

`sb-tagging-pinfo`의 `<dl>` 안, 상품 ID 항목(`TaggingStudio.jsx:410-411`) 뒤에 붙인다:
```jsx
              <dt>AI 확신도</dt>
              <dd>
                <span className={`sb-tagging-conf sb-tagging-conf--${confLevel(unit.confidence)}`} title="AI 확신도">
                  <i style={{ width: `${unit.confidence}%` }} />
                  <b>{unit.confidence}%</b>
                </span>
              </dd>
              <dt>AI 판단 근거</dt>
              <dd>{unit.rationale}</dd>
```

필드별 확신도 바(`:473-480`)를 원격 모드에서 감춘다:
```jsx
                    {source !== 'remote' && (
                      <span
                        className={`sb-tagging-conf sb-tagging-conf--${confLevel(field.confidence)}`}
                        title="AI 확신도"
                      >
                        <i style={{ width: `${field.confidence}%` }} />
                        <b>{field.confidence}%</b>
                      </span>
                    )}
```

필드별 근거 접기 버튼(`:534-540`)과 그 본문(`:560`)도 같은 이유로 감춘다 — 원격 모드에선 상품
근거와 같은 문장이 7번 반복될 뿐이다:
```jsx
                  {source !== 'remote' && (
                    <button
                      type="button"
                      className="sb-tagging-why"
                      onClick={() => setOpenWhy((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                    >
                      {openWhy[def.key] ? '근거 접기 ▴' : '선택 근거 ▾'}
                    </button>
                  )}
```
```jsx
                {source !== 'remote' && openWhy[def.key] && <p className="sb-tagging-rationale">{field.rationale}</p>}
```

확인: `#ops/tagging`에서 상품 정보 패널에 확신도 바와 근거 문장이 한 번 보이고, 가운데 필드
카드에는 확신도 바가 없다. 콘솔에 `NaN`·`undefined%` 경고가 없다.

- [ ] **Step 5: CLAUDE.md를 고친다**

`components/TaggingStudio.jsx + lib/taggingCatalog.js` 항목의 마지막 문장을 고친다. 지금은 "상품 정체성은 apps/bff/src/llm/catalog.ts의 FE 사본 … 검토 상태는 localStorage(`ddak-tagging-review-v2`) 전용"이라고 적혀 있는데, 사실이 아니게 된다. 다음으로 바꾼다:

> 데이터 원천은 **사내망 Mongo(`oliveyoung.products`)**다 — `apps/tagging-api`(NestJS, 포트 8790)가 읽고 되쓴다(문서↔화면 변환·되쓰기 화이트리스트는 `src/mapping.ts` 한 곳). 사전은 Python 저장소(`oliveyoung-collector-poc`)의 `taxonomy.json`을 `TAXONOMY_PATH`로 읽어 실어 보낸다 — 사본을 만들지 않는다. 승인/반려는 Flask 대시보드와 공유하는 `review_status`(`reviewed`/`needs_fix`)에, 화면 전용 상태(필드별 검토 표시·메모·AI 원본 스냅샷)는 추가형 `review_meta` 하나에 담는다. **Mongo가 사설 IP라 Vercel 서버리스에서는 닿지 못한다** — 배포본에서는 API 호출이 실패하고 예시 데이터(`TAGGING_SEED`)로 폴백한다. 검증 규칙은 아직 Flask `tagging_rules.py`와 두 벌이다(분야 불일치·택소노미 밖 값은 DDAK 쪽에 없다).

- [ ] **Step 6: 빌드가 깨지지 않는지 확인한다**

```bash
npm run build --workspace=apps/studio && npm run build --workspace=apps/tagging-api
```
Expected: 두 빌드 모두 성공

- [ ] **Step 7: 커밋**

```bash
git add apps/studio CLAUDE.md
git commit -m "feat(tagging): 검색창·대시보드 요약 연결 + 문서 갱신"
```
