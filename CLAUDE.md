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

- **배포**: GitHub Pages가 main 브랜치를 서빙. `https://dlwlsgkdn.github.io/gmkt-intent-home/docs/` (Settings→Pages를 main+/docs로 바꾸면 루트가 됨)
- **빌드/배포 절차**: `npm run build` (docs/ 갱신) → `git add -A && git commit` → 사용자가 `git push origin main` (Claude는 키체인 접근 불가로 푸시 못 함)

## 명령어 (중요: Node 경로)

기본 node는 v12라 빌드 불가. **반드시 nvm의 v24 사용**:
```bash
export PATH=/Users/jinhalee/.nvm/versions/node/v24.5.0/bin:$PATH
cd scenario-studio && npm run build   # vite build && cp -R ../legacy ../docs/legacy
```
개발 서버: `.claude/launch.json`의 `scenario-studio` (포트 5173), 정적 검증용 `pages-static` (포트 8899, 저장소 루트 서빙).

## 아키텍처 (scenario-studio/src)

- `App.jsx` — 라우팅(home/builder/player/explore-editor + 공유 링크 모드), **계정(프로필별 워크스페이스) 상태** + localStorage 저장. 활성 계정에서 scenarios/explore/profile/threads를 파생하고, 시나리오 CRUD·복제·순서변경·가져오기/내보내기·계정 전환/추가/삭제·쓰레드 기록 API 제공
- `lib/store.js` — 데이터 모델·localStorage. STAGES(설문→계획), DEVICE_PRESETS(기기 폭), CHIP_COLORS, DEFAULT_EXPLORE/PROFILE, **createAccount/loadAccounts/saveAccounts**(계정, 구 키 마이그레이션 포함), 쓰레드 저장, visibleProfileItems(프로필 노출 계산)
- `lib/layout.js` — **레이아웃 엔진** (순수 함수): resolveCollision(겹침 해소, 다중 이동+잠금 지원), compactItems(COMPACT_TYPES: vertical/horizontal/none — 핀·잠금 제외 스택), layoutStack/TwoColumns/CompactUp, alignItems(다중 정렬), PAD/GAP 상수
- `lib/share.js` — 공유 링크: 시나리오를 `#s=<base64url JSON>` 해시로 인코딩/디코딩 (서버 불필요)
- `lib/registry.jsx` — **컴포넌트 레지스트리** (팔레트의 모든 컴포넌트). `{ label, stage, icon, defaults, fields[], render(props, ctx), canvasInteractive?, defaultW? }`. ctx.mode='canvas'|'player', ctx.player(실행 API), ctx.profile, ctx.updateProps(캔버스 내 편집), ctx.summaryPreview. kText() 텍스트 렌더러(키워드+부분 서식+인라인 편집 진입)
- `lib/richtext.jsx` — 인라인 리치텍스트 엔진: `{{옵션|텍스트}}`/`[[키워드]]` 마크업 ↔ contentEditable 변환, 서식 적용/병합, InlineEditor, FONT_OPTIONS/TEXT_COLORS
- `lib/templates.js` — 새 시나리오 템플릿 (빈/뷰티 브리프/선물 추천)
- `components/Builder.jsx` — 편집기 오케스트레이터 (상태/드래그/히스토리/발행). Undo/Redo(500ms 병합), 스마트 스냅, 다중 선택(⇧클릭·⌘A·러버밴드·그룹 드래그·정렬 도구), ⌘C/X/V 클립보드(단계 간), 캔버스 줌(⌘+/-/0), 우클릭 컨텍스트 메뉴, 팔레트 드래그 배치, 기기 프리셋, 발행 버전 스냅샷·복원, 공유 링크 복사
- `components/builder/CanvasItem.jsx` — 캔버스 아이템 (드래그/리사이즈/잠금/숨김, zoom 좌표 보정, 우클릭)
- `components/builder/Palette.jsx` — 팔레트(검색·클릭 추가·캔버스로 드래그)/레이어 패널(잠금·숨김·순서)
- `components/builder/Inspector.jsx` — 속성 편집 / 필드 드래그 선택 서식 툴바 / 다중 선택 정렬 도구
- `components/builder/CanvasTextToolbar.jsx` — 캔버스 인라인 편집 중 선택 위에 뜨는 서식 툴바
- `components/ui/Dropdown.jsx` — 드롭다운 공용 래퍼 (버튼은 호출부, 메뉴/백드롭 담당)
- `components/Frame.jsx` — 공통 프레임 조각: BgBlobs, FloatingBar(하단, 햄버거=쓰레드 패널, 버튼 위치→패널 방향), ViewerDeviceControl(기기 폭), ProfileControl(프로필 전환/추가/삭제), StudioFab
- `components/ThreadPanel.jsx` — 쇼핑 쓰레드 히스토리 패널 (원본 history-sidebar 룩, 좌/우/중앙 등장, 아코디언 카드, 이어보기/삭제)
- `components/Player.jsx` — 시나리오 실행(설문→계획 스테퍼). 기기 폭 반영, hidden 아이템 제외, 다시 시작, 응답/프로필 제외 상태를 ctx.player로 공급, **쓰레드 자동 기록**(체험 1회 = 쓰레드 1개)
- `components/HomeView.jsx` — 홈. 발행 칩(색상/드래그 순서변경/클릭 실행), 좌상단 기기+프로필 컨트롤, 시나리오 드로어(템플릿·복제·JSON 입출력), 쓰레드 패널
- `components/ExploreFrame.jsx` — 구버전 설정 기반 탐색 렌더러 (explore.items가 없을 때의 안전망 전용)
- `components/ExploreEditor.jsx` — 사용자 프로필 + 키워드 사전 편집기 (탐색 콘텐츠 편집은 빌더 "탐색" 탭으로 이동)
- `studio.css` — 스튜디오 전용 스타일 (`sb-` 접두사) + 원본 CSS 클래스의 절대배치 무력화 오버라이드

## 기능 현황 (2026-07 기준 — 상세는 FEATURES.md)

1. **프로필별 워크스페이스**: 계정 = 프로필+탐색 페이지+시나리오+쓰레드. 홈 좌상단 프로필 컨트롤로 전환/추가/삭제
2. **홈**: 발행 칩(클릭 실행·드래그 순서·색상), 검색 매칭, 검색창 말줄임/멀티라인 옵션
3. **쓰레드 히스토리**: 햄버거 → 원본 룩 패널(버튼 위치 방향에서 등장), 체험 자동 기록, 이어보기
4. **빌더**: 자유 배치+겹침 회피+스냅, 다중 선택(⇧/⌘A/러버밴드), 우클릭 메뉴, ⌘C/X/V(단계 간), 줌, 팔레트 드래그 배치, 인라인 WYSIWYG 편집+서식 툴바(볼드/폰트/크기/색/키워드 밑줄), Undo/Redo, 기기 프리셋, 자동 정렬, 발행/버전 복원, 공유 링크
5. **컴포넌트 15종** (+탐색 레거시 5종): 설문 3, 계획 8, 공통 4(텍스트/안내/가로 스크롤 패널/이미지)
6. **플레이어**: 설문→계획 스테퍼, 프로필 배지 제외, 설문 요약, 담기/완료, 쓰레드 기록
7. **공유**: URL 해시 링크(즉시 체험, 가져오기), JSON 백업/이관

## 핵심 설계 결정

- **탐색은 공통 페이지** (시나리오 소유 아님, 계정 소유). 칩 클릭 = 탐색 완료 → 플레이어는 설문부터 시작. **탐색 콘텐츠도 아이템 기반**: `explore.items[]`를 빌더의 "탐색" 탭에서 설문/계획처럼 캔버스 편집(자동 저장·즉시 홈 반영). 구버전 설정(greeting/stories 등)은 `exploreItemsFrom()`으로 최초 1회 아이템 변환. 발행 칩은 `scenarioChips` 컴포넌트 자리에 렌더
- **프로필/설문 요약 패널은 일반 컴포넌트** (`profilePanel`, `surveySummary`) — 고정 아님, 드래그 배치. 노출 항목은 컴포넌트 props.hidden (캔버스에서 배지 클릭으로 토글)
- **겹침 해소 + 컴팩트**: `resolveCollision(items, movedIds[], heights, soft?)` — 이동한 아이템은 고정, 겹치는 다른 아이템이 아래로 밀림. 드래그 미리보기는 **지속시간 게이트** — 겹치자마자 반응하지 않고, 겹침 45%(`DRAG_SOFT_RATIO`/`CONTAINER_SOFT_RATIO`) 이상이 지속시간(일반 250ms `DRAG_PUSH_DELAY_MS` / 컨테이너 400ms `CONTAINER_PUSH_DELAY_MS`)을 채운 아이템만 밀림, 그 외는 전부 제자리 고정(핀). 조건이 깨지면 타이머 리셋. 재배치 기준 위치는 250ms 스로틀(`DRAG_PREVIEW_MS`). 커밋(`settle`)은 soft 없이 정확 해소. **컨테이너 삽입↔회피는 구역으로 분리**(트리뷰 drop-into/between 패턴): 세로 중앙부 = 삽입 존(포인터가 있으면 "안에 배치"+밀림 보호), 상/하 `NEST_EDGE_ZONE`(18px) 밴드 = 밀어내기 존(깊은 겹침 지속 시 컨테이너가 비켜남). **히스테리시스**: 한 번 밀린 아이템은 겹침 15%(`PUSH_EXIT_RATIO`) 아래로 떨어질 때까지 밀림 유지(삽입 존 보호 무시) — 밀려나 있는 컨테이너는 삽입 대상에서도 제외되어 비워진 자리는 순수 빈자리로 배치된다. **미리보기 해소는 `previewResolve`**(layout.js): 게이트 통과 아이템만 드래그 박스에서 밀리고, 밀린 아이템이 덮친 아이템은 연쇄로 함께 밀려 자리를 만든다. 잠긴 아이템을 넘어야만 자리가 나면 밀지 않고 제자리 유지(blockedIds) → 그 상태로 드롭하면 커밋 없이 드래그가 원위치 복귀(토스트). 게이트가 열려 밀림이 시작되면 나머지 아이템도 컴팩트에 함께 참여(연쇄 스택 이동 — 먼 아이템이 중간을 건너뛰어 순간이동하지 않음), 아무도 안 밀렸으면 전원 핀 고정. 드롭 커밋은 마지막 미리보기 레이아웃(`previewLayoutRef`)을 기준으로 적용해 미리보기 = 드롭 결과(WYSIWYG). 회피가 발동하지 않은 겹침 상태로 드롭하면(미리보기에서 미해소 겹침) 커밋하지 않고 드래그가 원위치 복귀(토스트) — 컨테이너 삽입 존 드롭은 예외(정상 삽입). 시나리오별 `compact`('vertical' 기본 | 'horizontal' | 'none')에 따라 모든 배치 커밋 후 `compactItems`로 스택(빌더의 `settle()` 경유, 드래그 중엔 드래그 아이템만 핀 고정). 구버전 `gravity: false`는 'none'으로 해석
- **아이템 모델**: `{ id, type, x, y, w, h(null=자동), props }`, 높이는 ResizeObserver로 heightsRef에 측정
- **컨테이너(레이아웃) 컴포넌트**: 가로/세로 스크롤·그리드·캐러셀은 `container: true` — 다른 컴포넌트를 자식으로 수용. 자식은 같은 스테이지 배열에 `parentId + slot`으로 저장(플랫 유지), 캔버스 절대배치·레이아웃 연산은 최상위만(빌더 `withTopOnly`). 팔레트/캔버스 드래그를 컨테이너 위에 놓으면 중첩, 꺼내기는 인스펙터·레이어 패널. 삭제·복제·복사는 자식 연쇄. 레이아웃끼리 중첩 불가. 팔레트는 `category`(content/layout)로 그룹 표시. **주의: 아이템 id 재발급 시 parentId 매핑 필수** (App.copyScenario 참고)
- **원본 룩 유지**: `public/`에 원본 CSS(gmarket-advanced*.css) 복사본 + Tailwind CDN. 원본 클래스 그대로 재사용
- **프로필별 워크스페이스(계정)**: `ddak-accounts-v1`에 `{accounts[], activeId}` — 계정 = 프로필+탐색 페이지+시나리오+쓰레드 묶음. 프로필 전환은 홈 드로어. 구 단일 키(`ddak-scenarios-v1`, `ddak-explore-page-v1`, `ddak-profile-v1`, `ddak-threads-v1`)는 최초 1회 첫 계정으로 마이그레이션 (발행은 브라우저 로컬 한정)
- **컴포넌트 텍스트는 kText()로 렌더**: 인스펙터 서식 툴바가 모든 텍스트 필드에 `{{서식|텍스트}}` 마크업을 넣을 수 있으므로, 레지스트리에서 사용자 노출 텍스트 prop은 반드시 `kText(p.x, ctx, 'x')`로 감쌀 것 (안 그러면 마크업 원문이 그대로 노출됨)

## 주의사항

- 원본 CSS가 `header` 태그를 전역 숨김 → 스튜디오 UI에 `<header>` 쓰지 말 것
- pointerup 커밋은 `setTimeout(0)`으로 미룸 (React 렌더 중 setState 경고 방지)
- 드로어의 발행 버튼 텍스트 매칭 시 "발행 취소"와 "발행하기" 구분 필요
- 히스토리 스냅샷은 `{stages, device}` JSON — 시나리오 필드 추가 시 undo 포함 여부 검토
