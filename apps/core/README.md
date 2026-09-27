# ddak-core

DDAK backend core — 쓰레드 저장·조회. NestJS. 계약(요청/응답 zod 스키마)은 `@ddak/schema`(packages/schema)가 단일 출처다.
설계 배경은 저장소 루트의 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §3 참고.

## 저장소는 둘이고, 배포 설정이 고른다

이 코드는 두 저장소 위에서 돈다 — **Neon Postgres(Drizzle)** 와 **사내 MongoDB**. 어느 쪽을 쓸지는 코드가 아니라
배포 환경이 정한다(`src/db/store.ts`):

| 배포 | 저장소 | 설정 |
|---|---|---|
| github.com `dlwlsgkdn/gmkt-intent-home` → Vercel `ddak-core` | Neon | `CORE_STORE=neon` + Neon 통합이 주입한 `DATABASE_URL` |
| 사내 GHE `eevee-labatory` → 퓨전(OpenShift) | Mongo | `.s2i/environment` 의 `CORE_STORE=mongo` + 시크릿 `MONGO_URI`(`MONGO_DB`, 기본 eevee) |

규칙: `CORE_STORE=neon|mongo` 가 있으면 그것, 없으면 `MONGO_URI` → mongo, `DATABASE_URL` → neon, 둘 다 없으면 none(부팅은 되고
DB 라우트만 503 — healthz 는 200 이고 `store` 필드가 무엇이 골라졌는지 보여 준다). 값이 잘못되면 부팅에서 바로 죽는다.
**코드는 두 저장소가 완전히 같아야** 이 저장소 → eevee-labatory 커밋 이관이 충돌 없이 흐른다 — 그래서 저장소별 파일이 아니라
환경변수다. 테스트 `test/store.test.mjs`.

구조: 도메인(threads·settings·eval·catalog)마다 **추상 클래스 = 계약 = DI 토큰**(`*.service.ts`)이 있고, 구현이 둘
(`*.neon.service.ts` · `*.mongo.service.ts`)이다. 모듈이 `storeProvider(계약, Neon 구현, Mongo 구현)` 한 줄로 이 프로세스의 것을
꽂고, 컨트롤러는 계약만 안다. 두 구현은 같은 와이어(`src/db/wire.ts` 의 모양 — Neon 은 `src/db/neon.wire.ts` 가 Date→ISO 로 맞춘다)를
돌려주어야 하며, 새 메서드는 계약에 먼저 적고 두 구현에 같이 넣는다. `DbModule` 은 둘을 다 제공하되 고른 쪽만 연결한다
(Neon: `src/db/neon.client.ts`·`neon.schema.ts`(drizzle 표), Mongo: `src/db/mongo.service.ts`·`schema.ts`(문서 형태)).

## 로컬 실행

```bash
# 리포 루트에서 (워크스페이스 설치 — @ddak/schema는 install 시 prepare로 빌드됨)
npm install

# .env 준비 — CORE_STORE 와 그 저장소의 접속 문자열, CORE_SERVICE_TOKEN
cp apps/core/.env.example apps/core/.env
# Neon 이면 Vercel 통합 값을 받아 쓰는 게 빠르다: (apps/core 에서) vercel env pull .env.local

# 실행
npm run start:dev --workspace=apps/core    # http://localhost:8790/healthz → { store: 'neon' | 'mongo' | 'none' }
```

접속 문자열 없이도, 사내망 밖이라 Mongo 연결에 실패해도 부팅된다 — DB를 쓰는 라우트만 503을 준다
(쿠버네티스 프로브가 Pod을 죽이지 않는다). Mongo 인덱스(유니크 포함)는 연결 성공 시 기동 로그 한 줄과 함께
자동 생성된다(`src/db/mongo.service.ts` ensureIndexes). Neon 은 마이그레이션으로 스키마를 만든다(아래).

## DB 마이그레이션 (Neon — drizzle)

```bash
npm run db:generate --workspace=apps/core   # src/db/neon.schema.ts → drizzle/ SQL 생성
npm run db:migrate --workspace=apps/core    # drizzle/ SQL을 저널 순서대로 적용 (권장 반영 경로)
npm run db:migrate --workspace=apps/core -- --status     # 저널 vs 적용 이력
npm run db:migrate --workspace=apps/core -- --baseline   # push 등으로 이미 최신인 DB에 이력만 표시 (최초 1회)
```

**반영은 `db:migrate`가 기본 경로다.** `db:push`는 diff를 즉석 ALTER로 만들기 때문에 캐스트가 없는 타입 전환(실사례: 0001의
uuid→text)에서 실패한다 — migrate는 커밋된 SQL을 그대로 실행하므로 파일에 적힌 대로 재현된다. 적용 이력은
`drizzle.__drizzle_migrations`에 남는다. `DATABASE_URL` 은 `.env`/`.env.local` 에서 읽는다(`scripts/migrate.mjs`).
Mongo 는 마이그레이션이 없다 — 컬렉션은 첫 upsert 에 저절로 생기고 인덱스는 기동 시 보장된다.

## Neon → Mongo 데이터 이관 스크립트 (일회성)

`scripts/import-from-neon.mjs` — `DATABASE_URL`(Neon)에서 5개 테이블을 읽어 Mongo로 옮긴다.

```bash
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-from-neon.mjs --dry-run   # 건수만 확인
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-from-neon.mjs --overwrite  # 실제 적재
```

`--overwrite` 없이는 실제 적재를 거부한다(안전장치). 대상 컬렉션에 이미 있는 문서는 `_id`로 덮어쓴다(재실행 멱등).
`scripts/import-catalog-from-neon.mjs` 는 **내재화 카탈로그 전용** 같은 성격의 스크립트(2026-09-23 결정으로 실행하지 않고 남겨 둠).

## threadId — 스노우플레이크

쓰레드 생성 시 core가 발급한다 (`src/common/snowflake.ts`): 64비트 = 41b ms 타임스탬프 | 10b 워커 |
12b 시퀀스. 에포크(2010-01-01) 덕에 **항상 19자리 십진 문자열**(2079년경까지)이라 문자열 사전순
정렬 = 생성 시각순 — DB(text)·와이어(JSON) 모두 문자열 하나로 다루고 변환 계층이 없다.
워커 id는 `SNOWFLAKE_WORKER_ID`(0~1023)로 고정 가능 — 비우면 인스턴스마다 무작위 배정
(서버리스 콜드스타트 대응).

## internal API (BFF 전용 — `Authorization: Bearer <CORE_SERVICE_TOKEN>`)

| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/internal/threads` | 쓰레드 생성 — threadId(스노우플레이크) 발급 |
| PATCH | `/internal/threads/:id` | title/status 갱신 |
| PUT | `/internal/threads/:id/steps/:seq` | 스텝 멱등 upsert |
| GET | `/internal/threads/:id` | 쓰레드 + 스텝 전체 (이어보기) |
| GET | `/internal/users/:uid/threads?cursor=&limit=` | 목록 (updatedAt 키셋 커서) |
| POST | `/internal/catalog/products/search` · `/internal/catalog/contents/search` | **내재화 카탈로그** 검색 — `{ terms[], typeTerms?, limit?, verifiedOnly?, mall? }`, search_text 부분 일치 점수순 (2026-09-17) |
| PUT | `/internal/catalog/products` · `/internal/catalog/contents` | 일괄 upsert (≤500) — `bump=true` 면 수확(노출 횟수 누적·출처/검증/상태 보존·태그 합집합) |
| PATCH | `/internal/catalog/products/:id` · `/internal/catalog/contents/:id` | `verified`·`status(active\|dead)` 표시 |
| GET | `/internal/catalog/products?…` · `/internal/catalog/contents?…` | **둘러보기** — q·mall·source·type·verified·status 필터, updated_at 내림차순 키셋 커서 `<updatedAt>|<id>`(`cursor`), limit ≤100 → `{ items, nextCursor, total }` (운영 콘솔 「데이터 시딩」 표 — 미검증·dead 포함) |
| GET | `/internal/catalog/products/verify-list?mall=&limit=` · `/internal/catalog/stats` | 점검 대상(오래 안 본 순) · 현황 |
| POST | `/internal/catalog/ensure-schema` | 표 만들기(멱등) — Neon 은 마이그레이션 0005 와 같은 DDL + drizzle 이력 기록, Mongo 는 컬렉션·인덱스 보장 (운영 콘솔 「여기서 표 만들기」) |
| GET | `/healthz` (`/health`) | 헬스체크 (가드 밖) — `{ ok, service, store, now }` |

## 내재화 카탈로그 (2026-09-17)

`catalog_products`·`catalog_contents` — 추천 상품·참고 콘텐츠의 내부 표. 계획 생성(BFF 5b·5c)이 의도·답변 검색어로 여기서 후보를 받아
**내부 70% + 웹 검색 30%**(v30)로 고른다(계약 `@ddak/schema` catalog.ts, 배선 `apps/bff/src/catalog/catalog.service.ts`). core 는 저장·검색만:
검색은 `searchText`(이름·브랜드·태그·카테고리 정규화 연결)에 검색어가 부분 일치하는 개수 — 제품 유형 낱말은 2점 — 로 점수를 매기고,
동률은 검증·노출 횟수·리뷰 수가 가른다. **순위 규칙은 두 구현이 같아야 한다.**

- **Neon**(`src/catalog/catalog.neon.service.ts`): 표 2개(마이그레이션 0005) + `pg_trgm` GIN 인덱스가 ILIKE 를 받는다. 병합(bump)은
  `onConflictDoUpdate` 한 문장 — 노출 횟수 누적·태그 합집합(계약 상한까지)·검증 OR 을 SQL 이 한다. 수천~수만 행에서 한 자리 ms.
- **Mongo**(`src/catalog/catalog.mongo.service.ts`): 컬렉션 2개. 정규식 부분 일치로 후보를 거른 뒤 Node 에서 점수·정렬한다
  (`src/catalog/catalog.logic.ts` — 병합·점수·커서 규칙은 순수 함수라 `test/catalog.test.mjs` 가 DB 없이 검증하고, 서비스는 인메모리
  가짜 컬렉션 위에서 `test/catalog-service.test.mjs` 가 검증한다). **수확(bump)은 updateOne 으로 쓴다**(2026-09-23) — 노출 횟수는
  `$inc`, 검증은 이번 행이 true 일 때만 `$set` 이라 동시 수확에도 +1 이 묻히지 않는다(`harvestUpdateOf`). 수천~수만 행이면 정규식
  스캔(`SEARCH_SCAN_CAP` 5000)도 수십 ms 안. 인덱스는 기동 시(`mongo.service.ts ensureCatalogIndexes`)와 `ensure-schema` 가 멱등으로 만든다.

```bash
npm run export:catalog --workspace=apps/tagging-api -- --out oy.json   # (사내망) 올리브영 Mongo → 행 JSON
npm run build --workspace=apps/core                                    # Mongo seed 스크립트가 dist 의 병합 규칙을 쓴다
MONGO_URI=<사내 Mongo> npm run seed:catalog --workspace=apps/core -- --file oy.json        # Mongo 컬렉션에 직접 upsert — 멱등(bump 없음)
DATABASE_URL=<neon>    npm run seed:catalog:neon --workspace=apps/core -- --file oy.json   # Neon 표에 직접 upsert (db:migrate 먼저)
```

시딩 재료는 셋이다(2026-09-17): ① 운영 콘솔 「데이터 시딩」 메뉴(`#ops/seeding`, 서비스 품질 그룹)의 「✦ 시딩 잡 시작」 — 제품 유형 42개마다
BFF 가 LLM+web_search 로 실제 판매 상품을 모아 올린다(유형만 약 $5·몇 분. 대량은 조건 칩(피부 타입·고민·가격대·몰)으로 유형×조건까지 펼치거나
`npm run seed:search --workspace=apps/bff -- --bff <BFF 주소> --token <토큰> --facets skin,concern` 배치 스크립트로 — 단위당 약 $0.14, 중단·재개 가능) ② 같은 메뉴의 「쓰레드에서 수확」 — 지난 계획의 검증 통과 상품·콘텐츠
백필(실주행은 7단계 기록이 자동 수확) ③ 위 올리브영 Mongo 내보내기 JSON — 이 스크립트 또는 메뉴의 「JSON 가져오기」. 스튜디오 SRP 스냅샷·데모
카탈로그는 시딩에 쓰지 않는다. 상품 링크 점검(지마켓 썸네일·그 밖 몰 상품 주소 HEAD 로 내려간 상품을 dead 표시)도 그 메뉴에 있다.

## Vercel 배포 (`ddak-core` — Neon)

1. Vercel에서 **같은 GitHub 리포**로 프로젝트 생성, **Root Directory: `apps/core`**, Framework Preset: Other (Build Command는 자동으로 `npm run build`)
2. 환경변수: **`CORE_STORE=neon`**, Neon 통합의 `DATABASE_URL`, `CORE_SERVICE_TOKEN`, **`NODEJS_HELPERS=0`** (Vercel의 body
   헬퍼가 Express 파서와 이중 파싱하는 문제 방지), `NPM_CONFIG_REGISTRY=https://registry.npmjs.org/`(루트 `.npmrc` 의 사내 미러 우회 —
   루트 CLAUDE.md 「사외 빌드와 사내 미러」)
3. Ignored Build Step은 apps/core/vercel.json의 ignoreCommand로 설정됨 — 대시보드 설정 불필요
4. 배포 후 `https://<프로젝트>.vercel.app/healthz` 의 `store` 가 `neon` 인지 확인

동작 방식: `npm run build`(nest build → dist/) 후 `api/index.js`가 dist의 Nest 앱을
콜드스타트당 1회 부트스트랩하고, vercel.json의 rewrite가 모든 경로를 그 함수로 보낸다. 사내 퓨전 배포는 루트 [FUSION-MIGRATION.md](../../FUSION-MIGRATION.md).
