import React from 'react'

const FALLBACK_IMG = './makeup-clone-assets/d9b261330f3ffccf.avif'

/* 공통 탐색(홈) 페이지 렌더러.
   홈에서는 실제 검색/칩 동작과 함께, 탐색 편집기에서는 미리보기로 쓰인다. */
export default function ExploreFrame({
  config,
  chips,
  searchValue = '',
  onSearchChange,
  onSubmit,
  interactive = true,
}) {
  if (!config) return null

  const submit = (e) => {
    e.preventDefault()
    if (interactive && onSubmit) onSubmit()
  }

  return (
    <div className="clean-home__wrap">
      <div className="beauty-search-stage">
        <div className="beauty-greeting">
          <span>{config.greeting}</span>
        </div>

        <form className="clean-search group" onSubmit={submit}>
          <div className="clean-search__box">
            <textarea
              rows={1}
              placeholder={config.searchPlaceholder}
              className="resize-none overflow-hidden"
              value={searchValue}
              readOnly={!interactive}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (interactive && e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit && onSubmit()
                }
              }}
            />
            <button
              type="submit"
              id="submitBtn"
              className="top-1/2 -translate-y-1/2 bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="검색"
              disabled={!interactive || !searchValue.trim()}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </button>
          </div>
        </form>

        <div className="clean-tag-row" aria-label="발행된 시나리오">{chips}</div>
      </div>

      <section className="beauty-webzine" aria-label="뷰티 카테고리 콘텐츠">
        {config.stories.map((s, i) => (
          <article key={i} className={'beauty-story' + (i === 0 ? ' beauty-story--feature' : '')}>
            <span className="beauty-story__media">
              <img
                src={s.imageUrl || FALLBACK_IMG}
                alt={s.title}
                onError={(e) => { e.currentTarget.src = FALLBACK_IMG }}
              />
            </span>
            <div className="beauty-story__body">
              <span>{s.kicker}</span>
              <h2>{s.title}</h2>
              {i === 0 && s.desc ? <p>{s.desc}</p> : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
