import React from 'react'
import { SCORE_GUIDE } from './StarRating.jsx'

/* 별점 기준 안내 패널 — 툴바의 "별점 기준" 토글로 열린다 */
export default function Rubric({ onClose }) {
  return (
    <section className="sb-qa-rubric" aria-label="별점 기준">
      <div className="sb-qa-rubric__head">
        <h3>별점 기준</h3>
        <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="평가 기준 닫기">×</button>
      </div>
      <p className="sb-qa-rubric__howto">
        별 1~5를 눌러 점수를 매기고, 같은 별을 다시 누르면 별을 모두 끈 <b>0점(사용 불가)</b>이 됩니다.
        옆 배지는 상태 표시 — <b>미평가</b>(회색)·<b>0점</b>(빨강)이며, 누르면 미평가로 초기화돼요.
      </p>
      <div className="sb-qa-rubric__distinction">
        <strong>★5와 ★4의 차이</strong>
        <span><b>★5</b> 수정·추가 의견이 전혀 없음</span>
        <span><b>★4</b> 틀린 것은 없지만 더 좋은 대안·추가 아이디어가 있음</span>
      </div>
      <div className="sb-qa-rubric__grid">
        {SCORE_GUIDE.map((guide) => (
          <div key={guide.score} className={`sb-qa-rubric__row sb-qa-rubric__row--${guide.score}`}>
            <strong>{guide.score === 0 ? '0' : '★'.repeat(guide.score)}</strong>
            <div>
              <b>{guide.title}</b>
              <p>{guide.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
