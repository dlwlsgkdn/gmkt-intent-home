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
| GET | `/healthz` | 헬스체크 (가드 밖) |

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
