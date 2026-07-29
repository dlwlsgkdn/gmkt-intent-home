import React from 'react'

/*
 * "서버에 저장" 버튼 — 수동 서버 동기화의 트리거.
 *
 * 홈 드로어와 빌더 상단바가 같은 상태(useWorkspace.remoteSync)를 읽는다.
 * 스튜디오 밖 단발 트랜잭션(프로필·시나리오 생성, 쓰레드 등)은 자동으로 싱크되지만,
 * 빌더의 연속 편집은 이 버튼이 곧 전송 시점이다. 상태 점이 미저장(주황)·
 * 동기화됨(초록)·연결 실패(빨강)를 구분한다. local 프로필에서는 아예 렌더하지 않는다.
 */
export default function SyncButton({ sync, small }) {
  if (!sync || !sync.enabled) return null
  const time = sync.lastSyncAt
    ? new Date(sync.lastSyncAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null
  const label = sync.busy
    ? '서버 저장 중…'
    : !sync.ready
      ? (sync.failed ? '서버 연결 안 됨' : '서버 확인 중…')
      : sync.dirty
        ? `서버에 저장${sync.dirtyCount > 0 ? ` (${sync.dirtyCount})` : ''}`
        : '서버에 저장됨'
  const title = sync.failed
    ? '서버 상태를 불러오지 못했어요 — 새로고침 후 다시 시도해주세요'
    : sync.dirty
      ? `마지막 서버 저장 이후 바뀐 내용이 있어요${time ? ` · 이번 세션 마지막 저장 ${time}` : ''}`
      : time
        ? `이번 세션 마지막 저장 ${time}`
        : '서버와 같은 상태예요'
  const dotState = sync.failed ? ' is-fail' : sync.dirty ? ' is-dirty' : sync.ready ? ' is-ok' : ''
  return (
    <button
      type="button"
      className={'sb-btn sb-sync-btn' + (small ? ' sb-btn--small' : '')}
      disabled={sync.busy || !sync.ready || !sync.dirty}
      title={title}
      onClick={sync.push}
    >
      <span className={'sb-sync-dot' + dotState} aria-hidden="true" />
      {label}
    </button>
  )
}
