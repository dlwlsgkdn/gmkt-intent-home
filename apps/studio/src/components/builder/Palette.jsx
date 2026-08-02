import React, { useRef, useState } from 'react'
import { LIBRARY, libraryForStage } from '../../lib/registry.jsx'

/* 왼쪽 패널: 컴포넌트 팔레트(검색 포함) / 레이어 목록(잠금·숨김·순서) */
const CATEGORIES = [
  { key: 'content', label: '콘텐츠' },
  { key: 'layout', label: '레이아웃 — 컴포넌트를 안에 배치' },
]

export default function Palette({
  disabled = false,
  stageKey,
  items,
  selectedIds,
  onSelect,
  onAdd,
  onMoveLayer,
  onRemove,
  onToggleLock,
  onToggleHide,
  onUnnest,
  onDropLayer,
}) {
  const [tab, setTab] = useState('components')
  const [query, setQuery] = useState('')
  const [layerDragId, setLayerDragId] = useState(null)
  const [layerDrop, setLayerDrop] = useState(null) // { targetId, placement:'before'|'inside'|'after' }
  const layerDragRef = useRef(null)
  const layerDropRef = useRef(null)
  const disabledAttrs = disabled ? { inert: '', 'aria-disabled': true } : {}

  const defs = libraryForStage(stageKey).filter((def) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return def.label.toLowerCase().includes(q) || (def.hint || '').toLowerCase().includes(q)
  })

  /* 레이어 목록: 최상위(배열 순서) 아래에 컨테이너 자식(슬롯순)을 들여쓰기로 */
  const layerRows = items.filter((it) => !it.parentId).flatMap((it) => [
    { it, depth: 0 },
    ...items
      .filter((k) => k.parentId === it.id)
      .sort((a, b) => (a.slot || 0) - (b.slot || 0))
      .map((k) => ({ it: k, depth: 1 })),
  ])

  const layerPlacementAt = (target, clientY, rect) => {
    const source = items.find((it) => it.id === (layerDragRef.current || layerDragId))
    if (!source || source.id === target.id) return null
    const ratio = (clientY - rect.top) / Math.max(1, rect.height)
    if (LIBRARY[target.type]?.container && !LIBRARY[source.type]?.container && ratio >= 0.25 && ratio <= 0.75) {
      return 'inside'
    }
    if (target.parentId && !LIBRARY[source.type]?.container) return ratio < 0.5 ? 'before' : 'after'
    if (!source.parentId && !target.parentId) return ratio < 0.5 ? 'before' : 'after'
    return null
  }

  const startLayerDrag = (e, id) => {
    const source = items.find((it) => it.id === id)
    if (disabled || !source || source.locked || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    layerDragRef.current = id
    setLayerDragId(id)

    const updateDrop = (next) => {
      layerDropRef.current = next
      setLayerDrop(next)
    }
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) <= 4) return
      moved = true
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.sb-layer[data-layer-id]')
      const target = row ? items.find((it) => it.id === row.dataset.layerId) : null
      if (!target) {
        updateDrop(null)
        return
      }
      const placement = layerPlacementAt(target, ev.clientY, row.getBoundingClientRect())
      updateDrop(placement ? { targetId: target.id, placement } : null)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const drop = layerDropRef.current
      layerDragRef.current = null
      layerDropRef.current = null
      setLayerDragId(null)
      setLayerDrop(null)
      if (moved && drop) onDropLayer(id, drop.targetId, drop.placement)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <aside className={'sb-palette' + (disabled ? ' sb-builder-panel--disabled' : '')} {...disabledAttrs}>
      <div className="sb-palette-tabs">
        <button
          type="button"
          className={tab === 'components' ? 'sb-palette-tab--active' : ''}
          onClick={() => setTab('components')}
        >
          컴포넌트
        </button>
        <button
          type="button"
          className={tab === 'layers' ? 'sb-palette-tab--active' : ''}
          onClick={() => setTab('layers')}
        >
          레이어 <span className="sb-palette-tab__count">{items.length}</span>
        </button>
      </div>

      {tab === 'components' ? (
        <>
          <input
            type="text"
            className="sb-palette-search"
            placeholder="컴포넌트 검색…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {defs.length === 0 && <p className="sb-layer-list__empty">"{query}" 검색 결과가 없어요.</p>}
          {CATEGORIES.map((cat) => {
            const list = defs.filter((d) => (d.category || 'content') === cat.key)
            if (list.length === 0) return null
            return (
              <React.Fragment key={cat.key}>
                <p className="sb-panel-label sb-palette-cat">{cat.label}</p>
                {list.map((def) => (
                  <button
                    key={def.type}
                    type="button"
                    className={'sb-palette-card' + (def.container ? ' sb-palette-card--layout' : '')}
                    onClick={() => onAdd(def.type)}
                    draggable={!disabled}
                    title={def.container ? '클릭해 추가 — 다른 컴포넌트를 이 위로 끌어오면 안에 배치돼요' : '레이아웃을 선택한 뒤 클릭하면 그 안에 추가돼요. 원하는 위치로 직접 끌어도 됩니다.'}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/sb-type', def.type)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <span className="sb-palette-card__icon">{def.icon}</span>
                    <span className="sb-palette-card__text">
                      <strong>{def.label}</strong>
                      <small>{def.hint}</small>
                    </span>
                    <span className="sb-palette-card__add">+</span>
                  </button>
                ))}
              </React.Fragment>
            )
          })}
          <div className="sb-shortcut-hints">
            <p className="sb-panel-label">단축키</p>
            <dl>
              <div><dt>⌘Z / ⇧⌘Z</dt><dd>실행 취소 / 다시 실행</dd></div>
              <div><dt>⇧+클릭</dt><dd>다중 선택 (함께 이동)</dd></div>
              <div><dt>드래그</dt><dd>스택 순서 바꾸기 · 레이아웃 위에 놓으면 안에 배치</dd></div>
              <div><dt>레이아웃 선택+추가</dt><dd>선택한 레이아웃 안에 바로 삽입</dd></div>
              <div><dt>레이어 ⠿ 드래그</dt><dd>부모·내부 순서 정밀 변경</dd></div>
              <div><dt>우클릭</dt><dd>복제·잠금·삭제 메뉴</dd></div>
              <div><dt>⌘A</dt><dd>전체 선택</dd></div>
              <div><dt>⌘C / ⌘X / ⌘V</dt><dd>복사 / 잘라내기 / 붙여넣기 (단계 간 가능)</dd></div>
              <div><dt>⌘D</dt><dd>선택 컴포넌트 복제</dd></div>
              <div><dt>⌘+ / ⌘- / ⌘0</dt><dd>캔버스 확대 / 축소 / 100%</dd></div>
              <div><dt>Delete</dt><dd>선택 컴포넌트 삭제</dd></div>
              <div><dt>방향키 ↑↓</dt><dd>순서 한 칸 이동</dd></div>
              <div><dt>Esc</dt><dd>선택 해제</dd></div>
              <div><dt>더블클릭</dt><dd>바로 문구 편집</dd></div>
            </dl>
          </div>
        </>
      ) : (
        <div className="sb-layer-list">
          {items.length > 0 && (
            <p className="sb-layer-list__hint">⠿를 끌어 레이아웃 안에 넣거나 정확한 순서로 옮기세요.</p>
          )}
          {items.length === 0 && <p className="sb-layer-list__empty">이 단계에 컴포넌트가 없어요.</p>}
          {layerRows.map(({ it, depth }, i, arr) => {
            const isChild = depth > 0
            // ↑↓ 이동은 같은 depth의 형제끼리만
            const sibs = arr.filter((r) => r.depth === depth && (isChild ? r.it.parentId === it.parentId : true))
            const si = sibs.findIndex((r) => r.it.id === it.id)
            return (
              <div
                key={it.id}
                data-layer-id={it.id}
                className={
                  'sb-layer' +
                  (isChild ? ' sb-layer--child' : '') +
                  (selectedIds.includes(it.id) ? ' sb-layer--active' : '') +
                  (it.hidden ? ' sb-layer--hidden' : '') +
                  (layerDrop?.targetId === it.id ? ` sb-layer--drop-${layerDrop.placement}` : '')
                }
                onClick={(e) => onSelect(it.id, e.shiftKey)}
              >
                <span
                  className={'sb-layer__drag' + (layerDragId === it.id ? ' sb-layer__drag--active' : '')}
                  title={it.locked ? '잠금을 풀면 이동할 수 있어요' : '드래그해 순서·부모 변경'}
                  onPointerDown={(e) => startLayerDrag(e, it.id)}
                >⠿</span>
                {isChild && <span className="sb-layer__branch" aria-hidden="true">↳</span>}
                <span className="sb-layer__icon">{LIBRARY[it.type]?.icon}</span>
                <span className="sb-layer__name">
                  <strong>{LIBRARY[it.type]?.label}</strong>
                  <small>
                    {String(
                      it.props.title || it.props.text || it.props.question || it.props.name || it.props.tags || ''
                    ).slice(0, 22)}
                  </small>
                </span>
                <span className="sb-layer__btns">
                  <button
                    type="button"
                    title={it.locked ? '잠금 해제' : '순서 잠금 (드래그 방지)'}
                    className={it.locked ? 'sb-layer__btn--on' : ''}
                    onClick={(e) => { e.stopPropagation(); onToggleLock(it.id) }}
                  >{it.locked ? '🔒' : '🔓'}</button>
                  <button
                    type="button"
                    title={it.hidden ? '실행 시 보이기' : '실행 시 숨기기'}
                    className={it.hidden ? 'sb-layer__btn--on' : ''}
                    onClick={(e) => { e.stopPropagation(); onToggleHide(it.id) }}
                  >{it.hidden ? '🚫' : '👁'}</button>
                  {isChild && (
                    <button
                      type="button"
                      title="레이아웃에서 꺼내기"
                      onClick={(e) => { e.stopPropagation(); onUnnest(it.id) }}
                    >⤴</button>
                  )}
                  <button
                    type="button"
                    title="위로"
                    disabled={si <= 0}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(it.id, -1) }}
                  >↑</button>
                  <button
                    type="button"
                    title="아래로"
                    disabled={si === sibs.length - 1}
                    onClick={(e) => { e.stopPropagation(); onMoveLayer(it.id, 1) }}
                  >↓</button>
                  <button
                    type="button"
                    title="삭제"
                    className="sb-layer__del"
                    onClick={(e) => { e.stopPropagation(); onRemove(it.id) }}
                  >✕</button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
