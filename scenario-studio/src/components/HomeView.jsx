import React, { useState } from 'react'
import { BgBlobs, FloatingBar, StudioFab } from './Frame.jsx'

export default function HomeView({ api }) {
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const published = api.scenarios.filter((s) => s.status === 'published')

  const submit = (e) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const hit = published.find(
      (s) => s.title.includes(q) || s.chip.includes(q) || (s.query && s.query.includes(q)) || q.includes(s.chip)
    )
    if (hit) {
      api.playScenario(hit.id)
    } else {
      api.showToast('일치하는 시나리오가 없어요. 스튜디오에서 새로 만들어보세요!')
    }
  }

  return (
    <>
      <BgBlobs />
      <FloatingBar
        active="home"
        onHome={() => setDrawerOpen(false)}
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={() => setDrawerOpen((v) => !v)}
      />
      <StudioFab onClick={() => setDrawerOpen(true)} />

      <section className="clean-home min-h-screen relative z-10">
        <div className="clean-home__wrap">
          <div className="beauty-search-stage">
            <div className="beauty-greeting">
              <span>유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?</span>
            </div>

            <form className="clean-search group" onSubmit={submit}>
              <div className="clean-search__box">
                <textarea
                  rows={1}
                  placeholder="예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업"
                  className="resize-none overflow-hidden"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submit(e)
                    }
                  }}
                />
                <button
                  type="submit"
                  id="submitBtn"
                  className="top-1/2 -translate-y-1/2 bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="검색"
                  disabled={!query.trim()}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </button>
              </div>
            </form>

            <div className="clean-tag-row" aria-label="발행된 시나리오">
              {published.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="suggestion-tag sb-chip-scenario"
                  title={s.title}
                  onClick={() => api.playScenario(s.id)}
                >
                  <span className="sb-chip-scenario__spark">✦</span>#{s.chip}
                </button>
              ))}
            </div>
          </div>

          <section className="beauty-webzine" aria-label="뷰티 카테고리 콘텐츠">
            <article className="beauty-story beauty-story--feature">
              <span className="beauty-story__media">
                <img src="./makeup-clone-assets/d9b261330f3ffccf.avif" alt="피부 표현을 위한 베이스 메이크업 제품 이미지" />
              </span>
              <div className="beauty-story__body">
                <span>Base Notes</span>
                <h2>속광은 남기고 유분만 덜어내는 베이스</h2>
                <p>최근 쓰레드에서 반복된 키워드: 무너짐, 들뜸, 얇은 커버.</p>
              </div>
            </article>
            <article className="beauty-story">
              <span className="beauty-story__media">
                <img src="./makeup-clone-assets/8e01e19fb7cf7c96.avif" alt="로즈 무드 메이크업 제품 이미지" />
              </span>
              <div className="beauty-story__body">
                <span>Color Mood</span>
                <h2>맑은 로즈 한 끗</h2>
              </div>
            </article>
            <article className="beauty-story">
              <span className="beauty-story__media">
                <img src="./makeup-clone-assets/42072b0ad4be9333.avif" alt="여행 파우치에 담을 뷰티 제품 이미지" />
              </span>
              <div className="beauty-story__body">
                <span>Pouch Edit</span>
                <h2>1박 2일 파우치 최소 구성</h2>
              </div>
            </article>
          </section>
        </div>
      </section>

      {/* 시나리오 관리 드로어 */}
      {drawerOpen && (
        <>
          <div className="sb-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="sb-drawer">
            <div className="sb-drawer__head">
              <div>
                <p className="sb-eyebrow">Scenario Studio</p>
                <h3>내 시나리오</h3>
              </div>
              <button type="button" className="sb-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="닫기">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <button type="button" className="sb-new-btn" onClick={api.newScenario}>
              + 새 시나리오 만들기
            </button>

            <div className="sb-drawer__list">
              {api.scenarios.length === 0 && (
                <div className="sb-drawer__empty">
                  아직 만든 시나리오가 없어요.<br />
                  <span>새 시나리오를 만들어 탐색→설문→계획 흐름을 구성해보세요.</span>
                </div>
              )}
              {api.scenarios.map((s) => (
                <div key={s.id} className="sb-scenario-row">
                  <div className="sb-scenario-row__info">
                    <span className={'sb-status ' + (s.status === 'published' ? 'sb-status--live' : '')}>
                      {s.status === 'published' ? '발행됨' : '작성 중'}
                    </span>
                    <p className="sb-scenario-row__title">{s.title}</p>
                    <p className="sb-scenario-row__chip">#{s.chip}</p>
                  </div>
                  <div className="sb-scenario-row__actions">
                    <button type="button" onClick={() => api.playScenario(s.id)}>시험</button>
                    <button type="button" onClick={() => api.openBuilder(s.id)}>편집</button>
                    <button
                      type="button"
                      className="sb-danger"
                      onClick={() => {
                        if (window.confirm(`"${s.title}" 시나리오를 삭제할까요?`)) api.removeScenario(s.id)
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
