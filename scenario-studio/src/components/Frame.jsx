import React from 'react'

/* 원본 clean-home 프레임: 배경 블롭 + 플로팅 액션바 */
export function BgBlobs() {
  return (
    <>
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-gmarket-blue bg-blob" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gmarket bg-blob" />
    </>
  )
}

/* 하단 플로팅 바 — 원본 구성(홈/마이/쓰레드 목록) 유지 */
export function FloatingBar({ onHome, onMy, onList, active }) {
  return (
    <nav className="clean-floating-actionbar" aria-label="빠른 이동">
      <button
        type="button"
        className={'clean-floating-actionbar__btn' + (active === 'home' ? ' sb-fab-active' : '')}
        aria-label="홈으로 이동"
        title="홈"
        onClick={onHome}
      >
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M3.5 11.5 12 4l8.5 7.5M5.5 10.5V20h13v-9.5M9.5 20v-5.5h5V20" /></svg>
      </button>
      <button
        type="button"
        className="clean-floating-actionbar__btn"
        aria-label="마이 페이지"
        title="마이"
        onClick={onMy}
      >
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /></svg>
      </button>
      <button
        type="button"
        className="clean-floating-actionbar__btn"
        aria-label="시나리오 목록"
        title="시나리오 목록"
        onClick={onList}
      >
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 6h16M4 12h16M4 18h10" /></svg>
      </button>
    </nav>
  )
}

/* 우상단 시나리오 스튜디오 진입 플로팅 버튼 */
export function StudioFab({ label = '시나리오 스튜디오', onClick }) {
  return (
    <button type="button" className="sb-studio-fab" onClick={onClick}>
      <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.4a2 2 0 112.8 2.8L11 16l-4 1 1-4 9.6-9.4z" /></svg>
      <span>{label}</span>
    </button>
  )
}
