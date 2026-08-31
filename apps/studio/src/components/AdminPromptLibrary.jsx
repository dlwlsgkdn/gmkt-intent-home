import React, { useEffect, useMemo, useState } from 'react'
import { assistAdminPrompt, fetchAdminPrompts, putAdminPrompt } from '../lib/adminApi.js'
import promptGuide from '../assets/prompt-guide.png'
import AdminPromptTrial from './AdminPromptTrial.jsx'

const lineDiff = (before, after) => {
  const a = before.split('\n')
  const b = after.split('\n')
  // 시스템 프롬프트는 보통 수십 줄이다. 비정상적으로 큰 입력은 안전한 앞/뒤 비교로 강등한다.
  if (a.length * b.length > 50000) {
    let head = 0
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1
    let tail = 0
    while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
    return [
      ...(head ? [{ type: 'same', text: `앞의 동일한 ${head}줄` }] : []),
      ...a.slice(head, a.length - tail).map((text) => ({ type: 'remove', text })),
      ...b.slice(head, b.length - tail).map((text) => ({ type: 'add', text })),
      ...(tail ? [{ type: 'same', text: `뒤의 동일한 ${tail}줄` }] : []),
    ]
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const rows = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push({ type: 'same', text: a[i] }); i += 1; j += 1
    } else if (j < b.length && (i === a.length || table[i][j + 1] >= table[i + 1][j])) {
      rows.push({ type: 'add', text: b[j] }); j += 1
    } else {
      rows.push({ type: 'remove', text: a[i] }); i += 1
    }
  }
  const changed = new Set(rows.flatMap((row, index) => (row.type === 'same' ? [] : [index - 1, index, index + 1])))
  const compact = []
  rows.forEach((row, index) => {
    if (row.type !== 'same' || changed.has(index)) compact.push(row)
    else if (compact.at(-1)?.type !== 'skip') compact.push({ type: 'skip', text: '…' })
  })
  return compact
}

export default function AdminPromptLibrary({ api }) {
  const [view, setView] = useState('library')
  const [trialSeed, setTrialSeed] = useState(null)
  const [wire, setWire] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiProposal, setAiProposal] = useState(null)
  const [aiMessages, setAiMessages] = useState([])
  const [aiError, setAiError] = useState(null)

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
    setChangeNote('')
    setAiInstruction('')
    setAiProposal(null)
    setAiMessages([])
    setAiError(null)
  }
  const save = async (value, note) => {
    if (!selected) return
    setSaving(true)
    try {
      const next = await putAdminPrompt(selected.id, value, note)
      setWire(next)
      const updated = next.prompts.find((prompt) => prompt.id === selected.id)
      setSelected(updated || null)
      setDraft(updated ? updated.configured ?? updated.defaultText : '')
      setChangeNote('')
      api.showToast(value == null ? '기본 지시서로 되돌렸어요.' : '지시서를 저장했어요. 새 결과부터 반영됩니다.')
    } catch (e) {
      api.showToast(e.message || '프롬프트를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  const restore = (revision) => save(revision.text, `“${revision.note}” 버전으로 복구`)

  const askClaude = async () => {
    const instruction = aiInstruction.trim()
    if (!selected || !instruction || aiLoading) return
    const beforeText = aiProposal?.proposedText ?? draft
    setAiLoading(true)
    setAiError(null)
    setAiMessages((prev) => [...prev, { role: 'user', text: instruction }])
    try {
      const result = await assistAdminPrompt(selected.id, instruction, beforeText)
      setAiProposal({ ...result, beforeText })
      setAiMessages((prev) => [...prev, { role: 'assistant', text: result.summary }])
      setAiInstruction('')
    } catch (e) {
      const message = e.message || 'Claude가 수정안을 만들지 못했어요.'
      setAiError(message)
      setAiMessages((prev) => [...prev, { role: 'assistant', text: message, error: true }])
    } finally {
      setAiLoading(false)
    }
  }

  const applyProposal = () => {
    if (!aiProposal) return
    setDraft(aiProposal.proposedText)
    setChangeNote(aiProposal.summary)
    api.showToast('Claude 수정안을 편집기에 반영했어요. 아직 저장되지는 않았습니다.')
  }

  const openTrial = (promptId, text, summary) => {
    setTrialSeed({ promptId, text, summary })
    setSelected(null)
    setView('trial')
  }

  const formatAt = (at) => {
    const date = new Date(at)
    return Number.isNaN(date.getTime()) ? at : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
  }
  const draftChanged = selected ? draft !== (selected.configured ?? selected.defaultText) : false
  const trialSupported = selected ? ['survey', 'plan-skeleton', 'plan-products'].includes(selected.id) : false

  const renderGroup = (title, note, rows, icon, example) => rows.length > 0 && (
    <section className="sb-admin-card sb-admin-prompt-group">
      <div className="sb-admin-sectionhead sb-admin-prompt-group__head">
        <span>{icon}</span>
        <div><h2>{title}</h2><p>{note}</p><small>{example}</small></div>
      </div>
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
            <em>열어서 수정 →</em>
          </button>
        ))}
      </div>
    </section>
  )

  return (
    <div className="sb-admin-prompts-page">
      <header className="sb-admin-pagehead sb-admin-prompt-head">
        <div><p className="sb-admin-pagehead__eyebrow">AI에게 일을 설명하는 곳</p><h1>AI 지시서</h1><p>AI가 어떤 말투와 기준으로 답할지 정합니다. 처음이라면 아래 3단계만 따라 하세요.</p></div>
        <img src={promptGuide} alt="AI 지시서의 중요한 문장을 가리키는 안내 캐릭터" />
        {wire && <span className="sb-admin-health is-live"><i /> {wire.promptVersion}</span>}
      </header>

      <div className="sb-admin-prompt-tabs" role="tablist" aria-label="AI 지시서 작업 방식">
        <button type="button" role="tab" aria-selected={view === 'library'} className={view === 'library' ? 'is-on' : ''} onClick={() => setView('library')}>
          <span>지시서 관리</span><small>현재값·변경 기록</small>
        </button>
        <button type="button" role="tab" aria-selected={view === 'trial'} className={view === 'trial' ? 'is-on' : ''} onClick={() => { setTrialSeed(null); setView('trial') }}>
          <span>시험하고 적용</span><small>저장 없이 결과 확인</small>
        </button>
      </div>

      {view === 'trial' ? (
        <AdminPromptTrial wire={wire} seed={trialSeed} onApplied={setWire} api={api} />
      ) : <>

      <section className="sb-admin-prompt-guide" aria-label="AI 지시서 수정 방법">
        <div className="sb-admin-prompt-guide__title"><b>처음이라면 이것만 하세요</b><span>약 3분</span></div>
        <ol>
          <li><i>1</i><span><b>바꾸고 싶은 항목 선택</b><small>말투, 질문, 추천 기준 중 하나만 고르세요.</small></span></li>
          <li><i>2</i><span><b>원하는 결과를 한 문장으로 추가</b><small>“답변은 3문장 이하로 써줘”처럼 구체적으로 적으세요.</small></span></li>
          <li><i>3</i><span><b>저장 없이 시험하고 적용</b><small>결과를 먼저 확인하고, 마음에 들 때만 전체에 적용하세요.</small></span></li>
        </ol>
        <button type="button" className="sb-admin-cta" onClick={() => { setTrialSeed(null); setView('trial') }}>여기서 저장 없이 시험하기 <span>→</span></button>
      </section>

      <section className="sb-admin-prompt-example">
        <div><span>이렇게 쓰면 어려워요</span><p>“추천을 더 좋게 해줘.”</p></div>
        <i>→</i>
        <div className="is-good"><span>이렇게 구체적으로 쓰세요</span><p>“피부 타입과 예산을 먼저 묻고, 추천 이유는 3문장 이하로 써줘.”</p></div>
      </section>

      <div className="sb-admin-callout sb-admin-prompt-safety">
        <span>!</span><p><b>저장은 새로 만드는 결과부터 적용됩니다.</b> 기존 고객 결과는 바뀌지 않아요. 괄호가 두 겹인 표시(예: {'{{CATALOG}}'})는 지우지 마세요.</p>
      </div>
      {error && <div className="sb-admin-card"><p className="sb-admin-gate__error">{error}</p><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={load}>다시 시도</button></div>}
      {!wire && !error && <div className="sb-admin-card"><p className="sb-admin__muted">프롬프트를 불러오는 중…</p></div>}
      {wire && <>
        {renderGroup('답변을 만드는 지시서', '질문·추천 문구·상품 구성을 바꿀 때 선택하세요.', groups.generation, '✦', '예: 질문 수 줄이기 · 추천 이유 짧게 쓰기')}
        {renderGroup('결과를 검사하는 지시서', '좋은 결과인지 자동으로 판단하는 기준입니다.', groups.judge, '✓', '예: 과장 표현 감점 · 조건 누락 확인')}
        {renderGroup('그 밖의 보조 지시서', '공통 처리에서 사용하는 추가 규칙입니다.', groups.other, '＋', '잘 모르겠다면 건드리지 않아도 됩니다.')}
      </>}

      {selected && (
        <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <section className="sb-llm-dialog sb-admin-dialog sb-admin-prompt-dialog" role="dialog" aria-modal="true" aria-label={`${selected.label} 편집`}>
            <div className="sb-admin-dialog__head">
              <div><h2>{selected.label}</h2><p className="sb-admin__muted">{selected.note}</p></div>
              <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <div className="sb-admin-prompt-edit-help">
                <b>Claude에게 사람 말로 요청하세요</b>
                <span><i>1</i> 바꾸고 싶은 내용을 아래 입력칸에 자유롭게 적으세요.</span>
                <span><i>2</i> Claude가 만든 수정 전·후 차이를 확인하고 반영하세요.</span>
                <span><i>3</i> 저장 없이 시험한 뒤 마음에 들 때만 전체에 적용하세요.</span>
              </div>
              <section className="sb-admin-prompt-assist" aria-label="Claude 지시서 수정 도우미">
                <div className="sb-admin-prompt-assist__head">
                  <span>AI 작성</span>
                  <div><b>Claude 지시서 도우미</b><small>수정안만 만들며 승인 전에는 저장하지 않아요.</small></div>
                </div>
                {aiMessages.length > 0 && (
                  <div className="sb-admin-prompt-chat" aria-live="polite">
                    {aiMessages.map((message, index) => (
                      <p key={`${message.role}-${index}`} className={`is-${message.role}${message.error ? ' is-error' : ''}`}>
                        <b>{message.role === 'user' ? '나' : 'Claude'}</b><span>{message.text}</span>
                      </p>
                    ))}
                    {aiLoading && <p className="is-assistant"><b>Claude</b><span>현재 지시서를 읽고 수정안을 만드는 중…</span></p>}
                  </div>
                )}
                <div className="sb-admin-prompt-ask">
                  <textarea
                    value={aiInstruction}
                    maxLength={2000}
                    rows={2}
                    placeholder="예: 올리브영 상품을 먼저 추천하고, 추천 이유는 3문장 이하로 줄여줘"
                    onChange={(event) => setAiInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); askClaude() }
                    }}
                  />
                  <button type="button" className="sb-btn sb-btn--ai sb-btn--small" disabled={aiLoading || aiInstruction.trim().length < 2} onClick={askClaude}>
                    {aiLoading ? '작성 중…' : '수정안 만들기'}
                  </button>
                </div>
                {aiError && <p className="sb-admin-prompt-assist__error">{aiError}</p>}
                {aiProposal && (
                  <div className="sb-admin-prompt-proposal">
                    <div className="sb-admin-prompt-proposal__head">
                      <div><b>{aiProposal.summary}</b><small>초록은 추가 · 빨강은 삭제</small></div>
                      <div>
                        <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={applyProposal}>편집기에 반영</button>
                        {trialSupported && <button type="button" className="sb-btn sb-btn--primary sb-btn--tiny" disabled={saving} onClick={() => openTrial(selected.id, aiProposal.proposedText, aiProposal.summary)}>시험하고 적용 →</button>}
                      </div>
                    </div>
                    {aiProposal.warnings?.length > 0 && <ul>{aiProposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                    <pre className="sb-admin-prompt-diff">
                      {lineDiff(aiProposal.beforeText, aiProposal.proposedText).map((row, index) => (
                        <span key={index} className={`is-${row.type}`}><i>{row.type === 'add' ? '+' : row.type === 'remove' ? '−' : ' '}</i>{row.text || ' '}</span>
                      ))}
                    </pre>
                  </div>
                )}
              </section>
              <div className="sb-admin-prompt-dialog__meta">
                <code>{selected.id}</code>
                <span className={`sb-admin-prompt-chip${selected.configured ? ' sb-admin-prompt-chip--custom' : ''}`}>{selected.configured ? '재정의 사용 중' : '기본값'}</span>
                <span className="sb-admin__muted">{draft.length.toLocaleString('ko-KR')}자</span>
              </div>
              <label className="sb-admin-prompt-editor-label" htmlFor="sb-admin-prompt-editor">AI에게 보여줄 지시서</label>
              <textarea id="sb-admin-prompt-editor" className="sb-admin-prompt-dialog__editor" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <label className="sb-admin-prompt-change" htmlFor="sb-admin-prompt-change">
                <span><b>이번에 바꾼 내용 (선택)</b><small>비워 두면 새로 추가한 명령을 자동으로 기록해요.</small></span>
                <input
                  id="sb-admin-prompt-change"
                  type="text"
                  maxLength={200}
                  value={changeNote}
                  placeholder="예: 추천 이유를 3문장으로 제한"
                  onChange={(event) => setChangeNote(event.target.value)}
                />
              </label>
              {(selected.history || []).length > 0 && (
                <details className="sb-admin-prompt-history">
                  <summary>변경 기록 · {selected.history.length}개 <span>이전 버전으로 되돌릴 수 있어요</span></summary>
                  <ol>
                    {selected.history.map((revision, index) => {
                      const isCurrent = revision.text === selected.configured
                      return (
                        <li key={revision.id}>
                          <span className="sb-admin-prompt-history__dot" aria-hidden="true" />
                          <span className="sb-admin-prompt-history__copy">
                            <b>{revision.note}</b>
                            <small>{formatAt(revision.at)} · {revision.text === null ? '기본 지시서' : `${revision.text.length.toLocaleString('ko-KR')}자`}</small>
                          </span>
                          {isCurrent && index === 0 ? (
                            <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">현재 사용 중</span>
                          ) : (
                            <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" disabled={saving} onClick={() => restore(revision)}>이 버전 복구</button>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                </details>
              )}
              <div className="sb-json-dialog__actions">
                {selected.configured && <button type="button" className="sb-btn sb-btn--ghost" disabled={saving} onClick={() => save(null, '기본 지시서로 복구')}>기본값으로 복귀</button>}
                <button type="button" className="sb-btn sb-btn--ghost" disabled={saving || !draft.trim() || !draftChanged} onClick={() => save(draft, changeNote)}>{saving ? '저장 중…' : '저장만'}</button>
                {trialSupported && <button type="button" className="sb-btn sb-btn--primary" disabled={saving || !draft.trim() || !draftChanged} onClick={() => openTrial(selected.id, draft, changeNote || '직접 수정한 시험안')}>저장 없이 시험 →</button>}
              </div>
            </div>
          </section>
        </div>
      )}
      </>}
    </div>
  )
}
