import React, { useState } from 'react'
import { LIBRARY, libraryForStage } from '../../lib/registry.jsx'
import { sortByPosition } from '../../lib/store.js'

/* 왼쪽 패널: 컴포넌트 팔레트(검색 포함) / 레이어 목록(잠금·숨김·순서) */
export default function Palette({
  stageKey,
  items,
  selectedIds,
  onSelect,
  onAdd,
  onMoveLayer,
  onRemove,
  onToggleLock,
  onToggleHide,
}) {
  const [tab, setTab] = useState('components')
  const [query, setQuery] = useState('')

  const defs = libraryForStage(stageKey).filter((def) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return def.label.toLowerCase().includes(q) || (def.hint || '').toLowerCase().includes(q)
  })

  return (
    <aside className="sb-palette">
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
          {defs.map((def) => (
            <button key={def.type} type="button" className="sb-palette-card" onClick={() => onAdd(def.type)}>
              <span className="sb-palette-card__icon">{def.icon}</span>
              <span className="sb-palette-card__text">
                <strong>{def.label}</strong>
                <small>{def.hint}</small>
              </span>
              <span className="sb-palette-card__add">+</span>
            </button>
          ))}
          <div className="sb-shortcut-hints">
            <p className="sb-panel-label">단축키</p>
            <dl>
              <div><dt>⌘Z / ⇧⌘Z</dt><dd>실행 취소 / 다시 실행</dd></div>
              <div><dt>⇧+클릭</dt><dd>다중 선택 (함께 이동)</dd></div>
              <div><dt>⌘A</dt><dd>전체 선택</dd></div>
              <div><dt>⌘D</dt><dd>선택 컴포넌트 복제</dd></div>
              <div><dt>Delete</dt><dd>선택 컴포넌트 삭제</dd></div>
              <div><dt>방향키</dt><dd>8px 이동 (⇧: 1px)</dd></div>
              <div><dt>Esc</dt><dd>선택 해제</dd></div>
              <div><dt>더블클릭</dt><dd>바로 문구 편집</dd></div>
            </dl>
          </div>
        </>
      ) : (
        <div className="sb-layer-list">
          {items.length === 0 && <p className="sb-layer-list__empty">이 단계에 컴포넌트가 없어요.</p>}
          {sortByPosition(items).map((it, i, arr) => (
            <div
              key={it.id}
              className={
                'sb-layer' +
                (selectedIds.includes(it.id) ? ' sb-layer--active' : '') +
                (it.hidden ? ' sb-layer--hidden' : '')
              }
              onClick={(e) => onSelect(it.id, e.shiftKey)}
            >
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
                  title={it.locked ? '잠금 해제' : '위치 잠금 (드래그 방지)'}
                  className={it.locked ? 'sb-layer__btn--on' : ''}
                  onClick={(e) => { e.stopPropagation(); onToggleLock(it.id) }}
                >{it.locked ? '🔒' : '🔓'}</button>
                <button
                  type="button"
                  title={it.hidden ? '실행 시 보이기' : '실행 시 숨기기'}
                  className={it.hidden ? 'sb-layer__btn--on' : ''}
                  onClick={(e) => { e.stopPropagation(); onToggleHide(it.id) }}
                >{it.hidden ? '🚫' : '👁'}</button>
                <button
                  type="button"
                  title="위로"
                  disabled={i === 0}
                  onClick={(e) => { e.stopPropagation(); onMoveLayer(it.id, -1) }}
                >↑</button>
                <button
                  type="button"
                  title="아래로"
                  disabled={i === arr.length - 1}
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
          ))}
        </div>
      )}
    </aside>
  )
}
