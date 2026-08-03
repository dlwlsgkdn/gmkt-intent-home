import React from 'react'

/*
 * 기본 시나리오 패널 — 워크스페이스 전역 라이브러리의 전용 관리 화면 (상태 없는 표현 컴포넌트).
 *
 * 지정은 드로어의 시나리오 행("기본 지정")에서 하고, 여기서는 목록 확인과 해제("내리기")만
 * 한다. 항목은 지정 시점의 사본이라 원본 편집·삭제와 무관하고, 새 프로필을 만들 때
 * 가져올지 확인을 거쳐 복사 설치된다.
 */
export default function StarterPanel({ entries, onRemove, onClose }) {
  const dateLabel = (iso) => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return `${date.getMonth() + 1}월 ${date.getDate()}일 지정`
  }

  return (
    <div
      className="sb-llm-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="sb-llm-dialog sb-starter-panel" role="dialog" aria-modal="true" aria-labelledby="sb-starter-title">
        <div className="sb-starter-panel__body">
          <div className="sb-starter-panel__head">
            <h2 id="sb-starter-title" className="sb-starter-panel__title">기본 시나리오</h2>
            <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
          </div>
          <p className="sb-starter-panel__note">
            모든 프로필이 공유하는 목록이에요. 새 프로필을 만들 때 가져올지 물어보고 복사해 설치해요.
            항목은 지정한 시점의 사본이라, 이후 원본을 편집하거나 지워도 바뀌지 않아요.
          </p>

          {entries.length === 0 ? (
            <div className="sb-starter-panel__empty">
              아직 올린 기본 시나리오가 없어요.<br />
              <span>시나리오 목록에서 "기본 지정"을 누르면 여기에 올라와요.</span>
            </div>
          ) : (
            <div className="sb-starter-panel__list">
              {entries.map((entry) => (
                <div key={entry.id} className="sb-starter-row">
                  <div className="sb-starter-row__info">
                    <p className="sb-starter-row__title">{entry.title}</p>
                    <p className="sb-starter-row__meta">
                      <span style={{ color: entry.color || '#5f7465' }}>#{entry.chip}</span>
                      {' · '}{entry.sourceAccountName} 프로필에서
                      {entry.at ? ` ${dateLabel(entry.at)}` : ' 지정'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="sb-danger"
                    title="기본 시나리오 목록에서 내려요. 이미 만든 프로필에는 영향이 없어요."
                    onClick={() => {
                      if (window.confirm(`"${entry.title}"을(를) 기본 시나리오에서 내릴까요?`)) onRemove(entry.id)
                    }}
                  >
                    내리기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
