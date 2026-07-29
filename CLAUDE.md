# DDAK Scenario Studio — 프로젝트 가이드

> 전체 기능 명세는 [FEATURES.md](FEATURES.md) 참고.

지마켓 뷰티 AI 쇼핑 컨셉의 **시나리오 목업 제작·발행 도구**. 사용자가 "설문→계획" 플로우 시나리오를 노코드로 편집·발행하면 홈 검색창 밑에 칩으로 노출되고, 칩 클릭으로 실제처럼 체험할 수 있다.

## 저장소 구조

```
scenario-studio/   ← 소스 (React 18 + Vite 5)
legacy/            ← 옛 HTML 프로토타입 원본 (gmarket-advanced* 등, 이동만 했고 삭제 안 함)
docs/              ← 빌드 산출물 = 배포 사이트 (빌드 시 legacy/도 docs/legacy로 복사됨)
index.html         ← ./docs/ 리다이렉트
```

- **배포 (주)**: Vercel `ddak-scenario-studio`가 GitHub main 푸시마다 **원격 빌드·배포**. `https://ddak-scenario-studio.vercel.app` — vercel.json이 루트(API 의존성)+scenario-studio를 설치하고 scenario-studio를 빌드해 outputDirectory `docs`를 서빙한다. API(`api/state.js`)도 같은 프로젝트라, **로컬 Node 없이 소스 푸시만으로 배포된다**
- **배포 (레거시)**: GitHub Pages가 커밋된 docs/를 서빙. `https://dlwlsgkdn.github.io/gmkt-intent-home/docs/` — 로컬 빌드로 docs/를 커밋할 때만 갱신된다 (자동 아님)
- **빌드/배포 절차**: 소스 커밋 → 사용자가 `git push origin main` (Claude는 푸시 못 함) → Vercel 자동 빌드. GitHub Pages까지 최신으로 맞추려면 로컬 `npm run build`(docs/ 갱신) 후 커밋

## 명령어 (중요: Node 경로)

기본 node는 v12라 빌드 불가. **반드시 nvm의 v24 사용**:
```bash
export PATH=/Users/jinhalee/.nvm/versions/node/v24.5.0/bin:$PATH
cd scenario-studio && npm run build   # vite build && cp -R ../legacy ../docs/legacy
```
개발 서버: `.claude/launch.json`의 `scenario-studio` (포트 5173), 정적 검증용 `pages-static` (포트 8899, 저장소 루트 서빙).

**데이터 프로필** (`lib/remote.js`): 개발 서버 = `local`(localStorage 전용, 서버 동기화 없음), 빌드 산출물 = `prod`(localStorage + Neon DB 미러링). 로컬에서 운영 DB에 붙으려면 `VITE_DATA_PROFILE=prod npm run dev`. 콘솔 `[remote] 데이터 프로필:` 로그로 확인. 서버 미러링을 운영 DB 없이 검증하려면 목 API(+`VITE_API_PROXY`)를 쓰는 `scenario-studio-mockdb`(포트 5174) 참고.

**서버 동기화는 자동 다운로드 + 수동 업로드(빌더) + 트랜잭션 자동 싱크(스튜디오 밖)** (`api/state.js` + `hooks/useWorkspace.js` + `components/SyncButton.jsx`): 접속 시 서버로 하이드레이션하고, 빌더의 연속 편집은 "서버에 저장"으로 올린다 — 빌더 상단바는 SyncButton, 홈은 프로필 드롭다운 상단의 상태 행(점+라벨+저장 버튼, 느낌표 클릭 시 안내 펼침)이 유일한 표시 자리다. 스튜디오 밖 단발 쓰기 트랜잭션(프로필 생성·삭제, 시나리오 생성·복제·가져오기·삭제·칩 순서, 쓰레드 기록·삭제, 전체 복원, 공유 링크 가져오기 — 프로필 전환은 쓰기가 아니라 제외)은 `requestAutoSync()`가 1.2s 디바운스 뒤 자동 업로드한다 — 전체 자동 미러링은 여러 창이 서로를 덮고 실패가 조용해서 제거했고, 자동 트랜잭션 싱크는 충돌(다른 창의 선행 변경) 시 덮지 않고 멈춰 수동 저장으로 유도하며 실패를 토스트로 알린다. 하이드레이션 중에는 홈 프로필 버튼·드롭다운과 SyncButton이 "동기화 중" 펄스(`remoteSync.hydrating`)를, 실패 시 "연결 안 됨"을, 미저장이면 프로필 버튼에 주황 점을 표시한다. 저장 직전 `?index=1`(행 목록·updatedAt)로 다른 창의 선행 변경을 감지해 덮어쓰기 확인을 받는다. 키는 계정 행 단위 `account:<id>`·`accounts-meta`(순서·활성 id)·`keywords` — 통짜 `accounts` 블롭은 Vercel 함수 본문 한도(4.5MB)에 닿아 프로필 추가 같은 큰 저장이 조용히 413으로 거부됐던 구 형식으로, 하이드레이션이 최초 1회 행으로 마이그레이션(행→메타→블롭 삭제 순서, 중간에 끊겨도 재시도)한다. 저장은 참조 비교로 바뀐 계정 행만 전송, 삭제는 `data: null` PUT. **계정 객체 참조가 곧 미저장 신호**다: `patchActive`·`updateScenario`·`useStageItems.write`가 무변경 업데이터(같은 참조 반환)를 스킵하는 사슬을 유지할 것 — 끊기면 빌더만 열어도 미저장 배지가 켜진다. 발행 버전 스냅샷은 시나리오 전체 사본이라 페이로드 한도의 주범 — `VERSION_LIMIT`(5)을 늘리지 말 것.

## 아키텍처 (scenario-studio/src)

- `App.jsx` — **앱 셸**: 라우팅(home/builder/player/explore-editor + 공유 링크 모드)과 토스트, 그리고 화면들이 쓰는 `api` 객체 조립. 시나리오 CRUD는 여기, 그 밖은 아래로 위임
- `hooks/useWorkspace.js` — **계정(프로필별 워크스페이스) 상태와 저장**: localStorage + 서버 미러링(계정 행 단위 — 위 "서버 미러링" 항목). 서버 하이드레이션 가드 2개(가져오기 실패 시 미러링 중단 / 기본값 시드가 사용자 데이터를 덮지 않게)와 구 통짜 블롭 마이그레이션이 여기 있다
- `lib/scenarioOps.js` — 시나리오 통째 복사(복제·가져오기·공유 채택)의 **id 재발급 규칙**. 아이템 id는 parentId·계획 조건 questionId·평가 기록 키 세 곳에서 참조되므로 한 곳에서 다시 매단다
- `lib/store.js` — 데이터 계층 **배럴**. 실제 구현은 `lib/store/` 네 모듈:
  - `store/model.js` 시나리오·아이템의 형태와 정규화, STAGES/DEVICE_PRESETS/CHIP_COLORS
  - `store/planCases.js` 조건 형태와 평가 규칙. **폴백은 언제나 하나·목록의 끝**이라는 불변식을 강제
  - `store/defaults.js` 첫 실행 기본값(탐색 페이지·프로필·키워드)과 exploreItemsFrom/visibleProfileItems
  - `store/persistence.js` **localStorage를 아는 유일한 곳** + 계정(구 키 마이그레이션)·전체 백업
- `lib/layout.js` — **레이아웃 엔진** (순수 함수): resolveCollision(겹침 해소, 다중 이동+잠금 지원), previewResolve(드래그 미리보기), compactItems(COMPACT_TYPES: vertical/horizontal/none — 핀·잠금 제외 스택), layoutStack/TwoColumns/CompactUp, alignItems(다중 정렬), PAD/GAP 상수
- `lib/builder/` — 빌더가 쓰는 순수 로직: `geometry.js`(좌표·슬롯·컨테이너 판정 — 필요한 값을 전부 인자로 받는다), `layoutOps.js`(겹침 해소·컴팩트 **커밋 관문 settle**), `itemClipboard.js`(사본 만들기), `publishing.js`(발행 점검·칩 라벨·버전 스냅샷·기기 폭 환산)
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
- `lib/richtext.jsx` — 인라인 리치텍스트 엔진: `{{옵션|텍스트}}`/`[[키워드]]` 마크업 ↔ contentEditable 변환, 서식 적용/병합, InlineEditor, FONT_OPTIONS/TEXT_COLORS
- `lib/templates.js` — 새 시나리오 템플릿 (빈/뷰티 브리프/선물 추천)
- `lib/prompt/` — **AI 왕복 계층**. 스튜디오는 LLM API를 호출하지 않는다: 모든 AI 기능이 "프롬프트 복사 → 쓰던 AI에 붙여넣기 → 결과 가져오기" 한 가지 왕복이다
  - `chatPrompt.js` 채팅창용 출력 규칙 봉투(코드블록 하나·스키마 밖 키 금지·붙여넣을 위치)
  - `jsonAnswer.js` 붙여넣은 응답에서 JSON만 건져내기 — 모든 검증기가 공유
  - `scenarioDraft.js` 빠른 초안: 레이아웃은 코드 스캐폴드가 소유, AI는 텍스트·상품 배치만
  - `scenarioDb.js` 전체 구성: 레지스트리에서 컴포넌트 사양을 자동 추출해 DB JSON 전체를 요청하고, 가져오기 시 조건이 실제 질문 id·선택지를 가리키는지 검증
  - `planCases.js` 조합별 케이스: 설문 축 데카르트 곱, 골든 케이스 슬롯 추출(사실 필드 제외), 카탈로그 파싱, 프롬프트·검증·조립(id 재발급+parentId 재매핑)
  - `productSearch.js` 상품 리서치 프롬프트 + 결과 파싱(마크다운 표·번호·불릿 제거)·카탈로그 병합
  - `revision.js` 평가 피드백 → 필드 단위 수정안. 허용 목록(caseId·itemId·fieldKey) 밖은 전부 차단
  - `caseRevision.js` 케이스 **통째 재생성** (컴포넌트 추가·삭제·순서까지). 안전 모델이 다르다: 유지 컴포넌트는 id 보존(평가 기록이 id에 묶임)+원본 props에서 시작해 편집 가능 키만 덮음(사실 필드·팩 메타데이터 보존), 새 상품은 카탈로그 대조, 조건은 불변, 부분 적용 없음(전부/전무 + ⌘Z)
- `components/Builder.jsx` — **편집기 오케스트레이터**. 편집 상태만 갖고 규칙은 전부 아래로 위임한다
- `components/builder/hooks/` — `useStageItems`(아이템을 어디서 읽고 어디에 저장할지: 탐색/설문/계획), `useItemOps`(추가·수정·삭제·복제·클립보드 — 배치 커밋은 전부 layout.settle/compact 경유), `useBuilderHistory`(Undo 스택), `usePlanCases`(케이스 CRUD·평가), `useCanvasDrag`(밀림 게이트·히스테리시스·삽입 존 보호·WYSIWYG 커밋), `useContainerNesting`(컨테이너 자식 넣기/꺼내기/슬롯), `useBuilderShortcuts`(키 매핑)
- `components/builder/EvaluationPanel.jsx` — 평가 스튜디오 오케스트레이터 (말풍선 배치·케이스 탭·AI 진입점). 표현 컴포넌트는 `components/builder/evaluation/`: StarRating(+SCORE_GUIDE)/Rubric/Leaderboard/CommentBubble/PreviewBoundary
- `components/builder/BuilderTopBar.jsx` / `PlanCaseBar.jsx` / `BuilderCanvas.jsx` — 상태 없는 표현 컴포넌트
- `components/builder/PromptExchange.jsx` — "프롬프트 복사 → 결과 붙여넣기" UI 한 벌. 세 AI 다이얼로그가 공유
- `components/builder/CanvasItem.jsx` — 캔버스 아이템 (드래그/리사이즈/잠금/숨김, zoom 좌표 보정, 우클릭)
- `components/builder/Palette.jsx` — 팔레트(검색·클릭 추가·캔버스로 드래그)/레이어 패널(잠금·숨김·순서)
- `components/builder/Inspector.jsx` — 속성 편집 / 필드 드래그 선택 서식 툴바 / 다중 선택 정렬 도구. 목록형 필드(kind: options·stringList·cards·table)는 `ListEditors.jsx`의 행 단위 GUI 편집기로 위임 — 저장 형식은 기존 구분자 문자열 그대로, 줄바꿈 직렬화로 항목 안 쉼표 보존
- `components/builder/CanvasTextToolbar.jsx` — 캔버스 인라인 편집 중 선택 위에 뜨는 서식 툴바
- `components/ui/Dropdown.jsx` — 드롭다운 공용 래퍼 (버튼은 호출부, 메뉴/백드롭 담당)
- `components/Frame.jsx` — 공통 프레임 조각: BgBlobs, FloatingBar(하단, 햄버거=쓰레드 패널, 버튼 위치→패널 방향), ViewerDeviceControl(기기 폭), ProfileControl(프로필 전환/추가/삭제), StudioFab
- `components/ThreadPanel.jsx` — 쇼핑 쓰레드 히스토리 패널 (원본 history-sidebar 룩, 좌/우/중앙 등장, 아코디언 카드, 이어보기/삭제)
- `components/Player.jsx` — 시나리오 실행(설문→계획 스테퍼). 기기 폭 반영, hidden 아이템 제외, 다시 시작, 응답/프로필 제외 상태를 ctx.player로 공급, **쓰레드 자동 기록**(체험 1회 = 쓰레드 1개)
- `components/HomeView.jsx` — 홈. 발행 칩(색상/드래그 순서변경/클릭 실행), 좌상단 기기+프로필 컨트롤, 시나리오 드로어(템플릿·복제·JSON 입출력·전체 백업), 쓰레드 패널
- `components/ExploreFrame.jsx` — 구버전 설정 기반 탐색 렌더러 (explore.items가 없을 때의 안전망 전용)
- `components/ExploreEditor.jsx` — 사용자 프로필 + 키워드 사전 편집기 (탐색 콘텐츠 편집은 빌더 "탐색" 탭으로 이동)
- `studio.css` — 스튜디오 전용 스타일 (`sb-` 접두사) + 원본 CSS 클래스의 절대배치 무력화 오버라이드

## 기능 현황 (2026-07 기준 — 상세는 FEATURES.md)

1. **프로필별 워크스페이스**: 계정 = 프로필+탐색 페이지+시나리오+쓰레드. 홈 좌상단 프로필 컨트롤로 전환/추가/삭제
2. **홈**: 발행 칩(클릭 실행·드래그 순서·색상), 검색 매칭, 검색창 말줄임/멀티라인 옵션
3. **쓰레드 히스토리**: 햄버거 → 원본 룩 패널(버튼 위치 방향에서 등장), 체험 자동 기록, 이어보기
4. **빌더**: 자유 배치+겹침 회피+스냅, 다중 선택(⇧/⌘A/러버밴드), 우클릭 메뉴, ⌘C/X/V(단계 간), 줌, 팔레트 드래그 배치, 인라인 WYSIWYG 편집+서식 툴바(볼드/폰트/크기/색/키워드 밑줄), Undo/Redo, 기기 프리셋, 자동 정렬, 발행/버전 복원(versionAt으로 현재 사용 중 버전 표시), 현재 시나리오 JSON 파일 입출력(상단 JSON 메뉴), 공유 링크
5. **컴포넌트 15종** (+탐색 레거시 5종): 설문 3, 계획 8, 공통 4(텍스트/안내/가로 스크롤 패널/이미지)
6. **플레이어**: 설문→계획 스테퍼, 프로필 배지 제외, 설문 요약, 담기/완료, 쓰레드 기록
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
- **AI 왕복 표기 규칙**: AI 기능은 "누르면 만들어진다"고 약속하지 않는다. 트리거는 `✦`(생성)가 아니라 **`⇄`(왕복)** 를 쓰고 라벨에 "프롬프트"를 넣는다. 다이얼로그는 머리말에 `AiRoundTripNote`를 두고, `PromptExchange`가 1 복사 → 2 **스튜디오 밖에서** 붙여넣기 → 3 결과 가져오기를 항상 펼쳐 보인다. 번호는 이 왕복(`.sb-handoff`)에만 쓰고 다이얼로그 단계(`.sb-steps`)는 번호 없는 breadcrumb이다. 성격이 비슷한 AI 기능을 나란히 버튼으로 두지 말 것 — 진입점을 하나로 합치고 선택 카드(`AiFixChooser` 참고)에서 "무엇을 고치고 싶은지" 예시 문장으로 가른다

## 핵심 설계 결정

- **탐색은 공통 페이지** (시나리오 소유 아님, 계정 소유). 칩 클릭 = 탐색 완료 → 플레이어는 설문부터 시작. **탐색 콘텐츠도 아이템 기반**: `explore.items[]`를 빌더의 "탐색" 탭에서 설문/계획처럼 캔버스 편집(자동 저장·즉시 홈 반영). 구버전 설정(greeting/stories 등)은 `exploreItemsFrom()`으로 최초 1회 아이템 변환. 발행 칩은 `scenarioChips` 컴포넌트 자리에 렌더
- **프로필/설문 요약 패널은 일반 컴포넌트** (`profilePanel`, `surveySummary`) — 고정 아님, 드래그 배치. 노출 항목은 인스펙터 칩 관리(`ChipManagers.jsx`)로 조절: profilePanel은 props.hidden(캔버스 배지 클릭과 동일)+계정 프로필 항목 편집(문구·추가·순서는 계정 공통), surveySummary는 props.hiddenProfile(라벨 매칭)·hiddenQuestions(질문 문구 매칭, 줄바꿈 직렬화). hidden 계열은 AI 제외 목록(NON_LLM_EDITABLE/FACT/NON_GENERATED) 포함
- **겹침 해소 + 컴팩트**: `resolveCollision(items, movedIds[], heights, soft?)` — 이동한 아이템은 고정, 겹치는 다른 아이템이 아래로 밀림. 드래그 미리보기는 **지속시간 게이트** — 겹치자마자 반응하지 않고, 겹침 45%(`DRAG_SOFT_RATIO`/`CONTAINER_SOFT_RATIO`) 이상이 지속시간(일반 250ms `DRAG_PUSH_DELAY_MS` / 컨테이너 400ms `CONTAINER_PUSH_DELAY_MS`)을 채운 아이템만 밀림, 그 외는 전부 제자리 고정(핀). 조건이 깨지면 타이머 리셋. 재배치 기준 위치는 250ms 스로틀(`DRAG_PREVIEW_MS`). 커밋(`settle`)은 soft 없이 정확 해소. **컨테이너 삽입↔회피는 구역으로 분리**(트리뷰 drop-into/between 패턴): 세로 중앙부 = 삽입 존(포인터가 있으면 "안에 배치"+밀림 보호), 상/하 `NEST_EDGE_ZONE`(18px) 밴드 = 밀어내기 존(깊은 겹침 지속 시 컨테이너가 비켜남). **히스테리시스**: 한 번 밀린 아이템은 겹침 15%(`PUSH_EXIT_RATIO`) 아래로 떨어질 때까지 밀림 유지(삽입 존 보호 무시) — 밀려나 있는 컨테이너는 삽입 대상에서도 제외되어 비워진 자리는 순수 빈자리로 배치된다. **미리보기 해소는 `previewResolve`**(layout.js): 게이트 통과 아이템만 드래그 박스에서 밀리고, 밀린 아이템이 덮친 아이템은 연쇄로 함께 밀려 자리를 만든다. 잠긴 아이템을 넘어야만 자리가 나면 밀지 않고 제자리 유지(blockedIds) → 그 상태로 드롭하면 커밋 없이 드래그가 원위치 복귀(토스트). 게이트가 열려 밀림이 시작되면 나머지 아이템도 컴팩트에 함께 참여(연쇄 스택 이동 — 먼 아이템이 중간을 건너뛰어 순간이동하지 않음), 아무도 안 밀렸으면 전원 핀 고정. 드롭 커밋은 마지막 미리보기 레이아웃(`previewLayoutRef`)을 기준으로 적용해 미리보기 = 드롭 결과(WYSIWYG). 회피가 발동하지 않은 겹침 상태로 드롭하면(미리보기에서 미해소 겹침) 커밋하지 않고 드래그가 원위치 복귀(토스트) — 컨테이너 삽입 존 드롭은 예외(정상 삽입). 시나리오별 `compact`('vertical' 기본 | 'horizontal' | 'none')에 따라 모든 배치 커밋 후 `compactItems`로 스택(빌더의 `settle()` 경유, 드래그 중엔 드래그 아이템만 핀 고정). 구버전 `gravity: false`는 'none'으로 해석
- **아이템 모델**: `{ id, type, x, y, w, h(null=자동), props }`, 높이는 ResizeObserver로 heightsRef에 측정
- **컨테이너(레이아웃) 컴포넌트**: 가로/세로 스크롤·그리드·캐러셀은 `container: true` — 다른 컴포넌트를 자식으로 수용. 자식은 같은 스테이지 배열에 `parentId + slot`으로 저장(플랫 유지), 캔버스 절대배치·레이아웃 연산은 최상위만(빌더 `withTopOnly`). 팔레트/캔버스 드래그를 컨테이너 위에 놓으면 중첩, 꺼내기는 인스펙터·레이어 패널. 삭제·복제·복사는 자식 연쇄. 레이아웃끼리 중첩 불가. 팔레트는 `category`(content/layout)로 그룹 표시. **기기 폭 전환은 최상위만 비례 환산하고 자식 폭은 건드리지 않는다**(`rescaleForDevice`) — 자식 폭은 캔버스가 아니라 컨테이너 안에서의 콘텐츠 크기이고, 자식엔 maxItemW 클램프가 안 걸려 비율 환산이 왕복마다 증폭된다. 좁은 기기에서 넘치는 문제는 슬롯 CSS가 맡는다: 가로 스크롤(`hscroll`)은 카드 크기를 유지해 스크롤로 흡수하고, 교차 축(`vscroll`·`gridPanel`)과 `carousel`은 `max-width: 100%`로 눌러 담는다. **주의: 아이템 id 재발급 시 parentId 매핑 필수** (`lib/scenarioOps.js` 참고 — parentId·계획 조건 questionId·평가 기록 키 세 곳을 함께 다시 매단다)
- **원본 룩 유지**: `public/`에 원본 CSS(gmarket-advanced*.css) 복사본 + Tailwind CDN. 원본 클래스 그대로 재사용
- **프로필별 워크스페이스(계정)**: `ddak-accounts-v1`에 `{accounts[], activeId}` — 계정 = 프로필+탐색 페이지+시나리오+쓰레드 묶음. 프로필 전환은 홈 드로어. 구 단일 키(`ddak-scenarios-v1`, `ddak-explore-page-v1`, `ddak-profile-v1`, `ddak-threads-v1`)는 최초 1회 첫 계정으로 마이그레이션 (발행은 브라우저 로컬 한정)
- **컴포넌트 텍스트는 kText()로 렌더**: 인스펙터 서식 툴바가 모든 텍스트 필드에 `{{서식|텍스트}}` 마크업을 넣을 수 있으므로, 레지스트리에서 사용자 노출 텍스트 prop은 반드시 `kText(p.x, ctx, 'x')`로 감쌀 것 (안 그러면 마크업 원문이 그대로 노출됨)

## 주의사항

- 원본 CSS가 `header` 태그를 전역 숨김 → 스튜디오 UI에 `<header>` 쓰지 말 것
- pointerup 커밋은 `setTimeout(0)`으로 미룸 (React 렌더 중 setState 경고 방지)
- 드로어의 발행 버튼 텍스트 매칭 시 "발행 취소"와 "발행하기" 구분 필요
- 히스토리 스냅샷은 `{stages, planCases, device, exploreItems}` JSON (Builder가 `useBuilderHistory`에 주입) — 시나리오 필드 추가 시 undo 포함 여부 검토
- 아이템 목록을 바꾸는 함수는 항상 **업데이터 함수**를 넘길 것. 드래그/보정 커밋이 `setTimeout`으로 미뤄지므로 값으로 덮으면 낡은 클로저가 최신 상태를 지운다
- 배치를 커밋하는 모든 경로는 `layoutOps.settle()`을 통과시킬 것 (겹침 해소 + 컴팩트가 한 곳에 있다)
- **레이아웃 함수에 아이템 목록을 통째로 넘기지 말 것.** `layout.js`의 함수들(`compactItems`/`layoutCompactUp`/`resolveCollision`)은 받은 목록을 전부 캔버스 아이템으로 취급하므로, 컨테이너 자식이 섞이면 자식에 좌표를 부여하고 그 유령 블록이 최상위 아이템을 아래로 밀어낸다(캔버스 상단에 수백 px 빈 띠). 반드시 `layout.withTopOnly(prev, (top) => ...)`로 감쌀 것
- `CanvasItem`의 ResizeObserver는 아이템당 한 번만 만들고 콜백은 ref로 갱신한다. 콜백을 그대로 붙잡으면 `previewMode`·컴팩트 방향이 첫 렌더 값에 얼어붙는다
