import React, { useState } from 'react'
import { BgBlobs, ViewerDeviceControl } from './Frame.jsx'
import { DEVICE_PRESETS } from '../lib/store.js'
import { SEARCH_CATALOG, autocomplete, searchProducts } from '../lib/searchCatalog.js'
import SearchOverlay, { BackIcon, SearchIcon } from './SearchOverlay.jsx'
import { useSearchEntry } from '../hooks/useSearchEntry.js'

/*
 * 검색 결과 페이지(SRP) 목업 — 검색 라우터가 "DDAK 아님"으로 가른 검색어의 착지 화면 (#srp/<검색어>).
 * Figma Search "2-1. 검색 결과 — 전체 탭"(390×2790, 2026-09-08 대조)의 골격을 그대로 따른다:
 *   검색 바(뒤로 + 44px 알약 필드 + ✕) → 연관 검색어 칩 행 → 탭(전체·뷰티톡·쇼츠·라이브·추천 상품)
 *   → 섹션 4개: 쇼츠(세로 카드 2×2) · 라이브(LIVE 알약) · 뷰티톡(연보라 글 카드) · 상품(슈퍼딜 배지·할인율·무료배송)
 * 데이터는 전부 목업이다 — 상품만 데모 카탈로그 매칭(lib/searchCatalog: 걸린 상품 먼저, 나머지로 채움), 쇼츠·라이브는
 * 샘플 얼굴(public/sample-faces), 뷰티톡은 카탈로그 썸네일에 검색어를 넣은 글. Figma 에 없는 한 조각은 탭 아래
 * ✦ 「맞춤 계획 받기」 배너 — 같은 검색어로 DDAK(설문→계획)로 넘어가는 길이라 라우터가 잘못 갈랐어도 여기서 복구된다
 */
const TABS = ['전체', '뷰티톡', '쇼츠', '라이브', '추천 상품']
const FACES = ['./sample-faces/face-1.jpg', './sample-faces/face-2.jpg', './sample-faces/face-3.jpg', './sample-faces/face-4.jpg']
const CREATORS = ['뷰티유튜버 민지', '메이크업 아티스트', '스킨케어 전문가', '뷰티리뷰어']
const TALKERS = ['뷰티코덕언니', '쿠션덕후마미', '핑크코덕', '글로시뷰티']
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`

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

function Photo({ src, alt = '' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="sb-srp__photo-blank" aria-hidden="true" />
  return <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)} />
}

function SectionHead({ title, count, onMore }) {
  return (
    <div className="sb-srp__head">
      <h3 className="sb-srp__title">
        {title}
        <span className="sb-srp__count">{count}</span>
      </h3>
      <button type="button" className="sb-srp__more" onClick={onMore}>
        전체보기<ChevronIcon />
      </button>
    </div>
  )
}

/* 쇼츠·라이브 — 사진 위 그라데이션 + 아바타·이름 + 제목 2줄 (라이브는 LIVE 알약) */
function MediaCard({ item, live, onPick }) {
  return (
    <button type="button" className="sb-srp__media" onClick={onPick}>
      <Photo src={item.image} />
      <span className="sb-srp__media-shade" aria-hidden="true" />
      {live ? <span className="sb-srp__live-badge">LIVE</span> : null}
      <span className="sb-srp__media-body">
        <span className="sb-srp__media-who">
          <span className="sb-srp__avatar sb-srp__avatar--20"><Photo src={item.avatar} /></span>
          {item.who}
        </span>
        <span className="sb-srp__media-title">{item.title}</span>
      </span>
    </button>
  )
}

export default function SearchResults({ api, query }) {
  const viewer = DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS[0]
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchSeed, setSearchSeed] = useState(query) // 검색 화면을 열 때 필드에 실을 글 — ✕ 는 빈 채로 연다
  const [tab, setTab] = useState('전체')
  const search = useSearchEntry(api, { onDdak: (q) => api.playLive(q) })
  const term = String(query || '').trim()
  const mock = () => api.showToast('검색 결과는 목업이에요 — 상품·콘텐츠는 라이브 체험에서 실제로 열려요.')

  /* 연관 검색어 — 자동완성 어휘에서 검색어 자신을 뺀 것 (Figma: 물광 쿠션 · 커버력 쿠션 · 쿠션 추천 · 지속력 좋은…) */
  const related = autocomplete(term, search.recents.map((r) => r.q))
    .map((r) => r.text)
    .filter((t) => t !== term)
  for (const extra of [`${term} 추천`, `촉촉한 ${term}`, `오래가는 ${term}`]) if (related.length < 4 && !related.includes(extra)) related.push(extra)

  const { hits, others } = searchProducts(term)
  const products = [...hits, ...others].slice(0, Math.max(4, Math.min(8, hits.length + 2)))
  const thumbs = (i) => (products[i % products.length] || SEARCH_CATALOG[i % SEARCH_CATALOG.length]).imageUrl
  const shorts = [
    `지금 라이브 · ${term} 단독 특가, 오늘만 이 가격`,
    `${term} 광채 피부 만드는 3단계`,
    `${term} 밀착력 테스트 · 8시간 뒤 비교`,
    `${term} 촉촉하게 마무리하는 손기술`,
  ].map((title, i) => ({ title, image: FACES[i], avatar: FACES[(i + 1) % 4], who: '1.2천 시청 중' }))
  const lives = [`${term} 라이브`, '메이크업 라이브', '스킨케어 라이브', '뷰티 라이브'].map((title, i) => ({ title, image: FACES[(i + 2) % 4], avatar: FACES[i], who: CREATORS[i] }))
  const posts = [
    `${term} 3종 비교해봤어요 🔍 커버력 차이가 진짜 크더라고요. 피부 타입별로 추천이 달라요`,
    `3개월 연속 재구매한 ${term} 🔥 물광 피부 원하면 이거 무조건 써야 해요`,
    `지성 피부인데 이 ${term} 쓰고 나서 피지 조절이 진짜 달라졌어요. 오전에 바르면 오후까지 유지돼요`,
    `${term} 고민하는 분들께 꼭 추천하고 싶어요. 자외선 차단에 커버력까지 완벽한 제품 찾았어요 ☀`,
  ].map((body, i) => ({ body, name: TALKERS[i], avatar: FACES[(i + 3) % 4], image: thumbs(i), likes: '23.5K', comments: '1.2K' }))

  const onTab = (name) => {
    setTab(name)
    if (name !== '전체') api.showToast(`${name} 탭은 목업이에요 — 전체 탭의 구성만 실제 데이터로 채워요.`)
  }
  const openSearch = (seed) => {
    setSearchSeed(seed)
    setSearchOpen(true)
  }

  return (
    <>
      <BgBlobs />
      <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />
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

          {/* 연관 검색어 칩 — 누르면 라우터를 거쳐 DDAK / 새 검색 결과로 */}
          <div className="sb-srp__chips" role="list" aria-label="연관 검색어">
            {related.slice(0, 6).map((t) => (
              <button key={t} type="button" role="listitem" className="sb-srp__chip" onClick={() => search.runSearch(t)}>
                {t}
              </button>
            ))}
          </div>

          <nav className="sb-srp__tabs" aria-label="검색 결과 탭">
            {TABS.map((name) => (
              <button key={name} type="button" className={'sb-srp__tab' + (tab === name ? ' is-on' : '')} onClick={() => onTab(name)}>
                {name}
              </button>
            ))}
          </nav>

          {/* DDAK 로 넘어가는 길 — 검색 결과 대신 설문→맞춤 계획 (Figma 밖, 라우터 오판 복구용) */}
          <button type="button" className="sb-srp__ddak" onClick={() => api.playLive(query)}>
            <span className="sb-srp__ddak-spark" aria-hidden="true">✦</span>
            <span className="sb-srp__ddak-text">
              <b>「{query}」 맞춤 계획 받기</b>
              <span>설문 두세 개로 내 피부·상황에 맞는 상품을 골라 드려요</span>
            </span>
            <span className="sb-srp__ddak-chevron" aria-hidden="true"><ChevronIcon /></span>
          </button>

          <section className="sb-srp__section">
            <SectionHead title="쇼츠" count={38} onMore={mock} />
            <div className="sb-srp__grid">
              {shorts.map((item) => <MediaCard key={item.title} item={item} onPick={mock} />)}
            </div>
          </section>

          <section className="sb-srp__section">
            <SectionHead title="라이브" count={38} onMore={mock} />
            <div className="sb-srp__grid">
              {lives.map((item) => <MediaCard key={item.title} item={item} live onPick={mock} />)}
            </div>
          </section>

          <section className="sb-srp__section">
            <SectionHead title="뷰티톡" count={38} onMore={mock} />
            <div className="sb-srp__grid sb-srp__grid--posts">
              {posts.map((post) => (
                <article key={post.name} className="sb-srp__post" onClick={mock}>
                  <div className="sb-srp__post-head">
                    <span className="sb-srp__avatar sb-srp__avatar--24"><Photo src={post.avatar} /></span>
                    <span className="sb-srp__post-name">{post.name}</span>
                  </div>
                  <p className="sb-srp__post-body">{post.body}</p>
                  <div className="sb-srp__post-img"><Photo src={post.image} /></div>
                  <div className="sb-srp__post-foot">
                    <span><HeartIcon />{post.likes}</span>
                    <span><CommentIcon />{post.comments}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="sb-srp__section">
            <SectionHead title="상품" count={hits.length || products.length} onMore={mock} />
            <ul className="sb-srp__grid sb-srp__grid--products">
              {products.map((p, i) => {
                const off = 10 + ((i * 7) % 25)
                return (
                  <li key={p.id}>
                    <button type="button" className="sb-srp__card" onClick={() => api.showToast(`"${p.name}" 상세는 시나리오·라이브 체험의 상품 카드에서 열려요.`)}>
                      <span className="sb-srp__thumb">
                        <Photo src={p.imageUrl} />
                        {i % 2 === 0 ? <span className="sb-srp__deal">슈퍼딜</span> : null}
                        <span className="sb-srp__mini" aria-hidden="true">
                          <Photo src={p.imageUrl} />
                        </span>
                        <span className="sb-srp__mini-plus" aria-hidden="true">+</span>
                      </span>
                      <span className="sb-srp__body">
                        <span className="sb-srp__name">{p.name}</span>
                        <span className="sb-srp__price-row">
                          <span className="sb-srp__off">{off}%</span>
                          <span className="sb-srp__price">{won(Math.round((p.price * (100 - off)) / 100 / 10) * 10)}</span>
                        </span>
                        <span className="sb-srp__delivery"><TruckIcon />무료배송</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
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
    </>
  )
}
