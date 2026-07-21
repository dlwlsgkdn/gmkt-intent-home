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
import ContainerContents from './builder/ContainerContents.jsx'
import CanvasTextToolbar from './builder/CanvasTextToolbar.jsx'
import ContextMenu from './builder/ContextMenu.jsx'

const SNAP = 6
/* 드래그 겹침 회피 둔화: 겹침 면적이 작은 쪽의 35% 이상일 때만 밀어내고,
   밀려나는 미리보기 재배치는 150ms 간격으로만 갱신 (드래그 아이템 자체는 즉각 반응) */
const DRAG_SOFT_RATIO = 0.35
const DRAG_PREVIEW_MS = 150
/* 컨테이너 겹침 회피 ↔ 삽입 공존 임계점:
   포인터가 가장자리에서 NEST_INSET 이상 안쪽이면 "안에 배치" 모드(그 컨테이너만 핀 고정),
   아니면 컨테이너도 일반 아이템처럼 밀리되 CONTAINER_SOFT_RATIO 이상 겹칠 때만
   (일반 35%보다 높아 접근 중에 드롭존이 먼저 도망가지 않는다) */
const NEST_INSET = 12
const CONTAINER_SOFT_RATIO = 0.6

/* 빌더에서 편집 가능한 단계: 공통 탐색(계정 소유, 자동 반영) + 시나리오 소유 설문/계획 */
const BUILD_STAGES = [
  { key: 'explore', label: '탐색', desc: '모든 시나리오가 공유하는 공통 탐색(홈) 페이지 — 저장 즉시 홈에 반영', common: true },
  ...STAGES,
]

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState(STAGES[0].key)
  const isExplore = stageKey === 'explore'
  const [selectedIds, setSelectedIds] = useState([]) // 다중 선택 (⇧+클릭)
  const [dragPos, setDragPos] = useState(null) // { id, positions: {id:{x,y}} }
  const [dragLayoutPos, setDragLayoutPos] = useState(null) // 겹침 회피 미리보기용 지연 위치
  const [sizeDraft, setSizeDraft] = useState(null) // {id, w, h}
  const [openMenu, setOpenMenu] = useState(null) // 'device' | 'layout' | 'color' | 'version'
  const [guides, setGuides] = useState([]) // 드래그 중 스냅 가이드라인
  const [focusTick, setFocusTick] = useState(0) // 더블클릭 → 인스펙터 포커스 신호
  const [inlineEdit, setInlineEdit] = useState(null) // 캔버스 인라인 텍스트 편집 {itemId, key}
  const [, setHistVer] = useState(0) // undo/redo 버튼 활성화 갱신용
  const [zoom, setZoom] = useState(1) // 캔버스 줌 (Figma식 ⌘+/-/0)
  const [canvasView, setCanvasView] = useState('edit') // 'edit'(클리핑 해제+경계 표시) | 'preview'(실사용 모습)
  const previewMode = canvasView === 'preview'
  const [marquee, setMarquee] = useState(null) // 빈 캔버스 드래그 → 러버밴드 선택 박스
  const [ctxMenu, setCtxMenu] = useState(null) // 우클릭 컨텍스트 메뉴 {sx, sy, cx, cy, itemId}
  const dragPosRef = useRef(null)
  const dragLayoutPosRef = useRef(null) // 스로틀된 미리보기 재배치 기준 위치
  const dragLayoutTimerRef = useRef(null)
  const dragStartRef = useRef(null) // 그룹 드래그 시작 시점의 위치들
  const sizeDraftRef = useRef(null)
  const heightsRef = useRef({})
  const historyRef = useRef({ past: [], future: [], lastPush: 0 })
  const clipboardRef = useRef(null) // ⌘C 복사한 컴포넌트 스냅샷 (단계 간 붙여넣기 가능)
  const canvasRef = useRef(null)

  const items = isExplore ? (api.explore.items || []) : (scenario.stages[stageKey] || [])
  /* 컨테이너(레이아웃) 안의 자식은 캔버스 절대배치 대상이 아니다 — 캔버스/레이아웃 연산은 최상위만 */
  const topItems = items.filter((it) => !it.parentId)
  const [dropTargetId, setDropTargetId] = useState(null) // 드래그 중 컨테이너 드롭 대상 하이라이트
  const [draggingChildId, setDraggingChildId] = useState(null) // 컨테이너 안 재정렬 중인 자식 (시각 피드백)
  const [childDragGhost, setChildDragGhost] = useState(null) // { x, y, label, icon } — 내부 재정렬 포인터 피드백
  const [, setMeasureVer] = useState(0) // 편집 중 클리핑 해제 높이를 캔버스 스크롤 범위에 반영
  const heightOf = (it) => {
    const measured = heightsRef.current[it.id]
    if (!previewMode && LIBRARY[it.type]?.container) return Math.max(it.h || 0, measured || 0, 80)
    return it.h || measured || 80
  }
  /* (x, y) 캔버스 좌표를 덮는 컨테이너 아이템.
     inset을 주면 가장자리에서 그만큼 안쪽까지 들어와야 매칭 — 삽입 의도 판정용
     (작은 컨테이너는 inset이 과해지지 않게 크기의 1/4로 제한) */
  const containerAt = (x, y, excludeId, inset = 0) =>
    topItems.find((it) => {
      if (it.id === excludeId) return false
      if (!LIBRARY[it.type]?.container) return false
      const hh = heightOf(it)
      const ix = Math.min(inset, it.w / 4, hh / 4)
      return x >= it.x + ix && x <= it.x + it.w - ix && y >= it.y + ix && y <= it.y + hh - ix
    })
  const nextSlot = (list, parentId) =>
    list.filter((it) => it.parentId === parentId).reduce((m, it) => Math.max(m, it.slot || 0), 0) + 1

  /* 포인터(캔버스 좌표)가 가리키는 컨테이너 안 삽입 위치(0-base) — 자식 슬롯 DOM과 비교 */
  const slotIndexAt = (containerId, containerType, cx, cy, excludeId) => {
    if (!canvasRef.current) return Infinity
    const rect = canvasRef.current.getBoundingClientRect()
    const px = rect.left + cx * zoom
    const py = rect.top + cy * zoom
    const els = [...canvasRef.current.querySelectorAll(`[data-child-of="${containerId}"]`)]
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
    let idx = 0
    els.forEach((el) => {
      const r = el.getBoundingClientRect()
      const center = horizontal ? r.left + r.width / 2 : r.top + r.height / 2
      if ((horizontal ? px : py) > center) idx++
    })
    return idx
  }

  /* 컨테이너 안 삽입 위치 가이드 라인 (Notion/Framer식 인서트 캐럿) — 캔버스 좌표 */
  const [insertHint, setInsertHint] = useState(null) // { dir:'v'|'h', x, y, len }
  const insertHintAt = (container, cx, cy, excludeId) => {
    if (!canvasRef.current || !container) return null
    const els = [...canvasRef.current.querySelectorAll(`[data-child-of="${container.id}"]`)]
      .filter((el) => el.dataset.childId !== excludeId)
    if (els.length === 0) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const flow = LIBRARY[container.type]?.flow
    const horizontal = flow === 'x'
    const grid = flow === 'grid'
    const idx = slotIndexAt(container.id, container.type, cx, cy, excludeId)
    const t = els[Math.min(idx, els.length - 1)].getBoundingClientRect()
    const after = idx >= els.length
    if (horizontal || grid) {
      const sx = after ? t.right + 6 : t.left - 6
      return { dir: 'v', x: (sx - rect.left) / zoom, y: (t.top - rect.top) / zoom, len: t.height / zoom }
    }
    const sy = after ? t.bottom + 6 : t.top - 6
    return { dir: 'h', x: (t.left - rect.left) / zoom, y: (sy - rect.top) / zoom, len: t.width / zoom }
  }

  /* childId를 containerId의 index 위치에 끼워 넣고 형제 슬롯을 1..n으로 재부여 */
  const placeChild = (list, childId, containerId, index) => {
    const sibs = list
      .filter((it) => it.parentId === containerId && it.id !== childId)
      .sort((a, b) => (a.slot || 0) - (b.slot || 0))
    const order = sibs.map((s) => s.id)
    order.splice(Math.max(0, Math.min(order.length, index)), 0, childId)
    return list.map((it) => {
      const k = order.indexOf(it.id)
      return k >= 0 ? { ...it, parentId: containerId, slot: k + 1 } : it
    })
  }
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = items.find((it) => it.id === selectedId) || null
  const managedContainer = selected
    ? LIBRARY[selected.type]?.container
      ? selected
      : selected.parentId
        ? items.find((it) => it.id === selected.parentId) || null
        : null
    : null
  const managedChildren = managedContainer
    ? items
        .filter((it) => it.parentId === managedContainer.id)
        .sort((a, b) => (a.slot || 0) - (b.slot || 0))
    : []
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
  /* 레이아웃 연산(fn)을 최상위 아이템에만 적용하고 자식은 그대로 통과 */
  const withTopOnly = (list, fn) => {
    const top = list.filter((it) => !it.parentId)
    const kids = list.filter((it) => it.parentId)
    return [...fn(top), ...kids]
  }
  const settle = (list, movedIds) =>
    withTopOnly(list, (top) => {
      const resolved = resolveCollision(top, movedIds, heightsRef.current)
      return compactOn ? compactItems(resolved, heightsRef.current, compactOpts()) : resolved
    })
  const compactTop = (list) =>
    withTopOnly(list, (top) => (compactOn ? compactItems(top, heightsRef.current, compactOpts()) : top))
  const changeCompact = (type) => {
    if (previewMode) return
    setOpenMenu(null)
    if (type.key === compactType) return
    api.updateScenario(scenario.id, (s) => ({ ...s, compact: type.key }))
    if (type.key !== 'none') {
      setItems((prev) => withTopOnly(prev, (top) => compactItems(top, heightsRef.current, { direction: type.key, canvasW })))
    }
    api.showToast(`${type.label} — ${type.desc}`)
  }

  const toggleMenu = (key) => setOpenMenu((cur) => (cur === key ? null : key))

  /* 선택: ⇧+클릭 = 토글 추가, 일반 클릭 = 단일 선택(그룹 멤버 클릭 시 그룹 유지) */
  const handleSelect = (id, shift) => {
    if (previewMode) return
    setSelectedIds((prev) => {
      if (shift) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      return prev.includes(id) && prev.length > 1 ? prev : [id]
    })
  }

  const selectManagedItem = (id) => {
    if (previewMode) return
    setSelectedIds([id])
    setTimeout(() => {
      canvasRef.current
        ?.querySelector(`[data-child-id="${id}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, 0)
  }

  /* ── 히스토리 (Undo/Redo) — 시나리오 단계 + 공통 탐색 아이템을 함께 스냅샷 ── */
  const takeSnapshot = () =>
    JSON.stringify({ stages: scenario.stages, device: scenario.device, exploreItems: api.explore.items || [] })
  const applySnapshot = (snap) => {
    const data = JSON.parse(snap)
    setSelectedIds([])
    api.updateScenario(scenario.id, (s) => ({
      ...s,
      stages: data.stages || data,
      device: data.device || s.device,
    }))
    if (data.exploreItems) api.updateExplore({ ...api.explore, items: data.exploreItems })
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
    if (previewMode) return
    const h = historyRef.current
    const snap = h.past.pop()
    if (!snap) return
    h.future.push(takeSnapshot())
    h.lastPush = 0
    setHistVer((v) => v + 1)
    applySnapshot(snap)
  }

  const redo = () => {
    if (previewMode) return
    const h = historyRef.current
    const snap = h.future.pop()
    if (!snap) return
    h.past.push(takeSnapshot())
    h.lastPush = 0
    setHistVer((v) => v + 1)
    applySnapshot(snap)
  }

  /* ── 아이템 변경 — 탐색은 계정 공유 페이지에, 설문/계획은 시나리오에 저장 ──
     탐색은 함수 업데이터 필수: setTimeout 커밋(드래그/보정)이 낡은 클로저로 덮어쓰지 않게 */
  const setItems = (updater) => {
    if (previewMode) return
    pushHistory()
    if (isExplore) {
      api.updateExplore((prev) => ({ ...prev, items: updater(prev.items || []) }))
    } else {
      api.updateScenario(scenario.id, (s) => ({
        ...s,
        stages: { ...s.stages, [stageKey]: updater(s.stages[stageKey] || []) },
      }))
    }
  }

  useEffect(() => {
    setSelectedIds([])
    setDragPos(null)
    setSizeDraft(null)
    setInlineEdit(null)
    setDraggingChildId(null)
    setChildDragGhost(null)
    setInsertHint(null)
  }, [stageKey])

  /* 미리보기 진입 시 남아 있던 모든 편집 상태를 닫는다. */
  useEffect(() => {
    if (!previewMode) return
    setSelectedIds([])
    setDragPos(null)
    setSizeDraft(null)
    setInlineEdit(null)
    setMarquee(null)
    setCtxMenu(null)
    setOpenMenu(null)
    setDropTargetId(null)
    setInsertHint(null)
    setDraggingChildId(null)
    setChildDragGhost(null)
  }, [previewMode])

  /* 탐색 아이템은 계정 공유라 시나리오 기기 폭과 무관하게 저장됨 —
     현재 캔버스보다 넓은 아이템은 진입/기기 변경 시 폭에 맞게 보정 */
  useEffect(() => {
    if (!isExplore) return
    const cur = api.explore.items || []
    if (!cur.some((it) => it.w > itemW || it.x + it.w > canvasW - PAD)) return
    api.updateExplore((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        if (it.parentId) return it
        const w = Math.min(it.w, itemW)
        const x = Math.max(0, Math.min(canvasW - PAD - w, it.x))
        return { ...it, w, x }
      }),
    }))
    // 폭 변경으로 높이가 다시 측정된 뒤 겹침 없이 재배치
    setTimeout(() => {
      setItems((prev) => withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
    }, 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExplore, canvasW])

  const addItem = (type) => {
    const def = LIBRARY[type]
    const anchor = selectedIds.length === 1 ? items.find((it) => it.id === selectedIds[0]) : null
    // Webflow/Elementor식 클릭 추가: 컨테이너를 선택하면 그 안에, 자식을 선택하면 바로 뒤에 추가한다.
    if (!def.container && anchor) {
      if (LIBRARY[anchor.type]?.container) {
        addChild(type, anchor.id, { index: Infinity })
        return
      }
      if (anchor.parentId) {
        addChild(type, anchor.parentId, { index: anchor.slot || Infinity })
        return
      }
    }
    const item = createItem(type, def.defaults)
    // 컴포넌트별 기본 폭 (예: 상품/영상/게시글 카드는 세로형으로 시작)
    const w = Math.min(def.defaultW || itemW, itemW)
    setItems((prev) => {
      const bottom = prev
        .filter((it) => !it.parentId)
        .reduce((max, it) => Math.max(max, it.y + heightOf(it)), PAD - GAP)
      return compactTop([...prev, { ...item, x: PAD, y: bottom + GAP, w }])
    })
    setSelectedIds([item.id])
  }

  /* 컨테이너(레이아웃) 안에 자식으로 추가 — 팔레트 드래그를 컨테이너 위에 놓았을 때.
     at = {cx, cy, type}이 있으면 포인터 위치 기준 슬롯에 삽입 */
  const addChild = (type, parentId, at) => {
    const def = LIBRARY[type]
    if (!def || def.container) {
      api.showToast('레이아웃 안에 레이아웃은 넣을 수 없어요.')
      return
    }
    const idx = typeof at?.index === 'number'
      ? at.index
      : at?.cx != null
        ? slotIndexAt(parentId, at.containerType, at.cx, at.cy)
        : Infinity
    // 컨테이너 안 기본 너비: 컴포넌트 고유 기본값(카드류)을 컨테이너 내부 폭에 맞춰 시작.
    // 최초 배치 시 한 번만 계산해 저장하므로 이후 컨테이너 리사이즈에는 영향받지 않는다.
    const contentEl = canvasRef.current?.querySelector(
      `[data-canvas-item-id="${parentId}"] > .sb-canvas-item__content`
    )
    let fitW = itemW
    if (contentEl) {
      const cs = getComputedStyle(contentEl)
      fitW = Math.round(
        contentEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 10
      )
    }
    const w = Math.max(MIN_ITEM_W, Math.min(def.defaultW || 320, fitW))
    const item = { ...createItem(type, def.defaults), x: 0, y: 0, w }
    setItems((prev) => placeChild([...prev, item], item.id, parentId, idx))
    setSelectedIds([item.id])
    api.showToast(`${def.label}을(를) 레이아웃 안에 배치했어요.`)
  }

  /* 캔버스에서 컨테이너 자식 직접 조작 (2단계 드래그):
     클릭 = 선택 · 컨테이너 안에서 드래그 = 실시간 슬롯 재정렬 ·
     포인터가 컨테이너 경계를 벗어나면 자동으로 꺼내져 일반 드래그로 전환
     (다시 컨테이너 위에 놓으면 그 위치 슬롯으로 복귀) */
  const childPointerDown = (e, childId) => {
    if (previewMode) return
    if (e.button !== 0) return
    if (e.target.closest && e.target.closest('.sb-inline-editor')) return
    e.stopPropagation()
    const child = items.find((it) => it.id === childId)
    if (!child) return
    const parent = items.find((it) => it.id === child.parentId)
    const startX = e.clientX
    const startY = e.clientY
    const shift = e.shiftKey
    if (!parent || child.locked) {
      handleSelect(childId, shift)
      return
    }
    const w = Math.min(child.w || 320, itemW)
    const MARGIN = 18
    let phase = 'idle' // 'idle' → 'reorder'(컨테이너 안) → 'out'(꺼내진 일반 드래그)
    let lastSlot = -1

    const toCanvas = (ev) => {
      const rect = canvasRef.current.getBoundingClientRect()
      return { cx: (ev.clientX - rect.left) / zoom, cy: (ev.clientY - rect.top) / zoom }
    }
    /* 부모 전체 박스를 경계로 사용한다. 제목·패딩·카드 사이 여백을 가로질러도
       의도치 않게 밖으로 빠지지 않고, 박스를 명확히 벗어났을 때만 꺼낸다. */
    const insideParent = (clientX, clientY) => {
      const el = canvasRef.current?.querySelector(`[data-canvas-item-id="${parent.id}"]`)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return (
        clientX >= r.left - MARGIN &&
        clientX <= r.right + MARGIN &&
        clientY >= r.top - MARGIN &&
        clientY <= r.bottom + MARGIN
      )
    }
    const popOut = (cx, cy) => {
      phase = 'out'
      setItems((prev) =>
        prev.map((it) =>
          it.id === childId
            ? {
                ...it,
                parentId: undefined,
                slot: undefined,
                w,
                x: Math.max(0, Math.round(cx - w / 2)),
                y: Math.max(0, Math.round(cy - 20)),
              }
            : it
        )
      )
      setSelectedIds([childId])
      dragStartRef.current = null
      setChildDragGhost(null)
    }

    const move = (ev) => {
      if (phase === 'idle') {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) <= 6) return
        phase = 'reorder'
        setSelectedIds([childId])
      }
      const { cx, cy } = toCanvas(ev)
      if (phase === 'reorder') {
        if (insideParent(ev.clientX, ev.clientY)) {
          // 컨테이너 안: 구조는 고정하고 삽입 위치만 미리보기 — 놓을 때 한 번만 커밋한다.
          setDropTargetId(parent ? parent.id : null)
          setDraggingChildId(childId)
          setChildDragGhost({
            x: ev.clientX + 14,
            y: ev.clientY + 14,
            label: LIBRARY[child.type]?.label || '컴포넌트',
            icon: LIBRARY[child.type]?.icon || '◈',
          })
          lastSlot = slotIndexAt(parent.id, parent.type, cx, cy, childId)
          setInsertHint(insertHintAt(parent, cx, cy, childId))
          return
        }
        // 슬롯 밴드를 벗어남 → 자동으로 꺼내서 일반 드래그로 전환 (가이드/겹침/컴팩트 활성)
        setDropTargetId(null)
        setDraggingChildId(null)
        setInsertHint(null)
        popOut(cx, cy)
      }
      if (phase === 'out') {
        onDrag(childId, cx - w / 2, cy - 20, ev.clientX, ev.clientY)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setDraggingChildId(null)
      setChildDragGhost(null)
      setInsertHint(null)
      if (phase === 'out') onDragEnd(childId)
      else if (phase === 'reorder') {
        setDropTargetId(null)
        if (lastSlot >= 0) setItems((prev) => placeChild(prev, childId, parent.id, lastSlot))
      }
      else handleSelect(childId, shift)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  /* 자식 리사이즈 핸들 — 바깥 컴포넌트와 동일하게 우하단 드래그로 너비/높이 조절 */
  const childResizeDown = (e, childId) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    setSelectedIds([childId])
    const child = items.find((it) => it.id === childId)
    if (!child) return
    const shellEl = e.target.closest && e.target.closest('.sb-child')
    const r = shellEl ? shellEl.getBoundingClientRect() : null
    const origW = child.w || (r ? Math.round(r.width / zoom) : 320)
    const origH = child.h || (r ? Math.round(r.height / zoom) : 120)
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev) => {
      const w = Math.max(MIN_ITEM_W, Math.min(itemW, Math.round(origW + (ev.clientX - sx) / zoom)))
      const h = Math.max(48, Math.round(origH + (ev.clientY - sy) / zoom))
      setItems((prev) => prev.map((it) => (it.id === childId ? { ...it, w, h } : it)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* 컨테이너에서 꺼내 캔버스 맨 아래로 */
  const unnestItem = (id) => {
    setItems((prev) => {
      const bottom = prev
        .filter((it) => !it.parentId)
        .reduce((max, it) => Math.max(max, it.y + heightOf(it)), PAD - GAP)
      const updated = prev.map((it) =>
        it.id === id
          ? { ...it, parentId: undefined, slot: undefined, x: PAD, y: bottom + GAP, w: Math.min(it.w || itemW, itemW) }
          : it
      )
      return settle(updated, [id])
    })
    api.showToast('레이아웃에서 꺼내 캔버스 맨 아래에 놓았어요.')
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

  /* ── 복사 / 붙여넣기 (⌘C/⌘X/⌘V — 단계를 건너 붙여넣기 가능, 컨테이너는 자식 포함) ── */
  const itemPayload = (it) => ({
    type: it.type,
    w: it.w,
    h: it.h,
    hidden: it.hidden,
    slot: it.slot,
    style: it.style ? { ...it.style } : undefined,
    props: JSON.parse(JSON.stringify(it.props)),
  })

  const copySelected = () => {
    const srcs = items.filter((it) => selectedIds.includes(it.id))
    if (srcs.length === 0) return false
    const minX = Math.min(...srcs.map((it) => it.x))
    const minY = Math.min(...srcs.map((it) => it.y))
    clipboardRef.current = srcs.map((it) => ({
      ...itemPayload(it),
      relX: it.parentId ? 0 : it.x - minX,
      relY: it.parentId ? 0 : it.y - minY,
      children: items.filter((k) => k.parentId === it.id).map(itemPayload),
    }))
    api.showToast(`${srcs.length}개 컴포넌트를 복사했어요. ⌘V로 붙여넣어요.`)
    return true
  }

  /* at을 주면 그 지점(캔버스 좌표)에, 없으면 스택 맨 아래에 붙여넣는다 */
  const pasteClipboard = (at) => {
    const clip = clipboardRef.current
    if (!clip || clip.length === 0) return
    const bottom = topItems.reduce(
      (max, it) => Math.max(max, it.y + heightOf(it)),
      PAD - GAP
    )
    const baseX = at ? at.x : PAD
    const baseY = at ? at.y : bottom + GAP
    const groups = clip.map((c) => {
      const top = {
        ...cloneItem(c, {
          x: Math.max(0, Math.min(canvasW - c.w, Math.round(baseX + c.relX))),
          y: Math.max(0, Math.round(baseY + c.relY)),
        }),
        w: Math.min(c.w, itemW),
      }
      const kids = (c.children || []).map((k) => ({
        ...cloneItem(k, { x: 0, y: 0 }),
        parentId: top.id,
        slot: k.slot,
      }))
      return [top, ...kids]
    })
    const flat = groups.flat()
    setItems((prev) => settle([...prev, ...flat], groups.map((g) => g[0].id)))
    setSelectedIds(groups.map((g) => g[0].id))
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
    if (previewMode) return
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
      const hit = topItems
        .filter((it) => {
          const ih = heightOf(it)
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
    if (previewMode) return
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

  /* 삭제 — 컨테이너를 지우면 안의 자식도 함께 */
  const removeItem = (id) => {
    setItems((prev) => compactTop(prev.filter((it) => it.id !== id && it.parentId !== id)))
    setSelectedIds((prev) => prev.filter((x) => x !== id))
  }

  const removeSelected = () => {
    const ids = new Set(selectedIds)
    setItems((prev) => compactTop(prev.filter((it) => !ids.has(it.id) && !ids.has(it.parentId))))
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
    cloneItem(src, { x: src.x, y: src.y + heightOf(src) + GAP })

  /* 사본 그룹: 컨테이너면 자식까지, 자식이면 같은 컨테이너 안 다음 슬롯으로 */
  const cloneGroup = (src, list) => {
    if (src.parentId) {
      return [{ ...cloneItem(src, { x: 0, y: 0 }), parentId: src.parentId, slot: nextSlot(list, src.parentId) }]
    }
    const copy = cloneOf(src)
    const kids = list
      .filter((k) => k.parentId === src.id)
      .map((k) => ({ ...cloneItem(k, { x: 0, y: 0 }), parentId: copy.id, slot: k.slot }))
    return [copy, ...kids]
  }

  const duplicateItem = (id) => {
    const src = items.find((it) => it.id === id)
    if (!src) return
    const group = cloneGroup(src, items)
    setItems((prev) => settle([...prev, ...group], [group[0].id]))
    setSelectedIds([group[0].id])
  }

  /* 선택된 모든 컴포넌트 복제 (⌘D) */
  const duplicateSelected = () => {
    const srcs = items.filter((it) => selectedIds.includes(it.id))
    if (srcs.length === 0) return
    const groups = srcs.map((s) => cloneGroup(s, items))
    const flat = groups.flat()
    setItems((prev) => settle([...prev, ...flat], groups.map((g) => g[0].id)))
    setSelectedIds(groups.map((g) => g[0].id))
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

  /* 드래그 위치 발행: 드래그 아이템은 즉시, 겹침 회피 미리보기 기준 위치는
     DRAG_PREVIEW_MS 간격으로만 갱신해 주변 아이템이 차분하게 반응하도록 */
  const publishDragPos = (pos) => {
    dragPosRef.current = pos
    setDragPos(pos)
    if (!dragLayoutPosRef.current) {
      dragLayoutPosRef.current = pos
      setDragLayoutPos(pos)
    } else if (!dragLayoutTimerRef.current) {
      dragLayoutTimerRef.current = setTimeout(() => {
        dragLayoutTimerRef.current = null
        if (!dragPosRef.current) return // 이미 드롭됨
        dragLayoutPosRef.current = dragPosRef.current
        setDragLayoutPos(dragPosRef.current)
      }, DRAG_PREVIEW_MS)
    }
  }

  const onDrag = (id, x, y, clientX, clientY) => {
    // 포인터의 캔버스 좌표 — 컨테이너 드롭 판정에 사용 (아이템 중심보다 정확)
    const pointer =
      clientX != null && canvasRef.current
        ? (() => {
            const rect = canvasRef.current.getBoundingClientRect()
            return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom }
          })()
        : null
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
      publishDragPos(pos)
      setGuides([])
      setDropTargetId(null)
      setInsertHint(null)
      return
    }

    // 단일 드래그: 스마트 스냅 (캔버스 가장자리/중앙, 다른 아이템 모서리·간격)
    const it = items.find((i) => i.id === id)
    const w = it ? it.w : itemW
    const hh = it ? heightOf(it) : 80
    let nx = Math.max(0, Math.min(canvasW - w, x))
    let ny = Math.max(0, y)
    const activeGuides = []

    const vCands = [
      [PAD, PAD],
      [(canvasW - w) / 2, canvasW / 2],
      [canvasW - PAD - w, canvasW - PAD],
    ]
    topItems.forEach((o) => {
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
    topItems.forEach((o) => {
      if (o.id === id) return
      const oh = heightOf(o)
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
    // 컨테이너 위에 있으면 "안에 배치" 드롭 대상 하이라이트 + 삽입 위치 가이드 라인
    const probe = pointer || { x: nx + w / 2, y: ny + hh / 2 }
    const hover = !LIBRARY[it?.type]?.container ? containerAt(probe.x, probe.y, id, NEST_INSET) : null
    setDropTargetId(hover ? hover.id : null)
    setInsertHint(hover ? insertHintAt(hover, probe.x, probe.y) : null)
    const pos = { id, positions: { [id]: { x: nx, y: ny } }, pointer: probe }
    publishDragPos(pos)
  }

  const onDragEnd = (id) => {
    const pos = dragPosRef.current
    dragPosRef.current = null
    dragStartRef.current = null
    if (dragLayoutTimerRef.current) {
      clearTimeout(dragLayoutTimerRef.current)
      dragLayoutTimerRef.current = null
    }
    dragLayoutPosRef.current = null
    setDragLayoutPos(null)
    setGuides([])
    setDropTargetId(null)
    setInsertHint(null)
    // 진행 중인 React 렌더와 커밋이 겹치지 않도록 다음 틱으로 미룬다
    setTimeout(() => {
      if (pos && pos.id === id) {
        setItems((prev) => {
          const draggedIds = Object.keys(pos.positions)
          // 단일 드래그를 컨테이너 위에 놓으면 안으로 배치
          if (draggedIds.length === 1) {
            const dId = draggedIds[0]
            const dragged = prev.find((it) => it.id === dId)
            if (dragged && !LIBRARY[dragged.type]?.container) {
              const p2 = pos.positions[dId]
              // 드롭 판정: 포인터 위치 우선, 없으면 아이템 중심
              const cx = pos.pointer ? pos.pointer.x : p2.x + dragged.w / 2
              const cy = pos.pointer ? pos.pointer.y : p2.y + heightOf(dragged) / 2
              // 삽입 판정은 드래그 중 하이라이트와 동일하게 가장자리 인셋 안쪽만 (containerAt과 동일 기준)
              const target = prev.find((it) => {
                if (it.id === dId || it.parentId || !LIBRARY[it.type]?.container) return false
                const hh = heightOf(it)
                const ix = Math.min(NEST_INSET, it.w / 4, hh / 4)
                return cx >= it.x + ix && cx <= it.x + it.w - ix && cy >= it.y + ix && cy <= it.y + hh - ix
              })
              if (target) {
                const idx = slotIndexAt(target.id, target.type, cx, cy)
                const nested = placeChild(prev, dId, target.id, idx)
                api.showToast(`${LIBRARY[dragged.type]?.label}을(를) ${LIBRARY[target.type]?.label} 안에 배치했어요.`)
                // 드롭 직후 컴팩트가 대상 컨테이너를 다시 움직이지 않도록 자리를 고정한다.
                return settle(nested, [target.id])
              }
            }
          }
          const movedList = prev.map((it) => (pos.positions[it.id] ? { ...it, ...pos.positions[it.id] } : it))
          return settle(movedList, draggedIds)
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
    const ids = new Set(
      items.filter((it) => selectedIds.includes(it.id) && !it.locked && !it.parentId).map((it) => it.id)
    )
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
    setItems((prev) =>
      withTopOnly(prev, (top) => {
        const aligned = alignItems(top, selectedIds, mode, { canvasW }, heightsRef.current)
        return compactOn ? compactItems(aligned, heightsRef.current, compactOpts()) : aligned
      })
    )
  }

  /* 레이어 패널에서 순서 바꾸기 — 최상위는 자리 교환+컴팩트, 컨테이너 자식은 슬롯 순서 교환 */
  const moveLayer = (id, dir) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === id)
      if (target && target.parentId) {
        const sibs = prev
          .filter((it) => it.parentId === target.parentId)
          .sort((a, b) => (a.slot || 0) - (b.slot || 0))
        const idx = sibs.findIndex((it) => it.id === id)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= sibs.length) return prev
        const order = sibs.map((s) => s.id)
        ;[order[idx], order[j]] = [order[j], order[idx]]
        return prev.map((it) => {
          const k = order.indexOf(it.id)
          return k >= 0 ? { ...it, slot: k + 1 } : it
        })
      }
      return withTopOnly(prev, (top) => {
        const sorted = [...top].sort((a, b) => (a.y - b.y) || (a.x - b.x))
        const idx = sorted.findIndex((it) => it.id === id)
        const j = idx + dir
        if (idx < 0 || j < 0 || j >= sorted.length) return top
        const a = sorted[idx]
        const b = sorted[j]
        const swapped = top.map((it) =>
          it.id === a.id ? { ...it, x: b.x, y: b.y } : it.id === b.id ? { ...it, x: a.x, y: a.y } : it
        )
        return layoutCompactUp(swapped, heightsRef.current)
      })
    })
  }

  /* 레이어 트리 드래그 — 캔버스에서 잡기 어려운 중첩 구조를 정밀하게 변경한다. */
  const dropLayer = (id, targetId, placement) => {
    const source = items.find((it) => it.id === id)
    const target = items.find((it) => it.id === targetId)
    if (!source || !target || source.id === target.id || source.locked) return

    if (placement === 'inside') {
      if (!LIBRARY[target.type]?.container || LIBRARY[source.type]?.container) {
        api.showToast('레이아웃 안에는 일반 컴포넌트만 넣을 수 있어요.')
        return
      }
      setItems((prev) => placeChild(prev, id, targetId, Infinity))
      setSelectedIds([id])
      api.showToast(`${LIBRARY[source.type]?.label}을(를) ${LIBRARY[target.type]?.label} 안에 배치했어요.`)
      return
    }

    if (target.parentId) {
      if (LIBRARY[source.type]?.container) {
        api.showToast('레이아웃 안에 레이아웃은 넣을 수 없어요.')
        return
      }
      setItems((prev) => {
        const siblings = prev
          .filter((it) => it.parentId === target.parentId && it.id !== id)
          .sort((a, b) => (a.slot || 0) - (b.slot || 0))
        const targetIndex = siblings.findIndex((it) => it.id === targetId)
        const index = Math.max(0, targetIndex + (placement === 'after' ? 1 : 0))
        return placeChild(prev, id, target.parentId, index)
      })
      setSelectedIds([id])
      return
    }

    // 최상위끼리는 현재 캔버스 자리 집합을 유지한 채 레이어 순서를 바꾼다.
    if (!source.parentId) {
      setItems((prev) => {
        const sorted = [...prev.filter((it) => !it.parentId)].sort((a, b) => (a.y - b.y) || (a.x - b.x))
        const slots = sorted.map((it) => ({ x: it.x, y: it.y }))
        const order = sorted.filter((it) => it.id !== id).map((it) => it.id)
        const targetIndex = order.indexOf(targetId)
        order.splice(Math.max(0, targetIndex + (placement === 'after' ? 1 : 0)), 0, id)
        return prev.map((it) => {
          const index = order.indexOf(it.id)
          return index >= 0 ? { ...it, ...slots[index] } : it
        })
      })
      setSelectedIds([id])
    }
  }

  /* ── 키보드 단축키 ── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return
      if (previewMode) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedIds(topItems.map((it) => it.id))
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
    if (previewMode) return
    if (!focusTick) return
    const el = document.querySelector('.sb-inspector input[type="text"], .sb-inspector textarea')
    if (el) {
      el.focus()
      if (el.select) el.select()
    }
  }, [focusTick, previewMode])

  /* ── 상단 바 액션 ── */
  const changeDevice = (preset) => {
    if (previewMode) return
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
    if (previewMode) return
    setOpenMenu(null)
    setItems((prev) => withTopOnly(prev, (top) => mode.fn(top, heightsRef.current, { itemW, canvasW })))
    // 너비가 바뀌는 정렬은 높이가 다시 측정된 뒤 한 번 더 컴팩트하게 보정한다
    if (mode.key !== 'compact') {
      setTimeout(() => {
        setItems((prev) => withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
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
    if (previewMode) return
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

  /* 드래그 중에는 다른 아이템들이 밀려나는 미리보기 레이아웃.
     컴팩트가 켜져 있으면 드래그 중인 아이템만 포인터에 고정하고 나머지를 스택.
     둔화: 재배치 기준 위치는 스로틀된 dragLayoutPos를 쓰고(드래그 아이템 렌더는
     CanvasItem의 dragPos prop이 즉시 반영), 겹침 판정은 soft 임계값을 적용 */
  let displayItems = items
  if (dragPos) {
    const layoutPos = dragLayoutPos || dragPos
    const moved = items.map((it) =>
      layoutPos.positions[it.id] ? { ...it, ...layoutPos.positions[it.id] } : it
    )
    const draggedIds = Object.keys(dragPos.positions)
    const soft = {
      ids: new Set(draggedIds),
      // 컨테이너는 삽입 여지를 위해 더 둔감하게(60%), 일반 아이템은 35%
      ratioOf: (box) => (LIBRARY[box.type]?.container ? CONTAINER_SOFT_RATIO : DRAG_SOFT_RATIO),
    }
    displayItems = withTopOnly(moved, (top) => {
      const dragged = draggedIds.length === 1 ? items.find((it) => it.id === draggedIds[0]) : null
      const canNest = dragged && !LIBRARY[dragged.type]?.container
      // 포인터가 가리키는 "안에 배치" 대상 컨테이너만 고정 드롭존으로 취급한다.
      // 나머지 컨테이너는 일반 아이템처럼 겹침 회피에 참여 (CONTAINER_SOFT_RATIO 임계)
      const pinnedIds =
        canNest && dropTargetId ? [...draggedIds, dropTargetId] : draggedIds
      const resolved = resolveCollision(top, pinnedIds, heightsRef.current, soft)
      return compactOn
        ? compactItems(resolved, heightsRef.current, { ...compactOpts(pinnedIds), soft })
        : resolved
    })
  }

  const canvasHeight = Math.max(
    560,
    ...displayItems.map((it) => {
      const y = (dragPos && dragPos.positions[it.id]?.y) ?? it.y
      return y + heightOf(it) + 120
    })
  )

  const ensureKeyword = (word) => {
    if (!word) return
    if ((api.keywords || []).some((k) => k.word === word)) return
    api.updateKeywords([...(api.keywords || []), { word, desc: '', points: '' }])
    api.showToast(`"${word}" 키워드를 사전에 추가했어요. 탐색 편집기에서 설명을 채워주세요.`)
  }

  /* 캔버스 렌더 컨텍스트: 미리보기에서는 편집 콜백을 제외해 모든 컴포넌트를 읽기 전용으로 만든다. */
  const canvasCtx = {
    mode: 'canvas',
    canvasView, // 'edit' = 컨테이너 클리핑 해제, 'preview' = 실사용 모습
    allItems: items, // 컨테이너가 자식을 찾아 렌더할 때 사용
    selectedIds, // 자식 셸의 선택 표시
    draggingChildId, // 컨테이너 안 재정렬 중인 자식 강조
    childPointerDown, // 자식 클릭 선택 / 드래그 꺼내기
    childResizeDown, // 자식 리사이즈 핸들
    inspectChild: (id) => {
      if (previewMode) return
      setSelectedIds([id])
      setFocusTick((t) => t + 1)
    },
    profile: api.profile,
    ...(previewMode ? {} : {
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
    }),
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
    <div className={'sb-builder' + (previewMode ? ' sb-builder--preview' : '')}>
      {/* 상단 바 — 1행: 문서 정보 + 발행, 2행: 단계 탭 + 편집 도구 그룹 */}
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
                <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'version' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('version')} title="발행 시점 버전 복원">
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

        {/* 2행: 편집 도구 그룹 (구분선 분리) */}
        <div className="sb-topbar__row sb-topbar__row--tools">
          <div className="sb-tb-group" role="group" aria-label="히스토리">
            <button type="button" className="sb-icon-btn" title="실행 취소 (⌘Z)" aria-label="실행 취소" disabled={previewMode || historyRef.current.past.length === 0} onClick={undo}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></svg>
            </button>
            <button type="button" className="sb-icon-btn" title="다시 실행 (⇧⌘Z)" aria-label="다시 실행" disabled={previewMode || historyRef.current.future.length === 0} onClick={redo}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></svg>
            </button>
          </div>
          <span className="sb-tb-sep" aria-hidden="true" />
          <div className="sb-tb-group" role="group" aria-label="보기">
            <button
              type="button"
              className={'sb-btn' + (canvasView === 'preview' ? ' sb-btn--compact-on' : '')}
              title={canvasView === 'preview'
                ? '미리보기 모드 — 실제 사용자가 보는 모습 (클릭해 편집 모드로)'
                : '편집 모드 — 레이아웃 클리핑을 풀고 모든 자식을 온전히 표시 (클릭해 미리보기로)'}
              onClick={() => setCanvasView((v) => (v === 'edit' ? 'preview' : 'edit'))}
            >
              {canvasView === 'preview' ? '👁 미리보기' : '✏️ 편집 모드'}
            </button>
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
              <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'device' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('device')} title="캔버스 기기 폭 선택">
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
                disabled={previewMode}
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
              <button type="button" disabled={previewMode} className={'sb-btn' + (openMenu === 'layout' ? ' sb-btn--open' : '')} onClick={() => toggleMenu('layout')}>
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

        {/* 3행: 단계 탭 — 탐색(공통 캔버스)도 설문/계획처럼 직접 편집 */}
        <div className="sb-topbar__row sb-topbar__row--tabs">
          <div className="sb-stage-tabs">
            {BUILD_STAGES.map((s, i) => (
              <React.Fragment key={s.key}>
                {i === 1 && <span className="sb-stage-tabs__divider" aria-hidden="true" />}
                <button
                  type="button"
                  className={
                    'sb-stage-tab' +
                    (s.common ? ' sb-stage-tab--common' : '') +
                    (stageKey === s.key ? ' sb-stage-tab--active' : '')
                  }
                  title={s.desc}
                  onClick={() => setStageKey(s.key)}
                >
                  <span className="sb-stage-tab__num">{s.common ? '🧭' : i}</span>
                  {s.label}
                  <span className="sb-stage-tab__count">
                    {s.common ? (api.explore.items || []).length : (scenario.stages[s.key] || []).length}
                  </span>
                </button>
              </React.Fragment>
            ))}
            {isExplore && <span className="sb-stage-tabs__note">공통 페이지 · 모든 시나리오 홈에 즉시 반영</span>}
          </div>
        </div>
      </div>

      <div className="sb-workspace">
        <Palette
          disabled={previewMode}
          stageKey={stageKey}
          items={items}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onAdd={addItem}
          onMoveLayer={moveLayer}
          onRemove={removeItem}
          onToggleLock={(id) => updateItem(id, { locked: !items.find((it) => it.id === id)?.locked })}
          onToggleHide={(id) => updateItem(id, { hidden: !items.find((it) => it.id === id)?.hidden })}
          onUnnest={unnestItem}
          onDropLayer={dropLayer}
        />

        {/* 캔버스 */}
        <main className="sb-canvas-wrap" onPointerDown={(e) => { if (!previewMode && e.target === e.currentTarget) setSelectedIds([]) }}>
          <div className="sb-canvas-col" style={{ width: canvasW * zoom }}>
            <div className="sb-canvas-scale" style={{ width: canvasW * zoom, height: canvasHeight * zoom }}>
              <div
                ref={canvasRef}
                className={'sb-canvas' + (canvasView === 'preview' ? ' sb-canvas--preview' : ' sb-canvas--edit')}
                style={{ width: canvasW, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
                onPointerDown={previewMode ? undefined : onCanvasPointerDown}
                onContextMenu={previewMode ? undefined : (e) => { if (e.target === e.currentTarget) openCtxMenu(e, null) }}
                onDragOver={(e) => {
                  if (previewMode) return
                  if ([...e.dataTransfer.types].includes('text/sb-type')) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                    const rect = canvasRef.current.getBoundingClientRect()
                    const cx = (e.clientX - rect.left) / zoom
                    const cy = (e.clientY - rect.top) / zoom
                    const hover = containerAt(cx, cy)
                    setDropTargetId(hover ? hover.id : null)
                    setInsertHint(hover ? insertHintAt(hover, cx, cy) : null)
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDropTargetId(null)
                    setInsertHint(null)
                  }
                }}
                onDrop={(e) => {
                  if (previewMode) return
                  const type = e.dataTransfer.getData('text/sb-type')
                  if (!type) return
                  e.preventDefault()
                  setDropTargetId(null)
                  setInsertHint(null)
                  const rect = canvasRef.current.getBoundingClientRect()
                  const cx = (e.clientX - rect.left) / zoom
                  const cy = (e.clientY - rect.top) / zoom
                  // 컨테이너 위에 놓으면 그 위치의 슬롯에 자식으로 배치
                  const target = !LIBRARY[type]?.container && containerAt(cx, cy)
                  if (target) addChild(type, target.id, { containerType: target.type, cx, cy })
                  else addItemAt(type, cx, cy)
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
                {insertHint && (
                  <div
                    className={'sb-insert-line sb-insert-line--' + insertHint.dir}
                    style={
                      insertHint.dir === 'v'
                        ? { left: insertHint.x, top: insertHint.y, height: insertHint.len }
                        : { left: insertHint.x, top: insertHint.y, width: insertHint.len }
                    }
                  />
                )}
                {marquee && (
                  <div
                    className="sb-marquee"
                    style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
                  />
                )}
                {displayItems.filter((it) => !it.parentId).map((it) => (
                  <CanvasItem
                    key={it.id}
                    item={it}
                    editable={!previewMode}
                    zoom={zoom}
                    dropTarget={dropTargetId === it.id}
                    selected={selectedIds.includes(it.id)}
                    dragPos={dragPos && dragPos.positions[it.id] ? dragPos.positions[it.id] : null}
                    sizeDraft={sizeDraft && sizeDraft.id === it.id ? sizeDraft : null}
                    heightsRef={heightsRef}
                    onMeasure={() => setMeasureVer((v) => v + 1)}
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
          disabled={previewMode}
          stageKey={stageKey}
          containerPanel={
            !previewMode && managedContainer ? (
              <ContainerContents
                container={managedContainer}
                children={managedChildren}
                selectedId={selectedId}
                onSelect={selectManagedItem}
                onSelectContainer={() => setSelectedIds([managedContainer.id])}
                onMove={moveLayer}
                onUpdate={updateItem}
                onDuplicate={duplicateItem}
                onRemove={removeItem}
                onUnnest={unnestItem}
              />
            ) : null
          }
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
          unnestItem={unnestItem}
        />

        <CanvasTextToolbar active={!previewMode && !!inlineEdit} ensureKeyword={ensureKeyword} />

        {!previewMode && (
          /* 우클릭 컨텍스트 메뉴 (Figma/Canva식) */
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
        )}
      </div>
      {childDragGhost && (
        <div
          className="sb-child-drag-ghost"
          style={{ left: childDragGhost.x, top: childDragGhost.y }}
          aria-hidden="true"
        >
          <span>{childDragGhost.icon}</span>
          {childDragGhost.label}
        </div>
      )}
    </div>
  )
}
