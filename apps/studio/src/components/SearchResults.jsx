import React, { useState } from 'react'
import { BgBlobs, ViewerDeviceControl } from './Frame.jsx'
import { DEVICE_PRESETS } from '../lib/store.js'
import { SEARCH_CATALOG, searchProducts } from '../lib/searchCatalog.js'
import SearchOverlay, { BackIcon, SearchIcon } from './SearchOverlay.jsx'
import { useSearchEntry } from '../hooks/useSearchEntry.js'

/*
 * 검색 결과 페이지(SRP) 목업 — 검색 라우터가 "DDAK 아님"으로 가른 검색어의 착지 화면 (#srp/<검색어>).
 * Figma Search 2-1(검색 결과 — 전체 탭)의 골격: 검색 바 → 탭(전체·뷰티톡·쇼츠·라이브) → 상품 그리드 → 뷰티톡 · 라이브.
 * 데이터는 데모 카탈로그 매칭(lib/searchCatalog)이고 뷰티톡·라이브는 목업이다. 맨 위 ✦ 배너가 같은 검색어로
 * DDAK(설문→계획)로 넘어가는 길 — 라우터가 잘못 갈랐어도 여기서 복구된다
 */
const TABS = ['전체', '뷰티톡', '쇼츠', '라이브']
const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

function ProductThumb({ product }) {
  const [failed, setFailed] = useState(false)
  if (product.imageUrl && !failed) {
    return <img src={product.imageUrl} alt="" draggable={false} onError={() => setFailed(true)} />
  }
  return <span aria-hidden="true">🧴</span>
}

function ProductGrid({ products, onPick }) {
  return (
    <ul className="sb-srp__grid">
      {products.map((p) => (
        <li key={p.id}>
          <button type="button" className="sb-srp__card" onClick={() => onPick(p)}>
            <span className="sb-srp__thumb"><ProductThumb product={p} /></span>
            <span className="sb-srp__brand">{p.brand}</span>
            <span className="sb-srp__name">{p.name}</span>
            <b className="sb-srp__price">{Number(p.price || 0).toLocaleString('ko-KR')}원</b>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function SearchResults({ api, query }) {
  const viewer = DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS[0]
  const [searchOpen, setSearchOpen] = useState(false)
  const [tab, setTab] = useState('전체')
  const search = useSearchEntry(api, { onDdak: (q) => api.playLive(q) })
  const { hits, others } = searchProducts(query)
  const products = hits.length ? hits : others // 걸린 상품이 없으면 전체를 본 목록으로
  const term = String(query || '').trim()
  /* 뷰티톡·라이브 목업 — 카탈로그 썸네일을 빌려 검색어를 넣은 자리 카드 */
  const posts = [
    { title: `${term} 3종 직접 써보고 비교했어요`, author: '뷰티리뷰어', likes: '2.3천', image: (products[0] || SEARCH_CATALOG[0]).imageUrl },
    { title: `여름에도 무너지지 않는 ${term} 쓰는 법`, author: '메이크업 아티스트', likes: '1.1천', image: (products[1] || SEARCH_CATALOG[1]).imageUrl },
  ]
  const lives = [
    { title: `${term} 단독 특가 라이브`, viewers: '1.2천 시청', image: (products[2] || SEARCH_CATALOG[2]).imageUrl },
    { title: '오늘의 뷰티 라이브 — 발색 비교', viewers: '860 시청', image: (products[3] || SEARCH_CATALOG[3]).imageUrl },
  ]
  const onPick = (p) => api.showToast(`"${p.name}" 상세는 시나리오·라이브 체험의 상품 카드에서 열려요.`)
  const onTab = (name) => {
    setTab(name)
    if (name !== '전체') api.showToast(`${name} 탭은 목업이에요 — 전체 탭의 구성만 실제 데이터로 채워요.`)
  }

  return (
    <>
      <BgBlobs />
      <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />
      <section className="sb-player sb-srp">
        <div className="sb-phone sb-phone--player" style={{ width: viewer.w }}>
          <div className="sb-srp__bar">
            <button type="button" className="sb-search__back" aria-label="홈으로" onClick={api.goHome}>
              <BackIcon />
            </button>
            <button type="button" className="sb-search__field sb-srp__field" onClick={() => setSearchOpen(true)} title="다시 검색">
              <span className="sb-search__field-icon" aria-hidden="true"><SearchIcon /></span>
              <span className="sb-srp__query">{query}</span>
            </button>
          </div>
          <nav className="sb-srp__tabs" aria-label="검색 결과 탭">
            {TABS.map((name) => (
              <button key={name} type="button" className={'sb-srp__tab' + (tab === name ? ' is-on' : '')} onClick={() => onTab(name)}>
                {name}
              </button>
            ))}
          </nav>
          {/* DDAK 로 넘어가는 길 — 검색 결과 대신 설문→맞춤 계획 */}
          <button type="button" className="sb-srp__ddak" onClick={() => api.playLive(query)}>
            <span className="sb-srp__ddak-spark" aria-hidden="true">✦</span>
            <span className="sb-srp__ddak-text">
              <b>「{query}」 맞춤 계획 받기</b>
              <span>설문 두세 개로 내 피부·상황에 맞는 상품을 골라 드려요</span>
            </span>
            <span className="sb-srp__ddak-chevron" aria-hidden="true"><ChevronIcon /></span>
          </button>
          <div className="sb-srp__meta">
            <span>{hits.length ? `상품 ${hits.length}개` : '정확히 일치하는 상품이 없어 전체 상품을 보여드려요'}</span>
            <span>인기순 ▾</span>
          </div>
          <ProductGrid products={products} onPick={onPick} />
          {hits.length && others.length ? (
            <section className="sb-srp__section">
              <h3>함께 보면 좋은 상품</h3>
              <ProductGrid products={others} onPick={onPick} />
            </section>
          ) : null}
          <section className="sb-srp__section">
            <h3>뷰티톡</h3>
            <div className="sb-srp__posts">
              {posts.map((post) => (
                <article key={post.title} className="sb-srp__post">
                  <p className="sb-srp__post-head">{post.author}</p>
                  <p className="sb-srp__post-title">{post.title}</p>
                  <div className="sb-srp__post-img">{post.image ? <img src={post.image} alt="" draggable={false} /> : null}</div>
                  <p className="sb-srp__post-foot">♥ {post.likes}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="sb-srp__section">
            <h3>라이브</h3>
            <div className="sb-srp__lives">
              {lives.map((live) => (
                <article key={live.title} className="sb-srp__live">
                  {live.image ? <img src={live.image} alt="" draggable={false} /> : null}
                  <span className="sb-srp__live-badge">LIVE</span>
                  <span className="sb-srp__live-title">{live.title}<small>{live.viewers}</small></span>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
      <SearchOverlay
        open={searchOpen}
        initialQuery={query}
        width={viewer.w}
        profile={search.profile}
        recents={search.recents}
        onRemoveRecent={search.removeRecent}
        onSubmit={(q) => {
          setSearchOpen(false)
          search.runSearch(q)
        }}
        onClose={() => setSearchOpen(false)}
      />
      {search.routing ? (
        <div className="sb-search-routing" role="status">✦ 「{search.routing}」 — 어떤 화면이 맞을지 살펴보고 있어요…</div>
      ) : null}
    </>
  )
}
