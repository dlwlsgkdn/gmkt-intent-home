import React from 'react'

/* 상단 바 드롭다운 공용 래퍼 — 버튼은 호출부에서 렌더, 메뉴/백드롭만 담당 */
export default function Dropdown({ open, onClose, button, menuClass, children }) {
  return (
    <div className="sb-menu-wrap">
      {button}
      {open && (
        <>
          <div className="sb-menu-backdrop" onClick={onClose} />
          <div className={'sb-menu' + (menuClass ? ' ' + menuClass : '')}>{children}</div>
        </>
      )}
    </div>
  )
}
