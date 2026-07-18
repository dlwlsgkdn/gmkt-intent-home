import React, { useCallback, useEffect, useRef, useState } from 'react'
import { STAGES, createItem, sortByPosition } from '../lib/store.js'
import { LIBRARY, libraryForStage, renderItem } from '../lib/registry.jsx'

const CANVAS_W = 720
const PAD = 24
const GAP = 14
const ITEM_W_DEFAULT = CANVAS_W - PAD * 2

/* 겹침 해소: 기준(드래그/리사이즈된) 아이템은 제자리를 지키고,
   겹치는 다른 아이템들이 아래로 밀린다 */
function resolveCollision(items, movedId, heights) {
  const h = (it) => it.h || heights[it.id] || 80
  const moved = items.find((it) => it.id === movedId)
  if (!moved) return items
  const others = items
    .filter((it) => it.id !== movedId)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const placed = [moved]
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

/* ── 자동 정렬 모드들 ── */

/* 1단 세로 스택: y→x 순으로 전체 너비로 쌓기 */
function layoutStack(items, heights) {
  const sorted = sortByPosition(items)
  let cursor = PAD
  const positioned = {}
  sorted.forEach((it) => {
    positioned[it.id] = { x: PAD, y: cursor, w: ITEM_W_DEFAULT }
    cursor += (it.h || heights[it.id] || 80) + GAP
  })
  return items.map((it) => ({ ...it, ...positioned[it.id] }))
}

/* 2단 그리드: 반폭으로 나눠 항상 짧은 열에 채우기 (마소너리) */
function layoutTwoColumns(items, heights) {
  const colW = Math.floor((CANVAS_W - PAD * 2 - GAP) / 2)
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
function layoutCompactUp(items, heights) {
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

const LAYOUT_MODES = [
  { key: 'stack', label: '1단 세로 정렬', desc: '전체 너비로 위에서부터 차곡차곡', fn: layoutStack },
  { key: 'twocol', label: '2단 그리드 정렬', desc: '반폭 2열 마소너리 배치', fn: layoutTwoColumns },
  { key: 'compact', label: '위로 컴팩트 정렬', desc: '크기·가로 위치 유지, 빈 공간만 제거', fn: layoutCompactUp },
]

function CanvasItem({ item, selected, dragPos, sizeDraft, heightsRef, onSelect, onDragStart, onDrag, onDragEnd, onResize, onResizeEnd }) {
  const ref = useRef(null)
  const dragging = dragPos != null
  const resizing = sizeDraft != null

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => {
      heightsRef.current[item.id] = el.offsetHeight
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [item.id, heightsRef])

  const onPointerDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    onSelect(item.id)
    const startX = e.clientX
    const startY = e.clientY
    const origX = item.x
    const origY = item.y
    let moved = false
    const move = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true
        onDragStart(item.id)
      }
      if (moved) onDrag(item.id, origX + dx, origY + dy)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) onDragEnd(item.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onResizeDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(item.id)
    const startX = e.clientX
    const startY = e.clientY
    const origW = item.w
    const origH = item.h || (ref.current ? ref.current.offsetHeight : 120)
    const move = (ev) => {
      onResize(item.id, origW + (ev.clientX - startX), origH + (ev.clientY - startY))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onResizeEnd(item.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const def = LIBRARY[item.type]
  const x = dragging ? dragPos.x : item.x
  const y = dragging ? dragPos.y : item.y
  const w = resizing ? sizeDraft.w : item.w
  const h = resizing ? sizeDraft.h : item.h

  return (
    <div
      ref={ref}
      className={
        'sb-canvas-item' +
        (selected ? ' sb-canvas-item--selected' : '') +
        (dragging ? ' sb-canvas-item--dragging' : '') +
        (resizing ? ' sb-canvas-item--resizing' : '')
      }
      style={{ left: x, top: y, width: w, height: h || 'auto' }}
      onPointerDown={onPointerDown}
    >
      <span className="sb-canvas-item__tag">{def?.icon} {def?.label}</span>
      <div className="sb-canvas-item__content" style={h ? { height: '100%', overflow: 'hidden' } : undefined}>
        {renderItem(item, { mode: 'canvas' })}
      </div>
      <span className="sb-resize-handle" onPointerDown={onResizeDown} title="크기 조절" />
    </div>
  )
}

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState('explore')
  const [selectedId, setSelectedId] = useState(null)
  const [dragPos, setDragPos] = useState(null) // {id, x, y}
  const [sizeDraft, setSizeDraft] = useState(null) // {id, w, h}
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const dragPosRef = useRef(null)
  const sizeDraftRef = useRef(null)
  const heightsRef = useRef({})

  const items = scenario.stages[stageKey] || []
  const selected = items.find((it) => it.id === selectedId) || null
  const stageMeta = STAGES.find((s) => s.key === stageKey)

  const setItems = useCallback(
    (updater) => {
      api.updateScenario(scenario.id, (s) => ({
        ...s,
        stages: { ...s.stages, [stageKey]: updater(s.stages[stageKey] || []) },
      }))
    },
    [api, scenario.id, stageKey]
  )

  useEffect(() => {
    setSelectedId(null)
    setDragPos(null)
    setSizeDraft(null)
  }, [stageKey])

  const addItem = (type) => {
    const def = LIBRARY[type]
    const item = createItem(type, def.defaults)
    setItems((prev) => {
      const bottom = prev.reduce(
        (max, it) => Math.max(max, it.y + (heightsRef.current[it.id] || 80)),
        PAD - GAP
      )
      return [...prev, { ...item, x: PAD, y: bottom + GAP, w: ITEM_W_DEFAULT }]
    })
    setSelectedId(item.id)
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
    setItems((prev) => prev.filter((it) => it.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const duplicateItem = (id) => {
    const src = items.find((it) => it.id === id)
    if (!src) return
    const copy = {
      ...createItem(src.type, src.props),
      x: src.x,
      y: src.y + (heightsRef.current[src.id] || 80) + GAP,
      w: src.w,
      props: { ...src.props },
    }
    setItems((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }

  const onDrag = (id, x, y) => {
    const it = items.find((i) => i.id === id)
    const w = it ? it.w : ITEM_W_DEFAULT
    const pos = {
      id,
      x: Math.max(0, Math.min(CANVAS_W - w, x)),
      y: Math.max(0, y),
    }
    dragPosRef.current = pos
    setDragPos(pos)
  }

  const onDragEnd = (id) => {
    const pos = dragPosRef.current
    dragPosRef.current = null
    // 진행 중인 React 렌더와 커밋이 겹치지 않도록 다음 틱으로 미룬다
    setTimeout(() => {
      if (pos && pos.id === id) {
        setItems((prev) => {
          const movedList = prev.map((it) => (it.id === id ? { ...it, x: pos.x, y: pos.y } : it))
          return resolveCollision(movedList, id, heightsRef.current)
        })
      }
      setDragPos(null)
    }, 0)
  }

  const onResize = (id, w, h) => {
    const draft = {
      id,
      w: Math.max(240, Math.min(ITEM_W_DEFAULT, Math.round(w))),
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
              ? { ...it, w: draft.w, h: draft.h, x: Math.min(it.x, CANVAS_W - draft.w) }
              : it
          )
          return resolveCollision(resized, id, heightsRef.current)
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
      return resolveCollision(updated, id, heightsRef.current)
    })
  }

  const runAutoLayout = (mode) => {
    setLayoutMenuOpen(false)
    setItems((prev) => mode.fn(prev, heightsRef.current))
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
    api.updateScenario(scenario.id, (s) => ({ ...s, status: 'published' }))
    api.showToast(`"#${scenario.chip}" 칩이 홈 탐색창 밑에 발행됐어요!`)
    api.goHome()
  }

  const unpublish = () => {
    api.updateScenario(scenario.id, (s) => ({ ...s, status: 'draft' }))
    api.showToast('발행을 취소했어요.')
  }

  /* 드래그 중에는 다른 아이템들이 실시간으로 밀려나는 미리보기 레이아웃을 보여준다 */
  let displayItems = items
  if (dragPos) {
    const moved = items.map((it) =>
      it.id === dragPos.id ? { ...it, x: dragPos.x, y: dragPos.y } : it
    )
    displayItems = resolveCollision(moved, dragPos.id, heightsRef.current)
  }

  const canvasHeight = Math.max(
    560,
    ...displayItems.map((it) => {
      const y = dragPos && dragPos.id === it.id ? dragPos.y : it.y
      return y + (it.h || heightsRef.current[it.id] || 80) + 120
    })
  )

  return (
    <div className="sb-builder">
      {/* 상단 바 */}
      <div className="sb-topbar">
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
          <div className="sb-chip-input-wrap">
            <span>#</span>
            <input
              className="sb-chip-input"
              value={scenario.chip}
              placeholder="칩_라벨"
              onChange={(e) =>
                api.updateScenario(scenario.id, (s) => ({
                  ...s,
                  chip: e.target.value.replace(/\s+/g, '_'),
                }))
              }
            />
          </div>
        </div>
        <span className={'sb-status ' + (scenario.status === 'published' ? 'sb-status--live' : '')}>
          {scenario.status === 'published' ? '발행됨' : '작성 중'}
        </span>
        <div className="sb-topbar__actions">
          <div className="sb-menu-wrap">
            <button
              type="button"
              className={'sb-btn' + (layoutMenuOpen ? ' sb-btn--open' : '')}
              onClick={() => setLayoutMenuOpen((v) => !v)}
            >
              자동 정렬
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {layoutMenuOpen && (
              <>
                <div className="sb-menu-backdrop" onClick={() => setLayoutMenuOpen(false)} />
                <div className="sb-menu">
                  {LAYOUT_MODES.map((mode) => (
                    <button key={mode.key} type="button" className="sb-menu__item" onClick={() => runAutoLayout(mode)}>
                      <strong>{mode.label}</strong>
                      <small>{mode.desc}</small>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" className="sb-btn" onClick={() => api.playScenario(scenario.id)}>시험해보기</button>
          {scenario.status === 'published' ? (
            <button type="button" className="sb-btn sb-btn--ghost" onClick={unpublish}>발행 취소</button>
          ) : null}
          <button type="button" className="sb-btn sb-btn--primary" onClick={publish}>
            {scenario.status === 'published' ? '변경사항 재발행' : '발행하기'}
          </button>
        </div>
      </div>

      {/* 단계 탭 */}
      <div className="sb-stage-tabs">
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

      <div className="sb-workspace">
        {/* 팔레트 */}
        <aside className="sb-palette">
          <p className="sb-panel-label">컴포넌트</p>
          {libraryForStage(stageKey).map((def) => (
            <button key={def.type} type="button" className="sb-palette-card" onClick={() => addItem(def.type)}>
              <span className="sb-palette-card__icon">{def.icon}</span>
              <span className="sb-palette-card__text">
                <strong>{def.label}</strong>
                <small>{def.hint}</small>
              </span>
              <span className="sb-palette-card__add">+</span>
            </button>
          ))}
        </aside>

        {/* 캔버스 */}
        <main className="sb-canvas-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null) }}>
          <div
            className="sb-canvas"
            style={{ width: CANVAS_W, height: canvasHeight }}
            onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedId(null) }}
          >
            {items.length === 0 && (
              <div className="sb-canvas__empty">
                왼쪽 팔레트에서 컴포넌트를 눌러 추가하세요.<br />
                <span>추가한 컴포넌트는 마우스로 끌어 배치할 수 있어요.</span>
              </div>
            )}
            {displayItems.map((it) => (
              <CanvasItem
                key={it.id}
                item={it}
                selected={selectedId === it.id}
                dragPos={dragPos && dragPos.id === it.id ? dragPos : null}
                sizeDraft={sizeDraft && sizeDraft.id === it.id ? sizeDraft : null}
                heightsRef={heightsRef}
                onSelect={setSelectedId}
                onDragStart={() => {}}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onResize={onResize}
                onResizeEnd={onResizeEnd}
              />
            ))}
          </div>
        </main>

        {/* 인스펙터 */}
        <aside className="sb-inspector">
          {!selected ? (
            <div className="sb-inspector__empty">
              <p className="sb-panel-label">편집</p>
              캔버스에서 컴포넌트를 선택하면<br />플레이스홀더를 편집할 수 있어요.
            </div>
          ) : (
            <>
              <p className="sb-panel-label">
                {LIBRARY[selected.type]?.icon} {LIBRARY[selected.type]?.label}
              </p>
              {LIBRARY[selected.type]?.fields.map((f) => (
                <div key={f.key} className="sb-field">
                  <label>{f.label}</label>
                  {f.kind === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={selected.props[f.key] ?? ''}
                      onChange={(e) => updateProps(selected.id, f.key, e.target.value)}
                    />
                  ) : f.kind === 'toggle' ? (
                    <button
                      type="button"
                      className={'sb-toggle' + (selected.props[f.key] ? ' sb-toggle--on' : '')}
                      onClick={() => updateProps(selected.id, f.key, !selected.props[f.key])}
                    >
                      <span className="sb-toggle__knob" />
                      {selected.props[f.key] ? '켜짐' : '꺼짐'}
                    </button>
                  ) : (
                    <input
                      type="text"
                      value={selected.props[f.key] ?? ''}
                      onChange={(e) => updateProps(selected.id, f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              <div className="sb-field">
                <label>너비 — {selected.w}px</label>
                <input
                  type="range"
                  min={240}
                  max={ITEM_W_DEFAULT}
                  step={8}
                  value={selected.w}
                  onChange={(e) => {
                    const w = Number(e.target.value)
                    setSize(selected.id, { w, x: Math.min(selected.x, CANVAS_W - w) })
                  }}
                />
              </div>

              <div className="sb-field">
                <label>높이 — {selected.h ? `${selected.h}px` : '자동'}</label>
                <input
                  type="range"
                  min={48}
                  max={720}
                  step={8}
                  value={selected.h || heightsRef.current[selected.id] || 120}
                  onChange={(e) => setSize(selected.id, { h: Number(e.target.value) })}
                />
                {selected.h ? (
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--small"
                    onClick={() => {
                      delete heightsRef.current[selected.id]
                      updateItem(selected.id, { h: null })
                    }}
                  >
                    자동 높이로 되돌리기
                  </button>
                ) : null}
              </div>

              <div className="sb-inspector__actions">
                <button type="button" className="sb-btn" onClick={() => duplicateItem(selected.id)}>복제</button>
                <button type="button" className="sb-btn sb-btn--danger" onClick={() => removeItem(selected.id)}>삭제</button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
