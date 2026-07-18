import React, { useCallback, useEffect, useRef, useState } from 'react'
import { STAGES, createItem, sortByPosition } from '../lib/store.js'
import { LIBRARY, libraryForStage, renderItem } from '../lib/registry.jsx'

const CANVAS_W = 720
const PAD = 24
const GAP = 14
const ITEM_W_DEFAULT = CANVAS_W - PAD * 2

/* 겹침 해소: 드래그된 아이템은 제자리를 지키고, 겹치는 다른 아이템들이 아래로 밀린다 */
function resolveCollision(items, movedId, heights) {
  const h = (it) => heights[it.id] || 80
  const sorted = [...items].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    if (a.id === movedId) return -1
    if (b.id === movedId) return 1
    return a.x - b.x
  })
  const placed = []
  for (const it of sorted) {
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

/* 자동 배치: y→x 순으로 정렬해 겹침 없이 세로 스택 */
function autoLayout(items, heights) {
  const sorted = sortByPosition(items)
  let cursor = PAD
  const positioned = {}
  sorted.forEach((it) => {
    positioned[it.id] = { x: PAD, y: cursor, w: Math.min(it.w, ITEM_W_DEFAULT) }
    cursor += (heights[it.id] || 80) + GAP
  })
  return items.map((it) => ({ ...it, ...positioned[it.id] }))
}

function CanvasItem({ item, selected, dragPos, heightsRef, onSelect, onDragStart, onDrag, onDragEnd }) {
  const ref = useRef(null)
  const dragging = dragPos != null

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

  const def = LIBRARY[item.type]
  const x = dragging ? dragPos.x : item.x
  const y = dragging ? dragPos.y : item.y

  return (
    <div
      ref={ref}
      className={
        'sb-canvas-item' +
        (selected ? ' sb-canvas-item--selected' : '') +
        (dragging ? ' sb-canvas-item--dragging' : '')
      }
      style={{ left: x, top: y, width: item.w }}
      onPointerDown={onPointerDown}
    >
      <span className="sb-canvas-item__tag">{def?.icon} {def?.label}</span>
      <div className="sb-canvas-item__content">{renderItem(item, { mode: 'canvas' })}</div>
    </div>
  )
}

export default function Builder({ api, scenario }) {
  const [stageKey, setStageKey] = useState('explore')
  const [selectedId, setSelectedId] = useState(null)
  const [dragPos, setDragPos] = useState(null) // {id, x, y}
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
    setDragPos({
      id,
      x: Math.max(0, Math.min(CANVAS_W - w, x)),
      y: Math.max(0, y),
    })
  }

  const onDragEnd = (id) => {
    setDragPos((pos) => {
      if (pos && pos.id === id) {
        setItems((prev) => {
          const movedList = prev.map((it) => (it.id === id ? { ...it, x: pos.x, y: pos.y } : it))
          return resolveCollision(movedList, id, heightsRef.current)
        })
      }
      return null
    })
  }

  const runAutoLayout = () => {
    setItems((prev) => autoLayout(prev, heightsRef.current))
    api.showToast('겹침 없이 자동 배치했어요.')
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

  const canvasHeight = Math.max(
    560,
    ...items.map((it) => {
      const y = dragPos && dragPos.id === it.id ? dragPos.y : it.y
      return y + (heightsRef.current[it.id] || 80) + 120
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
          <button type="button" className="sb-btn" onClick={runAutoLayout}>자동 정렬</button>
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
            {items.map((it) => (
              <CanvasItem
                key={it.id}
                item={it}
                selected={selectedId === it.id}
                dragPos={dragPos && dragPos.id === it.id ? dragPos : null}
                heightsRef={heightsRef}
                onSelect={setSelectedId}
                onDragStart={() => {}}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
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
                    updateItem(selected.id, {
                      w,
                      x: Math.min(selected.x, CANVAS_W - w),
                    })
                  }}
                />
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
