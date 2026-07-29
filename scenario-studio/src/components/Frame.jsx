import React, { useState } from 'react'
import { DEVICE_PRESETS } from '../lib/store.js'
import Dropdown from './ui/Dropdown.jsx'

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
      <Dropdown
        open={open}
        onClose={() => setOpen(false)}
        menuClass="sb-viewer-ctl__menu"
        button={
          <button type="button" className="sb-viewer-ctl__btn" onClick={() => setOpen((v) => !v)} title="화면 크기 선택">
            {device.icon} {device.w}px
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
          </button>
        }
      >
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
      </Dropdown>
    </div>
  )
}

/* 좌상단 사용자 프로필 전환 컨트롤 — 기기(화면 폭) 컨트롤 옆에 나란히 (홈 전용).
   프로필마다 탐색(DDAK) 페이지·시나리오·쓰레드가 따로 관리된다.
   홈의 서버 저장 상태는 여기가 유일한 표시 자리다: 버튼에는 주의가 필요한 상태만
   배지로(동기화 중 펄스·미저장 점·연결 안 됨), 드롭다운 상단 행에 상태+저장 버튼,
   자세한 설명은 느낌표 아이콘을 눌렀을 때만 펼친다 */
export function ProfileControl({ api }) {
  const [open, setOpen] = useState(false)
  const [syncInfoOpen, setSyncInfoOpen] = useState(false) // 느낌표 아이콘 → 서버 저장 안내 펼침
  const name = (api.profile && api.profile.name) || '사용자'
  const sync = api.remoteSync
  const close = () => { setOpen(false); setSyncInfoOpen(false) }
  const syncLabel = !sync ? '' : sync.busy
    ? '서버 저장 중…'
    : sync.hydrating
      ? '서버에서 불러오는 중…'
      : sync.failed
        ? '서버 연결 안 됨'
        : sync.dirty
          ? `미저장 변경 ${sync.dirtyCount}개`
          : '서버에 저장됨'
  const syncDot = !sync ? '' : sync.hydrating ? ' is-hydrating' : sync.failed ? ' is-fail' : sync.dirty ? ' is-dirty' : ' is-ok'
  return (
    <div className="sb-viewer-ctl sb-profile-ctl">
      <Dropdown
        open={open}
        onClose={close}
        menuClass="sb-viewer-ctl__menu sb-profile-ctl__menu"
        button={
          <button
            type="button"
            className="sb-viewer-ctl__btn"
            onClick={() => (open ? close() : setOpen(true))}
            title={sync?.hydrating ? '서버에서 프로필·시나리오를 불러오는 중이에요' : '사용자 프로필 전환'}
          >
            <span className="sb-profile-ctl__avatar">{name.slice(0, 1)}</span>
            {name}
            {sync?.hydrating && (
              <span className="sb-profile-ctl__sync">
                <span className="sb-sync-dot is-hydrating" aria-hidden="true" />
                동기화 중
              </span>
            )}
            {sync?.enabled && sync.failed && (
              <span
                className="sb-profile-ctl__sync sb-profile-ctl__sync--fail"
                title="서버 상태를 불러오지 못했어요 — 이번 세션은 이 브라우저의 저장본만 보여요"
              >
                <span className="sb-sync-dot is-fail" aria-hidden="true" />
                연결 안 됨
              </span>
            )}
            {sync?.enabled && sync.ready && sync.dirty && (
              <span className="sb-profile-ctl__sync" title="서버에 저장 안 된 변경이 있어요 — 눌러서 저장할 수 있어요">
                <span className="sb-sync-dot is-dirty" aria-hidden="true" />
              </span>
            )}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
          </button>
        }
      >
        {sync?.enabled && (
          <div className="sb-profile-ctl__syncrow">
            <div className="sb-profile-ctl__syncline">
              <span className={'sb-sync-dot' + syncDot} aria-hidden="true" />
              <span className="sb-profile-ctl__synclabel">{syncLabel}</span>
              {sync.ready && sync.dirty && (
                <button type="button" className="sb-btn sb-btn--tiny" disabled={sync.busy} onClick={sync.push}>
                  서버에 저장
                </button>
              )}
              <button
                type="button"
                className="sb-sync-info"
                aria-label="서버 저장 안내"
                aria-expanded={syncInfoOpen}
                onClick={() => setSyncInfoOpen((v) => !v)}
              >
                !
              </button>
            </div>
            {syncInfoOpen && (
              <p className="sb-sync-tip">
                {sync.failed
                  ? '서버 상태를 불러오지 못해 이번 세션은 이 브라우저의 저장본만 보여요. 새로고침으로 다시 연결해 보세요.'
                  : '홈에서의 변경(프로필·시나리오 만들기, 쓰레드, 가져오기)은 서버에 자동 저장돼요. 빌더에서 편집한 내용은 "서버에 저장"을 눌러야 다른 기기·브라우저에서도 보여요.'}
              </p>
            )}
          </div>
        )}
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
      </Dropdown>
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
