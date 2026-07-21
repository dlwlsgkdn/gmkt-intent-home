import { sortByPosition } from './store.js'

/* 캔버스 레이아웃 엔진 — 순수 함수 모음 */

export const PAD = 24
export const GAP = 14
export const MIN_ITEM_W = 160

/* 공용: box가 placed 중 하나와 겹치면 그 아이템을 반환.
   soft = { ids, ratio }를 주면 ids에 속한 박스(드래그 중인 아이템)와는
   겹침 면적이 작은 쪽 면적의 ratio 이상일 때만 충돌로 판정한다 —
   드래그 미리보기에서 스치기만 해도 밀려나는 과민 반응을 둔화시키는 용도 */
const hitOf = (placed, box, h, soft) =>
  placed.find((p) => {
    const ox = Math.min(box.x + box.w, p.x + p.w) - Math.max(box.x, p.x)
    const oy = Math.min(box.y + h(box), p.y + h(p)) - Math.max(box.y, p.y)
    if (ox <= 0 || oy <= 0) return false
    if (soft && soft.ids.has(p.id)) {
      const minArea = Math.min(box.w * h(box), p.w * h(p))
      return ox * oy >= (soft.ratio || 0.35) * minArea
    }
    return true
  })

/* 겹침 해소: 이동한 아이템(들)과 잠긴 아이템은 제자리를 지키고,
   겹치는 나머지 아이템들이 아래로 밀린다.
   soft(hitOf 참고)는 드래그 미리보기 전용 — 커밋 경로에서는 넘기지 말 것 */
export function resolveCollision(items, movedIds, heights, soft) {
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
      const hit = hitOf(placed, cur, h, soft)
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

/* 위로 컴팩트: compactItems(vertical)의 별칭 — 자동 정렬/레이어 순서 변경에서 사용 */
export function layoutCompactUp(items, heights) {
  return compactItems(items, heights, { direction: 'vertical' })
}

/* 컴팩트(compact) — react-grid-layout의 compactType 컨벤션.
   direction: 'vertical'(위로 스택) | 'horizontal'(왼쪽으로 스택) | 'none'
   핀(드래그 중)·잠금 아이템은 제자리에 두고 나머지를 스택시킨다 (겹침도 함께 해소) */
export const COMPACT_TYPES = [
  { key: 'vertical', label: '세로 컴팩트', desc: '컴포넌트가 위로 차곡차곡 붙어요 (기본)' },
  { key: 'horizontal', label: '가로 컴팩트', desc: '같은 줄에서 왼쪽으로 붙어요' },
  { key: 'none', label: '컴팩트 끄기', desc: '빈 공간을 두고 자유롭게 배치해요' },
]

export function compactItems(items, heights, { direction = 'vertical', pinnedIds = [], canvasW = Infinity, soft = null } = {}) {
  if (direction === 'none') return items
  const h = (it) => it.h || heights[it.id] || 80
  const overlaps = (placed, box) => hitOf(placed, box, h, soft)
  const pinned = new Set(pinnedIds)
  const fixed = items.filter((it) => pinned.has(it.id) || it.locked)
  const movableSrc = items.filter((it) => !pinned.has(it.id) && !it.locked)
  const movable =
    direction === 'horizontal'
      ? [...movableSrc].sort((a, b) => (a.x - b.x) || (a.y - b.y))
      : sortByPosition(movableSrc)
  const placed = [...fixed]

  for (const it of movable) {
    if (direction === 'horizontal') {
      // 같은 세로 구간(줄)에서 왼쪽으로 당긴다. 줄이 꽉 차면 x는 유지하고 세로 겹침만 해소
      let x = PAD
      let overflow = false
      for (let guard = 0; guard < 200; guard++) {
        const hit = overlaps(placed, { ...it, x })
        if (!hit) break
        x = hit.x + hit.w + GAP
        if (x + it.w > canvasW - PAD) {
          overflow = true
          break
        }
      }
      if (!overflow) {
        placed.push({ ...it, x })
      } else {
        let y = it.y
        for (let guard = 0; guard < 200; guard++) {
          const hit = overlaps(placed, { ...it, y })
          if (!hit) break
          y = hit.y + h(hit) + GAP
        }
        placed.push({ ...it, y })
      }
    } else {
      let y = PAD
      for (let guard = 0; guard < 200; guard++) {
        const hit = overlaps(placed, { ...it, y })
        if (!hit) break
        y = hit.y + h(hit) + GAP
      }
      placed.push({ ...it, y })
    }
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
