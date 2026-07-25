import React, { useEffect, useMemo, useState } from 'react'
import {
  LLM_REVISION_PROXY_STORAGE_KEY,
  LLM_REVISION_RESPONSE_SCHEMA,
  buildLlmRevisionPrompt,
  buildLlmRevisionRequest,
  isSafeRevisionProxyUrl,
  validateLlmRevisionResponse,
} from '../../lib/llmRevision.js'

const revisionKey = (revision) =>
  [revision.caseId, revision.criterionKey, revision.itemId, revision.fieldKey].join(':')

const loadProxyUrl = () => {
  try {
    return window.localStorage.getItem(LLM_REVISION_PROXY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export default function LlmRevisionDialog({
  planCases,
  onApply,
  onClose,
  onToast,
}) {
  const [includeResolved, setIncludeResolved] = useState(false)
  const [proxyUrl, setProxyUrl] = useState(loadProxyUrl)
  const [responseText, setResponseText] = useState('')
  const [validation, setValidation] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const [requesting, setRequesting] = useState(false)
  const request = useMemo(
    () => buildLlmRevisionRequest(planCases, { includeResolved }),
    [planCases, includeResolved]
  )
  const prompt = useMemo(() => buildLlmRevisionPrompt(request), [request])
  const safeProxy = isSafeRevisionProxyUrl(proxyUrl)

  useEffect(() => {
    setResponseText('')
    setValidation(null)
    setSelectedKeys(new Set())
  }, [includeResolved])

  useEffect(() => {
    if (!validation) return
    setSelectedKeys(new Set(validation.revisions.map(revisionKey)))
  }, [validation])

  const copyPrompt = async () => {
    try {
      await copyText(prompt)
      onToast('피드백과 출력 스키마를 포함한 LLM 수정 요청을 복사했어요.')
    } catch {
      onToast('복사하지 못했어요. 프롬프트 펼치기에서 직접 복사해주세요.')
    }
  }

  const validateResponse = (value = responseText) => {
    const result = validateLlmRevisionResponse(value, request)
    setValidation(result)
    if (result.errors.length > 0) {
      onToast(`수정안 검증에서 ${result.errors.length}개 문제를 찾았어요.`)
    } else {
      onToast(`적용 가능한 수정안 ${result.revisions.length}개를 확인했어요.`)
    }
  }

  const callProxy = async () => {
    if (!safeProxy || request.feedbackCount === 0) return
    setRequesting(true)
    try {
      window.localStorage.setItem(LLM_REVISION_PROXY_STORAGE_KEY, proxyUrl.trim())
      const response = await fetch(proxyUrl.trim(), {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'revise_scenario_from_feedback',
          prompt,
          input: request,
          responseSchema: LLM_REVISION_RESPONSE_SCHEMA,
        }),
      })
      const rawText = await response.text()
      if (!response.ok) {
        throw new Error(rawText.slice(0, 180) || `HTTP ${response.status}`)
      }
      let raw = rawText
      try {
        raw = JSON.parse(rawText)
      } catch {
        // 텍스트 응답도 아래 공통 검증기가 JSON 블록을 추출한다.
      }
      setResponseText(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))
      validateResponse(raw)
    } catch (error) {
      setValidation({
        summary: '',
        revisions: [],
        errors: [`프록시 요청 실패: ${error.message}`],
        warnings: [],
      })
    } finally {
      setRequesting(false)
    }
  }

  const toggleRevision = (key) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const applySelected = () => {
    const revisions = (validation?.revisions || []).filter((revision) =>
      selectedKeys.has(revisionKey(revision))
    )
    if (revisions.length === 0) return
    onApply(revisions)
    onClose()
  }

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-llm-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">FEEDBACK → LLM → SAFE PATCH</p>
            <h2 id="sb-llm-title">LLM에게 시나리오 수정 요청</h2>
            <p>피드백을 구조화해 보내고, 허용된 컴포넌트 필드만 검토 후 선택 적용합니다.</p>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="sb-llm-flow" aria-label="LLM 수정 흐름">
          <span><b>1</b> 요청 만들기</span>
          <i>→</i>
          <span><b>2</b> JSON 응답 검증</span>
          <i>→</i>
          <span><b>3</b> 선택 적용</span>
        </div>

        <div className="sb-llm-scope">
          <div>
            <strong>{request.feedbackCount}개 피드백을 요청에 포함</strong>
            <small>평가 CASE {request.cases.length}개 · 가격/URL/레이아웃 변경 제외</small>
          </div>
          <label>
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(event) => setIncludeResolved(event.target.checked)}
            />
            반영 완료 피드백도 포함
          </label>
        </div>

        {request.feedbackCount === 0 ? (
          <div className="sb-llm-empty">
            <strong>요청할 피드백이 없습니다.</strong>
            <p>평가 항목의 수정사항을 작성하거나, 완료된 피드백까지 포함해주세요.</p>
          </div>
        ) : (
          <>
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 1</span>
                  <strong>요청 전달</strong>
                </div>
                <button type="button" className="sb-btn sb-btn--primary" onClick={copyPrompt}>
                  LLM 수정 요청 복사
                </button>
              </div>
              <p className="sb-llm-help">
                복사한 내용을 사용하는 LLM에 붙여넣고 JSON 응답을 받아오세요. 프롬프트에는 실제 필드 값과
                수정 가능한 ID가 함께 들어갑니다.
              </p>
              <details className="sb-llm-details">
                <summary>전송할 프롬프트 펼치기</summary>
                <textarea readOnly rows={9} value={prompt} aria-label="LLM 수정 요청 프롬프트" />
              </details>

              <div className="sb-llm-proxy">
                <div>
                  <strong>보안 프록시로 바로 요청 <em>선택</em></strong>
                  <small>API 키는 브라우저에 저장하지 않습니다. 서버에서 키를 보관하는 HTTPS 엔드포인트만 입력하세요.</small>
                </div>
                <input
                  type="url"
                  value={proxyUrl}
                  placeholder="https://your-domain.example/api/revise-scenario"
                  onChange={(event) => setProxyUrl(event.target.value)}
                  aria-label="LLM 보안 프록시 URL"
                />
                <button
                  type="button"
                  className="sb-btn"
                  disabled={!safeProxy || requesting}
                  onClick={callProxy}
                >
                  {requesting ? '요청 중…' : '프록시로 요청'}
                </button>
              </div>
              {proxyUrl && !safeProxy && (
                <p className="sb-llm-error">HTTPS URL만 사용할 수 있습니다. 로컬 개발은 localhost HTTP를 허용합니다.</p>
              )}
            </section>

            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>STEP 2</span>
                  <strong>LLM JSON 응답 검증</strong>
                </div>
                <button
                  type="button"
                  className="sb-btn"
                  disabled={!responseText.trim()}
                  onClick={() => validateResponse()}
                >
                  응답 검증
                </button>
              </div>
              <textarea
                className="sb-llm-response"
                rows={8}
                value={responseText}
                placeholder={'LLM이 반환한 {"summary":"...","revisions":[...]} JSON을 붙여넣으세요.'}
                onChange={(event) => {
                  setResponseText(event.target.value)
                  setValidation(null)
                }}
                aria-label="LLM JSON 응답"
              />

              {validation && (
                <div className="sb-llm-validation">
                  {validation.errors.length > 0 && (
                    <div className="sb-llm-validation__errors">
                      <strong>적용 차단</strong>
                      {validation.errors.map((error, index) => <p key={index}>{error}</p>)}
                    </div>
                  )}
                  {validation.warnings.map((warning, index) => (
                    <p key={index} className="sb-llm-warning">{warning}</p>
                  ))}
                  {validation.errors.length === 0 && (
                    <div className="sb-llm-validation__ok">
                      <strong>✓ 스키마와 허용 필드 검증 완료</strong>
                      <span>{validation.revisions.length}개 수정안을 검토할 수 있어요.</span>
                    </div>
                  )}
                </div>
              )}
            </section>

            {validation?.errors.length === 0 && validation.revisions.length > 0 && (
              <section className="sb-llm-section">
                <div className="sb-llm-section__head">
                  <div>
                    <span>STEP 3</span>
                    <strong>수정안 선택 적용</strong>
                  </div>
                  <span>{selectedKeys.size}/{validation.revisions.length}개 선택</span>
                </div>
                {validation.summary && <p className="sb-llm-summary">{validation.summary}</p>}
                <div className="sb-llm-revisions">
                  {validation.revisions.map((revision) => {
                    const key = revisionKey(revision)
                    return (
                      <label key={key} className="sb-llm-revision">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleRevision(key)}
                        />
                        <div>
                          <strong>{revision.fieldLabel}</strong>
                          <small>{revision.criterionKey} · {revision.itemType}</small>
                          <p><del>{revision.before || '(비어 있음)'}</del></p>
                          <p><ins>{revision.after || '(비우기)'}</ins></p>
                          {revision.reason && <em>{revision.reason}</em>}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}

        <div className="sb-llm-dialog__foot">
          <p>적용 후에도 피드백은 완료 처리되지 않습니다. 실제 화면을 확인한 뒤 직접 완료 표시하세요.</p>
          <div>
            <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
            <button
              type="button"
              className="sb-btn sb-btn--primary"
              disabled={
                !validation
                || validation.errors.length > 0
                || selectedKeys.size === 0
              }
              onClick={applySelected}
            >
              선택한 수정안 적용
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
