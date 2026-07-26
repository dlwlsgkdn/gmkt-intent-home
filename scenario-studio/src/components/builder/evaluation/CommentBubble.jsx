import React from 'react'
import StarRating from './StarRating.jsx'

/* 주석(annotation) 말풍선 하나 — 별점 + 피드백 코멘트.
   위치(top)는 EvaluationPanel의 layoutBubbles가 실제 렌더 높이로 잡아 준다. */
export default function CommentBubble({
  bubbleRef,
  active,
  review,
  icon,
  label,
  isCase = false,
  onActivate,
  onScore,
  onFeedback,
  onEdit,
  onResolve,
}) {
  const warn = review.score === 5 && review.feedback.trim()
  return (
    <div
      ref={bubbleRef}
      className={
        'sb-bubble'
        + (active ? ' is-active' : '')
        + (isCase ? ' sb-bubble--case' : '')
        + (review.resolved ? ' is-resolved' : '')
      }
      onClick={onActivate}
    >
      <div className="sb-bubble__head">
        <span className="sb-bubble__label">{icon} {label}</span>
        <StarRating value={review.score} label={label} onChange={onScore} />
      </div>
      <textarea
        rows={2}
        value={review.feedback}
        placeholder={isCase
          ? '케이스 전체 피드백 — 예: 참고 영상 붙여줘, CTA 빼줘'
          : '피드백 — 오류·누락·더 좋은 대안'}
        onChange={(event) => onFeedback(event.target.value)}
        onClick={(event) => event.stopPropagation()}
      />
      {warn && <p className="sb-bubble__warn">★5는 수정 의견이 없는 결과예요 — 피드백을 비우거나 별점을 낮춰주세요.</p>}
      {!isCase && (
        <div className="sb-bubble__foot">
          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }}>수정하러 가기</button>
          <button
            type="button"
            disabled={!review.feedback.trim()}
            className={review.resolved ? 'is-on' : ''}
            onClick={(event) => { event.stopPropagation(); onResolve() }}
          >
            {review.resolved ? '반영 해제' : '반영 완료'}
          </button>
        </div>
      )}
    </div>
  )
}
