# DDAK LLM 파이프라인 — LangGraph 기반 재설계

> 2026-08 확정. 근거 문서: 팀 전략 문서 "DDAK · 쓰레드 품질을 올리는 법"(2026-08-05 v1, 8단계 파이프라인)
> + DESIGN-LLM-SERVICE.md(현행 구현). 이 문서는 그 둘을 잇는 **이행 설계**다.

## 0. 전제

1. **이 리포는 실험실(lab)이다.** 실제 프로덕션 서비스는 클라우드 컨테이너 환경에 별도로 선다.
   실험실의 산출물은 코드가 아니라 **이관 자산** — 파이프라인 설계(단계 카탈로그), 프롬프트,
   입출력 스키마, 결정적 가드, 골든 케이스·평가 데이터, 지식 데이터 가공 포맷.
2. **기술 스택 PoC도 실험실의 목적이다.** LangGraph 도입은 결정됐고, 엔진 병행 배치(플래그)로
   검증하며 실험 탭이 정량 판정을 낸다.
3. **팀 수집 데이터(5종)는 아직 DB화 전이다.** 지식 주입 지점은 전부 인터페이스로 뚫어 두되
   v0 구현은 core 설정 KV(관리 페이지 수동 편집). DB/RAG가 준비되면 구현체만 교체한다.
4. **모델·프로바이더는 바뀔 수 있다.** LLM 호출은 LlmPort 인터페이스 뒤에 두고, 1차 구현은
   Anthropic SDK 네이티브 경로를 유지한다 (LangChain 모델 래퍼 미사용).

## 1. 채택 아키텍처 — LangGraph 오케스트레이션 + 네이티브 노드 하이브리드

| 소유 | 내용 |
|---|---|
| **LangGraph(JS)** | 그래프 토폴로지(단계 순서·병렬 포크·합류), 상태 전이, checkpoint 영속화(Neon Postgres 별도 스키마), interrupt/resume(설문 대기·향후 주문/배송 페이즈), 단계별 텔레메트리 |
| **LangGraph가 소유하지 않는 것** | LLM 호출 자체 — 노드 내부는 `LlmPort`(1차 구현 = Anthropic SDK)를 부른다. 구조화 출력(zodOutputFormat)·프롬프트 캐시 바이트 고정·StructuredStreamParser 부분 스트리밍·web_search 서버 도구를 보존하기 위해 LangChain 모델 래퍼는 쓰지 않는다 |

### 그래프 (전략 문서 8단계 → StateGraph)

```
START
 └─ ledger        (2: 제약 원장 조립 — 프로필+답변+피드백+KV 키워드)
     └─ survey    (3: 설문 생성 — LLM, 부분 스트리밍)
         └─ [interrupt]  ← 사용자 답변 대기 (HTTP 요청 경계)
             └─ ledgerUpdate (답변 → 원장 갱신)
                 ├─ skeleton            (5a: 계획 뼈대 — LLM)          ┐ 병렬
                 └─ candidates→products (4→5b: 근거 수집+상품/콘텐츠)   ┘
                     └─ verify  (6: 검증 게이트 — 결정적, dropLog 산출)
                         └─ record (7: core 스텝 기록 + llmMeta)
                             └─ END   (향후: interrupt → 주문·배송 페이즈)
```

- 설문 요청 = `graph.invoke` → survey까지 → interrupt로 설문 반환. 답변 제출 = `Command(resume)`
  → 병렬 포크→검증→기록. 요청 1회 = 그래프 실행 1구간 — 서버리스에서도 유효, 컨테이너에선 더 편하다.
- **checkpointer**: Postgres 구현체를 기존 Neon DB 별도 스키마(`lg_*`)에 — 인프라 추가 없음.
  `thread_id` = 우리 threadId.
- **진실 원천 규칙**: core 쓰레드 스텝 = 화면·이어보기·관리 페이지·평가의 원천(불변).
  checkpointer = 그래프 재개 전용 실행 상태. 쓰레드 보관 시 체크포인트도 정리.
  checkpoint 유실 시 core 스텝에서 재구성하는 복구 경로(현 이어보기 로직) 유지.
- **스트리밍**: custom 스트림 모드 writer로 노드가 부분 컴포넌트를 밀어 올리고 SSE 브리지가
  현행 이벤트 형식 그대로 FE에 전달 — FE 계약 무변경. StructuredStreamParser는 LLM 노드 안에 유지.
- **피드백 반영 재생성**: revision 컨텍스트를 상태에 실어 skeleton∥products부터 재진입.
- **노드 설계 원칙**: 노드는 얇은 어댑터, 로직은 전부 `@ddak/pipeline` 순수 함수.
  → 스튜디오 플레이그라운드가 그래프 없이 단계 함수를 dry-run, 단위 테스트가 그래프 없이 돌고,
  프로덕션이 프레임워크 선택과 무관하게 로직을 재사용한다.

## 2. 패키지 구조

```
packages/pipeline/            ← @ddak/pipeline — 이관 자산의 물리적 실체 (프레임워크·프로바이더 중립)
  src/stages.ts               PIPELINE_STAGES 카탈로그 (전략 문서 0~7 번호·이름·프롬프트 id·effort·구현 상태)
  src/ledger.ts               ConstraintLedger zod + 조립기 (소스별 optional — 데이터 없으면 빈 필드)
  src/prompts.ts              PROMPT_DEFS·빌더·{{자리표시자}} (구 apps/bff/src/llm/prompts.ts)
  src/schemas.ts              LLM 생성 출력 zod (구 gen-schemas.ts)
  src/catalog.ts              v0 데모 카탈로그 — CandidateProvider의 v0 데이터
  src/stream-parse.ts         구조화 출력 부분 스트리밍 파서
  src/llm-port.ts             LlmPort 인터페이스 + GenResult·LlmStreamHandlers·LlmGenerationError
  src/guards/grounding.ts     검증 게이트 — 상품·콘텐츠 그라운딩 (순수 함수, GroundingDrop 반환)
  src/guards/merge.ts         뼈대/검색 병합 규칙 (구 plan-merge.ts)
  src/knowledge/sources.ts    지식 소스 5종 카탈로그 + KV 게터 주입형 구현

apps/bff/src/
  engine/                     (페이즈 2) StateGraph·상태·노드·checkpointer·SSE 브리지
  llm/llm.service.ts          LlmPort 1차 구현 (모델/프롬프트 KV 캐시 유지)
```

의존성: `@langchain/langgraph` + Postgres checkpointer만, 버전 고정, apps/bff에 추가 (페이즈 2).
LangSmith 등 외부 관측 미사용 — 관측은 파이프라인 스튜디오가 담당.

## 3. 지식 5종 — KV 우선, 추후 교체

| 데이터 | v0 (지금) | 주입 위치 | 추후 |
|---|---|---|---|
| 트렌드 키워드 | KV `knowledge-trend-keywords` | 사용자 메시지 가변부 | 트렌드 수집 파이프 |
| 쓰레드 피드백 | **실데이터** — core 스텝. deviceId 단위 압축 조회 배관만 신규 | 가변부 | (유지) |
| 서비스 설문조사 | KV `knowledge-survey-rules` (증류 규칙 문장) | 시스템 자리표시자 | 통계→규칙 증류 |
| 트렌드 인터뷰 | KV `knowledge-consumer-vocab` + `knowledge-selection-criteria` | 시스템 자리표시자 | 녹취→요약 파이프 |
| 시나리오 피드백 | KV `knowledge-fewshot` (스튜디오 상위 케이스 JSON) | 시스템 자리표시자 | 자동 내보내기 |

시스템 주입은 기존 `{{CATALOG}}` 자리표시자 메커니즘 확장({{VOCAB}}·{{RULES}}·{{FEWSHOT}}) —
KV 변경 시에만 캐시 1회 미스. 빠르게 변하는 것은 사용자 메시지에 짧게 압축 (전략 문서 p.3 규칙).

## 4. 페이즈

| 페이즈 | 내용 | 완료 기준 |
|---|---|---|
| **1. 자산 추출** | `@ddak/pipeline` 생성 — 프롬프트·스키마·가드 이동(동작 불변), LlmPort 추출, 단계 카탈로그·원장 스키마·지식 소스 정의 | bff 빌드·기존 플로우 동일 |
| **2. 그래프 엔진** | StateGraph+checkpointer+SSE 브리지+노드. core KV `engine=legacy\|langgraph` 플래그(+요청 헤더 오버라이드) 병행 배치 | 라이브 체험 전 구간이 langgraph 엔진으로 FE 무수정 동작 |
| **3. 파이프라인 강화** | ledger 노드(원장 스냅샷 기록) + 지식 KV 5종 + 자리표시자 확장 + 검증 게이트 확장(블록리스트·의학 단정·원장 역대조·dropLog 기록) | plan 스텝 payload에 원장·dropLog, KV 편집 30s 내 반영 |
| **4. 파이프라인 스튜디오** | #admin 4탭 — 단계 카드(그래프 토폴로지)+프롬프트/지식 편집+플레이그라운드(단계 함수 dry-run·임시 프롬프트 what-if)+트레이스(노드별 지연·토큰·dropLog) | 코드 배포 없이 열람→수정→단독 실행→확인 |
| **5. 평가·실험 + 전환 판정** | core `eval_cases`/`eval_runs`, 쓰레드→케이스 승격, 실험 실행(엔진·프롬프트·모델 축), 리더보드 | **전환 게이트**: 가드 통과 동등·TTFT +20% 이내·캐시 적중 유지 → engine 기본값 전환, legacy 제거 |
| **6. 신규 단계** | 범위 가드(0) → 의도 정규화(1, 경량 LLM) → 변동 설문 0~3+원장 스킵(3) — 노드 삽입만으로 | 단계별 실험 탭 전/후 비교 후 활성화 |
| **7. 프로덕션 준비** | bff Dockerfile+컨테이너 검증, 그래프 명세 문서화, CandidateProvider 자체 검색 교체(웹 검색 서버 도구 의존 축소), 필요 시 2차 LlmPort+프로바이더 비교 | 프로덕션 팀이 pipeline 패키지+명세+골든 케이스 소비 가능 |

## 5. 리스크와 완충

- **스트리밍 열화**(writer 버퍼링): 페이즈 2 최우선 검증. 문제 시 LLM 노드가 SSE 응답에 직접 쓰는 우회로.
- **서버리스 checkpoint 지연**: persist 규칙(응답 전 완료 대기)에 checkpoint 포함. 컨테이너 전환 시 해소.
- **이중 상태 드리프트**: "화면·기록은 core, 재개는 checkpoint" 규칙을 record 노드가 강제.
- **버전 변동**: LangGraph 버전 고정, 업그레이드는 실험 탭 골든 케이스 통과 조건.
- **롤백**: engine 플래그 한 줄로 legacy 복귀 (페이즈 5 전까지 legacy 경로 유지).

## 6. 프로덕션 이관 명세 (페이즈 7)

**컨테이너**: `docker build -f apps/bff/Dockerfile -t ddak-bff .` (컨텍스트 = 리포 루트).
node:22-alpine 2스테이지 — 워크스페이스 루트 락파일로 설치(`packages/*`는 npm ci의
워크스페이스 prepare가 빌드 — pipeline prepare가 schema를 먼저 빌드해 알파벳 순서 함정을
피한다), bff만 빌드해 러너로. dev 의존성 프루닝은 최적화 단계로 보류(현재 ~590MB).
검증 완료: 컨테이너 안에서 healthz·admin pipeline·그래프 엔진 전 플로우(설문 interrupt →
Command 재개 → 계획) 동작, production 모드에선 BFF_SERVICE_TOKEN 필수(가드 정상).

**환경변수** (컨테이너 = Vercel과 동일 계약): `PORT`(기본 8788) · `CORE_URL` ·
`CORE_SERVICE_TOKEN` · `ANTHROPIC_API_KEY`(+선택 `ANTHROPIC_BASE_URL`) ·
`BFF_SERVICE_TOKEN`(production 필수) · `LANGGRAPH_DATABASE_URL`(선택 — 없으면 MemorySaver
+ core 시딩 복구) · `ALLOWED_ORIGINS`.

**프로덕션 빌드가 소비하는 이관 자산**:
1. `@ddak/pipeline` — 단계 카탈로그(그래프 명세)·프롬프트·생성 스키마·가드·원장·지식 소스·
   LlmPort·CandidateProvider. 프레임워크·프로바이더 중립 — LangGraph를 유지하든 바꾸든 소비 가능
2. `apps/bff/src/engine/` — LangGraph 참조 구현 (노드 = 카탈로그 id와 1:1, 컨테이너 검증 완료)
3. core `eval_cases`·`eval_runs` — 회귀 셋 씨앗. 프롬프트는 core 설정 KV가 원천(데이터로 이관)
4. `apps/bff/e2e/` — 오프라인 스모크(66+ 어서션): 프레임워크 교체·업그레이드의 회귀 게이트

**남은 교체 지점** (데이터 도착 후): CandidateProvider 실검색 구현(candidates.ts 주석의
3단계 절차 — 후보를 시스템 캐시에서 사용자 메시지로 옮기며 캐시 경제성 재평가), 지식 KV →
DB/RAG(KnowledgeService 조회만 교체), 2차 LlmPort(프로바이더 비교 실험 잡힐 때).

**전환 게이트 운영**: 실주행 트래픽을 `x-ddak-engine: langgraph`(또는 KV engine)로 흘리고
실험 탭 전환 판정 계기판에서 legacy 대비 지연 +20% 이내·캐시 적중 유지·가드 통과 동등을
확인 → 파이프라인 탭 엔진 토글로 기본 전환 → 안정 후 legacy 경로 제거.
