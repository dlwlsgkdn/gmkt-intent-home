import { createItem } from '../../../lib/store.js'
import { LIBRARY } from '../../../lib/registry.jsx'
import { reorderTop, topIndexOf } from '../../../lib/builder/geometry.js'
import { cloneGroup, fromClipboardEntries, toClipboardEntries } from '../../../lib/builder/itemClipboard.js'

/*
 * 아이템 편집 연산 — 추가·수정·삭제·복제·순서 이동·클립보드.
 *
 * 배치는 순서 모델이다: 배열 순서 = 렌더 순서. 추가는 스택 끝(또는 지정 인덱스),
 * 복제는 원본 바로 뒤, 컨테이너 삭제·복제·복사는 자식을 연쇄한다.
 * 클립보드는 ref라 단계를 건너 붙여넣을 수 있다.
 */
export function useItemOps({
  items,
  setItems,
  selectedIds,
  setSelectedIds,
  nesting,
  clipboardRef,
  showToast,
}) {
  const addItem = (type) => {
    const def = LIBRARY[type]
    const anchor = selectedIds.length === 1 ? items.find((item) => item.id === selectedIds[0]) : null
    // Webflow/Elementor식 클릭 추가: 컨테이너를 선택하면 그 안에, 자식을 선택하면 바로 뒤에
    if (!def.container && anchor) {
      if (LIBRARY[anchor.type]?.container) return nesting.addChild(type, anchor.id, { index: Infinity })
      if (anchor.parentId) return nesting.addChild(type, anchor.parentId, { index: anchor.slot || Infinity })
    }
    const item = createItem(type, def.defaults)
    // 최상위 앵커가 있으면 바로 뒤에, 없으면 스택 맨 아래에
    const anchorIndex = anchor && !anchor.parentId ? topIndexOf(items, anchor.id) : -1
    setItems((prev) => (
      anchorIndex >= 0
        ? reorderTop([...prev, item], [item.id], anchorIndex + 1)
        : [...prev, item]
    ))
    setSelectedIds([item.id])
    return undefined
  }

  /* 팔레트에서 캔버스로 드래그해 원하는 순서 위치에 바로 배치 */
  const addItemAt = (type, index) => {
    const def = LIBRARY[type]
    if (!def) return
    const item = createItem(type, def.defaults)
    setItems((prev) => reorderTop([...prev, item], [item.id], index))
    setSelectedIds([item.id])
  }

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const updateProps = (id, key, value) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, props: { ...item.props, [key]: value } } : item)))

  /* 삭제 — 컨테이너를 지우면 안의 자식도 함께 */
  const removeItem = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id && item.parentId !== id))
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }
  const removeSelected = () => {
    const ids = new Set(selectedIds)
    setItems((prev) => prev.filter((item) => !ids.has(item.id) && !ids.has(item.parentId)))
    setSelectedIds([])
  }

  /* 복제 — 사본을 원본 바로 뒤 순서에 끼운다 (자식 사본은 cloneGroup이 다음 슬롯으로) */
  const duplicateItem = (id) => {
    const source = items.find((item) => item.id === id)
    if (!source) return
    const group = cloneGroup(source, items)
    const sourceIndex = topIndexOf(items, id)
    setItems((prev) => (
      sourceIndex >= 0
        ? reorderTop([...prev, ...group], [group[0].id], sourceIndex + 1)
        : [...prev, ...group]
    ))
    setSelectedIds([group[0].id])
  }

  const duplicateSelected = () => {
    const sources = items.filter((item) => selectedIds.includes(item.id))
    if (sources.length === 0) return
    const groups = sources.map((source) => cloneGroup(source, items))
    setItems((prev) => [...prev, ...groups.flat()])
    setSelectedIds(groups.map((group) => group[0].id))
  }

  /* 선택한 최상위 아이템(들)을 한 칸 위/아래로 — 방향키·레이어 패널 공용 */
  const moveSelectedBy = (dir) => {
    const top = items.filter((item) => !item.parentId)
    const chosen = new Set(selectedIds.filter((id) => top.some((item) => item.id === id)))
    if (chosen.size === 0) return
    const firstIndex = top.findIndex((item) => chosen.has(item.id))
    // 이동 아이템을 뺀 나머지 기준 인덱스에서 한 칸 이동 (reorderTop 규약)
    const base = top.slice(0, firstIndex).filter((item) => !chosen.has(item.id)).length
    const at = dir < 0 ? base - 1 : base + 1
    if (at < 0) return
    setItems((prev) => reorderTop(prev, [...chosen], at))
  }

  /* ── 클립보드 (단계를 건너 붙여넣을 수 있다) ── */
  const copySelected = () => {
    const entries = toClipboardEntries(items, selectedIds)
    if (!entries) return false
    clipboardRef.current = entries
    showToast(`${entries.length}개 컴포넌트를 복사했어요. ⌘V로 붙여넣어요.`)
    return true
  }

  /* at(최상위 인덱스)을 주면 그 순서 위치에, 없으면 스택 맨 아래에 붙여넣는다 */
  const pasteClipboard = (at) => {
    const clip = clipboardRef.current
    if (!clip || clip.length === 0) return
    const groups = fromClipboardEntries(clip)
    const topIds = groups.map((group) => group[0].id)
    setItems((prev) => (
      typeof at === 'number'
        ? reorderTop([...prev, ...groups.flat()], topIds, at)
        : [...prev, ...groups.flat()]
    ))
    setSelectedIds(topIds)
  }

  const hasClipboard = () => !!(clipboardRef.current && clipboardRef.current.length > 0)

  return {
    addItem,
    addItemAt,
    updateItem,
    updateProps,
    removeItem,
    removeSelected,
    duplicateItem,
    duplicateSelected,
    moveSelectedBy,
    copySelected,
    pasteClipboard,
    hasClipboard,
  }
}
