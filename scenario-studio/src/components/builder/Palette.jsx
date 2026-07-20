import React, { useState } from 'react'
import { LIBRARY, libraryForStage } from '../../lib/registry.jsx'
import { sortByPosition } from '../../lib/store.js'

/* 왼쪽 패널: 컴포넌트 팔레트(검색 포함) / 레이어 목록(잠금·숨김·순서) */
const CATEGORIES = [
  { key: 'content', label: '콘텐츠' },
  { key: 'layout', label: '레이아웃 — 컴포넌트를 안에 배치' },
]

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
  onUnnest,
}) {
  const [tab, setTab] = useState('components')
  const [query, setQuery] = useState('')

  const defs = libraryForStage(stageKey).filter((def) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return def.label.toLowerCase().includes(q) || (def.hint || '').toLowerCase().includes(q)
  })

  /* 레이어 목록: 최상위(위치순) 아래에 컨테이너 자식(슬롯순)을 들여쓰기로 */
  const layerRows = sortByPosition(items.filter((it) => !it.parentId)).flatMap((it) => [
    { it, depth: 0 },
    ...items
      .filter((k) => k.parentId === it.id)
      .sort((a, b) => (a.slot || 0) - (b.slot || 0))
      .map((k) => ({ it: k, depth: 1 })),
  ])

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
                    draggable
                    title={def.container ? '클릭해 추가 — 다른 컴포넌트를 이 위로 끌어오면 안에 배치돼요' : '클릭해 추가하거나, 캔버스(또는 레이아웃 컴포넌트 위)로 끌어다 놓으세요'}
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
              <div><dt>빈 곳 드래그</dt><dd>범위로 다중 선택</dd></div>
              <div><dt>우클릭</dt><dd>복제·잠금·삭제 메뉴</dd></div>
              <div><dt>⌘A</dt><dd>전체 선택</dd></div>
              <div><dt>⌘C / ⌘X / ⌘V</dt><dd>복사 / 잘라내기 / 붙여넣기 (단계 간 가능)</dd></div>
              <div><dt>⌘D</dt><dd>선택 컴포넌트 복제</dd></div>
              <div><dt>⌘+ / ⌘- / ⌘0</dt><dd>캔버스 확대 / 축소 / 100%</dd></div>
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
          {layerRows.map(({ it, depth }, i, arr) => {
            const isChild = depth > 0
            // ↑↓ 이동은 같은 depth의 형제끼리만
            const sibs = arr.filter((r) => r.depth === depth && (isChild ? r.it.parentId === it.parentId : true))
            const si = sibs.findIndex((r) => r.it.id === it.id)
            return (
              <div
                key={it.id}
                className={
                  'sb-layer' +
                  (isChild ? ' sb-layer--child' : '') +
                  (selectedIds.includes(it.id) ? ' sb-layer--active' : '') +
                  (it.hidden ? ' sb-layer--hidden' : '')
                }
                onClick={(e) => onSelect(it.id, e.shiftKey)}
              >
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
