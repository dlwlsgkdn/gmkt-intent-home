# DDAK Scenario Studio — 프로젝트 가이드

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

- `App.jsx` — 라우팅(home/builder/player/explore-editor + 공유 링크 모드), 시나리오/탐색/프로필 상태 + localStorage 저장, 시나리오 CRUD·복제·순서변경·가져오기/내보내기 API
- `lib/store.js` — 데이터 모델·localStorage. STAGES(설문→계획), DEVICE_PRESETS(기기 폭), CHIP_COLORS, DEFAULT_EXPLORE(공통 탐색 페이지), DEFAULT_PROFILE(고정 설문 정보)
- `lib/layout.js` — **레이아웃 엔진** (순수 함수): resolveCollision(겹침 해소, 다중 이동+잠금 지원), layoutStack/TwoColumns/CompactUp, alignItems(다중 정렬), PAD/GAP 상수
- `lib/share.js` — 공유 링크: 시나리오를 `#s=<base64url JSON>` 해시로 인코딩/디코딩 (서버 불필요)
- `lib/registry.jsx` — **컴포넌트 레지스트리** (팔레트의 모든 컴포넌트). `{ label, stage, icon, defaults, fields[], render(props, ctx), canvasInteractive? }`. ctx.mode='canvas'|'player', ctx.player(실행 API), ctx.profile, ctx.updateProps(캔버스 내 편집), ctx.summaryPreview
- `lib/templates.js` — 새 시나리오 템플릿 (빈/뷰티 브리프/선물 추천)
- `components/Builder.jsx` — 편집기 오케스트레이터 (상태/드래그/히스토리/발행). Undo/Redo(500ms 병합), 스마트 스냅, 다중 선택(⇧클릭·⌘A·그룹 드래그·정렬 도구), 기기 프리셋, 발행 버전 스냅샷·복원, 공유 링크 복사
- `components/builder/CanvasItem.jsx` — 캔버스 아이템 (드래그/리사이즈/잠금/숨김)
- `components/builder/Palette.jsx` — 팔레트(검색)/레이어 패널(잠금·숨김·순서)
- `components/builder/Inspector.jsx` — 속성 편집 / 다중 선택 정렬 도구
- `components/ui/Dropdown.jsx` — 상단 바 드롭다운 공용 래퍼
- `components/Player.jsx` — 시나리오 실행(설문→계획 스테퍼). 기기 폭 반영, hidden 아이템 제외, 다시 시작, 응답/프로필 제외 상태를 ctx.player로 공급
- `components/HomeView.jsx` — 홈. 발행 칩(색상/드래그 순서변경/클릭 실행), 시나리오 드로어(템플릿·복제·JSON 입출력)
- `components/ExploreFrame.jsx` — 공통 탐색(홈) 렌더러 (홈과 편집기가 공유)
- `components/ExploreEditor.jsx` — 공통 탐색 페이지 + 사용자 프로필 편집기 (라이브 미리보기)
- `studio.css` — 스튜디오 전용 스타일 (`sb-` 접두사) + 원본 CSS 클래스의 절대배치 무력화 오버라이드

## 핵심 설계 결정

- **탐색은 공통 페이지** (시나리오 소유 아님). 칩 클릭 = 탐색 완료 → 플레이어는 설문부터 시작
- **프로필/설문 요약 패널은 일반 컴포넌트** (`profilePanel`, `surveySummary`) — 고정 아님, 드래그 배치. 노출 항목은 컴포넌트 props.hidden (캔버스에서 배지 클릭으로 토글)
- **겹침 해소**: `resolveCollision(items, movedIds[], heights)` — 이동한 아이템은 고정, 겹치는 다른 아이템이 아래로 밀림. 드래그 중 실시간 적용
- **아이템 모델**: `{ id, type, x, y, w, h(null=자동), props }`, 높이는 ResizeObserver로 heightsRef에 측정
- **원본 룩 유지**: `public/`에 원본 CSS(gmarket-advanced*.css) 복사본 + Tailwind CDN. 원본 클래스 그대로 재사용
- **localStorage 키**: `ddak-scenarios-v1`, `ddak-explore-page-v1`, `ddak-profile-v1` (발행은 브라우저 로컬 한정)

## 주의사항

- 원본 CSS가 `header` 태그를 전역 숨김 → 스튜디오 UI에 `<header>` 쓰지 말 것
- pointerup 커밋은 `setTimeout(0)`으로 미룸 (React 렌더 중 setState 경고 방지)
- 드로어의 발행 버튼 텍스트 매칭 시 "발행 취소"와 "발행하기" 구분 필요
- 히스토리 스냅샷은 `{stages, device}` JSON — 시나리오 필드 추가 시 undo 포함 여부 검토
