import React from 'react'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'

/* 스택 캔버스 위의 최상위 컴포넌트 한 개 — 선택/순서 드래그/잠금/숨김.
   배치는 문서 흐름(배열 순서)이라 좌표·리사이즈·높이 측정이 없다. */
export default function CanvasItem({
  item,
  editable = true,
  dropTarget = false,
  selected,
  dragging = false,
  renderCtx,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onInspect,
  onContextMenu,
}) {
  const def = LIBRARY[item.type]
  const locked = !!item.locked
  const preview = renderCtx?.canvasView === 'preview'
  const childCount = def?.container
    ? (renderCtx?.allItems || []).filter((child) => child.parentId === item.id).length
    : 0

  const onPointerDown = (e) => {
    if (!editable) return
    if (e.button !== 0) return
    e.preventDefault()
    if (e.shiftKey) {
      onSelect(item.id, true)
      return
    }
    onSelect(item.id, false)
    if (locked) return // 잠긴 컴포넌트는 선택만 가능
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
        moved = true
        onDragStart(item.id)
      }
      if (moved) onDrag(item.id, ev.clientX, ev.clientY)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) onDragEnd(item.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={
        'sb-canvas-item' +
        (selected ? ' sb-canvas-item--selected' : '') +
        (dragging ? ' sb-canvas-item--dragging' : '') +
        (locked ? ' sb-canvas-item--locked' : '') +
        (item.hidden ? ' sb-canvas-item--hidden' : '') +
        (dropTarget ? ' sb-canvas-item--drop-target' : '')
      }
      data-canvas-item-id={item.id}
      onPointerDown={onPointerDown}
      onDoubleClick={editable ? () => onInspect(item.id) : undefined}
      onContextMenu={editable && onContextMenu ? (e) => onContextMenu(e, item.id) : undefined}
    >
      <span className="sb-canvas-item__tag">
        {locked ? '🔒 ' : ''}{item.hidden ? '🚫 ' : ''}{def?.icon} {def?.label}
        {def?.container ? ` · ${childCount}개` : ''}
      </span>
      {dropTarget && (
        <span className="sb-canvas-item__drop-badge">
          안에 배치 · {def?.label}
        </span>
      )}
      <div
        className="sb-canvas-item__content"
        style={{
          // 미리보기는 스크롤 같은 실사용 동작만 열고, 편집 모드는 등록된 예외 컴포넌트만 내부 클릭을 연다.
          ...((preview || (editable && def?.canvasInteractive && !locked)) ? { pointerEvents: 'auto' } : null),
        }}
      >
        {renderItem(item, renderCtx || { mode: 'canvas' })}
      </div>
    </div>
  )
}
