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
