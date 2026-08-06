import React, { useEffect, useMemo, useState } from 'react'
import {
  TAGGING_STATUS,
  loadTaggingReview,
  productEmoji,
  resetTaggingReview,
  saveTaggingReview,
  tagStats,
  taggingExportPayload,
} from '../lib/taggingCatalog.js'

/*
 * 상품 태깅 검토 스튜디오 — 라이브 생성의 상품 매칭(그라운딩) 근거인 데모 카탈로그
 * 태그를 사람이 훑는 화면. 상품마다 태그를 고치고(추가/삭제/되돌리기) 검토 상태
 * (승인/수정 필요)와 메모를 남긴다. 결과는 이 브라우저에만 저장되고, 카탈로그(코드)
 * 반영·기기 이동은 JSON 내보내기로 한다. 진입은 홈 드로어의 도구 행.
 */

const STATUS_ORDER = ['pending', 'approved', 'flagged']

const formatPrice = (price) => `${Number(price).toLocaleString('ko-KR')}원`

function TagEditor({ product, onChange }) {
  const [draft, setDraft] = useState('')
  const addTag = () => {
    const value = draft.trim()
    setDraft('')
    if (!value || product.tags.includes(value)) return
    onChange({ ...product, tags: [...product.tags, value] })
  }
  return (
    <div className="sb-tagging-tags">
      {product.tags.map((tag) => (
        <span key={tag} className="sb-tagging-tag">
          {tag}
          <button
            type="button"
            title={`"${tag}" 태그 빼기`}
            onClick={() => onChange({ ...product, tags: product.tags.filter((t) => t !== tag) })}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder="태그 추가"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addTag()
          }
        }}
        onBlur={addTag}
      />
    </div>
  )
}

export default function TaggingStudio({ api }) {
  const [products, setProducts] = useState(loadTaggingReview)
  const [statusFilter, setStatusFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    saveTaggingReview(products)
  }, [products])

  const stats = useMemo(() => tagStats(products), [products])
  const counts = useMemo(() => {
    const out = { pending: 0, approved: 0, flagged: 0 }
    for (const p of products) out[p.status] += 1
    return out
  }, [products])
  const reviewed = counts.approved + counts.flagged

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (tagFilter && !p.tags.includes(tagFilter)) return false
      if (q && !`${p.brand} ${p.name}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [products, statusFilter, tagFilter, query])

  const patchProduct = (next) => {
    setProducts((prev) => prev.map((p) => (p.id === next.id ? next : p)))
  }

  const setStatus = (product, status) => {
    /* 같은 상태를 다시 누르면 미검토로 되돌린다 */
    patchProduct({ ...product, status: product.status === status ? 'pending' : status })
  }

  const exportJson = () => {
    const payload = taggingExportPayload(products)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ddak-tagging-review-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    api.showToast('태깅 검토 결과를 JSON으로 내려받았어요.')
  }

  const resetAll = () => {
    if (!window.confirm('검토 상태·수정한 태그·메모를 모두 지우고 카탈로그 원본으로 되돌릴까요?')) return
    setProducts(resetTaggingReview())
    setStatusFilter('all')
    setTagFilter(null)
    api.showToast('카탈로그 원본으로 되돌렸어요.')
  }

  const tagsChanged = (product) =>
    product.tags.length !== product.originalTags.length ||
    product.tags.some((tag, index) => tag !== product.originalTags[index])

  return (
    <section className="sb-tagging">
      <div className="sb-tagging__head">
        <div>
          <h1>상품 태깅 검토</h1>
          <p className="sb-tagging__sub">
            AI 실시간 생성이 상품을 고르는 근거(카탈로그 특징 태그)를 검토해요. 검토 내용은 이 브라우저에만
            저장되고, 카탈로그 반영은 JSON 내보내기로 전달해요.
          </p>
        </div>
        <div className="sb-tagging__head-actions">
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={exportJson}>
            JSON 내보내기
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={resetAll}>
            원본으로 초기화
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={api.closeTaggingStudio}>
            홈으로
          </button>
        </div>
      </div>

      {/* 진행 요약 — 상태 타일이 곧 필터다 */}
      <div className="sb-tagging-summary">
        <button
          type="button"
          className={'sb-tagging-summary__tile' + (statusFilter === 'all' ? ' is-active' : '')}
          onClick={() => setStatusFilter('all')}
        >
          <b>{products.length}</b>
          <span>전체 상품</span>
        </button>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            className={
              `sb-tagging-summary__tile sb-tagging-summary__tile--${status}` +
              (statusFilter === status ? ' is-active' : '')
            }
            onClick={() => setStatusFilter((prev) => (prev === status ? 'all' : status))}
          >
            <b>{counts[status]}</b>
            <span>{TAGGING_STATUS[status]}</span>
          </button>
        ))}
        <div className="sb-tagging-progress" title={`검토 완료 ${reviewed} / ${products.length}`}>
          <span>검토 {reviewed}/{products.length}</span>
          <div className="sb-tagging-progress__bar">
            <i style={{ width: `${products.length ? Math.round((reviewed / products.length) * 100) : 0}%` }} />
          </div>
        </div>
      </div>

      {/* 태그 사전 — 빈도순. 칩을 누르면 그 태그가 달린 상품만 본다 */}
      <div className="sb-tagging-dict">
        <p className="sb-tagging-dict__label">태그 사전 · {stats.length}개</p>
        <div className="sb-tagging-dict__chips">
          {stats.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className={'sb-tagging-dict__chip' + (tagFilter === tag ? ' is-active' : '')}
              onClick={() => setTagFilter((prev) => (prev === tag ? null : tag))}
            >
              {tag} <b>{count}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="sb-tagging-toolbar">
        <input
          value={query}
          placeholder="브랜드·상품명 검색"
          onChange={(event) => setQuery(event.target.value)}
        />
        {(tagFilter || statusFilter !== 'all' || query.trim()) && (
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--tiny"
            onClick={() => {
              setTagFilter(null)
              setStatusFilter('all')
              setQuery('')
            }}
          >
            필터 지우기
          </button>
        )}
        <span className="sb-tagging-toolbar__count">{visible.length}개 표시</span>
      </div>

      <div className="sb-tagging-list">
        {visible.length === 0 && <p className="sb-tagging-empty">조건에 맞는 상품이 없어요.</p>}
        {visible.map((product) => (
          <div key={product.id} className={`sb-tagging-row sb-tagging-row--${product.status}`}>
            <div className="sb-tagging-row__thumb">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                    event.currentTarget.nextSibling.style.display = 'flex'
                  }}
                />
              ) : null}
              <span style={{ display: product.imageUrl ? 'none' : 'flex' }}>{productEmoji(product.tags)}</span>
            </div>

            <div className="sb-tagging-row__main">
              <div className="sb-tagging-row__title">
                <em>{product.brand}</em>
                <strong>{product.name}</strong>
                <span>{formatPrice(product.price)}</span>
                <code>{product.id}</code>
                {tagsChanged(product) && (
                  <button
                    type="button"
                    className="sb-tagging-row__revert"
                    title={`원래 태그: ${product.originalTags.join(', ')}`}
                    onClick={() => patchProduct({ ...product, tags: [...product.originalTags] })}
                  >
                    태그 수정됨 · 되돌리기
                  </button>
                )}
              </div>
              <TagEditor product={product} onChange={patchProduct} />
              <input
                className="sb-tagging-row__note"
                value={product.note}
                placeholder="검토 메모 (예: '진정'보다 '수부지'가 맞음)"
                onChange={(event) => patchProduct({ ...product, note: event.target.value })}
              />
            </div>

            <div className="sb-tagging-row__status">
              <button
                type="button"
                className={'sb-tagging-status sb-tagging-status--approved' + (product.status === 'approved' ? ' is-on' : '')}
                onClick={() => setStatus(product, 'approved')}
              >
                승인
              </button>
              <button
                type="button"
                className={'sb-tagging-status sb-tagging-status--flagged' + (product.status === 'flagged' ? ' is-on' : '')}
                onClick={() => setStatus(product, 'flagged')}
              >
                수정 필요
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
