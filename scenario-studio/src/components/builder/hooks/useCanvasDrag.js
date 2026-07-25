import { useRef, useState } from 'react'
import { LIBRARY } from '../../../lib/registry.jsx'
import { GAP, MIN_ITEM_W, PAD, previewResolve, compactItems } from '../../../lib/layout.js'
import { containerAt, edgeBand, placeChild } from '../../../lib/builder/geometry.js'

/*
 * 캔버스 드래그·리사이즈 기계.
 *
 * 여기서 다루는 어려운 문제는 하나다: "드래그 중 주변 아이템이 언제, 얼마나 비켜나는가".
 * 겹치자마자 밀면 캔버스가 계속 출렁이고, 아예 안 밀면 자리를 만들 수 없다. 그래서
 *
 *   1) 지속시간 게이트 — 깊은 겹침이 일정 시간 유지된 아이템만 밀림을 허용한다.
 *      스치듯 지나가면 아무것도 움직이지 않는다.
 *   2) 히스테리시스 — 한 번 밀린 아이템은 겹침이 훨씬 낮아질 때까지 밀린 상태를 유지한다.
 *      (진입 45% / 유지 15%) 빈자리로 조금 파고들 때마다 되돌아오는 떨림을 막는다.
 *   3) 삽입 존 보호 — 컨테이너 세로 중앙부는 "안에 넣기" 구역이라 밀리지 않고,
 *      상/하 가장자리 밴드에서만 컨테이너가 비켜난다.
 *   4) WYSIWYG 커밋 — 드롭은 마지막 미리보기 레이아웃을 그대로 반영한다.
 *      미리보기와 다른 결과가 나오지 않는다.
 *
 * 이 규칙을 화면 렌더(displayItems)와 커밋(onDragEnd)이 함께 써야 하므로 한 훅에 둔다.
 */

const SNAP = 6
/* 밀림 진입 임계(겹침 면적 비율)와 그 상태를 유지해야 하는 시간 */
const DRAG_SOFT_RATIO = 0.45
const DRAG_PUSH_DELAY_MS = 250
const CONTAINER_SOFT_RATIO = 0.45
const CONTAINER_PUSH_DELAY_MS = 400
/* 밀림 유지 임계 — 이 아래로 떨어져야 원위치로 돌아간다 (히스테리시스) */
const PUSH_EXIT_RATIO = 0.15
/* 미리보기 재배치 갱신 간격 — 드래그 아이템 자체는 즉시 따라온다 */
const DRAG_PREVIEW_MS = 250

export function useCanvasDrag({
  items,
  topItems,
  itemW,
  canvasW,
  zoom,
  canvasRef,
  heightsRef,
  heightOf,
  layout,
  slotIndexOf,
  insertHintOf,
  setItems,
  setSelectedIds,
  selectedIds,
  setDropTargetId,
  setInsertHint,
  showToast,
}) {
  const [dragPos, setDragPos] = useState(null) // { id, positions: {id:{x,y}}, pointer }
  const [dragLayoutPos, setDragLayoutPos] = useState(null) // 스로틀된 미리보기 기준 위치
  const [sizeDraft, setSizeDraft] = useState(null) // { id, w, h }
  const [guides, setGuides] = useState([]) // 스냅 가이드라인

  const dragPosRef = useRef(null)
  const dragLayoutPosRef = useRef(null)
  const dragLayoutTimerRef = useRef(null)
  const dragStartRef = useRef(null) // 그룹 드래그 시작 시점의 위치들
  const pushGateRef = useRef({}) // { 아이템id: 밀림이 허용되는 시각 }
  const pushReadyRef = useRef(new Set()) // 지속시간을 채워 밀림이 허용된 아이템
  const pushWakeRef = useRef(null) // 지속시간 경과 시점에 재렌더를 깨우는 타이머
  const dragBlockedRef = useRef(new Set()) // 밀 자리가 없어 제자리에 남은 아이템
  const previewLayoutRef = useRef(null) // 마지막 미리보기 레이아웃 — 드롭 커밋의 기준
  const sizeDraftRef = useRef(null)

  const isDragging = () => !!dragPosRef.current || !!sizeDraftRef.current

  /* 게이트를 현재 시각 기준으로 다시 계산하고, 아직 대기 중인 게 있으면 그 시점에 재렌더를 깨운다 */
  const refreshPushGate = () => {
    const now = Date.now()
    const gate = pushGateRef.current
    const ready = new Set()
    let nextWake = Infinity
    Object.entries(gate).forEach(([itemId, at]) => {
      if (now >= at) ready.add(itemId)
      else nextWake = Math.min(nextWake, at - now)
    })
    pushReadyRef.current = ready
    if (nextWake < Infinity && !pushWakeRef.current) {
      pushWakeRef.current = setTimeout(() => {
        pushWakeRef.current = null
        if (!dragPosRef.current) return // 이미 드롭됨
        refreshPushGate()
        dragLayoutPosRef.current = dragPosRef.current
        setDragLayoutPos({ ...dragPosRef.current }) // 새 객체로 재렌더 유도
      }, nextWake + 16)
    }
  }

  /* 드래그 아이템은 즉시, 겹침 회피 미리보기 기준 위치는 간격을 두고 발행 */
  const publishDragPos = (pos) => {
    dragPosRef.current = pos
    setDragPos(pos)
    if (!dragLayoutPosRef.current) {
      dragLayoutPosRef.current = pos
      setDragLayoutPos(pos)
    } else if (!dragLayoutTimerRef.current) {
      dragLayoutTimerRef.current = setTimeout(() => {
        dragLayoutTimerRef.current = null
        if (!dragPosRef.current) return
        dragLayoutPosRef.current = dragPosRef.current
        setDragLayoutPos(dragPosRef.current)
      }, DRAG_PREVIEW_MS)
    }
  }

  /* 컨테이너에서 꺼내진 자식처럼 그룹 없이 시작하는 드래그 — 이전 그룹 기록을 지운다 */
  const clearDragStart = () => { dragStartRef.current = null }

  /* 그룹 드래그: 시작 시점에 선택 그룹(잠긴 것 제외)의 원래 위치를 기록 */
  const onGroupDragStart = (id) => {
    const groupIds = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
    const positions = {}
    items.forEach((item) => {
      if (groupIds.includes(item.id) && !item.locked) positions[item.id] = { x: item.x, y: item.y }
    })
    dragStartRef.current = { primary: id, positions }
  }

  /* 스마트 스냅 후보: 캔버스 가장자리·중앙과 다른 아이템의 모서리·간격 */
  const snapPosition = (id, x, y, w, h) => {
    let nx = Math.max(0, Math.min(canvasW - w, x))
    let ny = Math.max(0, y)
    const activeGuides = []

    const vertical = [
      [PAD, PAD],
      [(canvasW - w) / 2, canvasW / 2],
      [canvasW - PAD - w, canvasW - PAD],
    ]
    topItems.forEach((other) => {
      if (other.id === id) return
      vertical.push([other.x, other.x], [other.x + other.w - w, other.x + other.w])
    })
    for (const [candidate, line] of vertical) {
      if (Math.abs(nx - candidate) <= SNAP) {
        nx = candidate
        activeGuides.push({ type: 'v', pos: line })
        break
      }
    }

    const horizontal = [[PAD, PAD]]
    topItems.forEach((other) => {
      if (other.id === id) return
      const oh = heightOf(other)
      horizontal.push([other.y, other.y], [other.y + oh + GAP, other.y + oh + GAP], [other.y - h - GAP, other.y - GAP / 2])
    })
    for (const [candidate, line] of horizontal) {
      if (candidate >= 0 && Math.abs(ny - candidate) <= SNAP) {
        ny = candidate
        activeGuides.push({ type: 'h', pos: line })
        break
      }
    }
    return { nx, ny, guides: activeGuides }
  }

  /* 겹침 지속시간 추적 — 임계 이상 겹친 아이템에만 deadline을 걸고, 조건이 깨지면 즉시 리셋 */
  const trackPushGate = (id, box, probe, draggedIsContainer) => {
    const gate = pushGateRef.current
    const now = Date.now()
    topItems.forEach((other) => {
      if (other.id === id) return
      const isContainer = !!LIBRARY[other.type]?.container
      const oh = heightOf(other)
      const band = edgeBand(oh)
      // 삽입 가능한 드래그에서 포인터가 컨테이너 중앙부(삽입 존)에 있으면 밀림에서 보호한다
      const guarded =
        isContainer && !draggedIsContainer &&
        probe.x >= other.x && probe.x <= other.x + other.w &&
        probe.y >= other.y + band && probe.y <= other.y + oh - band
      const ox = Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x)
      const oy = Math.min(box.y + box.h, other.y + oh) - Math.max(box.y, other.y)
      const area = ox > 0 && oy > 0 ? ox * oy : 0
      const minArea = Math.min(box.w * box.h, other.w * oh)
      const enterRatio = isContainer ? CONTAINER_SOFT_RATIO : DRAG_SOFT_RATIO
      // 이미 밀린 아이템은 삽입 존 보호를 무시하고 낮은 유지 임계로 밀림을 지속한다
      const holds = pushReadyRef.current.has(other.id)
        ? area >= PUSH_EXIT_RATIO * minArea
        : area >= enterRatio * minArea && !guarded
      if (holds) {
        if (!gate[other.id]) gate[other.id] = now + (isContainer ? CONTAINER_PUSH_DELAY_MS : DRAG_PUSH_DELAY_MS)
      } else {
        delete gate[other.id]
      }
    })
    refreshPushGate()
  }

  const onDrag = (id, x, y, clientX, clientY) => {
    // 포인터의 캔버스 좌표 — 컨테이너 드롭 판정에 아이템 중심보다 정확하다
    const pointer =
      clientX != null && canvasRef.current
        ? (() => {
            const rect = canvasRef.current.getBoundingClientRect()
            return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
          })()
        : null
    const start = dragStartRef.current
    const groupIds = start ? Object.keys(start.positions) : [id]

    // 다중 선택 그룹 이동: 스냅·중첩 없이 함께 움직인다
    if (start && groupIds.length > 1) {
      const dx = x - start.positions[id].x
      const dy = y - start.positions[id].y
      const positions = {}
      groupIds.forEach((key) => {
        const item = items.find((candidate) => candidate.id === key)
        const w = item ? item.w : itemW
        positions[key] = {
          x: Math.max(0, Math.min(canvasW - w, start.positions[key].x + dx)),
          y: Math.max(0, start.positions[key].y + dy),
        }
      })
      publishDragPos({ id, positions })
      setGuides([])
      setDropTargetId(null)
      setInsertHint(null)
      return
    }

    const item = items.find((candidate) => candidate.id === id)
    const w = item ? item.w : itemW
    const h = item ? heightOf(item) : 80
    const { nx, ny, guides: activeGuides } = snapPosition(id, x, y, w, h)
    setGuides(activeGuides)

    // 컨테이너 위에 있으면 "안에 배치" 하이라이트 + 삽입 위치 가이드
    const probe = pointer || { x: nx + w / 2, y: ny + h / 2 }
    const draggedIsContainer = !!LIBRARY[item?.type]?.container
    const hoverRaw = draggedIsContainer ? null : containerAt(topItems, probe.x, probe.y, { excludeId: id, heightOf })
    // 밀려나 있는 컨테이너는 삽입 대상에서 제외 — 비워진 원래 자리는 순수한 빈자리로 취급
    const hover = hoverRaw && !pushReadyRef.current.has(hoverRaw.id) ? hoverRaw : null
    setDropTargetId(hover ? hover.id : null)
    setInsertHint(hover ? insertHintOf(hover, probe.x, probe.y) : null)

    trackPushGate(id, { x: nx, y: ny, w, h }, probe, draggedIsContainer)
    publishDragPos({ id, positions: { [id]: { x: nx, y: ny } }, pointer: probe })
  }

  /* 드래그 중 상태를 전부 정리하고, 커밋에 필요한 값만 뽑아 돌려준다 */
  const finishDrag = () => {
    const snapshot = {
      pos: dragPosRef.current,
      pushedIds: new Set(pushReadyRef.current),
      blocked: dragBlockedRef.current.size > 0,
      previewPos: previewLayoutRef.current,
    }
    previewLayoutRef.current = null
    dragBlockedRef.current = new Set()
    dragPosRef.current = null
    dragStartRef.current = null
    clearTimeout(dragLayoutTimerRef.current)
    dragLayoutTimerRef.current = null
    clearTimeout(pushWakeRef.current)
    pushWakeRef.current = null
    pushGateRef.current = {}
    pushReadyRef.current = new Set()
    dragLayoutPosRef.current = null
    setDragLayoutPos(null)
    setGuides([])
    setDropTargetId(null)
    setInsertHint(null)
    return snapshot
  }

  /* 드롭 지점이 컨테이너의 삽입 존이면 그 컨테이너 — 드래그 중 하이라이트와 같은 기준 */
  const dropTargetFor = (list, draggedId, cx, cy, pushedIds) =>
    list.find((candidate) => {
      if (candidate.id === draggedId || candidate.parentId || !LIBRARY[candidate.type]?.container) return false
      if (pushedIds.has(candidate.id)) return false // 밀려나 있던 컨테이너의 빈자리는 배치로 처리
      const height = heightOf(candidate)
      const band = edgeBand(height)
      return cx >= candidate.x && cx <= candidate.x + candidate.w
        && cy >= candidate.y + band && cy <= candidate.y + height - band
    })

  const onDragEnd = (id) => {
    const { pos, pushedIds, blocked, previewPos } = finishDrag()
    // 진행 중인 React 렌더와 커밋이 겹치지 않도록 다음 틱으로 미룬다
    setTimeout(() => {
      if (pos && pos.id === id && blocked) {
        // 커밋하지 않고 미리보기만 해제 → 드래그 아이템이 원래 자리로 돌아간다
        showToast('밀어낼 자리가 없어 원래 위치로 되돌렸어요.')
        setDragPos(null)
        return
      }
      if (pos && pos.id === id) {
        setItems((prev) => {
          const draggedIds = Object.keys(pos.positions)

          // 단일 드래그를 컨테이너 삽입 존에 놓으면 자식으로 배치
          if (draggedIds.length === 1) {
            const draggedId = draggedIds[0]
            const dragged = prev.find((item) => item.id === draggedId)
            if (dragged && !LIBRARY[dragged.type]?.container) {
              const dropped = pos.positions[draggedId]
              const cx = pos.pointer ? pos.pointer.x : dropped.x + dragged.w / 2
              const cy = pos.pointer ? pos.pointer.y : dropped.y + heightOf(dragged) / 2
              const target = dropTargetFor(prev, draggedId, cx, cy, pushedIds)
              if (target) {
                const index = slotIndexOf(target.id, target.type, cx, cy)
                showToast(`${LIBRARY[dragged.type]?.label}을(를) ${LIBRARY[target.type]?.label} 안에 배치했어요.`)
                // 드롭 직후 컴팩트가 대상 컨테이너를 다시 움직이지 않도록 자리를 고정한다
                return layout.settle(placeChild(prev, draggedId, target.id, index), [target.id])
              }
            }
          }

          // 회피가 발동하지 않은 겹침 상태로는 배치 불가 — 커밋하지 않고 원위치 복귀.
          // (회피로 밀린 아이템은 미리보기 위치 기준이라 겹침으로 계산되지 않는다)
          const overlapped = prev.some((item) => {
            if (item.parentId || pos.positions[item.id]) return false
            const at = (previewPos && previewPos[item.id]) || item
            const height = heightOf(item)
            return draggedIds.some((draggedId) => {
              const dragged = prev.find((candidate) => candidate.id === draggedId)
              if (!dragged) return false
              const dropped = pos.positions[draggedId]
              return dropped.x < at.x + item.w && dropped.x + dragged.w > at.x
                && dropped.y < at.y + height && dropped.y + heightOf(dragged) > at.y
            })
          })
          if (overlapped) {
            showToast('겹친 채로는 배치할 수 없어 원래 위치로 되돌렸어요.')
            return prev
          }

          // 드래그 아이템은 최종 드롭 위치, 나머지는 미리보기에서 밀린 위치로 커밋 —
          // 드롭 결과가 미리보기 화면과 정확히 같아진다
          const moved = prev.map((item) => {
            if (pos.positions[item.id]) return { ...item, ...pos.positions[item.id] }
            if (!item.parentId && previewPos && previewPos[item.id]) return { ...item, ...previewPos[item.id] }
            return item
          })
          return layout.settle(moved, draggedIds)
        })
      }
      setDragPos(null)
    }, 0)
  }

  /* ── 리사이즈 ── */

  const onResize = (id, w, h) => {
    const draft = {
      id,
      w: Math.max(MIN_ITEM_W, Math.min(itemW, Math.round(w))),
      h: Math.max(48, Math.round(h)),
    }
    sizeDraftRef.current = draft
    setSizeDraft(draft)
  }

  const onResizeEnd = (id) => {
    const draft = sizeDraftRef.current
    sizeDraftRef.current = null
    setTimeout(() => {
      if (draft && draft.id === id) {
        heightsRef.current[id] = draft.h
        setItems((prev) => layout.settle(
          prev.map((item) => (item.id === id
            ? { ...item, w: draft.w, h: draft.h, x: Math.min(item.x, canvasW - draft.w) }
            : item)),
          id
        ))
      }
      setSizeDraft(null)
    }, 0)
  }

  /* 인스펙터에서 크기를 바꿔도 같은 관문(settle)을 통과시킨다 */
  const setSize = (id, patch) => {
    if (patch.h != null) heightsRef.current[id] = patch.h
    setItems((prev) => layout.settle(
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      id
    ))
  }

  /* 방향키 미세 이동 (다중 선택 지원, 잠긴 것·자식 제외) */
  const nudgeSelected = (dx, dy) => {
    const ids = new Set(
      items.filter((item) => selectedIds.includes(item.id) && !item.locked && !item.parentId).map((item) => item.id)
    )
    if (ids.size === 0) return
    setItems((prev) => layout.settle(
      prev.map((item) => (ids.has(item.id)
        ? {
            ...item,
            x: Math.max(0, Math.min(canvasW - item.w, item.x + dx)),
            y: Math.max(0, item.y + dy),
          }
        : item)),
      [...ids]
    ))
  }

  /* 드래그 중 화면에 그릴 아이템 목록 — 게이트를 통과한 아이템만 밀림에 참여한다.
     이 결과를 previewLayoutRef에 남겨 두면 드롭 커밋이 그대로 재사용한다(WYSIWYG). */
  const decorateForDrag = (list) => {
    if (!dragPos) return list
    const layoutPos = dragLayoutPos || dragPos
    const moved = list.map((item) =>
      layoutPos.positions[item.id] ? { ...item, ...layoutPos.positions[item.id] } : item
    )
    const draggedIds = Object.keys(dragPos.positions)
    return layout.withTopOnly(moved, (top) => {
      // 게이트 통과 아이템만 드래그 박스에서 밀리고, 밀린 아이템이 덮친 아이템은 연쇄로 밀린다.
      // 잠긴 아이템에 막혀 자리가 없으면 제자리 유지 → 드롭 시 드래그가 원위치로 돌아간다
      const { items: resolvedTop, displacedIds, blockedIds } = previewResolve(
        top, draggedIds, pushReadyRef.current, heightsRef.current
      )
      dragBlockedRef.current = blockedIds
      const remember = (finalTop) => {
        previewLayoutRef.current = Object.fromEntries(
          finalTop.filter((item) => !draggedIds.includes(item.id)).map((item) => [item.id, { x: item.x, y: item.y }])
        )
        return finalTop
      }
      if (!layout.compactOn) return remember(resolvedTop)
      // 밀림이 시작된 뒤에는 나머지도 함께 재배치(연쇄 스택 이동) — 먼 아이템이 중간을
      // 건너뛰어 빈자리로 순간이동하지 않는다. 아무도 안 밀렸으면 전원 제자리 고정.
      const pinnedIds = displacedIds.size > 0
        ? top.filter((item) => draggedIds.includes(item.id) || blockedIds.has(item.id)).map((item) => item.id)
        : top.map((item) => item.id)
      return remember(compactItems(resolvedTop, heightsRef.current, layout.options(pinnedIds)))
    })
  }

  const reset = () => {
    setDragPos(null)
    setSizeDraft(null)
    setGuides([])
    dragPosRef.current = null
    sizeDraftRef.current = null
  }

  return {
    dragPos,
    sizeDraft,
    guides,
    isDragging,
    onGroupDragStart,
    clearDragStart,
    onDrag,
    onDragEnd,
    onResize,
    onResizeEnd,
    setSize,
    nudgeSelected,
    decorateForDrag,
    reset,
  }
}
