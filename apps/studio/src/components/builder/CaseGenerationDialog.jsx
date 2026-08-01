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
  parseCatalogText,
  templateFromCase,
  validateGenerationResponse,
} from '../../lib/prompt/planCases.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import { plainEvaluationText } from '../../lib/evaluation.js'
import { uid } from '../../lib/store.js'
import PromptExchange from './PromptExchange.jsx'
import AiRoundTripNote from './AiRoundTripNote.jsx'

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
  const [replaceExisting, setReplaceExisting] = useState(false) // 같은 조합의 기존 케이스 교체

  const [phase, setPhase] = useState('setup') // setup | exchange | review
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [runErrors, setRunErrors] = useState([])
  const [runWarnings, setRunWarnings] = useState([])
  const [results, setResults] = useState([]) // [{ combo, generated }]
  const [selectedKeys, setSelectedKeys] = useState(new Set())

  /* 조합이 많으면 한 번에 다 만들기 어려우므로 배치로 나눠 프롬프트를 주고받는다 */
  const [batches, setBatches] = useState([])
  const [batchIndex, setBatchIndex] = useState(0)
  const [answerText, setAnswerText] = useState('')

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

  const activeBatch = batches[batchIndex] || []
  const batchPrompt = useMemo(() => (
    activeBatch.length > 0
      ? wrapForChatApp(buildGenerationPrompt(requestForBatch(activeBatch)), {
        json: true,
        pasteTarget: '결과 가져오기',
      })
      : ''
  ), [activeBatch, persona, notes, catalogText, template, selectedAxes])

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

  const start = () => {
    setPhase('exchange')
    setResults([])
    setSelectedKeys(new Set())
    setRunErrors([])
    setRunWarnings([])
    setBatches(chunk(combos, GENERATION_BATCH_SIZE))
    setBatchIndex(0)
    setAnswerText('')
    setProgress({ done: 0, total: combos.length })
  }

  const submitAnswer = () => {
    if (activeBatch.length === 0) return
    setRunErrors([])
    const validation = validateGenerationResponse(answerText, requestForBatch(activeBatch))
    if (validation.cases.length === 0 && validation.errors.length > 0) {
      setRunErrors(validation.errors)
      onToast(`응답 검증 실패: ${validation.errors[0]}`)
      return
    }
    collectBatchResult(activeBatch, validation)
    setProgress((current) => ({ ...current, done: Math.min(current.total, current.done + activeBatch.length) }))
    setAnswerText('')
    if (batchIndex + 1 >= batches.length) setPhase('review')
    else setBatchIndex(batchIndex + 1)
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
    if (replaceExisting) {
      const generatedSignatures = new Set(cases.map(caseComboSignature))
      const willReplace = (planCases || []).filter(
        (planCase) => !planCase.isFallback && generatedSignatures.has(caseComboSignature(planCase))
      )
      if (willReplace.length > 0) {
        const withRecords = willReplace.filter((planCase) => {
          const evaluation = planCase.evaluation || {}
          return Object.values(evaluation.components || {}).some(
            (review) => review?.score != null || String(review?.feedback || '').trim()
          )
        }).length
        const ok = window.confirm(
          `같은 조합의 기존 케이스 ${willReplace.length}개가 교체됩니다.`
          + (withRecords > 0 ? `\n그중 ${withRecords}개의 평가 기록이 함께 사라져요.` : '')
          + '\n계속할까요? (⌘Z로 되돌릴 수 있어요)'
        )
        if (!ok) return
      }
    }
    onApply(cases, { replace: replaceExisting })
    onClose()
  }

  const previewText = (generated) => {
    const first = Object.entries(generated.texts).find(([key]) => key.endsWith(':title'))
    return plainEvaluationText(first ? first[1] : Object.values(generated.texts)[0] || '')
  }

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-gen-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">골든 케이스 + 카탈로그 → 프롬프트 → 내 AI → 조합별 케이스</p>
            <h2 id="sb-gen-title">조합 케이스 만들기</h2>
            <p>골든 케이스의 레이아웃과 상품 카탈로그는 고정하고, AI는 조합별 문구와 상품 선택만 채웁니다.</p>
            <AiRoundTripNote>
              조합이 많으면 <b>여러 배치로 나눠</b> 왕복해요.
            </AiRoundTripNote>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <ol className="sb-steps" aria-label="진행 단계">
          <li className={'sb-steps__item' + (phase === 'setup' ? ' is-active' : ' is-done')}>구조 · 조합</li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item'
            + (phase === 'exchange' ? ' is-active' : (phase === 'review' ? ' is-done' : ''))}>
            프롬프트 왕복
          </li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item' + (phase === 'review' ? ' is-active' : '')}>검토 · 추가</li>
        </ol>

        {phase === 'setup' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
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
                      onChange={(event) => {
                        setSkipExisting(event.target.checked)
                        if (event.target.checked) setReplaceExisting(false)
                      }}
                    />
                    이미 케이스가 있는 조합은 제외
                  </label>
                  {!skipExisting && (
                    <label className="sb-gen-skip" title="페이지 재구성으로 고친 골든 케이스를 전체 조합에 전파할 때 사용해요">
                      <input
                        type="checkbox"
                        checked={replaceExisting}
                        onChange={(event) => setReplaceExisting(event.target.checked)}
                      />
                      같은 조합의 기존 케이스를 새로 만든 것으로 교체
                    </label>
                  )}
                </div>
              </div>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
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
                <span>상품 카탈로그 — 한 줄에 하나, "브랜드 | 상품명 | 가격 | 정가 | 특징". AI는 이 목록에서 고르기만 합니다.</span>
                <textarea
                  className="sb-gen-catalog"
                  rows={7}
                  value={catalogText}
                  onChange={(event) => setCatalogText(event.target.value)}
                  spellCheck={false}
                />
                <small>{catalog.length}개 상품 인식됨 · 기존 케이스와 상품명이 같으면 이미지·색상 등 표시 정보를 승계합니다.</small>
              </label>
            </section>

            {setupProblems.length > 0 && (
              <div className="sb-llm-validation__errors sb-gen-problems">
                {setupProblems.map((problem, index) => <p key={index}>{problem}</p>)}
              </div>
            )}

            <div className="sb-llm-dialog__foot">
              <p>
                조합 {combos.length}개를 {GENERATION_BATCH_SIZE}개씩 나눠 왕복해요. 받은 케이스는 초안으로 추가됩니다.
              </p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={setupProblems.length > 0}
                  onClick={start}
                >
                  프롬프트 만들기
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'exchange' && (
          <>
            <div className="sb-batch-bar">
              <div>
                <strong>배치 {batchIndex + 1} / {batches.length}</strong>
                <small>{activeBatch.map((combo) => combo.key).join(' · ')}</small>
              </div>
              <div className="sb-batch-bar__meter" aria-hidden="true">
                <i style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
              </div>
              <span>{progress.done} / {progress.total} 조합</span>
            </div>

            <PromptExchange
              title="이 배치의 프롬프트"
              hint="검증에 성공하면 다음 배치로 넘어가요."
              prompt={batchPrompt}
              onCopied={(ok) => onToast(ok
                ? `배치 ${batchIndex + 1}/${batches.length} 프롬프트를 복사했어요.`
                : '복사하지 못했어요. 프롬프트를 펼쳐 직접 복사해주세요.')}
              answerText={answerText}
              answerPlaceholder={'{"cases":[...]} JSON을 붙여넣으세요.'}
              onAnswerChange={setAnswerText}
              rows={8}
            />

            {runErrors.map((error, index) => <p key={index} className="sb-llm-error">{error}</p>)}
            {results.length > 0 && <p className="sb-llm-summary">지금까지 {results.length}개 케이스 생성됨</p>}

            <div className="sb-llm-dialog__foot">
              <p>중간에 그만둬도 이미 검증된 케이스는 검토·적용할 수 있어요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('review')}>
                  여기까지만 검토
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={!answerText.trim()}
                  onClick={submitAnswer}
                >
                  {batchIndex + 1 >= batches.length ? '응답 검증 · 검토로' : '응답 검증 · 다음 배치'}
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'review' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
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
