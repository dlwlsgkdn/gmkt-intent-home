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
    render: (p) => (
      <div className="clean-info-header sb-static">
        <span className="clean-info-kicker">{p.kicker}</span>
        <h2>{p.title}</h2>
        <p>{p.desc}</p>
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
          <label className="text-sm font-medium text-slate-400 mb-3 block">{p.question}</label>
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
                  <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">{opt.main}</span>
                  {opt.sub ? <span className="text-[11px] font-normal text-slate-400 whitespace-nowrap">{opt.sub}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      )
    },
  },

  profileCard: {
    label: '저장된 프로필 카드',
    stage: 'survey',
    icon: '👤',
    hint: '이전 설문 결과를 요약해 보여주는 카드',
    defaults: {
      label: '저장된 브리프',
      name: '유진님의 베이스 프로필',
      tags: '복합성, 쿨톤, 저자극 선호',
    },
    fields: [
      { key: 'label', label: '라벨', kind: 'text' },
      { key: 'name', label: '프로필 이름', kind: 'text' },
      { key: 'tags', label: '태그 (쉼표 구분)', kind: 'text' },
    ],
    render: (p) => (
      <div className="rounded-[24px] border border-slate-200 bg-white/90 p-5 shadow-sm">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gmarket-blue mb-2">{p.label}</p>
        <p className="text-base font-semibold text-slate-800">{p.name}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {splitList(p.tags).map((t, i) => (
            <span key={i} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">{t}</span>
          ))}
        </div>
      </div>
    ),
  },

  /* ─────────── 계획 단계 ─────────── */
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
    render: (p) => (
      <div className="sb-static">
        <span className="text-xs font-medium text-gmarket-blue uppercase tracking-widest mb-2 block">{p.kicker}</span>
        <h2 className="text-2xl md:text-4xl font-bold text-slate-800 leading-snug">{p.title}</h2>
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
    render: (p) => (
      <div className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-gmarket-blue/10 px-3 py-1 text-[11px] font-bold text-gmarket-blue tracking-widest">{p.badge}</span>
        <h3 className="mt-3 text-lg font-semibold text-slate-900 leading-snug">{p.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.desc}</p>
        {splitList(p.points).length ? (
          <ul className="mt-4 space-y-2">
            {splitList(p.points).map((pt, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <svg className="w-4 h-4 mt-0.5 text-gmarket-blue flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                <span>{pt}</span>
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
    hint: '계획에 붙는 추천 상품',
    defaults: {
      name: '수분광 톤업 프라이머 30ml',
      price: '18,900',
      tag: 'AI OPTIMIZED',
      desc: '복합성 피부 유분 밸런스 · 무향 저자극',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'name', label: '상품명', kind: 'text' },
      { key: 'price', label: '가격 (원 제외)', kind: 'text' },
      { key: 'tag', label: '배지 문구', kind: 'text' },
      { key: 'desc', label: '한 줄 설명', kind: 'text' },
      { key: 'imageUrl', label: '이미지 URL', kind: 'text' },
    ],
    render: (p, ctx) => (
      <div className="rounded-[28px] border border-slate-100 bg-white p-4 shadow-sm flex items-center gap-4">
        <div className="w-20 h-20 rounded-2xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0 sb-product-img">
          <Img src={p.imageUrl} alt={p.name} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="bg-gmarket-blue text-white text-[9px] font-bold px-2 py-0.5 rounded-full tracking-tight">{p.tag}</span>
          <p className="mt-1.5 text-sm font-semibold text-slate-900 truncate">{p.name}</p>
          <p className="text-xs text-slate-400 truncate">{p.desc}</p>
          <p className="mt-1 text-base font-bold text-slate-900">{p.price}<span className="text-xs font-medium">원</span></p>
        </div>
        <button
          type="button"
          className="flex-shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          onClick={() => { if (ctx.mode === 'player') ctx.player.addToCart(p.name) }}
        >
          담기
        </button>
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
    render: (p) => (
      <div className="rounded-[28px] border border-slate-100 bg-slate-50/80 p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 mb-3">{p.title}</p>
        <ul className="space-y-2.5">
          {splitList(p.items).map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
              <span className="mt-0.5 w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0" />
              <span>{it}</span>
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
      <div className="rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-sm">
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
    render: (p) => (
      <div className="sb-static">
        {p.kicker ? <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 block mb-2">{p.kicker}</span> : null}
        {p.title ? <h3 className="text-xl font-semibold text-slate-900 mb-2">{p.title}</h3> : null}
        {p.body ? <p className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{p.body}</p> : null}
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
    render: (p) => (
      <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-5 py-5 text-sm leading-relaxed text-slate-500">
        <p className="font-semibold text-slate-700 mb-1">{p.title}</p>
        <p className="whitespace-pre-wrap">{p.body}</p>
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
