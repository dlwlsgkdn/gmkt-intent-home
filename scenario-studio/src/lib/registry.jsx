import React from 'react'
import { splitList, splitOptions } from './store.js'
import { FONT_OPTIONS, TOKEN_RE, richSpanPresentation, InlineEditor } from './richtext.jsx'

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

/* "제목|설명|이미지URL" 쉼표 목록 파싱 — 가로/세로 스크롤 패널 공용 */
function parseCards(text) {
  return splitList(text).map((chunk) => {
    const [title, sub, imageUrl] = chunk.split('|').map((s) => s.trim())
    return { title: title || '', sub: sub || '', imageUrl: imageUrl || '' }
  })
}

/* 스크롤 컨테이너의 스크롤바 표시 유틸 클래스 */
const scrollCls = (show) => (show ? ' sb-scroll-bar' : ' sb-scroll-hide')

/* 캔버스에서 컨테이너 자식을 감싸는 셸 — 클릭 선택/더블클릭 편집/드래그 재배치/리사이즈 핸들 */
function ChildShell({ item, ctx, children }) {
  const selected = ctx.selectedIds && ctx.selectedIds.includes(item.id)
  return (
    <div
      className={
        'sb-child' +
        (selected ? ' sb-child--selected' : '') +
        (item.hidden ? ' sb-child--hidden' : '')
      }
      data-child-id={item.id}
      data-child-of={item.parentId}
      onPointerDown={(e) => ctx.childPointerDown && ctx.childPointerDown(e, item.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (ctx.inspectChild) ctx.inspectChild(item.id)
      }}
    >
      {children}
      {ctx.childResizeDown && (
        <span
          className="sb-resize-handle sb-child__resize"
          title="크기 조절"
          onPointerDown={(e) => ctx.childResizeDown(e, item.id)}
        />
      )}
    </div>
  )
}

/* 가로 스크롤 트랙 — 데스크탑 마우스 드래그 스크롤 + 옵션 좌우 화살표 (스냅 유지) */
function ScrollTrack({ className, children, interactive, arrows, slideGap = 12 }) {
  const ref = React.useRef(null)
  const draggedRef = React.useRef(false)

  const onPointerDown = (e) => {
    const el = ref.current
    if (!el || e.button !== 0) return
    const startX = e.clientX
    const startLeft = el.scrollLeft
    const prevSnap = el.style.scrollSnapType
    let moved = false
    const move = (ev) => {
      const dx = ev.clientX - startX
      if (!moved && Math.abs(dx) > 5) {
        moved = true
        draggedRef.current = true
        el.style.scrollSnapType = 'none' // 드래그 중엔 스냅 해제
      }
      if (moved) el.scrollLeft = startLeft - dx
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        el.style.scrollSnapType = prevSnap // 복원 → 가장 가까운 슬라이드로 스냅
        setTimeout(() => { draggedRef.current = false }, 120)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const page = (dir) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * (el.clientWidth + slideGap), behavior: 'smooth' })
  }

  return (
    <div className="sb-track-wrap">
      <div
        ref={ref}
        className={className}
        onPointerDown={interactive ? onPointerDown : undefined}
        onClickCapture={(e) => {
          // 드래그 직후의 클릭은 카드 클릭으로 취급하지 않는다
          if (draggedRef.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        {children}
      </div>
      {arrows && (
        <>
          <button type="button" className="sb-track-arrow sb-track-arrow--prev" aria-label="이전" onClick={() => page(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button type="button" className="sb-track-arrow sb-track-arrow--next" aria-label="다음" onClick={() => page(1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>
        </>
      )}
    </div>
  )
}

/* 캔버스 편집 모드 여부 — 컨테이너 클리핑을 풀고 경계를 점선으로 표시 (Figma의 clip 무시,
   Webflow/Framer의 편집 캔버스 ↔ 미리보기 토글 패턴) */
const isEditView = (ctx) => ctx.mode === 'canvas' && ctx.canvasView !== 'preview'

/* 캔버스 편집 모드의 빈 컨테이너 드롭존 (미리보기·실행 화면에서는 렌더 안 함) */
const EmptyDropZone = ({ ctx }) =>
  isEditView(ctx) ? (
    <div className="sb-container-empty">컴포넌트를 여기로 끌어다 놓으세요</div>
  ) : null

/* 텍스트 안의 [[키워드]]를 점선 밑줄로 렌더 — 플레이어에서 클릭하면 설명 모달.
   사전은 탐색 페이지 편집기의 '키워드 사전'에서 관리한다. */
function RichSpan({ optsStr, content, ctx, i }) {
  const { spec, cls, style } = richSpanPresentation(optsStr)
  return (
    <span
      key={i}
      className={cls.join(' ')}
      style={style}
      role={spec.kw ? 'button' : undefined}
      onClick={spec.kw ? (e) => {
        if (ctx && ctx.mode === 'player' && ctx.player.showKeyword) {
          e.stopPropagation()
          ctx.player.showKeyword(content)
        }
      } : undefined}
    >
      {content}
    </span>
  )
}

/* 텍스트 렌더러: [[키워드]] 점선 밑줄 + {{서식|텍스트}} 부분 서식.
   fieldKey를 넘기면 캔버스에서 더블클릭 → 컴포넌트 안에서 바로 편집(WYSIWYG) */
export function kText(text, ctx, fieldKey) {
  const str = String(text ?? '')
  const parts = str.split(TOKEN_RE).map((part, i) => {
    const kw = part.match(/^\[\[([^\]]+)\]\]$/)
    if (kw) return <RichSpan key={i} optsStr="kw" content={kw[1]} ctx={ctx} i={i} />
    const rich = part.match(/^\{\{([^|{}]*)\|([^{}]*?)\}\}$/)
    if (rich) return <RichSpan key={i} optsStr={rich[1]} content={rich[2]} ctx={ctx} i={i} />
    return part
  })

  // 캔버스 인라인 편집
  if (fieldKey && ctx && ctx.mode === 'canvas' && ctx.beginEdit) {
    const editingThis = ctx.editing && ctx.editing.itemId === ctx.itemId && ctx.editing.key === fieldKey
    if (editingThis) {
      return <InlineEditor raw={str} onCommit={(v) => ctx.commitEdit(ctx.itemId, fieldKey, v)} />
    }
    return (
      <span
        className="sb-editable"
        title="더블클릭해서 바로 편집"
        onDoubleClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.beginEdit(ctx.itemId, fieldKey)
        }}
      >
        {parts}
      </span>
    )
  }
  return parts
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
        <span className="clean-info-kicker">{kText(p.kicker, ctx, 'kicker')}</span>
        <h2>{kText(p.title, ctx, 'title')}</h2>
        <p>{kText(p.desc, ctx, 'desc')}</p>
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
      { key: 'options', label: '선택지 (메인|서브, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'multi', label: '복수 선택 허용', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const opts = splitOptions(p.options)
      const isPlayer = ctx.mode === 'player'
      const answer = isPlayer ? ctx.player.answers[ctx.itemId] : undefined
      const selectedSet = new Set(
        p.multi ? (Array.isArray(answer) ? answer : []) : answer != null ? [answer] : []
      )
      // 원본 clean-home 설문 마크업 구조 그대로 (clean-question-list가 라벨/그리드 스타일 담당)
      return (
        <div className="clean-question-list">
          <div>
            <label className="text-sm font-medium text-slate-400 mb-3 block">{kText(p.question, ctx, 'question')}</label>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 pt-2 -mt-2">
              {opts.map((opt, i) => {
                const selected = selectedSet.has(opt.main)
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      'flex-shrink-0 info-card border-2 border-slate-100 rounded-2xl transition-all bg-slate-50 hover:border-gmarket-blue p-3 text-center flex flex-col items-center justify-center gap-1 min-w-[5rem]' +
                      (selected ? ' active-card ring-4 ring-blue-100' : '')
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
      { key: 'hidden', label: '숨길 항목 라벨 (쉼표 구분 · 캔버스 배지 클릭과 동기화)', kind: 'text', list: true },
    ],
    render: (p, ctx) => {
      const profile = ctx.profile || { name: '사용자', items: [] }
      const items = (profile.items || []).filter((it) => it.label && it.label.trim())
      const hidden = splitList(p.hidden)
      const isPlayer = ctx.mode === 'player'
      const excluded = isPlayer ? ctx.player.excludedProfile || [] : []
      // 플레이어에서는 숨긴 항목을 아예 안 보여주고, 캔버스에서는 흐리게 보여준다
      const visible = isPlayer ? items.filter((it) => !hidden.includes(it.label)) : items
      // 원본 saved-profile-section 마크업/클래스 그대로
      return (
        <div className="saved-profile-section" style={{ display: 'block' }}>
          <div className="saved-profile-section__head">
            <span className="saved-profile-section__icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </span>
            <span className="saved-profile-section__title">{profile.name}님에 대해 이미 알고 있어요</span>
            <span className="saved-profile-section__hint">{isPlayer ? kText(p.hint, ctx) : '배지를 눌러 이 시나리오 노출을 켜고 끄세요'}</span>
          </div>
          <div className="saved-profile-section__chips">
            {visible.length === 0 && (
              <span className="sb-pinned-panel__empty">프로필 항목이 없어요. 탐색 페이지 편집기에서 추가하세요.</span>
            )}
            {visible.map((it) => {
              const off = isPlayer ? excluded.includes(it.label) : hidden.includes(it.label)
              return (
                <button
                  key={it.label}
                  type="button"
                  className={'saved-profile-chip' + (off ? ' saved-profile-chip--excluded' : '')}
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
                  <span className="saved-profile-chip__label">{it.label}</span>
                  <span className="saved-profile-chip__value">{it.value}</span>
                  <span className="saved-profile-chip__toggle" aria-hidden="true">
                    {off
                      ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
                  </span>
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
    hint: '프로필 + 설문에서 고른 답을 요약 (원본 설문 요약 스타일)',
    defaults: { title: '설문 요약' },
    fields: [{ key: 'title', label: '제목', kind: 'text' }],
    render: (p, ctx) => {
      const data =
        (ctx.mode === 'player' ? ctx.player.summary : ctx.summaryPreview) || { profile: [], questions: [] }
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
      { key: 'points', label: '체크포인트 (쉼표 구분)', kind: 'textarea', list: true },
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
          {splitList(p.points).length ? (
            <ul className="mt-4 space-y-2">
              {splitList(p.points).map((pt, i) => (
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
      name: '수분광 톤업 프라이머 30ml',
      price: '18,900',
      score: '94',
      external: false,
      mall: '',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    fields: [
      { key: 'name', label: '상품명', kind: 'text' },
      { key: 'price', label: '가격 (원 제외)', kind: 'text' },
      { key: 'score', label: '매칭률 (%)', kind: 'text' },
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
            <Img src={p.imageUrl} alt={p.name} />
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
            </div>
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
      { key: 'items', label: '항목 (쉼표 구분)', kind: 'textarea', list: true },
    ],
    render: (p, ctx) => (
      <div className="rounded-[28px] border border-slate-100 bg-slate-50/80 p-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 mb-3">{kText(p.title, ctx, 'title')}</p>
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
        {p.kicker ? <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 block mb-2">{kText(p.kicker, ctx, 'kicker')}</span> : null}
        {p.title ? <h3 className="text-xl font-semibold text-slate-900 mb-2">{kText(p.title, ctx, 'title')}</h3> : null}
        {p.body ? <p className="text-sm leading-relaxed text-slate-600 whitespace-pre-wrap">{kText(p.body, ctx, 'body')}</p> : null}
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
        <p className="font-semibold text-slate-700 mb-1">{kText(p.title, ctx, 'title')}</p>
        <p className="whitespace-pre-wrap">{kText(p.body, ctx, 'body')}</p>
      </div>
    ),
  },

  hscroll: {
    label: '가로 스크롤 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'x',
    icon: '↔️',
    hint: '가로 스크롤 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드 목록도 가능)',
    defaults: {
      title: '함께 보면 좋아요',
      cardW: '168',
      scrollbar: false,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'cardW', label: '카드 너비(px)', kind: 'text' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const cardW = Math.max(96, Number(p.cardW) || 168)
      const kids = ctx.children || []
      const edit = isEditView(ctx)
      return (
        <div className={'sb-hscroll' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <ScrollTrack
            interactive={ctx.mode === 'player'}
            className={'sb-hscroll__track' + scrollCls(p.scrollbar) + (edit ? ' sb-hscroll__track--edit' : '')}
          >
            {kids.length > 0 ? (
              /* 자식은 편집자가 정한 자체 너비 유지 (없으면 카드 너비), 높이 지정 시 그대로 */
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-hscroll__slot"
                  style={{ width: c.item.w || cardW, height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))
            ) : (
              <>
                {cards.length === 0 && <EmptyDropZone ctx={ctx} />}
                {cards.map((c, i) => (
                  <div
                    key={i}
                    className="sb-hscroll__card"
                    style={{ width: cardW }}
                    role="button"
                    onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
                  >
                    <div className="sb-hscroll__thumb">
                      <Img src={c.imageUrl} alt={c.title} />
                    </div>
                    <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                    {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
                  </div>
                ))}
              </>
            )}
          </ScrollTrack>
        </div>
      )
    },
  },

  gridPanel: {
    label: '그리드 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'y',
    icon: '🔲',
    hint: 'N열 그리드 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드 목록도 가능)',
    defaults: {
      title: '카테고리 둘러보기',
      cols: '2',
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'cols', label: '열 수 (1~4)', kind: 'text' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const cols = Math.max(1, Math.min(4, Number(p.cols) || 2))
      const kids = ctx.children || []
      return (
        <div className={'sb-gridpanel' + (isEditView(ctx) ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <div className="sb-gridpanel__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {kids.length > 0 &&
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-gridpanel__slot"
                  style={{ width: c.item.w || undefined, maxWidth: '100%', height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-hscroll__card sb-gridpanel__card"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-hscroll__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
              </div>
            ))}
          </div>
        </div>
      )
    },
  },

  carousel: {
    label: '싱글 스크롤 캐러셀',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'x',
    icon: '🎠',
    hint: '한 장씩 스냅되는 캐러셀 레이아웃 — 다른 컴포넌트를 끌어다 슬라이드로 (텍스트 카드도 가능)',
    defaults: {
      title: '',
      scrollbar: false,
      arrows: true,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'arrows', label: '좌우 화살표 버튼', kind: 'toggle' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const kids = ctx.children || []
      const slideCount = kids.length > 0 ? kids.length : cards.length
      const edit = isEditView(ctx)
      return (
        <div className={'sb-carousel' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          {edit && slideCount > 1 && <p className="sb-edit-note">편집 모드 — 슬라이드를 모두 펼쳐 표시 중 (실사용은 한 장씩 스냅)</p>}
          <ScrollTrack
            interactive={ctx.mode === 'player'}
            arrows={!edit && !!p.arrows && slideCount > 1}
            className={'sb-carousel__track' + scrollCls(p.scrollbar) + (edit ? ' sb-carousel__track--edit' : '')}
          >
            {kids.length > 0 && kids.map((c) => <div key={c.key} className="sb-carousel__slot">{c.node}</div>)}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-carousel__card"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-carousel__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
              </div>
            ))}
          </ScrollTrack>
          {slideCount > 1 && (
            <p className="sb-carousel__hint" aria-hidden="true">← 옆으로 넘겨보세요 · {slideCount}장 →</p>
          )}
        </div>
      )
    },
  },

  tablePanel: {
    label: '테이블',
    stage: 'common',
    category: 'layout',
    icon: '📊',
    hint: '헤더 + 행 표. 셀은 "|", 행은 줄바꿈으로 구분 (셀 안 쉼표 사용 가능)',
    defaults: {
      title: '용량별 가격 비교',
      headers: '제품|용량|가격',
      rows: '수분광 프라이머|30ml|18,900원\n톤업 쿠션|15g|24,900원\n세팅 픽서|100ml|12,500원',
    },
    fields: [
      { key: 'title', label: '표 제목 (비우면 숨김)', kind: 'text' },
      { key: 'headers', label: '헤더 (| 구분)', kind: 'text' },
      { key: 'rows', label: '행 목록 (셀은 |, 행은 줄바꿈 — 줄바꿈이 없으면 쉼표)', kind: 'textarea', list: true },
    ],
    render: (p, ctx) => {
      const headers = String(p.headers || '').split('|').map((s) => s.trim()).filter(Boolean)
      // 행 구분: 줄바꿈 우선(셀 안 쉼표 허용), 줄바꿈이 없으면 쉼표
      const raw = String(p.rows || '')
      const rows = (raw.includes('\n') ? raw.split('\n') : raw.split(','))
        .map((s) => s.trim())
        .filter(Boolean)
        .map((row) => row.split('|').map((s) => s.trim()))
      return (
        <div className="sb-table">
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <div className="sb-table__scroll">
            <table>
              {headers.length > 0 && (
                <thead>
                  <tr>
                    {headers.map((h, i) => <th key={i}>{kText(h, ctx)}</th>)}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={Math.max(1, headers.length)} className="sb-table__empty">행을 입력하세요 — 예: 이름|용량|가격</td></tr>
                )}
                {rows.map((cells, ri) => (
                  <tr key={ri}>
                    {(headers.length ? headers : cells).map((_, ci) => (
                      <td key={ci}>{kText(cells[ci] || '', ctx)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    },
  },

  vscroll: {
    label: '세로 스크롤 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'y',
    icon: '↕️',
    hint: '고정 높이 세로 스크롤 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드도 가능)',
    defaults: {
      title: '더 볼만한 항목',
      panelH: '280',
      scrollbar: true,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'panelH', label: '스크롤 영역 높이(px)', kind: 'text' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const panelH = Math.max(120, Number(p.panelH) || 280)
      const kids = ctx.children || []
      const edit = isEditView(ctx)
      return (
        <div className={'sb-vscroll' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <div
            className={'sb-vscroll__list' + scrollCls(p.scrollbar) + (edit ? ' sb-vscroll__list--edit' : '')}
            style={edit ? { minHeight: 80 } : { height: panelH }}
          >
            {edit && (
              <span className="sb-edit-extent" style={{ top: panelH }} aria-hidden="true">
                실제 표시 높이 {panelH}px
              </span>
            )}
            {kids.length > 0 &&
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-vscroll__slot"
                  style={{ width: c.item.w || undefined, maxWidth: '100%', height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-vscroll__row"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-vscroll__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <div className="sb-vscroll__body">
                  <p className="sb-vscroll__name">{kText(c.title, ctx)}</p>
                  {c.sub ? <p className="sb-vscroll__sub">{kText(c.sub, ctx)}</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    },
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
    render: (p, ctx) => (
      <figure className="sb-static">
        <div className="rounded-[28px] overflow-hidden border border-slate-100 shadow-sm bg-slate-50 sb-image-card">
          <Img src={p.imageUrl} alt={p.caption} />
        </div>
        {p.caption ? <figcaption className="mt-2 text-xs text-slate-400 text-center">{kText(p.caption, ctx, 'caption')}</figcaption> : null}
      </figure>
    ),
  },
}

export function libraryForStage(stageKey) {
  return Object.entries(LIBRARY)
    .filter(([, def]) => def.stage === stageKey || def.stage === 'common')
    .map(([type, def]) => ({ type, ...def }))
}

/* 컨테이너(레이아웃) 컴포넌트의 자식 아이템 — 같은 스테이지 배열에 parentId로 저장 */
export function childrenOf(items, parentId) {
  return (items || [])
    .filter((it) => it.parentId === parentId)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
}

export function renderItem(item, ctx) {
  const def = LIBRARY[item.type]
  if (!def) return <div className="text-xs text-red-400">알 수 없는 컴포넌트: {item.type}</div>

  /* 컨테이너면 자식들을 먼저 렌더해 ctx.children으로 공급 (ctx.allItems 필요) */
  let renderCtx = { ...ctx, itemId: item.id }
  if (def.container) {
    const kids = childrenOf(ctx.allItems, item.id).filter(
      (k) => !(ctx.mode === 'player' && k.hidden)
    )
    renderCtx.children = kids.map((k) => ({
      key: k.id,
      item: k, // 슬롯이 자식의 고유 크기(w/h)를 존중할 수 있도록 전달
      node:
        isEditView(ctx) && ctx.childPointerDown ? (
          <ChildShell item={k} ctx={ctx}>{renderItem(k, ctx)}</ChildShell>
        ) : (
          renderItem(k, ctx)
        ),
    }))
  }
  const el = def.render(item.props, renderCtx)

  /* 텍스트 스타일이 지정된 경우 래퍼로 감싸 강제 상속시킨다 */
  const st = item.style || {}
  const hasStyle = st.font || st.size || st.color || st.bold
  if (!hasStyle) return el

  const fontStack = FONT_OPTIONS.find((f) => f.key === st.font)?.stack || null
  const cls = ['sb-styled']
  const style = {}
  if (fontStack) { style['--sb-font'] = fontStack; cls.push('sb-style-font') }
  if (st.color) { style['--sb-color'] = st.color; cls.push('sb-style-color') }
  if (st.size) { style['--sb-size'] = `${st.size}px`; cls.push('sb-style-size') }
  if (st.bold) cls.push('sb-style-bold')
  return <div className={cls.join(' ')} style={style}>{el}</div>
}
