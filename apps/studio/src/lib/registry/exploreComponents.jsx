import React, { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SEARCH_PLACEHOLDERS, splitTextList } from '../store.js'
import { greetingThreadSpan } from '../homePersonalize.js'
import { Img, kText } from './support.jsx'
import CrossFade from '../../components/ui/CrossFade.jsx'
import { SearchIcon, SparkIcon } from '../../components/SearchOverlay.jsx'

/* 개인화 인사말 — 최근 쓰레드를 가리키는 「」 부분을 탭 대상(그 쓰레드 이어보기)으로 만든다. 탭 대상이 없으면 문장 그대로 */
function greetingNodes(text, onResume) {
  const span = onResume ? greetingThreadSpan(text) : null
  if (!span) return text
  return (
    <>
      {text.slice(0, span.start)}
      <button type="button" className="beauty-greeting__thread" title="이 쓰레드 이어보기" onClick={onResume}>
        {span.text}
      </button>
      {text.slice(span.end)}
    </>
  )
}

/* 예문의 `{라벨}` 토큰을 프로필 값으로 — `{피부타입}` → "복합성", `{이름}` → 프로필 이름. 값이 없으면 빈 채로 두고 공백을 정리한다 */
function fillProfileTokens(text, profile) {
  const items = (profile && profile.items) || []
  return String(text || '')
    .replace(/\{([^{}]+)\}/g, (_, label) => {
      const key = String(label).trim()
      if (key === '이름') return String((profile && profile.name) || '').trim()
      const hit = items.find((it) => String(it.label || '').trim() === key)
      return hit ? String(hit.value || '').trim() : ''
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const ROTATE_OPTIONS = [
  { value: '0', label: '고정 (첫 예문만)' },
  { value: '3', label: '3초' },
  { value: '4', label: '4초' },
  { value: '6', label: '6초' },
  { value: '8', label: '8초' },
]

/* 탐색 검색창 — 입력 형식 안내(예문 로테이션)를 갖는 폼. 예문은 저자가 적은 목록(placeholders)이고 AI 가 아니다:
   "상황 + 고민 + 원하는 결과" 꼴을 보여 자연어로 묻게 하는 자리라 추천 검색어 칩(다음 행동 선택지)과 역할이 다르다.
   홈(player)에서만 rotateSec 간격으로 다음 예문으로 넘어가고, 캔버스는 첫 예문을 고정으로 보인다 */
function SearchBoxForm({ p, ctx }) {
  const isPlayer = ctx.mode === 'player'
  const value = isPlayer ? ctx.player.query : ''
  const examples = useMemo(() => {
    const list = splitTextList(p.placeholders)
    return (list.length ? list : [String(p.placeholder || '')]).map((text) => fillProfileTokens(text, ctx.profile)).filter(Boolean)
  }, [p.placeholders, p.placeholder, ctx.profile])
  const rotateMs = Math.max(0, Number(p.rotateSec == null || p.rotateSec === '' ? 4 : p.rotateSec) || 0) * 1000
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!isPlayer || examples.length < 2 || !rotateMs) return undefined
    const timer = setInterval(() => setIdx((i) => i + 1), rotateMs)
    return () => clearInterval(timer)
  }, [isPlayer, examples.length, rotateMs])
  const placeholder = examples.length ? examples[idx % examples.length] : ''
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
            placeholder={placeholder}
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
            placeholder={placeholder}
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
}

/* 추천 검색어 칩 개수 선택지 (인스펙터 select — 값은 문자열로 저장) */
const CHIP_COUNT_OPTIONS = [
  { value: '0', label: '표시 안 함' },
  { value: '1', label: '1개' },
  { value: '2', label: '2개' },
  { value: '3', label: '3개' },
]
const chipCount = (value) => Math.max(0, Math.min(3, Number(value == null || value === '' ? 3 : value) || 0))
/* 추천 칩 섞기 — 보라(개인화)·파랑(인기)을 한 줄에 순서 없이 섞는다(2026-09-15). 시드는 칩 내용 + 접속 1회 소금(FNV-1a → mulberry32
   → Fisher-Yates): 같은 내용이면 같은 순서라 재렌더·홈 복귀·크로스페이드에 칩이 뛰지 않고, 새로고침마다는 다르게 섞인다 */
const MIX_SALT = String(Math.random())
const mixChips = (list, seedText) => {
  let seed = 2166136261
  const text = seedText + MIX_SALT
  for (let i = 0; i < text.length; i += 1) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619)
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
/* 칩 종류 아이콘 — 보라 = ✦(맞춤 설문·라이브 생성으로 직행), 파랑 = 돋보기(검색 결과로). 글자색을 따른다 */
const RecoChipIcon = ({ kind }) => (
  <span className="sb-chip-reco__icon" aria-hidden="true">{kind === 'popular' ? <SearchIcon /> : <SparkIcon />}</span>
)

/* 탐색 단계 컴포넌트 — 홈 상단 인사·검색·칩·웹진 스토리 카드 */
export const EXPLORE_COMPONENTS = {
  greeting: {
    label: '인사말 배너',
    stage: 'explore',
    icon: '💬',
    hint: '홈 상단 상태 인사 — 기본 문구가 먼저 보이고, 현재 시각·날씨·쇼핑 쓰레드 상태로 만든 인사가 페이드인. 쓰레드 언급(「」)은 눌러서 이어본다',
    defaults: { text: '유진님, 오늘도 반가워요. 어떤 뷰티 고민이든 편하게 적어 보세요.', personalize: true },
    fields: [
      { key: 'text', label: '기본 인사말 문구 (개인화 인사가 오기 전까지 보임)', kind: 'textarea' },
      { key: 'personalize', label: '개인화 상태 인사로 전환 (시각·날씨·쇼핑 쓰레드 상태)', kind: 'toggle', defaultValue: true },
    ],
    /* 역할은 "당신을 알고, 지금 어디까지 왔는지"를 말하는 상태 인사다 — 검색어 제안은 추천 검색어 칩 몫. 홈(player)에서는 기본 문구 →
       개인화 문구를 크로스페이드로 잇고(hooks/useHomePersonalize — ctx.home.greeting.text 가 오면 전환, 세션 캐시가 있으면 처음부터
       개인화 문구), 최근 쓰레드를 가리키는 「」 부분은 탭하면 그 쓰레드로 이어진다(ctx.home.greeting.threadId + ctx.home.resumeThread).
       캔버스는 기본 문구만(인라인 편집 대상) */
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
      const resume = personal && live.threadId && ctx.home.resumeThread ? () => ctx.home.resumeThread(live.threadId) : null
      return (
        <div className={'beauty-greeting sb-static' + (personal ? ' is-personal' : '')}>
          <CrossFade stamp={personal ? `live:${personal}` : 'base'}>
            <span>{personal ? greetingNodes(personal, resume) : kText(p.text, ctx, 'text')}</span>
          </CrossFade>
        </div>
      )
    },
  },

  searchBox: {
    label: '탐색 검색창',
    stage: 'explore',
    icon: '🔍',
    hint: '시나리오의 시작 질문을 입력받는 검색창 — 플레이스홀더는 입력 형식 안내 예문(저자 편집, AI 아님)이 로테이션된다',
    defaults: {
      placeholder: '예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업',
      placeholders: DEFAULT_SEARCH_PLACEHOLDERS.join('\n'),
      rotateSec: '4',
      multiline: false,
    },
    fields: [
      { key: 'placeholders', label: '예문 로테이션 — 입력 형식 안내 ({피부타입}·{이름}처럼 프로필 라벨 치환)', kind: 'stringList', list: true },
      { key: 'rotateSec', label: '예문 전환 간격', kind: 'select', defaultValue: '4', options: ROTATE_OPTIONS },
      { key: 'placeholder', label: '기본 플레이스홀더 (예문 목록이 비면 이 문구만)', kind: 'text' },
      { key: 'multiline', label: '긴 텍스트를 여러 줄로 (끄면 말줄임)', kind: 'toggle' },
    ],
    render: (p, ctx) => <SearchBoxForm p={p} ctx={ctx} />,
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

  /* 추천 검색어 칩 — 검색창 아래 두 톤(Figma Search 랜딩 ChipSection): 보라 = ✦ + 내 쇼핑 쓰레드 히스토리로 만든 개인화 자연어 검색어
     (BFF `/api/search/home`, 실패면 휴리스틱 — 최근 쓰레드 제목·프로필), 파랑 = 돋보기 + 전체 사용자 인기 검색어 후보 표 상위
     (`/api/search/popular` — core KV, 실패면 시드 표). 두 톤은 역할 캡션 없이 **한 줄에 순서 없이 섞여** 선다(2026-09-15 — 종류는
     아이콘·색이 가른다. 옛 「내 쓰레드에서 이어서 / 지금 인기 검색어」 캡션과 파랑 칩의 `#키워드` 표기는 뗐다). 내용은
     hooks/useHomePersonalize 가 ctx.home 으로 공급하고 바뀌면 크로스페이드로 갈아끼운다.
     칩 클릭 = 검색 제출 — 칩 종류가 곧 목적지다: 보라 = 맞춤 설문(DDAK) 직행, 파랑 = 검색 결과 페이지(SRP) 직행 (라우터 판정 없음) */
  recommendChips: {
    label: '추천 검색어 칩',
    stage: 'explore',
    icon: '💡',
    hint: '보라 ✦ = 내 쇼핑 쓰레드로 만든 개인화 검색어 · 파랑 🔍 = 전체 사용자 인기 검색어 — 한 줄에 순서 없이 섞임 (내용은 자동)',
    defaults: { personalCount: '3', popularCount: '3' },
    fields: [
      { key: 'personalCount', label: '개인화 추천 검색어 (보라 ✦) 개수', kind: 'select', defaultValue: '3', options: CHIP_COUNT_OPTIONS },
      { key: 'popularCount', label: '인기 검색어 (파랑 🔍) 개수', kind: 'select', defaultValue: '3', options: CHIP_COUNT_OPTIONS },
    ],
    render: (p, ctx) => {
      const nPersonal = chipCount(p.personalCount)
      const nPopular = chipCount(p.popularCount)
      const home = ctx.mode === 'player' ? ctx.home : null
      if (!home) {
        // 캔버스·미리보기 자리표시자 — 실제 문구는 홈에서 쓰레드·인기 표로 채워진다
        const samples = [
          ...Array.from({ length: nPersonal }, (_, i) => ({ key: `p${i}`, kind: 'personal', text: `내 쓰레드 기반 추천 ${i + 1}` })),
          ...Array.from({ length: nPopular }, (_, i) => ({ key: `h${i}`, kind: 'popular', text: `인기 검색어 ${i + 1}` })),
        ]
        return (
          <div className="clean-tag-row sb-static">
            {mixChips(samples, 'sample').map((c) => (
              <span key={c.key} className={`suggestion-tag sb-chip-reco sb-chip-reco--${c.kind} sb-chip-reco--sample`}>
                <RecoChipIcon kind={c.kind} />
                {c.text}
              </span>
            ))}
          </div>
        )
      }
      const submit = (text, to) => {
        if (ctx.player.submitSearch) ctx.player.submitSearch(text, to)
        else ctx.player.setQuery(text)
      }
      const personal = ((home.personal && home.personal.items) || []).slice(0, nPersonal)
      const popular = ((home.popular && home.popular.items) || []).slice(0, nPopular)
      if (!personal.length && !popular.length) return null
      const chips = [
        ...personal.map((text) => ({
          key: `p:${text}`,
          kind: 'personal',
          text,
          title: '내 쇼핑 쓰레드로 만든 추천 검색어 — 맞춤 설문으로 바로 시작',
          onClick: () => submit(text, 'ddak'),
        })),
        ...popular.map((row) => ({
          key: `h:${row.keyword}`,
          kind: 'popular',
          text: String(row.keyword),
          title: `인기 검색어 · 최근 ${Number(row.count || 0).toLocaleString('ko-KR')}회 — 검색 결과 보기`,
          onClick: () => submit(row.keyword, 'srp'),
        })),
      ]
      const stamp = chips.map((c) => c.key).join('|')
      return (
        <CrossFade className="sb-recochips sb-static" stamp={stamp}>
          <div className="clean-tag-row">
            {mixChips(chips, stamp).map((c) => (
              <button
                key={c.key}
                type="button"
                className={`suggestion-tag sb-chip-reco sb-chip-reco--${c.kind}`}
                title={c.title}
                onClick={c.onClick}
              >
                <RecoChipIcon kind={c.kind} />
                {c.text}
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
