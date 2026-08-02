import React from 'react'

/* 캔버스 우클릭 컨텍스트 메뉴 (Figma/Canva식).
   menu = { sx, sy(화면 좌표), itemId|null } — null이면 빈 캔버스 메뉴 */
export default function ContextMenu({
  menu,
  items,
  hasClipboard,
  onClose,
  onDuplicate,
  onCopy,
  onPaste,
  onToggle,
  onRemove,
  onSelectAll,
}) {
  if (!menu) return null
  const target = items.find((it) => it.id === menu.itemId)
  const run = (fn) => () => { onClose(); fn() }

  return (
    <>
      <div
        className="sb-menu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
      />
      <div className="sb-menu sb-ctx-menu" style={{ left: menu.sx, top: menu.sy }}>
        {menu.itemId ? (
          <>
            <button type="button" onClick={run(onDuplicate)}>
              복제 <kbd>⌘D</kbd>
            </button>
            <button type="button" onClick={run(onCopy)}>
              복사 <kbd>⌘C</kbd>
            </button>
            <button type="button" disabled={!hasClipboard} onClick={run(() => onPaste())}>
              붙여넣기 <kbd>⌘V</kbd>
            </button>
            <span className="sb-ctx-menu__sep" />
            <button type="button" onClick={run(() => onToggle('locked'))}>
              {target?.locked ? '잠금 해제' : '순서 잠금'}
            </button>
            <button type="button" onClick={run(() => onToggle('hidden'))}>
              {target?.hidden ? '실행 시 보이기' : '실행 시 숨기기'}
            </button>
            <span className="sb-ctx-menu__sep" />
            <button type="button" className="sb-ctx-menu__danger" onClick={run(onRemove)}>
              삭제 <kbd>Del</kbd>
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={!hasClipboard} onClick={run(() => onPaste())}>
              붙여넣기 <kbd>⌘V</kbd>
            </button>
            <button type="button" onClick={run(onSelectAll)}>
              전체 선택 <kbd>⌘A</kbd>
            </button>
          </>
        )}
      </div>
    </>
  )
}
