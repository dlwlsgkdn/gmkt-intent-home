import React, { useMemo, useState } from 'react'
import {
  buildCaseRevisionPrompt,
  buildCaseRevisionRequest,
  collectCaseFeedback,
  countRemovedRecords,
  mergeRevisedCase,
  validateCaseRevisionResponse,
} from '../../lib/prompt/caseRevision.js'
import { normalizeCaseEvaluation } from '../../lib/evaluation.js'
import { catalogFromScenario } from '../../lib/prompt/planCases.js'
import { wrapForChatApp } from '../../lib/prompt/chatPrompt.js'
import PromptExchange from './PromptExchange.jsx'
import AiRoundTripNote from './AiRoundTripNote.jsx'

const personaFromProfile = (profile) => {
  const name = profile?.name ? `${profile.name}.` : ''
  const traits = (profile?.items || []).map((item) => `${item.label}: ${item.value}`).join(', ')
  return [name, traits].filter(Boolean).join(' ')
}

/*
 * 케이스 통째 재생성 다이얼로그.
 *
 * 필드 수정(LlmRevisionDialog)과 달리 부분 선택이 없다 — 레이아웃은 통짜라
 * 전부 적용하거나 전부 버린다(되돌리기는 ⌘Z). 대신 적용 전에 diff 요약과
 * "삭제되는 컴포넌트의 평가 기록 N건" 경고를 반드시 보여준다.
 */
export default function CaseRevisionDialog({ scenario, planCase, planCases, profile, onApply, onClose, onToast }) {
  const [notes, setNotes] = useState('')
  const [answerText, setAnswerText] = useState('')
  const [validation, setValidation] = useState(null)

  const feedbacks = useMemo(() => collectCaseFeedback(planCase), [planCase])
  /* 케이스 헤더(평가 탭)에 기록된 전체 코멘트 — 요청에 자동 포함되고 여기서도 보여준다 */
  const caseNote = useMemo(() => {
    const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
    return { score: evaluation.score, feedback: evaluation.feedback.trim() }
  }, [planCase])
  const catalog = useMemo(() => catalogFromScenario(planCases || []), [planCases])
  const persona = useMemo(() => personaFromProfile(profile), [profile])

  const request = useMemo(
    () => buildCaseRevisionRequest({ scenario, planCase, persona, notes, catalog }),
    [scenario, planCase, persona, notes, catalog]
  )
  const prompt = useMemo(
    () => wrapForChatApp(buildCaseRevisionPrompt(request), { json: true, pasteTarget: '결과 가져오기' }),
    [request]
  )

  const verify = () => {
    const result = validateCaseRevisionResponse(answerText, request, {
      originalItems: planCase.items || [],
      catalog,
    })
    setValidation(result)
    if (result.errors.length > 0) onToast(`검증에서 ${result.errors.length}개 문제를 찾았어요.`)
    else onToast('재구성안을 확인했어요. 아래 변경 요약을 검토하고 적용하세요.')
  }

  const removedRecords = validation?.diff ? countRemovedRecords(planCase, validation.diff) : 0

  const apply = () => {
    if (!validation?.items) return
    const merged = mergeRevisedCase(planCase, validation)
    onApply(merged.planCase)
    onToast(
      `"${planCase.name}" 케이스를 다시 구성했어요 (추가 ${validation.diff.added.length} · 삭제 ${validation.diff.removed.length} · 수정 ${validation.diff.changedCount}). ⌘Z로 되돌릴 수 있어요.`
    )
    onClose()
  }

  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog sb-gen-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-crev-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">피드백 → 프롬프트 → 내 AI → 케이스 재구성</p>
            <h2 id="sb-crev-title">페이지 재구성</h2>
            <p>
              <b>{planCase.name}</b> 케이스의 페이지 전체를 AI가 다시 구성합니다 —
              컴포넌트 추가·삭제·순서 변경까지. 문구 한두 곳만 고칠 거라면 "문구 다듬기"가 더 안전해요.
            </p>
            <AiRoundTripNote>
결과는 <b>통째로 적용</b>돼요(⌘Z로 복구). 조건·우선순위는 바뀌지 않습니다.
            </AiRoundTripNote>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <section className="sb-llm-section">
          <div className="sb-llm-section__head">
            <div>
              <span>요청에 담길 피드백</span>
              <strong>
                {caseNote.feedback ? '케이스 코멘트 + ' : ''}컴포넌트 피드백 {feedbacks.length}개 + 추가 지시
              </strong>
            </div>
          </div>
          {(caseNote.feedback || feedbacks.length > 0) ? (
            <ul className="sb-crev-feedback">
              {caseNote.feedback && (
                <li className="sb-crev-feedback__case">
                  <b>케이스 전체</b>
                  <span>{caseNote.feedback}</span>
                  {caseNote.score != null && <em>{caseNote.score}/5점</em>}
                </li>
              )}
              {feedbacks.map((entry) => (
                <li key={entry.itemId}>
                  <b>{entry.type}</b>
                  <span>{entry.feedback}</span>
                  {entry.score != null && <em>{entry.score}/5점</em>}
                  {entry.resolved && <em>반영 완료됨</em>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sb-llm-help">평가 탭에 적힌 피드백이 없어요. 평가 탭의 케이스 코멘트나 아래 추가 지시로 요청할 수 있어요.</p>
          )}
          <label className="sb-gen-field">
            <span>추가 지시 <em>선택</em> — 평가 피드백 외에 더 바꾸고 싶은 것</span>
            <textarea
              rows={3}
              value={notes}
              placeholder={'예: 단계마다 참고 영상을 하나씩 붙여줘 / CTA 바는 빼줘 / 상품은 2개씩만'}
              onChange={(event) => {
                setNotes(event.target.value)
                setValidation(null)
              }}
            />
          </label>
        </section>

        <PromptExchange
          title="케이스 재구성 프롬프트"
          hint="페이지 구성 전체와 피드백이 들어가요. 유지되는 컴포넌트의 가격·이미지·링크는 원본이 보존됩니다."
          prompt={prompt}
          onCopied={(ok) => onToast(ok
            ? '재구성 프롬프트를 복사했어요. 쓰던 AI에 붙여넣고 결과를 가져오세요.'
            : '복사하지 못했어요. 프롬프트를 펼쳐 직접 복사해주세요.')}
          answerText={answerText}
          answerPlaceholder={'AI가 반환한 {"summary":"...","items":[...]} JSON을 붙여넣으세요.'}
          onAnswerChange={(value) => {
            setAnswerText(value)
            setValidation(null)
          }}
          onVerify={verify}
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
            {validation.items && (
              <div className="sb-crev-diff">
                <div className="sb-crev-diff__counts">
                  <b>컴포넌트 {(planCase.items || []).length}개 → {validation.diff.total}개</b>
                  <span className="sb-crev-diff__add">추가 {validation.diff.added.length}</span>
                  <span className="sb-crev-diff__del">삭제 {validation.diff.removed.length}</span>
                  <span>수정 {validation.diff.changedCount}</span>
                  <span>유지 {validation.diff.keptCount}</span>
                </div>
                {validation.diff.added.length > 0 && (
                  <p>+ {validation.diff.added.map((entry) => entry.label).join(', ')}</p>
                )}
                {validation.diff.removed.length > 0 && (
                  <p>− {validation.diff.removed.map((entry) => entry.label).join(', ')}</p>
                )}
                {removedRecords > 0 && (
                  <p className="sb-crev-diff__warn">
                    ⚠ 삭제되는 컴포넌트에 평가 기록 {removedRecords}건이 있어요 — 적용하면 함께 사라집니다.
                  </p>
                )}
              </div>
            )}
            {validation.summary && <p className="sb-llm-summary">{validation.summary}</p>}
          </div>
        )}

        <div className="sb-llm-dialog__foot">
          <p>적용하면 이 케이스의 페이지가 통째로 교체됩니다. 배치가 어긋나면 상단 "자동 정렬"로 정리하세요.</p>
          <div>
            <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
            <button
              type="button"
              className="sb-btn sb-btn--primary"
              disabled={!validation?.items}
              onClick={apply}
            >
              이 구성으로 교체
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
