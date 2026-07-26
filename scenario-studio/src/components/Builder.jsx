import React, { useEffect, useRef, useState } from 'react'
import { STAGES, DEVICE_PRESETS, createItem, planCasesForScenario, visibleProfileItems } from '../lib/store.js'
import { LIBRARY } from '../lib/registry.jsx'
import { PAD, GAP, MIN_ITEM_W, layoutCompactUp } from '../lib/layout.js'
import { buildShareUrl } from '../lib/share.js'
import {
  containerAt as containerAtPoint,
  insertHintAt,
  itemHeight,
  slotIndexAt,
  stackBottom,
} from '../lib/builder/geometry.js'
import { createLayoutOps } from '../lib/builder/layoutOps.js'
import { cloneGroup, fromClipboardEntries, toClipboardEntries } from '../lib/builder/itemClipboard.js'
import {
  VERSION_LIMIT,
  publishSnapshot,
  publishWarnings,
  rescaleForDevice,
  resolveChipLabel,
  scenarioFromSnapshot,
} from '../lib/builder/publishing.js'
import {
  EVALUATION_CASE_SLOTS,
  evaluationCasesFor,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
} from '../lib/evaluation.js'
import Palette from './builder/Palette.jsx'
import Inspector from './builder/Inspector.jsx'
import ContainerContents from './builder/ContainerContents.jsx'
import CanvasTextToolbar from './builder/CanvasTextToolbar.jsx'
import ContextMenu from './builder/ContextMenu.jsx'
import EvaluationPanel from './builder/EvaluationPanel.jsx'
import CaseGenerationDialog from './builder/CaseGenerationDialog.jsx'
import CaseRevisionDialog from './builder/CaseRevisionDialog.jsx'
import BuilderTopBar from './builder/BuilderTopBar.jsx'
import BuilderCanvas from './builder/BuilderCanvas.jsx'
import PlanCaseBar from './builder/PlanCaseBar.jsx'
import { useBuilderHistory } from './builder/hooks/useBuilderHistory.js'
import { useStageItems } from './builder/hooks/useStageItems.js'
import { usePlanCases } from './builder/hooks/usePlanCases.js'
import { useCanvasDrag } from './builder/hooks/useCanvasDrag.js'
import { useContainerNesting } from './builder/hooks/useContainerNesting.js'
import { useBuilderShortcuts } from './builder/hooks/useBuilderShortcuts.js'

/*
 * 빌더 오케스트레이터.
 *
 * 편집 상태(무엇이 선택됐고 어느 단계를 보고 있는가)를 갖고, 각 관심사를 담당하는
 * 훅과 컴포넌트를 연결한다. 실제 규칙은 아래로 내려가 있다:
 *   lib/builder/geometry     — 좌표·슬롯 계산
 *   lib/builder/layoutOps    — 겹침 해소·컴팩트 커밋 관문
 *   lib/builder/itemClipboard— 사본 만들기
 *   lib/builder/publishing   — 발행 점검·버전 스냅샷·기기 폭 환산
 *   hooks/useStageItems      — 아이템을 어디서 읽고 어디에 저장할지
 *   hooks/useBuilderHistory  — Undo/Redo 스택
 *   hooks/usePlanCases       — 계획 케이스 CRUD·평가
 *   hooks/useCanvasDrag      — 드래그·리사이즈·밀림 미리보기
 *   hooks/useContainerNesting— 컨테이너 자식 넣기/꺼내기/순서
 *   hooks/useBuilderShortcuts— 키보드
 */

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState(STAGES[0].key)
  const isExplore = stageKey === 'explore'
  const isEvaluation = stageKey === 'evaluation'
  const planCases = scenario.planCases || planCasesForScenario(scenario)
  const [planCaseId, setPlanCaseId] = useState(() => planCases[0]?.id || null)
  const activePlanCase = planCases.find((planCase) => planCase.id === planCaseId) || planCases[0]

  const [selectedIds, setSelectedIds] = useState([]) // 다중 선택 (⇧+클릭)
  const [openMenu, setOpenMenu] = useState(null) // 'device' | 'compact' | 'layout' | 'color' | 'version' | 'case'
  const [focusTick, setFocusTick] = useState(0) // 더블클릭 → 인스펙터 포커스 신호
  const [focusFieldKey, setFocusFieldKey] = useState(null) // 평가에서 인스펙터의 정확한 필드로 이동
  const [inlineEdit, setInlineEdit] = useState(null) // 캔버스 인라인 텍스트 편집 { itemId, key }
  const [zoom, setZoom] = useState(1)
  const [canvasView, setCanvasView] = useState('edit') // 'edit'(편집 크롬) | 'preview'(실사용 모습)
  const previewMode = !isEvaluation && canvasView === 'preview'
  const [marquee, setMarquee] = useState(null) // 러버밴드 선택 박스
  const [ctxMenu, setCtxMenu] = useState(null) // 우클릭 메뉴 { sx, sy, cx, cy, itemId }
  const [dropTargetId, setDropTargetId] = useState(null) // 컨테이너 드롭 대상 하이라이트
  const [insertHint, setInsertHint] = useState(null) // 컨테이너 삽입 캐럿 { dir, x, y, len }
  const [draggingChildId, setDraggingChildId] = useState(null)
  const [childDragGhost, setChildDragGhost] = useState(null) // 자식 재정렬 중 포인터 옆 피드백
  const [caseGenOpen, setCaseGenOpen] = useState(false)
  const [caseRevOpen, setCaseRevOpen] = useState(false) // 현재 케이스 통째 재구성
  const [feedbackTarget, setFeedbackTarget] = useState(null) // { caseId, itemId, fieldKey, label }
  const [, setMeasureVer] = useState(0) // 실제 표시 높이 변경을 캔버스 스크롤 범위에 반영

  const canvasRef = useRef(null)
  const heightsRef = useRef({}) // ResizeObserver가 채우는 실제 표시 높이
  const clipboardRef = useRef(null) // ⌘C 스냅샷 (단계 간 붙여넣기 가능)
  const measureLayoutTimerRef = useRef(null)

  /* ── 현재 편집 대상 ── */
  const items = isEvaluation
    ? []
    : isExplore
      ? (api.explore.items || [])
      : stageKey === 'plan'
        ? (activePlanCase?.items || [])
        : (scenario.stages[stageKey] || [])
  const topItems = items.filter((item) => !item.parentId)

  const device = DEVICE_PRESETS.find((preset) => preset.key === (scenario.device || 'desktop')) || DEVICE_PRESETS[0]
  const canvasW = device.w
  const itemW = canvasW - PAD * 2
  /* 구버전 gravity: false 데이터는 'none'으로 해석 */
  const compactType = scenario.compact || (scenario.gravity === false ? 'none' : 'vertical')
  const layout = createLayoutOps({ heightsRef, compactType, canvasW })
  const heightOf = (item) => itemHeight(item, heightsRef.current, { previewMode })

  /* ── 히스토리 · 저장 ── */
  const history = useBuilderHistory({
    enabled: !previewMode,
    takeSnapshot: () => JSON.stringify({
      stages: scenario.stages,
      planCases,
      device: scenario.device,
      exploreItems: api.explore.items || [],
    }),
    applySnapshot: (snapshot) => {
      const data = JSON.parse(snapshot)
      const restoredCases = planCasesForScenario({ stages: data.stages || data, planCases: data.planCases })
      setSelectedIds([])
      api.updateScenario(scenario.id, (current) => ({
        ...current,
        stages: data.stages || data,
        planCases: restoredCases,
        device: data.device || current.device,
      }))
      if (!restoredCases.some((planCase) => planCase.id === planCaseId)) {
        setPlanCaseId(restoredCases[0]?.id || null)
      }
      if (data.exploreItems) api.updateExplore({ ...api.explore, items: data.exploreItems })
    },
  })

  const { setItems, setItemsFromMeasure } = useStageItems({
    api, scenario, stageKey, planCaseId, previewMode, pushHistory: history.pushHistory,
  })

  const cases = usePlanCases({
    api, scenario, planCases, planCaseId, activePlanCase, setPlanCaseId, previewMode,
    pushHistory: history.pushHistory,
  })

  /* ── 좌표 헬퍼 (geometry에 현재 캔버스 상태를 묶어 둔 얇은 래퍼) ── */
  const containerAt = (x, y, excludeId) => containerAtPoint(topItems, x, y, { excludeId, heightOf })
  const slotIndexOf = (containerId, containerType, cx, cy, excludeId) =>
    slotIndexAt({ canvasEl: canvasRef.current, zoom, containerId, containerType, cx, cy, excludeId })
  const insertHintOf = (container, cx, cy, excludeId) =>
    insertHintAt({ canvasEl: canvasRef.current, zoom, container, cx, cy, excludeId })

  /* ── 선택 ── */
  /* ⇧+클릭 = 토글 추가, 일반 클릭 = 단일 선택(그룹 멤버를 클릭하면 그룹 유지) */
  const handleSelect = (id, shift) => {
    if (previewMode) return
    setSelectedIds((prev) => {
      if (shift) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      return prev.includes(id) && prev.length > 1 ? prev : [id]
    })
  }
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const selected = items.find((item) => item.id === selectedId) || null
  const managedContainer = selected
    ? LIBRARY[selected.type]?.container
      ? selected
      : selected.parentId
        ? items.find((item) => item.id === selected.parentId) || null
        : null
    : null
  const managedChildren = managedContainer
    ? items.filter((item) => item.parentId === managedContainer.id).sort((a, b) => (a.slot || 0) - (b.slot || 0))
    : []

  /* ── 드래그 · 중첩 ── */
  const drag = useCanvasDrag({
    items, topItems, itemW, canvasW, zoom, canvasRef, heightsRef, heightOf, layout,
    slotIndexOf, insertHintOf, setItems, setSelectedIds, selectedIds,
    setDropTargetId, setInsertHint, showToast: api.showToast,
  })

  const nesting = useContainerNesting({
    items, itemW, heightsRef, zoom, canvasRef, heightOf, layout, slotIndexOf, insertHintOf,
    setItems, setSelectedIds, onSelect: handleSelect, previewMode, showToast: api.showToast,
    drag, setDropTargetId, setInsertHint, setDraggingChildId, setChildDragGhost,
  })

  /* ── 아이템 추가 · 편집 · 삭제 ── */
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

  const updateItem = (id, patch) => setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
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
    api.showToast(`${entries.length}개 컴포넌트를 복사했어요. ⌘V로 붙여넣어요.`)
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

  /* ── 캔버스 상호작용 ── */
  const zoomBy = (direction) => {
    setZoom((current) => {
      const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.01)
      return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (index < 0 ? 4 : index) + direction))]
    })
  }

  /* 러버밴드(마퀴) 다중 선택: 빈 캔버스를 드래그 */
  const onCanvasPointerDown = (event) => {
    if (previewMode) return
    if (event.target !== event.currentTarget || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const sx = (event.clientX - rect.left) / zoom
    const sy = (event.clientY - rect.top) / zoom
    const baseSelection = event.shiftKey ? [...selectedIds] : []
    if (!event.shiftKey) setSelectedIds([])
    const move = (moveEvent) => {
      const cx = (moveEvent.clientX - rect.left) / zoom
      const cy = (moveEvent.clientY - rect.top) / zoom
      const box = { x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) }
      if (box.w < 3 && box.h < 3) return
      setMarquee(box)
      const hit = topItems
        .filter((item) => {
          const height = heightOf(item)
          return item.x < box.x + box.w && item.x + item.w > box.x
            && item.y < box.y + box.h && item.y + height > box.y
        })
        .map((item) => item.id)
      setSelectedIds([...new Set([...baseSelection, ...hit])])
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const openCtxMenu = (event, itemId) => {
    if (previewMode) return
    event.preventDefault()
    event.stopPropagation()
    if (itemId && !selectedIds.includes(itemId)) setSelectedIds([itemId])
    const rect = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null
    setCtxMenu({
      sx: event.clientX,
      sy: event.clientY,
      cx: rect ? (event.clientX - rect.left) / zoom : PAD,
      cy: rect ? (event.clientY - rect.top) / zoom : PAD,
      itemId: itemId || null,
    })
  }

  /* 선택된 컴포넌트들의 잠금/숨김을 클릭한 아이템 기준으로 일괄 토글 */
  const toggleSelected = (key) => {
    const target = items.find((item) => item.id === (ctxMenu && ctxMenu.itemId))
    const next = target ? !target[key] : true
    const ids = new Set(selectedIds)
    setItems((prev) => prev.map((item) => (ids.has(item.id) ? { ...item, [key]: next } : item)))
  }

  /* 팔레트 → 캔버스 HTML5 드래그 */
  const paletteDragOver = (event) => {
    if (previewMode) return
    if (![...event.dataTransfer.types].includes('text/sb-type')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = (event.clientX - rect.left) / zoom
    const cy = (event.clientY - rect.top) / zoom
    const hover = containerAt(cx, cy)
    setDropTargetId(hover ? hover.id : null)
    setInsertHint(hover ? insertHintOf(hover, cx, cy) : null)
  }
  const paletteDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetId(null)
    setInsertHint(null)
  }
  const paletteDrop = (event) => {
    if (previewMode) return
    const type = event.dataTransfer.getData('text/sb-type')
    if (!type) return
    event.preventDefault()
    setDropTargetId(null)
    setInsertHint(null)
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = (event.clientX - rect.left) / zoom
    const cy = (event.clientY - rect.top) / zoom
    // 컨테이너 위에 놓으면 그 위치의 슬롯에 자식으로 배치
    const target = !LIBRARY[type]?.container && containerAt(cx, cy)
    if (target) nesting.addChild(type, target.id, { containerType: target.type, cx, cy })
    else addItemAt(type, cx, cy)
  }

  /* 이미지 로딩·줄바꿈으로 실제 높이가 바뀌면 조용히 재컴팩트한다.
     측정은 사용자 편집이 아니므로 Undo 스냅샷에 넣지 않는다. */
  const onItemMeasure = () => {
    setMeasureVer((version) => version + 1)
    if (previewMode || !layout.compactOn || drag.isDragging()) return
    clearTimeout(measureLayoutTimerRef.current)
    measureLayoutTimerRef.current = setTimeout(() => {
      setItemsFromMeasure((prev) => layout.compact(prev))
    }, 80)
  }
  useEffect(() => () => clearTimeout(measureLayoutTimerRef.current), [])

  /* ── 상단 바 액션 ── */
  const toggleMenu = (key) => setOpenMenu((current) => (current === key ? null : key))
  const closeMenu = () => setOpenMenu(null)
  const patchScenario = (patch) => api.updateScenario(scenario.id, (current) => ({ ...current, ...patch }))

  const changeDevice = (preset) => {
    if (previewMode) return
    closeMenu()
    if (preset.key === (scenario.device || 'desktop')) return
    history.pushHistory()
    api.updateScenario(scenario.id, (current) => ({
      ...current,
      ...rescaleForDevice(current, preset, { pad: PAD, minItemW: MIN_ITEM_W, currentCanvasW: canvasW }),
    }))
    // 폭 변경으로 높이가 다시 측정된 뒤 겹침/간격을 보정한다.
    // withTopOnly 필수 — 자식까지 넘기면 컴팩트가 자식을 캔버스 아이템으로 취급해
    // 좌표를 부여하고, 그 유령 블록이 최상위 아이템을 아래로 밀어낸다.
    setTimeout(() => {
      setItems((prev) => layout.withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
    }, 200)
    api.showToast(`${preset.label} 폭 기준으로 캔버스를 전환했어요.`)
  }

  const changeCompact = (type) => {
    if (previewMode) return
    closeMenu()
    if (type.key === compactType) return
    patchScenario({ compact: type.key })
    if (type.key !== 'none') setItems((prev) => layout.compactTo(prev, type.key))
    api.showToast(`${type.label} — ${type.desc}`)
  }

  const runAutoLayout = (mode) => {
    if (previewMode) return
    closeMenu()
    setItems((prev) => layout.withTopOnly(prev, (top) => mode.fn(top, heightsRef.current, { itemW, canvasW })))
    // 너비가 바뀌는 정렬은 높이가 다시 측정된 뒤 한 번 더 보정한다
    if (mode.key !== 'compact') {
      setTimeout(() => {
        setItems((prev) => layout.withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
      }, 180)
    }
    api.showToast(`${mode.label}로 겹침 없이 배치했어요.`)
  }

  const publish = () => {
    const warnings = publishWarnings(scenario, planCases)
    if (warnings.length > 0 && !window.confirm(`${warnings.join('\n')}\n\n그래도 발행할까요?`)) return
    const chip = resolveChipLabel(scenario)
    const snapshot = publishSnapshot(scenario, planCases, chip)
    api.updateScenario(scenario.id, (current) => ({
      ...current,
      status: 'published',
      chip,
      versions: [...(current.versions || []), snapshot].slice(-VERSION_LIMIT),
    }))
    api.showToast(`"#${chip}" 칩이 홈 탐색창 밑에 발행됐어요!`)
    api.goHome()
  }

  /* 발행 버전 복원: 현재 상태는 undo 히스토리로 보존된다 */
  const restoreVersion = (snapshot) => {
    if (previewMode) return
    closeMenu()
    const when = new Date(snapshot.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    if (!window.confirm(`${when} 발행 시점으로 되돌릴까요?\n(현재 상태는 ⌘Z로 복구할 수 있어요)`)) return
    history.pushHistory()
    setSelectedIds([])
    patchScenario(scenarioFromSnapshot(snapshot))
    api.showToast('발행 시점 버전으로 복원했어요.')
  }

  /* 공유 링크: URL 해시에 시나리오 전체가 담겨 어디서든 바로 실행된다 */
  const copyShareLink = () => {
    const url = buildShareUrl(scenario)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => api.showToast('공유 링크를 복사했어요. 받는 사람은 링크만 열면 바로 체험할 수 있어요.'),
        () => window.prompt('아래 링크를 복사하세요', url)
      )
    } else {
      window.prompt('아래 링크를 복사하세요', url)
    }
  }

  /* ── 평가 ↔ 편집 이동 ── */
  const editEvaluatedCase = (caseId) => {
    setFeedbackTarget(null)
    setFocusFieldKey(null)
    setCanvasView('edit')
    setPlanCaseId(caseId)
    setStageKey('plan')
    setSelectedIds([])
  }

  /* 평가 탭에서 "이 케이스 다시 만들기" — 대상 케이스를 활성화한 뒤 재구성 다이얼로그를 연다 */
  const reviseEvaluatedCase = (caseId) => {
    setPlanCaseId(caseId)
    setCaseRevOpen(true)
  }

  const editEvaluatedComponent = (caseId, component) => {
    const label = LIBRARY[component.type]?.label || component.type
    setCanvasView('edit')
    setPlanCaseId(caseId)
    setFeedbackTarget({ caseId, itemId: component.itemId, fieldKey: null, label })
    setFocusFieldKey(null)
    setStageKey('plan')
    setSelectedIds([component.itemId])
    api.showToast(`${label} 컴포넌트와 피드백을 열었어요.`)
  }

  /* ── 상태 동기화 ── */

  /* Undo/삭제/가져오기로 현재 케이스가 사라지면 유효한 케이스로 이동 */
  useEffect(() => {
    if (planCases.some((planCase) => planCase.id === planCaseId)) return
    setPlanCaseId(planCases[0]?.id || null)
  }, [planCaseId, planCases])

  /* 평가 스튜디오는 언제나 정확히 3개 CASE(A/B/C)로 구성한다 */
  useEffect(() => {
    if (!isEvaluation) return
    const selectedCases = evaluationCasesFor(planCases)
    const slots = new Set(selectedCases.map((planCase) => normalizeCaseEvaluation(planCase.evaluation).slot))
    if (selectedCases.length === 3 && EVALUATION_CASE_SLOTS.every((slot) => slots.has(slot))) return
    cases.recommendPlanCases()
  }, [isEvaluation, planCases.length])

  /* 단계·케이스를 옮기면 진행 중이던 편집 상태를 모두 닫는다 */
  useEffect(() => {
    setSelectedIds([])
    setInlineEdit(null)
    setDraggingChildId(null)
    setChildDragGhost(null)
    setInsertHint(null)
    drag.reset()
  }, [stageKey, planCaseId])

  /* 미리보기 진입 시에도 마찬가지 */
  useEffect(() => {
    if (!previewMode) return
    setSelectedIds([])
    setInlineEdit(null)
    setMarquee(null)
    setCtxMenu(null)
    setOpenMenu(null)
    setDropTargetId(null)
    setInsertHint(null)
    setDraggingChildId(null)
    setChildDragGhost(null)
    drag.reset()
  }, [previewMode])

  /* 평가의 "피드백 반영하러 가기"가 단계 전환 초기화 뒤에도 정확한 컴포넌트를 선택하게 한다 */
  useEffect(() => {
    if (stageKey !== 'plan' || !feedbackTarget || feedbackTarget.caseId !== planCaseId) return
    if (!(activePlanCase?.items || []).some((item) => item.id === feedbackTarget.itemId)) return
    setSelectedIds([feedbackTarget.itemId])
    setFocusFieldKey(feedbackTarget.fieldKey || null)
    setFocusTick((tick) => tick + 1)
  }, [stageKey, planCaseId, feedbackTarget?.caseId, feedbackTarget?.itemId, feedbackTarget?.fieldKey])

  /* 탐색 아이템은 계정 공유라 시나리오 기기 폭과 무관하게 저장된다 —
     현재 캔버스보다 넓은 아이템은 진입/기기 변경 시 폭에 맞게 보정 */
  useEffect(() => {
    if (!isExplore) return
    const current = api.explore.items || []
    if (!current.some((item) => item.w > itemW || item.x + item.w > canvasW - PAD)) return
    api.updateExplore((prev) => ({
      ...prev,
      items: (prev.items || []).map((item) => {
        if (item.parentId) return item
        const w = Math.min(item.w, itemW)
        return { ...item, w, x: Math.max(0, Math.min(canvasW - PAD - w, item.x)) }
      }),
    }))
    setTimeout(() => {
      setItems((prev) => layout.withTopOnly(prev, (top) => layoutCompactUp(top, heightsRef.current)))
    }, 200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExplore, canvasW])

  /* 더블클릭 시 인스펙터 첫 입력란(또는 지정된 필드)에 포커스 */
  useEffect(() => {
    if (previewMode || !focusTick) return
    const selector = focusFieldKey
      ? `.sb-inspector [data-fkey="${focusFieldKey}"]`
      : '.sb-inspector input[type="text"], .sb-inspector textarea'
    const el = document.querySelector(selector)
    if (el) {
      el.focus()
      if (el.select) el.select()
    }
  }, [focusTick, previewMode, focusFieldKey])

  useBuilderShortcuts({
    enabled: !previewMode,
    actions: {
      undo: history.undo,
      redo: history.redo,
      selectAll: () => setSelectedIds(topItems.map((item) => item.id)),
      hasSelection: () => selectedIds.length > 0,
      duplicate: duplicateSelected,
      copy: copySelected,
      paste: () => pasteClipboard(),
      canPaste: () => !!(clipboardRef.current && clipboardRef.current.length > 0),
      remove: removeSelected,
      clearSelection: () => setSelectedIds([]),
      closeContextMenu: () => {
        if (!ctxMenu) return false
        setCtxMenu(null)
        return true
      },
      nudge: drag.nudgeSelected,
      zoomIn: () => zoomBy(1),
      zoomOut: () => zoomBy(-1),
      zoomReset: () => setZoom(1),
    },
  })

  /* ── 렌더 ── */
  const displayItems = drag.decorateForDrag(items)
  const canvasHeight = Math.max(
    560,
    ...displayItems.map((item) => {
      const y = (drag.dragPos && drag.dragPos.positions[item.id]?.y) ?? item.y
      return y + heightOf(item) + 120
    })
  )

  const ensureKeyword = (word) => {
    if (!word) return
    if ((api.keywords || []).some((keyword) => keyword.word === word)) return
    api.updateKeywords([...(api.keywords || []), { word, desc: '', points: '' }])
    api.showToast(`"${word}" 키워드를 사전에 추가했어요. 탐색 편집기에서 설명을 채워주세요.`)
  }

  const summaryPreview = {
    profile: visibleProfileItems(api.profile, scenario),
    questions: (scenario.stages.survey || [])
      .filter((item) => item.type === 'surveyQuestion')
      .map((question) => ({ q: question.props.question, a: '아무거나' })),
  }

  /* 캔버스 렌더 컨텍스트 — 미리보기에서는 편집 콜백을 빼서 전부 읽기 전용으로 만든다 */
  const canvasCtx = {
    mode: 'canvas',
    canvasView,
    allItems: items,
    selectedIds,
    draggingChildId,
    childPointerDown: nesting.childPointerDown,
    childResizeDown: nesting.childResizeDown,
    inspectChild: (id) => {
      if (previewMode) return
      setSelectedIds([id])
      setFocusFieldKey(null)
      setFocusTick((tick) => tick + 1)
    },
    profile: api.profile,
    ...(previewMode ? {} : {
      updateProps,
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
    summaryPreview,
  }

  const feedbackPlanCase = feedbackTarget ? planCases.find((planCase) => planCase.id === feedbackTarget.caseId) : null
  const feedbackItem = feedbackPlanCase
    ? (feedbackPlanCase.items || []).find((item) => item.id === feedbackTarget.itemId)
    : null
  const feedbackReview = feedbackPlanCase && feedbackTarget
    ? normalizeComponentEvaluation(normalizeCaseEvaluation(feedbackPlanCase.evaluation).components[feedbackTarget.itemId])
    : null

  return (
    <div className={
      'sb-builder'
      + (previewMode ? ' sb-builder--preview' : '')
      + (stageKey === 'plan' ? ' sb-builder--plan' : '')
      + (isEvaluation ? ' sb-builder--evaluation' : '')
      + (feedbackReview ? ' sb-builder--feedback' : '')
    }>
      <BuilderTopBar
        scenario={scenario}
        planCases={planCases}
        stageKey={stageKey}
        setStageKey={setStageKey}
        previewMode={previewMode}
        isExplore={isExplore}
        isEvaluation={isEvaluation}
        exploreItemCount={(api.explore.items || []).length}
        evaluatedCaseCount={planCases.filter((planCase) => normalizeCaseEvaluation(planCase.evaluation).selected).length}
        chipColor={scenario.color || '#5f7465'}
        device={device}
        compactType={compactType}
        compactOn={layout.compactOn}
        canvasView={canvasView}
        setCanvasView={setCanvasView}
        zoom={zoom}
        openMenu={openMenu}
        toggleMenu={toggleMenu}
        closeMenu={closeMenu}
        history={history}
        onGoHome={api.goHome}
        onPlay={() => api.playScenario(scenario.id)}
        onPatchScenario={patchScenario}
        onChangeDevice={changeDevice}
        onChangeCompact={changeCompact}
        onAutoLayout={runAutoLayout}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onZoomReset={() => setZoom(1)}
        onPublish={publish}
        onUnpublish={() => {
          patchScenario({ status: 'draft' })
          api.showToast('발행을 취소했어요.')
        }}
        onRestoreVersion={restoreVersion}
        onCopyShareLink={copyShareLink}
      >
        {stageKey === 'plan' && activePlanCase && (
          <PlanCaseBar
            planCases={planCases}
            activePlanCase={activePlanCase}
            activeCaseIndex={planCases.findIndex((planCase) => planCase.id === activePlanCase.id)}
            surveyQuestions={(scenario.stages.survey || []).filter((item) => item.type === 'surveyQuestion')}
            previewMode={previewMode}
            openMenu={openMenu}
            toggleMenu={toggleMenu}
            closeMenu={closeMenu}
            onSelectCase={setPlanCaseId}
            onAddCase={() => { cases.addPlanCase(); setOpenMenu('case') }}
            onGenerateCases={() => setCaseGenOpen(true)}
            onReviseCase={() => setCaseRevOpen(true)}
            onChangeCase={cases.updateActivePlanCase}
            onSetFallback={cases.setFallbackPlanCase}
            onDuplicate={cases.duplicatePlanCase}
            onDelete={() => { if (cases.removePlanCase()) closeMenu() }}
            onMove={cases.movePlanCase}
          />
        )}

        {stageKey === 'plan' && feedbackReview && feedbackItem && (
          <div className="sb-topbar__row sb-feedback-focus">
            <span className="sb-feedback-focus__badge">피드백 반영 중</span>
            <strong>{feedbackTarget.label}</strong>
            <p>{feedbackReview.feedback || '작성된 수정사항 없이 결과를 확인 중입니다.'}</p>
            {feedbackReview.score != null && <span className="sb-feedback-focus__score">{feedbackReview.score}/5점</span>}
            <button
              type="button"
              className={feedbackReview.resolved ? 'sb-btn sb-btn--compact-on' : 'sb-btn'}
              disabled={!feedbackReview.feedback.trim()}
              onClick={() => cases.updateComponentEvaluation(
                feedbackPlanCase.id, feedbackTarget.itemId, { resolved: !feedbackReview.resolved }
              )}
            >
              {feedbackReview.resolved ? '✓ 반영 완료됨' : '반영 완료'}
            </button>
            <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setStageKey('evaluation')}>
              평가로 돌아가기
            </button>
          </div>
        )}
      </BuilderTopBar>

      {caseRevOpen && activePlanCase && (
        <CaseRevisionDialog
          scenario={scenario}
          planCase={activePlanCase}
          planCases={planCases}
          profile={api.profile}
          onApply={(nextCase) => cases.updatePlanCases((current) =>
            current.map((planCase) => (planCase.id === nextCase.id ? nextCase : planCase))
          )}
          onClose={() => setCaseRevOpen(false)}
          onToast={api.showToast}
        />
      )}

      {caseGenOpen && (
        <CaseGenerationDialog
          scenario={scenario}
          planCases={planCases}
          activeCaseId={planCaseId}
          profile={api.profile}
          onApply={cases.applyGeneratedCases}
          onClose={() => setCaseGenOpen(false)}
          onToast={api.showToast}
        />
      )}

      {isEvaluation ? (
        <EvaluationPanel
          planCases={planCases}
          activeCaseId={planCaseId}
          onSelectCase={setPlanCaseId}
          onRecommend={cases.recommendPlanCases}
          onUpdateComponent={cases.updateComponentEvaluation}
          onUpdateCase={cases.updateCaseEvaluation}
          onEditCase={editEvaluatedCase}
          onReviseCase={reviseEvaluatedCase}
          onEditComponent={editEvaluatedComponent}
          onApplyLlmRevisions={cases.applyRevisions}
          onToast={api.showToast}
          profile={api.profile}
          summaryPreview={summaryPreview}
        />
      ) : (
        <div className="sb-workspace">
          <Palette
            disabled={previewMode}
            stageKey={stageKey}
            items={items}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onAdd={addItem}
            onMoveLayer={nesting.moveLayer}
            onRemove={removeItem}
            onToggleLock={(id) => updateItem(id, { locked: !items.find((item) => item.id === id)?.locked })}
            onToggleHide={(id) => updateItem(id, { hidden: !items.find((item) => item.id === id)?.hidden })}
            onUnnest={nesting.unnestItem}
            onDropLayer={nesting.dropLayer}
          />

          <BuilderCanvas
            canvasRef={canvasRef}
            canvasW={canvasW}
            canvasHeight={canvasHeight}
            zoom={zoom}
            canvasView={canvasView}
            previewMode={previewMode}
            items={items}
            displayItems={displayItems}
            selectedIds={selectedIds}
            dropTargetId={dropTargetId}
            dragPos={drag.dragPos}
            sizeDraft={drag.sizeDraft}
            guides={drag.guides}
            insertHint={insertHint}
            marquee={marquee}
            heightsRef={heightsRef}
            renderCtx={canvasCtx}
            onClearSelection={() => setSelectedIds([])}
            onCanvasPointerDown={onCanvasPointerDown}
            onContextMenu={openCtxMenu}
            onPaletteDragOver={paletteDragOver}
            onPaletteDragLeave={paletteDragLeave}
            onPaletteDrop={paletteDrop}
            onItemMeasure={onItemMeasure}
            onSelect={handleSelect}
            onDragStart={drag.onGroupDragStart}
            onDrag={drag.onDrag}
            onDragEnd={drag.onDragEnd}
            onResize={drag.onResize}
            onResizeEnd={drag.onResizeEnd}
            onInspect={(id) => { setSelectedIds([id]); setFocusFieldKey(null); setFocusTick((tick) => tick + 1) }}
          />

          <Inspector
            disabled={previewMode}
            stageKey={stageKey}
            containerPanel={
              !previewMode && managedContainer ? (
                <ContainerContents
                  container={managedContainer}
                  children={managedChildren}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    if (previewMode) return
                    setSelectedIds([id])
                    setTimeout(() => {
                      canvasRef.current
                        ?.querySelector(`[data-child-id="${id}"]`)
                        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                    }, 0)
                  }}
                  onSelectContainer={() => setSelectedIds([managedContainer.id])}
                  onMove={nesting.moveLayer}
                  onUpdate={updateItem}
                  onDuplicate={duplicateItem}
                  onRemove={removeItem}
                  onUnnest={nesting.unnestItem}
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
            setSize={drag.setSize}
            duplicateSelected={duplicateSelected}
            removeSelected={removeSelected}
            duplicateItem={duplicateItem}
            removeItem={removeItem}
            alignSelected={(mode) => {
              if (selectedIds.length < 2) return
              setItems((prev) => layout.align(prev, selectedIds, mode))
            }}
            ensureKeyword={ensureKeyword}
            unnestItem={nesting.unnestItem}
          />

          <CanvasTextToolbar active={!previewMode && !!inlineEdit} ensureKeyword={ensureKeyword} />

          {!previewMode && (
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
              onSelectAll={() => setSelectedIds(items.map((item) => item.id))}
            />
          )}
        </div>
      )}

      {childDragGhost && (
        <div className="sb-child-drag-ghost" style={{ left: childDragGhost.x, top: childDragGhost.y }} aria-hidden="true">
          <span>{childDragGhost.icon}</span>
          {childDragGhost.label}
        </div>
      )}
    </div>
  )
}
