import React from 'react'

/* 케이스 리더보드 — 로테이션으로 쌓인 평가를 평균 별점 순으로 보는 상시 사이드바.
   이 순위가 피드백 전체 반영의 씨앗 우선순위(상위 N개)로 그대로 쓰인다. */
export default function Leaderboard({ board, remaining, onOpenCase }) {
  return (
    <aside className="sb-qa-board" aria-label="케이스 리더보드">
      <div className="sb-qa-board__head">
        <h3>케이스 리더보드</h3>
      </div>
      <p className="sb-qa-board__note">
        평가한 케이스가 평균 별점 순으로 쌓여요. 미평가 <b>{remaining}개</b>는
        <b> 다음 3개 선정</b>으로 이어가고, 이 순위는 <b>피드백 전체 반영</b>의 씨앗 우선순위가 됩니다.
      </p>
      {board.length === 0 ? (
        <p className="sb-qa-board__empty">아직 평가한 케이스가 없어요. 말풍선에 별점·피드백을 남기면 여기에 쌓입니다.</p>
      ) : (
        <ol className="sb-qa-board__list">
          {board.map((entry) => (
            <li key={entry.caseId} className={entry.slot ? 'is-current' : ''}>
              <span className="sb-qa-board__rank">{entry.rank}</span>
              <div className="sb-qa-board__name">
                <b>{entry.planCase.name || '이름 없는 케이스'}</b>
                <small>
                  {entry.round ? `R${entry.round} · ` : ''}별점 {entry.ratedCount}개 · 피드백 {entry.feedbackCount}개
                </small>
              </div>
              <div className="sb-qa-board__meta">
                <strong className="sb-qa-board__avg">
                  {entry.average == null ? '—' : `★ ${entry.average.toFixed(1)}`}
                </strong>
                {entry.slot && <em className="sb-qa-board__slot">CASE {entry.slot}</em>}
                <button
                  type="button"
                  className="sb-btn sb-btn--tiny"
                  onClick={() => onOpenCase(entry.caseId)}
                >
                  열기
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
