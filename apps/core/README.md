# ddak-core

DDAK backend core — 쓰레드 저장·조회. NestJS + 사내 MongoDB.
계약(요청/응답 zod 스키마)은 `@ddak/schema`(packages/schema)가 단일 출처다.
설계 배경은 저장소 루트의 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §3 참고.

**저장소는 사내 MongoDB다**(2026-09, Neon Postgres/Drizzle에서 이관). 사내 OpenShift Pod에서
Neon(외부 인터넷)에 닿을지 불확실했고, 사내 Mongo는 `apps/tagging-api`가 이미 검증한 경로다.
core는 tagging-api와 별도 프로세스라 자기 Mongo 연결을 따로 갖는다. 문서 형태는
`src/db/schema.ts`, 문서↔API 응답 변환은 `src/db/wire.ts`(순수 함수, `test/`가 검증) 참고.

## 로컬 실행

```bash
# 리포 루트에서 (워크스페이스 설치 — @ddak/schema는 install 시 prepare로 빌드됨)
npm install

# .env 준비
cp apps/core/.env.example apps/core/.env   # MONGO_URI·CORE_SERVICE_TOKEN 채우기

# 실행
npm run start:dev --workspace=apps/core    # http://localhost:8790/healthz
```

MONGO_URI 없이도, 사내망 밖이라 연결에 실패해도 부팅된다 — DB를 쓰는 라우트만 503을 준다
(healthz는 항상 200, 쿠버네티스 프로브가 Pod을 죽이지 않는다). 인덱스(유니크 포함)는
연결 성공 시 기동 로그 한 줄과 함께 자동 생성된다(`src/db/mongo.service.ts` ensureIndexes).

## 기존 Neon 데이터 이관

`scripts/import-from-neon.mjs` — 일회성 스크립트. `DATABASE_URL`(Neon)에서 5개 테이블을 읽어
Mongo로 옮긴다.

```bash
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-from-neon.mjs --dry-run   # 건수만 확인
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-from-neon.mjs --overwrite  # 실제 적재
```

`--overwrite` 없이는 실제 적재를 거부한다(안전장치). 대상 컬렉션에 이미 있는 문서는 `_id`로
덮어쓴다(재실행 멱등).

`scripts/import-catalog-from-neon.mjs` — **내재화 카탈로그 전용** 같은 성격의 일회성 스크립트(2026-09-23).
옛 GitHub 저장소가 Neon 표 `catalog_products`·`catalog_contents`(마이그레이션 0005)에 쌓아 둔 시딩·수확 행을
같은 이름의 Mongo 컬렉션으로 옮긴다. 값은 그대로 옮기고(노출 횟수·생성 시각 포함) 새로 계산하지 않는다.

```bash
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-catalog-from-neon.mjs --dry-run   # 표별 건수 + 겹치는 _id 수
DATABASE_URL=<neon> MONGO_URI=<mongo> node apps/core/scripts/import-catalog-from-neon.mjs --overwrite # 실제 적재
```

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
| POST | `/internal/catalog/ensure-schema` | 표 만들기 — 카탈로그 컬렉션·인덱스 보장 (멱등, 운영 콘솔 「여기서 표 만들기」). Mongo 라 마이그레이션은 없다 |
| GET | `/healthz` | 헬스체크 (가드 밖) |

## 내재화 카탈로그 (2026-09-17 · Mongo 포팅 2026-09-22)

`catalog_products`·`catalog_contents` 컬렉션 — 추천 상품·참고 콘텐츠의 내부 표. 계획 생성(BFF 5b·5c)이 의도·답변 검색어로 여기서 후보를 받아
**내부 70% + 웹 검색 30%**(v30)로 고른다(계약 `@ddak/schema` catalog.ts, 배선 `apps/bff/src/catalog/catalog.service.ts`). core 는 저장·검색만:
검색은 `searchText`(이름·브랜드·태그·카테고리 정규화 연결)에 검색어가 부분 일치하는 개수 — 제품 유형 낱말은 2점 — 로 점수를 매긴다.
GitHub 저장소의 원래 구현은 Neon 표 + `pg_trgm` ILIKE(마이그레이션 0005)였고, 이 저장소의 core 는 Mongo 라 같은 계약을 컬렉션으로 옮겼다:
정규식 부분 일치로 후보를 거른 뒤 Node 에서 점수·정렬한다(`src/catalog/catalog.logic.ts` — 병합(bump)·점수·커서 규칙은 순수 함수라
`test/catalog.test.mjs` 가 Mongo 없이 검증하고, 서비스는 인메모리 가짜 컬렉션 위에서 `test/catalog-service.test.mjs` 가 검증한다).
**수확(bump)은 replaceOne 이 아니라 updateOne 으로 쓴다**(2026-09-23) — 노출 횟수는 `$inc`, 검증은 이번 행이 true 일 때만 `$set` 이라
같은 상품을 두 계획이 동시에 수확해도 +1 이 묻히거나 검증이 false 로 되돌아가지 않는다(`harvestUpdateOf`). 태그 합집합·`searchText` 만
읽은 값에서 계산하므로 그 부분은 경합이 남고, 다음 수확에 복구된다. 수천~수만 행이면 정규식 스캔(`SEARCH_SCAN_CAP` 5000)도 수십 ms 안이다. 인덱스는 기동 시
(`mongo.service.ts ensureCatalogIndexes`)와 `POST /internal/catalog/ensure-schema`(운영 콘솔 「여기서 표 만들기」 — Mongo 에선 컬렉션·인덱스
보장)가 멱등으로 만든다. 마이그레이션은 없다 — 컬렉션은 첫 upsert 에 저절로 생긴다.

```bash
npm run export:catalog --workspace=apps/tagging-api -- --out oy.json   # (사내망) 올리브영 Mongo → 행 JSON
npm run build --workspace=apps/core                                    # seed 스크립트가 dist 의 병합 규칙을 쓴다
MONGO_URI=<사내 Mongo> npm run seed:catalog --workspace=apps/core -- --file oy.json   # 행 JSON 을 컬렉션에 직접 upsert — 멱등(bump 없음)
```

시딩 재료는 셋이다(2026-09-17): ① 운영 콘솔 「데이터 시딩」 메뉴(`#ops/seeding`, 서비스 품질 그룹)의 「✦ 시딩 잡 시작」 — 제품 유형 42개마다
BFF 가 LLM+web_search 로 실제 판매 상품을 모아 올린다(유형만 약 $5·몇 분. 대량은 조건 칩(피부 타입·고민·가격대·몰)으로 유형×조건까지 펼치거나
`npm run seed:search --workspace=apps/bff -- --bff <BFF 주소> --token <토큰> --facets skin,concern` 배치 스크립트로 — 단위당 약 $0.14, 중단·재개 가능) ② 같은 메뉴의 「쓰레드에서 수확」 — 지난 계획의 검증 통과 상품·콘텐츠
백필(실주행은 7단계 기록이 자동 수확) ③ 위 올리브영 Mongo 내보내기 JSON — 이 스크립트 또는 메뉴의 「JSON 가져오기」. 스튜디오 SRP 스냅샷·데모
카탈로그는 시딩에 쓰지 않는다. 상품 링크 점검(지마켓 썸네일·그 밖 몰 상품 주소 HEAD 로 내려간 상품을 dead 표시)도 그 메뉴에 있다.

## Vercel 배포 (신규 프로젝트)

1. Vercel에서 **같은 GitHub 리포**로 새 프로젝트 생성 (예: `ddak-core`)
2. **Root Directory: `apps/core`**, Framework Preset: Other (Build Command는 자동으로 `npm run build`)
3. 환경변수: `MONGO_URI`, `MONGO_DB`, `CORE_SERVICE_TOKEN`, **`NODEJS_HELPERS=0`** (Vercel의 body
   헬퍼가 Express 파서와 이중 파싱하는 문제 방지). Vercel 서버리스가 사내망 Mongo에 실제로
   닿을 수 있는지는 별개 확인 사항이다 — 이 앱의 주 배포 대상은 사내 OpenShift다.
4. Ignored Build Step은 apps/core/vercel.json의 ignoreCommand로 설정됨 — 대시보드 설정 불필요
5. 배포 후 `https://<프로젝트>.vercel.app/healthz` 확인

동작 방식: `npm run build`(nest build → dist/) 후 `api/index.js`가 dist의 Nest 앱을
콜드스타트당 1회 부트스트랩하고, vercel.json의 rewrite가 모든 경로를 그 함수로 보낸다.
