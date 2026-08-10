import React, { useEffect, useMemo, useState } from 'react'
import {
  dryRunStage,
  fetchAdminModel,
  fetchAdminPipeline,
  fetchAdminPrompts,
  putAdminEngine,
  putAdminKnowledge,
  putAdminModel,
  putAdminPrompt,
} from '../lib/adminApi.js'
import AdminThreadPreview from './AdminThreadPreview.jsx'
import PipelineFlow, { KIND_LABEL, metaLine } from './PipelineFlow.jsx'

/*
 * 파이프라인 스튜디오 (운영 콘솔 "파이프라인" 탭 — DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4).
 * 왼쪽 = 세로 흐름 다이어그램 카드(PipelineFlow — 히어로) + 런타임 설정(엔진·모델),
 * 오른쪽 = 플레이그라운드·지식 KV. 시스템 프롬프트 패널은 별도 카드가 아니라 다이어그램에
 * 녹아 있다: LLM 노드 클릭 = 단계 레이어 모달(설명·최근 실행·프롬프트 열람·수정).
 * 플레이그라운드는 LLM 단계를 그래프·쓰레드 기록 없이 단독 실행(dry-run)한다 — 실행 중에는
 * 다이어그램 위로 쿼리 경로가 흐르고 결과 메타가 노드에 남는다.
 * 실행 버튼은 진짜 생성이므로 ✦ (스튜디오 왕복 ⇄ 아님 — CLAUDE.md 표기 규칙).
 */

const INJECTION_LABEL = { system: '시스템(캐시)', user: '가변부', guard: '검증 게이트' }

export default function PipelineStudio({ api }) {
  const [wire, setWire] = useState(null) // AdminPipelineWire
  const [error, setError] = useState(null)
  const [engineSaving, setEngineSaving] = useState(false)
  const [selectedStage, setSelectedStage] = useState(null) // 단계 레이어 모달의 노드 id
  const [knowledgeEdit, setKnowledgeEdit] = useState(null) // AdminKnowledgeEntry
  const [knowledgeText, setKnowledgeText] = useState('')
  const [knowledgeSaving, setKnowledgeSaving] = useState(false)

  /* LLM 모델 — 다이어그램 카드의 런타임 설정 (구 "생성 모델" 카드가 여기로 녹았다) */
  const [model, setModel] = useState(null) // { current, defaultModel, configured, options }
  const [modelChoice, setModelChoice] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  /* 시스템 프롬프트 — 단계 레이어 모달에서 열람·수정 (구 "시스템 프롬프트" 카드가 여기로 녹았다) */
  const [prompts, setPrompts] = useState(null) // AdminPromptsWire { promptVersion, prompts }
  const [promptsError, setPromptsError] = useState(null)
  const [promptText, setPromptText] = useState('')
  const [promptSaving, setPromptSaving] = useState(false)

  /* 플레이그라운드 — 설문 실행 → 답변 선택 → 뼈대/상품 실행 */
  const [pgIntent, setPgIntent] = useState('여름에 무너지지 않는 쿠션 찾아줘')
  const [pgOverride, setPgOverride] = useState('')
  const [running, setRunning] = useState(null) // 실행 중 stageId
  const [pgStatus, setPgStatus] = useState(null)
  const [pgError, setPgError] = useState(null)
  const [svResult, setSvResult] = useState(null) // { survey, ledger, meta, promptCustom }
  const [pgAnswers, setPgAnswers] = useState({}) // { [questionId]: string[] }
  const [skResult, setSkResult] = useState(null) // { skeleton, ledger, meta }
  const [prodResult, setProdResult] = useState(null) // { sections, dropLog, ledger, meta }

  const load = async () => {
    setError(null)
    try {
      setWire(await fetchAdminPipeline())
    } catch (e) {
      setError(e.message)
    }
  }
  const loadModel = async () => {
    try {
      const next = await fetchAdminModel()
      setModel(next)
      setModelChoice(next.configured ?? '')
    } catch (e) {
      api.showToast(`모델 설정을 불러오지 못했어요: ${e.message}`)
    }
  }
  const loadPrompts = async () => {
    setPromptsError(null)
    try {
      setPrompts(await fetchAdminPrompts())
    } catch (e) {
      setPromptsError(e.message)
    }
  }
  useEffect(() => {
    load()
    loadModel()
    loadPrompts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const promptEntryOf = (promptId) => prompts?.prompts?.find((p) => p.id === promptId) || null

  const saveEngine = async (engine) => {
    setEngineSaving(true)
    try {
      setWire(await putAdminEngine(engine))
    } catch (e) {
      setError(e.message)
    } finally {
      setEngineSaving(false)
    }
  }

  const applyModel = async () => {
    setModelSaving(true)
    try {
      const next = await putAdminModel(modelChoice || null)
      setModel(next)
      setModelChoice(next.configured ?? '')
      api.showToast(`생성 모델: ${next.current}${next.configured ? '' : ' (기본값)'} — 새 생성부터 반영돼요.`)
    } catch (e) {
      api.showToast(e.message || '모델을 변경하지 못했어요.')
    } finally {
      setModelSaving(false)
    }
  }

  const openKnowledge = (entry) => {
    setKnowledgeEdit(entry)
    setKnowledgeText(entry.value ?? '')
  }
  const saveKnowledge = async (value) => {
    setKnowledgeSaving(true)
    try {
      setWire(await putAdminKnowledge(knowledgeEdit.id, value))
      setKnowledgeEdit(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setKnowledgeSaving(false)
    }
  }

  /* 단계 레이어 모달 — 선택 노드·프롬프트. 열 때(와 저장 후 prompts 갱신 시) 편집 원문을 저장본으로 리셋 */
  const selected = selectedStage && wire ? wire.stages.find((s) => s.id === selectedStage) || null : null
  const stagePrompt = selected?.promptId ? promptEntryOf(selected.promptId) : null
  useEffect(() => {
    if (!selectedStage) return
    const stage = wire?.stages.find((s) => s.id === selectedStage)
    const entry = stage?.promptId ? prompts?.prompts?.find((p) => p.id === stage.promptId) : null
    setPromptText(entry ? entry.configured ?? entry.defaultText : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStage, prompts])

  const savePrompt = async (textOrNull) => {
    if (!stagePrompt) return
    setPromptSaving(true)
    try {
      const nextPrompts = await putAdminPrompt(stagePrompt.id, textOrNull)
      setPrompts(nextPrompts)
      const updated = nextPrompts.prompts.find((p) => p.id === stagePrompt.id)
      // 노드의 재정의 점 표식(promptCustom)도 파이프라인 와이어 재조회 없이 맞춘다
      setWire((prev) =>
        prev
          ? {
              ...prev,
              stages: prev.stages.map((s) =>
                s.promptId === stagePrompt.id ? { ...s, promptCustom: Boolean(updated?.configured) } : s,
              ),
            }
          : prev,
      )
      api.showToast(
        updated?.configured
          ? `「${stagePrompt.label}」 프롬프트를 재정의했어요 — 새 생성부터 반영돼요.`
          : `「${stagePrompt.label}」 프롬프트를 기본값으로 되돌렸어요.`,
      )
    } catch (e) {
      api.showToast(e.message || '프롬프트를 저장하지 못했어요.')
    } finally {
      setPromptSaving(false)
    }
  }

  const answersList = useMemo(
    () =>
      Object.entries(pgAnswers)
        .filter(([, choices]) => choices.length > 0)
        .map(([questionId, choices]) => ({ questionId, choices })),
    [pgAnswers],
  )

  const toggleAnswer = (question, option) => {
    setPgAnswers((prev) => {
      const current = prev[question.id] || []
      let next
      if (question.multi) next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option]
      else next = current[0] === option ? [] : [option]
      return { ...prev, [question.id]: next }
    })
  }

  const runStage = async (stageId) => {
    if (running) return
    setRunning(stageId)
    setPgStatus(null)
    setPgError(null)
    try {
      const body = {
        stageId,
        intent: pgIntent.trim(),
        ...(pgOverride.trim() ? { promptOverride: pgOverride } : {}),
        ...(stageId === 'survey' ? {} : { survey: svResult?.survey, answers: answersList }),
      }
      const result = await dryRunStage(body, { onStatus: setPgStatus })
      if (stageId === 'survey') {
        setSvResult(result)
        setPgAnswers({})
        setSkResult(null)
        setProdResult(null)
      } else if (stageId === 'plan-skeleton') setSkResult(result)
      else setProdResult(result)
    } catch (e) {
      setPgError(e.message)
    } finally {
      setRunning(null)
      setPgStatus(null)
    }
  }

  /* 설문 미리보기용 합성 쓰레드 — AdminThreadPreview(실렌더)를 그대로 재사용한다 */
  const previewThread = useMemo(() => {
    if (!svResult?.survey) return null
    return {
      steps: [
        { stage: 'survey', payload: { page: svResult.survey } },
        ...(answersList.length ? [{ stage: 'answers', payload: { answers: answersList } }] : []),
      ],
    }
  }, [svResult, answersList])

  const planReady = Boolean(svResult?.survey) && answersList.length > 0

  /* 흐름 다이어그램에 얹는 실행 결과 요약 — 노드의 ✓ 배지·레이어 모달 메타의 원천 */
  const flowResults = useMemo(() => {
    const map = {}
    if (svResult) map.survey = { meta: svResult.meta, custom: svResult.promptCustom }
    if (skResult) map['plan-skeleton'] = { meta: skResult.meta, custom: skResult.promptCustom }
    if (prodResult) {
      map['plan-products'] = { meta: prodResult.meta, custom: prodResult.promptCustom }
      map.verify = { pass: (prodResult.sections || []).length, drops: (prodResult.dropLog || []).length }
    }
    return map
  }, [svResult, skResult, prodResult])

  const selectedResult = selected ? flowResults[selected.id] : null
  const modelDirty = model && (model.configured ?? '') !== modelChoice

  return (
    <>
      {error && <p className="sb-admin-gate__error">{error}</p>}

      {/* 세로 흐름 카드(왼쪽 레일) ∥ 플레이그라운드·지식(오른쪽) — 실행이 왼쪽 흐름에 비친다 */}
      <div className="sb-pipe-layout">
        <div className="sb-admin-card sb-flow-card">
          <p className="sb-panel-label">생성 파이프라인 (전략 문서 0~7)</p>

          {/* 런타임 설정 — 엔진 플래그·생성 모델 (파이프라인 전체에 걸리는 값이라 다이어그램 머리에) */}
          <div className="sb-flow-config">
            <div className="sb-flow-config__row">
              <span className="sb-flow-config__label">엔진</span>
              {!wire ? (
                <span className="sb-admin__muted">불러오는 중…</span>
              ) : (
                <>
                  <div className="sb-admin-fb-seg" role="group" aria-label="생성 엔진">
                    {['legacy', 'langgraph'].map((engine) => (
                      <button
                        key={engine}
                        type="button"
                        className={'sb-admin-fb-seg__btn' + (wire.engine.current === engine ? ' is-on' : '')}
                        disabled={engineSaving}
                        onClick={() => saveEngine(engine)}
                      >
                        {engine}
                      </button>
                    ))}
                  </div>
                  {wire.engine.configured ? (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--tiny"
                      disabled={engineSaving}
                      onClick={() => saveEngine(null)}
                    >
                      기본값(legacy) 복귀
                    </button>
                  ) : (
                    <span className="sb-admin__muted" title="요청 단위 오버라이드: x-ddak-engine 헤더">기본값 사용 중</span>
                  )}
                </>
              )}
            </div>
            <div className="sb-flow-config__row">
              <span className="sb-flow-config__label">모델</span>
              {!model ? (
                <span className="sb-admin__muted">불러오는 중…</span>
              ) : (
                <>
                  <select value={modelChoice} aria-label="생성 모델" onChange={(event) => setModelChoice(event.target.value)}>
                    <option value="">기본값 — {model.defaultModel}</option>
                    {model.options.map((option) => (
                      <option key={option.id} value={option.id} title={option.note || undefined}>
                        {option.label} ({option.id})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary sb-btn--tiny"
                    disabled={!modelDirty || modelSaving}
                    onClick={applyModel}
                  >
                    {modelSaving ? '적용 중…' : '적용'}
                  </button>
                </>
              )}
            </div>
            {model && (
              <details className="sb-flow-config__more">
                <summary>모델 설명 · 반영 시점</summary>
                <ul className="sb-admin-model__notes">
                  {model.options.map((option) => (
                    <li key={option.id}>
                      <b>{option.label}</b>{option.note ? ` — ${option.note}` : ''}
                    </li>
                  ))}
                </ul>
                <p className="sb-admin__muted">
                  변경은 core 설정(llm-model·llm-prompt-*)에 저장되고 새 생성부터 반영돼요 (서버 캐시 최대 30초).
                  {prompts ? ` 시스템 프롬프트 기본 ${prompts.promptVersion} — LLM 단계 노드를 눌러 열람·수정해요.` : ''}
                </p>
              </details>
            )}
          </div>

          {!wire ? (
            <p className="sb-admin__muted">파이프라인 현황을 불러오는 중…</p>
          ) : (
            <>
              <PipelineFlow
                stages={wire.stages}
                running={running}
                results={flowResults}
                selectedId={selectedStage}
                onSelect={setSelectedStage}
              />
              {running && (
                <p className="sb-flow-status">
                  <i className="sb-flow-status__dot" aria-hidden="true" />
                  {pgStatus || '단계를 실행하고 있어요…'}
                </p>
              )}
            </>
          )}
        </div>

        <div className="sb-pipe-side">
          {/* 플레이그라운드 — 단계 단독 실행 (실행이 왼쪽 다이어그램에 그대로 비친다) */}
          <div className="sb-admin-card">
            <p className="sb-panel-label">플레이그라운드 (단계 단독 실행 — 쓰레드 기록 없음)</p>
            <div className="sb-pipe-play__intent">
              <input
                type="text"
                value={pgIntent}
                placeholder="한 줄 의도 — 예: 여름에 무너지지 않는 쿠션 찾아줘"
                onChange={(event) => setPgIntent(event.target.value)}
              />
              <button
                type="button"
                className="sb-btn sb-btn--ai sb-btn--small"
                disabled={!pgIntent.trim() || running !== null}
                onClick={() => runStage('survey')}
              >
                {running === 'survey' ? '실행 중…' : '✦ 설문 실행 (3단계)'}
              </button>
            </div>
            <details className="sb-pipe-play__override">
              <summary>임시 시스템 프롬프트 (what-if — 다음 실행 1회에 적용, 저장 안 됨)</summary>
              <textarea
                value={pgOverride}
                spellCheck={false}
                placeholder="비워 두면 저장된 프롬프트(재정의 포함)로 실행돼요. {{CATALOG}} 등 자리표시자 치환은 동일하게 적용돼요."
                onChange={(event) => setPgOverride(event.target.value)}
              />
            </details>
            {pgStatus && <p className="sb-admin__muted">{pgStatus}</p>}
            {pgError && <p className="sb-admin-gate__error">{pgError}</p>}

            {svResult?.survey && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>설문 결과</b>
                  <span className="sb-admin__muted">{metaLine(svResult.meta)}</span>
                  {svResult.promptCustom && <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">임시/재정의 프롬프트</span>}
                </div>
                <p className="sb-pipe-play__intro">{svResult.survey.intro}</p>
                <div className="sb-pipe-play__grid">
                  <div className="sb-pipe-play__answers">
                    {svResult.survey.questions.map((question) => (
                      <div key={question.id} className="sb-pipe-play__q">
                        <p>
                          {question.question}
                          {question.multi && <span className="sb-admin__muted"> (복수)</span>}
                        </p>
                        <div className="sb-pipe-play__opts">
                          {question.options.map((option) => {
                            const on = (pgAnswers[question.id] || []).includes(option)
                            return (
                              <button
                                key={option}
                                type="button"
                                className={'sb-pipe-play__opt' + (on ? ' is-on' : '')}
                                onClick={() => toggleAnswer(question, option)}
                              >
                                {option}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="sb-pipe-play__actions">
                      <button
                        type="button"
                        className="sb-btn sb-btn--ai sb-btn--small"
                        disabled={!planReady || running !== null}
                        title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
                        onClick={() => runStage('plan-skeleton')}
                      >
                        {running === 'plan-skeleton' ? '실행 중…' : '✦ 계획 뼈대 실행 (5a)'}
                      </button>
                      <button
                        type="button"
                        className="sb-btn sb-btn--ai sb-btn--small"
                        disabled={!planReady || running !== null}
                        title={planReady ? undefined : '답변을 하나 이상 선택하세요'}
                        onClick={() => runStage('plan-products')}
                      >
                        {running === 'plan-products' ? '실행 중…' : '✦ 상품·콘텐츠 실행 (4+5b→6)'}
                      </button>
                    </div>
                    {svResult.ledger?.trendKeywords?.length > 0 && (
                      <p className="sb-admin__muted">원장 키워드: {svResult.ledger.trendKeywords.join(', ')}</p>
                    )}
                  </div>
                  {previewThread && (
                    <div className="sb-pipe-play__preview">
                      <AdminThreadPreview thread={previewThread} stage="survey" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {skResult?.skeleton && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>계획 뼈대 결과</b>
                  <span className="sb-admin__muted">{metaLine(skResult.meta)}</span>
                </div>
                <p className="sb-pipe-play__intro">
                  <b>{skResult.skeleton.headline}</b> — {skResult.skeleton.summary}
                </p>
                <ul className="sb-pipe-sections">
                  {skResult.skeleton.sections.map((section, index) => (
                    <li key={index} className="sb-pipe-sections__row">
                      <span className="sb-admin-prompt-chip">{section.kind}</span>
                      <div>
                        <b>{section.title}</b>
                        {section.kind === 'guide' && <p>{section.body}</p>}
                        {section.kind === 'steps' && <p>{(section.steps || []).join(' → ')}</p>}
                        {(section.kind === 'products' || section.kind === 'contents') && (
                          <p className="sb-admin__muted">자리 — 검색 단계가 채워요 · 기준: {section.reason}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {prodResult && (
              <div className="sb-pipe-play__stage">
                <div className="sb-pipe-play__stagehead">
                  <b>상품·콘텐츠 결과 (검증 게이트 통과분)</b>
                  <span className="sb-admin__muted">{metaLine(prodResult.meta)}</span>
                </div>
                {(prodResult.sections || []).map((section, index) => (
                  <div key={index} className="sb-pipe-play__section">
                    <p>
                      <span className="sb-admin-prompt-chip">{section.kind}</span> <b>{section.title}</b>{' '}
                      <span className="sb-admin__muted">{section.reason}</span>
                    </p>
                    {section.kind === 'products' && (
                      <ul className="sb-pipe-products">
                        {section.products.map((product) => (
                          <li key={product.id}>
                            <b>{product.brand}</b> {product.name}
                            <span className="sb-admin__muted">
                              {' '}
                              {product.price?.toLocaleString('ko-KR')}원 · {product.mall || '지마켓'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {section.kind === 'contents' && (
                      <ul className="sb-pipe-products">
                        {section.items.map((item, itemIndex) => (
                          <li key={itemIndex}>
                            <b>{item.source}</b> {item.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {(prodResult.sections || []).length === 0 && (
                  <p className="sb-admin__muted">검증 게이트를 통과한 섹션이 없어요 — 아래 드롭 사유를 확인하세요.</p>
                )}
                <div className="sb-pipe-play__droplog">
                  <p className="sb-panel-label">드롭 로그 ({(prodResult.dropLog || []).length})</p>
                  {(prodResult.dropLog || []).length === 0 && <p className="sb-admin__muted">드롭 없음</p>}
                  <ul>
                    {(prodResult.dropLog || []).map((drop, dropIndex) => (
                      <li key={dropIndex}>
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">{drop.code}</span> {drop.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* 지식 소스 — KV 편집 */}
          <div className="sb-admin-card">
            <p className="sb-panel-label">지식 소스 (팀 데이터 v0 — 설정 KV)</p>
            <p className="sb-admin__muted">
              DB화 전의 수동 입력 자리예요. 시스템 자리표시자 지식은 프롬프트 캐시에 흡수되고, 가변부·게이트 값은 요청마다
              실려요. 편집은 새 생성부터 반영돼요 (서버 캐시 최대 30초).
            </p>
            {wire && (
              <ul className="sb-pipe-knowledge">
                {wire.knowledge.map((entry) => (
                  <li key={entry.id} className="sb-pipe-knowledge__row">
                    <div className="sb-pipe-knowledge__main">
                      <div className="sb-pipe-stage__title">
                        <b>{entry.label}</b>
                        <span className="sb-admin-prompt-chip">{INJECTION_LABEL[entry.injection] || entry.injection}</span>
                        {entry.placeholder && <code>{entry.placeholder}</code>}
                        {!entry.editable && <span className="sb-admin-prompt-chip">실데이터 파생</span>}
                        {entry.editable && entry.value && (
                          <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">값 있음</span>
                        )}
                      </div>
                      <p className="sb-pipe-stage__note">
                        {entry.editable ? (entry.value ? entry.value.split('\n')[0] : '비어 있음 — 지식 없이 생성돼요') : entry.note}
                      </p>
                    </div>
                    {entry.editable && (
                      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => openKnowledge(entry)}>
                        편집
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* 단계 레이어 모달 — 노드 클릭: 설명·최근 실행 + (LLM 단계) 시스템 프롬프트 열람·수정 */}
      {selected && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !promptSaving) setSelectedStage(null)
          }}
        >
          <section
            className={'sb-llm-dialog sb-admin-dialog' + (selected.promptId ? ' sb-admin-prompt-dialog' : ' sb-stage-dialog')}
            role="dialog"
            aria-modal="true"
            aria-label="파이프라인 단계 상세"
          >
            <div className="sb-admin-dialog__head">
              <h2 className="sb-stage-dialog__title">
                <span className="sb-pipe-stage__no">{selected.no}</span>
                {selected.label}
              </h2>
              <div className="sb-admin-dialog__actions">
                <button type="button" className="sb-icon-btn" aria-label="닫기" disabled={promptSaving} onClick={() => setSelectedStage(null)}>×</button>
              </div>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <div className="sb-stage-dialog__chips">
                <span className="sb-admin-prompt-chip">{KIND_LABEL[selected.kind] || selected.kind}</span>
                {selected.effort && <span className="sb-admin-prompt-chip">effort {selected.effort}</span>}
                {selected.status === 'planned' && <span className="sb-admin-prompt-chip">예정</span>}
                {(selected.promptCustom || selectedResult?.custom) && (
                  <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">프롬프트 재정의</span>
                )}
              </div>
              <p className="sb-pipe-stage__note">{selected.note}</p>
              {selectedResult?.meta && <p className="sb-admin__muted">최근 실행: {metaLine(selectedResult.meta)}</p>}
              {selectedResult?.pass != null && (
                <p className="sb-admin__muted">최근 게이트: 섹션 {selectedResult.pass}개 통과 · {selectedResult.drops}건 드롭</p>
              )}

              {selected.promptId && !stagePrompt && (
                <p className={promptsError ? 'sb-admin-gate__error' : 'sb-admin__muted'}>
                  {promptsError ? `프롬프트를 불러오지 못했어요: ${promptsError}` : '프롬프트를 불러오는 중…'}
                </p>
              )}
              {!selected.promptId && (
                <p className="sb-admin__muted">이 단계는 시스템 프롬프트가 없어요 — LLM 호출 없이 코드로 처리돼요.</p>
              )}

              {stagePrompt && (() => {
                const isDefaultText = promptText === stagePrompt.defaultText
                const saved = stagePrompt.configured ?? stagePrompt.defaultText
                const dirtyPrompt = promptText !== saved
                const missingCatalog = stagePrompt.id === 'plan-products' && !promptText.includes('{{CATALOG}}')
                return (
                  <>
                    <div className="sb-stage-dialog__prompt-head">
                      <b>시스템 프롬프트</b>
                      <code>{stagePrompt.id}</code>
                      {stagePrompt.configured ? (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                      ) : (
                        <span className="sb-admin-prompt-chip">기본값{prompts ? ` ${prompts.promptVersion}` : ''}</span>
                      )}
                    </div>
                    <p className="sb-admin__muted">{stagePrompt.note}</p>
                    <textarea
                      className="sb-admin-prompt-dialog__editor"
                      value={promptText}
                      spellCheck={false}
                      onChange={(event) => setPromptText(event.target.value)}
                    />
                    <div className="sb-admin-prompt-dialog__meta">
                      <span className="sb-admin__muted">{promptText.length.toLocaleString('ko-KR')}자</span>
                      {isDefaultText && <span className="sb-admin-prompt-chip">기본값과 동일 — 저장하면 기본값 추종으로 돌아가요</span>}
                      {!isDefaultText && stagePrompt.configured && !dirtyPrompt && (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">재정의 사용 중</span>
                      )}
                      {missingCatalog && (
                        <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">
                          {'{{CATALOG}}'} 자리표시자가 없어요 — 상품 카탈로그 목록이 프롬프트에서 빠져요
                        </span>
                      )}
                    </div>
                    <div className="sb-json-dialog__actions">
                      {stagePrompt.configured && (
                        <button
                          type="button"
                          className="sb-btn sb-btn--ghost"
                          disabled={promptSaving}
                          onClick={() => savePrompt(null)}
                        >
                          기본값으로 되돌리기
                        </button>
                      )}
                      {!isDefaultText && !stagePrompt.configured && (
                        <button
                          type="button"
                          className="sb-btn sb-btn--ghost"
                          disabled={promptSaving}
                          onClick={() => setPromptText(stagePrompt.defaultText)}
                        >
                          기본값 원문으로 채우기
                        </button>
                      )}
                      <button type="button" className="sb-btn sb-btn--ghost" disabled={promptSaving} onClick={() => setSelectedStage(null)}>닫기</button>
                      <button
                        type="button"
                        className="sb-btn sb-btn--primary"
                        disabled={!dirtyPrompt || promptSaving || !promptText.trim()}
                        onClick={() => savePrompt(promptText)}
                      >
                        {promptSaving ? '저장 중…' : '저장'}
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>
          </section>
        </div>
      )}

      {/* 지식 편집 다이얼로그 */}
      {knowledgeEdit && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !knowledgeSaving) setKnowledgeEdit(null)
          }}
        >
          <section
            className="sb-llm-dialog sb-admin-dialog sb-admin-prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="지식 소스 편집"
          >
            <div className="sb-admin-dialog__head">
              <h2>지식 소스 — {knowledgeEdit.label}</h2>
              <div className="sb-admin-dialog__actions">
                <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setKnowledgeEdit(null)}>×</button>
              </div>
            </div>
            <div className="sb-admin-prompt-dialog__body">
              <p className="sb-admin__muted">{knowledgeEdit.note}</p>
              <textarea
                className="sb-admin-prompt-dialog__editor"
                value={knowledgeText}
                spellCheck={false}
                placeholder="비워 두고 저장하면 설정이 지워져요 (지식 없음)"
                onChange={(event) => setKnowledgeText(event.target.value)}
              />
              <div className="sb-json-dialog__actions">
                {knowledgeEdit.value && (
                  <button type="button" className="sb-btn sb-btn--ghost" disabled={knowledgeSaving} onClick={() => saveKnowledge(null)}>
                    비우기 (지식 없음)
                  </button>
                )}
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setKnowledgeEdit(null)}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={knowledgeSaving || knowledgeText === (knowledgeEdit.value ?? '')}
                  onClick={() => saveKnowledge(knowledgeText)}
                >
                  {knowledgeSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
