import { useEffect, useRef, useState } from 'react'
import { LIBRARY } from '../../../lib/registry.jsx'
import { PAD } from '../../../lib/layout.js'

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

/*
 * 캔버스 표면 이벤트 — 러버밴드 선택, 우클릭 메뉴, 팔레트 HTML5 드래그 드롭,
 * 줌 스텝, 높이 재측정 후 재컴팩트. 드래그·중첩의 규칙 자체는 useCanvasDrag/
 * useContainerNesting에 있고, 여기는 포인터·DnD 이벤트를 그 규칙에 연결만 한다.
 */
export function useCanvasInteractions({
  previewMode, zoom, setZoom, canvasRef, topItems, heightOf,
  selectedIds, setSelectedIds, setMarquee, ctxMenu, setCtxMenu,
  items, setItems, setItemsFromMeasure,
  containerAt, insertHintOf, setDropTargetId, setInsertHint,
  nesting, addItemAt, layout, drag,
}) {
  const [, setMeasureVer] = useState(0) // 실제 표시 높이 변경을 캔버스 스크롤 범위에 반영
  const measureLayoutTimerRef = useRef(null)

  const zoomBy = (direction) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.01)
      return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (index < 0 ? 4 : index) + direction))]
    })
  }

  /* 러버밴드(마퀴) 다중 선택: 빈 캔버스를 드래그 */
  const onCanvasPointerDown = (event) => {
    if (previewMode) return
    if (event.target !== event.currentTarget || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const sx = (event.clientX - rect.left) / zoom
    const sy = (event.clientY - rect.top) / zoom
    const baseSelection = event.shiftKey ? [...selectedIds] : []
    if (!event.shiftKey) setSelectedIds([])
    const move = (moveEvent) => {
      const cx = (moveEvent.clientX - rect.left) / zoom
      const cy = (moveEvent.clientY - rect.top) / zoom
      const box = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
      if (box.w < 3 && box.h < 3) return
      setMarquee(box)
      const hit = topItems
        .filter((item) => {
          const height = heightOf(item)
          return item.x < box.x + box.w && item.x + item.w > box.x
            && item.y < box.y + box.h && item.y + height > box.y
        })
        .map((item) => item.id)
      setSelectedIds([...new Set([...baseSelection, ...hit])])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const openCtxMenu = (event, itemId) => {
    if (previewMode) return
    event.preventDefault()
    event.stopPropagation()
    if (itemId && !selectedIds.includes(itemId)) setSelectedIds([itemId])
    const rect = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null
    setCtxMenu({
      sx: event.clientX,
      sy: event.clientY,
      cx: rect ? (event.clientX - rect.left) / zoom : PAD,
      cy: rect ? (event.clientY - rect.top) / zoom : PAD,
      itemId: itemId || null,
    })
  }

  /* 선택된 컴포넌트들의 잠금/숨김을 클릭한 아이템 기준으로 일괄 토글 */
  const toggleSelected = (key) => {
    const target = items.find((item) => item.id === (ctxMenu && ctxMenu.itemId))
    const next = target ? !target[key] : true
    const ids = new Set(selectedIds)
    setItems((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, [key]: next } : item)))
  }

  /* 팔레트 → 캔버스 HTML5 드래그 */
  const paletteDragOver = (event) => {
    if (previewMode) return
    if (![...event.dataTransfer.types].includes('text/sb-type')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = (event.clientX - rect.left) / zoom
    const cy = (event.clientY - rect.top) / zoom
    const hover = containerAt(cx, cy)
    setDropTargetId(hover ? hover.id : null)
    setInsertHint(hover ? insertHintOf(hover, cx, cy) : null)
  }
  const paletteDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetId(null)
    setInsertHint(null)
  }
  const paletteDrop = (event) => {
    if (previewMode) return
    const type = event.dataTransfer.getData('text/sb-type')
    if (!type) return
    event.preventDefault()
    setDropTargetId(null)
    setInsertHint(null)
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = (event.clientX - rect.left) / zoom
    const cy = (event.clientY - rect.top) / zoom
    // 컨테이너 위에 놓으면 그 위치의 슬롯에 자식으로 배치
    const target = !LIBRARY[type]?.container && containerAt(cx, cy)
    if (target) nesting.addChild(type, target.id, { containerType: target.type, cx, cy })
    else addItemAt(type, cx, cy)
  }

  /* 이미지 로딩·줄바꿈으로 실제 높이가 바뀌면 조용히 재컴팩트한다.
     측정은 사용자 편집이 아니므로 Undo 스냅샷에 넣지 않는다. */
  const onItemMeasure = () => {
    setMeasureVer((version) => version + 1)
    if (previewMode || !layout.compactOn || drag.isDragging()) return
    clearTimeout(measureLayoutTimerRef.current)
    measureLayoutTimerRef.current = setTimeout(() => {
      setItemsFromMeasure((prev) => layout.compact(prev))
    }, 80)
  }
  useEffect(() => () => clearTimeout(measureLayoutTimerRef.current), [])

  return {
    zoomBy,
    onCanvasPointerDown,
    openCtxMenu,
    toggleSelected,
    paletteDragOver,
    paletteDragLeave,
    paletteDrop,
    onItemMeasure,
  }
}
