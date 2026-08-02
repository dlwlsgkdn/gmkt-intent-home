# ddak-bff

DDAK BFF — threads API(SSE) + Claude 오케스트레이션 + core 기록.
설계 배경은 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §4 참고.

## 플로우

```
POST /api/threads                → 쓰레드 생성 (+탐색 스텝) → { threadId }
POST /api/threads/:id/survey     → SSE: status → result { page: 설문 }   (LLM #1, effort medium)
POST /api/threads/:id/plan       → SSE: status → result { page: 계획 }   (LLM #2, effort high, 카탈로그 그라운딩)
POST /api/threads/:id/events     → 담기/완료 기록 (complete면 status=done)
GET  /api/threads/:id            → 이어보기 (survey/answers/plan 복원)
GET  /api/threads                → 쓰레드 목록 (x-device-id 기준)
GET  /healthz                     → 상태 (llm: configured|not_configured)
```

- 사용자 식별: `x-device-id` 헤더 (익명 디바이스 id, 없으면 anonymous)
- **실패 안내 정책**: LLM 실패(키 미설정·호출 실패·거절) 시 가짜 맞춤 콘텐츠로 대체하지 않고
  SSE `error` 이벤트(`{ code, message, retryable }`)로 정직하게 알린다 — 코드는
  `llm_not_configured` / `llm_refused` / `llm_failed` / `internal` (API.md 참고).
  캐시 재서빙·스튜디오 시나리오 폴백 등 강등 사다리는 인프라 마련 후 백로그
- 상품 그라운딩: v0 데모 카탈로그(src/llm/catalog.ts) — 응답의 상품 id를 카탈로그와 대조,
  밖의 id는 드롭. 실서비스 전환 시 상품 검색 API가 이 자리를 대체
- 프롬프트: 시스템(역할·규칙·카탈로그)은 안정 prefix로 1h 프롬프트 캐싱, 가변부(의도·프로필·답변)는
  사용자 메시지. 구조화 출력(zodOutputFormat)이라 JSON 파싱 실패가 없다

## 로컬 실행

```bash
npm install                            # 리포 루트에서
cp apps/bff/.env.example apps/bff/.env # CORE_URL 등 채우기 (로컬 core: http://localhost:8790)
npm run build --workspace=apps/bff
node --env-file=apps/bff/.env apps/bff/dist/main.js   # http://localhost:8788/healthz
```

SSE 확인: `curl -N -X POST localhost:8788/api/threads/<id>/survey -H 'content-type: application/json' -d '{}'`

## Vercel 배포 (신규 프로젝트)

1. 같은 GitHub 리포로 새 프로젝트 (예: `ddak-bff`)
2. **Root Directory: `apps/bff`** (대시보드), Framework: Other
3. 환경변수: `ANTHROPIC_API_KEY`(없으면 생성 요청이 실패 안내), `CORE_URL=https://ddak-core.vercel.app`,
   `CORE_SERVICE_TOKEN`(core와 동일 값), `BFF_SERVICE_TOKEN`(스튜디오 프록시 인증 — 아래 참고),
   `NODEJS_HELPERS=0`, (선택) `ALLOWED_ORIGINS`
4. Ignored Build Step은 vercel.json의 ignoreCommand로 커밋돼 있음 — 대시보드 불필요

## 스튜디오 프록시 (FE 진입 경로)

FE는 bff URL을 직접 부르지 않고 스튜디오 same-origin 경로 `/api/bff/*` 를 쓴다. 리포 루트
`middleware.js`(스튜디오 프로젝트의 Vercel Edge Middleware)가 그 경로를 이 서비스의 `/api/*` 로
rewrite 하면서 `Authorization: Bearer <BFF_SERVICE_TOKEN>` 을 주입한다 — 미들웨어는 라우팅 결정만
내리고 끝나므로 SSE 동안 함수가 이중으로 뜨지 않는다. 이를 위해 **스튜디오 Vercel 프로젝트**에
`BFF_URL`(이 배포 주소)과 `BFF_SERVICE_TOKEN`(위 3번과 동일 값)을 설정한다.
토큰을 설정하면 threads API 직접 호출은 401이 된다(로컬 개발은 토큰 없이 개방 — Vite 프록시 경유).
