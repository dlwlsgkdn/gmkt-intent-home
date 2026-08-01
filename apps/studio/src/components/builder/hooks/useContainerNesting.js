import { LIBRARY } from '../../../lib/registry.jsx'
import { GAP, MIN_ITEM_W, PAD, layoutCompactUp } from '../../../lib/layout.js'
import { createItem } from '../../../lib/store.js'
import { placeChild, stackBottom } from '../../../lib/builder/geometry.js'

/*
 * 컨테이너(레이아웃 컴포넌트) 안의 자식을 다루는 조작들.
 *
 * 자식은 같은 아이템 배열에 parentId + slot으로 평평하게 저장된다. 캔버스 절대배치의
 * 대상이 아니므로 좌표 대신 슬롯 순서가 곧 배치이고, 그래서 조작 방식이 최상위 아이템과
 * 완전히 다르다 — 넣기·꺼내기·슬롯 재정렬이 전부 여기 모여 있다.
 *
 * 캔버스에서의 자식 드래그는 2단계다:
 *   클릭 = 선택 → 컨테이너 안에서 드래그 = 슬롯 재정렬 미리보기
 *   → 포인터가 컨테이너 박스를 벗어나면 자동으로 꺼내져 일반 드래그로 전환
 */
export function useContainerNesting({
  items,
  itemW,
  heightsRef,
  zoom,
  canvasRef,
  heightOf,
  layout,
  slotIndexOf,
  insertHintOf,
  setItems,
  setSelectedIds,
  onSelect,
  previewMode,
  showToast,
  drag,
  setDropTargetId,
  setInsertHint,
  setDraggingChildId,
  setChildDragGhost,
}) {
  /* 컨테이너 안에 자식으로 추가 — 팔레트 클릭/드래그, 인스펙터 모두 이 경로를 쓴다 */
  const addChild = (type, parentId, at) => {
    const def = LIBRARY[type]
    if (!def || def.container) {
      showToast('레이아웃 안에 레이아웃은 넣을 수 없어요.')
      return
    }
    const index = typeof at?.index === 'number'
      ? at.index
      : at?.cx != null
        ? slotIndexOf(parentId, at.containerType, at.cx, at.cy)
        : Infinity
    // 컨테이너 안 기본 너비: 컴포넌트 고유 기본값을 컨테이너 내부 폭에 맞춰 시작한다.
    // 최초 배치 때 한 번만 계산해 저장하므로 이후 컨테이너 리사이즈에는 영향받지 않는다.
    const contentEl = canvasRef.current?.querySelector(
      `[data-canvas-item-id="${parentId}"] > .sb-canvas-item__content`
    )
    let fitW = itemW
    if (contentEl) {
      const style = getComputedStyle(contentEl)
      fitW = Math.round(
        contentEl.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 10
      )
    }
    const w = Math.max(MIN_ITEM_W, Math.min(def.defaultW || 320, fitW))
    const item = { ...createItem(type, def.defaults), x: 0, y: 0, w }
    setItems((prev) => placeChild([...prev, item], item.id, parentId, index))
    setSelectedIds([item.id])
    showToast(`${def.label}을(를) 레이아웃 안에 배치했어요.`)
  }

  /* 컨테이너에서 꺼내 캔버스 맨 아래로 */
  const unnestItem = (id) => {
    setItems((prev) => {
      const bottom = stackBottom(prev, heightOf, PAD - GAP)
      const updated = prev.map((item) =>
        item.id === id
          ? { ...item, parentId: undefined, slot: undefined, x: PAD, y: bottom + GAP, w: Math.min(item.w || itemW, itemW) }
          : item
      )
      return layout.settle(updated, [id])
    })
    showToast('레이아웃에서 꺼내 캔버스 맨 아래에 놓았어요.')
  }

  const childPointerDown = (event, childId) => {
    if (previewMode || event.button !== 0) return
    if (event.target.closest && event.target.closest('.sb-inline-editor')) return
    event.stopPropagation()
    const child = items.find((item) => item.id === childId)
    if (!child) return
    const parent = items.find((item) => item.id === child.parentId)
    const startX = event.clientX
    const startY = event.clientY
    const shift = event.shiftKey
    if (!parent || child.locked) {
      onSelect(childId, shift)
      return
    }
    const w = Math.min(child.w || 320, itemW)
    const MARGIN = 18
    let phase = 'idle' // 'idle' → 'reorder'(컨테이너 안) → 'out'(꺼내진 일반 드래그)
    let lastSlot = -1

    const toCanvas = (moveEvent) => {
      const rect = canvasRef.current.getBoundingClientRect()
      return { cx: (moveEvent.clientX - rect.left) / zoom, cy: (moveEvent.clientY - rect.top) / zoom }
    }
    /* 부모 전체 박스를 경계로 쓴다. 제목·패딩·카드 사이 여백을 가로질러도
       의도치 않게 빠지지 않고, 박스를 명확히 벗어났을 때만 꺼낸다. */
    const insideParent = (clientX, clientY) => {
      const el = canvasRef.current?.querySelector(`[data-canvas-item-id="${parent.id}"]`)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return clientX >= r.left - MARGIN && clientX <= r.right + MARGIN
        && clientY >= r.top - MARGIN && clientY <= r.bottom + MARGIN
    }
    const popOut = (cx, cy) => {
      phase = 'out'
      setItems((prev) => prev.map((item) => (item.id === childId
        ? {
            ...item,
            parentId: undefined,
            slot: undefined,
            w,
            x: Math.max(0, Math.round(cx - w / 2)),
            y: Math.max(0, Math.round(cy - 20)),
          }
        : item)))
      setSelectedIds([childId])
      drag.clearDragStart() // 꺼낸 뒤에는 그룹 드래그가 아니라 단일 드래그로 이어진다
      setChildDragGhost(null)
    }

    const move = (moveEvent) => {
      if (phase === 'idle') {
        if (Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) <= 6) return
        phase = 'reorder'
        setSelectedIds([childId])
      }
      const { cx, cy } = toCanvas(moveEvent)
      if (phase === 'reorder') {
        if (insideParent(moveEvent.clientX, moveEvent.clientY)) {
          // 컨테이너 안: 구조는 고정하고 삽입 위치만 미리보기 — 놓을 때 한 번만 커밋한다
          setDropTargetId(parent.id)
          setDraggingChildId(childId)
          setChildDragGhost({
            x: moveEvent.clientX + 14,
            y: moveEvent.clientY + 14,
            label: LIBRARY[child.type]?.label || '컴포넌트',
            icon: LIBRARY[child.type]?.icon || '◈',
          })
          lastSlot = slotIndexOf(parent.id, parent.type, cx, cy, childId)
          setInsertHint(insertHintOf(parent, cx, cy, childId))
          return
        }
        // 컨테이너 밖 → 꺼내서 일반 드래그로 전환 (가이드/겹침/컴팩트 활성)
        setDropTargetId(null)
        setDraggingChildId(null)
        setInsertHint(null)
        popOut(cx, cy)
      }
      if (phase === 'out') {
        drag.onDrag(childId, cx - w / 2, cy - 20, moveEvent.clientX, moveEvent.clientY)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDraggingChildId(null)
      setChildDragGhost(null)
      setInsertHint(null)
      if (phase === 'out') drag.onDragEnd(childId)
      else if (phase === 'reorder') {
        setDropTargetId(null)
        if (lastSlot >= 0) setItems((prev) => placeChild(prev, childId, parent.id, lastSlot))
      } else onSelect(childId, shift)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /* 자식 리사이즈 핸들 — 바깥 컴포넌트와 동일하게 우하단 드래그로 조절 */
  const childResizeDown = (event, childId) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedIds([childId])
    const child = items.find((item) => item.id === childId)
    if (!child) return
    const shell = event.target.closest && event.target.closest('.sb-child')
    const rect = shell ? shell.getBoundingClientRect() : null
    const originW = child.w || (rect ? Math.round(rect.width / zoom) : 320)
    const originH = child.h || (rect ? Math.round(rect.height / zoom) : 120)
    const startX = event.clientX
    const startY = event.clientY
    const move = (moveEvent) => {
      const w = Math.max(MIN_ITEM_W, Math.min(itemW, Math.round(originW + (moveEvent.clientX - startX) / zoom)))
      const h = Math.max(48, Math.round(originH + (moveEvent.clientY - startY) / zoom))
      setItems((prev) => prev.map((item) => (item.id === childId ? { ...item, w, h } : item)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* 레이어 패널 순서 바꾸기 — 최상위는 자리 교환, 컨테이너 자식은 슬롯 교환 */
  const moveLayer = (id, dir) => {
    setItems((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target && target.parentId) {
        const siblings = prev
          .filter((item) => item.parentId === target.parentId)
          .sort((a, b) => (a.slot || 0) - (b.slot || 0))
        const index = siblings.findIndex((item) => item.id === id)
        const swapWith = index + dir
        if (index < 0 || swapWith < 0 || swapWith >= siblings.length) return prev
        const order = siblings.map((item) => item.id)
        ;[order[index], order[swapWith]] = [order[swapWith], order[index]]
        return prev.map((item) => {
          const k = order.indexOf(item.id)
          return k >= 0 ? { ...item, slot: k + 1 } : item
        })
      }
      return layout.withTopOnly(prev, (top) => {
        const sorted = [...top].sort((a, b) => (a.y - b.y) || (a.x - b.x))
        const index = sorted.findIndex((item) => item.id === id)
        const swapWith = index + dir
        if (index < 0 || swapWith < 0 || swapWith >= sorted.length) return top
        const a = sorted[index]
        const b = sorted[swapWith]
        const swapped = top.map((item) =>
          item.id === a.id ? { ...item, x: b.x, y: b.y }
            : item.id === b.id ? { ...item, x: a.x, y: a.y }
              : item
        )
        return layoutCompactUp(swapped, heightsRef.current)
      })
    })
  }

  /* 레이어 트리 드래그 — 캔버스에서 잡기 어려운 중첩 구조를 정밀하게 바꾼다 */
  const dropLayer = (id, targetId, placement) => {
    const source = items.find((item) => item.id === id)
    const target = items.find((item) => item.id === targetId)
    if (!source || !target || source.id === target.id || source.locked) return

    if (placement === 'inside') {
      if (!LIBRARY[target.type]?.container || LIBRARY[source.type]?.container) {
        showToast('레이아웃 안에는 일반 컴포넌트만 넣을 수 있어요.')
        return
      }
      setItems((prev) => placeChild(prev, id, targetId, Infinity))
      setSelectedIds([id])
      showToast(`${LIBRARY[source.type]?.label}을(를) ${LIBRARY[target.type]?.label} 안에 배치했어요.`)
      return
    }

    if (target.parentId) {
      if (LIBRARY[source.type]?.container) {
        showToast('레이아웃 안에 레이아웃은 넣을 수 없어요.')
        return
      }
      setItems((prev) => {
        const siblings = prev
          .filter((item) => item.parentId === target.parentId && item.id !== id)
          .sort((a, b) => (a.slot || 0) - (b.slot || 0))
        const targetIndex = siblings.findIndex((item) => item.id === targetId)
        return placeChild(prev, id, target.parentId, Math.max(0, targetIndex + (placement === 'after' ? 1 : 0)))
      })
      setSelectedIds([id])
      return
    }

    // 최상위끼리는 캔버스 자리 집합을 유지한 채 순서만 바꾼다
    if (!source.parentId) {
      setItems((prev) => {
        const sorted = [...prev.filter((item) => !item.parentId)].sort((a, b) => (a.y - b.y) || (a.x - b.x))
        const slots = sorted.map((item) => ({ x: item.x, y: item.y }))
        const order = sorted.filter((item) => item.id !== id).map((item) => item.id)
        const targetIndex = order.indexOf(targetId)
        order.splice(Math.max(0, targetIndex + (placement === 'after' ? 1 : 0)), 0, id)
        return prev.map((item) => {
          const index = order.indexOf(item.id)
          return index >= 0 ? { ...item, ...slots[index] } : item
        })
      })
      setSelectedIds([id])
    }
  }

  return { addChild, unnestItem, childPointerDown, childResizeDown, moveLayer, dropLayer }
}
