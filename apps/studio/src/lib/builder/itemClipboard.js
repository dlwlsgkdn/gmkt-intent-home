import { createItem } from '../store.js'
import { nextSlot } from './geometry.js'

/*
 * 아이템 사본 만들기 — 복제(⌘D)·복사/붙여넣기(⌘C/⌘V)·컨테이너 자식 승계가 공유한다.
 *
 * 사본은 언제나 새 id를 받고 props/style은 깊은 복사한다. 얕게 복사하면 원본과
 * 편집이 공유돼 "복제했는데 원본도 같이 바뀌는" 버그가 난다.
 * 배치는 순서 모델이라 좌표가 없다 — 붙여넣을 위치(인덱스)는 호출부가 정한다.
 */

/* 클립보드에 담는 최소 정보 — w/h는 컨테이너 자식의 카드 크기일 때만 의미가 있다 */
export const itemPayload = (item) => ({
  type: item.type,
  w: item.w,
  h: item.h,
  hidden: item.hidden,
  slot: item.slot,
  style: item.style ? { ...item.style } : undefined,
  props: JSON.parse(JSON.stringify(item.props)),
})

export const cloneItemFrom = (src) => ({
  ...createItem(src.type, src.props),
  ...(src.w != null ? { w: src.w } : null),
  ...(src.h != null ? { h: src.h } : null),
  locked: false, // 사본은 항상 잠금 해제 상태로 시작한다
  hidden: src.hidden,
  style: src.style ? { ...src.style } : undefined,
  props: JSON.parse(JSON.stringify(src.props)),
})

/* 사본 그룹: 컨테이너면 자식까지, 자식이면 같은 컨테이너 안 다음 슬롯으로.
   컨테이너 자식의 parentId를 새 id로 다시 매달지 않으면 사본이 원본 안에 들어간다.
   그룹의 첫 원소가 최상위(또는 자식 단독) 사본이다. */
export function cloneGroup(src, list) {
  if (src.parentId) {
    return [{
      ...cloneItemFrom(src),
      parentId: src.parentId,
      slot: nextSlot(list, src.parentId),
    }]
  }
  const copy = cloneItemFrom(src)
  const children = list
    .filter((item) => item.parentId === src.id)
    .map((child) => ({ ...cloneItemFrom(child), parentId: copy.id, slot: child.slot }))
  return [copy, ...children]
}

/* 선택한 아이템들을 클립보드 항목으로 — 배열 순서(=렌더 순서)를 보존한다 */
export function toClipboardEntries(items, selectedIds) {
  const sources = items.filter((item) => selectedIds.includes(item.id))
  if (sources.length === 0) return null
  return sources.map((item) => ({
    ...itemPayload(item),
    children: items.filter((child) => child.parentId === item.id).map(itemPayload),
  }))
}

/* 클립보드 항목 → 배치할 아이템 그룹 배열 (그룹의 첫 원소가 최상위) */
export function fromClipboardEntries(entries) {
  return entries.map((entry) => {
    const top = cloneItemFrom(entry)
    const children = (entry.children || []).map((child) => ({
      ...cloneItemFrom(child),
      parentId: top.id,
      slot: child.slot,
    }))
    return [top, ...children]
  })
}
