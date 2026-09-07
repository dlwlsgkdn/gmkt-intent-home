import React, { useEffect, useRef, useState } from 'react'
import { STAGES, DEVICE_PRESETS, planCasesForScenario, visibleProfileItems } from '../lib/store.js'
import { LIBRARY } from '../lib/registry.jsx'
import { insertHintAt, slotIndexAt } from '../lib/builder/geometry.js'
import {
  EVALUATION_CASE_SLOTS,
  evaluationCasesFor,
  normalizeCaseEvaluation,
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
import FeedbackFocusBar from './builder/FeedbackFocusBar.jsx'
import { useBuilderHistory } from './builder/hooks/useBuilderHistory.js'
import { useStageItems } from './builder/hooks/useStageItems.js'
import { usePlanCases } from './builder/hooks/usePlanCases.js'
import { useStackDrag } from './builder/hooks/useStackDrag.js'
import { useContainerNesting } from './builder/hooks/useContainerNesting.js'
import { useBuilderShortcuts } from './builder/hooks/useBuilderShortcuts.js'
import { useItemOps } from './builder/hooks/useItemOps.js'
import { useTopBarActions } from './builder/hooks/useTopBarActions.js'
import { useCanvasInteractions } from './builder/hooks/useCanvasInteractions.js'
import { useEvaluationBridge } from './builder/hooks/useEvaluationBridge.js'

/*
 * 빌더 오케스트레이터.
 *
 * 편집 상태(무엇이 선택됐고 어느 단계를 보고 있는가)를 갖고, 각 관심사를 담당하는
 * 훅과 컴포넌트를 연결한다. 배치는 순서 기반 스택(배열 순서 = 렌더 순서)이라
 * 좌표·겹침 해소가 없다. 실제 규칙은 아래로 내려가 있다:
 *   lib/builder/geometry     — 순서·슬롯 계산 (DOM rect 기반)
 *   lib/builder/itemClipboard— 사본 만들기
 *   lib/builder/publishing   — 발행 점검·버전 스냅샷
 *   hooks/useStageItems      — 아이템을 어디서 읽고 어디에 저장할지
 *   hooks/useBuilderHistory  — Undo/Redo 스택
 *   hooks/usePlanCases       — 계획 케이스 CRUD·평가
 *   hooks/useStackDrag       — 최상위 순서 드래그·컨테이너 삽입
 *   hooks/useContainerNesting— 컨테이너 자식 넣기/꺼내기/순서
 *   hooks/useBuilderShortcuts— 키보드
 *   hooks/useTopBarActions   — 시나리오 명령 (기기·발행·버전·JSON·공유)
 *   hooks/useCanvasInteractions — 캔버스 표면 이벤트 (우클릭·팔레트 DnD·줌)
 *   hooks/useEvaluationBridge   — 평가 ↔ 편집 이동과 피드백 반영 문맥
 */

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState(STAGES[0].key)
  const isExplore = stageKey === 'explore'
  const isEvaluation = stageKey === 'evaluation'
  const planCases = scenario.planCases || planCasesForScenario(scenario)
  const [planCaseId, setPlanCaseId] = useState(() => planCases[0]?.id || null)
  const activePlanCase = planCases.find((planCase) => planCase.id === planCaseId) || planCases[0]

  const [selectedIds, setSelectedIds] = useState([]) // 다중 선택 (⇧+클릭)
  const [openMenu, setOpenMenu] = useState(null) // 'device' | 'color' | 'version' | 'case' | 'json'
  const [inlineEdit, setInlineEdit] = useState(null) // 캔버스 인라인 텍스트 편집 { itemId, key }
  const [zoom, setZoom] = useState(1)
  const [canvasView, setCanvasView] = useState('edit') // 'edit'(편집 크롬) | 'preview'(실사용 모습)
  const previewMode = !isEvaluation && canvasView === 'preview'
  const [ctxMenu, setCtxMenu] = useState(null) // 우클릭 메뉴 { sx, sy, itemId }
  const [dropTargetId, setDropTargetId] = useState(null) // 컨테이너 드롭 대상 하이라이트
  const [insertHint, setInsertHint] = useState(null) // 컨테이너 삽입 캐럿 { dir, x, y, len }
  const [insertLine, setInsertLine] = useState(null) // 최상위 순서 삽입 라인 { x, y, len }
  const [draggingChildId, setDraggingChildId] = useState(null)
  const [dragGhost, setDragGhost] = useState(null) // 드래그 중 포인터 옆 피드백 (자식·최상위 공용)
  const [caseGenOpen, setCaseGenOpen] = useState(false)
  const [caseRevOpen, setCaseRevOpen] = useState(false) // 현재 케이스 통째 재구성

  const canvasRef = useRef(null)
  const clipboardRef = useRef(null) // ⌘C 스냅샷 (단계 간 붙여넣기 가능)

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
  const itemW = canvasW - 48 // 컨테이너 자식 카드 폭의 상한 (캔버스 좌우 패딩 제외)

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

  const { setItems } = useStageItems({
    api, scenario, stageKey, planCaseId, previewMode, pushHistory: history.pushHistory,
  })

  const cases = usePlanCases({
    api, scenario, planCases, planCaseId, activePlanCase, setPlanCaseId, previewMode,
    pushHistory: history.pushHistory,
  })

  /* ── 슬롯 헬퍼 (geometry에 현재 캔버스 상태를 묶어 둔 얇은 래퍼) ── */
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
  const drag = useStackDrag({
    items, zoom, canvasRef, slotIndexOf, insertHintOf, setItems, setSelectedIds, selectedIds,
    setDropTargetId, setInsertHint, setInsertLine, setDragGhost, showToast: api.showToast,
  })

  const nesting = useContainerNesting({
    items, itemW, zoom, canvasRef, slotIndexOf, insertHintOf,
    setItems, setSelectedIds, onSelect: handleSelect, previewMode, showToast: api.showToast,
    drag, setDropTargetId, setInsertHint, setDraggingChildId, setChildDragGhost: setDragGhost,
  })

  /* ── 아이템 추가 · 편집 · 삭제 · 복제 · 클립보드 (규칙은 useItemOps에) ── */
  const {
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
  } = useItemOps({
    items, setItems, selectedIds, setSelectedIds, nesting, clipboardRef,
    showToast: api.showToast,
  })

  /* ── 캔버스 표면 이벤트 (우클릭·팔레트 DnD·줌 — 규칙은 useCanvasInteractions에) ── */
  const interactions = useCanvasInteractions({
    previewMode, zoom, setZoom, canvasRef,
    selectedIds, setSelectedIds, ctxMenu, setCtxMenu,
    items, setItems,
    setDropTargetId, setInsertHint, setInsertLine,
    insertHintOf, nesting, addItemAt,
  })

  /* ── 상단 바 ── */
  const toggleMenu = (key) => setOpenMenu((current) => (current === key ? null : key))
  const closeMenu = () => setOpenMenu(null)

  const topbar = useTopBarActions({
    api, scenario, planCases, history, setSelectedIds, previewMode, closeMenu,
  })

  /* ── 평가 ↔ 편집 이동 ── */
  const bridge = useEvaluationBridge({
    planCases, planCaseId, setPlanCaseId, activePlanCase,
    stageKey, setStageKey, setCanvasView, setSelectedIds,
    previewMode, openCaseRevision: () => setCaseRevOpen(true), showToast: api.showToast,
  })

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
    const slots = new Set(selectedCases.map((planCase) => normalizeCaseEvaluation(planCase.evaluation).selection.slot))
    if (selectedCases.length === 3 && EVALUATION_CASE_SLOTS.every((slot) => slots.has(slot))) return
    cases.recommendPlanCases()
  }, [isEvaluation, planCases.length])

  /* 단계·케이스를 옮기면 진행 중이던 편집 상태를 모두 닫는다 */
  useEffect(() => {
    setSelectedIds([])
    setInlineEdit(null)
    setDraggingChildId(null)
    setInsertHint(null)
    setInsertLine(null)
    drag.reset()
  }, [stageKey, planCaseId])

  /* 미리보기 진입 시에도 마찬가지 */
  useEffect(() => {
    if (!previewMode) return
    setSelectedIds([])
    setInlineEdit(null)
    setCtxMenu(null)
    setOpenMenu(null)
    setDropTargetId(null)
    setInsertHint(null)
    setInsertLine(null)
    setDraggingChildId(null)
    drag.reset()
  }, [previewMode])

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
      canPaste: hasClipboard,
      remove: removeSelected,
      clearSelection: () => setSelectedIds([]),
      closeContextMenu: () => {
        if (!ctxMenu) return false
        setCtxMenu(null)
        return true
      },
      moveOrder: moveSelectedBy,
      zoomIn: () => interactions.zoomBy(1),
      zoomOut: () => interactions.zoomBy(-1),
      zoomReset: () => setZoom(1),
    },
  })

  /* ── 렌더 ── */
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
      bridge.focusInspector()
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

  return (
    <div className={
      'sb-builder'
      + (previewMode ? ' sb-builder--preview' : '')
      + (stageKey === 'plan' ? ' sb-builder--plan' : '')
      + (isEvaluation ? ' sb-builder--evaluation' : '')
      + (bridge.feedbackReview ? ' sb-builder--feedback' : '')
    }>
      <BuilderTopBar
        scenario={scenario}
        remoteSync={api.remoteSync}
        planCases={planCases}
        stageKey={stageKey}
        setStageKey={setStageKey}
        previewMode={previewMode}
        isExplore={isExplore}
        isEvaluation={isEvaluation}
        exploreItemCount={(api.explore.items || []).length}
        evaluatedCaseCount={planCases.filter((planCase) => normalizeCaseEvaluation(planCase.evaluation).selection.active).length}
        chipColor={scenario.color || '#7950f2'}
        device={device}
        canvasView={canvasView}
        setCanvasView={setCanvasView}
        zoom={zoom}
        openMenu={openMenu}
        toggleMenu={toggleMenu}
        closeMenu={closeMenu}
        history={history}
        onGoHome={api.goHome}
        onPlay={() => api.playScenario(scenario.id)}
        onPatchScenario={topbar.patchScenario}
        onChangeDevice={topbar.changeDevice}
        onZoomIn={() => interactions.zoomBy(1)}
        onZoomOut={() => interactions.zoomBy(-1)}
        onZoomReset={() => setZoom(1)}
        onPublish={topbar.publish}
        onUnpublish={() => {
          topbar.patchScenario({ status: 'draft' })
          api.showToast('발행을 취소했어요.')
        }}
        onRestoreVersion={topbar.restoreVersion}
        onExportJson={topbar.exportScenarioJson}
        onImportJsonFile={topbar.importScenarioJson}
        onCopyShareLink={topbar.copyShareLink}
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

        {stageKey === 'plan' && bridge.feedbackReview && bridge.feedbackItem && (
          <FeedbackFocusBar
            label={bridge.feedbackTarget.label}
            review={bridge.feedbackReview}
            onToggleResolved={() => cases.updateComponentEvaluation(
              bridge.feedbackPlanCase.id, bridge.feedbackTarget.itemId, { resolved: !bridge.feedbackReview.resolved }
            )}
            onBack={() => setStageKey('evaluation')}
          />
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
          scenario={scenario}
          planCases={planCases}
          activeCaseId={planCaseId}
          onSelectCase={setPlanCaseId}
          onRecommend={cases.recommendPlanCases}
          onUpdateComponent={cases.updateComponentEvaluation}
          onUpdateCase={cases.updateCaseEvaluation}
          onEditCase={bridge.editEvaluatedCase}
          onReviseCase={bridge.reviseEvaluatedCase}
          onEditComponent={bridge.editEvaluatedComponent}
          onApplyLlmRevisions={cases.applyRevisions}
          onToast={api.showToast}
          profile={api.profile}
          summaryPreview={summaryPreview}
          deviceW={canvasW}
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
            zoom={zoom}
            canvasView={canvasView}
            previewMode={previewMode}
            items={items}
            selectedIds={selectedIds}
            dropTargetId={dropTargetId}
            dragIds={drag.dragIds}
            insertHint={insertHint}
            insertLine={insertLine}
            renderCtx={canvasCtx}
            onCanvasPointerDown={interactions.onCanvasPointerDown}
            onContextMenu={interactions.openCtxMenu}
            onPaletteDragOver={interactions.paletteDragOver}
            onPaletteDragLeave={interactions.paletteDragLeave}
            onPaletteDrop={interactions.paletteDrop}
            onSelect={handleSelect}
            onDragStart={drag.onDragStart}
            onDrag={drag.onDrag}
            onDragEnd={drag.onDragEnd}
            onInspect={(id) => { setSelectedIds([id]); bridge.focusInspector() }}
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
            updateProps={updateProps}
            updateItem={updateItem}
            duplicateSelected={duplicateSelected}
            removeSelected={removeSelected}
            duplicateItem={duplicateItem}
            removeItem={removeItem}
            ensureKeyword={ensureKeyword}
            unnestItem={nesting.unnestItem}
            profile={api.profile}
            updateProfile={api.updateProfile}
            surveyQuestions={(scenario.stages.survey || [])
              .filter((item) => item.type === 'surveyQuestion')
              .map((item) => ({ id: item.id, text: item.props.question }))}
          />

          <CanvasTextToolbar active={!previewMode && !!inlineEdit} ensureKeyword={ensureKeyword} />

          {!previewMode && (
            <ContextMenu
              menu={ctxMenu}
              items={items}
              hasClipboard={hasClipboard()}
              onClose={() => setCtxMenu(null)}
              onDuplicate={duplicateSelected}
              onCopy={copySelected}
              onPaste={pasteClipboard}
              onToggle={interactions.toggleSelected}
              onRemove={removeSelected}
              onSelectAll={() => setSelectedIds(items.map((item) => item.id))}
            />
          )}
        </div>
      )}

      {dragGhost && dragGhost.x != null && (
        <div className="sb-child-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }} aria-hidden="true">
          <span>{dragGhost.icon}</span>
          {dragGhost.label}
        </div>
      )}
    </div>
  )
}
