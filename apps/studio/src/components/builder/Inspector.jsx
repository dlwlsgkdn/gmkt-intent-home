import React from 'react'
import { LIBRARY } from '../../lib/registry.jsx'
import { TEXT_COLORS, SizeMenu, FontMenu, applyOptToRaw } from '../../lib/richtext.jsx'
import { MIN_ITEM_W } from '../../lib/builder/geometry.js'
import { ListFieldEditor, TableFieldEditor } from './ListEditors.jsx'
import { ProfileChipManager, SummaryChipManager } from './ChipManagers.jsx'

/* 목록형 필드 GUI 편집기 kind 집합 — 실제 구현은 ListEditors.jsx */
const LIST_FIELD_KINDS = new Set(['options', 'stringList', 'cards'])

/* 오른쪽 패널: 선택 컴포넌트 속성 편집 / 다중 선택 도구 */
export default function Inspector({
  disabled = false,
  stageKey,
  containerPanel = null,
  selected,
  selectedIds,
  itemW,
  updateProps,
  updateItem,
  duplicateSelected,
  removeSelected,
  duplicateItem,
  removeItem,
  ensureKeyword,
  unnestItem,
  profile,
  updateProfile,
  surveyQuestions,
}) {
  /* 드래그 선택 → 플로팅 서식 툴바 상태 (훅은 조기 return보다 앞에) */
  const [sel, setSel] = React.useState(null) // { key, start, end, list }
  const disabledAttrs = disabled ? { inert: '', 'aria-disabled': true } : {}

  /* 다중 선택: 정렬 도구 + 일괄 작업 */
  if (selectedIds.length > 1) {
    return (
      <aside className={'sb-inspector' + (disabled ? ' sb-builder-panel--disabled' : '')} {...disabledAttrs}>
        <div className="sb-inspector__empty">
          <p className="sb-panel-label">다중 선택</p>
          <strong className="sb-multi-count">{selectedIds.length}개</strong> 컴포넌트가 선택됐어요.<br />
          드래그하면 함께 순서를 옮기고, 방향키(↑↓)로 같이 움직여요.

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
      <aside className={'sb-inspector sb-inspector--idle' + (disabled ? ' sb-builder-panel--disabled' : '')} {...disabledAttrs}>
        <div className="sb-inspector__empty">
          <p className="sb-panel-label">편집</p>
          캔버스에서 컴포넌트를 선택하면<br />플레이스홀더를 편집할 수 있어요.<br />
          <span style={{ fontSize: 'var(--sb-t-small)' }}>⇧+클릭으로 여러 개를 선택할 수 있어요.</span>
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
  /* ── 드래그 선택 → 플로팅 서식 툴바 ──
     선택 구간을 {{서식|텍스트}} 또는 [[키워드]] 마크업으로 감싼다 */
  const onFieldSelect = (key, el, list) => {
    if (el.selectionStart != null && el.selectionEnd > el.selectionStart) {
      setSel({ key, start: el.selectionStart, end: el.selectionEnd, list: !!list })
    } else {
      setSel((s2) => (s2 && s2.key === key ? null : s2))
    }
  }

  const applyMark = (opt) => {
    if (!sel) return
    const val = String(selected.props[sel.key] ?? '')
    const inner = val.slice(sel.start, sel.end)
    if (!inner.trim()) return
    if (opt === 'kw' && ensureKeyword && !/[,|{}\[\]\n]/.test(inner)) ensureKeyword(inner.trim())
    const res = applyOptToRaw(val, sel.start, sel.end, opt)
    updateProps(selected.id, sel.key, res.value)
    // 적용 구간을 유지해 연속 적용 가능하게
    setSel({ ...sel, start: res.start, end: res.end })
    setTimeout(() => {
      const el = document.querySelector(`.sb-inspector [data-fkey="${sel.key}"]`)
      if (el && el.setSelectionRange) {
        el.focus()
        el.setSelectionRange(res.start, res.end)
      }
    }, 60)
  }

  const selToolbar = (f) =>
    sel && sel.key === f.key ? (
      <div className="sb-seltb" onMouseDown={(e) => e.preventDefault()}>
        {!sel.list && (
          <>
            <button type="button" title="볼드" onClick={() => applyMark('b')}><b>B</b></button>
            <FontMenu onPick={(key) => applyMark('f' + key)} />
            <SizeMenu onPick={(n) => applyMark('s' + n)} />
            <span className="sb-seltb__sep" />
            {TEXT_COLORS.filter((c) => c.color).map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                className="sb-seltb__color"
                style={{ background: c.color }}
                onClick={() => applyMark('c' + c.color)}
              />
            ))}
            <span className="sb-seltb__sep" />
          </>
        )}
        <button type="button" className="sb-seltb__kw" title="점선 밑줄 + 설명 모달 연결" onClick={() => applyMark('kw')}>
          <span className="keyword-detail-text">밑줄</span>
        </button>
        <button type="button" title="선택 구간 서식 지우기" onClick={() => applyMark('clear')}><s>가</s></button>
      </div>
    ) : null

  const fieldValue = (f) => selected.props[f.key] ?? f.defaultValue ?? ''

  return (
    <aside className={'sb-inspector' + (disabled ? ' sb-builder-panel--disabled' : '')} {...disabledAttrs}>
      <p className="sb-panel-label">
        {def?.icon} {def?.label}
        {selected.locked ? ' · 🔒 잠김' : ''}
        {selected.hidden ? ' · 🚫 실행 시 숨김' : ''}
      </p>

      {containerPanel}

      {def?.fields.map((f) => (
        <div key={f.key} className="sb-field sb-field--rel">
          <label>{f.label}</label>
          {selToolbar(f)}
          {LIST_FIELD_KINDS.has(f.kind) ? (
            <ListFieldEditor
              key={selected.id}
              kind={f.kind}
              value={fieldValue(f)}
              onChange={(v) => updateProps(selected.id, f.key, v)}
              textFieldProps={{
                'data-fkey': f.key,
                onSelect: (e) => onFieldSelect(f.key, e.target, f.list),
              }}
            />
          ) : f.kind === 'profileChips' ? (
            <ProfileChipManager
              key={selected.id}
              hidden={fieldValue(f)}
              onChangeHidden={(v) => updateProps(selected.id, f.key, v)}
              profile={profile}
              updateProfile={updateProfile}
            />
          ) : f.kind === 'summaryChips' ? (
            <SummaryChipManager
              key={selected.id}
              hiddenProfile={fieldValue(f)}
              hiddenQuestions={selected.props[f.questionsKey] ?? ''}
              onChangeHiddenProfile={(v) => updateProps(selected.id, f.key, v)}
              onChangeHiddenQuestions={(v) => updateProps(selected.id, f.questionsKey, v)}
              profile={profile}
              surveyQuestions={surveyQuestions}
            />
          ) : f.kind === 'table' ? (
            <TableFieldEditor
              key={selected.id}
              value={fieldValue(f)}
              headers={f.headersKey ? selected.props[f.headersKey] ?? '' : ''}
              showHeaders={!!f.headersKey}
              onChange={(v) => updateProps(selected.id, f.key, v)}
              onChangeHeaders={(v) => { if (f.headersKey) updateProps(selected.id, f.headersKey, v) }}
              textFieldProps={{
                'data-fkey': f.key,
                onSelect: (e) => onFieldSelect(f.key, e.target, f.list),
              }}
            />
          ) : f.kind === 'textarea' ? (
            <textarea
              rows={3}
              data-fkey={f.key}
              value={fieldValue(f)}
              onChange={(e) => updateProps(selected.id, f.key, e.target.value)}
              onSelect={(e) => onFieldSelect(f.key, e.target, f.list)}
            />
          ) : f.kind === 'select' ? (
            <select
              data-fkey={f.key}
              value={fieldValue(f)}
              onChange={(e) => updateProps(selected.id, f.key, e.target.value)}
            >
              {(f.options || []).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : f.kind === 'toggle' ? (
            <button
              type="button"
              className={'sb-toggle' + (fieldValue(f) ? ' sb-toggle--on' : '')}
              onClick={() => updateProps(selected.id, f.key, !fieldValue(f))}
            >
              <span className="sb-toggle__knob" />
              {fieldValue(f) ? '켜짐' : '꺼짐'}
            </button>
          ) : (
            <input
              type={f.kind === 'url' ? 'url' : 'text'}
              data-fkey={f.key}
              value={fieldValue(f)}
              placeholder={f.placeholder || ''}
              inputMode={f.kind === 'url' ? 'url' : undefined}
              spellCheck={f.kind === 'url' ? false : undefined}
              onChange={(e) => updateProps(selected.id, f.key, e.target.value)}
              onSelect={(e) => onFieldSelect(f.key, e.target, f.list)}
            />
          )}
        </div>
      ))}
      <p className="sb-profile-config__hint">
        ✍️ 문구를 드래그로 선택하면 서식 툴바가 떠요 — 볼드/폰트/크기/색, 그리고 점선 밑줄(설명 모달 연결).
      </p>

      {selected.parentId && (
        <>
          <p className="sb-profile-config__hint">
            📦 레이아웃 컴포넌트 안에 배치되어 있어요 — 위 목록에서 내부 컴포넌트를 검색·선택·정렬할 수 있어요.
          </p>
          <div className="sb-inspector__actions">
            <button type="button" className="sb-btn" onClick={() => unnestItem(selected.id)}>
              ⤴ 레이아웃에서 꺼내기
            </button>
          </div>
        </>
      )}

      {/* 크기 조절은 컨테이너 자식(카드)만 — 최상위 컴포넌트는 전폭·자동 높이 스택이다 */}
      {selected.parentId && (
        <>
          <div className="sb-field">
            <label>카드 너비 — {selected.w ? `${selected.w}px` : '자동'}</label>
            <input
              type="range"
              min={MIN_ITEM_W}
              max={itemW}
              step={8}
              value={selected.w || 320}
              onChange={(e) => updateItem(selected.id, { w: Number(e.target.value) })}
            />
          </div>
          <div className="sb-field">
            <label>카드 높이 — {selected.h ? `${selected.h}px` : '자동'}</label>
            <input
              type="range"
              min={48}
              max={720}
              step={8}
              value={selected.h || 120}
              onChange={(e) => updateItem(selected.id, { h: Number(e.target.value) })}
            />
            {selected.h ? (
              <button
                type="button"
                className="sb-btn sb-btn--ghost sb-btn--small"
                onClick={() => updateItem(selected.id, { h: null })}
              >
                자동 높이로 되돌리기
              </button>
            ) : null}
          </div>
        </>
      )}

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
