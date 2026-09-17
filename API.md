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
| GET | `/api/threads?cursor=&limit=` | 쓰레드 목록 (히스토리 패널 — 무한스크롤 페이지) | — | `ThreadListPage` = `{ items, nextCursor, total }` — `total`은 이 기기의 전체 쓰레드 수(archived 제외)로 첫 페이지에서 미리 총 개수를 알린다 |
| GET | `/healthz` | 상태 — `llm: configured\|not_configured`, `core` | — | 상태 JSON |

**SSE 프레임** (`Content-Type: text/event-stream`) — 토큰 단위 부분 스트리밍:

```
event: status   → { message: "질문을 구성하고 있어요…" }         (진행 표시 — 웹 검색 중엔 검색어 문구)
event: head     → { intro } | { headline } | { summary }         (머리 필드 — 자라는 값 반복 발송 + 완성본)
event: question → { index, question: SurveyQuestionWire }        (설문 — 자라는 질문을 같은 index로 반복 발송)
event: skeleton → { page, pending: number[] }                    (계획 — 뼈대 조기 확정: page.sections의 상품·콘텐츠 자리는 null, pending이 그 인덱스)
event: section  → { index, section: PlanSectionWire, final }     (계획 — 자라는 섹션을 같은 index로 반복 발송, final:true·생략=최종본)
event: result   → { page: SurveyPageWire | PlanPageWire }        (완성 페이지 — 권위·저장 기준, 종료)
event: error    → { code, message, retryable }                   (실패 안내 — 종료)
```

부분 이벤트(head/question/section)는 **미리보기**다: 컴포넌트 안 텍스트가 토큰 단위로 자라며
같은 키/index로 반복 전송되고(FE는 슬롯 덮어쓰기 — 스로틀 ~120ms), 원소가 완성되면 검증·그라운딩을
통과한 최종본이 같은 index로 한 번 더 나간다(검증 실패로 드롭된 원소는 index가 건너뛴다). 상품·콘텐츠
섹션도 **항목 단위 증분**으로 나간다: 완성·그라운딩 통과한 항목만 실은 섹션이 `final:false`로 같은
index에 반복 전송되고(항목 목록은 언제나 최종본의 접두 — 한 번 나간 카드는 사라지지 않는다), 섹션이
닫히면 `final:true`(생략 시 true — 구버전 BFF 호환)로 마감한다. FE는 최종본까지 그 자리를
pending(재생성 게이트)으로 유지한다. **`skeleton`은 계획 전용 조기 확정**이다: 뼈대(텍스트)가
끝나는 즉시 완성 텍스트 섹션 + 자리(null·pending 인덱스)를 보내고, FE는 이 시점에 계획을 확정
렌더하며 자리에 로딩 카드를 둔다 — 이후 `section` 이벤트가 자리를 비동기로 채우고,
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

**와이어 페이지 형태** (스튜디오 레지스트리 투영 기준: question→`surveyQuestion`(사진 질문은 `surveyPhoto`), guide→`planStep`, look→`beforeAfter`, products→`productCard`, contents→`videoCard`/`articleCard`, steps→`checklist`, compare→`ingredientCompare`(성분 비교표), caution→`cautionIngredients`(주의 성분)):

```ts
SurveyPageWire = { intro, questions: [{ id, question, kind?: 'choice'|'photo', options[0..6], multi, placeholder? }] }
// options 원소는 "제목|부제" 문자열 (FE 옵션 문법과 동일 — @ddak/pipeline optionWire). 설문 프롬프트가 선택지마다 제목(짧은 명사구)+부제(판단
// 기준 한 줄)를 만들고, 답변(choices)에는 제목만 실린다. 옛 페이지의 부제 없는 문자열도 그대로 유효
// kind 생략 = choice (구 응답 호환). kind='photo'는 선택지가 없는 얼굴 사진 질문 — id는 p1. 사진을 받는 설문은
// 스캐폴드 고정 스타일링 범위 질문(id s1, choice: 메이크업만|메이크업 + 헤어|메이크업 + 헤어 + 옷차림)이 p1 앞에 선다(v24). **사진 원본은 서버로 오지 않는다**: 기기에 남고 답변에는 표식('사진 제출됨')만 실린다
// (데이터 URL을 스텝·프롬프트에 싣지 않기 위해서 — 계획 프롬프트는 "사진을 올렸다"만 안다)
PlanPageWire   = { headline, summary, sections: [
                   { kind: 'guide',    title, subtitle?, body } |                      // 단계 안내 — 2~3개(다단계 계획), FE가 단계 번호를 붙인다. subtitle = 단계 목적 한 줄(v17부터 필수 생성, 옛 페이지 없음)
                   { kind: 'look',     title, desc, tone, points?[0..6], spec? } |     // 가상 메이크업 결과 — 사진 질문에 답한 쓰레드에서만. tone = coral|rose|red|peach|brown|plum
                                                                                       // spec(v23) = { intensity: natural|glam, lip{color #rrggbb, finish matte|velvet|glossy|tint, technique full|gradient|overlined, note},
                                                                                       //   cheek{color, placement apples|cheekbones|drape, strength light|medium|strong, note}, eye{shadow[0..3], liner none|thin|winged, lashes natural|volume, brow natural|defined, note},
                                                                                       //   base{finish matte|semi-matte|dewy, coverage light|medium|full, contour, highlight, note}, scope? makeup|hair|outfit(v24 — s1 답),
                                                                                       //   hair?{style keep|straight|wavy|curly|updo|ponytail, length keep|short|medium|long, color hex|keep, bangs keep|none|see-through|full, note}(scope≥hair),
                                                                                       //   outfit?{top keep|tee|shirt|blouse|knit|jacket|dress, color hex|keep, fit regular|oversized|fitted, neckline keep|crew|v|collar|off-shoulder, note}(scope=outfit) } — 기기 합성과 정밀 렌더가 그대로 소비하는 한 원천.
                                                                                       //   points 는 BFF 가 부위별 note 에서 파생("립 — …"). FE가 기기에 남은 사진을 BEFORE, 같은 사진에 사양대로 칠한 것을 AFTER로 비포/애프터 투영 (합성은 화면에서)
                   { kind: 'compare',  title, alt: CompareSide, pick: CompareSide, rows: [{ ingredient, alt, pick, risk? }] } |  // 성분 비교표(v26) — 뼈대(5a)가 성분이 기준인 의도(면도 자극·민감·"성분 비교해 줘")에서만.
                                                                                       //   **제품 유형 수준** 대조: alt = 기존/일반 제품 유형(답변의 사용 중 제품이 있으면 그것), pick = 이 계획이 권하는 제품 유형. CompareSide = { badge, name, short? }.
                                                                                       //   행 = 성분 · 기존 열 값(있음/없음/소량) · 추천 열 값 · 위험도(높음/중간/낮음). 구체 상품명·전성분 단정 없음 — 그 기준으로 고른 상품은 바로 뒤 products 가 채운다
                   { kind: 'caution',  title, desc?, items: [{ name, note }] } |       // 주의 성분(v26) — compare 와 같은 조건에서 뼈대가 만든다. 이름(한글 + INCI) · 왜 주의하는지 한 줄
                   { kind: 'products', title, reason, products: CatalogProduct[] } |  // 카탈로그 id 검증 + 웹 상품 URL 검증 통과분만
                   { kind: 'contents', title, reason, items: PlanContentItem[] } |    // 참고 콘텐츠 — 웹 검색으로 확인한 게시글·영상 (URL 검증 통과분만)
                   { kind: 'steps',    title, steps[] } ] }
PlanContentItem = { type: 'video'|'article', source, title, url, imageUrl?, meta?, snippet?, duration? }
// meta = 영상은 채널·조회수, 게시글은 작성자·시점. FE 투영: video→videoCard(썸네일 없으면 유튜브
// 자동 썸네일), article→articleCard. 카드 클릭 = 새 탭 열기(openExternal)
CatalogProduct = { id, name, brand, price, tags[], url?, urlKind?: 'pdp'|'search', mall?, imageUrl?, match? }
// urlKind=search (v21) — 검색 결과에 PDP 주소가 없어 몰 검색 결과 주소를 대신 실은 웹 상품. 게이트는 이 표식이 있을 때만 검색 페이지
// 주소를 통과시키고(표식 없는 검색 주소는 드롭) FE 카드 버튼은 「몰에서 찾기」, 근거 신뢰 점수는 25
// match = { score 0~100, factors: [{ key, label, score 0~100, weight, note? }], basis?, version? } — 검증 게이트(@ddak/pipeline guards/match.ts)가
// 상품마다 계산한 매칭율: LLM 1~5 평가(skin·concern·preference, 예산 없으면 price)와 결정적 가중치(피부 25 · 고민 30 · 선호 20 · 가격 15 · 근거 10)의
// 가중 합산. FE 상품 카드 「매칭율 n%」 배지와 클릭 팝오버(항목별 막대·근거·계산식)의 원천이며 plan 스텝 payload 에 그대로 남는다
// url·mall = 웹 검색으로 찾은 외부몰 상품 (id는 `web-*`, mall이 있으면 FE가 외부몰 태그·담기불가로 렌더,
// url은 상세보기 사이드 패널이 iframe으로 연다). url은 상품 상세 페이지(PDP)만 — BFF가 검색/목록
// 페이지로 보이는 URL(/search 경로·검색어 쿼리 키)을 드롭한다. 카탈로그(지마켓) 상품은 url(지마켓
// PDP)만 있고 mall이 없다. url 없는 상품은 카탈로그라도 추천에서 제외된다.
// imageUrl = 상품 썸네일 — 카탈로그는 검증된 지마켓 gdimg, 웹 상품은 검색에서 확인된 주소의
// http(s) 검증 통과분만. 없거나 로드 실패면 FE가 이모지 목업 블록으로 렌더한다
```

**체험 기능 가용성** (`GET /api/threads/capabilities`): `{ imageEdit }` — 정밀 렌더를 쓸 수 있는 배포인지. FE는 이 값이 true일 때만 2단계를 시도한다(`:id` 라우트보다 먼저 선언해야 threadId로 잡히지 않는다).

**가상 메이크업 정밀 렌더** (`POST /api/threads/:id/look-render`): 계획의 `look` 섹션은 기본적으로
**기기 안에서** 그려진다(얼굴 랜드마크로 입술·볼에만 색을 얹는 캔버스 합성 — 사진이 서버로 오지
않는다). 이 엔드포인트는 1단계 합성이 화면에 뜬 뒤 **FE가 이어서 자동으로** 부르는 2단계다: 사진(data URL)을 받아 외부 이미지 편집 모델(OpenAI images.edits — Anthropic API에는
이미지 생성·편집이 없다)로 룩을 실제로 올려 돌려준다. 본문에 계획 look 섹션의 `spec` 을 실으면 편집 지시문을 고정 풀글램 템플릿이
아니라 **그 사양에서 생성**한다(`buildLookRenderPrompt` — 립 hex·마감·기법, 치크 위치·발색, 눈, 베이스, 강도 문구. 사양 없는 옛 호출은 템플릿 유지). 계약은 `LookRenderBody`/`LookRenderResult`,
포트는 `@ddak/pipeline` `ImageEditPort`(프로바이더 중립)다. **사진은 요청 본문에만 있고 스텝에는
톤·모델·지연만 남는다.** 실패 본문은 SSE와 같은 문법(`{ code, message, retryable }`) —
`image_not_configured`(OPENAI_API_KEY 없음, 503) / `image_refused`(4xx, 502) / `image_failed`(5xx·타임아웃, 502).
FE는 어떤 실패에서도 기기 합성을 그대로 유지하고 토스트로만 알린다.

**피드백(사용자 평가)**: LivePlayer의 "💬 평가"가 스튜디오 평가 스튜디오와 같은 문법(별점 0~5 + 코멘트,
null=미평가·0점 구분)으로 페이지 전체(`review`) + 컴포넌트별(`components[]` — livePage 투영 아이템 id·라벨 동봉)을
받는다. 저장은 `POST /:id/events`에 `type=feedback`, `data=ThreadStageFeedback`(stage `survey|plan`) — **제출 1회 =
action 스텝 1개(append)** 라 수정 이력이 로그로 남고, 이어보기(`GET /:id`)의 `feedback.{survey,plan}`과 관리
페이지 문서화는 단계별 **최신 제출**을 유효본으로 본다. 계약은 `packages/schema` `ThreadStageFeedback`.
계획 피드백은 소비처가 하나 더 있다: 레일의 "✦ 반영해 다시 생성"이 미전송분을 저장한 뒤 같은 피드백을
`POST /:id/plan`의 `feedback`으로 실어 **반영 재생성**을 요청한다 (프롬프트는 시스템 고정·가변부에만 실려
캐시 유지, prompts.ts `PlanRevisionContext`).

## 1-1. BFF — admin API (스튜디오 운영 콘솔 #ops 전용)

Base: `/api/admin/*` (스튜디오 프록시 `/api/bff/admin/*` 경유) · 인증: **서비스 토큰**만 (옛 `x-admin-token` 이중 가드는 제거 —
스튜디오를 열 수 있으면 누구나 접근). 진입점은 홈 드로어 도구 행의 🧵 버튼 또는 `#ops` 해시 (구 `#admin` 호환, 탭은 `#ops/<탭>`).

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/admin/threads?cursor=&limit=` | 전체 쓰레드 목록 — archived 포함, id(스노우플레이크) 키셋 커서·생성 최신순 |
| GET | `/api/admin/threads/:id` | 쓰레드 상세 — core `ThreadWithSteps` 원본(라이프사이클 로그, llmMeta·action 포함) |
| POST | `/api/admin/threads/:id/archive` | **보관 처리** — `status=archived`. 데이터 보존, 사용자 목록(`GET /api/threads`)에서만 숨김 |
| GET | `/api/admin/feedback` | **평가 모아보기** — 피드백 제출 전체(`AdminFeedbackWire`), 제출 1회 = 항목 1개·최신순. core 피드백 스텝을 BFF가 파싱해 같은 (쓰레드, 단계)의 최신 제출에 `latest=true`. 페이지네이션 없음(core 상한 300건 + `truncated`) — 집계는 FE가 latest 항목만으로 |
| GET | `/api/admin/model` | LLM 모델 설정 — `{ current, defaultModel, configured, options[] }` (카탈로그는 BFF `llm.service` 소유) |
| PUT | `/api/admin/model` | 모델 변경 — `{ model }` (카탈로그 밖 400, `null`이면 기본값 복귀). core `settings.llm-model`에 저장, 새 생성부터 반영(인스턴스 캐시 ≤30s) |
| GET | `/api/admin/prompts` | LLM 시스템 프롬프트 — `{ promptVersion, prompts[] }` (단계별 `defaultText`·`configured`). 카탈로그(3종: survey·plan-skeleton·plan-products)는 BFF `prompts.ts` 소유, `{{CATALOG}}` 자리표시자는 호출 시점 치환 |
| PUT | `/api/admin/prompts/:id` | 프롬프트 재정의 — `{ text }` (null/공백/기본값과 동일이면 설정 삭제 = 기본값 복귀, 카탈로그 밖 id 400). core `settings.llm-prompt-<id>`에 원문 저장, 새 생성부터 반영(인스턴스 캐시 ≤30s). 재정의로 생성된 스텝은 `llmMeta.promptVersion`에 `+custom` 접미 |

파이프라인 스튜디오 (관리 페이지 "파이프라인" 탭 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4):

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/pipeline` | 파이프라인 현황 — `{ engine, stages[], knowledge[] }`. 단계 카탈로그는 @ddak/pipeline `PIPELINE_STAGES`의 와이어 투영(전략 문서 0~7 번호, 병렬은 5a/5b, active/planned), LLM 단계엔 `promptCustom`. knowledge = 붙박이 지식 5종(KV 4 + core 실데이터 1) + `guard-blocklist` + **운영자가 추가한 지식**(`custom: true`, `custom-<slug>` id). 각 항목엔 `custom`·`heading`이 붙는다 — 어느 단계에 실리는지는 이 응답이 아니라 **그 단계 프롬프트에 자리표시자가 들어 있는지**로 정해지므로, FE가 `/prompts`와 대조해 결선을 그린다 |
| PUT | `/api/admin/knowledge/:id` | 지식 KV 편집 — `{ value }` (null/공백이면 설정 삭제 = 지식 없음, kv 지원분·guard-blocklist·추가 지식만). core `settings.knowledge-<id>`/`guard-blocklist` 저장, 새 생성부터 반영(≤30s). 시스템 자리표시자 지식 변경은 프롬프트 캐시 1회 미스 후 재적중 |
| POST | `/api/admin/knowledge` | **지식 소스 추가** — `{ label, placeholder, heading?, note?, value? }`. 주입은 시스템 자리표시자 한 가지다(원장·검증 게이트 주입은 코드 배선이라 만들 수 없다). 자리표시자는 `{{NAME}}` 꼴로 정규화(영문 대문자·숫자·밑줄 2~31자)하고 예약 토큰(`{{CATALOG}}`·붙박이 4종)·중복은 400. 목록은 core `settings.knowledge-custom`(JSON 배열), 값은 붙박이와 같은 `settings.knowledge-<id>`. **만들기만 하면 아직 어디에도 실리지 않는다** — 단계 프롬프트에 토큰을 넣어야 주입된다. 응답은 갱신된 pipeline wire |
| DELETE | `/api/admin/knowledge/:id` | 추가 지식 삭제 (붙박이는 400) — 목록·값 KV와 함께 **재정의 프롬프트에 남은 자리표시자도 제거**한다 (안 지우면 `{{TOKEN}}` 원문이 모델에 나간다). 응답은 갱신된 pipeline wire |
| PUT | `/api/admin/engine` | 생성 엔진 플래그 — `{ engine: legacy\|langgraph\|null }` (null=기본값 legacy 복귀). core `settings.engine` 저장. 요청 단위 오버라이드는 `x-ddak-engine` 헤더 |
| POST | `/api/admin/pipeline/dry-run` | **LLM 단계 단독 실행** (플레이그라운드, SSE) — `{ stageId: survey\|plan-skeleton\|plan-products\|plan-contents, intent, profile?, survey?, answers?, promptOverride? }`. 그래프·쓰레드·core 기록 없이 같은 빌더·스키마·가드로 실행, promptOverride는 저장 없는 what-if. SSE: `status` → `result`(DryRunResult — survey 페이지 \| skeleton 원본 \| 검증 통과 sections+dropLog, 공통 ledger·meta·promptCustom·**prompt**(실제 사용 프롬프트 — 치환 완료 시스템 전문+user 가변부, 평가 실행 저장엔 미포함)) \| `error`(`{ code, message, retryable, detail? }` — **detail 은 관리 SSE 전용 운영자 진단 한 줄**: API 상태·오류 타입·문구 또는 결과 파싱 첫 이슈. 사용자 쓰레드 SSE 에는 없다. flow-run 도 같다) |
| POST | `/api/admin/pipeline/flow-run` | **전체 플로우 실행** (플레이그라운드, SSE) — 실제 LangGraph 그래프(병렬 5a∥5b·interrupt·검증 게이트)를 전용 MemorySaver로 통째 실행하고 **admin 프로필(`ops-playground`)의 core 쓰레드로 실기록**한다 (쓰레드·평가 탭에서 열람·평가·케이스 승격 가능). `{ phase: survey\|plan, flowId?, intent, profile?, survey?, answers? }` — survey 페이즈는 답변 대기 interrupt까지 돌고 flowId(=쓰레드 id) 발급, core 미연결이면 쓰레드 생성 실패를 삼키고 `flow-` 임시 id로 기록 없이 강등(결과 `recorded: false`), plan 페이즈는 flowId로 Command 재개(체크포인트 유실 시 body의 survey·answers 시딩 재실행 — 그래프 복구 경로). SSE: `status` → `stage`(`{ id, phase: start\|done, meta?, prompt?(실행 직전 재구성한 실제 시스템 전문·가변부), summary?, pass?, drops? }` — 노드 완료마다 실시간, 병렬 노드는 각자 완료 시점) → `content`(설문·계획 스트림 조각 원본) → `state`(`{ node, id, patch }` — 노드가 덮은 ThreadGraphState 채널 패치. LastValue라 FE가 누적하면 시점별 스냅샷, 빈 패치 생략, 시작 입력·체크포인트 재개도 합성 시점으로 실림) → `result`(FlowRunResult — 공통 flowId·`recorded`, survey: survey·ledger·meta / plan: 최종 병합 page·dropLog·skeletonMeta·productsMeta) \| `error` |

평가·실험 (관리 페이지 "실험" 탭 — 페이즈 5):

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/eval/cases` | 골든 케이스 목록 (`EvalCasesWire`) |
| POST | `/api/admin/eval/cases` | 쓰레드 → 케이스 승격 — `{ threadId }`, 스텝에서 의도·프로필·설문·답변 스냅샷 추출 |
| POST | `/api/admin/eval/cases/:id/run` | **케이스 실행** (SSE) — 단계 축 `{ stage?: plan\|survey, promptOverride?, label? }`. plan(기본) = 뼈대+상품 dry-run 순차 → 병합 페이지·dropLog·결합 메타 기록, survey = 의도·프로필만으로 설문 페이지 재생성(설문·답변 스냅샷 없는 케이스도 실행 가능). config에 stage 각인 |
| GET | `/api/admin/eval/cases/:id/runs` | 실행 기록 (채점 포함, 최신순) |
| DELETE | `/api/admin/eval/cases/:id` | 케이스 삭제 (실행 기록 cascade) |
| PATCH | `/api/admin/eval/runs/:id` | **사람 채점** — `{ score: 0~5\|null, comment, components? }`. components는 섹션별 채점(`[{ id: sec-<index>, label, score, feedback }]` — 라이브 피드백과 같은 평가 레코드 문법, 생략=유지·빈 배열=비움). judge는 이 경로로 못 건드린다 |
| POST | `/api/admin/eval/runs/:id/judge` | **자동 채점** (SSE) — LLM 심사관이 케이스 입력과 실행 결과를 대조해 루브릭 4차원으로 채점, `run.judge`에 저장. 사람 채점과 절대 안 섞인다(source 축). 단계 축 분기: config.stage=plan(기본)은 `judge`(근거 충실·맞춤성·단계 구성·실행 가능성, dropLog 포함 심사), survey는 `judge-survey`(질문 절제·의도 적합·답하기 쉬움·말투) — 재정의는 각각 `llm-prompt-judge`/`llm-prompt-judge-survey`. SSE: `status` → `result({ run })` \| `error` |
| GET | `/api/admin/metrics/engines` | **전환 판정 계기판** — 실주행 plan 스텝 llmMeta(engine 각인) 엔진별 집계: 표본·평균 지연·뼈대/상품·캐시 적중률·promptVersion |

## 1-2. BFF — search API (홈 검색창 전용, 공개)

홈 검색창의 **진입 분기**와 **AI 검색어 추천**. threads API 와 같은 `x-device-id` 규약, 쓰레드·core 기록 없음(LLM 1회, effort low). LLM 이 막히면(키 없음·실패·파싱 실패) 같은 규칙의 휴리스틱이 대신 답하고 `source: 'fallback'` 으로 표시한다 — 검색은 언제나 어디론가 가야 한다. 계약은 `@ddak/schema` `search.ts`.

| 메서드 | 경로 | 역할 | 요청 본문 | 응답 |
|---|---|---|---|---|
| POST | `/api/search/route` | **두 갈래 판정** — 뷰티 카테고리 한정으로 설문→맞춤 계획(DDAK)을 요구하는 검색어면 `ddak: true`(추천·비교·고민·루틴·상황·피부 타입·"~추천해줘"), 상품 종류 한 단어·브랜드·모델명 조회·비뷰티·서비스 문의·애매하면 `false`(검색 결과 페이지). 프롬프트는 @ddak/pipeline `SEARCH_ROUTE_SYSTEM`(PROMPT_DEFS 밖 — 운영 콘솔 재정의 대상 아님) | `SearchRouteBody` `{ query(1~200), profile? }` | `SearchRouteResult` `{ ddak, normalized(DDAK 면 의도 문장·아니면 원문), reason, source: llm\|fallback }` |
| POST | `/api/search/suggest` | **AI 검색어 추천** — 입력 중인 검색어로 자연어 검색 문장 최대 3개(~25자, "~추천해줘/~찾아줘" 꼴, 서로 다른 축, 프로필 피부 타입 반영). `SEARCH_SUGGEST_SYSTEM` | `SearchSuggestBody` `{ query(1~100), profile? }` | `SearchSuggestResult` `{ suggestions: string[≤3], source }` |
| POST | `/api/search/home` | **홈 개인화** — 첫 화면 **상태 인사** 한 줄(존댓말 1~2문장, 이름·시간대·날씨 한 조각·가장 최근 쓰레드의 상태 — 검색어·상품 제안 없음. 쓰레드를 가리키는 부분은 「」로 감싸고 `threadIndex`(요청 threads 의 1-based 번호)로 알린다 — FE 가 탭 대상(이어보기)으로 만든다) + 개인화 추천 검색어(보라 칩, 8~16자 명사구) 최대 3개. 재료는 이름·프로필·**기기 현지 시각**(`now.iso` 오프셋 포함 — 서버 UTC 로 시간대·날짜를 정하지 않는다)·브라우저가 **이미 허용한** 위치·최근 쓰레드 요약(제목·단계·상태·담은 상품·답변, 최신순 ≤10)·최근 검색어. 날씨는 BFF `WeatherService`가 Open-Meteo(키 없음 — 좌표 0.1도 반올림별 10분 캐시, 1.5초 타임아웃, 위치 없으면 서울, 실패면 null, `WEATHER_API_URL` 로 교체·비활성)에서 붙여 응답에도 싣는다. 프롬프트 @ddak/pipeline `HOME_PERSONALIZE_SYSTEM`(PROMPT_DEFS 밖), 휴리스틱 `heuristicHomeGreeting`/`heuristicHomeSuggestions`(`home.ts`). FE 는 기본 인사말을 먼저 그리고 이 응답을 페이드인으로 얹는다(7초 넘으면 FE 휴리스틱) | `HomePersonalizeBody` `{ name?, profile?, now{iso,hour,weekday}, location?{lat,lon}, threads?: HomeThreadDigest[≤10], recentSearches?[≤10] }` | `HomePersonalizeResult` `{ greeting, threadIndex: number\|null, suggestions: string[≤3], weather: {tempC,humidity?,code,label}\|null, source }` |
| GET | `/api/search/popular?limit=` | **인기 검색어**(파랑 칩) — 전체 사용자 후보 표를 인기순 내림차순(동률 가나다, 정규화 중복 제거)으로 최대 n(1~10, 기본 3). 원천은 core 설정 KV `search-popular`(`[{keyword,count}]`, 30초 캐시) — 표가 없으면 @ddak/pipeline `POPULAR_SEARCH_SEED`로 답하며 같은 값을 KV 에 한 번 시딩한다(`source: seed`→`kv`, core 미연결이면 시드로만). `POST /route` 의 검색어가 후보 표와 일치(대소문자·공백·#·_ 무시)하면 count+1 — 임의 검색어는 표에 넣지 않는다(모두에게 노출되는 칩). 파랑 칩 클릭 자체는 라우터를 거치지 않고 SRP 로 직행하므로 세지 않는다(칩이 스스로 순위를 굳히지 않게) | — | `PopularSearchesResult` `{ items: [{keyword,count}], source: kv\|seed }` |

FE(`apps/studio/src/lib/liveApi.js` `routeSearch`/`suggestSearch`)는 실패 시 `lib/searchCatalog.js` 의 같은 규칙 휴리스틱(`heuristicRoute`/`fallbackSuggest`)으로 대신한다. 홈 첫 화면(`personalizeHome`/`fetchPopularSearches` — `hooks/useHomePersonalize.js`)은 실패·지연을 `lib/homePersonalize.js`(pipeline `home.ts` 의 거울 — 휴리스틱 인사말·추천 검색어·같은 시드 표)로 받고, 결과를 세션 캐시(프로필·쓰레드 상태·날짜·시 단위 키)에 둔다. 모의 스택(`apps/bff/e2e/mock-upstream.mjs`)은 시스템 프롬프트 표식 '검색 라우터'·'검색어 추천'·'홈 인사'로 응답하고 `/v1/weather` 가 모의 Open-Meteo 다(스모크가 `WEATHER_API_URL` 로 가리킨다). 스모크 10.6 이 두 갈래·추천 3개·빈 검색어 400 을, 10.6b 가 개인화 인사말(쓰레드 요약·날씨 포함)·인기 검색어 내림차순·후보 표 count+1·KV 시딩·limit 상한을 확인한다.

## 1-3. 계획 생성 — 상품·콘텐츠 분리와 품질 요약 (2026-09)

계획 생성은 세 LLM 호출의 병렬이다: **5a 뼈대**(`plan-skeleton`) ∥ **5b 상품**(`plan-products`, 웹 검색 최대 4회 — 상품 섹션만) ∥ **5c 참고 콘텐츠**(`plan-contents`, 웹 검색 최대 3회 — 영상·게시글 섹션만, 항목마다 `why`). 셋 다 끝나면 6 검증 게이트가 그라운딩·병합(`mergePlanSections` → `consolidateSmallProductSections`)하고 7 기록이 `llmMeta` 에 `phases{skeletonMs,productsMs,contentsMs}`·합산 `usage.webSearchRequests`·**`quality`**(`PlanQuality` — 섹션·상품·웹 상품·PDP·썸네일·가격 미확인·콘텐츠 섹션/항목/썸네일·드롭 수)를 남긴다. 5b 나 5c 가 실패해도 계획은 살아 있고(없는 채로 반환), 옛 재정의 프롬프트가 5b 에서 콘텐츠를 만들어도 5c 결과가 있으면 그쪽을 쓴다.

와이어 변화: `CatalogProduct.priceUnknown?`(판매가 미확인 — price 0), `PlanContentItem.why?`. 검증 게이트 드롭 코드 추가: `catalog-low-match`·`catalog-overflow`·`already-in-cart`·`stale-content`·`low-trust-source`·`duplicate-source`·`duplicate-recent`. 원장(`ledger`)에 `budgetMinKrw`(예산 하한 — 드롭 기준 아님)·`recentRecommended`·`recentContentUrls`(같은 사용자 최근 3개 쓰레드) 추가.

**v27(2026-09-17)**: 5c 참고 콘텐츠가 빈 결과면 BFF 가 검색어를 바꾸라는 힌트로 한 번 더 부른다(SSE `status` 「참고할 영상·게시글을 다른 검색어로 다시 찾고 있어요…」, plan 스텝 `dropLog` 에 정보 기록 `contents-empty-retry`). 상품 검색(5b)이 상품 섹션을 하나도 못 만들면 뼈대의 상품 자리를 카탈로그 매칭(60% 이상, 자리당 3개) 상품으로 채운다(`dropLog` `catalog-fallback`). 둘 다 드롭이 아니라 정보 기록이다.

admin: 프롬프트 카탈로그에 `plan-contents` 추가, 지식 목록에 guard 행 `guard-content-hosts`(콘텐츠 저신뢰 출처 도메인, 줄바꿈 구분·접미 일치) 추가, dry-run `stageId` 에 `plan-contents` 추가(응답은 `sections`·`dropLog`), `GET /api/admin/metrics/engines` 엔진별 `avgContentsMs`·`quality`(비율 0~1·평균, quality 요약이 있는 표본만). 썸네일 보강(`EnrichService`, og:image)은 BFF 환경변수 `ENRICH_FETCH=0` 으로 끌 수 있다(오프라인 e2e).

## 1-4. 내재화 카탈로그 — 내부 DB 절반 + 웹 검색 절반 (v29, 2026-09-17)

추천 상품·참고 콘텐츠를 core DB(Neon `catalog_products`·`catalog_contents`)에 쌓고, 계획 생성이 **내부 후보 절반 + 웹 검색 절반**으로 고른다.
목적은 둘 — 빠른 응답(내부 후보가 절반을 채우니 5b·5c 웹 검색 상한이 4→3, 지마켓 검색 불필요)과 정확한 PDP(내부 행은 상품 번호로 주소·썸네일이
결정되는 검증 상품이고, 모델은 **id 만** 적어 주소를 되받아 적지 않는다).

- **후보 조회(4단계 근거 수집의 첫 실구현)**: 의도·답변·프로필에서 검색어를 뽑아(`@ddak/pipeline catalogTermsOf` — 제품 유형 어휘 `PRODUCT_TYPE_VOCAB`
  + 조사·상투어를 뗀 낱말) core `POST /internal/catalog/{products,contents}/search` 로 상품 24·콘텐츠 12개를 받는다(BFF `CatalogService.candidatesFor`).
  그래프는 s2 원장 노드(첫 조립·답변 뒤 갱신 둘 다)에서, legacy 는 계획 생성 직전에, dry-run 도 같은 조회. 표가 비었거나(마이그레이션·시딩 전) core
  미연결이면 데모 카탈로그 14종으로 대신한다(옛 `{{CATALOG}}` 와 같은 상품) — 계획을 막지 않는다.
- **주입**: 후보는 시스템 프롬프트가 아니라 **가변부(사용자 메시지) 표**로 실린다(`productCandidatesBlock`·`contentCandidatesBlock` — 시스템은 바이트
  고정·캐시 유지). 5b 는 `productIds`(≤8)+`catalogRatings` 로, 5c 는 새 필드 `catalogIds`(≤6) 로 id 만 적는다. `PLAN_PRODUCTS_SYSTEM` v29 에는 정적
  `{{CATALOG}}` 블록이 없다(재정의 프롬프트에 남아 있으면 데모 14종으로 치환은 되지만 후보 표와 겹친다).
- **검증 게이트**: `GuardContext.candidates` — productIds·catalogIds 는 이 요청의 후보 목록(+데모 카탈로그)에서만 해석(`catalog-miss`), 내부 상품은
  근거 신뢰 100·id 접두가 `web-` 이 아니면 내부(품질 KPI `webProducts` 도 접두 기준), 웹 상품이 후보와 같은 지마켓 상품 번호면 후보 값으로 대체
  (`duplicate-candidate` 정보 기록), 섹션당 내부 상한 `CATALOG_MAX_PER_SECTION` 3→4. **PDP 보정** `repairPdpUrl`: 아는 몰인데 상품 번호 형식이 어긋난
  주소(지마켓 goodscode 없음·올리브영 goodsNo 가 `A`+12자리 아님·쿠팡 `/vp/products/<번호>` 아님)는 몰 검색 링크(`urlKind=search`, 근거 25)로 바꿔
  싣는다(`repaired-url` 정보 기록) — 깨진 상세보기 대신 검색 결과가 열린다. 카탈로그 폴백 풀도 후보+데모.
- **수확**: 7단계 기록 직후 최종 페이지의 상품·콘텐츠를 `harvestRowsOf` 로 행으로 만들어 `PUT …?bump` upsert. **몰은 가리지 않는다** — 웹 지마켓
  `gm-<번호>`, 올리브영 `oy-<goodsNo>`, 쿠팡 `cp-<번호>` 는 상품 번호 형식이 맞으면 verified(주소가 번호로 결정된다 — `pdpKeyOf`/`pdpVerified`),
  그 밖의 몰 `web-<url 해시>` 는 썸네일(og:image)을 받아 왔으면 verified(페이지가 실제로 열렸다) 아니면 unverified(운영자 표시로 승격), 검색 링크
  상품은 제외, 콘텐츠는 `ct-<url 해시>`(verified). 태그 = 이 계획의 검색어 + 섹션 제목의 제품 유형 → 다음 검색이 이 행을 찾는다. 웹 상품이
  후보와 같은 정체 키(지마켓·올리브영·쿠팡 번호)면 후보로 대체된다.
- **시딩 재료는 셋이다(2026-09-17 결정 — 스튜디오 SRP 스냅샷·데모 카탈로그는 시딩에 쓰지 않는다)**: ① **시딩 실행 시 실제 웹 검색 배치** —
  운영 콘솔 「데이터 시딩」 메뉴(`#ops/seeding`)의 「✦ 시딩 잡 시작」이 제품 유형 어휘(`CATALOG_SEED_KEYWORDS`, 42개)를 8개씩 `POST /api/admin/catalog/seed-search` 로 보내고,
  BFF 가 유형마다 LLM+web_search 1회(`CATALOG_SEED_SYSTEM`, 검색 2~3회, PROMPT_DEFS 밖)로 실제 판매 상품 8~12개를 모아 `seedProductRowsOf` 로
  행(source `search`)을 만든다 — 몰별 상품 번호 형식이면 verified, 검색 페이지 주소·주소 없는 상품은 버림, 유형만이면 42 검색 약 $5.
  **대량 시딩**은 검색 단위를 유형 × 조건 축(`catalogSeedQueries` — 피부 타입 4·고민 6·가격대 2·몰 3, `CATALOG_SEED_FACETS`)으로 펼친다:
  실행은 **서버 시딩 잡**(위 표 `seed-job`)이다 — 상태·진행·회차 기록·결과가 core KV 에 있어 운영 콘솔 카드가 실시간으로 보고, 드라이버는
  콘솔 「데이터 시딩」 탭(「✦ 시딩 잡 시작」 뒤 그 탭이 step 을 돌린다 · 「이 탭에서 돌리기」로 이어받기 · 일시정지/재개)이든 배치 스크립트
  `npm run seed:search --workspace=apps/bff -- --bff <BFF 주소> --token <BFF_SERVICE_TOKEN> --facets skin,concern [--dense] [--resume|--reset] [--status] [--dry-run]`
  이든 같은 잡을 민다(Ctrl+C 해도 잡은 남고 다시 실행하면 이어 돈다). 단위당 약 $0.14(dense $0.18) — 네 축 전부면 672 단위 ≈ $95, 상품 5,000~8,000개. ② **지난 쓰레드의 계획**
  — `POST /api/admin/catalog/harvest` 백필(실주행은 7단계가 자동). ③ **올리브영 사내 Mongo 내보내기** `npm run export:catalog
  --workspace=apps/tagging-api -- --out oy.json`(태깅 스튜디오와 같은 문서 → 행, goodsNo 형식이면 verified, 태그 = 세부유형·제형·성분·피부 타입·
  고민·결과·대분류, source `manual`) → `npm run seed:catalog --workspace=apps/core -- --file oy.json` 또는 「데이터 시딩」 메뉴의 「JSON 가져오기」. 그 밖의 몰도
  같은 행 형식의 JSON 을 가져오기로. admin API:

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/catalog` | 현황 `AdminCatalogWire` — `{ stats: CatalogStatsWire, available, note? }` (표 없음·core 미연결이면 available=false) |
| GET/POST/DELETE | `/api/admin/catalog/seed-job` · POST `…/step` · `…/pause` · `…/resume` | **시딩 잡** — 상태는 core KV `catalog-seed-job`(`CatalogSeedJob`: facets·types·dense·total·cursor·retry·failed·products·verified·webSearchRequests·history[≤40]·lockUntil·lastError). POST 시작(`StartCatalogSeedJobBody`, 진행 중 잡이 있으면 reset 없이 409) → 드라이버(콘솔 「이 탭에서 돌리기」·`apps/bff/scripts/seed-search.mjs`)가 `step` 을 반복 호출해 8단위씩 전진(서버리스 300초 안, 회차 잠금 270초 — 다른 드라이버는 `busy`), 본 회차 뒤 실패 단위 재시도 회차 1번, 끝나면 `done`. 콘솔 「데이터 시딩」 메뉴가 진행 바·회차 기록·결과를 본다(드라이버가 없으면 10초 조회) |
| POST | `/api/admin/catalog/seed-search` | **시딩 웹 검색 배치(잡 없이 1회차)** `{ keywords?[≤8] }`(유형만) 또는 `{ queries?: [{ keyword, query? }][≤8], dense? }`(대량 — 유형×조건) → `{ keywords, failed[], products, verified, webSearchRequests }` — 검색 단위마다 LLM+web_search 1회(동시 3, dense 는 검색 4회·16개), 실패 단위는 failed 로(초점 문구, 다시 돌리면 됨), 결과는 멱등 upsert |
| POST | `/api/admin/catalog/import` | 가져오기 `{ products?[≤500], contents?[≤500] }` — 올리브영 사내 Mongo 내보내기 JSON 등 행 파일을 500개씩 올린다 (멱등) |
| POST | `/api/admin/catalog/harvest?limit=` | 지난 쓰레드 계획에서 수확(백필) — 최신 N개 쓰레드의 plan 스텝을 실주행과 같은 규칙으로 |
| POST | `/api/admin/catalog/verify?limit=&mall=` | 상품 링크 점검 — 오래 안 본 순 N개(mall 기본 `*` 전체): 지마켓은 썸네일(gdimg)·그 밖의 몰은 상품 주소에 HEAD, 404 → `dead`, 200 → `verified`. 올리브영·쿠팡은 Node 에서 닿지 못해 건너뜀(번호 형식으로 verified) |

e2e: `langgraph-smoke.mjs` 14절(모의 core 가 인메모리 카탈로그 — 수확·시딩·5b 가변부 후보 표 주입 확인), 단위 `packages/pipeline/test/catalog.test.mjs`.

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
| GET | `/internal/plan-metas?limit=` | plan 스텝 llmMeta 최신순 (`PlanMetasWire`) — 전환 판정 계기판 원천 |
| POST/GET/DELETE | `/internal/eval/cases[...]` | 평가 케이스 CRUD (`eval_cases`) — id는 core 스노우플레이크 발급 |
| POST/GET | `/internal/eval/cases/:id/runs` · GET/PATCH `/internal/eval/runs/:id` | 실행 기록 저장·조회·사람 채점(score·comment·components) (`eval_runs`, 케이스 cascade) — core는 내용 해석 안 함. 단건 GET은 `{ run, case }`(자동 채점이 케이스 입력을 함께 쓴다) |
| PUT | `/internal/eval/runs/:id/judge` | 자동 채점 판정 저장 (`{ judge: EvalJudgeVerdict }`) — 사람 채점 필드는 불변 (source 축 분리) |
| GET | `/internal/settings/:key` · PUT · DELETE | 운영 설정 KV (jsonb — core는 해석 안 함). 예: `llm-model` |
| POST | `/internal/catalog/products/search` · `/internal/catalog/contents/search` | **내재화 카탈로그** 검색 (`CatalogSearchQuery` → `Catalog*SearchWire`) — search_text 부분 일치 점수순, 기본 verified·active 만 (§1-4) |
| PUT | `/internal/catalog/products` · `/internal/catalog/contents` | 일괄 upsert (≤500) — `bump=true` 면 수확(노출 횟수 누적·출처/검증/상태 보존·태그 합집합) |
| PATCH | `/internal/catalog/products/:id` · `/internal/catalog/contents/:id` | `verified`·`status` 표시 (`PatchCatalogRowBody`) |
| GET | `/internal/catalog/products/verify-list?mall=&limit=` · `/internal/catalog/stats` | 점검 대상(오래 안 본 순) · 현황 (`CatalogStatsWire`) |
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
| ddak-bff | `apps/bff` | `ANTHROPIC_API_KEY`(없으면 생성 요청이 실패 안내로 응답), `CORE_URL`, `CORE_SERVICE_TOKEN`, `NODEJS_HELPERS=0`, `ALLOWED_ORIGINS?` |
| ddak-core | `apps/core` | `DATABASE_URL`(Neon 통합 자동 주입), `CORE_SERVICE_TOKEN`, `NODEJS_HELPERS=0`, `API_DOCS?` |
