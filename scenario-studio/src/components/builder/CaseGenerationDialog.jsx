import React, { useMemo, useState } from 'react'
import {
  GENERATION_BATCH_SIZE,
  assembleGeneratedCase,
  buildGenerationPrompt,
  buildGenerationRequest,
  caseComboSignature,
  catalogFromScenario,
  catalogToText,
  comboSignature,
  expandCombinations,
  generationAxes,
  GENERATION_RESPONSE_SCHEMA,
  parseCatalogText,
  templateFromCase,
  validateGenerationResponse,
} from '../../lib/caseGeneration.js'
import { plainEvaluationText } from '../../lib/evaluation.js'
import { uid } from '../../lib/store.js'

const personaFromProfile = (profile) => {
  const name = profile?.name ? `${profile.name}.` : ''
  const traits = (profile?.items || [])
    .map((item) => `${item.label}: ${item.value}`)
    .join(', ')
  return [name, traits].filter(Boolean).join(' ')
}

const chunk = (list, size) => {
  const out = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}

export default function CaseGenerationDialog({
  scenario,
  planCases,
  activeCaseId,
  profile,
  onApply,
  onClose,
  onToast,
}) {
  const axes = useMemo(() => generationAxes(scenario?.stages?.survey || []), [scenario])
  const candidateCases = useMemo(
    () => (planCases || []).filter((planCase) => (planCase.items || []).length > 0),
    [planCases]
  )
  const defaultGolden = candidateCases.find((planCase) => planCase.id === activeCaseId)
    || candidateCases.find((planCase) => !planCase.isFallback)
    || candidateCases[0]
    || null

  const [goldenCaseId, setGoldenCaseId] = useState(defaultGolden?.id || null)
  const [selectedAxisIds, setSelectedAxisIds] = useState(() => new Set(axes.map((axis) => axis.questionId)))
  const [persona, setPersona] = useState(() => personaFromProfile(profile))
  const baseCatalog = useMemo(() => catalogFromScenario(planCases || []), [planCases])
  const [catalogText, setCatalogText] = useState(() => catalogToText(baseCatalog))
  const [notes, setNotes] = useState('')
  const [skipExisting, setSkipExisting] = useState(true)
  const [manualMode, setManualMode] = useState(false)

  const [phase, setPhase] = useState('setup') // setup | running | review
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [runErrors, setRunErrors] = useState([])
  const [runWarnings, setRunWarnings] = useState([])
  const [results, setResults] = useState([]) // [{ combo, generated }]
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const cancelRef = React.useRef(false)

  // 수동 모드(프롬프트 복사 → 응답 붙여넣기) 상태
  const [manualBatches, setManualBatches] = useState([])
  const [manualIndex, setManualIndex] = useState(0)
  const [manualResponse, setManualResponse] = useState('')

  const goldenCase = candidateCases.find((planCase) => planCase.id === goldenCaseId) || null
  const template = useMemo(() => (goldenCase ? templateFromCase(goldenCase) : null), [goldenCase])
  const selectedAxes = axes.filter((axis) => selectedAxisIds.has(axis.questionId))
  const { entries: catalog, errors: catalogErrors } = useMemo(
    () => parseCatalogText(catalogText, baseCatalog),
    [catalogText, baseCatalog]
  )

  const combos = useMemo(() => {
    const all = expandCombinations(selectedAxes)
    if (!skipExisting) return all
    const existing = new Set((planCases || []).map(caseComboSignature).filter(Boolean))
    return all.filter((combo) => !existing.has(comboSignature(combo)))
  }, [selectedAxes, skipExisting, planCases])

  const toggleAxis = (questionId) => {
    setSelectedAxisIds((current) => {
      const next = new Set(current)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  const setupProblems = []
  if (!goldenCase) setupProblems.push('내용이 있는 골든 케이스가 필요합니다. 먼저 대표 케이스 하나를 완성해주세요.')
  if (selectedAxes.length === 0) setupProblems.push('설문 축을 하나 이상 선택해주세요.')
  if (combos.length === 0 && selectedAxes.length > 0) setupProblems.push('생성할 조합이 없습니다. (이미 모든 조합의 케이스가 있어요)')
  if (template && template.productSlots.length > 0 && catalog.length === 0) {
    setupProblems.push('상품 카탈로그를 한 줄 이상 입력해주세요.')
  }
  catalogErrors.forEach((error) => setupProblems.push(`카탈로그 ${error}`))

  const requestForBatch = (batch) => buildGenerationRequest({
    scenario,
    persona,
    axes: selectedAxes,
    combos: batch,
    template,
    catalog,
    notes,
  })

  const collectBatchResult = (batch, validation) => {
    setRunWarnings((current) => [...current, ...validation.warnings])
    if (validation.errors.length > 0) {
      setRunErrors((current) => [...current, ...validation.errors])
    }
    const byKey = Object.fromEntries(batch.map((combo) => [combo.key, combo]))
    setResults((current) => [
      ...current,
      ...validation.cases.map((generated) => ({ combo: byKey[generated.comboKey], generated })),
    ])
    setSelectedKeys((current) => {
      const next = new Set(current)
      validation.cases.forEach((generated) => next.add(generated.comboKey))
      return next
    })
  }

  const startAuto = async () => {
    cancelRef.current = false
    const batches = chunk(combos, GENERATION_BATCH_SIZE)
    setPhase('running')
    setResults([])
    setSelectedKeys(new Set())
    setRunErrors([])
    setRunWarnings([])
    setProgress({ done: 0, total: combos.length })

    for (const batch of batches) {
      if (cancelRef.current) break
      try {
        const request = requestForBatch(batch)
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: buildGenerationPrompt(request),
            responseSchema: GENERATION_RESPONSE_SCHEMA,
          }),
        })
        const rawText = await response.text()
        let payload = rawText
        try { payload = JSON.parse(rawText) } catch { /* 검증기가 텍스트에서 JSON을 추출한다 */ }
        if (!response.ok) {
          const message = (payload && payload.error) || `HTTP ${response.status}`
          setRunErrors((current) => [...current, `${batch.map((c) => c.key).join(', ')}: ${message}`])
        } else {
          collectBatchResult(batch, validateGenerationResponse(payload, request))
        }
      } catch (error) {
        setRunErrors((current) => [...current, `${batch.map((c) => c.key).join(', ')}: ${error.message}`])
      }
      setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + batch.length) }))
    }
    setPhase('review')
  }

  const startManual = () => {
    setPhase('running')
    setResults([])
    setSelectedKeys(new Set())
    setRunErrors([])
    setRunWarnings([])
    const batches = chunk(combos, GENERATION_BATCH_SIZE)
    setManualBatches(batches)
    setManualIndex(0)
    setManualResponse('')
    setProgress({ done: 0, total: combos.length })
  }

  const copyManualPrompt = async () => {
    const batch = manualBatches[manualIndex]
    if (!batch) return
    const prompt = buildGenerationPrompt(requestForBatch(batch))
    try {
      await navigator.clipboard.writeText(prompt)
      onToast(`배치 ${manualIndex + 1}/${manualBatches.length} 프롬프트를 복사했어요.`)
    } catch {
      onToast('복사하지 못했어요. 브라우저 권한을 확인해주세요.')
    }
  }

  const submitManualResponse = () => {
    const batch = manualBatches[manualIndex]
    if (!batch) return
    const request = requestForBatch(batch)
    const validation = validateGenerationResponse(manualResponse, request)
    if (validation.cases.length === 0 && validation.errors.length > 0) {
      onToast(`응답 검증 실패: ${validation.errors[0]}`)
      return
    }
    collectBatchResult(batch, validation)
    setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + batch.length) }))
    setManualResponse('')
    if (manualIndex + 1 >= manualBatches.length) setPhase('review')
    else setManualIndex(manualIndex + 1)
  }

  const toggleResult = (comboKey) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(comboKey)) next.delete(comboKey)
      else next.add(comboKey)
      return next
    })
  }

  const applySelected = () => {
    const generationId = `gen-${uid()}`
    const chosen = results.filter((result) => selectedKeys.has(result.generated.comboKey))
    if (chosen.length === 0) return
    const existingRegular = (planCases || []).filter((planCase) => !planCase.isFallback).length
    const cases = chosen.map((result, index) =>
      assembleGeneratedCase({
        template,
        combo: result.combo,
        generated: result.generated,
        catalog,
        generationId,
        sequence: existingRegular + index + 1,
      })
    )
    onApply(cases)
    onClose()
  }

  const previewText = (generated) => {
    const first = Object.entries(generated.texts).find(([key]) => key.endsWith(':title'))
    return plainEvaluationText(first ? first[1] : Object.values(generated.texts)[0] || '')
  }

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && phase !== 'running') onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-gen-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">PERSONA + CATALOG → LLM → DRAFT CASES</p>
            <h2 id="sb-gen-title">계획 케이스 자동 생성</h2>
            <p>골든 케이스의 레이아웃과 상품 카탈로그는 고정하고, LLM이 조합별 문구와 상품 선택만 채웁니다.</p>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        {phase === 'setup' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 1</span>
                  <strong>구조 · 조합</strong>
                </div>
                <span>{combos.length}개 조합 생성 예정</span>
              </div>
              <div className="sb-gen-grid">
                <label className="sb-gen-field">
                  <span>골든 케이스 (레이아웃·문체 기준)</span>
                  <select value={goldenCaseId || ''} onChange={(event) => setGoldenCaseId(event.target.value)}>
                    {candidateCases.map((planCase) => (
                      <option key={planCase.id} value={planCase.id}>
                        {planCase.name} · 컴포넌트 {(planCase.items || []).length}개
                      </option>
                    ))}
                  </select>
                  {template && (
                    <small>텍스트 슬롯 {template.textSlots.length}개 · 상품 슬롯 {template.productSlots.length}개 추출됨</small>
                  )}
                </label>
                <div className="sb-gen-field">
                  <span>설문 축 (조합 = 선택지의 곱)</span>
                  <div className="sb-gen-axes">
                    {axes.map((axis) => (
                      <label key={axis.questionId}>
                        <input
                          type="checkbox"
                          checked={selectedAxisIds.has(axis.questionId)}
                          onChange={() => toggleAxis(axis.questionId)}
                        />
                        <b>{axis.question}</b>
                        <em>{axis.options.length}개 선택지</em>
                      </label>
                    ))}
                    {axes.length === 0 && <p className="sb-llm-help">설문 단계에 선택지가 있는 질문이 없습니다.</p>}
                  </div>
                  <label className="sb-gen-skip">
                    <input
                      type="checkbox"
                      checked={skipExisting}
                      onChange={(event) => setSkipExisting(event.target.checked)}
                    />
                    이미 케이스가 있는 조합은 제외
                  </label>
                </div>
              </div>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 2</span>
                  <strong>페르소나 · 상품 카탈로그</strong>
                </div>
              </div>
              <div className="sb-gen-grid">
                <label className="sb-gen-field">
                  <span>페르소나</span>
                  <textarea
                    rows={3}
                    value={persona}
                    onChange={(event) => setPersona(event.target.value)}
                    placeholder="예: 유진. 나이대: 20대 후반, 피부타입: 복합성 …"
                  />
                </label>
                <label className="sb-gen-field">
                  <span>추가 지시사항 <em>선택</em></span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="예: 존댓말 유지, 이모지 사용 금지, 각 단계 설명은 2문장 이내 …"
                  />
                </label>
              </div>
              <label className="sb-gen-field">
                <span>상품 카탈로그 — 한 줄에 하나, "브랜드 | 상품명 | 가격 | 정가 | 특징". LLM은 이 목록에서 고르기만 합니다.</span>
                <textarea
                  className="sb-gen-catalog"
                  rows={7}
                  value={catalogText}
                  onChange={(event) => setCatalogText(event.target.value)}
                  spellCheck={false}
                />
                <small>{catalog.length}개 상품 인식됨 · 기존 케이스와 상품명이 같으면 이미지·색상 등 표시 정보를 승계합니다.</small>
              </label>
              <label className="sb-gen-skip">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(event) => setManualMode(event.target.checked)}
                />
                수동 모드 — 서버 없이 프롬프트 복사 → LLM 응답 붙여넣기로 진행
              </label>
            </section>

            {setupProblems.length > 0 && (
              <div className="sb-llm-validation__errors sb-gen-problems">
                {setupProblems.map((problem, index) => <p key={index}>{problem}</p>)}
              </div>
            )}

            <div className="sb-llm-dialog__foot">
              <p>
                생성된 케이스는 초안으로 추가되며, 평가 탭에서 검수한 뒤 발행하세요.
                영상 등 외부 콘텐츠는 골든 케이스 것이 복제됩니다.
              </p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={setupProblems.length > 0}
                  onClick={manualMode ? startManual : startAuto}
                >
                  {combos.length}개 조합 생성 시작
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'running' && !manualMode && (
          <section className="sb-llm-section sb-gen-progress">
            <div className="sb-llm-section__head">
              <div>
                <span>GENERATING</span>
                <strong>LLM이 케이스를 생성하고 있어요</strong>
              </div>
              <span>{progress.done} / {progress.total} 조합</span>
            </div>
            <div className="sb-gen-progress__bar">
              <i style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <p className="sb-llm-help">
              {GENERATION_BATCH_SIZE}개 조합씩 요청합니다. 완료된 배치의 결과는 아래에 쌓이고, 중단해도 이미 생성된 케이스는 검토·적용할 수 있어요.
            </p>
            {results.length > 0 && <p className="sb-llm-summary">지금까지 {results.length}개 케이스 생성됨</p>}
            {runErrors.map((error, index) => <p key={index} className="sb-llm-error">{error}</p>)}
            <div className="sb-llm-dialog__foot">
              <p />
              <div>
                <button type="button" className="sb-btn" onClick={() => { cancelRef.current = true }}>
                  현재 배치까지만 하고 중단
                </button>
              </div>
            </div>
          </section>
        )}

        {phase === 'running' && manualMode && (
          <section className="sb-llm-section">
            <div className="sb-llm-section__head">
              <div>
                <span>MANUAL BATCH {manualIndex + 1} / {manualBatches.length}</span>
                <strong>{(manualBatches[manualIndex] || []).map((combo) => combo.key).join(' · ')}</strong>
              </div>
              <button type="button" className="sb-btn sb-btn--primary" onClick={copyManualPrompt}>
                이 배치 프롬프트 복사
              </button>
            </div>
            <p className="sb-llm-help">복사한 프롬프트를 사용하는 LLM에 붙여넣고, 반환된 JSON을 아래에 붙여넣으세요.</p>
            <textarea
              className="sb-llm-response"
              rows={8}
              value={manualResponse}
              onChange={(event) => setManualResponse(event.target.value)}
              placeholder={'{"cases":[...]} JSON을 붙여넣으세요.'}
            />
            {runErrors.map((error, index) => <p key={index} className="sb-llm-error">{error}</p>)}
            <div className="sb-llm-dialog__foot">
              <p>{progress.done} / {progress.total} 조합 완료</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('review')}>
                  여기까지만 검토
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={!manualResponse.trim()}
                  onClick={submitManualResponse}
                >
                  응답 검증 · 다음 배치
                </button>
              </div>
            </div>
          </section>
        )}

        {phase === 'review' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>REVIEW</span>
                  <strong>생성 결과 검토</strong>
                </div>
                <span>{selectedKeys.size}/{results.length}개 선택</span>
              </div>
              {runErrors.length > 0 && (
                <div className="sb-llm-validation__errors">
                  <strong>일부 실패</strong>
                  {runErrors.map((error, index) => <p key={index}>{error}</p>)}
                </div>
              )}
              {runWarnings.slice(0, 8).map((warning, index) => (
                <p key={index} className="sb-llm-warning">{warning}</p>
              ))}
              {runWarnings.length > 8 && <p className="sb-llm-warning">…외 경고 {runWarnings.length - 8}건</p>}
              <div className="sb-llm-revisions sb-gen-results">
                {results.map(({ combo, generated }) => (
                  <label key={generated.comboKey} className="sb-llm-revision">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(generated.comboKey)}
                      onChange={() => toggleResult(generated.comboKey)}
                    />
                    <div>
                      <strong>{generated.comboKey}</strong>
                      <small>
                        텍스트 {Object.keys(generated.texts).length}개 · 상품 선택 {Object.keys(generated.products).length}개
                      </small>
                      <p>{previewText(generated) || '(생성된 제목 없음)'}</p>
                    </div>
                  </label>
                ))}
                {results.length === 0 && (
                  <div className="sb-llm-empty">
                    <strong>생성된 케이스가 없습니다.</strong>
                    <p>오류 메시지를 확인하고 다시 시도해주세요.</p>
                  </div>
                )}
              </div>
            </section>
            <div className="sb-llm-dialog__foot">
              <p>적용하면 기본(폴백) 케이스 앞에 초안으로 추가됩니다. Undo(⌘Z)로 되돌릴 수 있어요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('setup')}>설정으로</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={selectedKeys.size === 0}
                  onClick={applySelected}
                >
                  선택한 {selectedKeys.size}개 케이스 추가
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
