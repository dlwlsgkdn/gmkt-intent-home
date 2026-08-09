# DDAK Scenario Studio — 프로젝트 가이드

> 전체 기능 명세는 [FEATURES.md](FEATURES.md) 참고.

지마켓 뷰티 AI 쇼핑 컨셉의 **시나리오 목업 제작·발행 도구**. 사용자가 "설문→계획" 플로우 시나리오를 노코드로 편집·발행하면 홈 검색창 밑에 칩으로 노출되고, 칩 클릭으로 실제처럼 체험할 수 있다.

## 저장소 구조 (npm workspaces 모노레포)

```
apps/studio/       ← 스튜디오 소스 (React 18 + Vite 5). 빌드 산출물은 apps/studio/dist (커밋 안 함)
apps/core/         ← NestJS backend core — 쓰레드 저장·조회 (Drizzle+Neon). 실행·배포는 apps/core/README.md
apps/bff/          ← NestJS BFF — LLM(설문·계획 생성, 계획은 웹 검색 병행)·core 오케스트레이션. DESIGN-LLM-SERVICE.md §4, API.md §1 참고. src/engine/ = LangGraph 그래프 엔진(전략 문서 8단계 StateGraph — interrupt/재개·병렬·custom 스트림→SSE 브리지): core KV `engine`(legacy|langgraph, 기본 legacy) + 요청 헤더 `x-ddak-engine`으로 병행 배치, checkpointer는 LANGGRAPH_DATABASE_URL 있으면 Neon lg 스키마·없으면 메모리(유실 시 core 스텝 시딩 복구 — 진실 원천은 언제나 core). 노드 로직은 @ddak/pipeline 순수 함수 소비. 지식 5종·블록리스트는 core 설정 KV(knowledge-*·guard-blocklist, 30s 캐시)로 주입 — 시스템 자리표시자({{VOCAB}} 등, 캐시 흡수)와 원장 가변부로 갈라 싣고, 검증 게이트(블록리스트·의학 단정·원장 역대조) 드롭 사유와 원장 스냅샷은 plan 스텝 payload(dropLog·ledger)에 남는다
packages/schema/   ← @ddak/schema — 쓰레드 도메인·internal API zod 계약 (install 시 prepare로 dist 빌드)
packages/pipeline/ ← @ddak/pipeline — LLM 파이프라인 이관 자산: 단계 카탈로그·프롬프트·생성 스키마·결정적 가드(그라운딩·병합·partial)·LlmPort 계약·원장·지식 소스. 프레임워크(LangGraph)·프로바이더 중립 순수 로직만 — bff는 여기서 import. 설계·페이즈는 DESIGN-PIPELINE-LANGGRAPH.md
api/               ← 스튜디오 서버리스 (Vercel 함수, 루트 고정) — state.js(동기화)·pdp.js(지마켓 PDP iframe 프록시)
middleware.js      ← 스튜디오 엣지 미들웨어 (루트 고정) — /api/bff/* 를 BFF로 rewrite + BFF_SERVICE_TOKEN 주입 (FE는 bff URL을 직접 안 부름. 스튜디오 프로젝트 환경변수 BFF_URL·BFF_SERVICE_TOKEN 필요)
legacy/            ← 옛 HTML 프로토타입 원본 (빌드 시 apps/studio/dist/legacy 로 복사됨)
```

루트 package.json이 워크스페이스 루트(`apps/*`, `packages/*`) — 설치는 항상 **리포 루트에서 `npm install`** 한 번, 락파일도 루트 하나다.

- **배포 (주)**: Vercel `ddak-scenario-studio`가 GitHub main 푸시마다 **원격 빌드·배포**. `https://ddak-scenario-studio.vercel.app` — vercel.json이 루트에서 워크스페이스 전체를 설치하고 apps/studio를 빌드해 outputDirectory `apps/studio/dist`를 서빙한다. API(`api/state.js`)도 같은 프로젝트라, **로컬 Node 없이 소스 푸시만으로 배포된다**
- **배포 (GitHub Pages)**: `.github/workflows/pages.yml`이 main 푸시마다 빌드해 아티팩트로 배포. `https://dlwlsgkdn.github.io/gmkt-intent-home/` (구 `…/docs/` 주소는 아티팩트 안 리다이렉트 스텁이 받는다). 커밋된 빌드 산출물은 더 이상 없다 — 두 배포 모두 push만 하면 각자 최신으로 빌드된다
- **빌드/배포 절차**: 소스 커밋 → 사용자가 `git push origin main` (Claude는 푸시 못 함) → Vercel·Pages가 각각 자동 빌드
- **배포 확장 규칙**: 새 앱(core·bff)은 같은 리포를 연결한 **별도 Vercel 프로젝트**(Root Directory=`apps/<앱>`)로 배포한다. 무관 커밋 스킵은 대시보드가 아니라 `apps/<앱>/vercel.json`의 `ignoreCommand`(`git diff --quiet HEAD^ HEAD -- ':(top)apps/<앱>' ':(top)packages' ':(top)package-lock.json'`)로 리포에 커밋한다 — Root Directory만 대시보드 설정

## 명령어

이 머신은 기본 node(homebrew, v23+)로 빌드된다 (옛 안내의 `/Users/jinhalee/.nvm/...` v24 경로는 이전 머신 것 — 존재하면 그쪽을 써도 무방):
```bash
npm run build --workspace=apps/studio       # 스튜디오 빌드. vite build && cp -R ../../legacy dist/legacy
npm run build --workspace=apps/core         # core(NestJS) 빌드
npm run start:dev --workspace=apps/core     # core 로컬 실행 (환경변수: apps/core/.env.example — 없어도 부팅, DB 라우트만 503)
npm run db:generate --workspace=apps/core   # core 스키마 → drizzle/ 마이그레이션 SQL (오프라인)
npm run db:migrate --workspace=apps/core    # 마이그레이션 SQL 순서 적용 — DB 반영은 push(diff·타입 전환 실패)보다 이쪽 (--status·--baseline 지원)
npm run build --workspace=apps/bff && npm run e2e:mock --workspace=apps/bff  # bff 오프라인 E2E — 모의 core+Anthropic 위에서 LangGraph 엔진·legacy 전 구간 스모크 (네트워크·키 불필요)
docker build -f apps/bff/Dockerfile -t ddak-bff .  # bff 컨테이너 (컨텍스트=리포 루트, 프로덕션 이관 준비 — DESIGN-PIPELINE-LANGGRAPH.md §6)
```
개발 서버: `.claude/launch.json`의 `scenario-studio` (포트 5173), 정적 검증용 `pages-static` (포트 8899, apps/studio/dist 서빙 — 빌드 후 사용).

워크스페이스 주의: `@ddak/schema`·`@ddak/pipeline`을 수정하면 소비자가 dist를 보므로 `npm run build --workspace=@ddak/schema`(또는 `--workspace=@ddak/pipeline`)로 재빌드할 것(설치 시엔 prepare가 자동 빌드). **루트 devDependencies의 drizzle-orm은 지우지 말 것** — npm이 orm을 apps/core 아래로 중첩 배치해 루트에 호이스팅된 drizzle-kit가 못 찾는 문제를, 루트 선언으로 호이스팅을 강제해 해결한 것이다(core와 버전 범위를 항상 맞출 것).

**데이터 프로필** (`lib/remote.js`): 개발 서버 = `local`(localStorage 전용, 서버 동기화 없음), 빌드 산출물 = `prod`(localStorage + Neon DB 미러링). 로컬에서 운영 DB에 붙으려면 `VITE_DATA_PROFILE=prod npm run dev`. 콘솔 `[remote] 데이터 프로필:` 로그로 확인. 서버 미러링을 운영 DB 없이 검증하려면 목 API(+`VITE_API_PROXY`)를 쓰는 `scenario-studio-mockdb`(포트 5174) 참고.

**서버 동기화는 자동 다운로드 + 수동 업로드(빌더) + 트랜잭션 자동 싱크(스튜디오 밖)** (`api/state.js` + `hooks/remote/`(useWorkspace가 배선) + `components/SyncButton.jsx`): 접속 시 서버로 하이드레이션하고, 빌더의 연속 편집은 "서버에 저장"으로 올린다 — 저장 상태·수동 저장 UI는 **빌더 상단바 SyncButton 전용**이다. 홈은 쓰기가 전부 자동 싱크라 저장 UI가 없고, 프로필 버튼 배지로 다운로드 상태만 보여준다(동기화 중 펄스·연결 안 됨). 스튜디오 밖 단발 쓰기 트랜잭션(프로필 생성·삭제, 시나리오 생성·복제·가져오기·삭제·칩 순서, 쓰레드 기록·삭제, 전체 복원, 공유 링크 가져오기 — 프로필 전환은 쓰기가 아니라 제외)은 `requestAutoSync()`가 1.2s 디바운스 뒤 자동 업로드한다 — 전체 자동 미러링은 여러 창이 서로를 덮고 실패가 조용해서 제거했고, 자동 트랜잭션 싱크는 충돌(다른 창의 선행 변경) 시 덮지 않고 멈춰 수동 저장으로 유도하며 실패를 토스트로 알린다. "동기화 중" 펄스(`remoteSync.hydrating`)는 **활성 프로필의 홈 필요분을 받는 동안** 켜진다 — 첫 하이드레이션(homeSynced 전)과 프로필 전환 직후(그 계정 콘텐츠 로드 중, `syncingAccountIds`) 둘 다. 실패 시 "연결 안 됨"을 표시한다(미저장 표시는 빌더 SyncButton만). 저장 직전 `?index=1`(행 목록·updatedAt)로 다른 창의 선행 변경을 감지해 덮어쓰기 확인을 받는다. 키는 **화면 필요 단위의 행**이다 (분해·조립은 `lib/accountRows.js`): `account:<id>`(셸 본문 — 프로필·탐색·시나리오 칩 메타, 홈 첫 화면에 필요한 전부)·`account:<id>:scenario:<sid>`(콘텐츠: stages·planCases — 칩 클릭 체험·빌더용)·`account:<id>:versions:<sid>`(발행 버전 스냅샷 — 빌더 전용)·`account:<id>:threads`·`accounts-meta`(순서만 — **활성 프로필 id는 기기별 상태라 동기화하지 않는다**)·`keywords`·`starters-meta`+`starter:<id>`(기본 시나리오 라이브러리 — 지정 시점 불변 스냅샷이라 기준선·충돌 기계 밖에서 즉시 쓰기(last-write-wins)로 미러링하고(`hooks/remote/starterSync.js`), push의 충돌 비교도 starter 행을 무시한다. 메타는 부트에 실려 오고 스냅샷 본문은 새 프로필 생성 직전에만 받는다). **하이드레이션은 부트 1왕복 + 필요 시점 로드**: `?boot=<계정id>` 한 왕복(행 목록+메타+키워드+활성 계정 셸)으로 홈을 그리고(bootReady — 업로드 허용 시점), 나머지 계정 셸과 활성 계정 콘텐츠·쓰레드는 백그라운드(homeSynced — "동기화 중" 배지 기준), **버전 스냅샷은 빌더 진입 시**(`ensureStudioSynced`), 다른 계정 콘텐츠는 프로필 전환 시(`ensureAccountSynced`)만 받는다. 칩 클릭·복제는 `ensureScenarioSynced`, 내보내기·전체 백업은 `ensureActiveSynced`/`ensureAllSynced`가 선행한다(App.jsx `openSynced` 게이트). 하이드레이션 사이에 손댄 데이터는 서버 값으로 덮지 않는다(쓰레드만 id 합집합 병합 — 추가형 로그라서). **계정 목록은 첫 접속 시 서버(DB)가 원천**: 부트 시점 로컬 캐시 계정 중 서버에 없는 것은 정리하고 토스트로 알린다(이 세션에서 만든 계정과 시딩 가드 세션은 제외) — 다른 기기에서 지운 프로필이 옛 캐시로 부활해 재업로드되는 것을 막는다. 대가로, 프로필 생성 직후 자동 싱크(1.2s 디바운스+전송)가 끝나기 전에 새로고침하면 그 프로필은 서버에 없어 정리된다. **업로드는 행 단위 게이트**: 이 세션에서 서버와 맞춘 행(loaded)과 서버에 없는 새 행만 전송하고(`rowsRef` 기준선 — 안 받은 행을 낡은 로컬로 덮지 않는다), 삭제는 명시적(이 세션에서 지운 계정 + 셸을 맞춘 계정의 사라진 시나리오 행)이다. 예외는 시딩 가드·전체 복원 세션(`localAuthorityRef` — 로컬이 전체 의도라 전 행 전송+서버 잔여 정리). 구 형식(통짜 `accounts` 블롭 → 1차 통짜 행(`threads` 인라인) → 2차 콘텐츠 본문(scenarios에 stages 인라인))은 하이드레이션이 만나는 대로 새 행 체계로 이관한다(부속 행 먼저 → 본문 행 마지막이 완료 표식, 끊겨도 재시도). **객체 참조가 곧 미저장 신호**다: `patchActive`·`updateScenario`·`useStageItems.write`가 무변경 업데이터(같은 참조 반환)를 스킵하는 사슬을 유지할 것 — 끊기면 빌더만 열어도 미저장 배지가 켜진다. 발행 버전 스냅샷은 시나리오 전체 사본 — `VERSION_LIMIT`(5)을 늘리지 말 것. **주의: 구 클라이언트(옛 빌드 배포본)로 "서버에 저장"을 누르면 구형 행을 재저장해 새 행 체계와 어긋날 수 있다** — 지금은 Pages도 push마다 자동 빌드라 상시 위험은 아니지만, 배포가 밀린 옛 창을 열어 두고 저장하는 경우는 여전히 해당된다.

## 아키텍처 (apps/studio/src)

- `App.jsx` — **앱 셸**: 라우팅과 토스트, 그리고 화면들이 쓰는 `api` 객체 조립. 시나리오 CRUD는 여기, 그 밖은 아래로 위임. **페이지형 화면은 해시 URL이 원천** — `#builder/<sid>`(빌더)·`#explore-editor`·`#tagging`·`#ops[/<탭>]`(운영 콘솔 — 탭 threads|pipeline|experiment까지 해시 딥링크, 탭 전환도 pushRoute라 새로고침·앞뒤로가기가 탭을 유지. 구 `#admin` 주소는 호환 별칭): 진입 함수는 pushState로 해시 엔트리를 만들며 직접 열고(생성 직후 상태 레이스 방지 — pushState는 hashchange 미발화), 주소 입력·앞/뒤로가기는 hashchange 핸들러 한 곳이 받는다(빌더는 ensureStudioSynced 게이트 후 열고 없는 시나리오면 홈 복귀). 이탈(goHome)은 해시 없는 pushState라 뒤로가기로 복귀 가능. player/live는 체험 1회의 일시 상태라 해시 없음, 공유 링크는 `#s=` 별도 모드
- `hooks/useWorkspace.js` — **계정(프로필별 워크스페이스) 상태의 원본**: 로컬 상태·patchActive(무변경 참조 스킵)·localStorage 자동 저장·프로필 관리·전체 백업. 서버 쪽에는 stateRef·세터만 내어 준다
- `hooks/remote/` — **서버 미러링 한 벌** (위 "서버 동기화" 항목의 구현): `useRemoteSync.js`(공유 ref·동기화 상태·업로드 흐름 배선 — 반환하는 `remoteSync` 한 벌을 useWorkspace가 그대로 노출), `rowAdoption.js`(서버 행 채택 — 행→메모리 병합+기준선), `onDemandSync.js`(필요 시점 로드 syncRow·ensure*), `hydration.js`(부트 1왕복+백그라운드+구형 이관 — 시딩 가드 포함), `push.js`(미저장 감지 accountDirty + 업로드 코어 pushCore — 행 단위 게이트·명시적 삭제·충돌 처리), `starterSync.js`(기본 시나리오 라이브러리 미러링 — 즉시 쓰기·설치 직전 스냅샷 로드)
- `lib/scenarioOps.js` — 시나리오 통째 복사(복제·가져오기·공유 채택)의 **id 재발급 규칙**. 아이템 id는 parentId·계획 조건 questionId·평가 기록 키 세 곳에서 참조되므로 한 곳에서 다시 매단다
- `lib/store.js` — 데이터 계층 **배럴**. 실제 구현은 `lib/store/` 네 모듈:
  - `store/model.js` 시나리오·아이템의 형태와 정규화(`normalizeItems` — 구 좌표 모델 → 순서 모델 이관 관문), STAGES/DEVICE_PRESETS/CHIP_COLORS
  - `store/planCases.js` 조건 형태와 평가 규칙. **폴백은 언제나 하나·목록의 끝**이라는 불변식을 강제
  - `store/defaults.js` 첫 실행 기본값(탐색 페이지·프로필·키워드)과 exploreItemsFrom/visibleProfileItems
  - `store/persistence.js` **localStorage를 아는 유일한 곳** + 계정(구 키 마이그레이션)·전체 백업·JSON 입출력 봉투(`ddak-export` + `classifyImportPayload` — 구형 파일 3종도 계속 인식)
- `lib/builder/` — 빌더가 쓰는 순수 로직: `geometry.js`(순서·슬롯·컨테이너 판정 — 모델 좌표가 아니라 렌더된 DOM rect 기준, 필요한 값을 전부 인자로 받는다. reorderTop/topInsertIndexAt/containerAtClient/placeChild 등), `itemClipboard.js`(사본 만들기), `publishing.js`(발행 점검·칩 라벨·버전 스냅샷 — 구 스냅샷은 복원 시점에 normalizeItems로 이관)
- `lib/share.js` — 공유 링크: 시나리오를 `#s=<base64url JSON>` 해시로 인코딩/디코딩 (서버 불필요)
- `lib/evaluation.js` — 평가 계층 **배럴**. 실제 구현은 `lib/evaluation/` 네 모듈:
  - `evaluation/model.js` 평가 레코드 **v2 스키마**(selection/review/components)와 정규화·v1 마이그레이션 관문, remapCaseEvaluation(id 재발급), liveComponentEntries(고아 레코드 필터), plainEvaluationText
  - `evaluation/recommend.js` 대표 케이스 추천 — 자동 점수(rankSignificantCases) + MMR 다양화 + 미평가 로테이션(recommendRotationCaseIds)
  - `evaluation/structure.js` 케이스 → 평가 단위(컴포넌트 인스턴스) 변환. 여기서 만드는 editableFields가 AI 왕복 허용 목록의 원천 (NON_LLM_EDITABLE_FIELDS)
  - `evaluation/stats.js` 선정 CASE A/B/C 진행률 집계 + 케이스 리더보드(evaluationLeaderboard)
- `lib/registry.jsx` — **컴포넌트 레지스트리 배럴 + 조립**. `{ label, stage, icon, defaults, fields[], render(props, ctx), canvasInteractive?, defaultW? }`. ctx.mode='canvas'|'player', ctx.player(실행 API), ctx.profile, ctx.updateProps(캔버스 내 편집), ctx.summaryPreview. 개별 정의는 `lib/registry/` 카테고리 모듈에 있다:
  - `registry/support.jsx` 공용 렌더 도구 — kText() 텍스트 렌더러(키워드+부분 서식+인라인 편집 진입), ScrollTrack(드래그 스크롤), Img/parseCards/isEditView 등
  - `registry/exploreComponents.jsx` · `surveyComponents.jsx` · `planComponents.jsx` · `commonComponents.jsx` · `layoutComponents.jsx` 단계·카테고리별 컴포넌트 정의
  - LIBRARY를 알아야 하는 renderItem/ChildShell/childrenOf/libraryForStage는 배럴(registry.jsx)에 남는다 — 순환 참조 방지
- `lib/liveApi.js` — **라이브 생성 체험 클라이언트** (BFF threads API, API.md §1): 디바이스 id(`ddak-device-id`)·쓰레드 시작·SSE 소비(fetch 스트림 — POST라 EventSource 불가)·행동 기록·이어보기. FE는 same-origin `/api/bff/*`만 부른다 (배포 = 루트 middleware.js, 로컬 = vite 프록시 → 8788)
- `lib/adminApi.js` · `lib/adminReport.jsx` · `components/AdminView.jsx` — **운영 콘솔** (API.md §1-1). 진입은 홈 드로어 도구 행의 🧵 버튼 또는 `#ops` 해시(구 `#admin` 호환 — 탭은 `#ops/<탭>` 딥링크, App.jsx 라우팅 참고), 별도 인증 없음 — 옛 `x-admin-token` 게이트(localStorage `ddak-admin-token`)는 뗐고 BFF admin API도 서비스 토큰 가드만 남았다. 쓰레드 전체 목록(archived 포함)·개별 라이프사이클 로그를 **마크다운 문서로 시각화**(adminReport가 ThreadWithSteps→마크다운 생성 + 같은 서브셋만 아는 미니 렌더러 — 복사 버튼이 원문을 그대로 쓰므로 둘을 같이 유지), **평가 모아보기**(`AdminFeedback.jsx` — BFF `/api/admin/feedback` 한 응답(제출 1회=항목 1개·최신순·같은 (쓰레드,단계) 최신 제출에 latest, 원천은 core `/internal/feedback-steps` — core는 payload 해석 없이 type 필터만)을 받아 요약 타일·별점 분포·쓰레드 총 점수 분포+리더보드(유효본 별점 전체의 쓰레드 평균 — 평가 스튜디오 리더보드와 같은 정렬 문법)·필터(단계/코멘트만/이전 제출 포함)·펼침 목록으로 렌더. 집계는 latest 항목만으로 FE가 계산), 쓰레드 상세의 **실제 렌더링 미리보기**(`AdminThreadPreview.jsx` — 상세 다이얼로그 토글 문서/설문 화면/계획 화면. 스텝 payload의 와이어 페이지를 livePage 투영+레지스트리 player 렌더러로 그대로 그림, answers/explore 스텝 값으로 잠금 렌더·읽기 전용 no-op player 스텁), 보관 처리(= core `status=archived`, 사용자 목록에서만 숨김), LLM 모델 조회·변경(카탈로그는 BFF `llm.service.ts` `MODEL_OPTIONS` 소유, 저장은 core 설정 KV `llm-model`, 생성 시 30s 캐시로 조회 — haiku처럼 effort 미지원 모델은 BFF가 effort를 빼고 호출), **시스템 프롬프트 조회·재정의**(카탈로그 3종(survey·plan-skeleton·plan-products)은 BFF `prompts.ts` `PROMPT_DEFS` 소유 — `{{CATALOG}}` 자리표시자는 호출 시점에 상품 카탈로그 목록으로 치환(`renderSystemTemplate`), 재정의는 core 설정 KV `llm-prompt-<id>`에 원문 저장·생성 시 30s 캐시 조회(`resolveSystem`), 기본값과 동일·공백 저장은 설정 삭제 = 기본값 복귀, 재정의로 생성된 스텝은 `llmMeta.promptVersion`에 `+custom` 접미. 프롬프트는 캐시 적중 위해 바이트 고정이 전제 — 재정의 저장값이 곧 시스템 프롬프트다). **페이지는 3탭 — 탭이 곧 해시**(`#ops`=쓰레드·평가, `#ops/pipeline`, `#ops/experiment`): "쓰레드·평가"(평가 모아보기+쓰레드 목록 — **상태 흐름 바**(체험 여정 탐색→설문→계획→완료 + 종착 이탈·보관을 칩 행으로, 칩 클릭 = 목록 필터)와 리더보드 평균 미터 바 포함, 상세 다이얼로그에 「평가 케이스로 저장」 승격 버튼), "파이프라인"(`PipelineStudio.jsx`), "실험"(`ExperimentStudio.jsx` — 골든 케이스(eval_cases) 실행·별점 채점(eval_runs, null=미채점) + 전환 판정 계기판(plan 스텝 llmMeta.engine 각인의 엔진별 지연·캐시 집계 — **엔진 비교 카드**: 지연 3종을 전 엔진 공통 축 가로 막대로, 캐시는 % 미터. 케이스 행에는 채점 추이 점(오래됨→최신), 실행 행에는 별점 표시)). 파이프라인 탭 = **흐름 다이어그램 히어로**(`PipelineFlow.jsx` — 전략 문서 0~7을 실행 토폴로지 0→1→2→3→⏸답변 대기→(5a ∥ 4·5b)→6→7로 렌더. 연결선은 평시에도 중립 대시가 천천히 흐르고(데이터 관 표현), dry-run 실행 중엔 해당 경로가 보라 대시로 빠르게 흐르며 실행 노드가 맥동, 결과 도착 시 노드에 ✓지연·검증 통과/드롭이 각인. 노드 클릭 = 상세 스트립(설명·effort·프롬프트 열람 진입), planned 점선·재정의 점 표식. 노드 높이 76px 고정 — 병렬 블록 분기·합류 세로선 오프셋이 이 값에 묶임. 헤더에 엔진 플래그(legacy|langgraph)와 현재 모델 표시) + **플레이그라운드**(LLM 단계 dry-run: 설문 실행→답변 칩 선택→뼈대/상품 실행 — 실행이 위 다이어그램에 그대로 비친다. 설문 미리보기는 dry-run 결과를 합성 thread로 만들어 `AdminThreadPreview` 재사용 — 답 고르면 잠금 렌더, 상품 결과는 검증 게이트 통과분+드롭 로그, 임시 프롬프트 what-if는 저장 없이 1회 적용. 실행 버튼은 진짜 생성이라 ✦) + 지식 소스 편집(KV 4종+블록리스트, `knowledge-*`·`guard-blocklist` — 비우면 설정 삭제) + 모델·프롬프트 카드. 스타일은 `styles/admin.css`(배럴 끝 @import)
- `lib/livePage.js` — 라이브 와이어 페이지 → 스튜디오 아이템 투영: question→surveyQuestion(아이템 id = 와이어 질문 id — answers 왕복에 재매핑 없음), guide→planStep(단계 번호는 투영이 자동 부여 — 뼈대 프롬프트가 안내를 2~3단계로 나눈다), products→hscroll+productCard(`imageUrl` 있으면 실제 썸네일 — 카탈로그는 검증된 지마켓 gdimg, 웹 상품은 BFF http(s) 검증 통과분. 없거나 로드 실패면 이모지 목업 폴백(registry ProductThumb). `mall` 있는 상품은 웹 검색으로 찾은 외부몰 상품이라 external+담기불가로, `url`은 상세보기 사이드 패널로 투영), contents→hscroll+videoCard/articleCard(참고 콘텐츠 — 웹 검색으로 확인한 게시글·영상, 카드 클릭 = 새 탭), steps→checklist. `livePlanItems(page, { pendingSlots })`의 pendingSlots(빈 자리 인덱스)는 레지스트리 밖 `livePending` 아이템으로 투영 — LivePlayer가 로딩 카드로 직접 그린다. 단계 안내(guide) 바로 뒤의 상품 섹션(자리 포함)은 `stepSub` 표식을 달아 LivePlayer가 그 단계의 하위 콘텐츠처럼 들여 배치한다(`sb-player__item--stepsub` — 뼈대 프롬프트가 상품 자리를 해당 단계 안내 바로 뒤에 두도록 지시). 새 렌더 계층을 만들지 않는다
- `lib/richtext.jsx` — 인라인 리치텍스트 엔진: `{{옵션|텍스트}}`/`[[키워드]]` 마크업 ↔ contentEditable 변환, 서식 적용/병합, InlineEditor, FONT_OPTIONS/TEXT_COLORS
- `lib/templates.js` — 새 시나리오 템플릿 (빈/뷰티 브리프/선물 추천)
- `lib/prompt/` — **AI 왕복 계층**. 스튜디오는 LLM API를 호출하지 않는다: 모든 AI 기능이 "프롬프트 복사 → 쓰던 AI에 붙여넣기 → 결과 가져오기" 한 가지 왕복이다
  - `chatPrompt.js` 채팅창용 출력 규칙 봉투(코드블록 하나·스키마 밖 키 금지·붙여넣을 위치) + 왕복 공용 유틸(`personaFromProfile` 프로필→페르소나 문장, `chunkList` 배치 분할)
  - `jsonAnswer.js` 붙여넣은 응답에서 JSON만 건져내기 — 모든 검증기가 공유
  - `scenarioDraft.js` 빠른 초안: 레이아웃은 코드 스캐폴드가 소유, AI는 텍스트·상품 배치만
  - `scenarioDb.js` 전체 구성: 레지스트리에서 컴포넌트 사양을 자동 추출해 DB JSON 전체를 요청하고, 가져오기 시 조건이 실제 질문 id·선택지를 가리키는지 검증
  - `planCases.js` 조합별 케이스: 설문 축 데카르트 곱, 골든 케이스 슬롯 추출(사실 필드 제외), 카탈로그 파싱, 프롬프트·검증·조립(id 재발급+parentId 재매핑)
  - `productSearch.js` 상품 리서치 프롬프트 + 결과 파싱(마크다운 표·번호·불릿 제거)·카탈로그 병합
  - `revision.js` 평가 피드백 → 필드 단위 수정안. 허용 목록(caseId·itemId·fieldKey) 밖은 전부 차단
  - `caseRevision.js` 케이스 **통째 재생성** (컴포넌트 추가·삭제·순서까지). 안전 모델이 다르다: 유지 컴포넌트는 id 보존(평가 기록이 id에 묶임)+원본 props에서 시작해 편집 가능 키만 덮음(사실 필드·팩 메타데이터 보존), 새 상품은 카탈로그 대조, 조건은 불변, 부분 적용 없음(전부/전무 + ⌘Z)
- `components/Builder.jsx` — **편집기 오케스트레이터**. 편집 상태만 갖고 규칙은 전부 아래로 위임한다
- `components/builder/hooks/` — `useStageItems`(아이템을 어디서 읽고 어디에 저장할지: 탐색/설문/계획), `useItemOps`(추가·수정·삭제·복제·순서 이동·클립보드 — 순서 변경은 전부 geometry.reorderTop 경유), `useBuilderHistory`(Undo 스택), `usePlanCases`(케이스 CRUD·평가), `useStackDrag`(최상위 순서 드래그 — 삽입 인덱스 미리보기 라인 + 컨테이너 삽입, 드롭 한 번으로 커밋), `useContainerNesting`(컨테이너 자식 넣기/꺼내기/슬롯 — 자식을 컨테이너 밖으로 끌면 최상위 순서 드래그로 전환), `useBuilderShortcuts`(키 매핑 — ↑↓ = 순서 한 칸 이동), `useTopBarActions`(시나리오 명령 — 기기 폭·발행·버전 복원·JSON 입출력·공유 링크), `useCanvasInteractions`(캔버스 표면 이벤트 — 우클릭·팔레트 DnD·줌), `useEvaluationBridge`(평가↔편집 이동 — feedbackTarget·인스펙터 포커스 신호, 상단 문맥 바는 `FeedbackFocusBar.jsx`)
- `components/builder/EvaluationPanel.jsx` — 평가 스튜디오 오케스트레이터 (말풍선 배치·케이스 탭·AI 진입점). 표현 컴포넌트는 `components/builder/evaluation/`: StarRating(+SCORE_GUIDE)/Rubric/Leaderboard/CommentBubble/PreviewBoundary
- `components/builder/BuilderTopBar.jsx` / `PlanCaseBar.jsx` / `BuilderCanvas.jsx` — 상태 없는 표현 컴포넌트
- `components/builder/PromptExchange.jsx` — "프롬프트 복사 → 결과 붙여넣기" UI 한 벌. 세 AI 다이얼로그가 공유
- `components/builder/LlmDialogShell.jsx` — AI 다이얼로그 공용 셸(백드롭 클릭 닫기·헤더·AiRoundTripNote 배지) + `DialogSteps`(진행 breadcrumb) + `BatchBar`(배치 진행 바). 여섯 AI 다이얼로그(시나리오/조합 케이스/문구 다듬기/재구성/전체 반영/AiFixChooser)가 공유
- `components/builder/CanvasItem.jsx` — 스택 위 최상위 아이템 한 개 (선택/순서 드래그/잠금/숨김, 우클릭 — 문서 흐름이라 좌표·리사이즈·높이 측정 없음)
- `components/builder/Palette.jsx` — 팔레트(검색·클릭 추가·캔버스로 드래그)/레이어 패널(잠금·숨김·순서)
- `components/builder/Inspector.jsx` — 속성 편집 / 필드 드래그 선택 서식 툴바 (크기 슬라이더는 컨테이너 자식 카드 전용). 목록형 필드(kind: options·stringList·cards·table)는 `ListEditors.jsx`의 행 단위 GUI 편집기로 위임 — 저장 형식은 기존 구분자 문자열 그대로, 줄바꿈 직렬화로 항목 안 쉼표 보존
- `components/builder/CanvasTextToolbar.jsx` — 캔버스 인라인 편집 중 선택 위에 뜨는 서식 툴바
- `components/ui/Dropdown.jsx` — 드롭다운 공용 래퍼 (버튼은 호출부, 메뉴/백드롭 담당)
- `components/Frame.jsx` — 공통 프레임 조각: BgBlobs, FloatingBar(하단, 햄버거=쓰레드 패널, 버튼 위치→패널 방향), ViewerDeviceControl(기기 폭), ProfileControl(프로필 전환/추가/삭제), StudioFab
- `components/ThreadPanel.jsx` — 쇼핑 쓰레드 히스토리 패널 (원본 history-sidebar 룩, 좌/우/중앙 등장, 아코디언 카드, 이어보기/삭제)
- `components/ProductDetailPanel.jsx` — 상품 상세보기 사이드 패널: productCard "상세보기"가 외부몰 상품 페이지를 iframe으로 연다 (데스크톱 = 우측 패널, 모바일 640px 이하 = 전체화면 — viewer.css). Player/LivePlayer가 `ctx.player.openProduct({name, mall, url})`로 열고, url 없으면 토스트 폴백. **iframe에는 모바일 PDP 원본 URL을 그대로 싣는다**(`frameFor` — 지마켓 goodsCode→`m.gmarket.co.kr/vi/product/{code}`, 올리브영 goodsNo→`m.oliveyoung.co.kr` 모바일 경로, 그 외 몰은 원본): 구 프록시(`api/pdp.js` — 모바일 UA 대리 수신+base 주입)는 스크립트·서브리소스가 깨져 실제로는 빈 화면이 대부분이라 2026-08 FE에서 뗐다(함수 파일은 옛 배포 호환으로 유지). 한계: 데스크톱 브라우저 iframe은 데스크톱 UA라 몰이 데스크톱 페이지로 되돌리며 차단할 수 있다(지마켓 item.gmarket X-Frame-Options — 올리브영은 데스크톱도 차단 없음). 그 경우 "새 탭에서 열기"(항상 원본 URL)와 하단 안내 폴백이 받는다. productCard의 `url`은 사실 필드라 AI 왕복 제외 목록(NON_LLM_EDITABLE 등)에 이미 포함돼 있다
- `components/StarterPanel.jsx` — 기본 시나리오 패널 (전역 라이브러리 목록·내리기 — 진입은 드로어 하단 도구 행의 ⭐ 버튼, 지정은 시나리오 행)
- `components/TaggingStudio.jsx` + `lib/taggingCatalog.js` — **상품 태깅 검토 스튜디오** (진입은 드로어 도구 행의 🏷️ 버튼): 라이브 생성의 상품 매칭 근거인 카탈로그 태그의 "AI 1차 분류 → 담당자는 애매한 항목만 점검" 화면. 3컬럼 — 좌: 작업 단위 목록(파생 상태 칩: 검토 완료/미검토/수정 필요/승인됨/반려됨 + 헤더 필터 알약)+상품 정보(상세 문구·리뷰 요약·카탈로그 원본 태그), 가운데: 필드별 태깅 편집(FIELD_DEFS 7필드 — 대분류/세부유형/부위/타입/고민/결과/조건, 사전 기반 칩 토글·복수 선택 시 대표 태그 ★·AI 확신도 바·선택 근거 접기·미검토 "확인 완료로 표시"·사전에 없는 값은 "태그 추가 요청", 대분류 변경 시 종속 사전(세부유형·타입) 자동 정리), 우: 태그 게이지(최소 3·최대 8)+최종 적용 태그+규칙 검증(필수·대표 미지정·허용 목록 밖·충돌 조합)+검토 메모+승인/반려(승인은 오류·미검토 잔여 시 차단, 필드 수정 시 결정 초기화). 상품 정체성은 `apps/bff/src/llm/catalog.ts`의 FE 사본(카탈로그 변경 시 같이 맞출 것), 필드 분류·확신도·근거는 데모 목데이터. 검토 상태는 localStorage(`ddak-tagging-review-v2`) 전용 — 계정 서버 동기화 기계 밖, JSON 내보내기로 이관. 스타일은 `styles/tagging.css`(배럴 끝 @import)
- `components/Player.jsx` — 시나리오 실행(설문→계획 스테퍼). 기기 폭 반영, hidden 아이템 제외, 다시 시작, 응답/프로필 제외 상태를 ctx.player로 공급, **쓰레드 자동 기록**(체험 1회 = 쓰레드 1개)
- `components/LivePlayer.jsx` — **라이브 생성 체험** (설문→계획을 BFF의 LLM이 실시간 생성). 진입은 홈 자유 검색(칩 = 시나리오 체험 — 매칭 겹치면 선택 시트로 명시 선택), `✦ AI 실시간 생성` 배지 상시, **토큰 단위 부분 스트리밍**(SSE head/question/section — 자라는 중인 컴포넌트가 같은 index로 반복 도착하고 **도착 즉시 렌더**한다(별도 타이핑 페이싱 없음 — 클로드 앱 방식). 부드러움은 kText `revealFade`의 글자 단위 마운트 페이드(`sb-live-ch`)가 담당: 글자마다 위치 고정 키 span이라 새 글자만 페이드인된다. + 진행 꼬리 스켈레톤. BFF stream-parse가 미완성 원소를 복구 파싱해 ~120ms 스로틀로 재전송, 상품·콘텐츠 섹션은 **항목 단위 증분**: 완성·그라운딩 통과한 항목만 실은 섹션이 `final:false`로 같은 index에 반복 전송되고(threads.service `completeSearchSection` — 복구 파싱된 조각에서 버퍼상 마지막 키 배열의 마지막 원소(잘렸을 수 있음)를 버리고 항목 스키마 개별 검증, 항목 목록은 언제나 최종본의 접두라 한 번 나간 카드는 사라지지 않는다), 섹션이 닫히면 `final:true`로 마감한다. **계획은 뼈대 조기 확정**: 뼈대(텍스트)가 끝나면 `skeleton` 이벤트가 완성 섹션+자리(pending 인덱스)를 보내고, FE는 즉시 확정 렌더로 전환(planKey·설문 잠금·평가 초기화)하며 자리는 로딩 카드로 둔다 — 웹 검색(상품+참고 콘텐츠)이 계획 렌더를 막지 않고 `section`이 자리를 비동기로 채운 뒤(첫 증분이 로딩 카드를 대체하고 카드가 한 장씩 붙는다) result가 마감한다. pending이 남은 동안 재생성 트리거는 막는다(저장 경합 방지) — 증분(final:false)으로 채워진 자리도 최종본 도착까지 pending 유지. **클라이언트 소유 컴포넌트는 선렌더**: 계획은 설문 요약 패널, 설문은 프로필 패널을 생성 시작 즉시 그리고, LLM 산출물인 제목/인트로는 도착 전까지 감춘다. `partial` 상태는 미리보기일 뿐 확정·기록은 언제나 result — planKey·설문 잠금도 result 시점), 실패는 정직한 안내(retryable 재시도 + 발행 칩 폴백은 사용자 클릭으로만 — 부분 도착분도 버린다), 답변 변경 시 계획은 자동 재생성하지 않고 안내 바의 버튼으로만. **이미 만든 계획은 어떤 단계 이동으로도 재생성하지 않는다**: 스테퍼는 항상 만든 계획을 그대로 열고, 재생성은 명시적 버튼(계획 stale 바·설문 하단 CTA)뿐. 계획 스냅샷 키(planKey)는 서버가 돌려준 answers 원문이 아니라 로컬 재구성과 같은 경로(`wireFromAnswers`)로 만든다 — 직렬화 차이로 무변경 답변이 "바뀜"으로 오판되면 이어보기 후 이동만 해도 LLM을 다시 부른다. **계획이 만들어진 설문은 잠긴다**(surveyQuestion locked, 선택된 답만 또렷): 해제는 "설문 다시 선택" 확인 다이얼로그를 거쳐서만, 새 계획이 생성되면 다시 잠긴다. 워크스페이스 쓰레드에 `live: true`로 upsert — ThreadPanel이 ✦ 배지로 구분하고 이어보기는 `GET /api/bff/threads/:id` 복원. 렌더는 livePage 투영 + 레지스트리 재사용. **피드백(평가)**: 헤드의 "💬 평가" 토글 → **평가 스튜디오와 같은 주석(annotation) 문법** — 페이지 오른쪽 레일에 LLM 산출 컴포넌트(설문 인트로·질문, 계획 요약·섹션)별 말풍선(`.sb-bubble` 재사용 — 점선 연결선·별점·앵커 활성 외곽선·피드백 점, `LiveFeedback.jsx`)을 앵커의 실제 렌더 높이로 배치(layoutFbBubbles — 매 렌더 동기+rAF 보정, 1100px 이하는 CSS가 일반 흐름 전환), 페이지 전체 말풍선(케이스 스타일)에 저장 버튼. "피드백 저장" 1회 = events `type=feedback` 제출 1회(append 로그 — 최신 제출이 유효본, API.md §1). 이어보기가 단계별 최신 피드백을 복원하고, 계획 재생성 시 로컬 계획 평가는 비운다(대상 소멸). 계획 단계 레일의 **"✦ 반영해 다시 생성"**은 미전송 피드백을 저장한 뒤 같은 payload를 `POST /:id/plan`의 `feedback`으로 실어 **피드백 반영 재생성**을 요청한다 — BFF가 직전 계획(plan 스텝)+피드백을 프롬프트 가변부에 실어(시스템 고정 — 캐시 유지, `prompts.ts` `PlanRevisionContext`) 지적된 상품을 빼고 웹 검색 대안으로 교체한다. 워크스페이스 쓰레드 기록에 `feedback` 마커(단계별 전체 별점)를 남겨 ThreadPanel이 "💬 설문 ★n · 계획 ★n" 배지와 "💬 평가한 쓰레드" 모아보기 필터를 제공한다. 관리 페이지 문서엔 별점·코멘트로 렌더
- `components/HomeView.jsx` — 홈. 발행 칩(색상/드래그 순서변경/클릭 실행), 좌상단 기기+프로필 컨트롤, 시나리오 드로어(템플릿·복제·**JSON 통합 입출력** — 내보내기는 범위 선택(시나리오 목록/전체 백업), 가져오기는 `classifyImportPayload` 자동 감지 후 동작별 확인 다이얼로그(추가/전체 교체). 빌더의 현재 시나리오 입출력은 별도), 쓰레드 패널
- `components/ExploreFrame.jsx` — 구버전 설정 기반 탐색 렌더러 (explore.items가 없을 때의 안전망 전용)
- `components/ExploreEditor.jsx` — 사용자 프로필 + 키워드 사전 편집기 (탐색 콘텐츠 편집은 빌더 "탐색" 탭으로 이동)
- `studio.css` — 스튜디오 전용 스타일 (`sb-` 접두사) + 원본 CSS 클래스의 절대배치 무력화 오버라이드. 실제 규칙은 `styles/` 11개 섹션 파일에 있고 studio.css는 @import 배럴 — **@import 순서가 곧 캐스케이드**라 파일 간 이동·순서 변경 금지, 새 규칙은 맞는 섹션 파일 끝에 추가

## 기능 현황 (2026-07 기준 — 상세는 FEATURES.md)

1. **프로필별 워크스페이스**: 계정 = 프로필+탐색 페이지+시나리오+쓰레드. 홈 좌상단 프로필 컨트롤로 전환/추가/삭제
2. **홈**: 발행 칩(클릭 실행·드래그 순서·색상), 검색 매칭, 검색창 말줄임/멀티라인 옵션
3. **쓰레드 히스토리**: 햄버거 → 원본 룩 패널(버튼 위치 방향에서 등장), 체험 자동 기록, 이어보기
4. **빌더**: 순서 기반 세로 스택(드래그 = 삽입 인덱스 재정렬, 컨테이너 위 드롭 = 안에 배치), 다중 선택(⇧/⌘A), 우클릭 메뉴, ⌘C/X/V(단계 간), 줌, 팔레트 드래그 배치, 인라인 WYSIWYG 편집+서식 툴바(볼드/폰트/크기/색/키워드 밑줄), Undo/Redo, 기기 프리셋(프레임 폭), 발행/버전 복원(versionAt으로 현재 사용 중 버전 표시), 현재 시나리오 JSON 파일 입출력(상단 JSON 메뉴), 공유 링크
5. **컴포넌트 15종** (+탐색 레거시 5종): 설문 3, 계획 8, 공통 4(텍스트/안내/가로 스크롤 패널/이미지)
6. **플레이어**: 설문→계획 스테퍼, 프로필 배지 제외, 설문 요약, 담기/완료, 쓰레드 기록, 상품 상세보기 사이드 패널(외부몰 iframe — 모바일 전체화면)
7. **공유**: URL 해시 링크(즉시 체험, 가져오기), JSON 백업/이관
8. **AI 기능** (전부 API 키 없이 프롬프트 왕복): 시나리오 만들기 / 조합 케이스(설문 조합별 일괄 생성) / **문구 다듬기**(필드 단위) / **페이지 재구성**(케이스 통째). 평가 탭 진입점은 `⇄ AI에게 수정 요청` 하나 — `AiFixChooser`가 문구 다듬기·페이지 재구성으로 갈라 주고, 문구 다듬기에서 처리 못 한 피드백은 재구성으로 이어진다(onSwitchToRevise). **평가 탭의 목적은 전파다**: 사람이 73개 케이스를 다 볼 수 없으니 라운드당 3개(CASE A/B/C)씩 평가하고, 그 피드백을 전체에 퍼뜨린다. **선정은 로테이션**: "다음 3개 선정"은 평가 흔적(별점·피드백)이 있는 케이스를 후보에서 빼고 미평가에서 뽑는다(`recommendRotationCaseIds`, 모자라면 평가된 케이스로 채움) — 이미 본 케이스를 다시 뽑으면 정보 이득이 없기 때문. 쌓인 평가는 **케이스 리더보드**(`evaluationLeaderboard`, 평균 별점 내림차순)에 남고, 이 순위가 전파 씨앗의 우선순위가 된다. 문구·톤은 `lib/prompt/propagation.js`("피드백 전체 반영": 씨앗 = 평가한 모든 케이스의 피드백+현재 값 — 리더보드 순 정렬, 다이얼로그에서 상위 N개 케이스로 제한 가능(caseLimit), 반영 완료(resolved)면 exemplarTrusted로 구분 전달 — 를 모범 예시 삼아 미평가 케이스를 배치 왕복. 대상은 씨앗 제한과 무관하게 평가 흔적 있는 케이스 전부 제외 — 사람 손을 탄 케이스를 배치 수정이 덮지 않는다. revision과 같은 허용 목록·before 대조·개별 선택 적용), 구조 변경은 "페이지 재구성으로 대표를 고침 → 조합 케이스 재생성의 **교체 모드**(같은 comboSignature의 기존 케이스 대체, applyGeneratedCases replace 옵션)"가 맡는다. **평가는 주석(annotation) 방식**: 왼쪽에 케이스 페이지를 실제 렌더하고 오른쪽 레일에 컴포넌트별 말풍선(별점+코멘트). 말풍선 top은 앵커(최상위 아이템)의 실제 렌더 높이로 배치하고 겹치면 아래로 민다 — 컨테이너 자식은 부모에 앵커. 배치는 매 렌더 동기 실행(rAF만 쓰면 연속 렌더에서 계속 취소돼 한 번도 실행 안 될 수 있음). 점수는 별점 UI지만 데이터는 기존 0~5 그대로: 별 1~5 클릭=점수, **같은 별 재클릭=별 다 끈 0점**, 옆 배지가 비(非)별 상태를 표시(미평가=회색·0점=빨강)하고 누르면 미평가로 초기화. 빈 별만으로는 0점과 미평가가 안 갈리므로 배지가 그 구분을 담당한다. **피드백 입력은 평가 페이지 한 곳**: 컴포넌트 말풍선 + 케이스 전체 말풍선(`evaluation.review.score`/`feedback`, nullable) — 케이스 코멘트는 재구성 요청에 지시로, 문구 다듬기에는 맥락(caseNote, 구조 요청 무시 규칙)으로 자동 포함된다. **평가 스키마는 v2**(`evaluation/model.js`): `selection`(작업 상태 — active/slot/round/at) · `review`(케이스 전체) · `components`(itemId 키) 3분리, 모든 평가 레코드에 `{round, at}`(선정 시각과 평가 시각 분리, round 0=구버전). v1 평면 스키마와 AI 가져오기의 `{selected, slot}`은 normalize 관문에서 자동 마이그레이션(criteria 폐기). **고아 레코드 규칙**: 판정(`caseHasEvaluationInput`)·리더보드 집계는 `liveComponentEntries`로 실제 아이템과 교차 검증한다 — 삭제·재구성으로 사라진 컴포넌트의 평가가 케이스를 로테이션에서 영구 제외시키거나 평균을 부풀리지 않게 (데이터는 지우지 않음 — 같은 id가 돌아오면 되살아난다)

## 디자인 시스템 (studio.css)

`:root`의 토큰이 스튜디오 UI의 유일한 값 출처다. 규칙 안에 색·반경·그림자를 직접 쓰지 말 것.

- **폰트**: 스튜디오 크롬은 메인(clean-home)과 동일한 스택(`--sb-font-sans`)을 직접 선언한다. **본문 웹폰트는 절대 로드하지 말 것** — 스택 1순위가 Pretendard지만 원본 프로토타입부터 로드 없이 시스템 폴백(맥 Apple SD Gothic Neo **Light 300**)으로 렌더돼 왔고, 그 얇은 시스템 폰트 룩이 DDAK 메인의 인상이다. Pretendard CDN을 추가하면 메인 페이지가 통째로 다르게 보인다(실제 사고 이력 있음). 리치텍스트 인라인 서식 폰트는 별개 토큰 `--sb-font`(FONT_OPTIONS 7종, Google Fonts 로드). 프롬프트·JSON 영역만 ui-monospace 예외
- **굵기**: 메인 밴드(본문 300 · 카드 제목 340~360 · 칩 500)에 맞춘 3단계만 — 본문 **300** / 강조 **400** / 강한 강조 **500**. 600 이상 금지. **함정**: 원본 CSS의 `.clean-home-page *`가 weight 300을 모든 요소에 *직격*하므로(상속 아님) 버튼에 준 굵기가 안쪽 span에서 300으로 풀린다 → 스튜디오 루트들 아래 `* { font-weight: inherit }`로 상속을 재정립해 두었다(제거 금지). strong/b/h1~h4 기본은 400. 예외는 리치텍스트 사용자 볼드(`.sb-rich-b`/`.sb-style-bold`, 700 유지)뿐
- **색**: 중립 11단계(`--sb-n-0`~`--sb-n-900`) + 텍스트 4단계(`--sb-ink`/`--sb-ink-2`/`--sb-muted`/`--sb-subtle`) + 면 3단계 + 역할색(`--sb-accent` 브랜드, `--sb-info` 평가·AI 왕복, `--sb-success`/`--sb-warn`/`--sb-danger`, `--sb-ai` AI 트리거)
- **--sb-qa-\*** 는 구 이름의 별칭일 뿐이다. 새 코드는 `--sb-info` 등을 쓸 것
- **라운드** `--sb-r-xs`~`--sb-r-2xl`/`--sb-r-pill`, **그림자** `--sb-shadow-sm`~`xl`, **타이포** `--sb-t-micro`(11px)~`--sb-t-title`(16px) 5단계 — 크롬 폰트 크기는 리터럴 대신 `--sb-t-*` 토큰만 사용(캔버스 콘텐츠 컴포넌트의 목업 크기만 리터럴 허용), **모션** `--sb-dur`/`--sb-ease`. 다이얼로그 본문 블록의 세로 리듬은 `margin: 12px 24px` 기준
- **라벨 언어**: 스튜디오 크롬에 영문 아이브로우("영어 타이틀 + 한글 서브타이틀" 스택 — 예: 옛 `SCORING RUBRIC`/`STEP 1`) 금지. 패널·섹션 제목은 한글만, 왕복 단계 번호는 "n단계 · 스튜디오에서" 형식. 예외: `CASE A/B/C` 같은 식별자와 원본 프로토타입 CSS 영역(`keyword-detail-card` 등)
- **포커스**: 개별 규칙에 `outline: none`을 쓰지 말 것. 전역 `[class^='sb-']:focus-visible` 규칙이 키보드 포커스 링을 담당한다
- **버튼**: `.sb-btn` + 성격(`--primary`/`--ghost`/`--danger`/`--ai`/`--open`) + 크기(`--small`/`--tiny`). hover·active·disabled는 기본 정의에만 있다. AI를 부르는 버튼은 전부 `--ai`
- **AI 왕복 표기 규칙**: AI 기능은 "누르면 만들어진다"고 약속하지 않는다. 트리거는 `✦`(생성)가 아니라 **`⇄`(왕복)** 를 쓰고 라벨에 "프롬프트"를 넣는다. 다이얼로그는 머리말에 `AiRoundTripNote`를 두고, `PromptExchange`가 1 복사 → 2 **스튜디오 밖에서** 붙여넣기 → 3 결과 가져오기를 항상 펼쳐 보인다. 번호는 이 왕복(`.sb-handoff`)에만 쓰고 다이얼로그 단계(`.sb-steps`)는 번호 없는 breadcrumb이다. 성격이 비슷한 AI 기능을 나란히 버튼으로 두지 말 것 — 진입점을 하나로 합치고 선택 카드(`AiFixChooser` 참고)에서 "무엇을 고치고 싶은지" 예시 문장으로 가른다. **`✦`(생성)는 라이브 생성 체험 전용이다** — 진짜로 눌러서 만들어지는 곳(LivePlayer 배지·선택 시트·쓰레드 라이브 배지)에만 쓰고, 시나리오 칩·스튜디오 왕복 기능에는 쓰지 않는다 (시나리오 칩의 옛 스파크는 이 이유로 뗐다)

## 핵심 설계 결정

- **탐색은 공통 페이지** (시나리오 소유 아님, 계정 소유). 칩 클릭 = 탐색 완료 → 플레이어는 설문부터 시작. **탐색 콘텐츠도 아이템 기반**: `explore.items[]`를 빌더의 "탐색" 탭에서 설문/계획처럼 스택 편집(자동 저장·즉시 홈 반영). 구버전 설정(greeting/stories 등)은 `exploreItemsFrom()`으로 최초 1회 아이템 변환. 발행 칩은 `scenarioChips` 컴포넌트 자리에 렌더
- **프로필/설문 요약 패널은 일반 컴포넌트** (`profilePanel`, `surveySummary`) — 고정 아님, 드래그로 순서 배치. 노출 항목은 인스펙터 칩 관리(`ChipManagers.jsx`)로 조절: profilePanel은 props.hidden(캔버스 배지 클릭과 동일)+계정 프로필 항목 편집(문구·추가·순서는 계정 공통), surveySummary는 props.hiddenProfile(라벨 매칭)·hiddenQuestions(질문 문구 매칭, 줄바꿈 직렬화). hidden 계열은 AI 제외 목록(NON_LLM_EDITABLE/FACT/NON_GENERATED) 포함
- **아이템 모델은 순서 기반 스택**: `{ id, type, props, hidden?, locked?, parentId?, slot?, w?, h? }` — **배열 순서 = 최상위 렌더 순서**, 좌표(x/y)와 최상위 크기(w/h)는 없다(전폭·자동 높이). w/h는 **컨테이너 자식 전용**(카드의 콘텐츠 크기 — 예: hscroll 상품 카드 232px). 이 모델은 BFF 와이어 형식(순서 있는 의미 목록)과 정합을 위해 좌표 자유 배치에서 전환한 것(2026-08). **구 좌표 데이터는 `normalizeItems`가 이관**: 최상위에 숫자 x/y가 보이면 y→x 순으로 재배열해 배열 순서로 굳히고 좌표 필드를 버린다(멱등). 이 관문을 지나는 경로 = localStorage 로드·서버 행 채택·가져오기·공유 링크·스타터 설치·버전 복원(`scenarioFromSnapshot`) — 스냅샷·서버 행 원본은 그대로 두고 읽을 때마다 이관되는 lazy 방식이라 별도 일괄 마이그레이션이 없다. 캔버스 드래그는 `useStackDrag`: 드래그 아이템은 제자리에서 흐려지고(삽입 라인이 위치 미리보기), 드롭 시 `reorderTop` 한 번으로 커밋. 판정은 전부 렌더된 DOM rect 기준(`geometry.js`)
- **컨테이너(레이아웃) 컴포넌트**: 가로/세로 스크롤·그리드·캐러셀은 `container: true` — 다른 컴포넌트를 자식으로 수용. 자식은 같은 스테이지 배열에 `parentId + slot`으로 저장(플랫 유지), 스택 순서는 최상위만 본다. 팔레트/캔버스 드래그를 컨테이너 중앙부(상/하 `NEST_EDGE_ZONE` 18px 밴드 제외)에 놓으면 중첩, 꺼내기는 인스펙터·레이어 패널·컨테이너 박스 밖으로 드래그. 삭제·복제·복사는 자식 연쇄. 레이아웃끼리 중첩 불가. 팔레트는 `category`(content/layout)로 그룹 표시. **기기 폭 전환은 프레임 폭만 바뀐다** — 최상위는 전폭이라 환산이 없고, 자식 카드 크기는 그대로 유지된다. 좁은 기기에서 넘치는 문제는 슬롯 CSS가 맡는다: 가로 스크롤(`hscroll`)은 카드 크기를 유지해 스크롤로 흡수하고, 교차 축(`vscroll`·`gridPanel`)과 `carousel`은 `max-width: 100%`로 눌러 담는다. **주의: 아이템 id 재발급 시 parentId 매핑 필수** (`lib/scenarioOps.js` 참고 — parentId·계획 조건 questionId·평가 기록 키 세 곳을 함께 다시 매단다)
- **원본 룩 유지**: `public/`에 원본 CSS(gmarket-advanced*.css) 복사본 + Tailwind CDN. 원본 클래스 그대로 재사용
- **프로필별 워크스페이스(계정)**: `ddak-accounts-v1`에 `{accounts[], activeId}` — 계정 = 프로필+탐색 페이지+시나리오+쓰레드 묶음. 프로필 전환은 홈 드로어. 구 단일 키(`ddak-scenarios-v1`, `ddak-explore-page-v1`, `ddak-profile-v1`, `ddak-threads-v1`)는 최초 1회 첫 계정으로 마이그레이션 (발행은 브라우저 로컬 한정)
- **컴포넌트 텍스트는 kText()로 렌더**: 인스펙터 서식 툴바가 모든 텍스트 필드에 `{{서식|텍스트}}` 마크업을 넣을 수 있으므로, 레지스트리에서 사용자 노출 텍스트 prop은 반드시 `kText(p.x, ctx, 'x')`로 감쌀 것 (안 그러면 마크업 원문이 그대로 노출됨)

## 주의사항

- 원본 CSS가 `header` 태그를 전역 숨김 → 스튜디오 UI에 `<header>` 쓰지 말 것
- pointerup 커밋은 `setTimeout(0)`으로 미룸 (React 렌더 중 setState 경고 방지)
- 드로어의 발행 버튼 텍스트 매칭 시 "발행 취소"와 "발행하기" 구분 필요
- 히스토리 스냅샷은 `{stages, planCases, device, exploreItems}` JSON (Builder가 `useBuilderHistory`에 주입) — 시나리오 필드 추가 시 undo 포함 여부 검토
- 아이템 목록을 바꾸는 함수는 항상 **업데이터 함수**를 넘길 것. 드래그 커밋이 `setTimeout`으로 미뤄지므로 값으로 덮으면 낡은 클로저가 최신 상태를 지운다
- 최상위 순서를 바꾸는 모든 경로는 `geometry.reorderTop()`을 통과시킬 것 — index는 "이동 아이템을 뺀 나머지" 기준이고, 자식은 배열 끝으로 통과한다
- 아이템에 x/y/w/h를 새로 넣지 말 것 (최상위 기준). 좌표가 들어가면 `normalizeItems`가 구형 데이터로 판정해 재정렬한다 — 자식 카드 크기만 w/h 허용
- 캔버스 줌은 `transform: scale`이 아니라 CSS `zoom` — 문서 흐름 스택이라 확대·축소가 레이아웃 크기(스크롤 범위)에 반영돼야 한다
