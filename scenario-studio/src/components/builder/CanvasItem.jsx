import React, { useEffect, useRef } from 'react'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'

/* 캔버스 위의 컴포넌트 한 개 — 드래그/리사이즈/선택/잠금/숨김 */
export default function CanvasItem({
  item,
  zoom = 1,
  dropTarget = false,
  selected,
  dragPos,
  sizeDraft,
  heightsRef,
  renderCtx,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onResize,
  onResizeEnd,
  onInspect,
  onContextMenu,
}) {
  const ref = useRef(null)
  const dragging = dragPos != null
  const resizing = sizeDraft != null
  const locked = !!item.locked

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => {
      heightsRef.current[item.id] = el.offsetHeight
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [item.id, heightsRef])

  const onPointerDown = (e) => {
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
    const origX = item.x
    const origY = item.y
    let moved = false
    const move = (ev) => {
      const dx = (ev.clientX - startX) / zoom
      const dy = (ev.clientY - startY) / zoom
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true
        onDragStart(item.id)
      }
      if (moved) onDrag(item.id, origX + dx, origY + dy, ev.clientX, ev.clientY)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) onDragEnd(item.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onResizeDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(item.id, false)
    const startX = e.clientX
    const startY = e.clientY
    const origW = item.w
    const origH = item.h || (ref.current ? ref.current.offsetHeight : 120)
    const move = (ev) => {
      onResize(item.id, origW + (ev.clientX - startX) / zoom, origH + (ev.clientY - startY) / zoom)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onResizeEnd(item.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const def = LIBRARY[item.type]
  const x = dragging ? dragPos.x : item.x
  const y = dragging ? dragPos.y : item.y
  const w = resizing ? sizeDraft.w : item.w
  const h = resizing ? sizeDraft.h : item.h

  return (
    <div
      ref={ref}
      className={
        'sb-canvas-item' +
        (selected ? ' sb-canvas-item--selected' : '') +
        (dragging ? ' sb-canvas-item--dragging' : '') +
        (resizing ? ' sb-canvas-item--resizing' : '') +
        (locked ? ' sb-canvas-item--locked' : '') +
        (item.hidden ? ' sb-canvas-item--hidden' : '') +
        (dropTarget ? ' sb-canvas-item--drop-target' : '')
      }
      style={{ left: x, top: y, width: w, height: h || 'auto' }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onInspect(item.id)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, item.id) : undefined}
    >
      <span className="sb-canvas-item__tag">
        {locked ? '🔒 ' : ''}{item.hidden ? '🚫 ' : ''}{def?.icon} {def?.label}
      </span>
      <div
        className="sb-canvas-item__content"
        style={{
          ...(h ? { height: '100%', overflow: 'hidden' } : null),
          // 일부 컴포넌트(프로필 패널 등)는 캔버스에서도 클릭 가능
          ...(def?.canvasInteractive && !locked ? { pointerEvents: 'auto' } : null),
        }}
      >
        {renderItem(item, renderCtx || { mode: 'canvas' })}
      </div>
      {!locked && <span className="sb-resize-handle" onPointerDown={onResizeDown} title="크기 조절" />}
    </div>
  )
}
