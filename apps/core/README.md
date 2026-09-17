# ddak-core

DDAK backend core — 쓰레드 저장·조회. NestJS + Drizzle + Neon Postgres.
계약(요청/응답 zod 스키마)은 `@ddak/schema`(packages/schema)가 단일 출처다.
설계 배경은 저장소 루트의 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §3 참고.

## 로컬 실행

```bash
# 리포 루트에서 (워크스페이스 설치 — @ddak/schema는 install 시 prepare로 빌드됨)
npm install

# .env 준비
cp apps/core/.env.example apps/core/.env   # DATABASE_URL·CORE_SERVICE_TOKEN 채우기

# 실행
npm run start:dev --workspace=apps/core    # http://localhost:8790/healthz
```

DATABASE_URL 없이도 부팅된다 — DB를 쓰는 라우트만 503을 준다(스모크 테스트 용도).

## DB 마이그레이션 (drizzle)

```bash
npm run db:generate --workspace=apps/core   # src/db/schema.ts → drizzle/ SQL 생성
npm run db:migrate --workspace=apps/core    # drizzle/ SQL을 저널 순서대로 적용 (권장 반영 경로)
npm run db:push --workspace=apps/core       # (개발 편의) diff 직접 반영 — 대화형 확인
```

**반영은 `db:migrate`가 기본 경로다.** push는 diff를 즉석 ALTER로 만들기 때문에 타입 전환처럼
캐스트가 없는 변경(실사례: 0001의 uuid→text)에서 실패한다 — migrate는 커밋된 SQL을 그대로
실행하므로 이런 변경도 파일에 적힌 대로 재현된다. 적용 이력은 `drizzle.__drizzle_migrations`에
남고, `-- --status`로 조회한다.

push 등으로 이미 최신 스키마가 된 DB는 최초 1회 baseline으로 이력만 채운다 (SQL 실행 없음):

```bash
npm run db:migrate --workspace=apps/core -- --baseline
```

> `0001` 마이그레이션은 threadId를 uuid → **스노우플레이크(text 19자리)** 로 바꾸며 테이블을
> 재생성한다(기존 쓰레드 데이터 삭제 — uuid 값은 19자리 숫자 계약에 안 맞는다).

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
| GET | `/internal/catalog/products/verify-list?mall=&limit=` · `/internal/catalog/stats` | 점검 대상(오래 안 본 순) · 현황 |
| GET | `/healthz` | 헬스체크 (가드 밖) |

## 내재화 카탈로그 (2026-09-17)

`catalog_products`·`catalog_contents` — 추천 상품·참고 콘텐츠의 내부 표. 계획 생성(BFF 5b·5c)이 의도·답변 검색어로 여기서 후보를 받아
**내부 절반 + 웹 검색 절반**으로 고른다(계약 `@ddak/schema` catalog.ts, 배선 `apps/bff/src/catalog/catalog.service.ts`). core 는 저장·검색만:
검색은 `search_text`(이름·브랜드·태그·카테고리 정규화 연결)에 검색어가 부분 일치하는 개수 — 제품 유형 낱말은 2점 — 로 점수를 매기고
`pg_trgm` GIN 인덱스가 ILIKE 를 받는다(마이그레이션 0005 가 `CREATE EXTENSION pg_trgm` — Neon 지원). 수천~수만 행에서 한 자리 ms 대라
LLM 호출 앞에 붙여도 지연이 없고, 의미 검색이 필요해지면 pgvector 컬럼(Neon 지원)을 이 표에 더한다.

```bash
npm run db:migrate --workspace=apps/core      # 0005_catalog_internalize (pg_trgm + 표 2개)
npm run export:catalog --workspace=apps/tagging-api -- --out oy.json   # (사내망) 올리브영 Mongo → 행 JSON
npm run seed:catalog --workspace=apps/core -- --file oy.json           # 그 파일(또는 다른 몰의 같은 형식 JSON) 을 DB 에 직접 upsert — 멱등
```

시딩 재료는 셋이다(2026-09-17): ① 운영 콘솔 「데이터 시딩」 메뉴(`#ops/seeding`, 서비스 품질 그룹)의 「✦ 시딩 잡 시작」 — 제품 유형 42개마다
BFF 가 LLM+web_search 로 실제 판매 상품을 모아 올린다(유형만 약 $5·몇 분. 대량은 조건 칩(피부 타입·고민·가격대·몰)으로 유형×조건까지 펼치거나
`npm run seed:search --workspace=apps/bff -- --bff <BFF 주소> --token <토큰> --facets skin,concern` 배치 스크립트로 — 단위당 약 $0.14, 중단·재개 가능) ② 같은 메뉴의 「쓰레드에서 수확」 — 지난 계획의 검증 통과 상품·콘텐츠
백필(실주행은 7단계 기록이 자동 수확) ③ 위 올리브영 Mongo 내보내기 JSON — 이 스크립트 또는 메뉴의 「JSON 가져오기」. 스튜디오 SRP 스냅샷·데모
카탈로그는 시딩에 쓰지 않는다. 상품 링크 점검(지마켓 썸네일·그 밖 몰 상품 주소 HEAD 로 내려간 리스팅을 dead 표시)도 그 메뉴에 있다.

## Vercel 배포 (신규 프로젝트)

1. Vercel에서 **같은 GitHub 리포**로 새 프로젝트 생성 (예: `ddak-core`)
2. **Root Directory: `apps/core`**, Framework Preset: Other (Build Command는 자동으로 `npm run build`)
3. 환경변수: `DATABASE_URL`, `CORE_SERVICE_TOKEN`, **`NODEJS_HELPERS=0`** (Vercel의 body 헬퍼가
   Express 파서와 이중 파싱하는 문제 방지)
4. Ignored Build Step은 apps/core/vercel.json의 ignoreCommand로 설정됨 — 대시보드 설정 불필요
5. 배포 후 `https://<프로젝트>.vercel.app/healthz` 확인

동작 방식: `npm run build`(nest build → dist/) 후 `api/index.js`가 dist의 Nest 앱을
콜드스타트당 1회 부트스트랩하고, vercel.json의 rewrite가 모든 경로를 그 함수로 보낸다.
