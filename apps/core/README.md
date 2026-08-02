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

## DB 마이그레이션 (drizzle-kit)

```bash
npm run db:generate --workspace=apps/core   # src/db/schema.ts → drizzle/ SQL 생성
npm run db:push --workspace=apps/core       # 개발 DB에 스키마 반영 (DATABASE_URL 필요)
```

> `0001` 마이그레이션은 threadId를 uuid → **스노우플레이크(text 19자리)** 로 바꾸며 테이블을
> 재생성한다(기존 쓰레드 데이터 삭제 — uuid 값은 19자리 숫자 계약에 안 맞는다). `db:push`도
> 같은 이유로 테이블 truncate/재생성을 확인받는다.

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
3. 환경변수: `DATABASE_URL`, `CORE_SERVICE_TOKEN`, **`NODEJS_HELPERS=0`** (Vercel의 body 헬퍼가
   Express 파서와 이중 파싱하는 문제 방지)
4. Ignored Build Step은 apps/core/vercel.json의 ignoreCommand로 설정됨 — 대시보드 설정 불필요
5. 배포 후 `https://<프로젝트>.vercel.app/healthz` 확인

동작 방식: `npm run build`(nest build → dist/) 후 `api/index.js`가 dist의 Nest 앱을
콜드스타트당 1회 부트스트랩하고, vercel.json의 rewrite가 모든 경로를 그 함수로 보낸다.
