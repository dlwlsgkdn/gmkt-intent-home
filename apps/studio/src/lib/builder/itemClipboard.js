import { createItem } from '../store.js'
import { nextSlot } from './geometry.js'

/*
 * 아이템 사본 만들기 — 복제(⌘D)·복사/붙여넣기(⌘C/⌘V)·컨테이너 자식 승계가 공유한다.
 *
 * 사본은 언제나 새 id를 받고 props/style은 깊은 복사한다. 얕게 복사하면 원본과
 * 편집이 공유돼 "복제했는데 원본도 같이 바뀌는" 버그가 난다.
 */

/* 클립보드에 담는 최소 정보 — 위치는 붙여넣을 때 다시 정한다 */
export const itemPayload = (item) => ({
  type: item.type,
  w: item.w,
  h: item.h,
  hidden: item.hidden,
  slot: item.slot,
  style: item.style ? { ...item.style } : undefined,
  props: JSON.parse(JSON.stringify(item.props)),
})

export const cloneItemFrom = (src, pos) => ({
  ...createItem(src.type, src.props),
  x: pos.x,
  y: pos.y,
  w: src.w,
  h: src.h,
  locked: false, // 사본은 항상 잠금 해제 상태로 시작한다
  hidden: src.hidden,
  style: src.style ? { ...src.style } : undefined,
  props: JSON.parse(JSON.stringify(src.props)),
})

/* 사본 그룹: 컨테이너면 자식까지, 자식이면 같은 컨테이너 안 다음 슬롯으로.
   컨테이너 자식의 parentId를 새 id로 다시 매달지 않으면 사본이 원본 안에 들어간다. */
export function cloneGroup(src, list, { gap, heightOf }) {
  if (src.parentId) {
    return [{
      ...cloneItemFrom(src, { x: 0, y: 0 }),
      parentId: src.parentId,
      slot: nextSlot(list, src.parentId),
    }]
  }
  const copy = cloneItemFrom(src, { x: src.x, y: src.y + heightOf(src) + gap })
  const children = list
    .filter((item) => item.parentId === src.id)
    .map((child) => ({ ...cloneItemFrom(child, { x: 0, y: 0 }), parentId: copy.id, slot: child.slot }))
  return [copy, ...children]
}

/* 선택한 아이템들을 클립보드 항목으로 — 상대 위치를 보존해 묶음 그대로 붙여넣는다 */
export function toClipboardEntries(items, selectedIds) {
  const sources = items.filter((item) => selectedIds.includes(item.id))
  if (sources.length === 0) return null
  const minX = Math.min(...sources.map((item) => item.x))
  const minY = Math.min(...sources.map((item) => item.y))
  return sources.map((item) => ({
    ...itemPayload(item),
    relX: item.parentId ? 0 : item.x - minX,
    relY: item.parentId ? 0 : item.y - minY,
    children: items.filter((child) => child.parentId === item.id).map(itemPayload),
  }))
}

/* 클립보드 항목 → 배치할 아이템 그룹 배열 (그룹의 첫 원소가 최상위) */
export function fromClipboardEntries(entries, { baseX, baseY, canvasW, itemW }) {
  return entries.map((entry) => {
    const top = {
      ...cloneItemFrom(entry, {
        x: Math.max(0, Math.min(canvasW - entry.w, Math.round(baseX + entry.relX))),
        y: Math.max(0, Math.round(baseY + entry.relY)),
      }),
      w: Math.min(entry.w, itemW),
    }
    const children = (entry.children || []).map((child) => ({
      ...cloneItemFrom(child, { x: 0, y: 0 }),
      parentId: top.id,
      slot: child.slot,
    }))
    return [top, ...children]
  })
}
