import React from 'react'
import { splitList, splitTextList } from '../store.js'
import { Img, kText, parseTableRows, youtubeThumbnail } from './support.jsx'

/* 상품 카드 썸네일 — 이미지가 있으면 실제 썸네일, 없거나 로드 실패면 이모지 목업 블록.
   외부몰 이미지는 핫링크 차단으로 깨질 수 있어 무관한 스톡 이미지(FALLBACK_IMG) 대신
   목업으로 정직하게 강등한다. 이모지도 이미지도 없으면 기존 Img(플레이스홀더) 유지 */
function ProductThumb({ p, ctx }) {
  const [failed, setFailed] = React.useState(false)
  const mock = (emoji) => (
    <div className="sb-product-card2__mock" style={{ background: p.gradient || undefined }} aria-label={p.name}>
      {p.brand ? <span>{kText(p.brand, ctx, 'brand')}</span> : null}
      <b aria-hidden="true">{emoji}</b>
    </div>
  )
  if (p.emoji) return mock(p.emoji)
  if (p.imageUrl && failed) return mock('🧴')
  if (p.imageUrl) {
    return <img src={p.imageUrl} alt={p.name} draggable={false} onError={() => setFailed(true)} />
  }
  return <Img src={p.imageUrl} alt={p.name} />
}

/* 몰 배지 색 — 지마켓/올리브영은 브랜드 색, 그 밖의 몰은 중립 */
const MALL_TONE = {
  'G마켓': 'gmarket',
  '지마켓': 'gmarket',
  'Gmarket': 'gmarket',
  '올리브영': 'oliveyoung',
  'OLIVE YOUNG': 'oliveyoung',
}

/* 추천도 말풍선 — 배지를 누르면 왜 이 점수인지 설명한다 (Figma 상품카드/MatchTooltip) */
const MATCH_LABEL = '추천도' // Figma 상품카드 배지 — 영문 MATCH에서 한글로 통일
function MatchBadge({ p, ctx, score }) {
  const [open, setOpen] = React.useState(false)
  const label = MATCH_LABEL
  const note = p.matchNote || '프로필과 설문 답변을 전문가 기준으로 분석해 계산한 추천도예요.'
  return (
    <span className="sb-match">
      <button
        type="button"
        className="sb-match__badge"
        title="추천도 설명 보기"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span className="sb-match__label">{label}</span>
        <span className="sb-match__score">{score}%</span>
      </button>
      {open ? (
        <span className="sb-match__tip" role="tooltip">
          <b>
            {label} {score}% — {kText(p.matchHeadline, ctx, 'matchHeadline')}
          </b>
          <em>{kText(note, ctx, 'matchNote')}</em>
        </span>
      ) : null}
    </span>
  )
}

/* AI 안내 말풍선 — 계획 타이틀 옆 ⓘ 토글 (Figma "AI 안내 툴팁") */
function AiNotice({ p, ctx }) {
  const [open, setOpen] = React.useState(!!p.noticeOpen)
  if (!p.notice) return null
  return (
    <>
      <button
        type="button"
        className="sb-ai-notice__dot"
        aria-label="AI 안내 보기"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open ? (
        <span className="sb-ai-notice__tip" role="tooltip">
          {kText(p.notice, ctx, 'notice')}
        </span>
      ) : null}
    </>
  )
}

/* 비포/애프터 비교 — 손잡이를 끌면 경계가 움직인다 */
/** data URL → 다운로드 폴더 저장. 확장자는 실제 미디어 타입에서 딴다 (정밀=png, 기기 합성=jpeg) */
function downloadDataUrl(dataUrl, baseName) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return
  const ext = /^data:image\/(\w+)/.exec(dataUrl)?.[1] === 'png' ? 'png' : 'jpg'
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${baseName}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function BeforeAfter({ p, ctx }) {
  const [split, setSplit] = React.useState(Math.max(0, Math.min(100, Number(p.split) || 50)))
  const boxRef = React.useRef(null)
  const dragging = React.useRef(false)
  const interactive = ctx.mode === 'player'
  const move = (clientX) => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    if (!rect.width) return
    setSplit(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)))
  }
  return (
    <div
      ref={boxRef}
      className="sb-ba__photo"
      onPointerDown={(e) => {
        if (!interactive) return
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e.clientX)
      }}
      onPointerMove={(e) => { if (interactive && dragging.current) move(e.clientX) }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
    >
      {/* AFTER — 룩 톤(tone)이 있으면 같은 사진 위에 그 색조를 올린 "가상 메이크업" 표현이다.
          실제 합성 엔진이 아니라 화면에서 보여주는 미리보기라 하단 고지 문구와 한 벌로 쓴다.
          afterState는 라이브 전용 진행 표시다: 'skeleton'이면 아직 합성이 없어 이 자리를 통째로
          로딩으로 덮고(원본은 왼쪽에 그대로 보인다), 'refining'이면 1단계 그림 위에 반투명
          로딩을 얹어 "더 정밀한 그림을 만드는 중"을 보여 준다 */}
      <div
        className={'sb-ba__layer sb-ba__layer--after' + (p.tone ? ' sb-ba__layer--synth' : '')}
        data-tone={p.tone || undefined}
      >
        {p.afterState !== 'skeleton' && <Img src={p.afterImage || p.beforeImage} alt={p.afterLabel || 'AFTER'} />}
      </div>
      {p.afterState === 'skeleton' || p.afterState === 'refining' ? (
        <div
          className={'sb-ba__loading' + (p.afterState === 'refining' ? ' is-soft' : '')}
          style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          role="status"
          aria-live="polite"
        >
          <span className="sb-ba__loading-label">
            {p.afterState === 'refining' ? '더 정밀하게 만드는 중…' : '메이크업을 올리는 중…'}
          </span>
        </div>
      ) : null}
      <div className="sb-ba__layer sb-ba__layer--before" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
        <Img src={p.beforeImage} alt={p.beforeLabel || 'BEFORE'} />
      </div>
      <span className="sb-ba__seam" style={{ left: `${split}%` }}>
        <span className="sb-ba__handle" aria-hidden="true">‹ ›</span>
      </span>
      <span className="sb-ba__badge sb-ba__badge--before">{kText(p.beforeLabel, ctx, 'beforeLabel')}</span>
      <span className="sb-ba__badge sb-ba__badge--after">{kText(p.afterLabel, ctx, 'afterLabel')}</span>
      {p.hint ? <span className="sb-ba__hint">◉ {kText(p.hint, ctx, 'hint')}</span> : null}
    </div>
  )
}

/* 도움이 되셨나요 — 좋아요/싫어요 (Figma 피드백/Card default·좋아요·싫어요) */
function FeedbackButtons({ p, ctx }) {
  const [state, setState] = React.useState(p.state || 'none')
  const interactive = ctx.mode === 'player'
  const btn = (kind, label, path) => (
    <button
      type="button"
      className={'sb-fbcard__btn' + (state === kind ? ' is-on' : '')}
      aria-label={label}
      aria-pressed={state === kind}
      onClick={() => { if (interactive) setState((prev) => (prev === kind ? 'none' : kind)) }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{path}</svg>
    </button>
  )
  return (
    <div className="sb-fbcard__btns">
      {btn('like', '도움이 됐어요', <path d="M2 21h3V9H2v12zm19.7-10.3c.2-.3.3-.6.3-1V8a2 2 0 0 0-2-2h-5.2l.8-3.8v-.3c0-.4-.2-.8-.4-1L14.2 0 7.6 6.6c-.4.4-.6.9-.6 1.4V19a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7c0-.4.1-.8-.1-1.1z" />)}
      {btn('dislike', '아쉬웠어요', <path d="M19 3h3v12h-3V3zM2.3 13.3c-.2.3-.3.6-.3 1V16a2 2 0 0 0 2 2h5.2l-.8 3.8v.3c0 .4.2.8.4 1l1 1 6.6-6.6c.4-.4.6-.9.6-1.4V5a2 2 0 0 0-2-2H6c-.8 0-1.5.5-1.8 1.2l-3 7c0 .4-.1.8.1 1.1z" />)}
    </div>
  )
}

/* 계획 단계 컴포넌트 — 타이틀·설문 요약·계획 항목·상품/미디어 카드·성분 비교·체크리스트·CTA */
export const PLAN_COMPONENTS = {
  surveySummary: {
    label: '설문 요약 패널',
    stage: 'plan',
    icon: '🧾',
    hint: '프로필 + 설문에서 고른 답을 라벨/값 칩으로 요약',
    defaults: { title: '설문 요약', hiddenProfile: '', hiddenQuestions: '' },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      // 요약 칩 관리 편집기가 hiddenQuestions까지 함께 편집한다
      { key: 'hiddenProfile', label: '표시 항목 관리', kind: 'summaryChips', questionsKey: 'hiddenQuestions' },
    ],
    render: (p, ctx) => {
      const rawData =
        (ctx.mode === 'player' ? ctx.player.summary : ctx.summaryPreview) || { profile: [], questions: [] }
      // 컴포넌트별 숨김 — 프로필 칩은 라벨, 질문은 문구로 매칭 (인스펙터 "표시 항목 관리")
      const hiddenProfile = splitList(p.hiddenProfile)
      const hiddenQuestions = splitTextList(p.hiddenQuestions)
      const profile = (Array.isArray(rawData.profile) ? rawData.profile : [])
        .filter((it) => !hiddenProfile.includes(it.label))
      const questions = (Array.isArray(rawData.questions) ? rawData.questions : [])
        .filter((q) => !hiddenQuestions.includes(String(q.q || '').trim()))
      const chips = [
        ...profile.map((it) => ({ label: it.label, value: it.value })),
        ...questions.map((q) => ({ label: q.q, value: q.a })),
      ]
      // 원본 clean-survey-lock 컨테이너 위에 칩 랩 레이아웃 (Figma "설문 요약")
      return (
        <div className="clean-survey-lock sb-summary" style={{ display: 'block' }}>
          <div className="clean-survey-lock__head">
            <p className="clean-survey-lock__title">{kText(p.title, ctx, 'title')}</p>
          </div>
          <div className="sb-summary__chips">
            {chips.length === 0 && (
              <span className="sb-pinned-panel__empty">설문 질문과 프로필 항목이 여기에 요약돼요.</span>
            )}
            {chips.map((chip, i) => (
              <span key={i} className="sb-summary__chip">
                <span className="sb-summary__label">{chip.label}</span>
                <span className="sb-summary__value">{chip.value}</span>
              </span>
            ))}
          </div>
        </div>
      )
    },
  },

  planTitle: {
    label: '계획 타이틀',
    stage: 'plan',
    icon: '🧭',
    hint: '"질의"에 대한 + 형광 강조 제목 + AI 안내 툴팁',
    defaults: {
      query: '출근 전 10분 안에 안 무너지는 데일리 메이크업',
      title: '딱 맞춤 계획입니다.',
      notice: '설문 답변을 바탕으로 AI가 만든 계획이에요.\n내용이 사실과 다를 수 있으니 확인해 주세요.',
      noticeOpen: false,
      highlight: true,
    },
    fields: [
      { key: 'query', label: '사용자 질의 (비우면 숨김)', kind: 'textarea' },
      { key: 'title', label: '제목', kind: 'textarea' },
      { key: 'notice', label: 'AI 안내 문구 (비우면 ⓘ 숨김)', kind: 'textarea' },
      { key: 'noticeOpen', label: 'AI 안내를 펼친 채로', kind: 'toggle' },
      { key: 'highlight', label: '제목 밑줄 강조', kind: 'toggle', defaultValue: true },
    ],
    render: (p, ctx) => (
      <div className="sb-static sb-plan-head">
        {p.query ? (
          <p className="sb-plan-head__query">
            “{kText(p.query, ctx, 'query')}”에 대한
          </p>
        ) : null}
        <h2 className="sb-plan-head__title">
          <span className="sb-plan-head__text">{kText(p.title, ctx, 'title')}</span>
          <AiNotice p={p} ctx={ctx} />
        </h2>
        {p.highlight === false ? null : <span className="sb-plan-head__mark" aria-hidden="true" />}
      </div>
    ),
  },

  planStep: {
    label: '계획 항목',
    stage: 'plan',
    icon: '🪜',
    hint: '제목 + 중요 배지 + 한 줄 요약 + 불릿',
    defaults: {
      badge: '중요',
      title: '베이스 정리',
      subtitle: '속광은 남기고 유분만 덜어내는 얇은 베이스',
      points: '제품 수를 줄이고 순서를 단순하게 잡습니다.\n코·눈가처럼 먼저 무너지는 부위 기준으로 고정력을 봅니다.\n파우더는 T존에만 얇게 올립니다.',
      body: '',
    },
    fields: [
      { key: 'title', label: '항목 제목', kind: 'text' },
      { key: 'badge', label: '배지 문구 (비우면 숨김)', kind: 'text' },
      { key: 'subtitle', label: '한 줄 요약', kind: 'text' },
      { key: 'points', label: '불릿', kind: 'stringList', list: true },
      { key: 'body', label: '문단 (불릿 대신 쓸 때)', kind: 'textarea' },
    ],
    render: (p, ctx) => {
      // 구버전 데이터 호환: desc(설명)만 있으면 한 줄 요약 자리에 쓴다
      const subtitle = p.subtitle || p.desc || ''
      const bullets = splitTextList(p.points)
      // 구 badge가 'STEP 2' 같은 단계 표기였던 데이터는 배지로 그대로 노출하지 않는다
      const badge = /^\s*step\b/i.test(String(p.badge || '')) ? '' : p.badge
      return (
        <div className="sb-plan-step">
          <div className="sb-plan-step__head">
            <h3 className="sb-plan-step__title">{kText(p.title, ctx, 'title')}</h3>
            {badge ? <span className="sb-plan-step__badge">{kText(badge, ctx, 'badge')}</span> : null}
          </div>
          {subtitle ? <p className="sb-plan-step__sub">{kText(subtitle, ctx, 'subtitle')}</p> : null}
          {bullets.length ? (
            <ul className="sb-plan-step__bullets">
              {bullets.map((pt, i) => (
                <li key={i}>
                  <span className="sb-plan-step__dot" aria-hidden="true">·</span>
                  <span>{kText(pt, ctx)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {p.body ? <p className="sb-plan-step__body">{kText(p.body, ctx, 'body')}</p> : null}
        </div>
      )
    },
  },

  productCard: {
    label: '추천 상품 카드',
    stage: 'plan',
    icon: '🛍️',
    hint: '추천도 배지 + 몰 배지 + 담기 (카드 클릭 = 상세보기)',
    defaultW: 200,
    defaults: {
      brand: '',
      name: '웜톤 결광 쿠션 21호',
      price: '27,900',
      was: '',
      score: '92',
      matchHeadline: '잘 맞는 상품이에요',
      matchNote: '프로필과 설문 답변을 전문가 기준으로 분석해 계산한 추천도예요.',
      summary: '',
      emoji: '',
      gradient: '',
      external: false,
      mall: '',
      url: '',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'brand', label: '브랜드', kind: 'text' },
      { key: 'name', label: '상품명', kind: 'text' },
      { key: 'price', label: '가격 (원 제외)', kind: 'text' },
      { key: 'was', label: '정가 (원 제외)', kind: 'text' },
      { key: 'score', label: '추천도 (%)', kind: 'text' },
      { key: 'matchHeadline', label: '추천도 말풍선 한 줄', kind: 'text' },
      { key: 'matchNote', label: '추천도 말풍선 설명', kind: 'textarea' },
      { key: 'summary', label: '추천 이유 (줄바꿈 구분)', kind: 'textarea' },
      { key: 'emoji', label: '상품 이모지', kind: 'text' },
      { key: 'gradient', label: '상품 배경 CSS', kind: 'text' },
      { key: 'external', label: '외부몰 상품', kind: 'toggle' },
      { key: 'mall', label: '몰 이름 (예: 올리브영)', kind: 'text' },
      { key: 'url', label: '상품 페이지 URL (상세보기 패널)', kind: 'url', placeholder: 'https://...' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => {
      const isPlayer = ctx.mode === 'player'
      const score = String(p.score || '').trim() // 없으면 추천도 배지를 그리지 않는다
      const mall = p.external ? p.mall || '외부몰' : p.mall || 'G마켓'
      const tone = MALL_TONE[mall] || (p.external ? 'plain' : 'gmarket')
      const cart = (isPlayer && ctx.player.cart) || []
      const added = cart.includes(p.name)
      const openDetail = () => {
        if (!isPlayer) return
        // 카드 클릭 = 상품 PDP (Player/LivePlayer의 ProductDetailPanel)
        ctx.player.openProduct({ name: p.name, mall, url: p.url })
      }
      return (
        <div className="sb-product-card2">
          <div
            className="sb-product-card2__thumb"
            role={isPlayer ? 'button' : undefined}
            tabIndex={isPlayer ? 0 : undefined}
            title={isPlayer ? '상품 상세보기' : undefined}
            onClick={openDetail}
            onKeyDown={(e) => {
              if (isPlayer && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                openDetail()
              }
            }}
          >
            {score ? <MatchBadge p={p} ctx={ctx} score={score} /> : null}
            <span className={'sb-mall-badge sb-mall-badge--' + tone}>{mall}</span>
            <ProductThumb p={p} ctx={ctx} />
          </div>
          <div className="sb-product-card2__body">
            {p.brand ? <p className="sb-product-card2__brand">{kText(p.brand, ctx, 'brand')}</p> : null}
            <h4 className="sb-product-card2__name">{kText(p.name, ctx, 'name')}</h4>
            {p.summary ? (
              <ul className="sb-product-card2__summary">
                {String(p.summary).split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => (
                  <li key={index}>{kText(line, ctx)}</li>
                ))}
              </ul>
            ) : null}
            <div className="sb-product-card2__pricebox">
              {p.was ? <span className="sb-product-card2__was">{kText(p.was, ctx, 'was')}원</span> : null}
              <span className="sb-product-card2__price">
                <b>{kText(p.price, ctx, 'price')}</b>
                <em>원</em>
              </span>
            </div>
            <button
              type="button"
              className={
                'sb-cart-btn' +
                (added ? ' is-added' : '') +
                (p.external ? ' is-blocked' : '')
              }
              disabled={!!p.external}
              title={p.external ? '지마켓 상품만 담을 수 있어요' : '쓰레드에 담기'}
              onClick={() => { if (isPlayer && !p.external && !added) ctx.player.addToCart(p.name) }}
            >
              {p.external ? '담기불가' : added ? '✓ 담음' : '담기'}
            </button>
          </div>
        </div>
      )
    },
  },

  videoCard: {
    label: '외부 영상 카드',
    stage: 'plan',
    icon: '🎬',
    hint: '유튜브 등 외부 영상 — 썸네일 + 출처 · 채널 ↗',
    defaultW: 174,
    defaults: {
      source: 'YouTube',
      title: '출근 전 베이스 10분 루틴',
      channel: '언니의파우치',
      duration: '',
      imageUrl: './makeup-clone-assets/d9b261330f3ffccf.avif',
      url: '',
    },
    fields: [
      { key: 'source', label: '매체 (YouTube/TikTok 등)', kind: 'text' },
      { key: 'title', label: '영상 제목', kind: 'text' },
      { key: 'channel', label: '채널 이름', kind: 'text' },
      { key: 'duration', label: '길이 (비우면 숨김)', kind: 'text' },
      { key: 'url', label: '영상 링크 URL', kind: 'url', placeholder: 'https://www.youtube.com/watch?v=...' },
      { key: 'imageUrl', label: '썸네일 URL (비우면 YouTube 자동)', kind: 'url' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-content-card sb-content-card--video"
        role={ctx.mode === 'player' ? 'link' : undefined}
        tabIndex={ctx.mode === 'player' ? 0 : undefined}
        title={ctx.mode === 'player' ? `${p.source} 영상 새 탭에서 열기` : undefined}
        onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(`${p.source} 영상`, p.url) }}
        onKeyDown={(e) => {
          if (ctx.mode === 'player' && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            ctx.player.openExternal(`${p.source} 영상`, p.url)
          }
        }}
      >
        <div className="sb-content-card__thumb">
          <Img src={p.imageUrl || youtubeThumbnail(p.url)} alt={p.title} />
          <span className="sb-content-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
          </span>
          {p.duration ? <span className="sb-content-card__duration">{p.duration}</span> : null}
        </div>
        <div className="sb-content-card__meta">
          <p className="sb-content-card__source">
            <span>{kText(p.channel, ctx, 'channel')}</span>
            <i aria-hidden="true">·</i>
            <span>{kText(p.source, ctx, 'source')}</span>
            <b aria-hidden="true">↗</b>
          </p>
          <p className="sb-content-card__title">{kText(p.title, ctx, 'title')}</p>
        </div>
      </div>
    ),
  },

  articleCard: {
    label: '외부 게시글 카드',
    stage: 'plan',
    icon: '📰',
    hint: '블로그/커뮤니티 글 — 썸네일 + 출처 · 매체 ↗',
    defaultW: 174,
    defaults: {
      source: 'Blog',
      title: '속광 베이스 표현 예시',
      author: '뷰티노트',
      snippet: '',
      imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif',
      url: '',
    },
    fields: [
      { key: 'source', label: '매체 (Blog/커뮤니티 등)', kind: 'text' },
      { key: 'title', label: '글 제목', kind: 'text' },
      { key: 'author', label: '작성자 · 매체명', kind: 'text' },
      { key: 'snippet', label: '본문 미리보기 (비우면 숨김)', kind: 'textarea' },
      { key: 'url', label: '게시글 링크 URL', kind: 'url', placeholder: 'https://blog.naver.com/...' },
      { key: 'imageUrl', label: '대표 이미지 URL', kind: 'url' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-content-card sb-content-card--article"
        role={ctx.mode === 'player' ? 'link' : undefined}
        tabIndex={ctx.mode === 'player' ? 0 : undefined}
        title={ctx.mode === 'player' ? `${p.source} 게시글 새 탭에서 열기` : undefined}
        onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(`${p.source} 게시글`, p.url) }}
        onKeyDown={(e) => {
          if (ctx.mode === 'player' && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            ctx.player.openExternal(`${p.source} 게시글`, p.url)
          }
        }}
      >
        <div className="sb-content-card__thumb">
          <Img src={p.imageUrl} alt={p.title} />
        </div>
        <div className="sb-content-card__meta">
          <p className="sb-content-card__source">
            <span>{kText(p.author, ctx, 'author')}</span>
            <i aria-hidden="true">·</i>
            <span>{kText(p.source, ctx, 'source')}</span>
            <b aria-hidden="true">↗</b>
          </p>
          <p className="sb-content-card__title">{kText(p.title, ctx, 'title')}</p>
          {p.snippet ? <p className="sb-content-card__snippet">{kText(p.snippet, ctx, 'snippet')}</p> : null}
        </div>
      </div>
    ),
  },

  ingredientCompare: {
    label: '성분 비교표',
    stage: 'plan',
    icon: '⚖️',
    hint: '추천 vs 대안 두 제품을 항목별로 나란히',
    defaults: {
      caption: '두 제품 성분을 나란히 비교했어요',
      pickBadge: '추천',
      pickName: '시카랩 판테놀 약산성 클렌징폼 150ml',
      pickMeta: '클렌징 폼 · 150ml',
      altBadge: '대안',
      altName: '퓨어덤 마데카 딥클렌징 폼 120ml',
      altMeta: '클렌징 폼 · 120ml',
      rows: '약산성 5.5|pH|약산성 5.0\n무향|향|시트러스 향\n시카 · 판테놀|진정 성분|마데카소사이드\n없음|자극 성분|향료 1종\n부드러운 편|세정력|강한 편',
    },
    fields: [
      { key: 'caption', label: '머리 문구 (비우면 숨김)', kind: 'text' },
      { key: 'pickBadge', label: '왼쪽 배지', kind: 'text' },
      { key: 'pickName', label: '왼쪽 제품명', kind: 'text' },
      { key: 'pickMeta', label: '왼쪽 부가 정보', kind: 'text' },
      { key: 'altBadge', label: '오른쪽 배지', kind: 'text' },
      { key: 'altName', label: '오른쪽 제품명', kind: 'text' },
      { key: 'altMeta', label: '오른쪽 부가 정보', kind: 'text' },
      { key: 'rows', label: '비교 행 (왼쪽|항목|오른쪽)', kind: 'table', list: true },
    ],
    render: (p, ctx) => (
      <div className="sb-compare">
        {p.caption ? <div className="sb-compare__caption">{kText(p.caption, ctx, 'caption')}</div> : null}
        <div className="sb-compare__body">
          <div className="sb-compare__head">
            <div className="sb-compare__product is-pick">
              <span className="sb-compare__tag">{kText(p.pickBadge, ctx, 'pickBadge')}</span>
              <p className="sb-compare__name">{kText(p.pickName, ctx, 'pickName')}</p>
              {p.pickMeta ? <p className="sb-compare__meta">{kText(p.pickMeta, ctx, 'pickMeta')}</p> : null}
            </div>
            <span className="sb-compare__vs" aria-hidden="true">VS</span>
            <div className="sb-compare__product">
              <span className="sb-compare__tag">{kText(p.altBadge, ctx, 'altBadge')}</span>
              <p className="sb-compare__name">{kText(p.altName, ctx, 'altName')}</p>
              {p.altMeta ? <p className="sb-compare__meta">{kText(p.altMeta, ctx, 'altMeta')}</p> : null}
            </div>
          </div>
          <div className="sb-compare__rows">
            {parseTableRows(p.rows).map((row, i) => (
              <div key={i} className="sb-compare__row">
                <span className="sb-compare__cell">{kText(row[0] || '', ctx)}</span>
                <span className="sb-compare__key">{kText(row[1] || '', ctx)}</span>
                <span className="sb-compare__cell">{kText(row[2] || '', ctx)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },

  cautionIngredients: {
    label: '주의 성분 카드',
    stage: 'plan',
    icon: '⚠️',
    hint: '민감 피부가 먼저 확인하면 좋은 성분 목록',
    defaults: {
      title: '주의해서 볼 성분',
      desc: '민감 피부가 먼저 확인하면 좋은 성분이에요. 이번 두 제품 중 "퓨어덤 마데카 딥클렌징 폼"에 합성 향료가 들어 있어요.',
      items: '멘톨|청량감↑ 그러나 붉은기·따가움 유발 가능\n고함량 알코올|수분 증발 · 장벽 약화 우려\n합성 향료|면도 직후 자극 가능',
    },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'desc', label: '설명 (비우면 숨김)', kind: 'textarea' },
      { key: 'items', label: '성분 (이름|설명)', kind: 'table', list: true },
    ],
    render: (p, ctx) => (
      <div className="sb-caution">
        <p className="sb-caution__head">
          <span className="sb-caution__mark" aria-hidden="true">⚠</span>
          {kText(p.title, ctx, 'title')}
        </p>
        {p.desc ? <p className="sb-caution__desc">{kText(p.desc, ctx, 'desc')}</p> : null}
        <div className="sb-caution__rows">
          {parseTableRows(p.items).map((row, i) => (
            <div key={i} className="sb-caution__row">
              <span className="sb-caution__name">{kText(row[0] || '', ctx)}</span>
              <span className="sb-caution__note">{kText(row.slice(1).join(' · '), ctx)}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },

  beforeAfter: {
    label: '비포/애프터 비교',
    stage: 'plan',
    icon: '🪞',
    hint: '내 사진에 AI로 올려본 모습 — 손잡이를 끌어 비교',
    defaults: {
      title: '코랄 생기 메이크업',
      desc: '내 사진에 AI로 올려본 모습이에요. 실제 발색은 피부톤 · 조명에 따라 다를 수 있어요.',
      beforeLabel: 'BEFORE',
      afterLabel: 'AFTER',
      beforeImage: '',
      afterImage: '', // 비우면 BEFORE와 같은 사진 — 차이는 tone이 만든다 (가상 메이크업 투영)
      tone: '',
      split: '50',
      hint: '', // 기본은 표시하지 않는다 — 손잡이는 보면 아는 조작이라 알약이 그림을 가린다
      disclaimer: '실제 발색은 피부톤 · 조명에 따라 다를 수 있어요',
    },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'desc', label: '설명', kind: 'textarea' },
      { key: 'beforeImage', label: 'BEFORE 이미지 URL', kind: 'url' },
      { key: 'afterImage', label: 'AFTER 이미지 URL (비우면 BEFORE와 같은 사진)', kind: 'url' },
      {
        key: 'tone',
        label: '올려 볼 룩 색조',
        kind: 'select',
        defaultValue: '',
        options: [
          { value: '', label: '없음 (사진 그대로)' },
          { value: 'coral', label: '코랄' },
          { value: 'rose', label: '로즈' },
          { value: 'red', label: '레드' },
          { value: 'peach', label: '피치' },
          { value: 'brown', label: '브라운' },
          { value: 'plum', label: '플럼' },
        ],
      },
      { key: 'beforeLabel', label: '왼쪽 배지', kind: 'text' },
      { key: 'afterLabel', label: '오른쪽 배지', kind: 'text' },
      { key: 'split', label: '경계 위치 (%)', kind: 'text' },
      { key: 'hint', label: '안내 알약 (비우면 숨김)', kind: 'text' },
      { key: 'disclaimer', label: '하단 고지 (비우면 숨김)', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div className="sb-ba">
        {p.title ? <h3 className="sb-ba__title">{kText(p.title, ctx, 'title')}</h3> : null}
        {p.desc ? <p className="sb-ba__desc">{kText(p.desc, ctx, 'desc')}</p> : null}
        <BeforeAfter p={p} ctx={ctx} />
        {p.disclaimer ? <p className="sb-ba__note">{kText(p.disclaimer, ctx, 'disclaimer')}</p> : null}
        {/* 기기 다운로드 폴더로 저장 — 합성 결과(data URL)가 있을 때만 (라이브 투영이 downloadable을 단다).
            자동 저장은 브라우저가 허용하지 않으므로 명시적 버튼이고, 되가져오기는 사진 선택 시트의
            "앨범에서 사진 선택"이 그대로 받는다 */}
        {p.downloadable && ctx.mode === 'player' ? (
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--tiny sb-ba__save"
            onClick={() => downloadDataUrl(p.afterImage, `ddak-makeup-${p.tone || 'look'}`)}
          >
            ⬇ 메이크업 사진 저장
          </button>
        ) : null}
      </div>
    ),
  },

  feedbackCard: {
    label: '도움 여부 카드',
    stage: 'plan',
    icon: '👍',
    hint: '"도움이 되셨나요?" 좋아요/싫어요',
    defaults: { question: '도움이 되셨나요?', state: 'none' },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'text' },
      {
        key: 'state',
        label: '미리보기 상태',
        kind: 'select',
        defaultValue: 'none',
        options: [
          { value: 'none', label: '선택 전' },
          { value: 'like', label: '좋아요' },
          { value: 'dislike', label: '싫어요' },
        ],
      },
    ],
    render: (p, ctx) => (
      <div className="sb-fbcard">
        <p className="sb-fbcard__q">{kText(p.question, ctx, 'question')}</p>
        <FeedbackButtons p={p} ctx={ctx} />
      </div>
    ),
  },

  checklist: {
    label: '체크리스트 카드',
    stage: 'plan',
    icon: '✅',
    hint: '확인할 항목 목록',
    defaults: {
      title: '구매 전 확인 리스트',
      items: '유통기한 12개월 이상, 무향 여부, 리필 여부',
    },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'items', label: '항목', kind: 'stringList', list: true },
    ],
    render: (p, ctx) => (
      <div className="sb-checklist">
        <p className="sb-checklist__title">{kText(p.title, ctx, 'title')}</p>
        <ul className="sb-checklist__items">
          {splitTextList(p.items).map((it, i) => (
            <li key={i}>
              <span className="sb-checklist__box" aria-hidden="true" />
              <span>{kText(it, ctx)}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },

  ctaBar: {
    label: '담기 요약 · 결제 바',
    stage: 'plan',
    icon: '💳',
    hint: '계획 하단 담은 상품 요약 (버튼 문구를 비우면 요약만)',
    defaults: { countLabel: '2개 담음', price: '43,100원', buttonText: '' },
    fields: [
      { key: 'countLabel', label: '선택 요약', kind: 'text' },
      { key: 'price', label: '금액', kind: 'text' },
      { key: 'buttonText', label: '버튼 문구 (비우면 숨김)', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div className="sb-cta-bar">
        <div className="sb-cta-bar__sum">
          <p className="sb-cta-bar__count">{kText(p.countLabel, ctx, 'countLabel')}</p>
          <p className="sb-cta-bar__price">{kText(p.price, ctx, 'price')}</p>
        </div>
        {p.buttonText ? (
          <button
            type="button"
            className="sb-cta-bar__btn"
            onClick={() => { if (ctx.mode === 'player') ctx.player.complete() }}
          >
            {kText(p.buttonText, ctx, 'buttonText')}
          </button>
        ) : null}
      </div>
    ),
  },
}
