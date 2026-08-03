import { LIBRARY } from '../../../lib/registry.jsx'
import { containerAtClient, topInsertIndexAt, topInsertLineAt } from '../../../lib/builder/geometry.js'

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

/*
 * 캔버스 표면 이벤트 — 빈 곳 클릭 선택 해제, 우클릭 메뉴, 팔레트 HTML5 드래그 드롭, 줌 스텝.
 * 드래그·중첩의 규칙 자체는 useStackDrag/useContainerNesting에 있고,
 * 여기는 포인터·DnD 이벤트를 그 규칙에 연결만 한다.
 */
export function useCanvasInteractions({
  previewMode, zoom, setZoom, canvasRef,
  selectedIds, setSelectedIds, ctxMenu, setCtxMenu,
  items, setItems,
  setDropTargetId, setInsertHint, setInsertLine,
  insertHintOf, nesting, addItemAt,
}) {
  const zoomBy = (direction) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.01)
      return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (index < 0 ? 4 : index) + direction))]
    })
  }

  /* 빈 캔버스 클릭 = 선택 해제 (⇧ 클릭은 유지) */
  const onCanvasPointerDown = (event) => {
    if (previewMode) return
    if (event.target !== event.currentTarget || event.button !== 0) return
    if (!event.shiftKey) setSelectedIds([])
  }

  const openCtxMenu = (event, itemId) => {
    if (previewMode) return
    event.preventDefault()
    event.stopPropagation()
    if (itemId && !selectedIds.includes(itemId)) setSelectedIds([itemId])
    setCtxMenu({ sx: event.clientX, sy: event.clientY, itemId: itemId || null })
  }

  /* 선택된 컴포넌트들의 잠금/숨김을 클릭한 아이템 기준으로 일괄 토글 */
  const toggleSelected = (key) => {
    const target = items.find((item) => item.id === (ctxMenu && ctxMenu.itemId))
    const next = target ? !target[key] : true
    const ids = new Set(selectedIds)
    setItems((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, [key]: next } : item)))
  }

  /* 팔레트 → 캔버스 HTML5 드래그: 컨테이너 위면 자식 캐럿, 아니면 순서 삽입 라인 */
  const paletteDragOver = (event) => {
    if (previewMode) return
    if (![...event.dataTransfer.types].includes('text/sb-type')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const hover = containerAtClient({
      canvasEl: canvasRef.current, items, clientX: event.clientX, clientY: event.clientY,
    })
    if (hover) {
      const rect = canvasRef.current.getBoundingClientRect()
      setDropTargetId(hover.id)
      setInsertHint(insertHintOf(hover, (event.clientX - rect.left) / zoom, (event.clientY - rect.top) / zoom))
      setInsertLine(null)
      return
    }
    setDropTargetId(null)
    setInsertHint(null)
    const index = topInsertIndexAt({ canvasEl: canvasRef.current, clientY: event.clientY })
    setInsertLine(topInsertLineAt({ canvasEl: canvasRef.current, zoom, index }))
  }
  const paletteDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetId(null)
    setInsertHint(null)
    setInsertLine(null)
  }
  const paletteDrop = (event) => {
    if (previewMode) return
    const type = event.dataTransfer.getData('text/sb-type')
    if (!type) return
    event.preventDefault()
    setDropTargetId(null)
    setInsertHint(null)
    setInsertLine(null)
    // 컨테이너 위에 놓으면 그 위치의 슬롯에 자식으로 배치
    const target = !LIBRARY[type]?.container && containerAtClient({
      canvasEl: canvasRef.current, items, clientX: event.clientX, clientY: event.clientY,
    })
    if (target) {
      const rect = canvasRef.current.getBoundingClientRect()
      nesting.addChild(type, target.id, {
        containerType: target.type,
        cx: (event.clientX - rect.left) / zoom,
        cy: (event.clientY - rect.top) / zoom,
      })
      return
    }
    addItemAt(type, topInsertIndexAt({ canvasEl: canvasRef.current, clientY: event.clientY }))
  }

  return {
    zoomBy,
    onCanvasPointerDown,
    openCtxMenu,
    toggleSelected,
    paletteDragOver,
    paletteDragLeave,
    paletteDrop,
  }
}
