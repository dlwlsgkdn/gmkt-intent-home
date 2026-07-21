import React, { useEffect, useRef } from 'react'
import { LIBRARY, renderItem } from '../../lib/registry.jsx'

/* 캔버스 위의 컴포넌트 한 개 — 드래그/리사이즈/선택/잠금/숨김 */
export default function CanvasItem({
  item,
  editable = true,
  zoom = 1,
  dropTarget = false,
  selected,
  dragPos,
  sizeDraft,
  heightsRef,
  onMeasure,
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
  const def = LIBRARY[item.type]
  const dragging = dragPos != null
  const resizing = sizeDraft != null
  const locked = !!item.locked
  const preview = renderCtx?.canvasView === 'preview'
  const revealContainerContents = editable && !preview && !!def?.container
  const childCount = def?.container
    ? (renderCtx?.allItems || []).filter((child) => child.parentId === item.id).length
    : 0

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => {
      const content = el.querySelector(':scope > .sb-canvas-item__content')
      const next = revealContainerContents
        ? Math.max(el.offsetHeight, (content?.scrollHeight || 0) + 20)
        : el.offsetHeight
      const prev = heightsRef.current[item.id]
      heightsRef.current[item.id] = next
      if (prev == null || Math.abs(prev - next) >= 1) onMeasure?.(item.id, next, prev)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    // 명시 높이가 있는 컨테이너는 바깥 박스가 고정되어도 내부 자식 목록은 계속 커질 수 있다.
    // 콘텐츠 자체도 관찰해야 새 자식 추가/복제 시 캔버스 스크롤 범위가 즉시 갱신된다.
    if (content) ro.observe(content)
    return () => ro.disconnect()
  }, [item.id, heightsRef, revealContainerContents])

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
    if (!editable) return
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
        (revealContainerContents ? ' sb-canvas-item--container-revealed' : '') +
        (dropTarget ? ' sb-canvas-item--drop-target' : '')
      }
      data-canvas-item-id={item.id}
      style={{ left: x, top: y, width: w, height: h || 'auto' }}
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
          ...(h && !revealContainerContents ? { height: '100%', overflow: 'hidden' } : null),
          ...(revealContainerContents ? { height: 'auto', minHeight: h || undefined, overflow: 'visible' } : null),
          // 미리보기는 스크롤 같은 실사용 동작만 열고, 편집 모드는 등록된 예외 컴포넌트만 내부 클릭을 연다.
          ...((preview || (editable && def?.canvasInteractive && !locked)) ? { pointerEvents: 'auto' } : null),
        }}
      >
        {renderItem(item, renderCtx || { mode: 'canvas' })}
      </div>
      {revealContainerContents && h && selected && (
        <span className="sb-canvas-item__viewport-end" style={{ top: h }} aria-hidden="true">
          실제 컨테이너 영역 끝 · {h}px
        </span>
      )}
      {editable && !locked && <span className="sb-resize-handle" onPointerDown={onResizeDown} title="크기 조절" />}
    </div>
  )
}
