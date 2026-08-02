import React, { useEffect, useMemo, useState } from 'react'
import {
  buildLlmRevisionPrompt,
  buildLlmRevisionRequest,
  validateLlmRevisionResponse,
} from '../../lib/prompt/revision.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import PromptExchange from './PromptExchange.jsx'
import LlmDialogShell, { DialogSteps } from './LlmDialogShell.jsx'

const revisionKey = (revision) =>
  [revision.caseId, revision.criterionKey, revision.itemId, revision.fieldKey].join(':')

export default function LlmRevisionDialog({
  planCases,
  onApply,
  onClose,
  onToast,
  onSwitchToRevise,
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
    <LlmDialogShell
      titleId="sb-llm-title"
      label="피드백 → 프롬프트 → 내 AI → 필드 단위 적용"
      title="문구 다듬기"
      description="구성은 그대로 두고 문구·표현만 고칩니다. 허용된 컴포넌트 필드만 검토 후 골라서 적용해요."
      note={<>받은 수정안은 <b>허용된 필드인지 검증한 뒤 하나씩 골라</b> 적용해요.</>}
      onClose={onClose}
    >
      {request.feedbackCount > 0 && (
        <DialogSteps steps={[
          { label: '피드백 확인', state: validation ? 'done' : 'active' },
          { label: '프롬프트 왕복', state: validation ? 'done' : null },
          { label: '수정안 적용', state: validation?.revisions.length ? 'active' : null },
        ]} />
      )}

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
          {onSwitchToRevise && (
            <button type="button" className="sb-btn sb-btn--ai" onClick={onSwitchToRevise}>
              ⇄ 피드백 없이 페이지 재구성하기
            </button>
          )}
        </div>
      ) : (
        <>
          <PromptExchange
            title="수정 요청 프롬프트"
            hint="실제 필드 값과 수정 가능한 ID가 함께 들어가요."
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
                validation.revisions.length > 0 ? (
                  <div className="sb-llm-validation__ok">
                    <strong>✓ 스키마와 허용 필드 검증 완료</strong>
                    <span>{validation.revisions.length}개 수정안을 검토할 수 있어요.</span>
                  </div>
                ) : (
                  /* 적용할 게 없을 때가 오히려 설명이 필요하다 — 왜 못 고치는지는 summary에 있다 */
                  <div className="sb-llm-validation__ok sb-llm-validation__ok--empty">
                    <strong>적용할 수정안이 없어요</strong>
                    <span>AI가 이번 피드백은 문구 수정으로 해결할 수 없다고 판단했어요.</span>
                    {onSwitchToRevise && (
                      <button type="button" className="sb-btn sb-btn--ai sb-btn--small" onClick={onSwitchToRevise}>
                        ⇄ 페이지 재구성으로 이어가기
                      </button>
                    )}
                  </div>
                )
              )}
              {/* summary는 수정안 개수와 무관하게 보여준다 — 0개일 때 유일한 설명이다 */}
              {validation.summary && <p className="sb-llm-summary">{validation.summary}</p>}
            </div>
          )}

          {validation?.errors.length === 0 && validation.revisions.length > 0 && (
            <section className="sb-llm-section">
              <div className="sb-llm-section__head">
                <div>
                  <span>4단계 · 다시 스튜디오에서</span>
                  <strong>수정안 선택 적용</strong>
                </div>
                <span>{selectedKeys.size}/{validation.revisions.length}개 선택</span>
              </div>
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
    </LlmDialogShell>
  )
}
