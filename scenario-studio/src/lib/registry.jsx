import React from 'react'
import { splitList, splitOptions } from './store.js'

/*
 * 컴포넌트 레지스트리
 *  - stage: 이 컴포넌트가 기본으로 속하는 단계 (explore | survey | plan | common)
 *  - fields: 인스펙터에서 편집 가능한 플레이스홀더 정의
 *  - render(props, ctx): ctx.mode = 'canvas' | 'player'
 *    ctx.player = { query, setQuery, submitQuery, answers, setAnswer, itemId }
 */

const FALLBACK_IMG = './makeup-clone-assets/d9b261330f3ffccf.avif'

function Img({ src, alt }) {
  return <img src={src || FALLBACK_IMG} alt={alt || ''} onError={(e) => { e.currentTarget.src = FALLBACK_IMG }} />
}

/* 텍스트 안의 [[키워드]]를 점선 밑줄로 렌더 — 플레이어에서 클릭하면 설명 모달.
   사전은 탐색 페이지 편집기의 '키워드 사전'에서 관리한다. */
export function kText(text, ctx) {
  const str = String(text ?? '')
  if (!str.includes('[[')) return str
  const parts = str.split(/(\[\[[^\]]+\]\])/g)
  return parts.map((part, i) => {
    const m = part.match(/^\[\[([^\]]+)\]\]$/)
    if (!m) return part
    const word = m[1]
    return (
      <span
        key={i}
        role="button"
        tabIndex={0}
        className="keyword-detail-text"
        onClick={(e) => {
          if (ctx && ctx.mode === 'player' && ctx.player.showKeyword) {
            e.stopPropagation()
            ctx.player.showKeyword(word)
          }
        }}
      >
        {word}
      </span>
    )
  })
}

/* 마켓 태그: 지마켓 상품 vs 외부몰 상품 구분 표시 */
function MarketTag({ external, mall }) {
  return external ? (
    <span className="sb-market-tag sb-market-tag--external">외부몰{mall ? ` · ${mall}` : ''}</span>
  ) : (
    <span className="sb-market-tag sb-market-tag--gmarket">G마켓</span>
  )
}

export const LIBRARY = {
  /* ─────────── 탐색 단계 ─────────── */
  greeting: {
    label: '인사말 배너',
    stage: 'explore',
    icon: '💬',
    hint: '홈 상단의 그라데이션 밑줄 인사 문구',
    defaults: { text: '유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?' },
    fields: [{ key: 'text', label: '인사말 문구', kind: 'textarea' }],
    render: (p) => (
      <div className="beauty-greeting sb-static">
        <span>{p.text}</span>
      </div>
    ),
  },

  searchBox: {
    label: '탐색 검색창',
    stage: 'explore',
    icon: '🔍',
    hint: '시나리오의 시작 질문을 입력받는 검색창',
    defaults: { placeholder: '예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업' },
    fields: [{ key: 'placeholder', label: '플레이스홀더 문구', kind: 'text' }],
    render: (p, ctx) => {
      const isPlayer = ctx.mode === 'player'
      const value = isPlayer ? ctx.player.query : ''
      return (
        <form
          className="clean-search sb-static group"
          onSubmit={(e) => {
            e.preventDefault()
            if (isPlayer && value.trim()) ctx.player.submitQuery()
          }}
        >
          <div className="clean-search__box">
            <textarea
              rows={1}
              placeholder={p.placeholder}
              className="resize-none overflow-hidden"
              value={value}
              readOnly={!isPlayer}
              onChange={(e) => isPlayer && ctx.player.setQuery(e.target.value)}
            />
            <button
              type="submit"
              id="submitBtn"
              className="top-1/2 -translate-y-1/2 bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="검색"
              disabled={!isPlayer || !value.trim()}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </button>
          </div>
        </form>
      )
    },
  },

  tagRow: {
    label: '키워드 칩 목록',
    stage: 'explore',
    icon: '🏷️',
    hint: '검색창 아래 해시태그 칩. 쉼표로 구분',
    defaults: { tags: '출근_10분룩, AI_페이스룩, 립스틱_전색발색, 성분_궁합체크' },
    fields: [{ key: 'tags', label: '칩 목록 (쉼표로 구분)', kind: 'textarea' }],
    render: (p, ctx) => (
      <div className="clean-tag-row sb-static">
        {splitList(p.tags).map((tag, i) => (
          <button
            key={i}
            type="button"
            className="suggestion-tag"
            onClick={() => {
              if (ctx.mode === 'player') ctx.player.setQuery(tag.replace(/_/g, ' '))
            }}
          >
            #{tag}
          </button>
        ))}
      </div>
    ),
  },

  storyFeature: {
    label: '피처 스토리 카드 (대형)',
    stage: 'explore',
    icon: '🖼️',
    hint: '웹진 스타일 대형 이미지 카드',
    defaults: {
      kicker: 'Base Notes',
      title: '속광은 남기고 유분만 덜어내는 베이스',
      desc: '최근 쓰레드에서 반복된 키워드: 무너짐, 들뜸, 얇은 커버.',
      imageUrl: './makeup-clone-assets/d9b261330f3ffccf.avif',
    },
    fields: [
      { key: 'kicker', label: '키커(작은 라벨)', kind: 'text' },
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'desc', label: '설명', kind: 'textarea' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <article className="beauty-story beauty-story--feature sb-story sb-story--feature">
        <span
          className="beauty-story__media"
          role="button"
          onClick={() => { if (ctx.mode === 'player') ctx.player.setQuery(p.title) }}
        >
          <Img src={p.imageUrl} alt={p.title} />
        </span>
        <div className="beauty-story__body">
          <span>{p.kicker}</span>
          <h2>{p.title}</h2>
          {p.desc ? <p>{p.desc}</p> : null}
        </div>
      </article>
    ),
  },

  storyCard: {
    label: '스토리 카드 (소형)',
    stage: 'explore',
    icon: '🃏',
    hint: '웹진 스타일 소형 이미지 카드',
    defaults: {
      kicker: 'Color Mood',
      title: '맑은 로즈 한 끗',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'kicker', label: '키커(작은 라벨)', kind: 'text' },
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <article className="beauty-story sb-story">
        <span
          className="beauty-story__media"
          role="button"
          onClick={() => { if (ctx.mode === 'player') ctx.player.setQuery(p.title) }}
        >
          <Img src={p.imageUrl} alt={p.title} />
        </span>
        <div className="beauty-story__body">
          <span>{p.kicker}</span>
          <h2>{p.title}</h2>
        </div>
      </article>
    ),
  },

  /* ─────────── 설문 단계 ─────────── */
  surveyIntro: {
    label: '설문 헤더',
    stage: 'survey',
    icon: '📋',
    hint: '설문 화면 상단 안내 문구',
    defaults: {
      kicker: 'Personal Brief',
      title: '상황에 맞는 계획을 위해 몇 가지만 알려주세요',
      desc: '피부 타입, 무드, 예산을 가볍게 고르면 지금 목적에 맞는 뷰티 플랜을 정리해드려요.',
    },
    fields: [
      { key: 'kicker', label: '키커', kind: 'text' },
      { key: 'title', label: '제목', kind: 'textarea' },
      { key: 'desc', label: '설명', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="clean-info-header sb-static">
        <span className="clean-info-kicker">{p.kicker}</span>
        <h2>{kText(p.title, ctx)}</h2>
        <p>{kText(p.desc, ctx)}</p>
      </div>
    ),
  },

  surveyQuestion: {
    label: '설문 질문',
    stage: 'survey',
    icon: '❓',
    hint: '선택지 카드형 질문. 옵션은 "메인|서브, 메인|서브" 형태',
    defaults: {
      question: '지금 피부에서 가장 신경 쓰이는 건?',
      options: '유분 무너짐|오후 T존, 들뜸·건조|각질 부각, 톤 안 맞음|경계 표시, 커버력 부족|잡티',
      multi: false,
    },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'textarea' },
      { key: 'options', label: '선택지 (메인|서브, 쉼표 구분)', kind: 'textarea' },
      { key: 'multi', label: '복수 선택 허용', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const opts = splitOptions(p.options)
      const isPlayer = ctx.mode === 'player'
      const answer = isPlayer ? ctx.player.answers[ctx.itemId] : undefined
      const selectedSet = new Set(
        p.multi ? (Array.isArray(answer) ? answer : []) : answer != null ? [answer] : []
      )
      return (
        <div className="sb-question">
          <label className="text-sm font-medium text-slate-400 mb-3 block">{kText(p.question, ctx)}</label>
          <div className="sb-question__grid">
            {opts.map((opt, i) => {
              const selected = selectedSet.has(opt.main)
              return (
                <button
                  key={i}
                  type="button"
                  className={
                    'info-card sb-option border-2 rounded-2xl transition-all p-3 text-center flex flex-col items-center justify-center gap-1 min-w-[5rem] ' +
                    (selected
                      ? 'sb-option--selected bg-white shadow-sm'
                      : 'border-slate-100 bg-slate-50 hover:border-gmarket-blue')
                  }
                  onClick={() => {
                    if (!isPlayer) return
                    if (p.multi) {
                      const next = new Set(selectedSet)
                      next.has(opt.main) ? next.delete(opt.main) : next.add(opt.main)
                      ctx.player.setAnswer(ctx.itemId, [...next])
                    } else {
                      ctx.player.setAnswer(ctx.itemId, opt.main)
                    }
                  }}
                >
                  <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">{kText(opt.main, ctx)}</span>
                  {opt.sub ? <span className="text-[11px] font-normal text-slate-400 whitespace-nowrap">{kText(opt.sub, ctx)}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      )
    },
  },

  profilePanel: {
    label: '프로필 요약 패널',
    stage: 'survey',
    icon: '🪪',
    hint: '"~님에 대해 이미 알고 있어요" — 배지 클릭으로 노출 조절',
    canvasInteractive: true,
    defaults: {
      hint: '이번엔 빼고 싶은 항목을 눌러주세요',
      hidden: '', // 이 시나리오에서 숨길 프로필 라벨 (쉼표 구분)
    },
    fields: [
      { key: 'hint', label: '우측 안내 문구', kind: 'text' },
      { key: 'hidden', label: '숨길 항목 라벨 (쉼표 구분 · 캔버스 배지 클릭과 동기화)', kind: 'text' },
    ],
    render: (p, ctx) => {
      const profile = ctx.profile || { name: '사용자', items: [] }
      const items = (profile.items || []).filter((it) => it.label && it.label.trim())
      const hidden = splitList(p.hidden)
      const isPlayer = ctx.mode === 'player'
      const excluded = isPlayer ? ctx.player.excludedProfile || [] : []
      // 플레이어에서는 숨긴 항목을 아예 안 보여주고, 캔버스에서는 흐리게 보여준다
      const visible = isPlayer ? items.filter((it) => !hidden.includes(it.label)) : items
      return (
        <div className="sb-profile-panel">
          <div className="sb-profile-panel__head">
            <span className="sb-profile-panel__avatar" aria-hidden="true">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /></svg>
            </span>
            <strong>{profile.name}님에 대해 이미 알고 있어요</strong>
            <small>{isPlayer ? p.hint : '배지를 눌러 이 시나리오 노출을 켜고 끄세요'}</small>
          </div>
          <div className="sb-profile-panel__chips">
            {visible.length === 0 && (
              <span className="sb-pinned-panel__empty">프로필 항목이 없어요. 탐색 페이지 편집기에서 추가하세요.</span>
            )}
            {visible.map((it) => {
              const off = isPlayer ? excluded.includes(it.label) : hidden.includes(it.label)
              return (
                <button
                  key={it.label}
                  type="button"
                  className={'sb-info-chip' + (off ? ' sb-info-chip--off' : '')}
                  title={isPlayer ? (off ? '다시 포함하기' : '이번 설문에서 빼기') : (off ? '이 시나리오에 노출하기' : '이 시나리오에서 숨기기')}
                  onClick={() => {
                    if (isPlayer) {
                      ctx.player.toggleProfileItem(it.label)
                    } else if (ctx.updateProps) {
                      const next = hidden.includes(it.label)
                        ? hidden.filter((l) => l !== it.label)
                        : [...hidden, it.label]
                      ctx.updateProps(ctx.itemId, 'hidden', next.join(', '))
                    }
                  }}
                >
                  <span className="sb-info-chip__label">{it.label}:</span>
                  <strong>{it.value}</strong>
                  {!off && (
                    <span className="sb-info-chip__check" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )
    },
  },

  /* ─────────── 계획 단계 ─────────── */
  surveySummary: {
    label: '설문 요약 패널',
    stage: 'plan',
    icon: '🧾',
    hint: '프로필 + 설문에서 고른 답을 칩으로 요약',
    defaults: { title: '설문 요약' },
    fields: [{ key: 'title', label: '제목', kind: 'text' }],
    render: (p, ctx) => {
      const data =
        (ctx.mode === 'player' ? ctx.player.summary : ctx.summaryPreview) || { profile: [], questions: [] }
      const empty = data.profile.length === 0 && data.questions.length === 0
      return (
        <div className="sb-summary-panel">
          <p className="sb-summary-panel__title">{p.title}</p>
          <div className="sb-summary-panel__chips">
            {empty && (
              <span className="sb-pinned-panel__empty">설문 질문과 프로필 항목이 여기에 요약돼요.</span>
            )}
            {data.profile.map((it) => (
              <span key={it.label} className="sb-info-chip sb-info-chip--static">
                <span className="sb-info-chip__label">{it.label}:</span>
                <strong>{it.value}</strong>
              </span>
            ))}
            {data.questions.map((q, i) => (
              <span key={i} className="sb-info-chip sb-info-chip--static">
                <span className="sb-info-chip__label">{q.q}:</span>
                <strong>{q.a}</strong>
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
    hint: '계획 화면 상단 제목',
    defaults: { kicker: 'Beauty Brief', title: '출근 10분, 무너지지 않는 베이스 루틴 계획' },
    fields: [
      { key: 'kicker', label: '키커', kind: 'text' },
      { key: 'title', label: '제목', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="sb-static">
        <span className="text-xs font-medium text-gmarket-blue uppercase tracking-widest mb-2 block">{p.kicker}</span>
        <h2 className="sb-plan-title text-2xl md:text-4xl font-bold text-slate-800 leading-snug">{kText(p.title, ctx)}</h2>
      </div>
    ),
  },

  planStep: {
    label: '계획 단계 카드',
    stage: 'plan',
    icon: '🪜',
    hint: 'N단계 계획 설명 + 체크포인트',
    defaults: {
      badge: 'STEP 1',
      title: '피부결 정돈 — 수분 프라이머',
      desc: '유분은 T존에만, 광은 볼에만 남기는 프라이머부터 시작해요.',
      points: '모공보다 결 위주로 얇게, 손보다 퍼프 마무리',
    },
    fields: [
      { key: 'badge', label: '단계 배지', kind: 'text' },
      { key: 'title', label: '단계 제목', kind: 'text' },
      { key: 'desc', label: '설명', kind: 'textarea' },
      { key: 'points', label: '체크포인트 (쉼표 구분)', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-gmarket-blue/10 px-3 py-1 text-[11px] font-bold text-gmarket-blue tracking-widest">{p.badge}</span>
        <h3 className="mt-3 text-lg font-semibold text-slate-900 leading-snug">{kText(p.title, ctx)}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{kText(p.desc, ctx)}</p>
        {splitList(p.points).length ? (
          <ul className="mt-4 space-y-2">
            {splitList(p.points).map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <svg className="w-4 h-4 mt-0.5 text-gmarket-blue flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                <span>{kText(pt, ctx)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ),
  },

  productCard: {
    label: '추천 상품 카드',
    stage: 'plan',
    icon: '🛍️',
    hint: '기본 세로형 — 넓히면 가로형으로 자동 전환',
    defaultW: 260,
    defaults: {
      name: '수분광 톤업 프라이머 30ml',
      price: '18,900',
      tag: 'AI OPTIMIZED',
      external: false,
      mall: '',
      desc: '복합성 피부 유분 밸런스 · 무향 저자극',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'name', label: '상품명', kind: 'text' },
      { key: 'price', label: '가격 (원 제외)', kind: 'text' },
      { key: 'tag', label: '배지 문구', kind: 'text' },
      { key: 'external', label: '외부몰 상품', kind: 'toggle' },
      { key: 'mall', label: '외부몰 이름 (예: 무신사)', kind: 'text' },
      { key: 'desc', label: '한 줄 설명', kind: 'text' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div className="sb-media-card sb-product-card2">
        <div className="sb-media-card__thumb">
          <Img src={p.imageUrl} alt={p.name} />
        </div>
        <div className="sb-media-card__body">
          <div className="sb-media-card__tags">
            <MarketTag external={p.external} mall={p.mall} />
            {p.tag ? <span className="sb-badge-blue">{p.tag}</span> : null}
          </div>
          <p className="sb-media-card__title">{kText(p.name, ctx)}</p>
          {p.desc ? <p className="sb-media-card__sub">{kText(p.desc, ctx)}</p> : null}
          <p className="sb-product-card2__price">{p.price}<span>원</span></p>
        </div>
        <button
          type="button"
          className="sb-product-card2__cart"
          onClick={() => { if (ctx.mode === 'player') ctx.player.addToCart(p.name) }}
        >
          담기
        </button>
      </div>
    ),
  },

  videoCard: {
    label: '외부 영상 카드',
    stage: 'plan',
    icon: '🎬',
    hint: '유튜브 등 외부 영상 — 기본 세로형, 넓히면 가로형',
    defaultW: 260,
    defaults: {
      source: '유튜브',
      title: '무너짐 없는 베이스 5분 루틴',
      channel: '뷰티크리에이터 소은 · 조회 12만',
      duration: '5:24',
      imageUrl: './makeup-clone-assets/d9b261330f3ffccf.avif',
    },
    fields: [
      { key: 'source', label: '출처 (유튜브/틱톡 등)', kind: 'text' },
      { key: 'title', label: '영상 제목', kind: 'text' },
      { key: 'channel', label: '채널 · 부가 정보', kind: 'text' },
      { key: 'duration', label: '길이', kind: 'text' },
      { key: 'imageUrl', label: '썸네일 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-media-card sb-video-card"
        role="button"
        onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(`${p.source} 영상`) }}
      >
        <div className="sb-media-card__thumb">
          <Img src={p.imageUrl} alt={p.title} />
          <span className="sb-video-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
          </span>
          {p.duration ? <span className="sb-video-card__duration">{p.duration}</span> : null}
        </div>
        <div className="sb-media-card__body">
          <div className="sb-media-card__tags">
            <span className="sb-market-tag sb-market-tag--external">{p.source}</span>
          </div>
          <p className="sb-media-card__title">{kText(p.title, ctx)}</p>
          {p.channel ? <p className="sb-media-card__sub">{p.channel}</p> : null}
        </div>
      </div>
    ),
  },

  articleCard: {
    label: '외부 게시글 카드',
    stage: 'plan',
    icon: '📰',
    hint: '블로그/커뮤니티 글 — 기본 세로형, 넓히면 가로형',
    defaultW: 260,
    defaults: {
      source: '네이버 블로그',
      title: '복합성 피부 1년 쓰고 정착한 베이스 조합',
      snippet: '지성 볼, 건성 T존이라는 최악의 조합에서 안 무너지는 조합을 드디어 찾았습니다. 핵심은 부위별로…',
      author: 'skincare_log · 2일 전',
      imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif',
    },
    fields: [
      { key: 'source', label: '출처 (블로그/커뮤니티)', kind: 'text' },
      { key: 'title', label: '글 제목', kind: 'text' },
      { key: 'snippet', label: '본문 미리보기', kind: 'textarea' },
      { key: 'author', label: '작성자 · 시각', kind: 'text' },
      { key: 'imageUrl', label: '대표 이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-media-card sb-article-card"
        role="button"
        onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(`${p.source} 게시글`) }}
      >
        <div className="sb-media-card__thumb">
          <Img src={p.imageUrl} alt={p.title} />
        </div>
        <div className="sb-media-card__body">
          <div className="sb-media-card__tags">
            <span className="sb-market-tag sb-market-tag--external">{p.source}</span>
          </div>
          <p className="sb-media-card__title">{kText(p.title, ctx)}</p>
          {p.snippet ? <p className="sb-media-card__sub sb-article-card__snippet">{kText(p.snippet, ctx)}</p> : null}
          {p.author ? <p className="sb-media-card__meta">{p.author}</p> : null}
        </div>
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
      { key: 'items', label: '항목 (쉼표 구분)', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="rounded-[28px] border border-slate-100 bg-slate-50/80 p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 mb-3">{p.title}</p>
        <ul className="space-y-2.5">
          {splitList(p.items).map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
              <span className="mt-0.5 w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0" />
              <span>{kText(it, ctx)}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },

  ctaBar: {
    label: '결제 CTA 바',
    stage: 'plan',
    icon: '💳',
    hint: '계획 하단 일괄 결제 버튼',
    defaults: { countLabel: '3개 선택', price: '52,700원', buttonText: '일괄 결제하고 완수하기' },
    fields: [
      { key: 'countLabel', label: '선택 요약', kind: 'text' },
      { key: 'price', label: '금액', kind: 'text' },
      { key: 'buttonText', label: '버튼 문구', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div className="sb-cta-bar rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">{p.countLabel}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{p.price}</p>
          </div>
          <button
            type="button"
            className="w-full rounded-2xl bg-gmarket-blue px-8 py-4 text-base font-bold text-white shadow-lg shadow-blue-100 transition-all hover:scale-[1.01] active:scale-95 md:w-auto"
            onClick={() => { if (ctx.mode === 'player') ctx.player.complete() }}
          >
            {p.buttonText}
          </button>
        </div>
      </div>
    ),
  },

  /* ─────────── 공통 ─────────── */
  textBlock: {
    label: '텍스트 블록',
    stage: 'common',
    icon: '📝',
    hint: '자유 텍스트 (키커/제목/본문)',
    defaults: { kicker: 'Note', title: '섹션 제목', body: '본문 내용을 입력하세요.' },
    fields: [
      { key: 'kicker', label: '키커', kind: 'text' },
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'body', label: '본문', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="sb-static">
        {p.kicker ? <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 block mb-2">{p.kicker}</span> : null}
        {p.title ? <h3 className="text-xl font-semibold text-slate-900 mb-2">{kText(p.title, ctx)}</h3> : null}
        {p.body ? <p className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{kText(p.body, ctx)}</p> : null}
      </div>
    ),
  },

  noticeCard: {
    label: '안내 카드',
    stage: 'common',
    icon: '📌',
    hint: '점선 테두리 안내 박스',
    defaults: { title: '안내', body: '상품을 보고 담기를 누르면 목적별로 모아볼 수 있어요.' },
    fields: [
      { key: 'title', label: '제목', kind: 'text' },
      { key: 'body', label: '내용', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-5 text-sm leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-700 mb-1">{p.title}</p>
        <p className="whitespace-pre-wrap">{kText(p.body, ctx)}</p>
      </div>
    ),
  },

  imageCard: {
    label: '이미지 카드',
    stage: 'common',
    icon: '🌄',
    hint: '단독 이미지 + 캡션',
    defaults: { imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif', caption: '' },
    fields: [
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
      { key: 'caption', label: '캡션', kind: 'text' },
    ],
    render: (p) => (
      <figure className="sb-static">
        <div className="rounded-[28px] overflow-hidden border border-slate-100 shadow-sm bg-slate-50 sb-image-card">
          <Img src={p.imageUrl} alt={p.caption} />
        </div>
        {p.caption ? <figcaption className="mt-2 text-xs text-slate-400 text-center">{p.caption}</figcaption> : null}
      </figure>
    ),
  },
}

export function libraryForStage(stageKey) {
  return Object.entries(LIBRARY)
    .filter(([, def]) => def.stage === stageKey || def.stage === 'common')
    .map(([type, def]) => ({ type, ...def }))
}

export function renderItem(item, ctx) {
  const def = LIBRARY[item.type]
  if (!def) return <div className="text-xs text-red-400">알 수 없는 컴포넌트: {item.type}</div>
  return def.render(item.props, { ...ctx, itemId: item.id })
}
