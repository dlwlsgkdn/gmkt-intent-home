import React, { useEffect, useMemo, useState } from 'react'
import { BgBlobs, ViewerDeviceControl } from './Frame.jsx'
import { viewerDeviceOf } from '../lib/store.js'
import DeviceFrame from './DeviceFrame.jsx'
import ProductDetailPanel from './ProductDetailPanel.jsx'
import SearchOverlay, { BackIcon, SearchIcon } from './SearchOverlay.jsx'
import { useSearchEntry } from '../hooks/useSearchEntry.js'
import { scrollScreenTo } from '../lib/deviceScreen.js'
import { loadSrpSnapshot, buildSrpResults, sortProducts, filterProducts, SORTS, won } from '../lib/srpMock.js'

/*
 * 검색 결과 페이지(SRP) 목업 — 검색 라우터가 "DDAK 아님"으로 가른 검색어의 착지 화면 (#srp/<검색어>).
 * Figma Search "2-1. 검색 결과 — 전체 탭"(390×2790, 2026-09-08 대조)의 골격을 그대로 따른다:
 *   검색 바(뒤로 + 44px 알약 필드 + ✕) → 연관 검색어 칩 행 → 탭(전체·뷰티톡·쇼츠·라이브·추천 상품)
 *   → 섹션 4개: 쇼츠(세로 카드 2×2) · 라이브(LIVE 알약) · 뷰티톡(연보라 글 카드) · 상품(엠블럼 배지·할인율·별점·배송)
 * 결과 조립은 `lib/srpMock.js`(2026-09-17): 상품은 **실제 지마켓 검색 결과 스냅샷**(`data/srpSnapshot.json` — 이름·브랜드·가격·할인·
 * 별점·리뷰·구매 수·배송·엠블럼·광고 표식, 썸네일·상세는 상품 번호로 결정)이고 쇼츠·라이브·뷰티톡은 카테고리별 문구 풀에서 검색어
 * 해시로 뽑아 같은 검색어면 같은 화면이 나온다. 탭은 전부 동작한다(전체 = 섹션 4개 미리보기, 나머지 탭 = 그 종류 전체, 추천 상품 =
 * 정렬·필터). 상품 카드 클릭 = 상세보기 패널(모바일 PDP iframe — Player 와 같은 ProductDetailPanel). 쇼츠·라이브·뷰티톡 클릭은 목업(토스트).
 * Figma 에 없는 한 조각은 탭 아래 ✦ 「맞춤 계획 받기」 배너 — 같은 검색어로 DDAK(설문→계획)로 넘어가는 길이라 라우터가 잘못 갈랐어도
 * 여기서 복구된다
 */
const TABS = ['전체', '뷰티톡', '쇼츠', '라이브', '추천 상품']
const count = (n) => Number(n || 0).toLocaleString('ko-KR')

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 20.5l-1.3-1.2C5.6 14.7 2.5 11.9 2.5 8.4 2.5 5.6 4.7 3.5 7.5 3.5c1.6 0 3.1.8 4.1 2 1-1.2 2.5-2 4.1-2 2.8 0 5 2.1 5 4.9 0 3.5-3.1 6.3-8.2 10.9L12 20.5z" />
  </svg>
)
const CommentIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.3 1.2 4.4 3.1 5.8L5.3 21l4.6-2.3c.7.1 1.4.2 2.1.2 5.1 0 9-3.4 9-7.6S17.1 3 12 3z" />
  </svg>
)
const TruckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </svg>
)
const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z" />
  </svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l10-6.5z" />
  </svg>
)

function Photo({ src, alt = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span className="sb-srp__photo-blank" aria-hidden="true" />
  return <img src={src} alt={alt} draggable={false} loading="lazy" onError={() => setFailed(true)} />
}

function SectionHead({ title, total, onMore }) {
  return (
    <div className="sb-srp__head">
      <h3 className="sb-srp__title">
        {title}
        {total != null ? <span className="sb-srp__count">{count(total)}</span> : null}
      </h3>
      {onMore ? (
        <button type="button" className="sb-srp__more" onClick={onMore}>
          전체보기<ChevronIcon />
        </button>
      ) : null}
    </div>
  )
}

/* 쇼츠·라이브 — 사진 위 그라데이션 + 아바타·이름 + 제목 2줄 + 메타 한 줄(조회수·시점 / 시청자 수·예정 시각). 라이브는 LIVE 알약(예정은 검정 알약) */
function MediaCard({ item, live, onPick }) {
  const productShot = !!item.product
  return (
    <button type="button" className={'sb-srp__media' + (productShot ? ' sb-srp__media--product' : '')} onClick={onPick}>
      <Photo src={item.image} />
      <span className="sb-srp__media-shade" aria-hidden="true" />
      {live ? (
        item.live ? <span className="sb-srp__live-badge">LIVE</span> : <span className="sb-srp__live-badge sb-srp__live-badge--soon">예정 · {item.startsAt}</span>
      ) : (
        <span className="sb-srp__media-views"><PlayIcon />{item.views}</span>
      )}
      <span className="sb-srp__media-body">
        <span className="sb-srp__media-who">
          <span className="sb-srp__avatar sb-srp__avatar--20"><Photo src={item.avatar} /></span>
          {item.who}
        </span>
        <span className="sb-srp__media-title">{item.title}</span>
        <span className="sb-srp__media-meta">{live ? (item.live ? `${item.viewers}명 시청 중` : '알림 받기') : item.ago}</span>
      </span>
    </button>
  )
}

/* 뷰티톡 글 카드 — 아바타·닉네임·시점 → 본문 4줄 → 사진(그 글이 말하는 상품) → ♥ 💬 */
function PostCard({ post, onPick }) {
  return (
    <article className="sb-srp__post" onClick={onPick}>
      <div className="sb-srp__post-head">
        <span className="sb-srp__avatar sb-srp__avatar--24"><Photo src={post.avatar} /></span>
        <span className="sb-srp__post-name">{post.name}</span>
        <span className="sb-srp__post-ago">{post.ago}</span>
      </div>
      <p className="sb-srp__post-body">{post.body}</p>
      <div className={'sb-srp__post-img' + (post.product ? ' sb-srp__post-img--product' : '')}><Photo src={post.image} /></div>
      <div className="sb-srp__post-foot">
        <span><HeartIcon />{post.likes}</span>
        <span><CommentIcon />{post.comments}</span>
      </div>
    </article>
  )
}

/* 상품 카드 — 지마켓 모바일 카드의 정보 밀도: 엠블럼(빅세일)·AD·품절 → 이름 2줄 → 할인율+가격(+정가) → ★별점(리뷰)·구매 → 배송·오늘출발·스마일배송·공식 */
function ProductCard({ p, onPick }) {
  return (
    <button type="button" className={'sb-srp__card' + (p.soldOut ? ' is-soldout' : '')} onClick={onPick} aria-label={`${p.name} 상세보기`}>
      <span className="sb-srp__thumb">
        <Photo src={p.imageUrl} alt="" />
        {p.emblem ? <span className="sb-srp__deal">{p.emblem}</span> : null}
        {p.ad ? <span className="sb-srp__ad">AD</span> : null}
        {p.soldOut ? <span className="sb-srp__soldout">품절</span> : null}
        {p.related ? (
          <>
            <span className="sb-srp__mini" aria-hidden="true"><Photo src={p.imageUrl} /></span>
            <span className="sb-srp__mini-plus" aria-hidden="true">+</span>
          </>
        ) : null}
      </span>
      <span className="sb-srp__body">
        <span className="sb-srp__name">{p.name}</span>
        <span className="sb-srp__price-row">
          {p.dc ? <span className="sb-srp__off">{p.dc}%</span> : null}
          <span className="sb-srp__price">{won(p.price)}</span>
          {p.before ? <s className="sb-srp__before">{won(p.before)}</s> : null}
        </span>
        {p.star || p.buys ? (
          <span className="sb-srp__meta">
            {p.star ? (
              <span className="sb-srp__star"><StarIcon />{p.star.toFixed(1)}{p.reviews ? <em>({count(p.reviews)})</em> : null}</span>
            ) : null}
            {p.buys ? <span>구매 {count(p.buys)}</span> : null}
          </span>
        ) : null}
        <span className="sb-srp__tags">
          <span className="sb-srp__delivery"><TruckIcon />{p.ship === 'free' ? '무료배송' : `배송비 ${won(p.ship)}`}</span>
          {p.today ? <span className="sb-srp__tag sb-srp__tag--today">오늘출발</span> : null}
          {p.smile ? <span className="sb-srp__tag sb-srp__tag--smile">스마일배송</span> : null}
          {p.official ? <span className="sb-srp__tag">{p.official}</span> : null}
        </span>
      </span>
    </button>
  )
}

/* 추천 상품 탭 — 개수 · 정렬 세그먼트 · 배송 필터 칩 */
function SortBar({ total, sort, onSort, filters, onFilter }) {
  return (
    <div className="sb-srp__sortbar">
      <div className="sb-srp__sortbar-row">
        <span className="sb-srp__sortbar-total">{count(total)}개</span>
        <div className="sb-srp__sorts" role="tablist" aria-label="정렬">
          {SORTS.map((s) => (
            <button key={s.id} type="button" className={'sb-srp__sort' + (sort === s.id ? ' is-on' : '')} onClick={() => onSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sb-srp__filters">
        {[
          ['freeShip', '무료배송'],
          ['smile', '스마일배송'],
        ].map(([key, label]) => (
          <button key={key} type="button" className={'sb-srp__filter' + (filters[key] ? ' is-on' : '')} aria-pressed={!!filters[key]} onClick={() => onFilter(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* 스냅샷 청크가 오기 전 한 박자 — 회색 자리 */
function Skeleton({ rows = 2, tall = false }) {
  return (
    <div className="sb-srp__grid sb-srp__skel" aria-hidden="true">
      {Array.from({ length: rows * 2 }, (_, i) => (
        <span key={i} className={'sb-srp__skel-card' + (tall ? ' sb-srp__skel-card--tall' : '')} />
      ))}
    </div>
  )
}

export default function SearchResults({ api, query }) {
  const viewer = viewerDeviceOf(api.viewerDevice)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSeed, setSearchSeed] = useState(query) // 검색 화면을 열 때 필드에 실을 글 — ✕ 는 빈 채로 연다
  const [tab, setTab] = useState('전체')
  const [sort, setSort] = useState('rank')
  const [filters, setFilters] = useState({})
  const [productDetail, setProductDetail] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const search = useSearchEntry(api, { onDdak: (q) => api.playLive(q) })
  const term = String(query || '').trim()
  const recentQueries = search.recents.map((r) => r.q).join('\n')

  useEffect(() => {
    let alive = true
    loadSrpSnapshot().then((s) => {
      if (alive) setSnapshot(s)
    })
    return () => {
      alive = false
    }
  }, [])
  const results = useMemo(
    () => (snapshot ? buildSrpResults(term, snapshot, { recents: recentQueries.split('\n').filter(Boolean) }) : null),
    [snapshot, term, recentQueries],
  )
  const productList = useMemo(() => (results ? sortProducts(filterProducts(results.products, filters), sort) : []), [results, filters, sort])

  const mock = (what) => api.showToast(`${what}은(는) 목업이에요 — 상품 카드는 실제 지마켓 상세 페이지가 열려요.`)
  const openProduct = (p) => setProductDetail({ name: p.name, mall: p.mall, url: p.url })
  const goTab = (name) => {
    setTab(name)
    scrollScreenTo(0)
  }
  const openSearch = (seed) => {
    setSearchSeed(seed)
    setSearchOpen(true)
  }
  const toggleFilter = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }))

  const related = results ? results.related : []
  const shorts = results ? results.shorts : []
  const lives = results ? results.lives : []
  const posts = results ? results.posts : []
  const counts = results ? results.counts : { products: 0, shorts: 0, lives: 0, posts: 0 }

  return (
    <>
      {/* 스튜디오 크롬 — 기기 프레임 밖 */}
      <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />
      <DeviceFrame device={viewer}>
      <BgBlobs />
      <section className="sb-player sb-srp">
        <div className="sb-phone sb-phone--player" style={{ width: viewer.w }}>
          {/* 검색 바 — Figma: 뒤로 + 44px 알약 필드(돋보기 · 검색어 · ✕) */}
          <div className="sb-srp__bar">
            <button type="button" className="sb-search__back" aria-label="홈으로" onClick={api.goHome}>
              <BackIcon />
            </button>
            <div className="sb-search__field sb-srp__field">
              <button type="button" className="sb-srp__field-main" onClick={() => openSearch(query)} title="다시 검색">
                <span className="sb-search__field-icon" aria-hidden="true"><SearchIcon /></span>
                <span className="sb-srp__query">{query}</span>
              </button>
              <button type="button" className="sb-search__clear" aria-label="검색어 지우고 다시 검색" onClick={() => openSearch('')}>
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* 연관 검색어 칩 — 결과 상위 브랜드·어휘 조합. 누르면 라우터를 거쳐 DDAK / 새 검색 결과로 */}
          <div className="sb-srp__chips" role="list" aria-label="연관 검색어">
            {related.map((t) => (
              <button key={t} type="button" role="listitem" className="sb-srp__chip" onClick={() => search.runSearch(t)}>
                {t}
              </button>
            ))}
          </div>

          <nav className="sb-srp__tabs" aria-label="검색 결과 탭">
            {TABS.map((name) => (
              <button key={name} type="button" className={'sb-srp__tab' + (tab === name ? ' is-on' : '')} onClick={() => goTab(name)}>
                {name}
              </button>
            ))}
          </nav>

          {/* DDAK 로 넘어가는 길 — 검색 결과 대신 설문→맞춤 계획 (Figma 밖, 라우터 오판 복구용) */}
          {tab === '전체' || tab === '추천 상품' ? (
            <button type="button" className="sb-srp__ddak" onClick={() => api.playLive(query)}>
              <span className="sb-srp__ddak-spark" aria-hidden="true">✦</span>
              <span className="sb-srp__ddak-text">
                <b>「{query}」 맞춤 계획 받기</b>
                <span>설문 두세 개로 내 피부·상황에 맞는 상품을 골라 드려요</span>
              </span>
              <span className="sb-srp__ddak-chevron" aria-hidden="true"><ChevronIcon /></span>
            </button>
          ) : null}

          {(tab === '전체' || tab === '쇼츠') && (
            <section className="sb-srp__section">
              <SectionHead title="쇼츠" total={counts.shorts} onMore={tab === '전체' ? () => goTab('쇼츠') : null} />
              {!results ? <Skeleton tall /> : (
                <div className="sb-srp__grid">
                  {(tab === '전체' ? shorts.slice(0, 4) : shorts).map((item) => <MediaCard key={item.id} item={item} onPick={() => mock('쇼츠')} />)}
                </div>
              )}
            </section>
          )}

          {(tab === '전체' || tab === '라이브') && (
            <section className="sb-srp__section">
              <SectionHead title="라이브" total={counts.lives} onMore={tab === '전체' ? () => goTab('라이브') : null} />
              {!results ? <Skeleton tall /> : (
                <div className="sb-srp__grid">
                  {lives.map((item) => <MediaCard key={item.id} item={item} live onPick={() => mock('라이브')} />)}
                </div>
              )}
            </section>
          )}

          {(tab === '전체' || tab === '뷰티톡') && (
            <section className="sb-srp__section">
              <SectionHead title="뷰티톡" total={counts.posts} onMore={tab === '전체' ? () => goTab('뷰티톡') : null} />
              {!results ? <Skeleton /> : (
                <div className="sb-srp__grid sb-srp__grid--posts">
                  {(tab === '전체' ? posts.slice(0, 4) : posts).map((post) => <PostCard key={post.id} post={post} onPick={() => mock('뷰티톡 글')} />)}
                </div>
              )}
            </section>
          )}

          {(tab === '전체' || tab === '추천 상품') && (
            <section className="sb-srp__section">
              <SectionHead title="상품" total={tab === '전체' ? counts.products : null} onMore={tab === '전체' ? () => goTab('추천 상품') : null} />
              {tab === '추천 상품' && results ? (
                <SortBar total={counts.products} sort={sort} onSort={setSort} filters={filters} onFilter={toggleFilter} />
              ) : null}
              {!results ? <Skeleton rows={2} /> : (
                <>
                  <ul className="sb-srp__grid sb-srp__grid--products">
                    {(tab === '전체' ? productList.slice(0, 8) : productList).map((p) => (
                      <li key={p.id}>
                        <ProductCard p={p} onPick={() => openProduct(p)} />
                      </li>
                    ))}
                  </ul>
                  {tab === '추천 상품' && !productList.length ? (
                    <p className="sb-srp__empty">조건에 맞는 상품이 없어요. 필터를 풀어 보세요.</p>
                  ) : null}
                  {tab === '추천 상품' && productList.length ? (
                    <button type="button" className="sb-srp__loadmore" onClick={() => mock('다음 페이지')}>
                      상품 더 보기<ChevronIcon />
                    </button>
                  ) : null}
                </>
              )}
            </section>
          )}
        </div>
      </section>
      <SearchOverlay
        open={searchOpen}
        initialQuery={searchSeed}
        width={viewer.w}
        profile={search.profile}
        recents={search.recents}
        routing={search.routing}
        onRemoveRecent={search.removeRecent}
        onSubmit={(q) => {
          // 다른 검색어면 주소가 바뀌어 이 화면이 새로 마운트되고, 같은 검색어면 판정 뒤 검색 화면만 접는다
          search.runSearch(q).then(() => setSearchOpen(false))
        }}
        onClose={() => setSearchOpen(false)}
      />
      {search.routing && !searchOpen ? (
        <div className="sb-search-routing" role="status">✦ 「{search.routing}」 — 어떤 화면이 맞을지 살펴보고 있어요…</div>
      ) : null}
      {/* 상품 상세보기 — 지마켓 모바일 PDP iframe (Player 와 같은 패널, 기기 프레임 안) */}
      <ProductDetailPanel product={productDetail} onClose={() => setProductDetail(null)} />
      </DeviceFrame>
    </>
  )
}
