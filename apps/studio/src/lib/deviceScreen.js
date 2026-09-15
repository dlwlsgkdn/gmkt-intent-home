/*
 * 기기 프레임의 "화면" 접근 — components/DeviceFrame.jsx 가 실행 화면(홈·설문·계획·SRP)을 실제 스마트폰
 * 껍데기 안에 그린 뒤로, 화면 안에서 뜨는 fixed 요소(시트·검색 화면·쓰레드 패널·플로팅 버튼)와 스크롤은
 * 브라우저 창이 아니라 그 화면 상자를 기준으로 잡아야 한다.
 *
 *  - 화면 상자(#sb-device-screen)는 `contain: paint` 로 fixed 자손의 컨테이닝 블록이 된다 — 그래서 body 포털이던
 *    시트·검색 화면은 이 상자로 포털하면 CSS(position: fixed; inset: 0) 를 안 고치고도 화면 안에 갇힌다.
 *  - 스크롤은 화면 안쪽 .sb-device__scroll 이 맡는다(창은 안 움직인다). 플레인 모드(평가 모드·좁은 창·기기 프레임
 *    없음)에선 예전처럼 창 스크롤이다 — 아래 헬퍼가 두 경우를 가른다.
 */
export const SCREEN_ID = 'sb-device-screen'

export function screenEl() {
  return typeof document === 'undefined' ? null : document.getElementById(SCREEN_ID)
}

/* 포털 대상 — 기기 프레임이 떠 있으면 그 화면, 아니면 body (스튜디오 캔버스·관리 페이지 등) */
export function overlayRoot() {
  return screenEl() || document.body
}

function framedScroller() {
  const screen = screenEl()
  if (!screen || !screen.closest('.sb-stage.is-framed')) return null
  return screen.querySelector(':scope > .sb-device__scroll')
}

/* 실행 화면 스크롤 — 프레임 안이면 화면 스크롤러, 아니면 창 */
export function scrollScreenTo(y = 0) {
  const scroller = framedScroller()
  if (scroller) scroller.scrollTo(0, y)
  else window.scrollTo(0, y)
}

export function screenScrollY() {
  const scroller = framedScroller()
  return scroller ? scroller.scrollTop : window.scrollY
}

/* 플레인 모드에서 창 위에 고정된 실행 화면 크롬(단계 스테퍼)이 덮는 높이 — 앵커 스크롤이 요소를 그 밑으로 내린다 */
function plainTopInset() {
  const stepper = document.querySelector('.sb-player-stepper')
  return stepper ? Math.max(0, stepper.getBoundingClientRect().bottom) : 0
}

/* 실행 화면 스택의 아이템 래퍼 찾기 — Player·LivePlayer 가 최상위 아이템마다 `data-item-id` 를 단다(담은 상품 시트의
   파트 → 계획 단계 앵커, 2026-09). id 에 어떤 문자가 와도 되게 선택자 대신 dataset 을 대조한다 */
export function itemEl(root, id) {
  if (!root || !id) return null
  return Array.from(root.querySelectorAll('[data-item-id]')).find((el) => el.dataset.itemId === id) || null
}

/* 실행 화면 안의 요소로 앵커 스크롤 — 프레임 안이면 화면 스크롤러, 아니면 창 기준. rect 는 시각 좌표라 창이 기기보다
   작아 프레임이 통째 축소된 상태(--dev-fit transform)면 레이아웃 px 로 되돌린다. 위 여백은 프레임 안에선 상태 바
   (세이프 톱 = 스크롤러 padding-top) 밑으로 요소가 숨지 않게 세이프 톱 + margin, 플레인 모드에선 창 고정 스테퍼 아래로.
   요소가 없으면 false — 호출자가 기억한 위치·맨 위 스크롤로 되돌아간다.
   **재발행 규칙**: 스택이 통째로 바뀐 커밋의 효과(설문 → 계획 전환)에서 낸 smooth 스크롤은 Chromium 이 뒤따르는 레이아웃
   갱신에서 조용히 버린다 — scrollTo 는 불렸고 스크롤 가능한 상태인데 scroll 이벤트가 한 번도 안 온다(2026-09 계측). 그래서
   두 프레임 뒤 한 픽셀도 안 움직였으면 현재 rect 로 다시 계산해 한 번 더 낸다(움직이기 시작했거나 이미 목표면 그대로) */
export function scrollScreenToEl(el, { margin = 12, behavior = 'smooth' } = {}) {
  if (!el) return false
  const run = () => {
    const rect = el.getBoundingClientRect()
    const scroller = framedScroller()
    if (scroller) {
      const box = scroller.getBoundingClientRect()
      const scale = scroller.offsetHeight ? box.height / scroller.offsetHeight : 1
      const safeTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0
      const top = Math.max(0, scroller.scrollTop + (rect.top - box.top) / scale - safeTop - margin)
      scroller.scrollTo({ top, behavior })
      return { top, current: () => scroller.scrollTop }
    }
    const top = Math.max(0, window.scrollY + rect.top - plainTopInset() - margin)
    window.scrollTo({ top, behavior })
    return { top, current: () => window.scrollY }
  }
  const first = run()
  const before = first.current()
  let retries = 0
  const verify = () => {
    const now = first.current()
    if (Math.abs(now - before) >= 1 || Math.abs(now - first.top) <= 1) return // 움직이기 시작했거나 이미 도착
    run()
    if (++retries < 2) setTimeout(verify, 150)
  }
  requestAnimationFrame(() => requestAnimationFrame(verify))
  return true
}
