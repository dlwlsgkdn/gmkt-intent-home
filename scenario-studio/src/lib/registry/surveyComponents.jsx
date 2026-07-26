import React from 'react'
import { splitList, splitOptions } from '../store.js'
import { ScrollTrack, isInteractionView, kText } from './support.jsx'

/* 설문 단계 컴포넌트 — 헤더·질문·프로필 요약 */
export const SURVEY_COMPONENTS = {
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
    hint: '선택지 배치 수·도형·가로 스크롤을 조절하는 질문',
    defaults: {
      question: '지금 피부에서 가장 신경 쓰이는 건?',
      options: '유분 무너짐|오후 T존, 들뜸·건조|각질 부각, 톤 안 맞음|경계 표시, 커버력 부족|잡티',
      multi: false,
      maxPerRow: '4',
      optionShape: 'card',
      horizontalScroll: true,
      defaultAnswer: '',
      locked: false,
    },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'textarea' },
      { key: 'options', label: '선택지 (메인|서브, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'multi', label: '복수 선택 허용', kind: 'toggle' },
      {
        key: 'maxPerRow',
        label: '한 줄에 보이는 최대 선택지',
        kind: 'select',
        defaultValue: '4',
        options: ['1', '2', '3', '4', '5', '6'].map((value) => ({ value, label: `${value}개` })),
      },
      {
        key: 'optionShape',
        label: '선택지 도형',
        kind: 'select',
        defaultValue: 'card',
        options: [
          { value: 'card', label: '카드형' },
          { value: 'pill', label: '알약형' },
          { value: 'square', label: '정사각형' },
          { value: 'circle', label: '원형' },
        ],
      },
      { key: 'horizontalScroll', label: '가로 스크롤 사용', kind: 'toggle', defaultValue: true },
      { key: 'defaultAnswer', label: '미리 선택할 답변', kind: 'text' },
      { key: 'locked', label: '미리 선택한 답변 고정', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const opts = splitOptions(p.options)
      const isPlayer = ctx.mode === 'player'
      const maxPerRow = Math.max(1, Math.min(6, Number(p.maxPerRow) || 4))
      const shape = ['card', 'pill', 'square', 'circle'].includes(p.optionShape) ? p.optionShape : 'card'
      const horizontalScroll = p.horizontalScroll !== false
      const optionLayoutStyle = horizontalScroll
        ? { gridAutoColumns: `calc(${100 / maxPerRow}% - ${(8 * (maxPerRow - 1)) / maxPerRow}px)` }
        : { gridTemplateColumns: `repeat(${maxPerRow}, minmax(0, 1fr))` }
      const answer = isPlayer ? ctx.player.answers[ctx.itemId] : undefined
      const selectedSet = new Set(
        p.multi ? (Array.isArray(answer) ? answer : []) : answer != null ? [answer] : []
      )
      // 원본 clean-home 설문 마크업 구조 그대로 (clean-question-list가 라벨/그리드 스타일 담당)
      return (
        <div className="clean-question-list">
          <div>
            <label className="text-sm font-medium text-slate-400 mb-3 block">{kText(p.question, ctx, 'question')}</label>
            <ScrollTrack
              interactive={horizontalScroll && isInteractionView(ctx)}
              className={
                'sb-survey-options' +
                (horizontalScroll ? ' sb-survey-options--scroll sb-scroll-hide' : ' sb-survey-options--grid')
              }
              style={optionLayoutStyle}
            >
              {opts.map((opt, i) => {
                const selected = selectedSet.has(opt.main)
                return (
                  <button
                    key={i}
                    type="button"
                    className={
                      `sb-survey-option sb-survey-option--${shape} info-card border-2 border-slate-100 transition-all bg-slate-50 hover:border-gmarket-blue text-center flex flex-col items-center justify-center gap-1` +
                      (selected ? ' active-card ring-4 ring-blue-100' : '')
                    }
                    aria-disabled={!!p.locked}
                    onClick={() => {
                      if (!isPlayer || p.locked) return
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
            </ScrollTrack>
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
}
