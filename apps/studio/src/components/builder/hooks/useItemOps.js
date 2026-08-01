import { createItem } from '../../../lib/store.js'
import { LIBRARY } from '../../../lib/registry.jsx'
import { PAD, GAP } from '../../../lib/layout.js'
import { stackBottom } from '../../../lib/builder/geometry.js'
import { cloneGroup, fromClipboardEntries, toClipboardEntries } from '../../../lib/builder/itemClipboard.js'

/*
 * 아이템 편집 연산 — 추가·수정·삭제·복제·클립보드.
 *
 * Builder가 갖던 캔버스 아이템 CRUD를 모은다. 모든 배치 커밋은 layout.settle/compact를
 * 통과시키고(겹침 해소 + 컴팩트 한 곳), 컨테이너 삭제·복제·복사는 자식을 연쇄한다.
 * 클립보드는 ref라 단계를 건너 붙여넣을 수 있다.
 */
export function useItemOps({
  items,
  itemW,
  canvasW,
  layout,
  heightOf,
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
    const w = Math.min(def.defaultW || itemW, itemW)
    setItems((prev) => layout.compact([...prev, { ...item, x: PAD, y: stackBottom(prev, heightOf, PAD - GAP) + GAP, w }]))
    setSelectedIds([item.id])
    return undefined
  }

  /* 팔레트에서 캔버스로 드래그해 원하는 위치에 바로 배치 */
  const addItemAt = (type, x, y) => {
    const def = LIBRARY[type]
    if (!def) return
    const item = createItem(type, def.defaults)
    const w = Math.min(def.defaultW || itemW, itemW)
    const nx = Math.max(0, Math.min(canvasW - w, Math.round(x - w / 2)))
    const ny = Math.max(0, Math.round(y - 16))
    setItems((prev) => layout.settle([...prev, { ...item, x: nx, y: ny, w }], [item.id]))
    setSelectedIds([item.id])
  }

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const updateProps = (id, key, value) =>
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, props: { ...item.props, [key]: value } } : item)))

  /* 삭제 — 컨테이너를 지우면 안의 자식도 함께 */
  const removeItem = (id) => {
    setItems((prev) => layout.compact(prev.filter((item) => item.id !== id && item.parentId !== id)))
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }
  const removeSelected = () => {
    const ids = new Set(selectedIds)
    setItems((prev) => layout.compact(prev.filter((item) => !ids.has(item.id) && !ids.has(item.parentId))))
    setSelectedIds([])
  }

  const duplicateItem = (id) => {
    const source = items.find((item) => item.id === id)
    if (!source) return
    const group = cloneGroup(source, items, { gap: GAP, heightOf })
    setItems((prev) => layout.settle([...prev, ...group], [group[0].id]))
    setSelectedIds([group[0].id])
  }

  const duplicateSelected = () => {
    const sources = items.filter((item) => selectedIds.includes(item.id))
    if (sources.length === 0) return
    const groups = sources.map((source) => cloneGroup(source, items, { gap: GAP, heightOf }))
    setItems((prev) => layout.settle([...prev, ...groups.flat()], groups.map((group) => group[0].id)))
    setSelectedIds(groups.map((group) => group[0].id))
  }

  /* ── 클립보드 (단계를 건너 붙여넣을 수 있다) ── */
  const copySelected = () => {
    const entries = toClipboardEntries(items, selectedIds)
    if (!entries) return false
    clipboardRef.current = entries
    showToast(`${entries.length}개 컴포넌트를 복사했어요. ⌘V로 붙여넣어요.`)
    return true
  }

  /* at을 주면 그 지점(캔버스 좌표)에, 없으면 스택 맨 아래에 붙여넣는다 */
  const pasteClipboard = (at) => {
    const clip = clipboardRef.current
    if (!clip || clip.length === 0) return
    const groups = fromClipboardEntries(clip, {
      baseX: at ? at.x : PAD,
      baseY: at ? at.y : stackBottom(items, heightOf, PAD - GAP) + GAP,
      canvasW,
      itemW,
    })
    setItems((prev) => layout.settle([...prev, ...groups.flat()], groups.map((group) => group[0].id)))
    setSelectedIds(groups.map((group) => group[0].id))
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
    copySelected,
    pasteClipboard,
    hasClipboard,
  }
}
