import { sortByPosition } from './store.js'

/* 캔버스 레이아웃 엔진 — 순수 함수 모음 */

export const PAD = 24
export const GAP = 14
export const MIN_ITEM_W = 160

/* 겹침 해소: 이동한 아이템(들)과 잠긴 아이템은 제자리를 지키고,
   겹치는 나머지 아이템들이 아래로 밀린다 */
export function resolveCollision(items, movedIds, heights) {
  const h = (it) => it.h || heights[it.id] || 80
  const movedSet = new Set(Array.isArray(movedIds) ? movedIds : [movedIds])
  const moved = items.filter((it) => movedSet.has(it.id))
  if (moved.length === 0) return items
  const lockedFixed = items.filter((it) => !movedSet.has(it.id) && it.locked)
  const others = items
    .filter((it) => !movedSet.has(it.id) && !it.locked)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const placed = [...moved, ...lockedFixed]
  for (const it of others) {
    const cur = { ...it }
    for (let guard = 0; guard < 100; guard++) {
      const hit = placed.find(
        (p) =>
          cur.x < p.x + p.w &&
          cur.x + cur.w > p.x &&
          cur.y < p.y + h(p) &&
          cur.y + h(cur) > p.y
      )
      if (!hit) break
      cur.y = hit.y + h(hit) + GAP
    }
    placed.push(cur)
  }
  return items.map((it) => placed.find((p) => p.id === it.id) || it)
}

/* 1단 세로 스택: y→x 순으로 전체 너비로 쌓기 */
export function layoutStack(items, heights, ctx) {
  const sorted = sortByPosition(items)
  let cursor = PAD
  const positioned = {}
  sorted.forEach((it) => {
    positioned[it.id] = { x: PAD, y: cursor, w: ctx.itemW }
    cursor += (it.h || heights[it.id] || 80) + GAP
  })
  return items.map((it) => ({ ...it, ...positioned[it.id] }))
}

/* 2단 그리드: 반폭으로 나눠 항상 짧은 열에 채우기 (마소너리) */
export function layoutTwoColumns(items, heights, ctx) {
  const colW = Math.floor((ctx.canvasW - PAD * 2 - GAP) / 2)
  const sorted = sortByPosition(items)
  const cols = [PAD, PAD] // 각 열의 다음 y 커서
  const positioned = {}
  sorted.forEach((it) => {
    const col = cols[0] <= cols[1] ? 0 : 1
    positioned[it.id] = {
      x: PAD + col * (colW + GAP),
      y: cols[col],
      w: colW,
    }
    cols[col] += (it.h || heights[it.id] || 80) + GAP
  })
  return items.map((it) => ({ ...it, ...positioned[it.id] }))
}

/* 위로 컴팩트: x/너비는 유지한 채 빈 공간 없이 위로 끌어올리기 (겹침도 함께 해소) */
export function layoutCompactUp(items, heights) {
  const h = (it) => it.h || heights[it.id] || 80
  const sorted = sortByPosition(items)
  const placed = []
  for (const it of sorted) {
    let y = PAD
    for (let guard = 0; guard < 200; guard++) {
      const hit = placed.find(
        (p) =>
          it.x < p.x + p.w &&
          it.x + it.w > p.x &&
          y < p.y + h(p) &&
          y + h(it) > p.y
      )
      if (!hit) break
      y = hit.y + h(hit) + GAP
    }
    placed.push({ ...it, y })
  }
  return items.map((it) => placed.find((p) => p.id === it.id) || it)
}

export const LAYOUT_MODES = [
  { key: 'stack', label: '1단 세로 정렬', desc: '전체 너비로 위에서부터 차곡차곡', fn: layoutStack },
  { key: 'twocol', label: '2단 그리드 정렬', desc: '반폭 2열 마소너리 배치', fn: layoutTwoColumns },
  { key: 'compact', label: '위로 컴팩트 정렬', desc: '크기·가로 위치 유지, 빈 공간만 제거', fn: (items, heights) => layoutCompactUp(items, heights) },
]

/* 다중 선택 정렬 도구 */
export function alignItems(items, selectedIds, mode, ctx, heights) {
  const sel = new Set(selectedIds)
  let updated = items
  if (mode === 'left') {
    const x = Math.min(...items.filter((it) => sel.has(it.id)).map((it) => it.x))
    updated = items.map((it) => (sel.has(it.id) ? { ...it, x } : it))
  } else if (mode === 'center') {
    updated = items.map((it) => (sel.has(it.id) ? { ...it, x: Math.round((ctx.canvasW - it.w) / 2) } : it))
  } else if (mode === 'right') {
    const right = Math.max(...items.filter((it) => sel.has(it.id)).map((it) => it.x + it.w))
    updated = items.map((it) => (sel.has(it.id) ? { ...it, x: right - it.w } : it))
  } else if (mode === 'vspace') {
    // 세로 간격 균등: 선택 순서(y)대로 표준 간격(GAP)으로 재배열
    const chosen = sortByPosition(items.filter((it) => sel.has(it.id)))
    let cursor = chosen.length ? chosen[0].y : PAD
    const pos = {}
    chosen.forEach((it) => {
      pos[it.id] = cursor
      cursor += (it.h || heights[it.id] || 80) + GAP
    })
    updated = items.map((it) => (sel.has(it.id) ? { ...it, y: pos[it.id] } : it))
  }
  return resolveCollision(updated, [...sel], heights)
}
