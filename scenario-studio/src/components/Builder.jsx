import React, { useEffect, useRef, useState } from 'react'
import { STAGES, DEVICE_PRESETS, CHIP_COLORS, createItem, visibleProfileItems } from '../lib/store.js'
import { LIBRARY } from '../lib/registry.jsx'
import {
  PAD, GAP, MIN_ITEM_W,
  resolveCollision, layoutCompactUp, alignItems, compactItems, COMPACT_TYPES, LAYOUT_MODES,
} from '../lib/layout.js'
import { buildShareUrl } from '../lib/share.js'
import Dropdown from './ui/Dropdown.jsx'
import CanvasItem from './builder/CanvasItem.jsx'
import Palette from './builder/Palette.jsx'
import Inspector from './builder/Inspector.jsx'
import CanvasTextToolbar from './builder/CanvasTextToolbar.jsx'
import ContextMenu from './builder/ContextMenu.jsx'

const SNAP = 6

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState(STAGES[0].key)
  const [selectedIds, setSelectedIds] = useState([]) // 다중 선택 (⇧+클릭)
  const [dragPos, setDragPos] = useState(null) // { id, positions: {id:{x,y}} }
  const [sizeDraft, setSizeDraft] = useState(null) // {id, w, h}
  const [openMenu, setOpenMenu] = useState(null) // 'device' | 'layout' | 'color' | 'version'
  const [guides, setGuides] = useState([]) // 드래그 중 스냅 가이드라인
  const [focusTick, setFocusTick] = useState(0) // 더블클릭 → 인스펙터 포커스 신호
  const [inlineEdit, setInlineEdit] = useState(null) // 캔버스 인라인 텍스트 편집 {itemId, key}
  const [, setHistVer] = useState(0) // undo/redo 버튼 활성화 갱신용
  const [zoom, setZoom] = useState(1) // 캔버스 줌 (Figma식 ⌘+/-/0)
  const [marquee, setMarquee] = useState(null) // 빈 캔버스 드래그 → 러버밴드 선택 박스
  const [ctxMenu, setCtxMenu] = useState(null) // 우클릭 컨텍스트 메뉴 {sx, sy, cx, cy, itemId}
  const dragPosRef = useRef(null)
  const dragStartRef = useRef(null) // 그룹 드래그 시작 시점의 위치들
  const sizeDraftRef = useRef(null)
  const heightsRef = useRef({})
  const historyRef = useRef({ past: [], future: [], lastPush: 0 })
  const clipboardRef = useRef(null) // ⌘C 복사한 컴포넌트 스냅샷 (단계 간 붙여넣기 가능)
  const canvasRef = useRef(null)

  const items = scenario.stages[stageKey] || []
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = items.find((it) => it.id === selectedId) || null
  const stageMeta = STAGES.find((s) => s.key === stageKey)
  const chipColor = scenario.color || '#5f7465'

  /* 기기 프리셋에 따른 캔버스 폭 */
  const device = DEVICE_PRESETS.find((d) => d.key === (scenario.device || 'desktop')) || DEVICE_PRESETS[0]
  const canvasW = device.w
  const itemW = canvasW - PAD * 2

  /* 컴팩트(compactType — 업계 컨벤션): 배치가 바뀔 때마다 빈 공간 없이 스택.
     'vertical'(기본, 위로) | 'horizontal'(왼쪽으로) | 'none'(자유 배치).
     settle = 겹침 해소 후 컴팩트 — 모든 커밋 경로가 이걸 통과한다.
     (구버전 gravity: false 데이터는 'none'으로 해석) */
  const compactType = scenario.compact || (scenario.gravity === false ? 'none' : 'vertical')
  const compactOn = compactType !== 'none'
  const compactOpts = (pinnedIds = []) => ({ direction: compactType, pinnedIds, canvasW })
  const settle = (list, movedIds) => {
    const resolved = resolveCollision(list, movedIds, heightsRef.current)
    return compactOn ? compactItems(resolved, heightsRef.current, compactOpts()) : resolved
  }
  const changeCompact = (type) => {
    setOpenMenu(null)
    if (type.key === compactType) return
    api.updateScenario(scenario.id, (s) => ({ ...s, compact: type.key }))
    if (type.key !== 'none') {
      setItems((prev) => compactItems(prev, heightsRef.current, { direction: type.key, canvasW }))
    }
    api.showToast(`${type.label} — ${type.desc}`)
  }

  const toggleMenu = (key) => setOpenMenu((cur) => (cur === key ? null : key))

  /* 선택: ⇧+클릭 = 토글 추가, 일반 클릭 = 단일 선택(그룹 멤버 클릭 시 그룹 유지) */
  const handleSelect = (id, shift) => {
    setSelectedIds((prev) => {
      if (shift) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      return prev.includes(id) && prev.length > 1 ? prev : [id]
    })
  }

  /* ── 히스토리 (Undo/Redo) ── */
  const takeSnapshot = () => JSON.stringify({ stages: scenario.stages, device: scenario.device })
  const applySnapshot = (snap) => {
    const data = JSON.parse(snap)
    setSelectedIds([])
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      stages: data.stages || data,
      device: data.device || s.device,
    }))
  }

  const pushHistory = () => {
    const h = historyRef.current
    const now = Date.now()
    if (now - h.lastPush < 500) return // 연속 변경 병합
    h.past.push(takeSnapshot())
    if (h.past.length > 60) h.past.shift()
    h.future = []
    h.lastPush = now
    setHistVer((v) => v + 1)
  }

  const undo = () => {
    const h = historyRef.current
    const snap = h.past.pop()
    if (!snap) return
    h.future.push(takeSnapshot())
    h.lastPush = 0
    setHistVer((v) => v + 1)
    applySnapshot(snap)
  }

  const redo = () => {
    const h = historyRef.current
    const snap = h.future.pop()
    if (!snap) return
    h.past.push(takeSnapshot())
    h.lastPush = 0
    setHistVer((v) => v + 1)
    applySnapshot(snap)
  }

  /* ── 아이템 변경 ── */
  const setItems = (updater) => {
    pushHistory()
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      stages: { ...s.stages, [stageKey]: updater(s.stages[stageKey] || []) },
    }))
  }

  useEffect(() => {
    setSelectedIds([])
    setDragPos(null)
    setSizeDraft(null)
    setInlineEdit(null)
  }, [stageKey])

  const addItem = (type) => {
    const def = LIBRARY[type]
    const item = createItem(type, def.defaults)
    // 컴포넌트별 기본 폭 (예: 상품/영상/게시글 카드는 세로형으로 시작)
    const w = Math.min(def.defaultW || itemW, itemW)
    setItems((prev) => {
      const bottom = prev.reduce(
        (max, it) => Math.max(max, it.y + (heightsRef.current[it.id] || 80)),
        PAD - GAP
      )
      const next = [...prev, { ...item, x: PAD, y: bottom + GAP, w }]
      return compactOn ? compactItems(next, heightsRef.current, compactOpts()) : next
    })
    setSelectedIds([item.id])
  }

  /* 팔레트에서 캔버스로 드래그해 원하는 위치에 바로 배치 */
  const addItemAt = (type, x, y) => {
    const def = LIBRARY[type]
    if (!def) return
    const item = createItem(type, def.defaults)
    const w = Math.min(def.defaultW || itemW, itemW)
    const nx = Math.max(0, Math.min(canvasW - w, Math.round(x - w / 2)))
    const ny = Math.max(0, Math.round(y - 16))
    setItems((prev) => settle([...prev, { ...item, x: nx, y: ny, w }], [item.id]))
    setSelectedIds([item.id])
  }

  /* ── 복사 / 붙여넣기 (⌘C/⌘X/⌘V — 단계를 건너 붙여넣기 가능) ── */
  const copySelected = () => {
    const srcs = items.filter((it) => selectedIds.includes(it.id))
    if (srcs.length === 0) return false
    const minX = Math.min(...srcs.map((it) => it.x))
    const minY = Math.min(...srcs.map((it) => it.y))
    clipboardRef.current = srcs.map((it) => ({
      type: it.type,
      w: it.w,
      h: it.h,
      hidden: it.hidden,
      style: it.style ? { ...it.style } : undefined,
      props: JSON.parse(JSON.stringify(it.props)),
      relX: it.x - minX,
      relY: it.y - minY,
    }))
    api.showToast(`${srcs.length}개 컴포넌트를 복사했어요. ⌘V로 붙여넣어요.`)
    return true
  }

  /* at을 주면 그 지점(캔버스 좌표)에, 없으면 스택 맨 아래에 붙여넣는다 */
  const pasteClipboard = (at) => {
    const clip = clipboardRef.current
    if (!clip || clip.length === 0) return
    const bottom = items.reduce(
      (max, it) => Math.max(max, it.y + (heightsRef.current[it.id] || 80)),
      PAD - GAP
    )
    const baseX = at ? at.x : PAD
    const baseY = at ? at.y : bottom + GAP
    const copies = clip.map((c) => ({
      ...cloneItem(c, {
        x: Math.max(0, Math.min(canvasW - c.w, Math.round(baseX + c.relX))),
        y: Math.max(0, Math.round(baseY + c.relY)),
      }),
      w: Math.min(c.w, itemW),
    }))
    setItems((prev) => settle([...prev, ...copies], copies.map((c) => c.id)))
    setSelectedIds(copies.map((c) => c.id))
  }

  /* ── 캔버스 줌 ── */
  const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5]
  const zoomBy = (dir) => {
    setZoom((z) => {
      const idx = ZOOM_STEPS.findIndex((s) => Math.abs(s - z) < 0.01)
      const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (idx < 0 ? 4 : idx) + dir))]
      return next
    })
  }

  /* ── 러버밴드(마퀴) 다중 선택: 빈 캔버스를 드래그 ── */
  const onCanvasPointerDown = (e) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / zoom
    const sy = (e.clientY - rect.top) / zoom
    const baseSel = e.shiftKey ? [...selectedIds] : []
    if (!e.shiftKey) setSelectedIds([])
    const move = (ev) => {
      const cx = (ev.clientX - rect.left) / zoom
      const cy = (ev.clientY - rect.top) / zoom
      const box = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
      if (box.w < 3 && box.h < 3) return
      setMarquee(box)
      const hit = items
        .filter((it) => {
          const ih = it.h || heightsRef.current[it.id] || 80
          return it.x < box.x + box.w && it.x + it.w > box.x && it.y < box.y + box.h && it.y + ih > box.y
        })
        .map((it) => it.id)
      setSelectedIds([...new Set([...baseSel, ...hit])])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ── 우클릭 컨텍스트 메뉴 ── */
  const openCtxMenu = (e, itemId) => {
    e.preventDefault()
    e.stopPropagation()
    if (itemId && !selectedIds.includes(itemId)) setSelectedIds([itemId])
    const rect = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null
    setCtxMenu({
      sx: e.clientX,
      sy: e.clientY,
      cx: rect ? (e.clientX - rect.left) / zoom : PAD,
      cy: rect ? (e.clientY - rect.top) / zoom : PAD,
      itemId: itemId || null,
    })
  }

  /* 선택된 컴포넌트들의 잠금/숨김을 클릭한 아이템 기준으로 일괄 토글 */
  const toggleSelected = (key) => {
    const target = items.find((it) => it.id === (ctxMenu && ctxMenu.itemId))
    const next = target ? !target[key] : true
    const ids = new Set(selectedIds)
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, [key]: next } : it)))
  }

  const updateItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  const updateProps = (id, key, value) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, props: { ...it.props, [key]: value } } : it))
    )
  }

  const removeItem = (id) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.id !== id)
      return compactOn ? compactItems(next, heightsRef.current, compactOpts()) : next
    })
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  const removeSelected = () => {
    const ids = new Set(selectedIds)
    setItems((prev) => {
      const next = prev.filter((it) => !ids.has(it.id))
      return compactOn ? compactItems(next, heightsRef.current, compactOpts()) : next
    })
    setSelectedIds([])
  }

  /* 아이템 사본 생성 — id 재발급 + props/style 딥카피 (복제·붙여넣기 공용) */
  const cloneItem = (src, pos) => ({
    ...createItem(src.type, src.props),
    x: pos.x,
    y: pos.y,
    w: src.w,
    h: src.h,
    locked: false,
    hidden: src.hidden,
    style: src.style ? { ...src.style } : undefined,
    props: JSON.parse(JSON.stringify(src.props)),
  })

  const cloneOf = (src) =>
    cloneItem(src, { x: src.x, y: src.y + (src.h || heightsRef.current[src.id] || 80) + GAP })

  const duplicateItem = (id) => {
    const src = items.find((it) => it.id === id)
    if (!src) return
    const copy = cloneOf(src)
    setItems((prev) => settle([...prev, copy], [copy.id]))
    setSelectedIds([copy.id])
  }

  /* 선택된 모든 컴포넌트 복제 (⌘D) */
  const duplicateSelected = () => {
    const srcs = items.filter((it) => selectedIds.includes(it.id))
    if (srcs.length === 0) return
    const copies = srcs.map(cloneOf)
    setItems((prev) => settle([...prev, ...copies], copies.map((c) => c.id)))
    setSelectedIds(copies.map((c) => c.id))
  }

  /* ── 드래그 / 리사이즈 ── */

  /* 그룹 드래그: 시작 시점에 선택 그룹(잠긴 것 제외)의 원래 위치를 기록 */
  const onGroupDragStart = (id) => {
    const groupIds = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
    const positions = {}
    items.forEach((it) => {
      if (groupIds.includes(it.id) && !it.locked) positions[it.id] = { x: it.x, y: it.y }
    })
    dragStartRef.current = { primary: id, positions }
  }

  const onDrag = (id, x, y) => {
    const start = dragStartRef.current
    const groupIds = start ? Object.keys(start.positions) : [id]

    // 다중 선택 그룹 이동: 스냅 없이 함께 이동
    if (start && groupIds.length > 1) {
      const dx = x - start.positions[id].x
      const dy = y - start.positions[id].y
      const positions = {}
      groupIds.forEach((k) => {
        const it = items.find((i) => i.id === k)
        const w = it ? it.w : itemW
        positions[k] = {
          x: Math.max(0, Math.min(canvasW - w, start.positions[k].x + dx)),
          y: Math.max(0, start.positions[k].y + dy),
        }
      })
      const pos = { id, positions }
      dragPosRef.current = pos
      setDragPos(pos)
      setGuides([])
      return
    }

    // 단일 드래그: 스마트 스냅 (캔버스 가장자리/중앙, 다른 아이템 모서리·간격)
    const it = items.find((i) => i.id === id)
    const w = it ? it.w : itemW
    const hh = (it && it.h) || heightsRef.current[id] || 80
    let nx = Math.max(0, Math.min(canvasW - w, x))
    let ny = Math.max(0, y)
    const activeGuides = []

    const vCands = [
      [PAD, PAD],
      [(canvasW - w) / 2, canvasW / 2],
      [canvasW - PAD - w, canvasW - PAD],
    ]
    items.forEach((o) => {
      if (o.id === id) return
      vCands.push([o.x, o.x])
      vCands.push([o.x + o.w - w, o.x + o.w])
    })
    for (const [cand, line] of vCands) {
      if (Math.abs(nx - cand) <= SNAP) {
        nx = cand
        activeGuides.push({ type: 'v', pos: line })
        break
      }
    }

    const hCands = [[PAD, PAD]]
    items.forEach((o) => {
      if (o.id === id) return
      const oh = o.h || heightsRef.current[o.id] || 80
      hCands.push([o.y, o.y])
      hCands.push([o.y + oh + GAP, o.y + oh + GAP])
      hCands.push([o.y - hh - GAP, o.y - GAP / 2])
    })
    for (const [cand, line] of hCands) {
      if (cand >= 0 && Math.abs(ny - cand) <= SNAP) {
        ny = cand
        activeGuides.push({ type: 'h', pos: line })
        break
      }
    }

    setGuides(activeGuides)
    const pos = { id, positions: { [id]: { x: nx, y: ny } } }
    dragPosRef.current = pos
    setDragPos(pos)
  }

  const onDragEnd = (id) => {
    const pos = dragPosRef.current
    dragPosRef.current = null
    dragStartRef.current = null
    setGuides([])
    // 진행 중인 React 렌더와 커밋이 겹치지 않도록 다음 틱으로 미룬다
    setTimeout(() => {
      if (pos && pos.id === id) {
        setItems((prev) => {
          const movedList = prev.map((it) => (pos.positions[it.id] ? { ...it, ...pos.positions[it.id] } : it))
          return settle(movedList, Object.keys(pos.positions))
        })
      }
      setDragPos(null)
    }, 0)
  }

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
        setItems((prev) => {
          const resized = prev.map((it) =>
            it.id === id
              ? { ...it, w: draft.w, h: draft.h, x: Math.min(it.x, canvasW - draft.w) }
              : it
          )
          return settle(resized, id)
        })
      }
      setSizeDraft(null)
    }, 0)
  }

  /* 크기 변경(인스펙터) 시에도 즉시 겹침 해소 */
  const setSize = (id, patch) => {
    if (patch.h != null) heightsRef.current[id] = patch.h
    setItems((prev) => {
      const updated = prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
      return settle(updated, id)
    })
  }

  /* 방향키 미세 이동 (다중 선택 지원, 잠긴 것 제외) */
  const nudgeSelected = (dx, dy) => {
    const ids = new Set(items.filter((it) => selectedIds.includes(it.id) && !it.locked).map((it) => it.id))
    if (ids.size === 0) return
    setItems((prev) => {
      const moved = prev.map((it) =>
        ids.has(it.id)
          ? {
              ...it,
              x: Math.max(0, Math.min(canvasW - it.w, it.x + dx)),
              y: Math.max(0, it.y + dy),
            }
          : it
      )
      // 중력이 켜져 있으면 세로 미세 이동은 다시 스택되므로 가로 이동/재배열 용도
      return settle(moved, [...ids])
    })
  }

  /* 다중 선택 정렬 도구 */
  const alignSelected = (mode) => {
    if (selectedIds.length < 2) return
    setItems((prev) => {
      const aligned = alignItems(prev, selectedIds, mode, { canvasW }, heightsRef.current)
      return compactOn ? compactItems(aligned, heightsRef.current, compactOpts()) : aligned
    })
  }

  /* 레이어 패널에서 순서 바꾸기: 이웃과 자리를 교환하고 컴팩트 정리 */
  const moveLayer = (id, dir) => {
    setItems((prev) => {
      const sorted = [...prev].sort((a, b) => (a.y - b.y) || (a.x - b.x))
      const idx = sorted.findIndex((it) => it.id === id)
      const j = idx + dir
      if (idx < 0 || j < 0 || j >= sorted.length) return prev
      const a = sorted[idx]
      const b = sorted[j]
      const swapped = prev.map((it) =>
        it.id === a.id ? { ...it, x: b.x, y: b.y } : it.id === b.id ? { ...it, x: a.x, y: a.y } : it
      )
      return layoutCompactUp(swapped, heightsRef.current)
    })
  }

  /* ── 키보드 단축키 ── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(items.map((it) => it.id))
        return
      }
      if (meta && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault()
        duplicateSelected()
        return
      }
      if (meta && e.key.toLowerCase() === 'c') {
        if (copySelected()) e.preventDefault()
        return
      }
      if (meta && e.key.toLowerCase() === 'x') {
        if (copySelected()) {
          e.preventDefault()
          removeSelected()
        }
        return
      }
      if (meta && e.key.toLowerCase() === 'v') {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          e.preventDefault()
          pasteClipboard()
        }
        return
      }
      if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        zoomBy(1)
        return
      }
      if (meta && e.key === '-') {
        e.preventDefault()
        zoomBy(-1)
        return
      }
      if (meta && e.key === '0') {
        e.preventDefault()
        setZoom(1)
        return
      }
      if (e.key === 'Escape' && ctxMenu) {
        setCtxMenu(null)
        return
      }
      if (selectedIds.length === 0) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
        return
      }
      if (e.key === 'Escape') {
        setSelectedIds([])
        return
      }
      const step = e.shiftKey ? 1 : 8
      const dir = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      }[e.key]
      if (dir) {
        e.preventDefault()
        nudgeSelected(dir[0], dir[1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* 더블클릭 시 인스펙터 첫 입력란에 포커스 */
  useEffect(() => {
    if (!focusTick) return
    const el = document.querySelector('.sb-inspector input[type="text"], .sb-inspector textarea')
    if (el) {
      el.focus()
      if (el.select) el.select()
    }
  }, [focusTick])

  /* ── 상단 바 액션 ── */
  const changeDevice = (preset) => {
    setOpenMenu(null)
    if (preset.key === (scenario.device || 'desktop')) return
    pushHistory()
    const ratio = (preset.w - PAD * 2) / (canvasW - PAD * 2)
    const newItemW = preset.w - PAD * 2
    api.updateScenario(scenario.id, (s) => {
      const stages = {}
      Object.keys(s.stages).forEach((k) => {
        stages[k] = (s.stages[k] || []).map((it) => {
          const w = Math.max(MIN_ITEM_W, Math.min(newItemW, Math.round(it.w * ratio)))
          const x = Math.max(0, Math.min(preset.w - PAD - w, Math.round(PAD + (it.x - PAD) * ratio)))
          return { ...it, w, x }
        })
      })
      return { ...s, device: preset.key, stages }
    })
    // 폭 변경으로 높이가 다시 측정된 뒤 겹침/간격을 보정한다
    setTimeout(() => {
      setItems((prev) => layoutCompactUp(prev, heightsRef.current))
    }, 200)
    api.showToast(`${preset.label} 폭 기준으로 캔버스를 전환했어요.`)
  }

  const runAutoLayout = (mode) => {
    setOpenMenu(null)
    setItems((prev) => mode.fn(prev, heightsRef.current, { itemW, canvasW }))
    // 너비가 바뀌는 정렬은 높이가 다시 측정된 뒤 한 번 더 컴팩트하게 보정한다
    if (mode.key !== 'compact') {
      setTimeout(() => {
        setItems((prev) => layoutCompactUp(prev, heightsRef.current))
      }, 180)
    }
    api.showToast(`${mode.label}로 겹침 없이 배치했어요.`)
  }

  const publish = () => {
    const emptyStages = STAGES.filter((s) => (scenario.stages[s.key] || []).length === 0)
    if (emptyStages.length > 0) {
      const ok = window.confirm(
        `${emptyStages.map((s) => s.label).join(', ')} 단계가 비어 있어요. 그래도 발행할까요?`
      )
      if (!ok) return
    }
    // 칩 라벨이 비어 있으면 제목에서 만들어 채운다 (빈 "✦#" 칩 방지)
    const cleaned = (scenario.chip || '').replace(/^#+/, '').trim()
    const fallback = (scenario.title || '').trim().replace(/\s+/g, '_') || '시나리오'
    const finalChip = cleaned || fallback
    // 발행 시점 스냅샷을 버전으로 보관 (최근 10개)
    const snapshot = {
      at: new Date().toISOString(),
      title: scenario.title,
      chip: finalChip,
      device: scenario.device,
      stages: JSON.parse(JSON.stringify(scenario.stages)),
    }
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      status: 'published',
      chip: finalChip,
      versions: [...(s.versions || []), snapshot].slice(-10),
    }))
    api.showToast(`"#${finalChip}" 칩이 홈 탐색창 밑에 발행됐어요!`)
    api.goHome()
  }

  /* 발행 버전 복원: 현재 상태는 undo 히스토리로 보존 */
  const restoreVersion = (snap) => {
    setOpenMenu(null)
    const when = new Date(snap.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    if (!window.confirm(`${when} 발행 시점으로 되돌릴까요?\n(현재 상태는 ⌘Z로 복구할 수 있어요)`)) return
    pushHistory()
    setSelectedIds([])
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      title: snap.title,
      chip: snap.chip,
      device: snap.device,
      stages: JSON.parse(JSON.stringify(snap.stages)),
    }))
    api.showToast('발행 시점 버전으로 복원했어요.')
  }

  const unpublish = () => {
    api.updateScenario(scenario.id, (s) => ({ ...s, status: 'draft' }))
    api.showToast('발행을 취소했어요.')
  }

  /* 공유 링크 복사: URL 해시에 시나리오 전체가 담겨 어디서든 바로 실행된다 */
  const copyShareLink = () => {
    const url = buildShareUrl(scenario)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => api.showToast('공유 링크를 복사했어요. 받는 사람은 링크만 열면 바로 체험할 수 있어요.'),
        () => window.prompt('아래 링크를 복사하세요', url)
      )
    } else {
      window.prompt('아래 링크를 복사하세요', url)
    }
  }

  /* ── 렌더 ── */

  /* 드래그 중에는 다른 아이템들이 실시간으로 밀려나는 미리보기 레이아웃.
     컴팩트가 켜져 있으면 드래그 중인 아이템만 포인터에 고정하고 나머지를 스택 */
  let displayItems = items
  if (dragPos) {
    const moved = items.map((it) =>
      dragPos.positions[it.id] ? { ...it, ...dragPos.positions[it.id] } : it
    )
    const draggedIds = Object.keys(dragPos.positions)
    const resolved = resolveCollision(moved, draggedIds, heightsRef.current)
    displayItems = compactOn ? compactItems(resolved, heightsRef.current, compactOpts(draggedIds)) : resolved
  }

  const canvasHeight = Math.max(
    560,
    ...displayItems.map((it) => {
      const y = (dragPos && dragPos.positions[it.id]?.y) ?? it.y
      return y + (it.h || heightsRef.current[it.id] || 80) + 120
    })
  )

  const ensureKeyword = (word) => {
    if (!word) return
    if ((api.keywords || []).some((k) => k.word === word)) return
    api.updateKeywords([...(api.keywords || []), { word, desc: '', points: '' }])
    api.showToast(`"${word}" 키워드를 사전에 추가했어요. 탐색 편집기에서 설명을 채워주세요.`)
  }

  /* 캔버스 렌더 컨텍스트: 프로필 데이터, 배지 클릭 토글, 계획 요약 미리보기 */
  const canvasCtx = {
    mode: 'canvas',
    profile: api.profile,
    updateProps: (id, key, value) => updateProps(id, key, value),
    /* 컴포넌트 안 더블클릭 인라인 편집 */
    editing: inlineEdit,
    beginEdit: (id, key) => {
      setSelectedIds([id])
      setInlineEdit({ itemId: id, key })
    },
    commitEdit: (id, key, raw) => {
      updateProps(id, key, raw)
      setInlineEdit(null)
    },
    summaryPreview: {
      profile: visibleProfileItems(api.profile, scenario),
      questions: (scenario.stages.survey || [])
        .filter((it) => it.type === 'surveyQuestion')
        .map((q) => ({ q: q.props.question, a: '아무거나' })),
    },
  }

  const chevron = (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
  )

  return (
    <div className="sb-builder">
      {/* 상단 영역(상단 바 + 단계 탭)을 한 덩어리로 고정 — 상단 바 높이가 가변이어도 겹치지 않게 */}
      <div className="sb-builder-head">
      {/* 상단 바 — 1행: 문서 정보 + 발행, 2행: 편집 도구 그룹 */}
      <div className="sb-topbar">
        <div className="sb-topbar__row">
        <button type="button" className="sb-icon-btn" onClick={api.goHome} aria-label="홈으로">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className="sb-topbar__meta">
          <input
            className="sb-title-input"
            value={scenario.title}
            placeholder="시나리오 제목"
            onChange={(e) => api.updateScenario(scenario.id, (s) => ({ ...s, title: e.target.value }))}
          />
          <div className="sb-chip-input-wrap" style={{ color: chipColor }}>
            <span>#</span>
            <input
              className="sb-chip-input"
              style={{ color: chipColor }}
              value={scenario.chip}
              placeholder="칩_라벨"
              onChange={(e) =>
                api.updateScenario(scenario.id, (s) => ({ ...s, chip: e.target.value.replace(/\s+/g, '_') }))
              }
            />
          </div>
          <Dropdown
            open={openMenu === 'color'}
            onClose={() => setOpenMenu(null)}
            menuClass="sb-color-menu"
            button={
              <button type="button" className="sb-color-btn" title="칩 색상 선택" aria-label="칩 색상 선택" onClick={() => toggleMenu('color')}>
                <span className="sb-color-dot" style={{ background: chipColor }} />
              </button>
            }
          >
            {CHIP_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={'sb-color-swatch' + (chipColor === c.color ? ' sb-color-swatch--active' : '')}
                title={c.label}
                style={{ background: c.color }}
                onClick={() => {
                  api.updateScenario(scenario.id, (s) => ({ ...s, color: c.color }))
                  setOpenMenu(null)
                }}
              />
            ))}
          </Dropdown>
        </div>

        <span className={'sb-status ' + (scenario.status === 'published' ? 'sb-status--live' : '')}>
          {scenario.status === 'published' ? '발행됨' : '작성 중'}
        </span>
        <span className="sb-autosave" title={scenario.updatedAt}>
          자동 저장됨 · {new Date(scenario.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
        </span>

        <div className="sb-topbar__actions">
          <button type="button" className="sb-btn" onClick={() => api.playScenario(scenario.id)}>시험해보기</button>

          {(scenario.versions || []).length > 0 && (
            <Dropdown
              open={openMenu === 'version'}
              onClose={() => setOpenMenu(null)}
              button={
                <button type="button" className={'sb-btn' + (openMenu === 'version' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('version')} title="발행 시점 버전 복원">
                  버전 {(scenario.versions || []).length}
                </button>
              }
            >
              {[...(scenario.versions || [])].reverse().map((v, i, arr) => (
                <button key={v.at} type="button" className="sb-menu__item" onClick={() => restoreVersion(v)}>
                  <strong>발행 v{arr.length - i}</strong>
                  <small>
                    {new Date(v.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' · '}설문 {(v.stages.survey || []).length} · 계획 {(v.stages.plan || []).length}
                  </small>
                </button>
              ))}
            </Dropdown>
          )}

          {scenario.status === 'published' && (
            <button type="button" className="sb-btn sb-btn--ghost" onClick={unpublish}>발행 취소</button>
          )}
          <button type="button" className="sb-btn sb-btn--primary" onClick={publish}>
            {scenario.status === 'published' ? '변경사항 재발행' : '발행하기'}
          </button>
        </div>
        </div>

        {/* 2행: 편집 도구 — 연관 도구끼리 그룹, 구분선으로 분리 */}
        <div className="sb-topbar__row sb-topbar__row--tools">
          <div className="sb-tb-group" role="group" aria-label="히스토리">
            <button type="button" className="sb-icon-btn" title="실행 취소 (⌘Z)" aria-label="실행 취소" disabled={historyRef.current.past.length === 0} onClick={undo}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
            </button>
            <button type="button" className="sb-icon-btn" title="다시 실행 (⇧⌘Z)" aria-label="다시 실행" disabled={historyRef.current.future.length === 0} onClick={redo}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
            </button>
          </div>
          <span className="sb-tb-sep" aria-hidden="true" />
          <div className="sb-tb-group" role="group" aria-label="캔버스 줌">
            <div className="sb-zoom-ctl">
              <button type="button" title="축소 (⌘-)" aria-label="축소" onClick={() => zoomBy(-1)}>−</button>
              <button type="button" className="sb-zoom-ctl__val" title="100%로 (⌘0)" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" title="확대 (⌘+)" aria-label="확대" onClick={() => zoomBy(1)}>+</button>
            </div>
          </div>
          <span className="sb-tb-sep" aria-hidden="true" />
          <div className="sb-tb-group" role="group" aria-label="레이아웃">
          <Dropdown
            open={openMenu === 'device'}
            onClose={() => setOpenMenu(null)}
            button={
              <button type="button" className={'sb-btn' + (openMenu === 'device' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('device')} title="캔버스 기기 폭 선택">
                {device.icon} {device.label}
                {chevron}
              </button>
            }
          >
            {DEVICE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={'sb-menu__item' + (p.key === device.key ? ' sb-menu__item--active' : '')}
                onClick={() => changeDevice(p)}
              >
                <strong>{p.icon} {p.label}</strong>
                <small>캔버스 폭 {p.w}px{p.key === device.key ? ' · 사용 중' : ''}</small>
              </button>
            ))}
          </Dropdown>

          <Dropdown
            open={openMenu === 'compact'}
            onClose={() => setOpenMenu(null)}
            button={
              <button
                type="button"
                className={'sb-btn' + (compactOn ? ' sb-btn--compact-on' : '') + (openMenu === 'compact' ? ' sb-btn--open' : '')}
                title="컴팩트 방향 — 배치가 바뀔 때 빈 공간 없이 스택되는 방향"
                onClick={() => toggleMenu('compact')}
              >
                🧲 {COMPACT_TYPES.find((t) => t.key === compactType)?.label || '컴팩트'}
                {chevron}
              </button>
            }
          >
            {COMPACT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={'sb-menu__item' + (t.key === compactType ? ' sb-menu__item--active' : '')}
                onClick={() => changeCompact(t)}
              >
                <strong>{t.label}</strong>
                <small>{t.desc}{t.key === compactType ? ' · 사용 중' : ''}</small>
              </button>
            ))}
          </Dropdown>

          <Dropdown
            open={openMenu === 'layout'}
            onClose={() => setOpenMenu(null)}
            button={
              <button type="button" className={'sb-btn' + (openMenu === 'layout' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('layout')}>
                자동 정렬
                {chevron}
              </button>
            }
          >
            {LAYOUT_MODES.map((mode) => (
              <button key={mode.key} type="button" className="sb-menu__item" onClick={() => runAutoLayout(mode)}>
                <strong>{mode.label}</strong>
                <small>{mode.desc}</small>
              </button>
            ))}
          </Dropdown>
          </div>
          <span className="sb-tb-sep" aria-hidden="true" />
          <div className="sb-tb-group" role="group" aria-label="공유">
            <button type="button" className="sb-icon-btn" title="공유 링크 복사 — 링크만 열면 바로 체험" aria-label="공유 링크 복사" onClick={copyShareLink}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* 단계 탭 */}
      <div className="sb-stage-tabs">
        <button
          type="button"
          className="sb-stage-tab sb-stage-tab--common"
          title="모든 시나리오가 공유하는 공통 탐색(홈) 페이지 편집"
          onClick={api.openExploreEditor}
        >
          <span className="sb-stage-tab__num">🧭</span>
          탐색
          <span className="sb-stage-tab__count">공통</span>
        </button>
        <span className="sb-stage-tabs__divider" aria-hidden="true" />
        {STAGES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={'sb-stage-tab' + (stageKey === s.key ? ' sb-stage-tab--active' : '')}
            onClick={() => setStageKey(s.key)}
          >
            <span className="sb-stage-tab__num">{i + 1}</span>
            {s.label}
            <span className="sb-stage-tab__count">{(scenario.stages[s.key] || []).length}</span>
          </button>
        ))}
        <p className="sb-stage-desc">{stageMeta?.desc}</p>
      </div>
      </div>

      <div className="sb-workspace">
        <Palette
          stageKey={stageKey}
          items={items}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onAdd={addItem}
          onMoveLayer={moveLayer}
          onRemove={removeItem}
          onToggleLock={(id) => updateItem(id, { locked: !items.find((it) => it.id === id)?.locked })}
          onToggleHide={(id) => updateItem(id, { hidden: !items.find((it) => it.id === id)?.hidden })}
        />

        {/* 캔버스 */}
        <main className="sb-canvas-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedIds([]) }}>
          <div className="sb-canvas-col" style={{ width: canvasW * zoom }}>
            <div className="sb-canvas-scale" style={{ width: canvasW * zoom, height: canvasHeight * zoom }}>
              <div
                ref={canvasRef}
                className="sb-canvas"
                style={{ width: canvasW, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
                onPointerDown={onCanvasPointerDown}
                onContextMenu={(e) => { if (e.target === e.currentTarget) openCtxMenu(e, null) }}
                onDragOver={(e) => {
                  if ([...e.dataTransfer.types].includes('text/sb-type')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }
                }}
                onDrop={(e) => {
                  const type = e.dataTransfer.getData('text/sb-type')
                  if (!type) return
                  e.preventDefault()
                  const rect = canvasRef.current.getBoundingClientRect()
                  addItemAt(type, (e.clientX - rect.left) / zoom, (e.clientY - rect.top) / zoom)
                }}
              >
                {items.length === 0 && (
                  <div className="sb-canvas__empty">
                    왼쪽 팔레트에서 컴포넌트를 누르거나 끌어다 놓으세요.<br />
                    <span>추가한 컴포넌트는 마우스로 끌어 배치할 수 있어요.</span>
                  </div>
                )}
                {guides.map((g, i) => (
                  <div
                    key={i}
                    className={'sb-guide sb-guide--' + g.type}
                    style={g.type === 'v' ? { left: g.pos } : { top: g.pos }}
                  />
                ))}
                {marquee && (
                  <div
                    className="sb-marquee"
                    style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                  />
                )}
                {displayItems.map((it) => (
                  <CanvasItem
                    key={it.id}
                    item={it}
                    zoom={zoom}
                    selected={selectedIds.includes(it.id)}
                    dragPos={dragPos && dragPos.positions[it.id] ? dragPos.positions[it.id] : null}
                    sizeDraft={sizeDraft && sizeDraft.id === it.id ? sizeDraft : null}
                    heightsRef={heightsRef}
                    renderCtx={canvasCtx}
                    onSelect={handleSelect}
                    onDragStart={onGroupDragStart}
                    onDrag={onDrag}
                    onDragEnd={onDragEnd}
                    onResize={onResize}
                    onResizeEnd={onResizeEnd}
                    onInspect={(id) => { setSelectedIds([id]); setFocusTick((t) => t + 1) }}
                    onContextMenu={openCtxMenu}
                  />
                ))}
              </div>
            </div>
          </div>
        </main>

        <Inspector
          stageKey={stageKey}
          selected={selected}
          selectedIds={selectedIds}
          itemW={itemW}
          canvasW={canvasW}
          heightsRef={heightsRef}
          updateProps={updateProps}
          updateItem={updateItem}
          setSize={setSize}
          duplicateSelected={duplicateSelected}
          removeSelected={removeSelected}
          duplicateItem={duplicateItem}
          removeItem={removeItem}
          alignSelected={alignSelected}
          ensureKeyword={ensureKeyword}
        />

        <CanvasTextToolbar active={!!inlineEdit} ensureKeyword={ensureKeyword} />

        {/* 우클릭 컨텍스트 메뉴 (Figma/Canva식) */}
        <ContextMenu
          menu={ctxMenu}
          items={items}
          hasClipboard={!!(clipboardRef.current && clipboardRef.current.length > 0)}
          onClose={() => setCtxMenu(null)}
          onDuplicate={duplicateSelected}
          onCopy={copySelected}
          onPaste={pasteClipboard}
          onToggle={toggleSelected}
          onRemove={removeSelected}
          onSelectAll={() => setSelectedIds(items.map((it) => it.id))}
        />
      </div>
    </div>
  )
}
