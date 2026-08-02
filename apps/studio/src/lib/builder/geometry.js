import { LIBRARY } from '../registry.jsx'

/*
 * 스택 캔버스의 순서·슬롯 계산 — 순수 함수만 둔다.
 *
 * 아이템 모델은 순서 기반이다(배열 순서 = 최상위 렌더 순서, 자식은 parentId + slot).
 * "포인터가 어느 위치를 가리키는가"는 모델 좌표가 아니라 실제 렌더된 DOM rect로 판정한다 —
 * 드래그 재정렬·팔레트 드롭·컨테이너 삽입이 전부 같은 질문을 하므로 여기 모아 둔다.
 * 필요한 값(canvasEl·zoom·아이템 목록)은 전부 인자로 받는다.
 */

/* 컨테이너 자식 카드의 최소 너비 (자식 리사이즈·AI 가져오기 검증 공용) */
export const MIN_ITEM_W = 160

/* 컨테이너 삽입 존: 상/하 이 폭만큼의 밴드를 제외한 중앙부에서만 "안에 배치"로 판정 */
export const NEST_EDGE_ZONE = 18

/* 최상위 아이템의 DOM 노드들 — 캔버스 스택 순서 그대로 */
const topItemEls = (canvasEl, excludeIds) =>
  [...canvasEl.querySelectorAll('[data-canvas-item-id]')]
    .filter((el) => !excludeIds || !excludeIds.has(el.dataset.canvasItemId))

/* 포인터(화면 좌표)가 가리키는 최상위 삽입 인덱스(0-base) —
   각 아이템 rect의 세로 중심과 비교한다. excludeIds(드래그 중인 아이템)는 계산에서 뺀다 */
export function topInsertIndexAt({ canvasEl, clientY, excludeIds }) {
  if (!canvasEl) return 0
  let index = 0
  topItemEls(canvasEl, excludeIds).forEach((el) => {
    const rect = el.getBoundingClientRect()
    if (clientY > rect.top + rect.height / 2) index++
  })
  return index
}

/* 최상위 삽입 인덱스 → 캔버스 좌표의 가이드 라인 { x, y, len }. 아이템이 없으면 null */
export function topInsertLineAt({ canvasEl, zoom, index, excludeIds }) {
  if (!canvasEl) return null
  const els = topItemEls(canvasEl, excludeIds)
  if (els.length === 0) return null
  const rect = canvasEl.getBoundingClientRect()
  const target = els[Math.min(index, els.length - 1)].getBoundingClientRect()
  const after = index >= els.length
  const sy = after ? target.bottom + 6 : target.top - 6
  return {
    x: (target.left - rect.left) / zoom,
    y: (sy - rect.top) / zoom,
    len: target.width / zoom,
  }
}

/* 포인터(화면 좌표)가 어떤 컨테이너의 삽입 존(중앙부) 안이면 그 아이템을 돌려준다.
   판정은 렌더된 DOM rect 기준 — 상/하 가장자리 밴드는 "사이에 놓기"로 남겨 둔다 */
export function containerAtClient({ canvasEl, items, clientX, clientY, excludeId }) {
  if (!canvasEl) return null
  for (const el of topItemEls(canvasEl)) {
    const id = el.dataset.canvasItemId
    if (id === excludeId) continue
    const item = items.find((candidate) => candidate.id === id)
    if (!item || !LIBRARY[item.type]?.container) continue
    const rect = el.getBoundingClientRect()
    const band = Math.min(NEST_EDGE_ZONE, rect.height / 4)
    if (
      clientX >= rect.left && clientX <= rect.right
      && clientY >= rect.top + band && clientY <= rect.bottom - band
    ) return item
  }
  return null
}

/* 포인터(캔버스 좌표)가 가리키는 컨테이너 안 삽입 위치(0-base) — 자식 슬롯 DOM과 비교한다.
   흐름(세로/가로/그리드)에 따라 비교 기준이 다르다. */
export function slotIndexAt({ canvasEl, zoom, containerId, containerType, cx, cy, excludeId }) {
  if (!canvasEl) return Infinity
  const rect = canvasEl.getBoundingClientRect()
  const px = rect.left + cx * zoom
  const py = rect.top + cy * zoom
  const els = [...canvasEl.querySelectorAll(`[data-child-of="${containerId}"]`)]
    .filter((el) => el.dataset.childId !== excludeId)
  const flow = LIBRARY[containerType]?.flow

  if (flow === 'grid') {
    const rows = []
    els.forEach((el, index) => {
      const r = el.getBoundingClientRect()
      let row = rows.find((candidate) => Math.abs(candidate.top - r.top) <= 8)
      if (!row) {
        row = { top: r.top, bottom: r.bottom, cells: [] }
        rows.push(row)
      }
      row.bottom = Math.max(row.bottom, r.bottom)
      row.cells.push({ index, rect: r })
    })
    if (rows.length === 0) return 0
    const row = rows.find((candidate) => py <= candidate.bottom) || rows[rows.length - 1]
    const before = row.cells.find((cell) => px <= cell.rect.left + cell.rect.width / 2)
    return before ? before.index : row.cells[row.cells.length - 1].index + 1
  }

  const horizontal = flow === 'x'
  let index = 0
  els.forEach((el) => {
    const r = el.getBoundingClientRect()
    const center = horizontal ? r.left + r.width / 2 : r.top + r.height / 2
    if ((horizontal ? px : py) > center) index++
  })
  return index
}

/* 삽입 위치 가이드 라인 (Notion/Framer식 인서트 캐럿) — 캔버스 좌표 */
export function insertHintAt({ canvasEl, zoom, container, cx, cy, excludeId }) {
  if (!canvasEl || !container) return null
  const els = [...canvasEl.querySelectorAll(`[data-child-of="${container.id}"]`)]
    .filter((el) => el.dataset.childId !== excludeId)
  if (els.length === 0) return null
  const rect = canvasEl.getBoundingClientRect()
  const flow = LIBRARY[container.type]?.flow
  const inline = flow === 'x' || flow === 'grid'
  const index = slotIndexAt({
    canvasEl, zoom, containerId: container.id, containerType: container.type, cx, cy, excludeId,
  })
  const target = els[Math.min(index, els.length - 1)].getBoundingClientRect()
  const after = index >= els.length
  if (inline) {
    const sx = after ? target.right + 6 : target.left - 6
    return { dir: 'v', x: (sx - rect.left) / zoom, y: (target.top - rect.top) / zoom, len: target.height / zoom }
  }
  const sy = after ? target.bottom + 6 : target.top - 6
  return { dir: 'h', x: (target.left - rect.left) / zoom, y: (sy - rect.top) / zoom, len: target.width / zoom }
}

/* childId를 containerId의 index 위치에 끼워 넣고 형제 슬롯을 1..n으로 재부여 */
export function placeChild(list, childId, containerId, index) {
  const siblings = list
    .filter((item) => item.parentId === containerId && item.id !== childId)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
  const order = siblings.map((item) => item.id)
  order.splice(Math.max(0, Math.min(order.length, index)), 0, childId)
  return list.map((item) => {
    const k = order.indexOf(item.id)
    return k >= 0 ? { ...item, parentId: containerId, slot: k + 1 } : item
  })
}

/* 컨테이너의 다음 빈 슬롯 번호 */
export const nextSlot = (list, parentId) =>
  list.filter((item) => item.parentId === parentId).reduce((max, item) => Math.max(max, item.slot || 0), 0) + 1

/* 최상위 아이템(들)을 지정 인덱스로 재배열 — index는 "이동 아이템을 뺀 나머지" 기준이다
   (topInsertIndexAt의 excludeIds와 같은 기준). 자식은 배열 끝에 그대로 통과한다 */
export function reorderTop(list, movedIds, index) {
  const movedSet = new Set(Array.isArray(movedIds) ? movedIds : [movedIds])
  const moved = list.filter((item) => !item.parentId && movedSet.has(item.id))
  if (moved.length === 0) return list
  const rest = list.filter((item) => !item.parentId && !movedSet.has(item.id))
  const children = list.filter((item) => item.parentId)
  const at = Math.max(0, Math.min(rest.length, index))
  return [...rest.slice(0, at), ...moved, ...rest.slice(at), ...children]
}

/* 최상위에서의 순서 인덱스 (자식이면 -1) */
export const topIndexOf = (list, id) =>
  list.filter((item) => !item.parentId).findIndex((item) => item.id === id)
