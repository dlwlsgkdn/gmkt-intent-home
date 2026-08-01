import React from 'react'

/* 별점 기준 — 별점 UI와 기준 안내(Rubric)가 같은 문구를 공유한다 */
export const SCORE_GUIDE = [
  { score: 5, title: '완벽 · 그대로 사용', desc: '수정하거나 추가할 의견이 전혀 없습니다.' },
  { score: 4, title: '충분히 좋음 · 더 나은 대안 있음', desc: '오류는 없지만 추가 아이디어나 더 좋은 대안이 있습니다.' },
  { score: 3, title: '방향은 맞음 · 일부 수정 필요', desc: '중요한 정보가 부족하거나 일부 내용을 수정해야 합니다.' },
  { score: 2, title: '핵심 오류·누락', desc: '일부는 맞지만 상당한 수정이 필요합니다.' },
  { score: 1, title: '거의 다시 작성', desc: '대부분 부정확하거나 적절하지 않습니다.' },
  { score: 0, title: '사용 불가', desc: '결과가 없거나 완전히 잘못되었습니다.' },
]

/* 별점 — 데이터는 기존 0~5 그대로. 별 1~5를 누르면 점수, 같은 별을 다시 누르면
   별을 다 끈 0점(사용 불가)이 된다. 빈 별만으로는 "0점"과 "아직 평가 안 함"이
   구분되지 않으므로, 옆 배지가 그 상태를 말한다: 미평가(회색) / 0점(빨강).
   배지를 누르면 언제든 미평가로 초기화된다. */
export default function StarRating({ value, onChange, label }) {
  return (
    <div
      className={'sb-stars' + (value == null ? ' is-unrated' : '')}
      role="radiogroup"
      aria-label={`${label} 별점`}
    >
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          className={'sb-star' + (value != null && value >= score ? ' is-on' : '')}
          aria-label={`${score}점`}
          aria-pressed={value === score}
          title={value === score
            ? '다시 누르면 별을 모두 끈 0점(사용 불가)이 돼요'
            : SCORE_GUIDE.find((guide) => guide.score === score)?.title}
          onClick={() => onChange(value === score ? 0 : score)}
        >
          ★
        </button>
      ))}
      <button
        type="button"
        className={
          'sb-star-state'
          + (value == null ? ' is-unrated' : '')
          + (value === 0 ? ' is-zero' : '')
        }
        aria-pressed={value == null}
        title={value == null
          ? '아직 평가하지 않은 상태예요'
          : '누르면 미평가로 초기화돼요'}
        onClick={() => onChange(null)}
      >
        {value === 0 ? '0점' : '미평가'}
      </button>
    </div>
  )
}
