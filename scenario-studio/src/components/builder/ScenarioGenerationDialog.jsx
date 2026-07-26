import React, { useMemo, useRef, useState } from 'react'
import {
  MAX_QUESTIONS,
  MAX_STEPS,
  MIN_QUESTIONS,
  MIN_STEPS,
  assembleScenario,
  buildScenarioPrompt,
  buildScenarioRequest,
  validateScenarioResponse,
} from '../../lib/prompt/scenarioDraft.js'
import { parseCatalogText } from '../../lib/prompt/planCases.js'
import {
  DEFAULT_SEARCH_COUNT,
  buildProductSearchPrompt,
  mergeCatalogText,
  parseProductSearchResult,
} from '../../lib/prompt/productSearch.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import { buildScenarioDbPrompt, combinationCount, parseScenarioDbJson } from '../../lib/prompt/scenarioDb.js'
import { copyToClipboard } from '../../lib/clipboard.js'
import PromptExchange from './PromptExchange.jsx'
import AiRoundTripNote from './AiRoundTripNote.jsx'

const personaFromProfile = (profile) => {
  const name = profile?.name ? `${profile.name}.` : ''
  const traits = (profile?.items || []).map((item) => `${item.label}: ${item.value}`).join(', ')
  return [name, traits].filter(Boolean).join(' ')
}

const CATALOG_PLACEHOLDER = [
  '브랜드 | 상품명 | 가격 | 정가 | 특징',
  '예) 클리오 | 킬커버 픽서 쿠션 | 22,900 | 32,000 | 밀착력 좋은 픽서 타입으로 밀림 최소화',
].join('\n')

/* 만드는 방식 두 가지 — 스캐폴드 고정(초안) vs LLM 자유 구성(전체) */
const MODES = [
  {
    key: 'draft',
    label: '빠른 초안',
    tagline: '설문 + 기본 계획 1개',
    desc: '레이아웃은 스튜디오가 고정하고 AI는 문구와 상품 배치만 채웁니다. 응답이 짧아 실패가 적고, 만든 뒤 계획 탭에서 조합별 케이스를 늘릴 수 있어요.',
  },
  {
    key: 'full',
    label: '전체 구성',
    tagline: '모든 조합 케이스 + 평가 A/B/C',
    desc: '컴포넌트 선택과 배치까지 AI가 자유롭게 구성합니다. 설문 조합마다 계획 케이스가 하나씩 생기고, 결과는 .json 파일로 받아 올립니다.',
  },
]

export default function ScenarioGenerationDialog({ profile, onCreate, onImport, onClose, onToast }) {
  const [query, setQuery] = useState('')
  const [persona, setPersona] = useState(() => personaFromProfile(profile))
  const [catalogText, setCatalogText] = useState('')
  const [questionCount, setQuestionCount] = useState(3)
  const [optionCount, setOptionCount] = useState(3)
  const [stepCount, setStepCount] = useState(3)
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState('full')

  const [phase, setPhase] = useState('setup') // setup | prompt | review
  const [errors, setErrors] = useState([])
  const [searchNote, setSearchNote] = useState('')

  /* 결과 가져오기 상태 — 두 방식이 같은 입력칸(붙여넣기·파일)을 공유한다 */
  const [answerText, setAnswerText] = useState('')
  const [answerFileName, setAnswerFileName] = useState('')
  const [importResult, setImportResult] = useState(null) // 전체 구성 검증 결과
  const [draftResult, setDraftResult] = useState(null) // 빠른 초안 검증 결과
  const answerFileRef = useRef(null)

  const { entries: catalog, errors: catalogErrors } = useMemo(
    () => parseCatalogText(catalogText, []),
    [catalogText]
  )

  const draftRequest = useMemo(
    () => buildScenarioRequest({ persona, query, catalog, questionCount, stepCount, notes }),
    [persona, query, catalog, questionCount, stepCount, notes]
  )

  const prompt = useMemo(() => (
    mode === 'draft'
      ? wrapForChatApp(buildScenarioPrompt(draftRequest), { json: true, pasteTarget: '결과 가져오기' })
      : buildScenarioDbPrompt({ query, persona, notes, catalogText, questionCount, optionCount, stepCount })
  ), [mode, draftRequest, query, persona, notes, catalogText, questionCount, optionCount, stepCount])

  const totalCases = combinationCount(questionCount, optionCount)

  const problems = []
  if (!query.trim()) problems.push('검색어를 입력해주세요. 시나리오의 출발점이 됩니다.')
  catalogErrors.forEach((error) => problems.push(`카탈로그 ${error}`))

  const resetAnswer = () => {
    setAnswerText('')
    setAnswerFileName('')
    setImportResult(null)
    setDraftResult(null)
    setErrors([])
  }

  const goPrompt = () => {
    resetAnswer()
    setPhase('prompt')
  }

  /* 상품 찾기 — 웹 검색이 가능한 AI에 붙여넣을 프롬프트를 복사하고, 돌아온 줄을 카탈로그에 병합 */
  const copySearchPrompt = async () => {
    const searchPrompt = wrapForChatApp(
      buildProductSearchPrompt({ query, persona, notes, count: DEFAULT_SEARCH_COUNT }),
      { json: false, webSearch: true, pasteTarget: '추천할 상품 입력란' }
    )
    onToast(await copyToClipboard(searchPrompt)
      ? '상품 찾기 프롬프트를 복사했어요. AI 결과를 아래 상품 입력란에 그대로 붙여넣으면 정리됩니다.'
      : '복사하지 못했어요. 브라우저 권한을 확인해주세요.')
  }

  /* 붙여넣은 검색 결과를 상품 줄로 정리해 카탈로그에 병합 (표·번호·설명 문장 제거) */
  const tidyCatalog = () => {
    const rows = parseProductSearchResult(catalogText)
    if (rows.length === 0) {
      setSearchNote('상품 줄을 찾지 못했어요. "브랜드 | 상품명 | 가격 | 정가 | 특징" 형식인지 확인해주세요.')
      return
    }
    const merged = mergeCatalogText('', rows)
    setCatalogText(merged.text)
    setSearchNote(
      `상품 ${merged.addedCount}개로 정리했어요`
      + (merged.skipped > 0 ? ` (중복 ${merged.skipped}개 제외)` : '')
      + '. 가격은 검색 시점 기준이라 정확하지 않을 수 있으니 확인 후 수정하세요.'
    )
  }

  const verifyAnswer = (text = answerText) => {
    setErrors([])
    if (mode === 'draft') {
      const validation = validateScenarioResponse(text, draftRequest)
      setDraftResult(validation)
      if (!validation.draft) {
        setErrors(validation.errors)
        return null
      }
      setPhase('review')
      return validation
    }
    const parsed = parseScenarioDbJson(text)
    setImportResult(parsed)
    if (parsed.errors.length > 0) onToast(`가져오기 검증에서 ${parsed.errors.length}개 문제를 찾았어요.`)
    return parsed
  }

  /* AI가 만들어준 .json 파일을 그대로 올리는 경로 — 케이스가 많으면 붙여넣기보다 편하다 */
  const handleAnswerFile = (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setAnswerFileName(file.name)
      setAnswerText(text)
      const parsed = verifyAnswer(text)
      if (parsed && !parsed.errors?.length) {
        onToast(`${file.name}을(를) 읽었어요.`)
      }
    }
    reader.onerror = () => onToast('파일을 읽지 못했어요.')
    reader.readAsText(file)
  }

  const runImport = () => {
    const parsed = importResult || parseScenarioDbJson(answerText)
    if (parsed.errors.length > 0 || parsed.scenarios.length === 0) {
      setImportResult(parsed)
      return
    }
    onImport(parsed.scenarios)
    onClose()
  }

  const createScenario = () => {
    if (!draftResult?.draft) return
    onCreate(assembleScenario({ draft: draftResult.draft, catalog, query }))
    onClose()
  }

  const activeMode = MODES.find((entry) => entry.key === mode) || MODES[0]

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-sgen-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">조건 입력 → 프롬프트 → 내 AI → 결과 가져오기</p>
            <h2 id="sb-sgen-title">AI로 시나리오 만들기</h2>
            <p>검색어와 페르소나, 추천할 상품을 적으면 프롬프트를 만들어 드려요.</p>
            <AiRoundTripNote>
              조건을 채우면 <b>프롬프트</b>가 나오고, 그걸 쓰던 AI에 붙여넣어 받은 결과를 여기로 가져오면 시나리오가 만들어집니다.
            </AiRoundTripNote>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <ol className="sb-steps" aria-label="진행 단계">
          <li className={'sb-steps__item' + (phase === 'setup' ? ' is-active' : ' is-done')}>조건 입력</li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item'
            + (phase === 'prompt' ? ' is-active' : (phase === 'review' ? ' is-done' : ''))}>
            프롬프트 왕복
          </li>
          <li className="sb-steps__sep" aria-hidden="true">›</li>
          <li className={'sb-steps__item' + (phase === 'review' ? ' is-active' : '')}>확인 · 만들기</li>
        </ol>

        {phase === 'setup' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 1</span>
                  <strong>검색어 · 페르소나</strong>
                </div>
              </div>
              <label className="sb-gen-field">
                <span>검색어 — 사용자가 홈에서 검색할 문장</span>
                <input
                  type="text"
                  className="sb-gen-input"
                  value={query}
                  placeholder="예: 소개팅 때 안 무너지는 메이크업 추천"
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
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
                    placeholder="예: 존댓말 유지, 이모지 사용 금지, 예산 5만원 이하 중심 …"
                  />
                </label>
              </div>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 2</span>
                  <strong>추천 상품 · 구성</strong>
                </div>
                <div className="sb-gen-headbtns">
                  <button
                    type="button"
                    className="sb-btn sb-btn--search"
                    disabled={!query.trim()}
                    title={query.trim() ? '웹 검색이 가능한 AI에 붙여넣을 상품 찾기 프롬프트를 복사합니다' : '검색어를 먼저 입력해주세요'}
                    onClick={copySearchPrompt}
                  >
                    ✦ 상품 찾기 프롬프트
                  </button>
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                    disabled={!catalogText.trim()}
                    title="붙여넣은 검색 결과에서 표·번호·설명 문장을 걷어내고 상품 줄만 남깁니다"
                    onClick={tidyCatalog}
                  >
                    결과 정리
                  </button>
                </div>
              </div>
              <label className="sb-gen-field">
                <span>
                  추천할 상품 <em>선택</em> — 한 줄에 하나. AI는 이 목록에서 고르기만 하고 가격·사실을 만들지 않습니다.
                </span>
                <textarea
                  className="sb-gen-catalog"
                  rows={6}
                  value={catalogText}
                  placeholder={CATALOG_PLACEHOLDER}
                  spellCheck={false}
                  onChange={(event) => {
                    setCatalogText(event.target.value)
                    setSearchNote('')
                  }}
                />
                <small>
                  {searchNote || (catalog.length > 0
                    ? `${catalog.length}개 상품 인식됨 — 각 계획 단계에 배치됩니다.`
                    : '비워두면 AI가 국내에서 실제 판매되는 상품을 직접 조사해 채웁니다. 위 버튼으로 먼저 찾아올 수도 있어요.')}
                </small>
              </label>
              <div className="sb-gen-grid sb-gen-grid--three">
                <label className="sb-gen-field">
                  <span>설문 질문 수</span>
                  <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
                    {Array.from({ length: MAX_QUESTIONS - MIN_QUESTIONS + 1 }, (_, index) => MIN_QUESTIONS + index).map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                </label>
                <label className="sb-gen-field">
                  <span>질문당 선택지 수</span>
                  <select value={optionCount} onChange={(event) => setOptionCount(Number(event.target.value))}>
                    {[2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                </label>
                <label className="sb-gen-field">
                  <span>계획 단계 수</span>
                  <select value={stepCount} onChange={(event) => setStepCount(Number(event.target.value))}>
                    {Array.from({ length: MAX_STEPS - MIN_STEPS + 1 }, (_, index) => MIN_STEPS + index).map((count) => (
                      <option key={count} value={count}>{count}단계</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 3</span>
                  <strong>만드는 방식</strong>
                </div>
              </div>
              <div className="sb-mode-grid" role="radiogroup" aria-label="만드는 방식">
                {MODES.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    role="radio"
                    aria-checked={mode === entry.key}
                    className={'sb-mode-card' + (mode === entry.key ? ' is-selected' : '')}
                    onClick={() => setMode(entry.key)}
                  >
                    <span className="sb-mode-card__head">
                      <strong>{entry.label}</strong>
                      <em>{entry.tagline}</em>
                    </span>
                    <small>{entry.desc}</small>
                  </button>
                ))}
              </div>
              {mode === 'full' && (
                <p className={'sb-gen-total' + (totalCases > 60 ? ' sb-gen-total--warn' : '')}>
                  질문 {questionCount}개 × 선택지 {optionCount}개 = <b>{totalCases.toLocaleString()}개</b> 케이스 + 기본 1개
                  <small>
                    {totalCases > 60
                      ? ' — 조합이 많아 AI가 한 번에 다 만들지 못할 수 있어요. 질문 수나 선택지 수를 줄이는 편이 안전합니다.'
                      : ' — 설문에서 고를 수 있는 모든 조합에 케이스가 하나씩 생깁니다.'}
                  </small>
                </p>
              )}
            </section>

            {(problems.length > 0 || errors.length > 0) && (
              <div className="sb-llm-validation__errors sb-gen-problems">
                {problems.map((problem, index) => <p key={`p${index}`}>{problem}</p>)}
                {errors.map((error, index) => <p key={`e${index}`}>{error}</p>)}
              </div>
            )}

            <div className="sb-llm-dialog__foot">
              <p>다음 단계에서 프롬프트가 만들어집니다. 그걸 쓰던 AI에 붙여넣고 결과를 가져오면 완성이에요 — API 키는 필요 없습니다.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={problems.length > 0}
                  onClick={goPrompt}
                >
                  프롬프트 만들기
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'prompt' && (
          <>
            <PromptExchange
              title={`${activeMode.label} 프롬프트`}
              hint={mode === 'draft'
                ? '설문 화면과 기본 계획 하나를 채우는 프롬프트입니다. 응답 JSON을 그대로 아래에 붙여넣으세요.'
                : '시나리오 DB JSON 전체(설문 화면 + 모든 조합의 계획 케이스 + 평가 A/B/C)를 만들어 달라는 프롬프트입니다. 컴포넌트 목록과 배치·조건 규칙이 함께 들어가고, 결과는 ddak-scenario.json 파일로 받게 되어 있어요.'}
              prompt={prompt}
              onCopied={(ok) => onToast(ok
                ? '프롬프트를 복사했어요. 쓰던 AI에 붙여넣고 결과를 가져오세요.'
                : '복사하지 못했어요. 프롬프트를 펼쳐 직접 복사해주세요.')}
              answerText={answerText}
              answerFileName={answerFileName}
              answerPlaceholder={mode === 'draft'
                ? 'AI가 반환한 {"title":…,"survey":…,"plan":…} JSON을 붙여넣으세요.'
                : 'AI가 만든 [{ "title": …, "stages": …, "planCases": … }] JSON을 붙여넣으세요.'}
              onAnswerChange={(value) => {
                setAnswerText(value)
                setImportResult(null)
                setDraftResult(null)
                setAnswerFileName('')
              }}
              onPickFile={() => answerFileRef.current && answerFileRef.current.click()}
              onVerify={() => verifyAnswer()}
            />
            <input
              ref={answerFileRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="hidden"
              onChange={handleAnswerFile}
            />

            {(errors.length > 0 || importResult) && (
              <div className="sb-llm-validation">
                {errors.length > 0 && (
                  <div className="sb-llm-validation__errors">
                    <strong>가져올 수 없음</strong>
                    {errors.map((error, index) => <p key={index}>{error}</p>)}
                  </div>
                )}
                {importResult?.errors.length > 0 && (
                  <div className="sb-llm-validation__errors">
                    <strong>가져올 수 없음</strong>
                    {importResult.errors.map((error, index) => <p key={index}>{error}</p>)}
                  </div>
                )}
                {(importResult?.warnings || []).slice(0, 8).map((warning, index) => (
                  <p key={index} className="sb-llm-warning">{warning}</p>
                ))}
                {importResult && importResult.errors.length === 0 && (
                  <div className="sb-llm-validation__ok">
                    <strong>✓ 시나리오 {importResult.scenarios.length}개를 가져올 수 있어요</strong>
                    <span>가져오면 홈 목록에 추가됩니다.</span>
                  </div>
                )}
              </div>
            )}

            <div className="sb-llm-dialog__foot">
              <p>가져온 뒤에는 빌더에서 자유롭게 수정할 수 있고, 배치가 어긋나면 상단 "자동 정렬"로 정리하세요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('setup')}>조건 수정</button>
                {mode === 'draft' ? (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={!answerText.trim()}
                    onClick={() => verifyAnswer()}
                  >
                    응답 검증
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={!answerText.trim() || (importResult ? importResult.errors.length > 0 : false)}
                    onClick={runImport}
                  >
                    가져오기
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {phase === 'review' && draftResult?.draft && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>REVIEW</span>
                  <strong>{draftResult.draft.title}</strong>
                </div>
                <span>질문 {draftResult.draft.survey.questions.length}개 · 단계 {draftResult.draft.plan.steps.length}개</span>
              </div>
              {draftResult.warnings.slice(0, 6).map((warning, index) => (
                <p key={index} className="sb-llm-warning">{warning}</p>
              ))}

              <div className="sb-sgen-preview">
                <div className="sb-sgen-preview__col">
                  <h4>설문 화면</h4>
                  <p className="sb-sgen-preview__lead">{draftResult.draft.survey.introTitle}</p>
                  {draftResult.draft.survey.questions.map((entry, index) => (
                    <div key={index} className="sb-sgen-q">
                      <strong>{entry.question}</strong>
                      <div>{entry.options.map((option) => <span key={option}>{option}</span>)}</div>
                    </div>
                  ))}
                </div>
                <div className="sb-sgen-preview__col">
                  <h4>계획 화면</h4>
                  <p className="sb-sgen-preview__lead">{draftResult.draft.plan.titleText}</p>
                  {draftResult.draft.plan.steps.map((step, index) => (
                    <div key={index} className="sb-sgen-step">
                      <strong>{index + 1}. {step.title}</strong>
                      <p>{step.desc}</p>
                      <em>
                        {step.products.length > 0
                          ? step.products
                            .map((pick) => catalog.find((entry) => entry.id === pick.catalogId)?.name)
                            .filter(Boolean)
                            .join(' · ')
                          : (step.productHint ? `상품 자리 — ${step.productHint}` : '배치된 상품 없음')}
                      </em>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="sb-llm-dialog__foot">
              <p>
                만들면 설문 화면과 "기본 계획" 케이스가 채워진 채로 빌더가 열립니다.
                이어서 계획 탭의 <b>✦ 케이스 만들기</b>로 설문 조합별 케이스를 늘릴 수 있어요.
              </p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('prompt')}>결과 다시</button>
                <button type="button" className="sb-btn sb-btn--primary" onClick={createScenario}>
                  이 시나리오 만들기
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
