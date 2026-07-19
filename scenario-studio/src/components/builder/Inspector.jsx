import React from 'react'
import { LIBRARY, FONT_OPTIONS, TEXT_COLORS } from '../../lib/registry.jsx'
import { MIN_ITEM_W } from '../../lib/layout.js'

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
  keywords = [],
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
  const st = selected.style || {}
  const setStyle = (patch) => updateItem(selected.id, { style: { ...st, ...patch } })

  /* 텍스트 필드(문구)들만 대상으로 키워드 [[..]] 래핑 토글 */
  const textFieldKeys = (def?.fields || [])
    .filter((f) => f.kind === 'text' || f.kind === 'textarea')
    .map((f) => f.key)
  const hasKeyword = (word) =>
    textFieldKeys.some((k) => String(selected.props[k] || '').includes(`[[${word}]]`))
  const wordExists = (word) =>
    textFieldKeys.some((k) => String(selected.props[k] || '').includes(word))
  const toggleKeyword = (word) => {
    const wrapped = hasKeyword(word)
    textFieldKeys.forEach((k) => {
      const val = String(selected.props[k] || '')
      if (!val.includes(word)) return
      const next = wrapped
        ? val.split(`[[${word}]]`).join(word)
        : val.replace(new RegExp(`\\[\\[${escapeRegExp(word)}\\]\\]|${escapeRegExp(word)}`, 'g'), (m) =>
            m.startsWith('[[') ? m : `[[${word}]]`
          )
      if (next !== val) updateProps(selected.id, k, next)
    })
  }

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

      {/* 텍스트 스타일 */}
      <p className="sb-panel-label" style={{ marginTop: 18 }}>텍스트 스타일</p>
      <div className="sb-field">
        <label>폰트</label>
        <div className="sb-font-tabs">
          {FONT_OPTIONS.map((f) => (
            <button
              key={String(f.key)}
              type="button"
              className={(st.font || null) === f.key ? 'sb-font-tab--active' : ''}
              style={f.stack ? { fontFamily: f.stack } : undefined}
              onClick={() => setStyle({ font: f.key })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sb-field">
        <label>글자 크기 — {st.size ? `${st.size}px` : '기본'}</label>
        <input
          type="range"
          min={11}
          max={34}
          step={1}
          value={st.size || 15}
          onChange={(e) => setStyle({ size: Number(e.target.value) })}
        />
        {st.size ? (
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => setStyle({ size: null })}>
            기본 크기로
          </button>
        ) : null}
      </div>
      <div className="sb-field">
        <label>글자 색</label>
        <div className="sb-text-colors">
          {TEXT_COLORS.map((c) => (
            <button
              key={String(c.key)}
              type="button"
              title={c.label}
              className={
                'sb-text-color' +
                ((st.color || null) === c.color ? ' sb-text-color--active' : '') +
                (c.color ? '' : ' sb-text-color--none')
              }
              style={c.color ? { background: c.color } : undefined}
              onClick={() => setStyle({ color: c.color })}
            />
          ))}
        </div>
      </div>
      <div className="sb-field">
        <label>굵기</label>
        <button
          type="button"
          className={'sb-toggle' + (st.bold ? ' sb-toggle--on' : '')}
          onClick={() => setStyle({ bold: !st.bold })}
        >
          <span className="sb-toggle__knob" />
          {st.bold ? '볼드 전체 적용' : '기본 굵기'}
        </button>
      </div>

      {/* 키워드 밑줄 연결 */}
      {keywords.length > 0 && (
        <>
          <p className="sb-panel-label" style={{ marginTop: 18 }}>키워드 밑줄 연결</p>
          <p className="sb-profile-config__hint">
            문구에 포함된 단어를 켜면 점선 밑줄 + 설명 모달이 연결돼요.
            (직접 <code>[[단어]]</code>로 써도 동일) 사전은 탐색 편집기에서 관리.
          </p>
          <div className="sb-kw-toggles">
            {keywords
              .filter((k) => k.word && k.word.trim())
              .map((k) => {
                const present = wordExists(k.word)
                const on = hasKeyword(k.word)
                return (
                  <button
                    key={k.word}
                    type="button"
                    disabled={!present}
                    title={present ? (on ? '밑줄 해제' : '점선 밑줄 + 모달 연결') : '이 컴포넌트 문구에 없는 단어예요'}
                    className={'sb-kw-toggle' + (on ? ' sb-kw-toggle--on' : '')}
                    onClick={() => toggleKeyword(k.word)}
                  >
                    <span className="keyword-detail-text">{k.word}</span>
                    {on ? ' ✓' : ''}
                  </button>
                )
              })}
          </div>
        </>
      )}

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
