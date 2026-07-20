import React, { useState } from 'react'
import { DEVICE_PRESETS } from '../lib/store.js'

/* 원본 clean-home 프레임: 배경 블롭 + 플로팅 액션바 */
export function BgBlobs() {
  return (
    <>
      <div className="fixed top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-gmarket-blue bg-blob" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-gmarket bg-blob" />
    </>
  )
}

/* 버튼이 그룹 안에서 왼쪽/가운데/오른쪽 어디에 있는지 판별 — 패널 등장 방향에 사용 */
function fabOrigin(e) {
  const btn = e.currentTarget.getBoundingClientRect()
  const nav = e.currentTarget.closest('nav')
  if (!nav) return 'right'
  const bar = nav.getBoundingClientRect()
  const center = btn.left + btn.width / 2
  const barCenter = bar.left + bar.width / 2
  if (center < barCenter - 8) return 'left'
  if (center > barCenter + 8) return 'right'
  return 'center'
}

/* 하단 플로팅 바 — 원본 구성(홈/마이/쓰레드 히스토리) 유지 */
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
        aria-label="쇼핑 쓰레드 히스토리"
        title="쇼핑 쓰레드 히스토리"
        onClick={(e) => onList(fabOrigin(e))}
      >
        <svg aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M4 6h16M4 12h16M4 18h10" /></svg>
      </button>
    </nav>
  )
}

/* 좌상단 뷰어 기기(화면 폭) 선택 컨트롤 — 탐색/설문/계획 실행 화면 공통 */
export function ViewerDeviceControl({ deviceKey, onChange }) {
  const [open, setOpen] = useState(false)
  const device = DEVICE_PRESETS.find((d) => d.key === deviceKey) || DEVICE_PRESETS[0]
  return (
    <div className="sb-viewer-ctl">
      <button type="button" className="sb-viewer-ctl__btn" onClick={() => setOpen((v) => !v)} title="화면 크기 선택">
        {device.icon} {device.w}px
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <>
          <div className="sb-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="sb-menu sb-viewer-ctl__menu">
            {DEVICE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={'sb-menu__item' + (p.key === device.key ? ' sb-menu__item--active' : '')}
                onClick={() => { onChange(p.key); setOpen(false) }}
              >
                <strong>{p.icon} {p.label}</strong>
                <small>화면 폭 {p.w}px{p.key === device.key ? ' · 사용 중' : ''}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* 좌상단 사용자 프로필 전환 컨트롤 — 기기(화면 폭) 컨트롤 옆에 나란히 (홈 전용).
   프로필마다 탐색(DDAK) 페이지·시나리오·쓰레드가 따로 관리된다. */
export function ProfileControl({ api }) {
  const [open, setOpen] = useState(false)
  const name = (api.profile && api.profile.name) || '사용자'
  return (
    <div className="sb-viewer-ctl sb-profile-ctl">
      <button type="button" className="sb-viewer-ctl__btn" onClick={() => setOpen((v) => !v)} title="사용자 프로필 전환">
        <span className="sb-profile-ctl__avatar">{name.slice(0, 1)}</span>
        {name}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <>
          <div className="sb-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="sb-menu sb-viewer-ctl__menu sb-profile-ctl__menu">
            {api.accounts.map((a) => {
              const isActive = a.id === api.activeAccountId
              return (
                <div key={a.id} className="sb-profile-ctl__row">
                  <button
                    type="button"
                    className={'sb-menu__item' + (isActive ? ' sb-menu__item--active' : '')}
                    onClick={() => { setOpen(false); api.switchAccount(a.id) }}
                  >
                    <strong>{a.profile.name}{isActive ? ' · 사용 중' : ''}</strong>
                    <small>시나리오 {a.scenarios.length}개 · 쓰레드 {a.threads.length}개</small>
                  </button>
                  {api.accounts.length > 1 && (
                    <button
                      type="button"
                      className="sb-profile-ctl__remove"
                      aria-label={`${a.profile.name} 프로필 삭제`}
                      onClick={() => {
                        if (window.confirm(`"${a.profile.name}" 프로필과 그 시나리오·탐색 페이지를 삭제할까요?`)) {
                          setOpen(false)
                          api.removeAccount(a.id)
                        }
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              )
            })}
            <button
              type="button"
              className="sb-menu__item sb-profile-ctl__add"
              onClick={() => {
                const nm = window.prompt('새 프로필 이름을 입력하세요', '')
                if (nm != null) {
                  setOpen(false)
                  api.addAccount(nm)
                }
              }}
            >
              <strong>+ 새 프로필</strong>
              <small>탐색 페이지·시나리오를 새로 시작해요</small>
            </button>
          </div>
        </>
      )}
    </div>
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
