import React, { useEffect, useMemo, useState } from 'react'
import {
  buildLlmRevisionPrompt,
  buildLlmRevisionRequest,
  validateLlmRevisionResponse,
} from '../../lib/prompt/revision.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import PromptExchange from './PromptExchange.jsx'

const revisionKey = (revision) =>
  [revision.caseId, revision.criterionKey, revision.itemId, revision.fieldKey].join(':')

export default function LlmRevisionDialog({
  planCases,
  onApply,
  onClose,
  onToast,
}) {
  const [includeResolved, setIncludeResolved] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [validation, setValidation] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(new Set())
  const request = useMemo(
    () => buildLlmRevisionRequest(planCases, { includeResolved }),
    [planCases, includeResolved]
  )
  const prompt = useMemo(
    () => wrapForChatApp(buildLlmRevisionPrompt(request), { json: true, pasteTarget: '결과 가져오기' }),
    [request]
  )

  useEffect(() => {
    setResponseText('')
    setValidation(null)
    setSelectedKeys(new Set())
  }, [includeResolved])

  useEffect(() => {
    if (!validation) return
    setSelectedKeys(new Set(validation.revisions.map(revisionKey)))
  }, [validation])

  const validateResponse = () => {
    const result = validateLlmRevisionResponse(responseText, request)
    setValidation(result)
    if (result.errors.length > 0) {
      onToast(`수정안 검증에서 ${result.errors.length}개 문제를 찾았어요.`)
    } else {
      onToast(`적용 가능한 수정안 ${result.revisions.length}개를 확인했어요.`)
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
            <p className="sb-panel-label">피드백 → 내 AI → 안전한 부분 수정</p>
            <h2 id="sb-llm-title">AI에게 시나리오 수정 요청</h2>
            <p>피드백을 구조화해 프롬프트로 만들고, 허용된 컴포넌트 필드만 검토 후 선택 적용합니다.</p>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
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
            <PromptExchange
              title="수정 요청 프롬프트"
              hint="실제 필드 값과 수정 가능한 ID가 함께 들어갑니다. 쓰던 AI에 붙여넣고 돌아온 JSON을 아래에 붙여넣으세요."
              prompt={prompt}
              onCopied={(ok) => onToast(ok
                ? '피드백과 출력 스키마를 포함한 수정 요청을 복사했어요.'
                : '복사하지 못했어요. 프롬프트를 펼쳐 직접 복사해주세요.')}
              answerText={responseText}
              answerPlaceholder={'AI가 반환한 {"summary":"...","revisions":[...]} JSON을 붙여넣으세요.'}
              onAnswerChange={(value) => {
                setResponseText(value)
                setValidation(null)
              }}
              onVerify={validateResponse}
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

            {validation?.errors.length === 0 && validation.revisions.length > 0 && (
              <section className="sb-llm-section">
                <div className="sb-llm-section__head">
                  <div>
                    <span>STEP C</span>
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
