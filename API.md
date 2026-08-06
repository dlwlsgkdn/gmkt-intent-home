# DDAK API 엔드포인트 레퍼런스

> 컴포넌트별 엔드포인트 설계 정리. 계약(요청·응답 스키마)의 단일 출처는 `packages/schema`(zod)이며,
> 검증기·OpenAPI 문서·타입이 전부 거기서 나온다. 설계 배경은 [DESIGN-LLM-SERVICE.md](DESIGN-LLM-SERVICE.md).

```
FE ──(공개, x-device-id)──▶ BFF(ddak-bff) ──(Bearer 서비스 토큰)──▶ Core(ddak-core) ──▶ Neon(전용 DB)
                                 │
                                 └──▶ Claude API (claude-opus-5, 구조화 출력)
```

## 0. 용어 정리

**코드·API·데이터의 공식 용어는 `thread` 하나다** (2026-08 통일). 쓰레드는 사용자의 쇼핑 과정
1회이자 그 영속 기록이다 — 진행 중이든 끝났든 같은 `threadId`로 가리킨다. FE·BFF의 threads API는
과정(시작·생성·제출·이어보기)을, core의 internal API는 기록(저장·조회)을 다루지만 **둘 다 같은
쓰레드**다. "저니(journey)"는 UX를 서술하는 산문 용어로만 쓰고, 코드·경로·타입 이름에는 쓰지 않는다.
(계보: 스튜디오의 "쇼핑 쓰레드 히스토리" — 체험 1회 = 쓰레드 1개)

| 용어 | 뜻 |
|---|---|
| **쓰레드(thread)** | 쇼핑 과정 1회(탐색→설문→계획→행동)와 그 영속 기록. 이어보기·히스토리의 원천 |
| **스텝(step)/스테이지(stage)** | 쓰레드에 쌓이는 사건 단위 — seq 규약(§2)이 진행을 이벤트 소싱 로그로 만든다 |
| **페이지(page)** | 한 단계의 화면 콘텐츠(`SurveyPageWire`·`PlanPageWire`) — 스텝 payload에 저장 |
| **의도(intent)** | 쓰레드를 시작시킨 것 — 칩 또는 검색어. `source`로 기록 |
| **llmMeta** | 생성 스텝(2·4)에 붙는 LLM 호출 메타 — 모델·프롬프트 버전·토큰·지연 |

## 1. BFF — threads API (FE 대상, 공개)

Base: `https://ddak-bff.vercel.app` · 사용자 식별: **`x-device-id` 헤더**(익명 디바이스 id, 없으면 `anonymous`) · 별도 인증 없음(v1)

`threadId`는 쓰레드 시작 시 **core가 발급하는 스노우플레이크 id**(64비트: 41b 타임스탬프|10b 워커|12b 시퀀스)다.
에포크(2010-01-01) 덕에 **항상 19자리 십진 문자열**(예: `"2195943212345678901"`)이라 문자열 사전순 정렬 =
생성 시각순이며, 분산 유니크가 보장된다. 저장·와이어 모두 문자열로 다룬다.

| 메서드 | 경로 | 역할 | 요청 본문 | 응답 |
|---|---|---|---|---|
| POST | `/api/threads` | 쓰레드 시작 — 생성 + 탐색 스텝 기록 | `StartThreadBody` `{ chipId?\|query, title?, profile? }` | `{ threadId }` |
| POST | `/api/threads/:id/survey` | **설문 페이지 생성 (LLM #1**, effort medium**)** | `{ profile? }` | **SSE** → `result.page: SurveyPageWire` |
| POST | `/api/threads/:id/plan` | **응답 제출 → 계획 생성 (LLM #2 — 2단계 병렬**: 뼈대(검색 없음·medium, 수 초 스트리밍 — 단계 안내 2~3개) ∥ 검색(상품+참고 콘텐츠, 카탈로그+웹 검색 그라운딩·high) — 뼈대가 끝나면 `skeleton` 이벤트로 **조기 확정**되고 검색 섹션이 자리 인덱스로 비동기로 끼어든다, DESIGN §9-1**)**. `feedback`(stage=plan)이 있으면 **피드백 반영 재생성** — 직전 계획(plan 스텝)+피드백을 프롬프트 가변부에 실어 지적된 상품을 웹 검색 대안으로 교체 | `{ answers: [{questionId, choices[]}], profile?, feedback? }` | **SSE** → `result.page: PlanPageWire` |
| POST | `/api/threads/:id/events` | 담기/완료 행동 + **피드백 제출**(`type=feedback`, data=`ThreadStageFeedback`) 기록 (`complete`면 status=done) | `{ type, data? }` | `{ ok: true }` |
| GET | `/api/threads/:id` | 이어보기 — 단계별 페이지 + 최신 피드백 복원 | — | `{ threadId, title, status, source, survey, answers, plan, feedback, updatedAt }` |
| GET | `/api/threads?cursor=&limit=` | 쓰레드 목록 (히스토리 패널) | — | `ThreadListPage` |
| GET | `/healthz` | 상태 — `llm: configured\|not_configured`, `core` | — | 상태 JSON |

**SSE 프레임** (`Content-Type: text/event-stream`) — 토큰 단위 부분 스트리밍:

```
event: status   → { message: "질문을 구성하고 있어요…" }         (진행 표시 — 웹 검색 중엔 검색어 문구)
event: head     → { intro } | { headline } | { summary }         (머리 필드 — 자라는 값 반복 발송 + 완성본)
event: question → { index, question: SurveyQuestionWire }        (설문 — 자라는 질문을 같은 index로 반복 발송)
event: skeleton → { page, pending: number[] }                    (계획 — 뼈대 조기 확정: page.sections의 상품·콘텐츠 자리는 null, pending이 그 인덱스)
event: section  → { index, section: PlanSectionWire }            (계획 — 자라는 섹션을 같은 index로 반복 발송)
event: result   → { page: SurveyPageWire | PlanPageWire }        (완성 페이지 — 권위·저장 기준, 종료)
event: error    → { code, message, retryable }                   (실패 안내 — 종료)
```

부분 이벤트(head/question/section)는 **미리보기**다: 컴포넌트 안 텍스트가 토큰 단위로 자라며
같은 키/index로 반복 전송되고(FE는 슬롯 덮어쓰기 — 스로틀 ~120ms), 원소가 완성되면 검증·그라운딩을
통과한 최종본이 같은 index로 한 번 더 나간다(검증 실패로 드롭된 원소는 index가 건너뛴다 — 상품·콘텐츠
섹션은 부분 전송 없이 완성·그라운딩 통과분만). **`skeleton`은 계획 전용 조기 확정**이다: 뼈대(텍스트)가
끝나는 즉시 완성 텍스트 섹션 + 자리(null·pending 인덱스)를 보내고, FE는 이 시점에 계획을 확정
렌더하며 자리에 로딩 카드를 둔다 — 이후 `section` 이벤트(웹 검색 완료분)가 자리를 비동기로 채우고,
검색 단계가 못 채운 자리는 `result`에서 빠진다(이때만 뒤 섹션 인덱스가 당겨진다). 확정·저장은 언제나
`result`의 전체 페이지다. 모르는 이벤트는 무시해도 안전하다 — 구버전 FE ↔ 신버전 BFF 조합에서도
스켈레톤→result 동작으로 자연 강등된다.

**실패 안내 정책**: LLM 실패 시 가짜 맞춤 콘텐츠(템플릿)로 대체하지 않고 `error` 이벤트로 정직하게
알린다. FE는 `retryable`이면 "다시 시도"를, 아니면 안내 문구를 보여준다. (캐시 재서빙·칩→스튜디오
시나리오 폴백 등 강등 사다리는 인프라 마련 후 백로그)

| error code | 뜻 | retryable |
|---|---|---|
| `llm_not_configured` | ANTHROPIC_API_KEY 미설정 | ✕ |
| `llm_refused` | 안전 분류기 거절 (`stop_reason: refusal`) | ✕ (다른 검색어 유도) |
| `llm_failed` | 호출 실패·파싱 실패 (SDK 자동 재시도 2회 후) | ○ |
| `internal` | 그 외 서버 오류 (core 연결 등) | ○ |

**와이어 페이지 형태** (스튜디오 레지스트리 투영 기준: question→`surveyQuestion`, guide→`planStep`, products→`productCard`, contents→`videoCard`/`articleCard`, steps→`checklist`):

```ts
SurveyPageWire = { intro, questions: [{ id, question, options[2..6], multi }] }
PlanPageWire   = { headline, summary, sections: [
                   { kind: 'guide',    title, body } |                                 // 단계 안내 — 2~3개(다단계 계획), FE가 단계 번호를 붙인다
                   { kind: 'products', title, reason, products: CatalogProduct[] } |  // 카탈로그 id 검증 + 웹 상품 URL 검증 통과분만
                   { kind: 'contents', title, reason, items: PlanContentItem[] } |    // 참고 콘텐츠 — 웹 검색으로 확인한 게시글·영상 (URL 검증 통과분만)
                   { kind: 'steps',    title, steps[] } ] }
PlanContentItem = { type: 'video'|'article', source, title, url, imageUrl?, meta?, snippet?, duration? }
// meta = 영상은 채널·조회수, 게시글은 작성자·시점. FE 투영: video→videoCard(썸네일 없으면 유튜브
// 자동 썸네일), article→articleCard. 카드 클릭 = 새 탭 열기(openExternal)
CatalogProduct = { id, name, brand, price, tags[], url?, mall?, imageUrl? }
// url·mall = 웹 검색으로 찾은 외부몰 상품 (id는 `web-*`, mall이 있으면 FE가 외부몰 태그·담기불가로 렌더,
// url은 상세보기 사이드 패널이 iframe으로 연다). url은 상품 상세 페이지(PDP)만 — BFF가 검색/목록
// 페이지로 보이는 URL(/search 경로·검색어 쿼리 키)을 드롭한다. 카탈로그(지마켓) 상품은 url(지마켓
// PDP)만 있고 mall이 없다. url 없는 상품은 카탈로그라도 추천에서 제외된다.
// imageUrl = 상품 썸네일 — 카탈로그는 검증된 지마켓 gdimg, 웹 상품은 검색에서 확인된 주소의
// http(s) 검증 통과분만. 없거나 로드 실패면 FE가 이모지 목업 블록으로 렌더한다
```

**피드백(사용자 평가)**: LivePlayer의 "💬 평가"가 스튜디오 평가 스튜디오와 같은 문법(별점 0~5 + 코멘트,
null=미평가·0점 구분)으로 페이지 전체(`review`) + 컴포넌트별(`components[]` — livePage 투영 아이템 id·라벨 동봉)을
받는다. 저장은 `POST /:id/events`에 `type=feedback`, `data=ThreadStageFeedback`(stage `survey|plan`) — **제출 1회 =
action 스텝 1개(append)** 라 수정 이력이 로그로 남고, 이어보기(`GET /:id`)의 `feedback.{survey,plan}`과 관리
페이지 문서화는 단계별 **최신 제출**을 유효본으로 본다. 계약은 `packages/schema` `ThreadStageFeedback`.
계획 피드백은 소비처가 하나 더 있다: 레일의 "✦ 반영해 다시 생성"이 미전송분을 저장한 뒤 같은 피드백을
`POST /:id/plan`의 `feedback`으로 실어 **반영 재생성**을 요청한다 (프롬프트는 시스템 고정·가변부에만 실려
캐시 유지, prompts.ts `PlanRevisionContext`).

## 1-1. BFF — admin API (스튜디오 #admin 전용)

Base: `/api/admin/*` (스튜디오 프록시 `/api/bff/admin/*` 경유) · 인증: **서비스 토큰 + `x-admin-token: <ADMIN_TOKEN>`** 이중 가드
(ADMIN_TOKEN 미설정 시 프로덕션은 전부 401 — fail closed). 진입점은 스튜디오 `#admin` 해시뿐 — 유저 UI에 링크가 없다.

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/admin/threads?cursor=&limit=` | 전체 쓰레드 목록 — archived 포함, id(스노우플레이크) 키셋 커서·생성 최신순 |
| GET | `/api/admin/threads/:id` | 쓰레드 상세 — core `ThreadWithSteps` 원본(라이프사이클 로그, llmMeta·action 포함) |
| POST | `/api/admin/threads/:id/archive` | **보관 처리** — `status=archived`. 데이터 보존, 사용자 목록(`GET /api/threads`)에서만 숨김 |
| GET | `/api/admin/feedback` | **평가 모아보기** — 피드백 제출 전체(`AdminFeedbackWire`), 제출 1회 = 항목 1개·최신순. core 피드백 스텝을 BFF가 파싱해 같은 (쓰레드, 단계)의 최신 제출에 `latest=true`. 페이지네이션 없음(core 상한 300건 + `truncated`) — 집계는 FE가 latest 항목만으로 |
| GET | `/api/admin/model` | LLM 모델 설정 — `{ current, defaultModel, configured, options[] }` (카탈로그는 BFF `llm.service` 소유) |
| PUT | `/api/admin/model` | 모델 변경 — `{ model }` (카탈로그 밖 400, `null`이면 기본값 복귀). core `settings.llm-model`에 저장, 새 생성부터 반영(인스턴스 캐시 ≤30s) |

## 2. Core — internal API (BFF 전용, 비공개)

Base: `https://ddak-core.vercel.app` · 인증: **`Authorization: Bearer <CORE_SERVICE_TOKEN>`** (healthz·docs 제외)
· **Swagger UI: [`/docs`](https://ddak-core.vercel.app/docs)** · OpenAPI JSON: `/docs-json`

| 메서드 | 경로 | 역할 |
|---|---|---|
| POST | `/internal/threads` | 쓰레드 생성 (`CreateThreadBody`) — **threadId(스노우플레이크) 발급** |
| PATCH | `/internal/threads/:id` | title/status 갱신 (`UpdateThreadBody`) — admin 보관은 `status=archived`로 이 경로를 쓴다 |
| PUT | `/internal/threads/:id/steps/:seq` | **스텝 멱등 upsert** (`UpsertStepBody`) — (thread_id, seq)가 멱등 키 |
| GET | `/internal/threads/:id` | 쓰레드 + 스텝 전체 (`ThreadWithSteps`) |
| GET | `/internal/threads?cursor=&limit=` | 전체 목록 (관리용) — archived 포함, id 키셋 커서 |
| GET | `/internal/users/:uid/threads?cursor=&limit=` | 사용자 쓰레드 목록 (updatedAt 키셋 커서) — **archived 제외** |
| GET | `/internal/feedback-steps?limit=` | 피드백 스텝 나열 (`FeedbackStepsWire`) — action 스텝 중 `payload.type='feedback'`만 쓰레드 메타와 함께 최신순. core는 payload를 해석하지 않는다(jsonb 최상위 type 필터만) — 파싱·집계는 BFF admin 몫 |
| GET | `/internal/settings/:key` · PUT · DELETE | 운영 설정 KV (jsonb — core는 해석 안 함). 예: `llm-model` |
| GET | `/healthz` | 헬스체크 (가드 밖) |

**스텝 seq 규약** (BFF가 부여 — 쓰레드 1개의 이벤트 소싱 로그):

| seq | stage | payload | 기록 시점 |
|---|---|---|---|
| 1 | `explore` | `{ source, profile }` | 쓰레드 시작 |
| 2 | `survey` | `{ page }` + `llmMeta` | 설문 생성 후 |
| 3 | `answers` | `{ answers, profile }` | 계획 요청 시 |
| 4 | `plan` | `{ page }` + `llmMeta` | 계획 생성 후 |
| 5+ | `action` | `{ type, data, at }` | 담기/완료 등 행동마다 |

`llmMeta` = `{ model, promptVersion, usage{inputTokens,outputTokens,cacheReadTokens}, latencyMs, fallback? }` — 비용·품질 대시보드의 원천.

## 3. Studio 동기화 API (기존 — 위 체계와 별개)

`ddak-scenario-studio` 프로젝트의 `api/state.js` — 스튜디오 목업 도구의 localStorage 미러링 전용
(`?boot=`/`?index=` 등, CLAUDE.md "서버 동기화" 절 참고). threads API·core와 데이터·인증 체계를 공유하지 않는다.

## 배포·환경변수 요약

| 프로젝트 | Root Directory | 주요 env |
|---|---|---|
| ddak-bff | `apps/bff` | `ANTHROPIC_API_KEY`(없으면 생성 요청이 실패 안내로 응답), `CORE_URL`, `CORE_SERVICE_TOKEN`, **`ADMIN_TOKEN`**(관리 페이지 — 없으면 admin API 전부 401), `NODEJS_HELPERS=0`, `ALLOWED_ORIGINS?` |
| ddak-core | `apps/core` | `DATABASE_URL`(Neon 통합 자동 주입), `CORE_SERVICE_TOKEN`, `NODEJS_HELPERS=0`, `API_DOCS?` |
