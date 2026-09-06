import React, { useEffect, useMemo, useRef, useState } from 'react'
import { renderItem } from '../lib/registry.jsx'
import { livePlanItems, liveSurveyItems } from '../lib/livePage.js'

/*
 * 파이프라인 플레이그라운드 "전체 플로우"의 실렌더 미리보기 — 프로덕션(LivePlayer)과 같은
 * 스트리밍 문법으로 그린다: content 이벤트의 부분 페이지를 livePage 투영 + 레지스트리
 * player 렌더러로 도착 즉시 렌더(kText revealFade 글자 페이드·마운트 페이드인), 진행 꼬리
 * 스켈레톤, 뼈대 조기 확정 뒤 상품·콘텐츠 자리 로딩 카드까지 동일하다. 새 렌더 계층을
 * 만들지 않는다는 원칙 그대로 (AdminThreadPreview·LivePlayer와 같은 경로).
 *
 * 오른쪽 레일은 컴포넌트별 와이어 상세 말풍선 — 평가 스튜디오·라이브 피드백의 주석
 * (.sb-bubble) 문법을 재사용하되 여기 말풍선은 평가 입력이 아니라 관측(와이어 데이터
 * 상세)이고, 설문 질문 말풍선만 답변 선택 칩(플로우 재개 입력)을 겸한다. 위치는 앵커
 * (페이지의 실제 렌더 높이)에 맞추고 겹치면 아래로 민다 (LivePlayer layoutFbBubbles와
 * 같은 규칙 — 매 렌더 동기 실행 + rAF 보정). 좁은 컨테이너는 is-stacked로 일반 흐름 전환.
 */

const noop = () => {}

const SECTION_KIND_LABEL = { guide: '단계 안내', steps: '체크리스트', products: '상품 추천', contents: '참고 콘텐츠' }

/** 섹션 kind → livePage 투영 타입 — 말풍선의 "무엇으로 그려졌나" 표기 */
const SECTION_PROJECTION = {
  guide: 'planStep',
  steps: 'checklist',
  products: 'hscroll+productCard',
  contents: 'hscroll+video/articleCard',
}

/** URL → 도메인 한 조각 — 말풍선의 출처 근거 표기 (URL 없으면 null) */
const domainOf = (rawUrl) => {
  try {
    return new URL(String(rawUrl || '').trim()).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 말풍선 → 생성 단계 링크 라벨 — 클릭하면 단계 레이어 모달(이번 실행 프롬프트 = 실제 LLM 쿼리) */
const SOURCE_STAGE_LABEL = { survey: '설문 (3)', 'plan-skeleton': '뼈대 (5a)', 'plan-products': '검색 (5b)' }

/** 원장 사실 출처 — LedgerFact.source 한글 라벨 */
const FACT_SOURCE_LABEL = { profile: '프로필', answer: '답변', intent: '의도 해석', feedback: '피드백', signal: '행동 신호' }

/** 말풍선 좌우 배치 최소 컨테이너 폭 — 페이지(390) + 연결선(30) + 레일 최소폭 */
const STACK_BREAK = 660

const openNewTab = (rawUrl) => {
  try {
    const url = new URL(String(rawUrl || '').trim())
    if (['http:', 'https:'].includes(url.protocol)) window.open(url.href, '_blank', 'noopener,noreferrer')
  } catch {
    /* URL 없음 — 무시 */
  }
}

export default function FlowRunPreview({
  stage, // 'survey' | 'plan'
  page, // 와이어 페이지 (스트리밍 중엔 부분 페이지) — null이면 시작 스켈레톤
  streaming = false,
  pendingSlots = [], // 뼈대 조기 확정 뒤 아직 검색 결과가 안 채운 자리 인덱스 (plan)
  statusMessage = null, // 진행 문구 — 꼬리 스켈레톤·자리 로딩 카드에 표시
  answers = {}, // { [questionId]: string[] } — 설문 답변 (플로우 재개 입력)
  onAnswer = null, // (questionId, value: string|string[]) — null이면 읽기 전용
  profileItems = [], // 실험 조건 프로필 [{label, value}] — 프로필 패널 렌더 재료
  slotReasons = {}, // { [sectionIndex]: reason } — 뼈대(5a)가 남긴 자리 선정 기준 (최종 렌더엔 안 남는 근거)
  onOpenStage = null, // (stageId) — 말풍선 "생성 쿼리" 링크 → 단계 레이어 모달 (실제 프롬프트 열람)
  surveySummary = { profile: [], questions: [] }, // 계획 페이지 surveySummary 패널 재료
  overall = null, // 페이지 전체 말풍선 { label, chip?, lines[], error?, dropLog?, foot? }
}) {
  const [activeId, setActiveId] = useState(null)
  const rootRef = useRef(null)
  const pageRef = useRef(null)
  const railRef = useRef(null)
  const anchorRefs = useRef({}) // 최상위 아이템 id → 페이지의 래퍼 엘리먼트
  const bubbleRefs = useRef({}) // 말풍선 id → 엘리먼트

  /* 와이어 페이지 → 아이템 투영 — LivePlayer 부분 스트리밍과 같은 규칙: 서버가 아직 안
     보낸 index는 빈 슬롯이라 걸러내고, LLM 산출물인 제목/인트로는 도착 전엔 감춘다 */
  const allItems = useMemo(() => {
    if (!page) return []
    if (stage === 'survey') {
      const items = liveSurveyItems({ intro: page.intro || '', questions: (page.questions || []).filter(Boolean) })
      return streaming && !page.intro ? items.filter((it) => it.id !== 'live-survey-intro') : items
    }
    const items = livePlanItems(
      { headline: page.headline || '', summary: page.summary || '', sections: page.sections || [] },
      { pendingSlots },
    )
    return streaming && !page.headline ? items.filter((it) => it.id !== 'live-plan-title') : items
  }, [page, stage, streaming, pendingSlots])
  const items = allItems.filter((it) => !it.parentId)

  const interactive = !!onAnswer && !streaming

  /* 읽기 전용 player 스텁 (AdminThreadPreview와 같은 문법) — 설문 답변만 살아 있는 쓰기다:
     페이지의 질문 카드가 곧 답변 선택 표면이라 프로덕션과 같은 상호작용이 된다 */
  const playerApi = useMemo(() => {
    const answerMap = {}
    if (stage === 'survey') {
      for (const q of (page && page.questions) || []) {
        if (!q) continue
        const arr = answers[q.id] || []
        answerMap[q.id] = q.multi ? arr : arr[0]
      }
    }
    return {
      query: '',
      setQuery: noop,
      submitQuery: noop,
      answers: answerMap,
      setAnswer: interactive ? (id, value) => onAnswer(id, value) : noop,
      addToCart: noop,
      complete: noop,
      showKeyword: noop,
      openExternal: (label, rawUrl) => openNewTab(rawUrl),
      openProduct: ({ url }) => openNewTab(url),
      excludedProfile: [],
      toggleProfileItem: noop,
      summary: surveySummary,
    }
  }, [stage, page, answers, interactive, onAnswer, surveySummary])

  /* 말풍선 대상 — 컴포넌트를 만드는 데 쓰인 데이터를 보여준다 (livePage id 규칙과 같은 앵커).
     렌더에 이미 보이는 콘텐츠 원문(인트로·안내 문구·상품명 가격 등)은 되풀이하지 않고,
     와이어 필드·투영 타입·근거(카탈로그 id·출처 몰·URL 도메인·썸네일 유무)를 싣는다 */
  const bubbles = useMemo(() => {
    if (!page) return []
    const list = []
    if (stage === 'survey') {
      for (const it of items) {
        if (it.id === 'live-survey-intro') {
          list.push({
            id: it.id,
            kind: 'text',
            label: '인트로',
            chip: 'head',
            meta: `head.intro → surveyIntro · ${(page.intro || '').length}자`,
            sourceStages: ['survey'],
          })
        } else if (it.type === 'surveyQuestion') {
          const q = (page.questions || []).find((question) => question && question.id === it.id)
          if (q)
            list.push({
              id: it.id,
              kind: 'question',
              label: q.question || '질문',
              chip: 'question',
              question: q,
              sourceStages: ['survey'],
            })
        }
      }
      return list
    }
    const sections = page.sections || []
    for (const it of items) {
      if (it.id === 'live-plan-summary') {
        list.push({
          id: it.id,
          kind: 'text',
          label: '요약',
          chip: 'head',
          meta: `head.summary → noticeCard · ${(page.summary || '').length}자`,
          sourceStages: ['plan-skeleton'],
        })
        continue
      }
      const pendingMatch = /^live-plan-pending-(\d+)$/.exec(it.id)
      if (pendingMatch) {
        const slotIndex = Number(pendingMatch[1])
        list.push({
          id: it.id,
          kind: 'pending',
          label: `상품·콘텐츠 자리 (섹션 ${slotIndex + 1})`,
          chip: '검색 중',
          slotReason: slotReasons[slotIndex] || null,
          sourceStages: ['plan-skeleton', 'plan-products'],
        })
        continue
      }
      const sectionMatch = /^live-plan-s(\d+)$/.exec(it.id)
      if (!sectionMatch) continue
      const index = Number(sectionMatch[1])
      const section = sections[index]
      if (!section) continue
      const isSearchKind = section.kind === 'products' || section.kind === 'contents'
      list.push({
        id: it.id,
        kind: 'section',
        label: section.title || SECTION_KIND_LABEL[section.kind] || section.kind,
        chip: SECTION_KIND_LABEL[section.kind] || section.kind,
        section,
        index,
        // 뼈대(5a)가 이 자리를 만들며 남긴 선정 기준 — 최종 렌더에는 검색(5b) reason만 남는다
        slotReason: isSearchKind ? slotReasons[index] || null : null,
        sourceStages: isSearchKind ? ['plan-skeleton', 'plan-products'] : ['plan-skeleton'],
      })
    }
    return list
  }, [page, stage, items, slotReasons])

  const toggleOption = (question, option) => {
    if (!interactive) return
    const arr = answers[question.id] || []
    const on = arr.includes(option)
    if (question.multi) onAnswer(question.id, on ? arr.filter((o) => o !== option) : [...arr, option])
    else onAnswer(question.id, on ? [] : [option])
  }

  /* "생성 쿼리" 링크 — 이 컴포넌트를 만든 LLM 단계의 실제 프롬프트(시스템 전문·가변부)를
     단계 레이어 모달로 연다. 왜/어떻게 구성됐는지의 원천 근거다 */
  const sourceLinks = (b) =>
    onOpenStage && b.sourceStages?.length ? (
      <div className="sb-flow-bubble__src">
        <span>생성 쿼리</span>
        {b.sourceStages.map((stageId) => (
          <button
            key={stageId}
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onOpenStage(stageId)
            }}
          >
            {SOURCE_STAGE_LABEL[stageId] || stageId}
          </button>
        ))}
      </div>
    ) : null

  const bubbleBody = (b) => {
    if (b.kind === 'text') return <p className="sb-flow-bubble__meta">{b.meta}</p>
    if (b.kind === 'question') {
      const q = b.question
      return (
        <>
          <p className="sb-flow-bubble__meta">
            {q.id} · {q.multi ? '복수 선택' : '단일 선택'} · question → surveyQuestion
            {interactive ? ' — 칩이나 페이지의 카드로 답을 골라요' : ''}
          </p>
          <div className="sb-pipe-play__opts">
            {(q.options || []).map((option) => {
              // 와이어 선택지는 "제목|부제" — 답(choices)은 제목만 실리므로 칩도 제목으로 대조한다
              const [label = '', sub = ''] = String(option).split('|').map((part) => part.trim())
              const on = (answers[q.id] || []).includes(label)
              return (
                <button
                  key={option}
                  type="button"
                  className={'sb-pipe-play__opt' + (on ? ' is-on' : '')}
                  disabled={!interactive}
                  title={sub || undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleOption(q, label)
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )
    }
    if (b.kind === 'pending') {
      return (
        <>
          {b.slotReason && <p className="sb-flow-bubble__text">자리 선정 기준 (뼈대 5a) — {b.slotReason}</p>}
          <p className="sb-flow-bubble__meta">{statusMessage || '웹 검색으로 상품·콘텐츠를 채우는 중이에요…'}</p>
        </>
      )
    }
    /* 섹션 — 투영 경로 + 항목별 근거(렌더에 안 보이는 재료). 검색(5b)의 추천 이유(reason)·
       본문은 페이지에 이미 그려지므로 되풀이하지 않고, 렌더에 안 남는 뼈대(5a)의
       자리 선정 기준만 싣는다 — "왜 이 자리에 이 컴포넌트인가"의 근거 */
    const s = b.section
    return (
      <>
        <p className="sb-flow-bubble__meta">
          sections[{b.index}] · {s.kind} → {SECTION_PROJECTION[s.kind] || s.kind}
          {s.kind === 'steps' ? ` · 항목 ${(s.steps || []).length}개` : ''}
          {s.kind === 'products' ? ` · 상품 ${(s.products || []).length}개` : ''}
          {s.kind === 'contents' ? ` · 콘텐츠 ${(s.items || []).length}개` : ''}
          {s.kind === 'guide' ? ` · 본문 ${(s.body || '').length}자${s.subtitle ? ' · 서브타이틀 ✓' : ' · 서브타이틀 없음'}` : ''}
        </p>
        {b.slotReason && <p className="sb-flow-bubble__text">자리 선정 기준 (뼈대 5a) — {b.slotReason}</p>}
        {s.kind === 'products' && (
          <ul className="sb-pipe-products">
            {(s.products || []).map((product, i) => (
              <li key={product.id || i}>
                <b>{product.name}</b>
                <span className="sb-admin__muted">
                  {' '}
                  {[
                    product.id ? `id ${product.id}` : null,
                    product.mall ? `외부몰 ${product.mall}` : '카탈로그 · 지마켓',
                    domainOf(product.url),
                    product.imageUrl ? '썸네일 ✓' : '이모지 폴백',
                    product.match ? `매칭율 ${product.match.score}%` : null,
                    product.urlKind === 'search' ? '검색 링크 (PDP 미확인)' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.kind === 'contents' && (
          <ul className="sb-pipe-products">
            {(s.items || []).map((item, i) => (
              <li key={i}>
                <b>{item.title}</b>
                <span className="sb-admin__muted">
                  {' '}
                  {[item.type === 'video' ? '영상' : '게시글', domainOf(item.url), item.imageUrl ? '썸네일 ✓' : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  /* ── 말풍선 배치 — LivePlayer layoutFbBubbles와 같은 규칙. 배치 불가(좁은 컨테이너·전역
     1100px 미디어의 static 전환 구간)는 is-stacked로 일반 흐름 전환하고 인라인 top을 걷는다 */
  const layoutBubbles = () => {
    const root = rootRef.current
    const pageEl = pageRef.current
    const rail = railRef.current
    if (!root || !pageEl || !rail) return
    const order = [...(overall ? ['__overall__'] : []), ...bubbles.map((b) => b.id)]
    const stacked = window.matchMedia('(max-width: 1100px)').matches || root.clientWidth < STACK_BREAK
    root.classList.toggle('is-stacked', stacked)
    if (stacked) {
      order.forEach((id) => {
        const bubble = bubbleRefs.current[id]
        if (bubble) bubble.style.top = ''
      })
      rail.style.height = ''
      return
    }
    const pageTop = pageEl.getBoundingClientRect().top
    let cursor = 0
    order.forEach((id) => {
      const bubble = bubbleRefs.current[id]
      if (!bubble) return
      const anchor = id === '__overall__' ? null : anchorRefs.current[id]
      const top = Math.max(anchor ? anchor.getBoundingClientRect().top - pageTop : 0, cursor)
      bubble.style.top = `${top}px`
      cursor = top + bubble.offsetHeight + 12
    })
    rail.style.height = `${Math.max(pageEl.offsetHeight, cursor)}px`
  }
  const layoutRef = useRef(layoutBubbles)
  layoutRef.current = layoutBubbles
  useEffect(() => {
    layoutRef.current()
    const raf = requestAnimationFrame(() => layoutRef.current())
    return () => cancelAnimationFrame(raf)
  })
  useEffect(() => {
    const root = rootRef.current
    const pageEl = pageRef.current
    if (!root || !pageEl) return undefined
    const run = () => layoutRef.current()
    const observer = new ResizeObserver(run)
    observer.observe(root)
    observer.observe(pageEl)
    window.addEventListener('resize', run)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', run)
    }
  }, [])

  const activateBubble = (id) => {
    setActiveId(id)
    anchorRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div ref={rootRef} className="sb-flow-preview">
      <div ref={pageRef} className="sb-flow-preview__page">
        <div className="sb-phone sb-phone--player">
          {items.length === 0 ? (
            streaming ? (
              /* 아직 그릴 재료가 없다 — 생성 대기 스켈레톤 (LivePlayer LiveSkeleton과 동일) */
              <div className="sb-live-loading" role="status" aria-live="polite">
                <p className="sb-live-status">
                  <span className="sb-live-status__spark" aria-hidden="true">✦</span>
                  {statusMessage || '생성하고 있어요…'}
                </p>
                <div className="sb-live-skel sb-live-skel--title" />
                <div className="sb-live-skel" />
                <div className="sb-live-skel sb-live-skel--tall" />
              </div>
            ) : (
              <p className="sb-table__empty">아직 생성된 페이지가 없어요.</p>
            )
          ) : (
            <>
              <div className="sb-player__stack">
                {items.map((it) => {
                  /* 검색 결과가 아직 안 채운 자리 — 레지스트리 밖 타입이라 여기서 직접 그린다 */
                  if (it.type === 'livePending') {
                    return (
                      <div
                        key={it.id}
                        ref={(el) => { anchorRefs.current[it.id] = el }}
                        className={
                          'sb-player__item'
                          + (it.stepSub ? ' sb-player__item--stepsub' : '')
                          + ' sb-live-annotate__anchor'
                          + (activeId === it.id ? ' is-active' : '')
                        }
                      >
                        <div className="sb-live-slot" role="status" aria-live="polite">
                          <p className="sb-live-status">
                            <span className="sb-live-status__spark" aria-hidden="true">✦</span>
                            {statusMessage || '추천 상품과 콘텐츠를 찾고 있어요…'}
                          </p>
                          <div className="sb-live-slot__cards" aria-hidden="true">
                            <div className="sb-live-skel sb-live-skel--card" />
                            <div className="sb-live-skel sb-live-skel--card" />
                          </div>
                        </div>
                      </div>
                    )
                  }
                  const isTarget = bubbles.some((b) => b.id === it.id)
                  return (
                    <div
                      key={it.id}
                      ref={(el) => { anchorRefs.current[it.id] = el }}
                      className={
                        'sb-player__item'
                        + (it.stepSub ? ' sb-player__item--stepsub' : '')
                        + (streaming ? ' sb-live-item-enter' : '')
                        + (isTarget ? ' sb-live-annotate__anchor' + (activeId === it.id ? ' is-active' : '') : '')
                      }
                    >
                      {/* revealFade — 스트리밍 중 kText가 새 글자만 페이드인 (프로덕션과 동일) */}
                      {renderItem(it, {
                        mode: 'player',
                        player: playerApi,
                        profile: { name: '사용자', items: profileItems },
                        allItems,
                        revealFade: streaming,
                      })}
                    </div>
                  )
                })}
              </div>
              {streaming && (
                /* 부분 스트리밍 꼬리 — 나머지 생성이 진행 중임을 보여준다 (LiveTail과 동일) */
                <div className="sb-live-tail" role="status" aria-live="polite">
                  <p className="sb-live-status">
                    <span className="sb-live-status__spark" aria-hidden="true">✦</span>
                    {statusMessage || '이어서 생성하고 있어요…'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 컴포넌트 상세 말풍선 레일 — 점선 연결선으로 앵커와 이어진다 (.sb-bubble 문법 재사용) */}
      <div ref={railRef} className="sb-flow-preview__rail" aria-label="컴포넌트 상세 말풍선">
        {overall && (
          <div
            ref={(el) => { bubbleRefs.current.__overall__ = el }}
            className={'sb-bubble sb-bubble--case sb-flow-bubble' + (activeId === '__overall__' ? ' is-active' : '')}
            onClick={() => setActiveId('__overall__')}
          >
            <div className="sb-bubble__head">
              <span className="sb-bubble__label">💬 {overall.label}</span>
              {overall.chip && <span className="sb-admin-prompt-chip">{overall.chip}</span>}
            </div>
            {(overall.lines || []).map((line, i) => (
              <p key={i} className="sb-flow-bubble__meta">{line}</p>
            ))}
            {/* 생성 제약 근거(원장) — 이 페이지가 따른 사실(출처 칩)·예산·기피·키워드.
                펼침/접힘이 말풍선 높이를 바꾸므로 배치를 다시 잡는다 */}
            {overall.ledger && (
              <details
                className="sb-flow-bubble__ledger"
                onToggle={() => requestAnimationFrame(() => layoutRef.current())}
              >
                <summary>
                  생성 제약 근거 (원장) — 사실 {(overall.ledger.facts || []).length}
                  {overall.ledger.budgetKrw != null
                    ? ` · 예산 ${overall.ledger.budgetKrw.toLocaleString('ko-KR')}원 이하`
                    : ''}
                  {(overall.ledger.avoid || []).length ? ` · 기피 ${overall.ledger.avoid.length}` : ''}
                </summary>
                <ul className="sb-flow-bubble__facts">
                  {(overall.ledger.facts || []).map((fact, i) => (
                    <li key={i}>
                      <b>{fact.label}</b> {fact.value}
                      <span className="sb-admin-prompt-chip">{FACT_SOURCE_LABEL[fact.source] || fact.source}</span>
                    </li>
                  ))}
                </ul>
                {(overall.ledger.avoid || []).length > 0 && (
                  <p className="sb-flow-bubble__meta">기피 — {overall.ledger.avoid.join(', ')}</p>
                )}
                {(overall.ledger.trendKeywords || []).length > 0 && (
                  <p className="sb-flow-bubble__meta">트렌드 키워드 — {overall.ledger.trendKeywords.join(', ')}</p>
                )}
                {(overall.ledger.recentFeedback || []).length > 0 && (
                  <p className="sb-flow-bubble__meta">직전 피드백 — {overall.ledger.recentFeedback.join(' / ')}</p>
                )}
              </details>
            )}
            {overall.error && <p className="sb-admin-gate__error">{overall.error}</p>}
            {overall.dropLog && overall.dropLog.length > 0 && (
              <ul className="sb-pipe-products">
                {overall.dropLog.map((drop, i) => (
                  <li key={i}>
                    <span className="sb-admin-prompt-chip sb-admin-prompt-chip--warn">{drop.code}</span> {drop.message}
                  </li>
                ))}
              </ul>
            )}
            {overall.foot && <div className="sb-flow-bubble__foot">{overall.foot}</div>}
          </div>
        )}
        {bubbles.map((b) => (
          <div
            key={b.id}
            ref={(el) => { bubbleRefs.current[b.id] = el }}
            className={'sb-bubble sb-flow-bubble sb-live-item-enter' + (activeId === b.id ? ' is-active' : '')}
            onClick={() => activateBubble(b.id)}
          >
            <div className="sb-bubble__head">
              <span className="sb-bubble__label">{b.label}</span>
              {b.chip && <span className="sb-admin-prompt-chip">{b.chip}</span>}
            </div>
            {bubbleBody(b)}
            {sourceLinks(b)}
          </div>
        ))}
      </div>
    </div>
  )
}
