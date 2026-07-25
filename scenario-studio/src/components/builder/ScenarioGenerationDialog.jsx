import React, { useMemo, useState } from 'react'
import {
  MAX_QUESTIONS,
  MAX_STEPS,
  MIN_QUESTIONS,
  MIN_STEPS,
  SCENARIO_RESPONSE_SCHEMA,
  assembleScenario,
  buildScenarioPrompt,
  buildScenarioRequest,
  validateScenarioResponse,
} from '../../lib/scenarioGeneration.js'
import { parseCatalogText } from '../../lib/caseGeneration.js'
import {
  isLikelyAnthropicKey,
  loadLlmApiKey,
  requestCaseGeneration,
  requestWebSearch,
  saveLlmApiKey,
} from '../../lib/llmClient.js'
import {
  DEFAULT_SEARCH_COUNT,
  buildProductSearchPrompt,
  mergeCatalogText,
  parseProductSearchResult,
} from '../../lib/productSearch.js'
import { copyToClipboard, wrapForChatApp } from '../../lib/chatPrompt.js'
import { buildScenarioDbPrompt, combinationCount, parseScenarioDbJson } from '../../lib/scenarioJsonPrompt.js'

const personaFromProfile = (profile) => {
  const name = profile?.name ? `${profile.name}.` : ''
  const traits = (profile?.items || []).map((item) => `${item.label}: ${item.value}`).join(', ')
  return [name, traits].filter(Boolean).join(' ')
}

const CATALOG_PLACEHOLDER = [
  '브랜드 | 상품명 | 가격 | 정가 | 특징',
  '예) 클리오 | 킬커버 픽서 쿠션 | 22,900 | 32,000 | 밀착력 좋은 픽서 타입으로 밀림 최소화',
].join('\n')

export default function ScenarioGenerationDialog({ profile, onCreate, onImport, onClose, onToast }) {
  const [query, setQuery] = useState('')
  const [persona, setPersona] = useState(() => personaFromProfile(profile))
  const [catalogText, setCatalogText] = useState('')
  const [questionCount, setQuestionCount] = useState(3)
  const [stepCount, setStepCount] = useState(3)
  const [notes, setNotes] = useState('')
  const [apiKey, setApiKey] = useState(loadLlmApiKey)
  const [manualMode, setManualMode] = useState(false)
  const [manualResponse, setManualResponse] = useState('')

  const [phase, setPhase] = useState('setup') // setup | running | review
  const [result, setResult] = useState(null) // { draft, warnings }
  const [errors, setErrors] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchNote, setSearchNote] = useState('')
  /* DB JSON 프롬프트 경로 상태 */
  const [optionCount, setOptionCount] = useState(3)
  const [importText, setImportText] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [importFileName, setImportFileName] = useState('')
  const importFileRef = React.useRef(null)

  const { entries: catalog, errors: catalogErrors } = useMemo(
    () => parseCatalogText(catalogText, []),
    [catalogText]
  )

  const request = useMemo(
    () => buildScenarioRequest({ persona, query, catalog, questionCount, stepCount, notes }),
    [persona, query, catalog, questionCount, stepCount, notes]
  )

  const updateApiKey = (value) => {
    setApiKey(value)
    saveLlmApiKey(value)
  }

  const problems = []
  if (!query.trim()) problems.push('검색어를 입력해주세요. 시나리오의 출발점이 됩니다.')
  catalogErrors.forEach((error) => problems.push(`카탈로그 ${error}`))

  const runGeneration = async () => {
    setPhase('running')
    setErrors([])
    try {
      const payload = await requestCaseGeneration({
        apiKey,
        prompt: buildScenarioPrompt(request),
        responseSchema: SCENARIO_RESPONSE_SCHEMA,
        effort: 'medium',
      })
      const validation = validateScenarioResponse(payload, request)
      if (!validation.draft) {
        setErrors(validation.errors)
        setPhase('setup')
        return
      }
      setResult(validation)
      setPhase('review')
    } catch (error) {
      setErrors([error.message])
      setPhase('setup')
    }
  }

  const searchProducts = async () => {
    setSearching(true)
    setSearchNote('')
    setErrors([])
    try {
      const text = await requestWebSearch({
        apiKey,
        prompt: buildProductSearchPrompt({ query, persona, notes, count: DEFAULT_SEARCH_COUNT }),
        maxSearches: DEFAULT_SEARCH_COUNT,
      })
      const rows = parseProductSearchResult(text)
      if (rows.length === 0) {
        setSearchNote('검색 결과에서 상품 줄을 찾지 못했어요. 검색어를 더 구체적으로 바꿔보세요.')
        return
      }
      const merged = mergeCatalogText(catalogText, rows)
      setCatalogText(merged.text)
      setSearchNote(
        `상품 ${merged.addedCount}개를 추가했어요`
        + (merged.skipped > 0 ? ` (중복 ${merged.skipped}개 제외)` : '')
        + '. 가격은 검색 시점 기준이라 정확하지 않을 수 있으니 확인 후 수정하세요.'
      )
    } catch (error) {
      setErrors([`상품 검색 실패: ${error.message}`])
    } finally {
      setSearching(false)
    }
  }

  const copyPrompt = async () => {
    const prompt = wrapForChatApp(buildScenarioPrompt(request), {
      json: true,
      pasteTarget: '아래 응답 붙여넣기 칸',
    })
    onToast(await copyToClipboard(prompt)
      ? 'Claude 앱용 시나리오 생성 프롬프트를 복사했어요.'
      : '복사하지 못했어요. 브라우저 권한을 확인해주세요.')
  }

  /* 웹 검색도 구독으로 돌릴 수 있게 — claude.ai에 붙여넣을 검색 프롬프트 */
  const copySearchPrompt = async () => {
    const prompt = wrapForChatApp(
      buildProductSearchPrompt({ query, persona, notes, count: DEFAULT_SEARCH_COUNT }),
      { json: false, webSearch: true, pasteTarget: '추천할 상품 입력란' }
    )
    onToast(await copyToClipboard(prompt)
      ? 'Claude 앱용 상품 검색 프롬프트를 복사했어요. 결과를 상품 입력란에 붙여넣으세요.'
      : '복사하지 못했어요. 브라우저 권한을 확인해주세요.')
  }

  const submitManual = () => {
    const validation = validateScenarioResponse(manualResponse, request)
    if (!validation.draft) {
      setErrors(validation.errors)
      return
    }
    setResult(validation)
    setErrors([])
    setPhase('review')
  }

  /* DB JSON을 통째로 만들어 달라는 프롬프트 — 레지스트리 기반이라 컴포넌트가 늘면 함께 갱신된다 */
  const dbPrompt = useMemo(
    () => buildScenarioDbPrompt({ query, persona, notes, catalogText, questionCount, optionCount, stepCount }),
    [query, persona, notes, catalogText, questionCount, optionCount, stepCount]
  )
  const totalCases = combinationCount(questionCount, optionCount)

  const copyDbPrompt = async () => {
    onToast(await copyToClipboard(dbPrompt)
      ? 'AI 프롬프트를 복사했어요. Claude 앱에 붙여넣고 결과 JSON을 받아오세요.'
      : '복사하지 못했어요. 프롬프트 칸에서 직접 복사해주세요.')
  }

  const verifyImport = (text = importText) => {
    const parsed = parseScenarioDbJson(text)
    setImportResult(parsed)
    if (parsed.errors.length > 0) onToast(`가져오기 검증에서 ${parsed.errors.length}개 문제를 찾았어요.`)
    return parsed
  }

  /* AI가 만들어준 .json 파일을 그대로 올리는 경로 — 케이스가 많으면 붙여넣기보다 편하다 */
  const handleImportFile = (event) => {
    const file = event.target.files && event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setImportFileName(file.name)
      setImportText(text)
      const parsed = verifyImport(text)
      if (parsed.errors.length === 0) {
        onToast(`${file.name}에서 시나리오 ${parsed.scenarios.length}개를 읽었어요.`)
      }
    }
    reader.onerror = () => onToast('파일을 읽지 못했어요.')
    reader.readAsText(file)
  }

  const runImport = () => {
    const parsed = importResult || parseScenarioDbJson(importText)
    if (parsed.errors.length > 0 || parsed.scenarios.length === 0) {
      setImportResult(parsed)
      return
    }
    onImport(parsed.scenarios)
    onClose()
  }

  const createScenario = () => {
    if (!result?.draft) return
    onCreate(assembleScenario({ draft: result.draft, catalog, query }))
    onClose()
  }

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && phase !== 'running') onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-sgen-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">PERSONA + QUERY + PRODUCTS → LLM → SCENARIO</p>
            <h2 id="sb-sgen-title">AI로 시나리오 만들기</h2>
            <p>검색어와 페르소나, 추천할 상품만 주면 설문 화면과 계획 화면을 한 번에 구성합니다.</p>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

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
                    disabled={searching || !query.trim()}
                    title={query.trim() ? '검색어에 맞는 실제 상품을 웹에서 찾아 카탈로그에 채웁니다 (API 크레딧 사용)' : '검색어를 먼저 입력해주세요'}
                    onClick={searchProducts}
                  >
                    {searching ? '검색 중…' : '✦ 웹에서 상품 찾기'}
                  </button>
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                    disabled={!query.trim()}
                    title="Claude 앱(Pro·Max 구독)에 붙여넣을 검색 프롬프트를 복사합니다"
                    onClick={copySearchPrompt}
                  >
                    Claude 앱용 프롬프트
                  </button>
                </div>
              </div>
              <label className="sb-gen-field">
                <span>
                  추천할 상품 <em>선택</em> — 한 줄에 하나. LLM은 이 목록에서 고르기만 하고 가격·사실을 만들지 않습니다.
                </span>
                <textarea
                  className="sb-gen-catalog"
                  rows={6}
                  value={catalogText}
                  placeholder={CATALOG_PLACEHOLDER}
                  spellCheck={false}
                  onChange={(event) => setCatalogText(event.target.value)}
                />
                <small>
                  {searchNote || (catalog.length > 0
                    ? `${catalog.length}개 상품 인식됨 — 각 계획 단계에 배치됩니다.`
                    : '비워두면 상품을 지어내지 않고, 각 단계에 "어떤 상품을 넣을 자리인지" 안내만 남깁니다. 위 버튼으로 웹에서 찾아올 수도 있어요.')}
                </small>
              </label>
              <div className="sb-gen-grid">
                <label className="sb-gen-field">
                  <span>설문 질문 수</span>
                  <select value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))}>
                    {Array.from({ length: MAX_QUESTIONS - MIN_QUESTIONS + 1 }, (_, index) => MIN_QUESTIONS + index).map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                  <small>질문 수가 많을수록 계획 조합이 기하급수로 늘어납니다.</small>
                </label>
                <label className="sb-gen-field">
                  <span>계획 단계 수</span>
                  <select value={stepCount} onChange={(event) => setStepCount(Number(event.target.value))}>
                    {Array.from({ length: MAX_STEPS - MIN_STEPS + 1 }, (_, index) => MIN_STEPS + index).map((count) => (
                      <option key={count} value={count}>{count}단계</option>
                    ))}
                  </select>
                  <small>단계마다 추천 상품 묶음이 하나씩 붙습니다.</small>
                </label>
              </div>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 3</span>
                  <strong>LLM 연결</strong>
                </div>
              </div>
              {apiKey.trim() && isLikelyAnthropicKey(apiKey) ? (
                <p className="sb-gen-keystate--ok">✓ 저장된 Anthropic API 키를 사용합니다.</p>
              ) : (
                <label className="sb-gen-field">
                  <span>내 Anthropic API 키</span>
                  <input
                    type="password"
                    className="sb-gen-input"
                    value={apiKey}
                    placeholder="sk-ant-…"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => updateApiKey(event.target.value)}
                  />
                  <small>이 브라우저에만 저장되고 Anthropic API로 직접 전송됩니다. 키가 없으면 아래 수동 모드를 사용하세요.</small>
                </label>
              )}
              <label className="sb-gen-skip">
                <input
                  type="checkbox"
                  checked={manualMode}
                  onChange={(event) => setManualMode(event.target.checked)}
                />
                Claude 앱으로 만들기 — API 키·크레딧 없이 Pro·Max 구독으로 진행
              </label>

              {manualMode && (
                <div className="sb-gen-manual">
                  <p className="sb-llm-help">
                    프롬프트를 복사해 <b>claude.ai</b>에 붙여넣고, 돌아온 JSON을 아래에 붙여넣으세요.
                    스키마와 출력 형식이 프롬프트에 함께 들어갑니다.
                  </p>
                  <button type="button" className="sb-btn" disabled={problems.length > 0} onClick={copyPrompt}>
                    Claude 앱용 프롬프트 복사
                  </button>
                  <textarea
                    className="sb-llm-response"
                    rows={6}
                    value={manualResponse}
                    placeholder={'LLM이 반환한 {"title":…,"survey":…,"plan":…} JSON을 붙여넣으세요.'}
                    onChange={(event) => setManualResponse(event.target.value)}
                  />
                </div>
              )}
            </section>

            {(problems.length > 0 || errors.length > 0) && (
              <div className="sb-llm-validation__errors sb-gen-problems">
                {problems.map((problem, index) => <p key={`p${index}`}>{problem}</p>)}
                {errors.map((error, index) => <p key={`e${index}`}>{error}</p>)}
              </div>
            )}

            <div className="sb-llm-dialog__foot">
              <p>생성 결과는 미리 확인한 뒤 시나리오로 만듭니다. 만든 뒤에는 빌더에서 자유롭게 수정할 수 있어요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
                <button
                  type="button"
                  className="sb-btn"
                  disabled={!query.trim()}
                  title="시나리오 DB JSON을 통째로 만들어 달라는 프롬프트를 생성합니다. 결과는 붙여넣어 가져옵니다."
                  onClick={() => setPhase('prompt')}
                >
                  ✦ AI 프롬프트 생성
                </button>
                {manualMode ? (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={problems.length > 0 || !manualResponse.trim()}
                    onClick={submitManual}
                  >
                    응답 검증
                  </button>
                ) : (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={problems.length > 0}
                    onClick={runGeneration}
                  >
                    시나리오 생성
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {phase === 'prompt' && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP A</span>
                  <strong>AI 프롬프트 복사</strong>
                </div>
                <button type="button" className="sb-btn sb-btn--primary" onClick={copyDbPrompt}>
                  프롬프트 복사
                </button>
              </div>
              <p className="sb-llm-help">
                시나리오 <b>DB JSON 전체</b>(설문 화면 + 계획 케이스들)를 만들어 달라는 프롬프트입니다.
                사용 가능한 컴포넌트 목록과 배치·조건 규칙이 함께 들어가고,
                <b> 설문 선택지의 모든 조합</b>에 대한 계획 케이스와 평가용 A/B/C 케이스 지정까지 요청합니다.
                계획 내용은 질문 하나당 단계 하나로 나누지 말고 <b>답변 전체와 페르소나를 함께 보고</b> 설계하도록,
                참고 콘텐츠(영상·게시글)는 <b>국내 기준으로 검색</b>해 붙이도록 지시합니다.
                Claude 앱에 붙여넣고 받은 <b>.json 파일</b>을 아래에서 올리세요.
              </p>
              <div className="sb-gen-grid">
                <label className="sb-gen-field">
                  <span>질문마다 만들 선택지 수</span>
                  <select value={optionCount} onChange={(event) => setOptionCount(Number(event.target.value))}>
                    {[2, 3, 4, 5].map((count) => (
                      <option key={count} value={count}>{count}개</option>
                    ))}
                  </select>
                </label>
                <div className="sb-gen-field">
                  <span>만들어질 계획 케이스</span>
                  <p className={'sb-gen-total' + (totalCases > 60 ? ' sb-gen-total--warn' : '')}>
                    질문 {questionCount}개 × 선택지 {optionCount}개 = <b>{totalCases.toLocaleString()}개</b> + 기본 1개
                  </p>
                  <small>
                    {totalCases > 60
                      ? '조합이 많아 한 번에 다 만들지 못할 수 있어요. 질문 수나 선택지 수를 줄이는 편이 안전합니다.'
                      : '설문에서 고를 수 있는 모든 조합에 케이스가 하나씩 생깁니다.'}
                  </small>
                </div>
              </div>
              <details className="sb-llm-details">
                <summary>프롬프트 펼쳐보기 ({dbPrompt.length.toLocaleString()}자)</summary>
                <textarea readOnly rows={12} value={dbPrompt} aria-label="AI 프롬프트" />
              </details>
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP B</span>
                  <strong>결과 가져오기</strong>
                </div>
                <div className="sb-gen-headbtns">
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    onClick={() => importFileRef.current && importFileRef.current.click()}
                  >
                    JSON 파일 올리기
                  </button>
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--tiny"
                    disabled={!importText.trim()}
                    onClick={() => verifyImport()}
                  >
                    검증
                  </button>
                </div>
              </div>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              {importFileName && (
                <p className="sb-llm-help">📄 <b>{importFileName}</b>을 읽었어요. 아래 내용을 확인하고 가져오세요.</p>
              )}
              <details className="sb-llm-details">
                <summary>파일 대신 직접 붙여넣기</summary>
                <textarea
                  rows={8}
                  value={importText}
                  placeholder={'AI가 만든 [{ "title": …, "stages": …, "planCases": … }] JSON을 붙여넣으세요.'}
                  aria-label="결과 JSON"
                  onChange={(event) => {
                    setImportText(event.target.value)
                    setImportResult(null)
                    setImportFileName('')
                  }}
                />
              </details>
              {importResult && (
                <div className="sb-llm-validation">
                  {importResult.errors.length > 0 && (
                    <div className="sb-llm-validation__errors">
                      <strong>가져올 수 없음</strong>
                      {importResult.errors.map((error, index) => <p key={index}>{error}</p>)}
                    </div>
                  )}
                  {importResult.warnings.slice(0, 8).map((warning, index) => (
                    <p key={index} className="sb-llm-warning">{warning}</p>
                  ))}
                  {importResult.errors.length === 0 && (
                    <div className="sb-llm-validation__ok">
                      <strong>✓ 시나리오 {importResult.scenarios.length}개를 가져올 수 있어요</strong>
                      <span>가져오면 홈 목록에 추가됩니다.</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="sb-llm-dialog__foot">
              <p>가져온 뒤에는 빌더에서 자유롭게 수정할 수 있고, 배치가 어긋나면 상단 "자동 정렬"로 정리하세요.</p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('setup')}>설정으로</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  disabled={!importText.trim() || (importResult ? importResult.errors.length > 0 : false)}
                  onClick={runImport}
                >
                  가져오기
                </button>
              </div>
            </div>
          </>
        )}

        {phase === 'running' && (
          <section className="sb-llm-section sb-gen-progress">
            <div className="sb-llm-section__head">
              <div>
                <span>GENERATING</span>
                <strong>시나리오를 구성하고 있어요</strong>
              </div>
            </div>
            <div className="sb-gen-progress__bar"><i className="sb-gen-progress__indeterminate" /></div>
            <p className="sb-llm-help">
              설문 질문과 계획 단계, 상품 배치를 한 번에 만듭니다. 보통 30초~1분 정도 걸려요.
            </p>
          </section>
        )}

        {phase === 'review' && result?.draft && (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>REVIEW</span>
                  <strong>{result.draft.title}</strong>
                </div>
                <span>질문 {result.draft.survey.questions.length}개 · 단계 {result.draft.plan.steps.length}개</span>
              </div>
              {result.warnings.slice(0, 6).map((warning, index) => (
                <p key={index} className="sb-llm-warning">{warning}</p>
              ))}

              <div className="sb-sgen-preview">
                <div className="sb-sgen-preview__col">
                  <h4>설문 화면</h4>
                  <p className="sb-sgen-preview__lead">{result.draft.survey.introTitle}</p>
                  {result.draft.survey.questions.map((entry, index) => (
                    <div key={index} className="sb-sgen-q">
                      <strong>{entry.question}</strong>
                      <div>{entry.options.map((option) => <span key={option}>{option}</span>)}</div>
                    </div>
                  ))}
                </div>
                <div className="sb-sgen-preview__col">
                  <h4>계획 화면</h4>
                  <p className="sb-sgen-preview__lead">{result.draft.plan.titleText}</p>
                  {result.draft.plan.steps.map((step, index) => (
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
                이어서 계획 탭의 <b>✦ 자동 생성</b>으로 설문 조합별 케이스를 늘릴 수 있어요.
              </p>
              <div>
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setPhase('setup')}>설정으로</button>
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
