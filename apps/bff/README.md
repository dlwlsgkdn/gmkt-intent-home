# ddak-bff

DDAK BFF — threads API(SSE) + Claude 오케스트레이션 + core 기록.
설계 배경은 [DESIGN-LLM-SERVICE.md](../../DESIGN-LLM-SERVICE.md) §4 참고.

## 플로우

```
POST /api/threads                → 쓰레드 생성 (+탐색 스텝) → { threadId }
POST /api/threads/:id/survey     → SSE: status → result { page: 설문 }   (LLM #1, effort medium)
POST /api/threads/:id/plan       → SSE: status → result { page: 계획 }   (LLM #2, effort high, 카탈로그 그라운딩)
POST /api/threads/:id/look-render → 가상 메이크업 정밀 렌더 (이미지 편집 모델, 사용자 명시 요청 시에만)
POST /api/threads/:id/events     → 담기/완료 기록 (complete면 status=done)
GET  /api/threads/:id            → 이어보기 (survey/answers/plan 복원)
GET  /api/threads                → 쓰레드 목록 (x-device-id 기준)
GET  /healthz                     → 상태 (llm: configured|not_configured)
POST /api/admin/prompts/:id/assist → 운영자 자연어 요청으로 미저장 프롬프트 수정안 생성
```

- 사용자 식별: `x-device-id` 헤더 (익명 디바이스 id, 없으면 anonymous)
- **이미지 편집만 다른 프로바이더**: Anthropic API에는 이미지 생성·편집이 없어(입력으로 읽기만 한다)
  정밀 렌더는 OpenAI images.edits를 쓴다 — `OPENAI_API_KEY`(없으면 503 image_not_configured로 정상 강등),
  `OPENAI_BASE_URL`(기본 https://api.openai.com — e2e는 모의 서버로 돌린다), `OPENAI_IMAGE_MODEL`(기본 gpt-image-2).
  계약은 프로바이더 중립(`@ddak/pipeline` ImageEditPort)이라 교체는 image-edit.service 한 파일이다.
  주의: 편집은 최대 2분까지 걸릴 수 있어 서버리스 함수 실행 시간 상한을 확인할 것
- **실패 안내 정책**: LLM 실패(키 미설정·호출 실패·거절) 시 가짜 맞춤 콘텐츠로 대체하지 않고
  SSE `error` 이벤트(`{ code, message, retryable }`)로 정직하게 알린다 — 코드는
  `llm_not_configured` / `llm_refused` / `llm_failed` / `internal` (API.md 참고).
  캐시 재서빙·스튜디오 시나리오 폴백 등 강등 사다리는 인프라 마련 후 백로그
- 상품 그라운딩: v0 데모 카탈로그(src/llm/catalog.ts) — 응답의 상품 id를 카탈로그와 대조,
  밖의 id는 드롭. 실서비스 전환 시 상품 검색 API가 이 자리를 대체
- 프롬프트: 시스템(역할·규칙·카탈로그)은 안정 prefix로 1h 프롬프트 캐싱, 가변부(의도·프로필·답변)는
  사용자 메시지. 구조화 출력(zodOutputFormat)이라 JSON 파싱 실패가 없다
- AI 지시서 도우미도 같은 `ANTHROPIC_API_KEY`를 사용한다. 수정안은 자리표시자 보존 검사를 통과해도
  자동 저장하지 않으며, 운영자가 diff를 승인한 뒤 기존 버전 기록 API로 따로 저장한다

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
   `NODEJS_HELPERS=0`, (선택) `OPENAI_API_KEY`(가상 메이크업 정밀 렌더 — 없으면 그 버튼만 강등되고
   나머지는 정상), (선택) `ALLOWED_ORIGINS`
4. Ignored Build Step은 vercel.json의 ignoreCommand로 커밋돼 있음 — 대시보드 불필요

## 스튜디오 프록시 (FE 진입 경로)

FE는 bff URL을 직접 부르지 않고 스튜디오 same-origin 경로 `/api/bff/*` 를 쓴다. 리포 루트
`middleware.js`(스튜디오 프로젝트의 Vercel Edge Middleware)가 그 경로를 이 서비스의 `/api/*` 로
rewrite 하면서 `Authorization: Bearer <BFF_SERVICE_TOKEN>` 을 주입한다 — 미들웨어는 라우팅 결정만
내리고 끝나므로 SSE 동안 함수가 이중으로 뜨지 않는다. 이를 위해 **스튜디오 Vercel 프로젝트**에
`BFF_URL`(이 배포 주소)과 `BFF_SERVICE_TOKEN`(위 3번과 동일 값)을 설정한다.
토큰을 설정하면 threads API 직접 호출은 401이 된다(로컬 개발은 토큰 없이 개방 — Vite 프록시 경유).

## 전체 요청으로 AI 지시서 수정

AI 지시서의 기본 화면은 전체 수정 요청을 먼저 받는다. 설문 질문·계획 구성·상품 추천은
선택사항이며 여러 개 고를 수 있다. 선택은 강조할 부분이지 수정 허용 목록이 아니다.
`POST /api/admin/prompt-flow/assist`는 세 원문을 한 번의 AI 호출에 보내 필요한 변경과 이유를
돌려준다. 필수 자리표시자는 서버에서 대조하며, 운영 설정에는 아직 저장하지 않는다.
미리보기는 시험 당시 세 지시서를 고정하고 각 버전의 설문 응답으로 최종 추천까지 실행한다.
동일한 질문·선택지만 답을 공유한다. 요청·선택·고객 문장·답변이 바뀌면 이전 적용 자격을 지운다.

수정안에는 좋은 점·아쉬운 점·주의할 점을 짧게 표시한다. 이는 AI가 수정 문구를 보고
예상한 점검이며 실제 결과의 품질 평가와 구분한다. “다시 수정할래요”는 직전 수정안과
추가 요청 이력을 함께 보내 이전 개선을 이어서 고친다. 성공하면 예전 시험과 평가를 비워
새 결과를 확인해야 적용할 수 있고, 실패하면 기존 수정안과 추가 요청을 유지한다.
미리보기는 실제 생성된 두 결과를 대조해 바뀐 질문·선택지·추천 영역에 빨간 표시와
설명을 붙인다. 다음 변경 버튼과 스크롤 위치 표시로 바뀐 곳을 찾아볼 수 있다.

`PUT /api/admin/prompt-flow`는 전체 기준선을 먼저 확인한 뒤 기존 지시서 저장·이력 경로로
변경을 적용한다. 저장소의 개별 KV API를 사용하므로 원자적 트랜잭션은 아니다. 부분 실패를
완료로 표시하지 않으며, 같은 묶음을 재시도하면 이미 적용된 값은 인정하고 나머지를 처리한다.
시험 쓰레드에도 묶음과 기준선을 보존하여 나중에 동일한 검사를 거쳐 적용할 수 있다.
이 기능은 지시서 편집이며 모델 학습이나 실제 파이프라인 실행 순서 변경은 하지 않는다.

검증: `node apps/bff/e2e/langgraph-smoke.mjs`, `node apps/studio/tests/promptFlow.test.mjs` (리포 루트).
