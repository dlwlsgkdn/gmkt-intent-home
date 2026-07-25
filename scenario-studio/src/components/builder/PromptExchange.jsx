import React from 'react'
import { copyToClipboard } from '../../lib/clipboard.js'

/*
 * AI 왕복 UI 한 벌 — "프롬프트 복사 → 쓰던 AI에 붙여넣기 → 결과 가져오기".
 * 스튜디오의 모든 AI 기능이 이 형태를 공유하므로(시나리오 생성·케이스 생성·피드백 반영)
 * 화면 구성과 문구를 여기 한 곳에서만 관리한다. 검증/적용은 각 다이얼로그의 책임.
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
  const copy = async () => {
    const ok = await copyToClipboard(prompt)
    if (onCopied) onCopied(ok)
  }

  return (
    <>
      <section className="sb-llm-section">
        <div className="sb-llm-section__head">
          <div>
            <span>STEP A</span>
            <strong>{title}</strong>
          </div>
          <button type="button" className="sb-btn sb-btn--primary" onClick={copy}>
            프롬프트 복사
          </button>
        </div>
        {hint && <p className="sb-llm-help">{hint}</p>}
        <details className="sb-llm-details">
          <summary>프롬프트 펼쳐보기 ({prompt.length.toLocaleString()}자)</summary>
          <textarea readOnly rows={12} value={prompt} aria-label="AI 프롬프트" />
        </details>
      </section>

      <section className="sb-llm-section">
        <div className="sb-llm-section__head">
          <div>
            <span>STEP B</span>
            <strong>결과 가져오기</strong>
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
                disabled={!String(answerText || '').trim()}
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
