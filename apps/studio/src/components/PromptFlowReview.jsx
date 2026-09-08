import React from 'react'

export default function PromptFlowReview({ review, warnings = [] }) {
  const cards = [
    { key: 'good', icon: '✓', title: '좋은 점', empty: '수정안에서 뚜렷한 장점은 찾지 못했어요.' },
    { key: 'bad', icon: '−', title: '아쉬운 점', empty: '수정안에서 뚜렷한 아쉬움은 찾지 못했어요.' },
    { key: 'risks', icon: '!', title: '주의할 점', empty: '특별한 문제는 찾지 못했지만, 옆 화면에서도 확인해 주세요.' },
  ]
  return <section className="sb-flow-review" aria-label="AI가 살펴본 수정안">
    <div className="sb-flow-review__head"><h3>좋은 점과 아쉬운 점도 살펴봤어요</h3><p>AI가 수정안을 보고 예상한 내용이에요. 실제로 더 좋아졌는지는 옆 화면에서 확인해 주세요.</p></div>
    <div className="sb-flow-review__cards">{cards.map((card) => {
      const notes = [...(review?.[card.key] || []), ...(card.key === 'risks' ? warnings : [])]
      return <div key={card.key} className={`sb-flow-review__card is-${card.key}`}><h4><span aria-hidden="true">{card.icon}</span>{card.title}</h4>{notes.length ? <ul>{[...new Set(notes)].map((note) => <li key={note}>{note}</li>)}</ul> : <p>{review ? card.empty : '다시 수정하면 이 부분도 함께 살펴볼게요.'}</p>}</div>
    })}</div>
  </section>
}
