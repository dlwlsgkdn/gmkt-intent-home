import React, { useEffect, useLayoutEffect, useState } from 'react'
import { SCREEN_ID } from '../lib/deviceScreen.js'

/*
 * 기기 프레임 — 실행 화면(홈·설문·계획·검색 결과)을 실제 스마트폰 껍데기 안에 그린다 (2026-09).
 *
 *  - 화면은 DEVICE_PRESETS 의 실기기 CSS 뷰포트(w×h) 그대로다. 너비만 맞추던 옛 세로 무한 컬럼과 달리 높이도
 *    기기 크기라, 화면 안 스크롤(.sb-device__scroll)이 진짜 기기처럼 안에서 돈다 — 브라우저 창은 안 움직인다.
 *  - 껍데기 종류(FRAME_SPECS)는 프리셋의 frame 이 고른다: 다이나믹 아일랜드·홈 버튼·펀치홀·각진 울트라·폴드·
 *    태블릿·브라우저 창. 그림은 전부 CSS(styles/device.css) — 이미지 자산 없이 어떤 배율에서도 또렷하다.
 *  - 화면 상자(#sb-device-screen)는 `contain: paint` 로 fixed 자손의 컨테이닝 블록이 된다. 그래서 플로팅 버튼·쓰레드
 *    패널·상품 상세 패널은 CSS 를 안 바꾸고 화면 안에 붙고, body 포털이던 시트·검색 화면은 lib/deviceScreen.js
 *    overlayRoot() 로 이 상자에 포털한다. 화면 안에는 DDAK 요소만 있다 — 기기 선택·프로필·스튜디오 버튼·스테퍼
 *    같은 스튜디오 크롬은 이 컴포넌트 밖(브라우저 창 고정)에 둔다.
 *  - 상태 바(시각·신호·배터리)·컷아웃·홈 인디케이터는 기기 층(pointer-events: none)이라 DDAK 콘텐츠 위에 얹히기만
 *    한다. 콘텐츠는 --sb-safe-top/--sb-safe-bottom 만큼 안쪽에서 시작한다(실기기 세이프 에어리어).
 *  - 창이 기기보다 작으면 transform 으로 통째 축소한다(--dev-fit, 확대는 안 함). 레이아웃 px 는 그대로라
 *    컨테이너 쿼리·컴포넌트 크기는 실기기와 같다.
 *  - plain(평가 모드처럼 말풍선 레일과 나란히 봐야 하는 화면)이거나 창 자체가 폰(640px 이하)이면 껍데기를 벗고
 *    예전 평면 흐름으로 돌아간다 — DOM 은 같고 CSS 만 바뀌어 콘텐츠가 다시 마운트되지 않는다.
 */

/* 껍데기 규격 — 화면(w×h)은 프리셋, 나머지는 여기. bezel = 유리 안 화면 둘레(위·좌우·아래), band = 금속 테두리 두께,
   bodyR/screenR = 몸체·화면 모서리, safeTop/Bottom = 상태 바·홈 인디케이터가 차지하는 콘텐츠 여백,
   cutout = 화면 안 컷아웃(island|punch|none), cam/speaker/homebtn = 베젤(유리)에 그리는 부속 */
export const FRAME_SPECS = {
  'iphone-island': { bezel: { top: 12, x: 12, bottom: 12 }, band: 3, bodyR: 58, screenR: 46, safeTop: 54, safeBottom: 28, cutout: 'island', homebar: 'ios', buttons: 'iphone', status: 'ios' },
  'iphone-home': { bezel: { top: 64, x: 12, bottom: 64 }, band: 3, bodyR: 44, screenR: 0, safeTop: 20, safeBottom: 0, cutout: 'none', cam: true, speaker: true, homebtn: true, buttons: 'iphone-se', status: 'ios-classic' },
  android: { bezel: { top: 10, x: 9, bottom: 12 }, band: 2, bodyR: 38, screenR: 28, safeTop: 36, safeBottom: 20, cutout: 'punch', homebar: 'android', buttons: 'android', status: 'android' },
  'android-ultra': { bezel: { top: 10, x: 8, bottom: 12 }, band: 2, bodyR: 14, screenR: 8, safeTop: 36, safeBottom: 20, cutout: 'punch', homebar: 'android', buttons: 'android', status: 'android' },
  fold: { bezel: { top: 10, x: 10, bottom: 10 }, band: 2, bodyR: 18, screenR: 10, safeTop: 34, safeBottom: 20, cutout: 'none', crease: true, homebar: 'android', buttons: 'android', status: 'android' },
  tablet: { bezel: { top: 24, x: 24, bottom: 24 }, band: 3, bodyR: 34, screenR: 16, safeTop: 24, safeBottom: 20, cutout: 'none', cam: true, homebar: 'ios', buttons: 'tablet', status: 'ipad' },
  browser: { bezel: { top: 44, x: 0, bottom: 0 }, band: 0, bodyR: 12, screenR: 0, safeTop: 0, safeBottom: 0, cutout: 'none', status: 'none', titlebar: true },
}

/* 기기 주변 여백 — 위는 고정 크롬(기기 선택·프로필·스테퍼·스튜디오 버튼) 자리, 나머지는 숨 쉴 공간.
   styles/device.css .sb-stage.is-framed 패딩과 같은 값 */
const STAGE_TOP = 84
const STAGE_BOTTOM = 28
const STAGE_X = 24

/* 창이 폰이면(640px 이하) 껍데기 없이 — 브라우저가 곧 기기다. responsive.css 모바일 분기점과 같은 값 */
function useNarrowViewport() {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/* 창에 맞춘 축소 배율 — 기기 바깥 크기(껍데기 포함)가 창의 여유 공간보다 크면 그만큼 줄인다(확대 없음) */
function useFit(outerW, outerH, active) {
  const [fit, setFit] = useState(1)
  useLayoutEffect(() => {
    if (!active) {
      setFit(1)
      return undefined
    }
    const calc = () => {
      const availW = window.innerWidth - STAGE_X * 2
      const availH = window.innerHeight - STAGE_TOP - STAGE_BOTTOM
      const next = Math.min(1, availW / outerW, availH / outerH)
      setFit(Math.max(0.3, Math.round(next * 1000) / 1000))
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [outerW, outerH, active])
  return fit
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const SignalIcon = () => (
  <svg className="sb-device__ico" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
    <rect x="0" y="8" width="3" height="4" rx="0.8" />
    <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
    <rect x="10" y="3" width="3" height="9" rx="0.8" />
    <rect x="15" y="0" width="3" height="12" rx="0.8" />
  </svg>
)
const WifiIcon = () => (
  <svg className="sb-device__ico" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
    <path d="M1.5 4.3a9.4 9.4 0 0 1 13 0" />
    <path d="M4.3 7.1a5.4 5.4 0 0 1 7.4 0" />
    <path d="M7 9.9a1.6 1.6 0 0 1 2 0" strokeWidth="2.4" />
  </svg>
)
const BatteryIcon = () => (
  <svg className="sb-device__ico sb-device__ico--battery" viewBox="0 0 27 13" aria-hidden="true">
    <rect x="0.6" y="0.6" width="21.8" height="11.8" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.4" />
    <rect x="2.4" y="2.4" width="18.2" height="8.2" rx="1.8" fill="currentColor" />
    <path d="M24 4.4v4.2a2.2 2.2 0 0 0 0-4.2Z" fill="currentColor" opacity="0.4" />
  </svg>
)

/* 상태 바 — 기기 OS 층. 시각은 이 기기의 현재 시각(30초 갱신) */
function StatusBar({ kind }) {
  const now = useClock()
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
  if (kind === 'ios-classic') {
    return (
      <div className={`sb-device__status sb-device__status--${kind}`} aria-hidden="true">
        <span className="sb-device__status-side"><SignalIcon /><WifiIcon /></span>
        <span className="sb-device__time">{time}</span>
        <span className="sb-device__status-side"><BatteryIcon /></span>
      </div>
    )
  }
  return (
    <div className={`sb-device__status sb-device__status--${kind}`} aria-hidden="true">
      <span className="sb-device__time">{time}</span>
      <span className="sb-device__status-side"><SignalIcon /><WifiIcon /><BatteryIcon /></span>
    </div>
  )
}

/* 옆면 버튼 — 종류별 자리 (몸체 높이 기준 %). 그림은 device.css */
const BUTTONS = {
  iphone: ['action', 'vol-up', 'vol-down', 'power'],
  'iphone-se': ['mute', 'vol-up', 'vol-down', 'power-se'],
  android: ['vol', 'power-a'],
  tablet: ['top', 'vol-t'],
}

/* 브라우저 창 머리 — 신호등 점 + 주소 알약(지금 접속한 호스트) */
function BrowserBar() {
  const host = typeof location !== 'undefined' ? location.host : 'localhost'
  return (
    <div className="sb-device__titlebar" aria-hidden="true">
      <span className="sb-device__dots"><i /><i /><i /></span>
      <span className="sb-device__address">
        <svg viewBox="0 0 12 14" fill="currentColor" aria-hidden="true"><path d="M3 6V4.5a3 3 0 0 1 6 0V6h.5A1.5 1.5 0 0 1 11 7.5v4A1.5 1.5 0 0 1 9.5 13h-7A1.5 1.5 0 0 1 1 11.5v-4A1.5 1.5 0 0 1 2.5 6H3Zm1.5 0h3V4.5a1.5 1.5 0 0 0-3 0V6Z" /></svg>
        {host}
      </span>
    </div>
  )
}

export default function DeviceFrame({ device, plain = false, children }) {
  const spec = FRAME_SPECS[device.frame] || FRAME_SPECS['iphone-island']
  const outerW = device.w + spec.bezel.x * 2 + spec.band * 2
  const outerH = device.h + spec.bezel.top + spec.bezel.bottom + spec.band * 2
  const narrow = useNarrowViewport()
  const isPlain = plain || narrow
  const fit = useFit(outerW, outerH, !isPlain)
  const style = {
    '--dev-w': `${device.w}px`,
    '--dev-h': `${device.h}px`,
    '--dev-outer-w': `${outerW}px`,
    '--dev-outer-h': `${outerH}px`,
    '--dev-fit': fit,
    '--dev-band': `${spec.band}px`,
    '--dev-bezel-top': `${spec.bezel.top}px`,
    '--dev-bezel-x': `${spec.bezel.x}px`,
    '--dev-bezel-bottom': `${spec.bezel.bottom}px`,
    '--dev-body-r': `${spec.bodyR}px`,
    '--dev-screen-r': `${spec.screenR}px`,
    '--sb-safe-top': `${spec.safeTop}px`,
    '--sb-safe-bottom': `${spec.safeBottom}px`,
  }
  return (
    <div className={'sb-stage ' + (isPlain ? 'is-plain' : 'is-framed')} data-frame={device.frame}>
      <div className={`sb-device sb-device--${device.frame}`} style={style}>
        <div className="sb-device__body">
          {spec.titlebar && <BrowserBar />}
          {(BUTTONS[spec.buttons] || []).map((kind) => (
            <span key={kind} className={`sb-device__btn sb-device__btn--${kind}`} aria-hidden="true" />
          ))}
          <div className="sb-device__glass">
            {spec.speaker && <span className="sb-device__speaker" aria-hidden="true" />}
            {spec.cam && <span className="sb-device__cam" aria-hidden="true" />}
            <div className="sb-device__screen" id={SCREEN_ID}>
              <div className="sb-device__scroll">{children}</div>
              {spec.status !== 'none' && <StatusBar kind={spec.status} />}
              {spec.cutout !== 'none' && <span className={`sb-device__cutout sb-device__cutout--${spec.cutout}`} aria-hidden="true" />}
              {spec.crease && <span className="sb-device__crease" aria-hidden="true" />}
              {spec.homebar && <span className={`sb-device__homebar sb-device__homebar--${spec.homebar}`} aria-hidden="true" />}
            </div>
            {spec.homebtn && <span className="sb-device__homebtn" aria-hidden="true" />}
          </div>
        </div>
      </div>
    </div>
  )
}
