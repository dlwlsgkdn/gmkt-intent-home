import React from 'react'

/* 평가 탭에서 "반영하러 가기"로 넘어온 문맥 표시 — 계획 편집기 상단에
   대상 컴포넌트의 피드백을 붙잡아 두고, 반영 완료 토글과 복귀 버튼을 제공한다 */
export default function FeedbackFocusBar({ label, review, onToggleResolved, onBack }) {
  return (
    <div className="sb-topbar__row sb-feedback-focus">
      <span className="sb-feedback-focus__badge">피드백 반영 중</span>
      <strong>{label}</strong>
      <p>{review.feedback || '작성된 수정사항 없이 결과를 확인 중입니다.'}</p>
      {review.score != null && <span className="sb-feedback-focus__score">{review.score}/5점</span>}
      <button
        type="button"
        className={review.resolved ? 'sb-btn sb-btn--compact-on' : 'sb-btn'}
        disabled={!review.feedback.trim()}
        onClick={onToggleResolved}
      >
        {review.resolved ? '✓ 반영 완료됨' : '반영 완료'}
      </button>
      <button type="button" className="sb-btn sb-btn--ghost" onClick={onBack}>
        평가로 돌아가기
      </button>
    </div>
  )
}
