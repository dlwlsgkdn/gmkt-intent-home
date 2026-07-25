import { LIBRARY } from '../registry.jsx'

/*
 * 캔버스 좌표 계산 — 순수 함수만 둔다.
 *
 * "포인터가 어느 컨테이너의 어느 슬롯을 가리키는가"는 드래그·팔레트 드롭·레이어 트리가
 * 모두 물어보는 질문인데, 예전에는 Builder 안에서 컴포넌트 상태를 클로저로 붙잡은 채
 * 계산하고 있어 재사용도 검증도 불가능했다. 여기 있는 함수는 필요한 값을 전부 인자로 받는다.
 */

/* 컨테이너 삽입 ↔ 회피 구역 분리 (트리뷰의 drop-into/drop-between 패턴):
   컨테이너 세로 중앙부 = 삽입 존, 상/하 이 폭만큼의 밴드 = 밀어내기 존 */
export const NEST_EDGE_ZONE = 18

/* 컨테이너 가장자리 밴드 — 아이템이 얇으면 높이의 1/4까지만 */
export const edgeBand = (height) => Math.min(NEST_EDGE_ZONE, height / 4)

/* 표시 높이: 편집 모드의 컨테이너는 자식이 잘리지 않게 측정값과 지정값 중 큰 쪽을 쓴다 */
export function itemHeight(item, heights, { previewMode = false } = {}) {
  const measured = heights[item.id]
  if (!previewMode && LIBRARY[item.type]?.container) return Math.max(item.h || 0, measured || 0, 80)
  return item.h || measured || 80
}

/* (x, y)가 어떤 컨테이너의 삽입 존(중앙부) 안이면 그 컨테이너를 돌려준다 */
export function containerAt(topItems, x, y, { excludeId, heightOf } = {}) {
  return topItems.find((item) => {
    if (item.id === excludeId) return false
    if (!LIBRARY[item.type]?.container) return false
    const height = heightOf(item)
    const band = edgeBand(height)
    return x >= item.x && x <= item.x + item.w && y >= item.y + band && y <= item.y + height - band
  })
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

/* 최상위 아이템들의 아래쪽 끝 — 새 아이템을 스택 맨 밑에 붙일 때의 기준 */
export const stackBottom = (list, heightOf, top) =>
  list.filter((item) => !item.parentId).reduce((max, item) => Math.max(max, item.y + heightOf(item)), top)
