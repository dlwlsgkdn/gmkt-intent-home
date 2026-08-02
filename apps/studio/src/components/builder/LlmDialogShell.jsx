import React from 'react'
import AiRoundTripNote from './AiRoundTripNote.jsx'

/*
 * AI 다이얼로그 공용 조각 — 여섯 다이얼로그(시나리오 만들기·조합 케이스·문구 다듬기·
 * 페이지 재구성·전체 반영·AiFixChooser)가 같은 셸을 쓴다.
 * 본문·푸터(sb-llm-dialog__foot)는 각 다이얼로그 책임으로 남긴다.
 */

/* 백드롭(빈 곳 클릭 닫기) + 다이얼로그 헤더 + 닫기 버튼.
   note를 주면 AiRoundTripNote로 감싸 머리말 배지를 단다. */
export default function LlmDialogShell({ titleId, className, label, title, description, note, onClose, children }) {
  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className={'sb-llm-dialog' + (className ? ` ${className}` : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">{label}</p>
            <h2 id={titleId}>{title}</h2>
            <p>{description}</p>
            {note && <AiRoundTripNote>{note}</AiRoundTripNote>}
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>
        {children}
      </section>
    </div>
  )
}

/* 진행 단계 breadcrumb — 번호 없는 단계 표시 (번호는 왕복 .sb-handoff 전용).
   steps: [{ label, state }] — state는 'active' | 'done' | null */
export function DialogSteps({ steps }) {
  return (
    <ol className="sb-steps" aria-label="진행 단계">
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          {index > 0 && <li className="sb-steps__sep" aria-hidden="true">›</li>}
          <li className={'sb-steps__item' + (step.state ? ` is-${step.state}` : '')}>{step.label}</li>
        </React.Fragment>
      ))}
    </ol>
  )
}

/* 배치 왕복 진행 바 — "배치 n / m" + 대상 요약 + 진행 미터 + 누적 상태 */
export function BatchBar({ index, count, caption, percent, status }) {
  return (
    <div className="sb-batch-bar">
      <div>
        <strong>배치 {index + 1} / {count}</strong>
        <small>{caption}</small>
      </div>
      <div className="sb-batch-bar__meter" aria-hidden="true">
        <i style={{ width: `${percent}%` }} />
      </div>
      <span>{status}</span>
    </div>
  )
}
