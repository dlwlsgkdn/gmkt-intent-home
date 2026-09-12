import React from 'react'
import { splitTextList } from '../store.js'
import { Img, kText } from './support.jsx'
import CrossFade from '../../components/ui/CrossFade.jsx'

/* 추천 검색어 칩 개수 선택지 (인스펙터 select — 값은 문자열로 저장) */
const CHIP_COUNT_OPTIONS = [
  { value: '0', label: '표시 안 함' },
  { value: '1', label: '1개' },
  { value: '2', label: '2개' },
  { value: '3', label: '3개' },
]
const chipCount = (value) => Math.max(0, Math.min(3, Number(value == null || value === '' ? 3 : value) || 0))

/* 탐색 단계 컴포넌트 — 홈 상단 인사·검색·칩·웹진 스토리 카드 */
export const EXPLORE_COMPONENTS = {
  greeting: {
    label: '인사말 배너',
    stage: 'explore',
    icon: '💬',
    hint: '홈 상단 인사 문구 — 홈에서는 이 문구가 먼저 보이고, 현재 시각·날씨·쇼핑 쓰레드로 만든 개인화 인사가 페이드인으로 이어진다',
    defaults: { text: '유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?', personalize: true },
    fields: [
      { key: 'text', label: '기본 인사말 문구 (개인화 인사가 오기 전까지 보임)', kind: 'textarea' },
      { key: 'personalize', label: '개인화 인사말로 전환 (시각·날씨·쇼핑 쓰레드)', kind: 'toggle', defaultValue: true },
    ],
    /* 홈(player)에서는 기본 문구 → 개인화 문구를 크로스페이드로 잇는다(hooks/useHomePersonalize — ctx.home.greeting.text 가 오면 전환,
       세션 캐시가 있으면 처음부터 개인화 문구). 캔버스는 기본 문구만(인라인 편집 대상) */
    render: (p, ctx) => {
      const live = ctx.mode === 'player' && ctx.home && p.personalize !== false ? ctx.home.greeting : null
      const personal = live && live.text ? live.text : ''
      if (ctx.mode !== 'player') {
        return (
          <div className="beauty-greeting sb-static">
            <span>{kText(p.text, ctx, 'text')}</span>
          </div>
        )
      }
      return (
        <div className={'beauty-greeting sb-static' + (personal ? ' is-personal' : '')}>
          <CrossFade stamp={personal ? `live:${personal}` : 'base'}>
            <span>{kText(personal || p.text, ctx, 'text')}</span>
          </CrossFade>
        </div>
      )
    },
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
                onFocus={() => isPlayer && ctx.player.openSearch && ctx.player.openSearch()}
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
                /* 홈에서는 검색창을 누르는 순간 검색 화면(최근 검색어·자동완성·AI 추천)이 뜬다 — 입력은 그쪽에서 */
                onFocus={() => isPlayer && ctx.player.openSearch && ctx.player.openSearch()}
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
          // ✦ 는 라이브 생성 표기 전용 — 시나리오 칩 자리표시자에서도 쓰지 않는다
          <span className="suggestion-tag sb-chip-scenario sb-chip-scenario--sample">
            #발행된_시나리오_칩_자리
          </span>
        )}
      </div>
    ),
  },

  /* 추천 검색어 칩 — 검색창 아래 두 톤(Figma Search 랜딩 ChipSection): 보라 = 내 쇼핑 쓰레드 히스토리로 만든 개인화 자연어 검색어
     (BFF `/api/search/home`, 실패면 휴리스틱 — 최근 쓰레드 제목·프로필), 파랑 = 전체 사용자 인기 검색어 후보 표 상위(`/api/search/popular`
     — core KV, 실패면 시드 표) `#키워드`. 내용은 hooks/useHomePersonalize 가 ctx.home 으로 공급하고 바뀌면 크로스페이드로 갈아끼운다.
     칩 클릭 = 검색 제출(라우터를 거쳐 DDAK 라이브 생성 / 검색 결과 페이지) */
  recommendChips: {
    label: '추천 검색어 칩',
    stage: 'explore',
    icon: '💡',
    hint: '보라 = 내 쇼핑 쓰레드로 만든 개인화 검색어 · 파랑 = 전체 사용자 인기 검색어 (내용은 자동)',
    defaults: { personalCount: '3', popularCount: '3' },
    fields: [
      { key: 'personalCount', label: '개인화 추천 검색어 (보라) 개수', kind: 'select', defaultValue: '3', options: CHIP_COUNT_OPTIONS },
      { key: 'popularCount', label: '인기 검색어 (파랑) 개수', kind: 'select', defaultValue: '3', options: CHIP_COUNT_OPTIONS },
    ],
    render: (p, ctx) => {
      const nPersonal = chipCount(p.personalCount)
      const nPopular = chipCount(p.popularCount)
      const home = ctx.mode === 'player' ? ctx.home : null
      if (!home) {
        // 캔버스·미리보기 자리표시자 — 실제 문구는 홈에서 쓰레드·인기 표로 채워진다
        return (
          <div className="clean-tag-row sb-static">
            {Array.from({ length: nPersonal }, (_, i) => (
              <span key={`p${i}`} className="suggestion-tag sb-chip-reco sb-chip-reco--personal sb-chip-reco--sample">내 쓰레드 기반 추천 {i + 1}</span>
            ))}
            {Array.from({ length: nPopular }, (_, i) => (
              <span key={`h${i}`} className="suggestion-tag sb-chip-reco sb-chip-reco--popular sb-chip-reco--sample">#인기_검색어_{i + 1}</span>
            ))}
          </div>
        )
      }
      const submit = (text) => {
        if (ctx.player.submitSearch) ctx.player.submitSearch(text)
        else ctx.player.setQuery(text)
      }
      const personal = ((home.personal && home.personal.items) || []).slice(0, nPersonal)
      const popular = ((home.popular && home.popular.items) || []).slice(0, nPopular)
      if (!personal.length && !popular.length) return null
      const stamp = [...personal.map((t) => `p:${t}`), ...popular.map((row) => `h:${row.keyword}`)].join('|')
      return (
        <CrossFade className="sb-recochips sb-static" stamp={stamp}>
          <div className="clean-tag-row sb-recochips__row">
            {personal.map((text) => (
              <button
                key={`p:${text}`}
                type="button"
                className="suggestion-tag sb-chip-reco sb-chip-reco--personal"
                title="내 쇼핑 쓰레드로 만든 추천 검색어"
                onClick={() => submit(text)}
              >
                {text}
              </button>
            ))}
            {popular.map((row) => (
              <button
                key={`h:${row.keyword}`}
                type="button"
                className="suggestion-tag sb-chip-reco sb-chip-reco--popular"
                title={`인기 검색어 · 최근 ${Number(row.count || 0).toLocaleString('ko-KR')}회`}
                onClick={() => submit(row.keyword)}
              >
                #{String(row.keyword).replace(/\s+/g, '_')}
              </button>
            ))}
          </div>
        </CrossFade>
      )
    },
  },

  tagRow: {
    label: '키워드 칩 목록',
    stage: 'explore',
    icon: '🏷️',
    hint: '검색창 아래 해시태그 칩. 쉼표로 구분',
    defaults: { tags: '출근_10분룩, AI_페이스룩, 립스틱_전색발색, 성분_궁합체크' },
    fields: [{ key: 'tags', label: '칩 목록', kind: 'stringList', list: true }],
    render: (p, ctx) => (
      <div className="clean-tag-row sb-static">
        {splitTextList(p.tags).map((tag, i) => (
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
