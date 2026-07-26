import React from 'react'
import { splitList, splitTextList } from '../store.js'
import { Img, kText, youtubeThumbnail } from './support.jsx'

/* 계획 단계 컴포넌트 — 요약·타이틀·단계 카드·상품/미디어 카드·체크리스트·CTA */
export const PLAN_COMPONENTS = {
  surveySummary: {
    label: '설문 요약 패널',
    stage: 'plan',
    icon: '🧾',
    hint: '프로필 + 설문에서 고른 답을 요약 (원본 설문 요약 스타일)',
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
      const data = {
        profile: (Array.isArray(rawData.profile) ? rawData.profile : [])
          .filter((it) => !hiddenProfile.includes(it.label)),
        questions: (Array.isArray(rawData.questions) ? rawData.questions : [])
          .filter((q) => !hiddenQuestions.includes(String(q.q || '').trim())),
      }
      const empty = data.profile.length === 0 && data.questions.length === 0
      // 원본 clean-survey-lock 마크업/클래스 그대로
      return (
        <div className="clean-survey-lock" style={{ display: 'block' }}>
          <div className="clean-survey-lock__head">
            <p className="clean-survey-lock__title">{p.title}</p>
          </div>
          <div className="clean-survey-lock__items">
            {empty && (
              <span className="sb-pinned-panel__empty">설문 질문과 프로필 항목이 여기에 요약돼요.</span>
            )}
            {data.profile.map((it) => (
              <div key={it.label} className="clean-survey-lock__item" aria-readonly="true">
                <span className="clean-survey-lock__label">{it.label}</span>
                <span className="clean-survey-lock__value">{it.value}</span>
              </div>
            ))}
            {data.questions.map((q, i) => (
              <div key={i} className="clean-survey-lock__item" aria-readonly="true">
                <span className="clean-survey-lock__label">{q.q}</span>
                <span className="clean-survey-lock__value">{q.a}</span>
              </div>
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
        <span className="text-xs font-medium text-gmarket-blue uppercase tracking-widest mb-2 block">{kText(p.kicker, ctx, 'kicker')}</span>
        <h2 className="sb-plan-title text-2xl md:text-4xl font-bold text-slate-800 leading-snug">{kText(p.title, ctx, 'title')}</h2>
      </div>
    ),
  },

  planStep: {
    label: '계획 단계 카드',
    stage: 'plan',
    icon: '🪜',
    hint: '원본 스타일 — 번호 원 + 제목 + 설명 + 체크포인트',
    defaults: {
      no: '1',
      title: '피부결 정돈 — 수분 [[프라이머]]',
      desc: '유분은 T존에만, 광은 볼에만 남기는 [[프라이머]]부터 시작해요.',
      points: '모공보다 결 위주로 얇게, 손보다 퍼프 마무리',
    },
    fields: [
      { key: 'no', label: '단계 번호', kind: 'text' },
      { key: 'title', label: '단계 제목', kind: 'text' },
      { key: 'desc', label: '설명', kind: 'textarea' },
      { key: 'points', label: '체크포인트', kind: 'stringList', list: true },
    ],
    render: (p, ctx) => {
      // 구버전 데이터 호환: badge('STEP 2')만 있으면 숫자를 추출
      const no = p.no || (String(p.badge || '').replace(/\D/g, '') || '1')
      return (
        <div className="sb-plan-step">
          <div className="sb-plan-step__head">
            <span className="w-10 h-10 rounded-full bg-slate-900 shadow-xl flex items-center justify-center font-bold text-white border-4 border-slate-50 flex-shrink-0">
              {no}
            </span>
            <h3 className="text-2xl font-bold text-slate-800 leading-snug">{kText(p.title, ctx, 'title')}</h3>
          </div>
          <p className="text-slate-500 text-sm leading-relaxed mt-3">{kText(p.desc, ctx, 'desc')}</p>
          {splitTextList(p.points).length ? (
            <ul className="mt-4 space-y-2">
              {splitTextList(p.points).map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                  <svg className="w-4 h-4 mt-0.5 text-gmarket-blue flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                  <span>{kText(pt, ctx)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )
    },
  },

  productCard: {
    label: '추천 상품 카드',
    stage: 'plan',
    icon: '🛍️',
    hint: '원본 상품 카드 스타일 — 기본 세로형, 넓히면 가로형',
    defaultW: 224,
    defaults: {
      brand: '',
      name: '수분광 톤업 프라이머 30ml',
      price: '18,900',
      was: '',
      score: '94',
      summary: '',
      emoji: '',
      gradient: '',
      external: false,
      mall: '',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'brand', label: '브랜드', kind: 'text' },
      { key: 'name', label: '상품명', kind: 'text' },
      { key: 'price', label: '가격 (원 제외)', kind: 'text' },
      { key: 'was', label: '정가 (원 제외)', kind: 'text' },
      { key: 'score', label: '매칭률 (%)', kind: 'text' },
      { key: 'summary', label: '추천 이유 (줄바꿈 구분)', kind: 'textarea' },
      { key: 'emoji', label: '상품 이모지', kind: 'text' },
      { key: 'gradient', label: '상품 배경 CSS', kind: 'text' },
      { key: 'external', label: '외부몰 상품', kind: 'toggle' },
      { key: 'mall', label: '외부몰 이름 (예: 올리브영)', kind: 'text' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => {
      const isPlayer = ctx.mode === 'player'
      const score = p.score || '94'
      return (
        <div className="sb-media-card sb-product-card2 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden text-left">
          <div className="sb-media-card__thumb">
            <span className="sb-product-card2__match bg-white/95 backdrop-blur px-2.5 py-1.5 rounded-xl border border-slate-100 flex items-center shadow-sm">
              <span className="text-[10px] font-bold text-slate-400 mr-1.5 uppercase tracking-tighter">Match</span>
              <span className="text-xs font-bold text-gmarket-blue">{score}%</span>
            </span>
            {p.emoji ? (
              <div className="sb-product-card2__mock" style={{ background: p.gradient || undefined }} aria-label={p.name}>
                {p.brand ? <span>{kText(p.brand, ctx, 'brand')}</span> : null}
                <b aria-hidden="true">{p.emoji}</b>
              </div>
            ) : (
              <Img src={p.imageUrl} alt={p.name} />
            )}
          </div>
          <div className="sb-media-card__body sb-product-card2__body">
            <div className="sb-media-card__tags">
              {p.external ? (
                <span className="marketplace-muted-tag">{p.mall || '외부몰'}</span>
              ) : (
                <span className="gmarket-logo-tag gmarket-logo-tag--inline" aria-label="지마켓 상품">
                  <svg className="gmarket-logo-tag__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
                    <circle cx="24" cy="24" r="23.5" fill="currentColor" stroke="#E0E0E0" />
                    <path fillRule="evenodd" clipRule="evenodd" d="M24.6048 36.6653C17.6544 36.6653 12 30.984 12 24C12 17.017 17.6544 11.3347 24.6048 11.3347C27.5395 11.3347 30.3792 12.3562 32.6016 14.2128C33.1699 14.6861 33.551 15.4531 33.551 16.1213C33.551 16.7568 33.3043 17.3539 32.8579 17.8022C32.4106 18.2515 31.8163 18.4992 31.1846 18.4992C30.6442 18.4992 30.1046 18.3014 29.665 17.9424C28.2643 16.8 26.3251 16.0906 24.6058 16.0906C20.2646 16.0906 16.7338 19.6397 16.7338 24.001C16.7338 28.3622 20.2646 31.9094 24.6058 31.9094C28.6282 31.9094 31.1069 29.0218 31.1069 26.3779H24.743V21.7507H33.5942C34.8259 21.7507 35.8464 22.68 35.951 23.9126C35.9875 24.3504 36 24.6806 36 24.9859C36 28.081 35.1619 30.9974 32.9923 33.1968C30.7853 35.4336 28.1434 36.6653 24.6048 36.6653Z" fill="#00C400" />
                    <path fillRule="evenodd" clipRule="evenodd" d="M27.0451 24.0643C27.0451 25.3421 26.0151 26.3779 24.7431 26.3779C23.4711 26.3779 22.441 25.3421 22.441 24.0643C22.441 22.7866 23.4711 21.7507 24.7431 21.7507C26.0151 21.7507 27.0451 22.7866 27.0451 24.0643Z" fill="#082DA9" />
                  </svg>
                  <span className="gmarket-logo-tag__word">Gmarket</span>
                </span>
              )}
            </div>
            <h4 className="text-sm font-bold text-slate-800 mb-1.5 leading-tight sb-media-card__title">{kText(p.name, ctx, 'name')}</h4>
            <div className="flex items-baseline mb-3 text-left">
              <span className="text-lg font-bold text-gmarket-blue">{kText(p.price, ctx, 'price')}</span>
              <span className="text-xs font-medium text-slate-400 ml-0.5">원</span>
              {p.was ? <span className="sb-product-card2__was">{kText(p.was, ctx, 'was')}원</span> : null}
            </div>
            {p.summary ? (
              <ul className="sb-product-card2__summary">
                {String(p.summary).split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => (
                  <li key={index}>{kText(line, ctx)}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 py-3 bg-slate-900 text-white text-[11px] rounded-xl font-bold transition-colors hover:bg-gmarket-blue"
                onClick={() => { if (isPlayer) ctx.player.openExternal('상품 상세') }}
              >
                상세보기
              </button>
              <button
                type="button"
                className={
                  'cart-add-btn py-3 px-3 bg-slate-100 text-slate-700 text-[11px] rounded-xl font-bold' +
                  (p.external ? ' cart-add-btn--disabled' : '')
                }
                disabled={!!p.external}
                title={p.external ? '지마켓 상품만 담을 수 있어요' : '쓰레드 장바구니 담기'}
                onClick={() => { if (isPlayer && !p.external) ctx.player.addToCart(p.name) }}
              >
                {p.external ? '담기불가' : '담기'}
              </button>
            </div>
          </div>
        </div>
      )
    },
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
      url: '',
    },
    fields: [
      { key: 'source', label: '출처 (유튜브/틱톡 등)', kind: 'text' },
      { key: 'title', label: '영상 제목', kind: 'text' },
      { key: 'channel', label: '채널 · 부가 정보', kind: 'text' },
      { key: 'duration', label: '길이', kind: 'text' },
      { key: 'url', label: '영상 링크 URL', kind: 'url', placeholder: 'https://www.youtube.com/watch?v=...' },
      { key: 'imageUrl', label: '썸네일 URL (비우면 YouTube 자동)', kind: 'url' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-media-card sb-video-card"
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
        <div className="sb-media-card__thumb">
          <Img src={p.imageUrl || youtubeThumbnail(p.url)} alt={p.title} />
          <span className="sb-video-card__play" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
          </span>
          {p.duration ? <span className="sb-video-card__duration">{p.duration}</span> : null}
        </div>
        <div className="sb-media-card__body">
          <div className="sb-media-card__tags">
            <span className="sb-market-tag sb-market-tag--external">{p.source}</span>
          </div>
          <p className="sb-media-card__title">{kText(p.title, ctx, 'title')}</p>
          {p.channel ? <p className="sb-media-card__sub">{kText(p.channel, ctx, 'channel')}</p> : null}
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
      url: '',
    },
    fields: [
      { key: 'source', label: '출처 (블로그/커뮤니티)', kind: 'text' },
      { key: 'title', label: '글 제목', kind: 'text' },
      { key: 'snippet', label: '본문 미리보기', kind: 'textarea' },
      { key: 'author', label: '작성자 · 시각', kind: 'text' },
      { key: 'url', label: '게시글 링크 URL', kind: 'url', placeholder: 'https://blog.naver.com/...' },
      { key: 'imageUrl', label: '대표 이미지 URL', kind: 'url' },
    ],
    render: (p, ctx) => (
      <div
        className="sb-media-card sb-article-card"
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
        <div className="sb-media-card__thumb">
          <Img src={p.imageUrl} alt={p.title} />
        </div>
        <div className="sb-media-card__body">
          <div className="sb-media-card__tags">
            <span className="sb-market-tag sb-market-tag--external">{p.source}</span>
          </div>
          <p className="sb-media-card__title">{kText(p.title, ctx, 'title')}</p>
          {p.snippet ? <p className="sb-media-card__sub sb-article-card__snippet">{kText(p.snippet, ctx, 'snippet')}</p> : null}
          {p.author ? <p className="sb-media-card__meta">{kText(p.author, ctx, 'author')}</p> : null}
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
      { key: 'items', label: '항목', kind: 'stringList', list: true },
    ],
    render: (p, ctx) => (
      <div className="rounded-[28px] border border-slate-100 bg-slate-50/80 p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 mb-3">{kText(p.title, ctx, 'title')}</p>
        <ul className="space-y-2.5">
          {splitTextList(p.items).map((it, i) => (
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
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-400">{kText(p.countLabel, ctx, 'countLabel')}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{kText(p.price, ctx, 'price')}</p>
          </div>
          <button
            type="button"
            className="w-full rounded-2xl bg-gmarket-blue px-8 py-4 text-base font-bold text-white shadow-lg shadow-blue-100 transition-all hover:scale-[1.01] active:scale-95 md:w-auto"
            onClick={() => { if (ctx.mode === 'player') ctx.player.complete() }}
          >
            {kText(p.buttonText, ctx, 'buttonText')}
          </button>
        </div>
      </div>
    ),
  },
}
