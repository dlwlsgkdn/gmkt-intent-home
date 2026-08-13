import React, { useEffect, useMemo, useState } from 'react'
import { fetchAdminPrompts, putAdminPrompt } from '../lib/adminApi.js'

export default function AdminPromptLibrary({ api }) {
  const [wire, setWire] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setError(null)
    try { setWire(await fetchAdminPrompts()) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  const groups = useMemo(() => {
    const out = { generation: [], judge: [], other: [] }
    for (const prompt of wire?.prompts || []) {
      if (prompt.id.startsWith('judge')) out.judge.push(prompt)
      else if (/survey|plan|skeleton|product|intent/i.test(prompt.id)) out.generation.push(prompt)
      else out.other.push(prompt)
    }
    return out
  }, [wire])

  const open = (prompt) => {
    setSelected(prompt)
    setDraft(prompt.configured ?? prompt.defaultText)
  }
  const save = async (value) => {
    if (!selected) return
    setSaving(true)
    try {
      const next = await putAdminPrompt(selected.id, value)
      setWire(next)
      const updated = next.prompts.find((prompt) => prompt.id === selected.id)
      setSelected(updated || null)
      setDraft(updated ? updated.configured ?? updated.defaultText : '')
      api.showToast(value == null ? '기본 프롬프트로 되돌렸어요.' : '프롬프트를 저장했어요. 새 생성부터 반영됩니다.')
    } catch (e) {
      api.showToast(e.message || '프롬프트를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  const renderGroup = (title, note, rows) => rows.length > 0 && (
    <section className="sb-admin-card sb-admin-prompt-group">
      <div className="sb-admin-sectionhead"><div><h2>{title}</h2><p>{note}</p></div></div>
      <div className="sb-admin-prompt-list">
        {rows.map((prompt) => (
          <button key={prompt.id} type="button" onClick={() => open(prompt)}>
            <span className="sb-admin-prompt-list__main">
              <b>{prompt.label}</b><small>{prompt.note || prompt.id}</small>
            </span>
            <code>{prompt.id}</code>
            <span className={`sb-admin-prompt-chip${prompt.configured ? ' sb-admin-prompt-chip--custom' : ''}`}>
              {prompt.configured ? '재정의 사용 중' : '기본값'}
            </span>
            <em>편집</em>
          </button>
        ))}
      </div>
    </section>
  )

  return (
    <div className="sb-admin-prompts-page">
      <header className="sb-admin-pagehead">
        <div><p className="sb-admin-pagehead__eyebrow">생성·채점 규칙의 단일 보관함</p><h1>프롬프트 보관함</h1><p>현재 서비스가 쓰는 기본값과 운영 재정의를 비교하고 안전하게 관리합니다.</p></div>
        {wire && <span className="sb-admin-health is-live"><i /> {wire.promptVersion}</span>}
      </header>
      <div className="sb-admin-callout">
        <span>i</span><p><b>저장하면 새 생성부터 반영됩니다.</b> 기존 쓰레드에는 영향을 주지 않아요. 운영 반영 전 플레이그라운드와 골든 케이스 실험을 권장합니다.</p>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => api.setAdminTab('pipeline')}>플레이그라운드</button>
      </div>
      {error && <div className="sb-admin-card"><p className="sb-admin-gate__error">{error}</p><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={load}>다시 시도</button></div>}
      {!wire && !error && <div className="sb-admin-card"><p className="sb-admin__muted">프롬프트를 불러오는 중…</p></div>}
      {wire && <>
        {renderGroup('생성 프롬프트', '검색 의도부터 설문·계획·상품 구성까지 실제 생성 단계가 사용합니다.', groups.generation)}
        {renderGroup('평가 프롬프트', '골든 케이스의 결과를 사람 평가와 분리해 자동 채점합니다.', groups.judge)}
        {renderGroup('그 밖의 프롬프트', '공통 보조 단계에서 사용하는 규칙입니다.', groups.other)}
      </>}

      {selected && (
        <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <section className="sb-llm-dialog sb-admin-dialog sb-admin-prompt-dialog" role="dialog" aria-modal="true" aria-label={`${selected.label} 편집`}>
            <div className="sb-admin-dialog__head">
              <div><h2>{selected.label}</h2><p className="sb-admin__muted">{selected.note}</p></div>
              <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <div className="sb-admin-prompt-dialog__meta">
                <code>{selected.id}</code>
                <span className={`sb-admin-prompt-chip${selected.configured ? ' sb-admin-prompt-chip--custom' : ''}`}>{selected.configured ? '재정의 사용 중' : '기본값'}</span>
                <span className="sb-admin__muted">{draft.length.toLocaleString('ko-KR')}자</span>
              </div>
              <textarea className="sb-admin-prompt-dialog__editor" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <div className="sb-json-dialog__actions">
                {selected.configured && <button type="button" className="sb-btn sb-btn--ghost" disabled={saving} onClick={() => save(null)}>기본값으로 복귀</button>}
                <button type="button" className="sb-btn sb-btn--primary" disabled={saving || !draft.trim()} onClick={() => save(draft)}>{saving ? '저장 중…' : '재정의 저장'}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
