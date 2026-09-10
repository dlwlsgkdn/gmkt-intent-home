import React from 'react'

export default function PromptFlowReview({ review, warnings = [] }) {
  const cards = [
    { key: 'good', icon: '✓', title: '좋은 점', empty: '뚜렷한 장점은 아직 없어요.' },
    { key: 'bad', icon: '−', title: '아쉬운 점', empty: '큰 아쉬움은 찾지 못했어요.' },
    { key: 'risks', icon: '!', title: '주의할 점', empty: '특별한 주의점은 없어요.' },
  ]
  const hasScore = Number.isFinite(review?.score)
  const parts = review?.scoreParts
  return <section className="sb-flow-review" aria-label="AI가 살펴본 수정안">
    <div className="sb-flow-review__score">
      <div><h3>AI 수정안 점수</h3><p>수정안을 읽고 매긴 점수예요. 실제 고객 결과 점수는 아니에요.</p></div>
      <strong aria-label={hasScore ? `AI 수정안 ${review.score}점, 100점 만점` : '아직 점수 없음'}>{hasScore ? review.score : '—'}<small> / 100점</small></strong>
    </div>
    {parts && <details className="sb-flow-review__criteria"><summary>점수 기준 보기</summary><p>요청 반영 {parts.request}/40 · 쉬운 설명 {parts.clarity}/30 · 앞뒤 일관성 {parts.consistency}/30</p></details>}
    {!hasScore && <p className="sb-flow-review__legacy">다시 수정하면 점수도 함께 보여드려요.</p>}
    <div className="sb-flow-review__cards">{cards.map((card) => {
      const notes = [...new Set([...(review?.[card.key] || []), ...(card.key === 'risks' ? warnings : [])])]
      return <div key={card.key} className={`sb-flow-review__card is-${card.key}`}><h4><span aria-hidden="true">{card.icon}</span>{card.title}</h4><p>{notes[0] || (review ? card.empty : '아직 살펴보기 전이에요.')}</p>{notes.length > 1 && <details><summary>더 보기 ({notes.length - 1})</summary>{notes.slice(1).map((note) => <p key={note}>{note}</p>)}</details>}</div>
    })}</div>
  </section>
}
