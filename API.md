# DDAK API 엔드포인트 레퍼런스

> 컴포넌트별 엔드포인트 설계 정리. 계약(요청·응답 스키마)의 단일 출처는 `packages/schema`(zod)이며,
> 검증기·OpenAPI 문서·타입이 전부 거기서 나온다. 설계 배경은 [DESIGN-LLM-SERVICE.md](DESIGN-LLM-SERVICE.md).

```
FE ──(공개, x-device-id)──▶ BFF(ddak-bff) ──(Bearer 서비스 토큰)──▶ Core(ddak-core) ──▶ Neon(전용 DB)
                                 │
                                 └──▶ Claude API (claude-opus-5, 구조화 출력)
```

## 1. BFF — journeys API (FE 대상, 공개)

Base: `https://ddak-bff.vercel.app` · 사용자 식별: **`x-device-id` 헤더**(익명 디바이스 id, 없으면 `anonymous`) · 별도 인증 없음(v1)

| 메서드 | 경로 | 역할 | 요청 본문 | 응답 |
|---|---|---|---|---|
| POST | `/api/journeys` | 저니 시작 — 쓰레드 생성 + 탐색 스텝 기록 | `StartJourneyBody` `{ chipId?\|query, title?, profile? }` | `{ threadId }` |
| POST | `/api/journeys/:id/survey` | **설문 페이지 생성 (LLM #1**, effort medium**)** | `{ profile? }` | **SSE** → `result.page: SurveyPageWire` |
| POST | `/api/journeys/:id/plan` | **응답 제출 → 계획 생성 (LLM #2**, effort high, 카탈로그 그라운딩**)** | `{ answers: [{questionId, choices[]}], profile? }` | **SSE** → `result.page: PlanPageWire` |
| POST | `/api/journeys/:id/events` | 담기/완료 행동 기록 (`complete`면 status=done) | `{ type, data? }` | `{ ok: true }` |
| GET | `/api/journeys/:id` | 이어보기 — 단계별 페이지 복원 | — | `{ threadId, title, status, source, survey, answers, plan, updatedAt }` |
| GET | `/api/journeys?cursor=&limit=` | 쓰레드 목록 (히스토리 패널) | — | `ThreadListPage` |
| GET | `/healthz` | 상태 — `llm: configured\|fallback-only`, `core` | — | 상태 JSON |

**SSE 프레임** (`Content-Type: text/event-stream`):

```
event: status   → { message: "질문을 구성하고 있어요…" }   (생성 중 진행 표시)
event: result   → { page: SurveyPageWire | PlanPageWire }  (완성 페이지 — 종료)
event: error    → { message }                              (실패 — 종료)
```

**와이어 페이지 형태** (스튜디오 레지스트리 투영 기준: question→`surveyQuestion`, guide→`planStep`, products→`productCard`, steps→`checklist`):

```ts
SurveyPageWire = { intro, questions: [{ id, question, options[2..6], multi }] }
PlanPageWire   = { headline, summary, sections: [
                   { kind: 'guide',    title, body } |
                   { kind: 'products', title, reason, products: CatalogProduct[] } |  // 카탈로그 검증 통과분만
                   { kind: 'steps',    title, steps[] } ] }
```

## 2. Core — internal API (BFF 전용, 비공개)

Base: `https://ddak-core.vercel.app` · 인증: **`Authorization: Bearer <CORE_SERVICE_TOKEN>`** (healthz·docs 제외)
· **Swagger UI: [`/docs`](https://ddak-core.vercel.app/docs)** · OpenAPI JSON: `/docs-json`

| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/internal/threads` | 쓰레드 생성 (`CreateThreadBody`) |
| PATCH | `/internal/threads/:id` | title/status 갱신 (`UpdateThreadBody`) |
| PUT | `/internal/threads/:id/steps/:seq` | **스텝 멱등 upsert** (`UpsertStepBody`) — (thread_id, seq)가 멱등 키 |
| GET | `/internal/threads/:id` | 쓰레드 + 스텝 전체 (`ThreadWithSteps`) |
| GET | `/internal/users/:uid/threads?cursor=&limit=` | 사용자 쓰레드 목록 (updatedAt 키셋 커서) |
| GET | `/healthz` | 헬스체크 (가드 밖) |

**스텝 seq 규약** (BFF가 부여 — 저니 1회의 이벤트 소싱 로그):

| seq | stage | payload | 기록 시점 |
|---|---|---|---|
| 1 | `explore` | `{ source, profile }` | 저니 시작 |
| 2 | `survey` | `{ page }` + `llmMeta` | 설문 생성 후 |
| 3 | `answers` | `{ answers, profile }` | 계획 요청 시 |
| 4 | `plan` | `{ page }` + `llmMeta` | 계획 생성 후 |
| 5+ | `action` | `{ type, data, at }` | 담기/완료 등 행동마다 |

`llmMeta` = `{ model, promptVersion, usage{inputTokens,outputTokens,cacheReadTokens}, latencyMs, fallback? }` — 비용·품질 대시보드의 원천.

## 3. Studio 동기화 API (기존 — 위 체계와 별개)

`ddak-scenario-studio` 프로젝트의 `api/state.js` — 스튜디오 목업 도구의 localStorage 미러링 전용
(`?boot=`/`?index=` 등, CLAUDE.md "서버 동기화" 절 참고). journeys/core와 데이터·인증 체계를 공유하지 않는다.

## 배포·환경변수 요약

| 프로젝트 | Root Directory | 주요 env |
|---|---|---|
| ddak-bff | `apps/bff` | `ANTHROPIC_API_KEY`(없으면 폴백 모드), `CORE_URL`, `CORE_SERVICE_TOKEN`, `NODEJS_HELPERS=0`, `ALLOWED_ORIGINS?` |
| ddak-core | `apps/core` | `DATABASE_URL`(Neon 통합 자동 주입), `CORE_SERVICE_TOKEN`, `NODEJS_HELPERS=0`, `API_DOCS?` |
