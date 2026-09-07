# 퓨전(OpenShift) 이관 메모

사내 퓨전으로 옮기는 사람이 읽는 문서. 무엇이 서버이고 무엇이 서버리스인지, 각각 무엇이
되어야 하는지, 먼저 막힐 곳이 어디인지를 적는다. 2026-09-07 기준 실측.

## 1. Node 버전 — 20 이상이면 된다

리포 전체 의존성 234개의 `engines.node` 선언을 훑은 결과 **최대 하한은 20**이다.

| 하한 | 패키지 | 언제 |
|---|---|---|
| >= 20 | `@nestjs/core` | 런타임 (bff·core·tagging-api) |
| >= 20 | `@langchain/core` | 런타임 (bff) |
| >= 20.11 | `@nestjs/cli` | 빌드 |

- **16·18은 안 된다** — NestJS 11이 20+를 요구한다.
- **24는 된다** — 24를 배제하는 상한 선언이 하나도 없다(걸리는 것들은 전부 `^18 || >=22`
  같은 열린 범위다). 다만 이 리포는 24에서 돌려본 적이 없으므로, **첫 빌드가 곧 시험**이다.
- 각 워크스페이스 `package.json`에 `engines.node: ">=20"`을 선언해 두었다 — 잘못된 버전에서
  `npm install`이 바로 경고한다.

## 2. 무엇이 서버이고 무엇이 서버리스인가

"서버리스가 많다"는 인상과 달리 실제로는 셋이고, 그중 하나는 이미 죽어 있다.

| 조각 | 실체 | 퓨전에서 |
|---|---|---|
| `apps/bff`, `apps/core`, `apps/tagging-api` | **이미 서버다** (NestJS, `node dist/main.js`) | 그대로 컨테이너. Vercel은 배포처였을 뿐이다 |
| `api/pdp.js` | 지마켓 PDP iframe 프록시 | **이관 대상 아님.** FE가 2026-08에 떼어냈고 옛 배포 호환용 잔재다 |
| `middleware.js` | `/api/bff/*` → BFF로 rewrite + `Authorization: Bearer <BFF_SERVICE_TOKEN>` 주입 | 리버스 프록시 몇 줄. `@vercel/edge` 의존만 걷어내면 된다 |
| `api/state.js` | 워크스페이스 상태를 Neon Postgres에 읽기/쓰기 (`@neondatabase/serverless`) | **여기가 진짜 일이다** — 아래 참고 |

`api/state.js`의 쟁점은 Node가 아니라 **DB 위치**다. Neon은 외부 클라우드인데 사내 Pod에서
거기로 나갈 수 있는지 먼저 확인해야 한다. 못 나가면 워크스페이스 저장소를 사내 것으로 바꿔야
하고, 그게 일정의 진짜 변수다.

## 3. 스튜디오는 런타임에 Node가 필요 없다

`npm run build --workspace=apps/studio`의 산출물(`apps/studio/dist`)은 정적 파일이다. 어떤
웹서버로도 서빙된다. Node가 필요한 것은 위 서버 셋뿐이다.

`apps/tagging-api`는 `STUDIO_DIST` 환경변수가 있으면 그 경로를 정적 서빙한다. 화면과 API가
같은 오리진이 되어 mixed content·CORS·Private Network Access 문제가 전부 사라진다.

## 4. 먼저 막힐 곳 — 배포 전에 확인할 것

1. **Pod에서 사내 Mongo(27017)에 닿는가.** 같은 사내망이라도 존 간 방화벽이 있다.
   형제 프로젝트(`md-calculator`)는 퓨전에 올렸다가 Pod에서 사내 API 호출이 FortiGuard
   URL 필터에 막혀 결국 윈도우 PC로 되돌아갔다. 그쪽 교훈: **d3(dev) 대신 i3/i4(내부망) 존에
   배포하면 방화벽을 안 탈 수 있다 — 방화벽 티켓보다 빠를 수 있으니 먼저 물어볼 것.**
   Mongo는 HTTP가 아니라 TCP라 URL 필터와는 층이 다르므로, 자동으로 막힌다고 볼 이유는 없다.
2. **Pod에서 Neon(외부 인터넷)에 나갈 수 있는가.** `api/state.js`의 운명이 여기 달렸다.
3. **저장소 clone 권한.** 퓨전이 개인 네임스페이스 repo는 clone하지 못한다
   (`md-calculator`가 겪음). 지금 정본은 사내 `org-labs/eevee-labatory`라 해당 없다.

## 5. tagging-api 배포 시 반드시 넘길 환경변수

| 변수 | 값 | 빠뜨리면 |
|---|---|---|
| `HOST` | **`0.0.0.0`** | **기본값이 `127.0.0.1`이라 Route 뒤에서 아무도 못 닿는다.** 원인이 잘 안 보이는 실패다 |
| `MONGO_URI` | 사내 Mongo 접속 문자열 | 상품 라우트가 503 |
| `MONGO_DB` | 기본값이 실제 DB 이름이라 생략해도 동작 | — |
| `TAXONOMY_CACHE_PATH` | 쓰기 가능한 경로(기본 `os.tmpdir()`) | 폴백 캐시가 안 쌓인다 |
| `TAXONOMY_PATH` | (선택) 레거시 파일 폴백. 컨테이너엔 그 파일이 없으므로 보통 생략 | — |
| `STUDIO_DIST` | 스튜디오 빌드 경로. 화면까지 같이 서빙할 때만 | 화면은 안 뜨고 API만 뜬다 |
| `PORT` | 기본 8790 | — |

헬스체크로 쓸 경로: `GET /api/tagging/summary` (Mongo까지 닿아야 200이므로 진짜 준비 상태를
반영한다).

## 6. 이 서비스가 인증이 없다는 점

`apps/tagging-api`에는 인증 게이트가 없다. Route로 노출되는 순간 **사내 누구나 상품 카탈로그의
검토 결과를 되쓸 수 있다.** 퓨전의 AD/LDAP은 콘솔 인증이지 앱 인증이 아니다. 그래서 기본
바인딩을 루프백으로 좁혀 두었다(위 `HOST` 항목). 노출하려면 앞단에 OAuth 프록시를 두거나
쓰기 엔드포인트에 토큰 게이트를 거는 결정을 **배포 전에** 내려야 한다.

같은 Mongo를 보는 Flask 대시보드도 인증이 없으므로 "사내 관례상 괜찮다"가 답일 수 있다.
다만 명시적으로 내린 결정이어야 한다.
