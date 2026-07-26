import React from 'react'
import { splitList } from '../store.js'
import { Img, kText } from './support.jsx'

/* 탐색 단계 컴포넌트 — 홈 상단 인사·검색·칩·웹진 스토리 카드 */
export const EXPLORE_COMPONENTS = {
  greeting: {
    label: '인사말 배너',
    stage: 'explore',
    icon: '💬',
    hint: '홈 상단의 그라데이션 밑줄 인사 문구',
    defaults: { text: '유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?' },
    fields: [{ key: 'text', label: '인사말 문구', kind: 'textarea' }],
    render: (p, ctx) => (
      <div className="beauty-greeting sb-static">
        <span>{kText(p.text, ctx, 'text')}</span>
      </div>
    ),
  },

  searchBox: {
    label: '탐색 검색창',
    stage: 'explore',
    icon: '🔍',
    hint: '시나리오의 시작 질문을 입력받는 검색창',
    defaults: {
      placeholder: '예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업',
      multiline: false,
    },
    fields: [
      { key: 'placeholder', label: '플레이스홀더 문구', kind: 'text' },
      { key: 'multiline', label: '긴 텍스트를 여러 줄로 (끄면 말줄임)', kind: 'toggle' },
    ],
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
            {p.multiline ? (
              <textarea
                rows={1}
                placeholder={p.placeholder}
                className="resize-none overflow-hidden clean-search__field--multiline"
                value={value}
                readOnly={!isPlayer}
                onChange={(e) => isPlayer && ctx.player.setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (isPlayer && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (value.trim()) ctx.player.submitQuery()
                  }
                }}
              />
            ) : (
              <input
                type="text"
                placeholder={p.placeholder}
                className="clean-search__field--ellipsis"
                value={value}
                readOnly={!isPlayer}
                onChange={(e) => isPlayer && ctx.player.setQuery(e.target.value)}
              />
            )}
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

  scenarioChips: {
    label: '발행 칩 목록',
    stage: 'explore',
    icon: '✦',
    hint: '발행된 시나리오 칩이 표시될 자리 (내용은 자동)',
    defaults: {},
    fields: [],
    render: (p, ctx) => (
      <div className="clean-tag-row sb-static">
        {ctx.chips && ctx.chips.length > 0 ? (
          ctx.chips
        ) : (
          <span className="suggestion-tag sb-chip-scenario sb-chip-scenario--sample">
            <span className="sb-chip-scenario__spark">✦</span>#발행된_시나리오_칩_자리
          </span>
        )}
      </div>
    ),
  },

  tagRow: {
    label: '키워드 칩 목록',
    stage: 'explore',
    icon: '🏷️',
    hint: '검색창 아래 해시태그 칩. 쉼표로 구분',
    defaults: { tags: '출근_10분룩, AI_페이스룩, 립스틱_전색발색, 성분_궁합체크' },
    fields: [{ key: 'tags', label: '칩 목록 (쉼표로 구분)', kind: 'textarea', list: true }],
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
            #{kText(tag, ctx)}
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
          <span>{kText(p.kicker, ctx, 'kicker')}</span>
          <h2>{kText(p.title, ctx, 'title')}</h2>
          {p.desc ? <p>{kText(p.desc, ctx, 'desc')}</p> : null}
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
          <span>{kText(p.kicker, ctx, 'kicker')}</span>
          <h2>{kText(p.title, ctx, 'title')}</h2>
        </div>
      </article>
    ),
  },
}
