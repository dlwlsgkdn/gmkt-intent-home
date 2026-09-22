import React, { useEffect, useRef, useState } from 'react'

/*
 * 검색 결과 페이지(SRP)의 콘텐츠 뷰어 두 벌 — 카드를 누르면 열리는 화면 (2026-09-17).
 *   ShortsViewer  쇼츠·라이브 세로 플레이어(검정 전면 화면): 영상이 없어 스틸 사진에 느린 줌·진행 바로 재생 인상을 주고,
 *                 위/아래 스와이프·휠·방향키·화살 버튼으로 다음 영상. 오른쪽 레일(좋아요·댓글·공유), 크리에이터·팔로우, 해시태그,
 *                 상품 쇼츠는 하단 상품 칩(→ 상품 상세 패널). 라이브는 LIVE 배지·시청자 수·채팅 말풍선, 예정 방송은 「알림 받기」.
 *   BeautyTalkPost  뷰티톡 글 화면(흰 전면 페이지, 오른쪽에서 슬라이드): 작성자·본문·사진·글의 상품 카드·반응·댓글 목록 + 댓글 입력 바
 *                 (입력은 화면 로컬 상태에만 붙는다 — 서버 없음).
 * 둘 다 기기 프레임 화면 안의 fixed 층(z 240)이라 상품 상세 패널(z 250)이 그 위로 열린다. Esc 로 닫히되 상세 패널이 열려 있으면 그쪽이 먼저.
 * 사진·아이콘 조각(Photo·아이콘)은 SearchResults 와 공유한다.
 */

export function Photo({ src, alt = '', className }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span className={'sb-srp__photo-blank' + (className ? ` ${className}` : '')} aria-hidden="true" />
  return <img src={src} alt={alt} className={className} draggable={false} loading="lazy" onError={() => setFailed(true)} />
}

const icon = (d, extra = {}) => (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...extra} {...props}>
    {d}
  </svg>
)
export const ChevronIcon = icon(<path d="M9 6l6 6-6 6" />)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6L6 18" />)
export const BackIcon = icon(<path d="M15 6l-6 6 6 6" />)
export const MoreIcon = icon(
  <>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </>,
)
export const HeartIcon = ({ filled, ...p }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M12 20.5l-1.3-1.2C5.6 14.7 2.5 11.9 2.5 8.4 2.5 5.6 4.7 3.5 7.5 3.5c1.6 0 3.1.8 4.1 2 1-1.2 2.5-2 4.1-2 2.8 0 5 2.1 5 4.9 0 3.5-3.1 6.3-8.2 10.9L12 20.5z" />
  </svg>
)
export const HeartFillIcon = (p) => <HeartIcon filled {...p} />
export const CommentIcon = icon(<path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.3 1.2 4.4 3.1 5.8L5.3 21l4.6-2.3c.7.1 1.4.2 2.1.2 5.1 0 9-3.4 9-7.6S17.1 3 12 3z" />)
export const CommentFillIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.3 1.2 4.4 3.1 5.8L5.3 21l4.6-2.3c.7.1 1.4.2 2.1.2 5.1 0 9-3.4 9-7.6S17.1 3 12 3z" />
  </svg>
)
export const ShareIcon = icon(
  <>
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" />
    <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5" />
  </>,
)
export const BagIcon = icon(
  <>
    <path d="M5 8h14l-1 12H6z" />
    <path d="M9 8V6a3 3 0 016 0v2" />
  </>,
)
export const BellIcon = icon(
  <>
    <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
    <path d="M10 20a2 2 0 004 0" />
  </>,
)
export const PlayIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M8 5.5v13l10-6.5z" />
  </svg>
)
export const StarIcon = (p) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12 2.8l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.7l-5.9 3.1 1.2-6.5L2.5 9.7l6.6-.9z" />
  </svg>
)
export const TruckIcon = icon(
  <>
    <path d="M3 7h10v9H3zM13 10h4l3 3v3h-7z" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </>,
  { strokeWidth: 1.6 },
)

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`
/* 상품 상세 패널이 위에 열려 있으면 Esc 는 그쪽 몫 */
const detailOpen = () => typeof document !== 'undefined' && !!document.querySelector('.sb-product-detail')

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !detailOpen()) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

/* ── 쇼츠·라이브 플레이어 ── */
export function ShortsViewer({ items, index, live = false, onIndex, onClose, onOpenProduct, onToast }) {
  const item = items[index]
  const [dir, setDir] = useState(0) // 슬라이드 방향 — 1 다음(아래서 위로) · -1 이전
  const [paused, setPaused] = useState(false)
  const [liked, setLiked] = useState({})
  const [following, setFollowing] = useState({})
  const touchY = useRef(null)
  const wheelAt = useRef(0)
  useEscape(onClose)

  const go = (delta) => {
    const next = index + delta
    if (next < 0 || next >= items.length) return
    setDir(delta)
    setPaused(false)
    onIndex(next)
  }
  useEffect(() => {
    const onKey = (e) => {
      if (detailOpen()) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!item) return null

  const onWheel = (e) => {
    const now = Date.now()
    if (Math.abs(e.deltaY) < 24 || now - wheelAt.current < 500) return
    wheelAt.current = now
    go(e.deltaY > 0 ? 1 : -1)
  }
  const onTouchStart = (e) => {
    touchY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e) => {
    if (touchY.current == null) return
    const dy = e.changedTouches[0].clientY - touchY.current
    touchY.current = null
    if (Math.abs(dy) > 48) go(dy < 0 ? 1 : -1)
  }
  const productShot = !!item.product
  const scheduled = live && !item.live
  const likedNow = !!liked[item.id]
  const heart = () => setLiked((m) => ({ ...m, [item.id]: !m[item.id] }))

  return (
    <div className={'sb-shorts' + (paused ? ' is-paused' : '')} role="dialog" aria-modal="true" aria-label={live ? '라이브' : '쇼츠'} onWheel={onWheel} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {!scheduled ? (
        <div className="sb-shorts__progress" aria-hidden="true"><i key={item.id} /></div>
      ) : null}
      <div className="sb-shorts__top">
        <button type="button" className="sb-shorts__iconbtn" aria-label="닫기" onClick={onClose}><CloseIcon /></button>
        <span className="sb-shorts__title">{live ? '라이브' : '쇼츠'}</span>
        <button type="button" className="sb-shorts__iconbtn" aria-label="더보기" onClick={() => onToast('신고·공유 메뉴는 목업이에요.')}><MoreIcon /></button>
      </div>

      {/* 화면 — 얼굴 쇼츠는 꽉 채운 사진에 느린 줌, 상품 쇼츠는 흐린 배경 위 상품 사진. 탭 = 일시정지 */}
      <div key={item.id} className={'sb-shorts__slide' + (dir > 0 ? ' sb-shorts__slide--up' : dir < 0 ? ' sb-shorts__slide--down' : '')} onClick={() => setPaused((v) => !v)}>
        {productShot ? (
          <>
            <span className="sb-shorts__bg" style={{ backgroundImage: `url("${item.image}")` }} aria-hidden="true" />
            <Photo src={item.image} className="sb-shorts__main" />
          </>
        ) : (
          <Photo src={item.image} className="sb-shorts__cover" />
        )}
        <span className="sb-shorts__shade" aria-hidden="true" />
        {paused ? <span className="sb-shorts__pausemark" aria-hidden="true"><PlayIcon /></span> : null}
      </div>

      {live ? (
        <div className="sb-shorts__livebar">
          {item.live ? (
            <>
              <span className="sb-srp__live-badge">LIVE</span>
              <span className="sb-shorts__viewers">{item.viewers}명 시청 중</span>
            </>
          ) : (
            <span className="sb-srp__live-badge sb-srp__live-badge--soon">예정 · {item.startsAt}</span>
          )}
        </div>
      ) : null}

      {/* 본문 — 크리에이터·제목·태그·메타(+상품 칩 / 라이브 채팅) */}
      <div className="sb-shorts__body">
        {live && item.live && item.chat ? (
          <ul className="sb-shorts__chat" aria-label="라이브 채팅">
            {item.chat.map((c, i) => (
              <li key={i} style={{ animationDelay: `${i * 0.9}s` }}><b>{c.name}</b>{c.body}</li>
            ))}
          </ul>
        ) : null}
        <div className="sb-shorts__who">
          <span className="sb-srp__avatar sb-srp__avatar--32"><Photo src={item.avatar} /></span>
          <span className="sb-shorts__name">{item.who}</span>
          <button type="button" className={'sb-shorts__follow' + (following[item.who] ? ' is-on' : '')} onClick={() => setFollowing((m) => ({ ...m, [item.who]: !m[item.who] }))}>
            {following[item.who] ? '팔로잉' : '팔로우'}
          </button>
        </div>
        <p className="sb-shorts__caption">{item.title}</p>
        {item.tags ? <p className="sb-shorts__tags">{item.tags.join(' ')}</p> : null}
        {!live ? <p className="sb-shorts__meta">조회 {item.views} · {item.ago}</p> : null}
        {scheduled ? (
          <button type="button" className="sb-shorts__remind" onClick={() => onToast(`「${item.startsAt}」 방송 알림은 목업이에요.`)}>
            <BellIcon />알림 받기
          </button>
        ) : null}
        {item.product ? (
          <button type="button" className="sb-shorts__product" onClick={() => onOpenProduct(item.product)}>
            <span className="sb-shorts__product-thumb"><Photo src={item.product.imageUrl} /></span>
            <span className="sb-shorts__product-text">
              <span className="sb-shorts__product-name">{item.product.name}</span>
              <span className="sb-shorts__product-price">{item.product.dc ? <em>{item.product.dc}%</em> : null}{won(item.product.price)}</span>
            </span>
            <span className="sb-shorts__product-cta">보기</span>
          </button>
        ) : null}
      </div>

      {/* 오른쪽 레일 */}
      <div className="sb-shorts__rail">
        <button type="button" className={'sb-shorts__act' + (likedNow ? ' is-on' : '')} onClick={heart} aria-pressed={likedNow}>
          <HeartIcon filled={likedNow} /><span>{item.likes}</span>
        </button>
        <button type="button" className="sb-shorts__act" onClick={() => onToast('댓글은 목업이에요 — 뷰티톡 글에서는 댓글을 남길 수 있어요.')}>
          <CommentFillIcon /><span>{item.comments || '댓글'}</span>
        </button>
        <button type="button" className="sb-shorts__act" onClick={() => onToast('공유 링크는 목업이에요.')}>
          <ShareIcon /><span>공유</span>
        </button>
        {item.product ? (
          <button type="button" className="sb-shorts__act" onClick={() => onOpenProduct(item.product)}>
            <BagIcon /><span>상품</span>
          </button>
        ) : null}
      </div>

      {/* 이전·다음 — 마우스용 (터치는 스와이프, 키보드는 방향키) */}
      <div className="sb-shorts__nav">
        <button type="button" className="sb-shorts__navbtn" aria-label="이전" disabled={index === 0} onClick={() => go(-1)}><ChevronIcon /></button>
        <span className="sb-shorts__navpos">{index + 1}/{items.length}</span>
        <button type="button" className="sb-shorts__navbtn" aria-label="다음" disabled={index >= items.length - 1} onClick={() => go(1)}><ChevronIcon /></button>
      </div>
    </div>
  )
}

/* ── 뷰티톡 글 화면 ── */
export function BeautyTalkPost({ post, onClose, onOpenProduct, onToast }) {
  const [liked, setLiked] = useState(false)
  const [following, setFollowing] = useState(false)
  const [draft, setDraft] = useState('')
  const [comments, setComments] = useState(post.replies || [])
  const [likedComments, setLikedComments] = useState({})
  const listRef = useRef(null)
  useEscape(onClose)
  useEffect(() => {
    setComments(post.replies || [])
    setLiked(false)
    setDraft('')
  }, [post])

  const submit = () => {
    const body = draft.trim()
    if (!body) return
    setComments((rows) => [...rows, { name: '나', avatar: '', body, ago: '방금', likes: 0, mine: true }])
    setDraft('')
    requestAnimationFrame(() => {
      const el = listRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
  }
  const p = post.product

  return (
    <div className="sb-post" role="dialog" aria-modal="true" aria-label="뷰티톡 글">
      <div className="sb-post__bar">
        <button type="button" className="sb-post__iconbtn" aria-label="뒤로" onClick={onClose}><BackIcon /></button>
        <span className="sb-post__bartitle">뷰티톡</span>
        <button type="button" className="sb-post__iconbtn" aria-label="더보기" onClick={() => onToast('신고·공유 메뉴는 목업이에요.')}><MoreIcon /></button>
      </div>
      <div className="sb-post__scroll" ref={listRef}>
        <div className="sb-post__author">
          <span className="sb-srp__avatar sb-srp__avatar--36"><Photo src={post.avatar} /></span>
          <span className="sb-post__author-text">
            <span className="sb-post__author-name">{post.name}</span>
            <span className="sb-post__author-ago">{post.ago}</span>
          </span>
          <button type="button" className={'sb-post__follow' + (following ? ' is-on' : '')} onClick={() => setFollowing((v) => !v)}>{following ? '팔로잉' : '팔로우'}</button>
        </div>
        <p className="sb-post__body">{post.body}{post.more ? `\n\n${post.more}` : ''}</p>
        <div className={'sb-post__img' + (p ? ' sb-post__img--product' : '')}><Photo src={post.image} /></div>
        {p ? (
          <button type="button" className="sb-post__product" onClick={() => onOpenProduct(p)}>
            <span className="sb-post__product-thumb"><Photo src={p.imageUrl} /></span>
            <span className="sb-post__product-text">
              {p.brand ? <span className="sb-post__product-brand">{p.brand}</span> : null}
              <span className="sb-post__product-name">{p.name}</span>
              <span className="sb-post__product-price">{p.dc ? <em>{p.dc}%</em> : null}{won(p.price)}</span>
            </span>
            <span className="sb-post__product-cta">상품 보기<ChevronIcon /></span>
          </button>
        ) : null}
        <div className="sb-post__stats">
          <button type="button" className={'sb-post__stat' + (liked ? ' is-on' : '')} aria-pressed={liked} onClick={() => setLiked((v) => !v)}>
            <HeartIcon filled={liked} />{post.likes}
          </button>
          <span className="sb-post__stat"><CommentIcon />{post.comments}</span>
          <button type="button" className="sb-post__stat" onClick={() => onToast('공유 링크는 목업이에요.')}><ShareIcon />공유</button>
        </div>
        <section className="sb-post__comments" aria-label="댓글">
          <h4>댓글 <span>{post.comments}</span></h4>
          <ul>
            {comments.map((c, i) => (
              <li key={i} className={'sb-post__comment' + (c.author ? ' sb-post__comment--author' : '') + (c.mine ? ' sb-post__comment--mine' : '')}>
                <span className="sb-srp__avatar sb-srp__avatar--28">{c.avatar ? <Photo src={c.avatar} /> : <span className="sb-post__me" aria-hidden="true">나</span>}</span>
                <span className="sb-post__comment-text">
                  <span className="sb-post__comment-head">
                    <b>{c.name}</b>
                    {c.author ? <span className="sb-post__author-chip">작성자</span> : null}
                    <span>{c.ago}</span>
                  </span>
                  <span className="sb-post__comment-body">{c.body}</span>
                  <button type="button" className={'sb-post__comment-like' + (likedComments[i] ? ' is-on' : '')} onClick={() => setLikedComments((m) => ({ ...m, [i]: !m[i] }))}>
                    <HeartIcon filled={!!likedComments[i]} />{(c.likes || 0) + (likedComments[i] ? 1 : 0) || '좋아요'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <form
        className="sb-post__input"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="sb-srp__avatar sb-srp__avatar--28"><span className="sb-post__me" aria-hidden="true">나</span></span>
        <input type="text" value={draft} placeholder="댓글을 남겨보세요" aria-label="댓글 입력" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" disabled={!draft.trim()}>등록</button>
      </form>
    </div>
  )
}
