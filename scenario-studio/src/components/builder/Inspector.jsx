import React from 'react'
import { LIBRARY } from '../../lib/registry.jsx'
import { MIN_ITEM_W } from '../../lib/layout.js'

/* 오른쪽 패널: 선택 컴포넌트 속성 편집 / 다중 선택 도구 */
export default function Inspector({
  stageKey,
  selected,
  selectedIds,
  itemW,
  canvasW,
  heightsRef,
  updateProps,
  updateItem,
  setSize,
  duplicateSelected,
  removeSelected,
  duplicateItem,
  removeItem,
  alignSelected,
}) {
  /* 다중 선택: 정렬 도구 + 일괄 작업 */
  if (selectedIds.length > 1) {
    return (
      <aside className="sb-inspector">
        <div className="sb-inspector__empty">
          <p className="sb-panel-label">다중 선택</p>
          <strong className="sb-multi-count">{selectedIds.length}개</strong> 컴포넌트가 선택됐어요.<br />
          드래그하면 함께 이동하고, 방향키로 같이 움직여요.

          <p className="sb-panel-label" style={{ marginTop: 18 }}>정렬</p>
          <div className="sb-align-tools">
            <button type="button" onClick={() => alignSelected('left')} title="왼쪽 정렬">⇤ 왼쪽</button>
            <button type="button" onClick={() => alignSelected('center')} title="가운데 정렬">↔ 가운데</button>
            <button type="button" onClick={() => alignSelected('right')} title="오른쪽 정렬">⇥ 오른쪽</button>
            <button type="button" onClick={() => alignSelected('vspace')} title="세로 간격 균등">☰ 간격 균등</button>
          </div>

          <div className="sb-inspector__actions">
            <button type="button" className="sb-btn" onClick={duplicateSelected}>모두 복제</button>
            <button type="button" className="sb-btn sb-btn--danger" onClick={removeSelected}>모두 삭제</button>
          </div>
        </div>
      </aside>
    )
  }

  /* 선택 없음 */
  if (!selected) {
    return (
      <aside className="sb-inspector">
        <div className="sb-inspector__empty">
          <p className="sb-panel-label">편집</p>
          캔버스에서 컴포넌트를 선택하면<br />플레이스홀더를 편집할 수 있어요.<br />
          <span style={{ fontSize: 12 }}>⇧+클릭으로 여러 개를 선택할 수 있어요.</span>
          {stageKey === 'survey' && (
            <p className="sb-profile-config__hint" style={{ marginTop: 14 }}>
              💡 프로필 요약 패널은 팔레트의 "프로필 요약 패널" 컴포넌트로 배치하고,
              배지를 클릭해 노출 항목을 조절하세요.
            </p>
          )}
        </div>
      </aside>
    )
  }

  /* 단일 선택: 필드 편집 */
  const def = LIBRARY[selected.type]
  return (
    <aside className="sb-inspector">
      <p className="sb-panel-label">
        {def?.icon} {def?.label}
        {selected.locked ? ' · 🔒 잠김' : ''}
        {selected.hidden ? ' · 🚫 실행 시 숨김' : ''}
      </p>
      {def?.fields.map((f) => (
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
          min={MIN_ITEM_W}
          max={itemW}
          step={8}
          value={selected.w}
          onChange={(e) => {
            const w = Number(e.target.value)
            setSize(selected.id, { w, x: Math.min(selected.x, canvasW - w) })
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
        <button
          type="button"
          className="sb-btn"
          onClick={() => updateItem(selected.id, { locked: !selected.locked })}
        >
          {selected.locked ? '🔓 잠금 해제' : '🔒 잠금'}
        </button>
        <button
          type="button"
          className="sb-btn"
          onClick={() => updateItem(selected.id, { hidden: !selected.hidden })}
        >
          {selected.hidden ? '👁 보이기' : '🚫 숨기기'}
        </button>
      </div>
      <div className="sb-inspector__actions">
        <button type="button" className="sb-btn" onClick={() => duplicateItem(selected.id)}>복제</button>
        <button type="button" className="sb-btn sb-btn--danger" onClick={() => removeItem(selected.id)}>삭제</button>
      </div>
    </aside>
  )
}
