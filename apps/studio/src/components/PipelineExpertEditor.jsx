import React, { useEffect, useMemo, useState } from 'react'
import { PIPELINE_STAGES } from '../../../../packages/pipeline/src/stages.ts'
import { fetchAdminPipeline, fetchAdminPrompts, putAdminPrompt } from '../lib/adminApi.js'
import { knowledgeRouting } from '../lib/pipelineKnowledge.js'
import PipelineFlow, { KIND_LABEL } from './PipelineFlow.jsx'

const CODE_SOURCE_BY_STAGE = {
  objective: 'packages/pipeline/src/guards/objective.ts',
  ledger: 'packages/pipeline/src/ledger.ts',
  candidates: 'packages/pipeline/src/ledger.ts',
  verify: 'packages/pipeline/src/guards/grounding.ts',
  record: 'apps/bff/src/engine/graph.ts',
}

const DEFAULT_PROMPTS = {
  promptVersion: '연결 전 미리보기',
  prompts: PIPELINE_STAGES.filter((stage) => stage.promptId).map((stage) => ({
    id: stage.promptId,
    label: stage.label,
    note: stage.note,
    defaultText: `# ${stage.label}\n\n${stage.note}\n\n운영 서버에 연결되면 현재 사용 중인 전체 프롬프트가 여기에 표시됩니다.`,
    configured: null,
    history: [],
  })),
}

export default function PipelineExpertEditor({ api }) {
  const [pipeline, setPipeline] = useState(null)
  const [prompts, setPrompts] = useState(DEFAULT_PROMPTS)
  const [promptConnected, setPromptConnected] = useState(false)
  const [error, setError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setError(null)
    const [pipelineResult, promptResult] = await Promise.allSettled([fetchAdminPipeline(), fetchAdminPrompts()])
    if (pipelineResult.status === 'fulfilled') setPipeline(pipelineResult.value)
    if (promptResult.status === 'fulfilled') { setPrompts(promptResult.value); setPromptConnected(true) }
    if (pipelineResult.status === 'rejected' || promptResult.status === 'rejected') {
      setError('현재 설정 일부를 불러오지 못했어요. 파이프라인 구조는 계속 볼 수 있습니다.')
    }
  }

  useEffect(() => { load() }, [])

  const stages = pipeline?.stages || PIPELINE_STAGES
  const selected = selectedId ? stages.find((stage) => stage.id === selectedId) || null : null
  const selectedPrompt = selected?.promptId
    ? prompts?.prompts?.find((prompt) => prompt.id === selected.promptId) || null
    : null
  const knowledge = pipeline?.knowledge || []
  const routing = useMemo(() => knowledgeRouting(knowledge, stages, prompts), [knowledge, stages, prompts])
  const knowledgeById = useMemo(() => new Map(knowledge.map((entry) => [entry.id, entry])), [knowledge])
  const connectedKnowledge = selected ? (routing.byStage.get(selected.id) || []).map((id) => knowledgeById.get(id)).filter(Boolean) : []

  useEffect(() => {
    if (promptConnected && selectedPrompt) setDraft(selectedPrompt.configured ?? selectedPrompt.defaultText)
  }, [promptConnected, selectedPrompt?.id])

  const openStage = (stageId) => {
    const stage = stages.find((entry) => entry.id === stageId)
    const prompt = stage?.promptId ? prompts?.prompts?.find((entry) => entry.id === stage.promptId) : null
    setSelectedId(stageId)
    setDraft(prompt ? prompt.configured ?? prompt.defaultText : '')
  }

  const savePrompt = async () => {
    if (!selectedPrompt || saving || !draft.trim()) return
    setSaving(true)
    try {
      const value = draft === selectedPrompt.defaultText ? null : draft
      const next = await putAdminPrompt(selectedPrompt.id, value)
      setPrompts(next)
      setPipeline((current) => current ? {
        ...current,
        stages: current.stages.map((stage) => stage.promptId === selectedPrompt.id ? { ...stage, promptCustom: value !== null } : stage),
      } : current)
      api.showToast(value === null ? '기본 프롬프트로 되돌렸어요.' : '프롬프트를 저장했어요. 새 결과부터 반영됩니다.')
      setSelectedId(null)
    } catch (saveError) {
      api.showToast(saveError.message || '프롬프트를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  const configuredText = selectedPrompt ? selectedPrompt.configured ?? selectedPrompt.defaultText : ''
  const dirty = Boolean(selectedPrompt && draft !== configuredText)

  return (
    <div className="sb-pipeline-editor">
      <header className="sb-admin-pagehead">
        <div>
          <p className="sb-admin-pagehead__eyebrow">단계별 AI 지시 조정</p>
          <h1>전문가용 고치기</h1>
          <p>고치려는 파이프라인 단계를 누르면 해당 프롬프트를 바로 편집할 수 있습니다.</p>
        </div>
        <span className="sb-pipeline-editor__badge">프롬프트 · 코드</span>
      </header>

      {error && <div className="sb-pipeline-editor__notice"><span>{error}</span><button type="button" onClick={load}>다시 불러오기</button></div>}

      <section className="sb-admin-card sb-pipeline-editor__canvas" aria-label="편집할 파이프라인 단계 선택">
        <div className="sb-pipeline-editor__intro">
          <div><h2>어느 단계를 고칠까요?</h2><p>AI 단계는 프롬프트를, 규칙 단계는 연결된 코드 위치를 보여줍니다.</p></div>
          <span>단계를 눌러 편집</span>
        </div>
        <PipelineFlow
          stages={stages}
          results={{}}
          selectedId={selectedId}
          onSelect={openStage}
          feedByStage={routing.byStage}
          knowledgeById={knowledgeById}
        />
      </section>

      {selected && (
        <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelectedId(null) }}>
          <section className="sb-llm-dialog sb-admin-dialog sb-pipeline-editor__dialog" role="dialog" aria-modal="true" aria-label={`${selected.label} 편집`}>
            <div className="sb-admin-dialog__head">
              <div><span className="sb-pipeline-editor__step">{selected.no}단계</span><h2>{selected.label}</h2></div>
              <button type="button" className="sb-icon-btn" aria-label="닫기" disabled={saving} onClick={() => setSelectedId(null)}>×</button>
            </div>
            <div className="sb-pipeline-editor__dialog-body">
              <div className="sb-pipeline-editor__meta">
                <span>{KIND_LABEL[selected.kind] || selected.kind}</span>
                {selected.effort && <span>생성 강도 {selected.effort}</span>}
                {selectedPrompt?.configured && <span className="is-custom">수정본 사용 중</span>}
              </div>
              <p className="sb-pipeline-editor__stage-note">{selected.note}</p>

              {connectedKnowledge.length > 0 && (
                <div className="sb-pipeline-editor__knowledge"><b>이 단계가 참고하는 자료</b><div>{connectedKnowledge.map((entry) => <span key={entry.id}>{entry.label}</span>)}</div></div>
              )}

              {selected.promptId ? selectedPrompt ? (
                <>
                  <label className="sb-pipeline-editor__label" htmlFor="sb-pipeline-editor-prompt">AI에게 전달할 프롬프트</label>
                  <textarea id="sb-pipeline-editor-prompt" value={draft} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
                  <div className="sb-pipeline-editor__prompt-info"><code>{selectedPrompt.id}</code><span>{draft.length.toLocaleString('ko-KR')}자</span></div>
                  <div className="sb-json-dialog__actions">
                    {selectedPrompt.configured && <button type="button" className="sb-btn sb-btn--ghost" disabled={saving} onClick={() => setDraft(selectedPrompt.defaultText)}>기본값 불러오기</button>}
                    <button type="button" className="sb-btn sb-btn--ghost" disabled={saving} onClick={() => setSelectedId(null)}>취소</button>
                    <button type="button" className="sb-btn sb-btn--primary" disabled={saving || !promptConnected || !dirty || !draft.trim()} title={promptConnected ? undefined : '운영 서버 연결 후 저장할 수 있어요'} onClick={savePrompt}>{saving ? '저장 중…' : '프롬프트 저장'}</button>
                  </div>
                </>
              ) : <p className="sb-pipeline-editor__empty">프롬프트 설정을 불러오는 중입니다.</p> : (
                <div className="sb-pipeline-editor__code">
                  <span>이 단계는 프롬프트 없이 코드 규칙으로 처리됩니다.</span>
                  <code>{CODE_SOURCE_BY_STAGE[selected.id] || 'apps/bff/src/engine/graph.ts'}</code>
                  <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={async () => {
                    const path = CODE_SOURCE_BY_STAGE[selected.id] || 'apps/bff/src/engine/graph.ts'
                    try { await navigator.clipboard.writeText(path); api.showToast('코드 파일 경로를 복사했어요.') }
                    catch { api.showToast('파일 경로를 복사하지 못했어요.') }
                  }}>파일 경로 복사</button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
