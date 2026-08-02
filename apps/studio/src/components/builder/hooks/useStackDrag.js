import { useRef, useState } from 'react'
import { LIBRARY } from '../../../lib/registry.jsx'
import {
  containerAtClient,
  placeChild,
  reorderTop,
  topInsertIndexAt,
  topInsertLineAt,
} from '../../../lib/builder/geometry.js'

/*
 * 스택 캔버스 드래그 — 최상위 아이템의 순서 재배열과 컨테이너 삽입.
 *
 * 좌표 모델이 아니라 순서 모델이라 드래그는 "어느 인덱스에 끼울 것인가" 하나만 판정한다:
 *   · 아이템은 제자리에 두고(반투명 강조) 포인터 옆 고스트 + 삽입 라인으로 미리보기
 *   · 포인터가 컨테이너 중앙부(삽입 존)에 있으면 "안에 배치" — 하이라이트 + 자식 캐럿
 *   · 드롭 시 reorderTop / placeChild 한 번으로 커밋 (미리보기 = 결과)
 * 다중 선택 그룹은 선택 순서를 유지한 채 한 인덱스에 통째로 끼운다 (컨테이너 삽입은 단일만).
 */
export function useStackDrag({
  items,
  zoom,
  canvasRef,
  slotIndexOf,
  insertHintOf,
  setItems,
  setSelectedIds,
  selectedIds,
  setDropTargetId,
  setInsertHint,
  setInsertLine,
  setDragGhost,
  showToast,
}) {
  const [dragIds, setDragIds] = useState(null) // 드래그 중인 최상위 아이템 id 목록
  const dropRef = useRef(null) // { index } | { containerId, slotIndex } — 마지막 미리보기 = 커밋 대상
  const dragIdsRef = useRef(null)

  const isDragging = () => !!dragIdsRef.current

  const begin = (id) => {
    const group = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
    const ids = items
      .filter((item) => group.includes(item.id) && !item.parentId && !item.locked)
      .map((item) => item.id)
    if (ids.length === 0) return false
    dragIdsRef.current = ids
    dropRef.current = null
    setDragIds(ids)
    const primary = items.find((item) => item.id === id)
    const def = primary ? LIBRARY[primary.type] : null
    setDragGhost({
      label: ids.length > 1 ? `${ids.length}개 컴포넌트` : def?.label || '컴포넌트',
      icon: ids.length > 1 ? '⧉' : def?.icon || '◈',
    })
    return true
  }

  const onDragStart = (id) => { begin(id) }

  const onDrag = (id, clientX, clientY) => {
    const ids = dragIdsRef.current
    if (!ids || !canvasRef.current) return
    setDragGhost((ghost) => (ghost ? { ...ghost, x: clientX + 14, y: clientY + 14 } : ghost))

    // 단일 비컨테이너 드래그만 컨테이너 안에 넣을 수 있다
    const single = ids.length === 1 ? items.find((item) => item.id === ids[0]) : null
    const nestable = single && !LIBRARY[single.type]?.container
    const hover = nestable
      ? containerAtClient({ canvasEl: canvasRef.current, items, clientX, clientY, excludeId: single.id })
      : null
    if (hover) {
      const rect = canvasRef.current.getBoundingClientRect()
      const cx = (clientX - rect.left) / zoom
      const cy = (clientY - rect.top) / zoom
      dropRef.current = { containerId: hover.id, slotIndex: slotIndexOf(hover.id, hover.type, cx, cy) }
      setDropTargetId(hover.id)
      setInsertHint(insertHintOf(hover, cx, cy))
      setInsertLine(null)
      return
    }

    const excludeIds = new Set(ids)
    const index = topInsertIndexAt({ canvasEl: canvasRef.current, clientY, excludeIds })
    dropRef.current = { index }
    setDropTargetId(null)
    setInsertHint(null)
    setInsertLine(topInsertLineAt({ canvasEl: canvasRef.current, zoom, index, excludeIds }))
  }

  const finishDrag = () => {
    const snapshot = { ids: dragIdsRef.current, drop: dropRef.current }
    dragIdsRef.current = null
    dropRef.current = null
    setDragIds(null)
    setDropTargetId(null)
    setInsertHint(null)
    setInsertLine(null)
    setDragGhost(null)
    return snapshot
  }

  const onDragEnd = (id) => {
    const { ids, drop } = finishDrag()
    if (!ids || !ids.includes(id) || !drop) return
    // 진행 중인 React 렌더와 커밋이 겹치지 않도록 다음 틱으로 미룬다
    setTimeout(() => {
      if (drop.containerId != null) {
        const dragged = items.find((item) => item.id === ids[0])
        const target = items.find((item) => item.id === drop.containerId)
        setItems((prev) => placeChild(prev, ids[0], drop.containerId, drop.slotIndex))
        setSelectedIds([ids[0]])
        if (dragged && target) {
          showToast(`${LIBRARY[dragged.type]?.label}을(를) ${LIBRARY[target.type]?.label} 안에 배치했어요.`)
        }
        return
      }
      setItems((prev) => reorderTop(prev, ids, drop.index))
    }, 0)
  }

  /* 컨테이너에서 꺼내진 자식이 이어서 드래그될 때 — 임계 없이 곧장 드래그 상태로 */
  const beginFromPointer = (id, clientX, clientY) => {
    dragIdsRef.current = [id]
    dropRef.current = null
    setDragIds([id])
    const item = items.find((candidate) => candidate.id === id)
    const def = item ? LIBRARY[item.type] : null
    setDragGhost({ x: clientX + 14, y: clientY + 14, label: def?.label || '컴포넌트', icon: def?.icon || '◈' })
  }

  const reset = () => {
    dragIdsRef.current = null
    dropRef.current = null
    setDragIds(null)
    setDragGhost(null)
    setInsertLine(null)
  }

  return {
    dragIds,
    isDragging,
    onDragStart,
    onDrag,
    onDragEnd,
    beginFromPointer,
    reset,
  }
}
