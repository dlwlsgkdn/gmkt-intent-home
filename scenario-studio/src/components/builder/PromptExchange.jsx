import React, { useEffect, useState } from 'react'
import { copyToClipboard } from '../../lib/clipboard.js'

/*
 * AI 왕복 UI 한 벌 — "프롬프트 복사 → 쓰던 AI에 붙여넣기 → 결과 가져오기".
 *
 * 이 화면이 풀어야 하는 오해는 하나다: 버튼을 누르면 여기서 결과가 나올 것 같다는 것.
 * 그래서 세 박자를 항상 펼쳐 보여 주고, 가운데 박자(내 AI)는 점선·다른 배경으로
 * "스튜디오 밖에서 일어나는 일"임을 시각적으로 분리한다.
 * 복사 버튼은 누른 뒤 다음 할 일("이제 AI에 붙여넣으세요")로 라벨이 바뀌어 시선을 넘긴다.
 *
 * 검증과 적용은 각 다이얼로그의 책임이고, 여기는 주고받는 절차만 담당한다.
 */
export default function PromptExchange({
  title,
  hint,
  prompt,
  onCopied,
  answerText,
  answerFileName = '',
  answerPlaceholder,
  onAnswerChange,
  onPickFile,
  onVerify,
  rows = 8,
}) {
  const [copied, setCopied] = useState(false)

  /* 프롬프트가 바뀌면(조건 수정·다음 배치) 복사 상태를 되돌린다 */
  useEffect(() => { setCopied(false) }, [prompt])

  const copy = async () => {
    const ok = await copyToClipboard(prompt)
    setCopied(ok)
    if (onCopied) onCopied(ok)
  }

  const hasAnswer = !!String(answerText || '').trim()
  const stage = hasAnswer ? 3 : copied ? 2 : 1

  return (
    <>
      <ol className="sb-handoff" aria-label="AI 왕복 진행 방법">
        <li className={'sb-handoff__step' + (stage === 1 ? ' is-now' : stage > 1 ? ' is-done' : '')}>
          <b>1</b>
          <span>프롬프트 복사</span>
          <small>스튜디오가 만들어 드려요</small>
        </li>
        <li className="sb-handoff__arrow" aria-hidden="true">→</li>
        <li className={'sb-handoff__step sb-handoff__step--away' + (stage === 2 ? ' is-now' : stage > 2 ? ' is-done' : '')}>
          <b>2</b>
          <span>쓰던 AI에 붙여넣기</span>
          <small>ChatGPT · Claude · Gemini 등</small>
        </li>
        <li className="sb-handoff__arrow" aria-hidden="true">→</li>
        <li className={'sb-handoff__step' + (stage === 3 ? ' is-now' : '')}>
          <b>3</b>
          <span>결과 가져오기</span>
          <small>받은 내용을 아래에 붙여넣기</small>
        </li>
      </ol>

      <section className="sb-llm-section">
        <div className="sb-llm-section__head">
          <div>
            <span>STEP 1 · 스튜디오에서</span>
            <strong>{title}</strong>
          </div>
          <button
            type="button"
            className={'sb-btn sb-btn--primary sb-copy-btn' + (copied ? ' is-copied' : '')}
            onClick={copy}
          >
            {copied ? '✓ 복사됨 — 이제 AI에 붙여넣으세요' : '프롬프트 복사'}
          </button>
        </div>
        {hint && <p className="sb-llm-help">{hint}</p>}
        <details className="sb-llm-details">
          <summary>프롬프트 펼쳐보기 ({prompt.length.toLocaleString()}자)</summary>
          <textarea readOnly rows={12} value={prompt} aria-label="AI 프롬프트" />
        </details>
      </section>

      {/* 가운데 박자 — 스튜디오 밖에서 사람이 해야 하는 일 */}
      <div className={'sb-away-step' + (stage === 2 ? ' is-now' : '')}>
        <span className="sb-away-step__mark" aria-hidden="true">⇄</span>
        <div>
          <strong>STEP 2 · 스튜디오 밖에서</strong>
          <p>복사한 프롬프트를 <b>평소 쓰는 AI 채팅</b>에 붙여넣고 답변을 받아오세요. 이 창은 그대로 기다립니다.</p>
        </div>
      </div>

      <section className="sb-llm-section">
        <div className="sb-llm-section__head">
          <div>
            <span>STEP 3 · 다시 스튜디오에서</span>
            <strong>AI가 준 결과 가져오기</strong>
          </div>
          <div className="sb-gen-headbtns">
            {onPickFile && (
              <button type="button" className="sb-btn" onClick={onPickFile}>
                JSON 파일 올리기
              </button>
            )}
            {onVerify && (
              <button
                type="button"
                className="sb-btn sb-btn--ghost sb-btn--tiny"
                disabled={!hasAnswer}
                onClick={onVerify}
              >
                검증
              </button>
            )}
          </div>
        </div>
        {answerFileName && (
          <p className="sb-llm-help">📄 <b>{answerFileName}</b>을(를) 읽었어요. 아래 내용을 확인하고 진행하세요.</p>
        )}
        <textarea
          className="sb-llm-response"
          rows={rows}
          value={answerText}
          placeholder={answerPlaceholder}
          aria-label="AI 응답"
          spellCheck={false}
          onChange={(event) => onAnswerChange(event.target.value)}
        />
      </section>
    </>
  )
}
