import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { timeAgo } from '../lib/timeAgo.js'
import { autocomplete, fallbackSuggest } from '../lib/searchCatalog.js'
import { suggestSearch } from '../lib/liveApi.js'

/*
 * 홈 검색 화면 — Figma Search 1-2(최근 검색어) · 1-3(검색 입력: 자동완성 + AI 추천).
 * 검색창을 누르는 순간 프레임을 덮는 한 장의 화면으로 뜬다(body 포털 — 프레임 폭에 맞춰 가운데). 입력이 비면 최근
 * 검색어(시각 + ✕ 삭제), 글자가 있으면 자동완성 행(입력어 굵게 — 서버 없이 어휘 조합)과 그 아래 ✦ AI 추천 행
 * (BFF `/api/search/suggest`, 450ms 디바운스·세션 캐시, 실패 시 대체 문장). 제출은 어느 행이든 onSubmit(text) 한 곳 —
 * 두 갈래(DDAK/SRP) 분기는 호출자(useSearchEntry) 몫이다
 */
const suggestCache = new Map()

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)
export const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 6l-6 6 6 6" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
/* ✦ — AI 추천 행 (Figma 자연어 칩의 스파클). 라이브 생성으로 이어지는 검색어라 ✦ 를 쓴다 */
const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.5l2.1 6.1 6.4 2.2-6.4 2.2L12 19.1l-2.1-6.1-6.4-2.2 6.4-2.2z" />
    <path d="M19.5 15.5l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9z" opacity="0.7" />
  </svg>
)

function Highlight({ text, match }) {
  if (!match) return text
  const [start, len] = match
  return (
    <>
      {text.slice(0, start)}
      <b>{text.slice(start, start + len)}</b>
      {text.slice(start + len)}
    </>
  )
}

export default function SearchOverlay({ open, initialQuery = '', width = 390, profile = [], recents = [], onRemoveRecent, onSubmit, onClose }) {
  const [text, setText] = useState(initialQuery)
  const [ai, setAi] = useState({ query: '', rows: [], loading: false })
  const inputRef = useRef(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    setText(initialQuery)
    const timer = setTimeout(() => inputRef.current && inputRef.current.focus(), 30)
    return () => clearTimeout(timer)
  }, [open, initialQuery])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /* AI 추천 — 타자가 멈추고 450ms 뒤 한 번, 순번(seq)으로 늦게 도착한 옛 답은 버린다. 앞글자가 같은 입력은
     지난 추천을 잠시 유지해 행이 깜빡이지 않게 한다 */
  useEffect(() => {
    if (!open) return undefined
    const q = text.trim()
    if (!q) {
      setAi({ query: '', rows: [], loading: false })
      return undefined
    }
    if (suggestCache.has(q)) {
      setAi({ query: q, rows: suggestCache.get(q), loading: false })
      return undefined
    }
    const seq = ++seqRef.current
    setAi((prev) => ({ query: q, rows: prev.query && q.startsWith(prev.query) ? prev.rows : [], loading: true }))
    const timer = setTimeout(async () => {
      let rows
      try {
        const res = await suggestSearch({ query: q, profile })
        rows = (res.suggestions || []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 3)
        if (!rows.length) rows = fallbackSuggest(q, profile)
      } catch {
        rows = fallbackSuggest(q, profile)
      }
      if (seq !== seqRef.current) return
      suggestCache.set(q, rows)
      setAi({ query: q, rows, loading: false })
    }, 450)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open])

  if (!open) return null
  const q = text.trim()
  const rows = q ? autocomplete(q, recents.map((r) => r.q)) : []
  const submit = (value) => {
    const v = String(value || '').trim()
    if (v) onSubmit(v)
  }

  return createPortal(
    <div className="sb-search" role="dialog" aria-modal="true" aria-label="검색">
      <div className="sb-search__screen" style={{ width }}>
        <div className="sb-search__bar">
          <button type="button" className="sb-search__back" aria-label="뒤로" onClick={onClose}>
            <BackIcon />
          </button>
          <form
            className="sb-search__field"
            onSubmit={(e) => {
              e.preventDefault()
              submit(text)
            }}
          >
            <span className="sb-search__field-icon" aria-hidden="true"><SearchIcon /></span>
            <input
              ref={inputRef}
              className="sb-search__input"
              type="text"
              value={text}
              placeholder="어떤 뷰티 고민이 있으세요?"
              autoComplete="off"
              enterKeyHint="search"
              onChange={(e) => setText(e.target.value)}
              /* 한글 조합 중 Enter 는 조합 확정이라 제출하지 않는다 — 조합이 끝난 Enter 만 검색 */
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                e.preventDefault()
                submit(text)
              }}
            />
            {text ? (
              <button
                type="button"
                className="sb-search__clear"
                aria-label="지우기"
                onClick={() => {
                  setText('')
                  inputRef.current && inputRef.current.focus()
                }}
              >
                <CloseIcon />
              </button>
            ) : null}
          </form>
        </div>
        <div className="sb-search__list">
          {!q ? (
            recents.length ? (
              recents.map((r) => (
                <div key={r.q} className="sb-search__row sb-search__row--recent">
                  <button type="button" className="sb-search__row-main" onClick={() => submit(r.q)}>
                    <span className="sb-search__row-icon" aria-hidden="true"><SearchIcon /></span>
                    <span className="sb-search__row-text"><b>{r.q}</b></span>
                    <span className="sb-search__row-time">{timeAgo(r.at)}</span>
                  </button>
                  <button type="button" className="sb-search__row-x" aria-label={`${r.q} 최근 검색어에서 삭제`} onClick={() => onRemoveRecent && onRemoveRecent(r.q)}>
                    <CloseIcon />
                  </button>
                </div>
              ))
            ) : (
              <p className="sb-search__empty">최근 검색어가 없어요. 뷰티 고민을 자유롭게 적어 보세요.</p>
            )
          ) : (
            <>
              {rows.map((row) => (
                <div key={row.text} className="sb-search__row">
                  <button type="button" className="sb-search__row-main" onClick={() => submit(row.text)}>
                    <span className="sb-search__row-icon" aria-hidden="true"><SearchIcon /></span>
                    <span className="sb-search__row-text"><Highlight text={row.text} match={row.match} /></span>
                  </button>
                </div>
              ))}
              {ai.rows.map((s) => (
                <div key={s} className="sb-search__row sb-search__row--ai">
                  <button type="button" className="sb-search__row-main" onClick={() => submit(s)}>
                    <span className="sb-search__row-icon" aria-hidden="true"><SparkIcon /></span>
                    <span className="sb-search__row-text">{s}</span>
                  </button>
                </div>
              ))}
              {ai.loading && !ai.rows.length ? (
                <div className="sb-search__row sb-search__row--ai sb-search__row--loading" role="status">
                  <span className="sb-search__row-main">
                    <span className="sb-search__row-icon" aria-hidden="true"><SparkIcon /></span>
                    <span className="sb-search__row-text">AI 가 어울리는 검색어를 떠올리고 있어요…</span>
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
