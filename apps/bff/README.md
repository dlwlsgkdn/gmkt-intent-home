# ddak-bff

DDAK BFF — journeys API(SSE) + Claude 오케스트레이션 + core 기록.
설계 배경은 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §4 참고.

## 플로우

```
POST /api/journeys                → 쓰레드 생성 (+탐색 스텝) → { threadId }
POST /api/journeys/:id/survey     → SSE: status → result { page: 설문 }   (LLM #1, effort medium)
POST /api/journeys/:id/plan       → SSE: status → result { page: 계획 }   (LLM #2, effort high, 카탈로그 그라운딩)
POST /api/journeys/:id/events     → 담기/완료 기록 (complete면 status=done)
GET  /api/journeys/:id            → 이어보기 (survey/answers/plan 복원)
GET  /api/journeys                → 쓰레드 목록 (x-device-id 기준)
GET  /healthz                     → 상태 (llm: configured|fallback-only)
```

- 사용자 식별: `x-device-id` 헤더 (익명 디바이스 id, 없으면 anonymous)
- **ANTHROPIC_API_KEY가 없으면 폴백 템플릿으로 동작한다** — 플로우·기록·SSE는 그대로,
  콘텐츠만 고정. llm_meta.fallback=true로 구분 기록됨
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

SSE 확인: `curl -N -X POST localhost:8788/api/journeys/<id>/survey -H 'content-type: application/json' -d '{}'`

## Vercel 배포 (신규 프로젝트)

1. 같은 GitHub 리포로 새 프로젝트 (예: `ddak-bff`)
2. **Root Directory: `apps/bff`** (대시보드), Framework: Other
3. 환경변수: `ANTHROPIC_API_KEY`(없으면 폴백만), `CORE_URL=https://ddak-core.vercel.app`,
   `CORE_SERVICE_TOKEN`(core와 동일 값), `NODEJS_HELPERS=0`, (선택) `ALLOWED_ORIGINS`
4. Ignored Build Step은 vercel.json의 ignoreCommand로 커밋돼 있음 — 대시보드 불필요
