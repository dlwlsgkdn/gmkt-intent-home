import React, { useEffect, useMemo, useRef, useState } from 'react'
import { timeAgo } from '../lib/timeAgo.js'
import { fetchLiveThread, listLiveThreads } from '../lib/liveApi.js'
import BottomSheet from './ui/BottomSheet.jsx'
import {
  cartEntries,
  cartNeedsEnrich,
  cartTotal,
  enrichCartEntries,
  formatWon,
  groupCartByStep,
  parsePrice,
  productLookupFromItems,
  productLookupFromPlanPage,
} from '../lib/cart.js'

/* 옛 이름-만 담기 기록의 썸네일 보정 — 라이브 쓰레드는 서버 계획 페이지를 한 번 받아 상품 표를 만든다.
   모듈 캐시: threadId → null(받는 중) | Map(완료 — 실패면 빈 표라 다시 받지 않는다) */
const liveLookupCache = new Map()

/* 시나리오 쓰레드의 상품 표 — 체험한 계획 케이스의 카드를 먼저, 나머지 케이스는 뒤에 (같은 이름은 먼저 것이 이긴다) */
function scenarioLookup(scenario, planCaseId) {
  const cases = scenario?.planCases || []
  const chosen = cases.find((c) => c.id === planCaseId)
  const items = [
    ...(chosen ? chosen.items || [] : []),
    ...cases.filter((c) => c !== chosen).flatMap((c) => c.items || []),
  ]
  return productLookupFromItems(items)
}

/* 원본(gmarket-advanced-clean-home)의 "마지막 페이즈" 라벨을 스튜디오 단계에 맞게 매핑 */
function phaseLabel(t) {
  if (t.status === 'completed') return '체험 완료'
  return t.stage === 'plan'
    ? `계획 확인 중${t.planCaseName ? ` · ${t.planCaseName}` : ''}`
    : '설문 작성 중'
}

/* 라이브 쓰레드에 남긴 평가 마커(t.feedback = { at, survey?: {score}, plan?: {score} }) 요약 줄 */
function feedbackLabel(fb) {
  const part = (label, stage) =>
    stage ? `${label} ${stage.score != null ? `★${stage.score}` : '💬'}` : null
  return [part('설문', fb.survey), part('계획', fb.plan)].filter(Boolean).join(' · ')
}

/* 카드 CTA — Figma ThreadCard 의 Button 두 변형: 설문을 쓰는 중이면 Primary 「이어서 답하기」,
   계획까지 봤거나 끝난 쓰레드면 Secondary(테두리) 「계획 보기」 */
function ctaFor(t) {
  if (t.status === 'completed' || t.stage === 'plan') return { label: '계획 보기', primary: false }
  return { label: '이어서 답하기', primary: true }
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
)
const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)
const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
)
const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </svg>
)
const MinusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 12h12" />
  </svg>
)

/* 담은 상품 썸네일 — 상품 카드와 같은 재료(lib/cart.js 항목): 이미지가 있으면 잘라(cover) 채우고, 목업 이모지면
   그 배경·이모지를, 둘 다 없으면(옛 이름-만 기록) 첫 글자를 보여준다 */
function CartThumb({ entry, className }) {
  const [failed, setFailed] = useState(false)
  const name = String(entry.name || '').trim()
  if (entry.imageUrl && !failed) {
    return (
      <span className={className + ' is-image'}>
        <img src={entry.imageUrl} alt="" draggable={false} onError={() => setFailed(true)} />
      </span>
    )
  }
  if (entry.emoji) {
    return (
      <span className={className + ' is-emoji'} style={entry.gradient ? { background: entry.gradient } : undefined} aria-hidden="true">
        {entry.emoji}
      </span>
    )
  }
  return <span className={className} aria-hidden="true">{name.charAt(0)}</span>
}

const MALL_TONE = { 'G마켓': 'gmarket', '지마켓': 'gmarket', '올리브영': 'oliveyoung' }
const mallOf = (entry) => (entry.external ? entry.mall || '외부몰' : entry.mall || 'G마켓')

/* 담은 상품 상세 시트 — Figma ThreadMoreSheet: 제목 + ✕ · 요약 행(파트 · 개수 | 합계) · 파트 카드(단계 제목 + 배지, 상품 행:
   60px 썸네일 · [브랜드] 상품명 · 가격 · 몰 · 빼기 ⊖) · 푸터 「뷰티 맞춤 계획 보기」 */
function CartSheet({ thread, steps = [], onClose, onRemove, onOpenPlan }) {
  const entries = cartEntries(thread.cart)
  const groups = groupCartByStep(thread.cart)
  const total = cartTotal(thread.cart)
  /* 파트 순서는 계획의 단계 목록을 따른다 — 담은 상품이 없는 단계도 빈 파트 행으로 보여 "어느 단계가 비었는지"가
     한눈에 들어온다 (Figma ThreadPartCardMargin/EmptyPartRow). 단계 목록을 모르는 옛 기록은 담은 순서 그대로 */
  const byStep = new Map(groups.map((group) => [group.step, group]))
  const ordered = steps.map((s) => ({
    step: s.title,
    stepBadge: byStep.get(s.title)?.stepBadge || s.badge || '',
    entries: byStep.get(s.title)?.entries || [],
  }))
  const leftovers = groups.filter((group) => !steps.some((s) => s.title === group.step))
  const parts = [...ordered, ...leftovers]
  const filled = parts.filter((part) => part.entries.length > 0).length
  const summary = steps.length
    ? `${filled}/${parts.length} 파트 · ${entries.length}개 담음`
    : `${filled ? `${filled}파트 · ` : ''}${entries.length}개 담음`
  return (
    <BottomSheet
      title={thread.title}
      align="start"
      closable
      onClose={onClose}
      footer={
        <button type="button" className="sb-cart-sheet__cta" onClick={onOpenPlan}>뷰티 맞춤 계획 보기</button>
      }
    >
      <div className="sb-cart-sheet__summary">
        <span>{summary}</span>
        {total != null && <strong className="sb-cart-sheet__total">{formatWon(total)}</strong>}
      </div>
      <div className="sb-cart-sheet__parts">
        {parts.map((group) => (
          <section key={group.step || '__rest'} className="sb-cart-part">
            {group.entries.length === 0 ? (
              /* 빈 파트 — 점선 썸네일 자리 + 단계 제목·배지 + 안내, 누르면 계획으로 (Figma EmptyPartRow) */
              <button type="button" className="sb-cart-part__empty" onClick={onOpenPlan} title="계획에서 이 단계의 상품을 담기">
                <span className="sb-cart-part__empty-thumb" aria-hidden="true"><PlusIcon /></span>
                <span className="sb-cart-part__empty-info">
                  <span className="sb-cart-part__head sb-cart-part__head--empty">
                    <span className="sb-cart-part__title">{group.step || '담은 상품'}</span>
                    {group.stepBadge ? <span className="sb-cart-part__badge">{group.stepBadge}</span> : null}
                  </span>
                  <span className="sb-cart-part__placeholder">상품을 추가해 보세요</span>
                </span>
                <span className="sb-cart-part__chevron" aria-hidden="true"><ChevronIcon /></span>
              </button>
            ) : (
              <>
                <div className="sb-cart-part__head">
                  <h4 className="sb-cart-part__title">{group.step || '담은 상품'}</h4>
                  {group.stepBadge ? <span className="sb-cart-part__badge">{group.stepBadge}</span> : null}
                </div>
                {group.entries.map((entry) => {
                  const mall = mallOf(entry)
                  const tone = MALL_TONE[mall] || (entry.external ? 'plain' : 'gmarket')
                  const price = parsePrice(entry.price)
                  return (
                    <div key={entry.index} className="sb-cart-item">
                      <CartThumb entry={entry} className="sb-cart-item__thumb" />
                      <div className="sb-cart-item__info">
                        <p className="sb-cart-item__name">
                          {entry.brand ? <span className="sb-cart-item__brand">[{entry.brand}]</span> : null}
                          {entry.name}
                        </p>
                        {price != null && <p className="sb-cart-item__meta">{formatWon(price)}</p>}
                        <span className={'sb-cart-item__mall sb-cart-item__mall--' + tone}>{mall}</span>
                      </div>
                      <button
                        type="button"
                        className="sb-cart-item__remove"
                        aria-label={`${entry.name} 빼기`}
                        title="담은 상품에서 빼기"
                        onClick={() => onRemove(entry.index)}
                      >
                        <MinusIcon />
                      </button>
                    </div>
                  )
                })}
              </>
            )}
          </section>
        ))}
      </div>
    </BottomSheet>
  )
}

/* 삭제 확인 모달 — Figma "정말로 삭제하시겠습니까?" (가운데 카드 · 삭제할게요 / 아니오) */
function ConfirmSheet({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <BottomSheet variant="center" align="center" closable={false} title={title} subtitle={message} onClose={onClose}>
      <div className="sb-confirm__actions">
        <button type="button" className="sb-confirm__btn is-primary" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="sb-confirm__btn" onClick={onClose}>아니오</button>
      </div>
    </BottomSheet>
  )
}

/* 쇼핑 쓰레드 히스토리 패널 — Figma [PP1K] Shopping Threads(내 프로필 · 쇼핑쓰레드 탭) 룩 (2026-09):
   머리(제목 + 개수 · 새 쓰레드 · 닫기) 아래 bg/subtle 바닥에 카드가 12px 간격으로 쌓인다. 카드 = 제목 + ⋯ · 태그 칩
   (칩/AI 배지 · 단계 · 평가) · 담은 상품 요약(썸네일 겹침 + "+n" — 누르면 상세 시트) · CTA(이어서 답하기 / 계획 보기).
   ⋯ 는 바텀시트(링크 복사 · 삭제하기)를 열고 삭제는 가운데 확인 모달을 거친다. 여는 버튼 위치(origin)에 맞는 방향(좌/우/중앙)에서 등장한다. */
/* 워크스페이스 쓰레드 기록 상한 — App.jsx recordThread 의 slice(0, 30) 과 같은 값. 기록이 이 수에 닿으면 그 뒤의 라이브
   쓰레드는 서버 목록에서 30개씩 이어 받는다 (지난 쓰레드 더 보기 — 무한스크롤) */
const THREAD_RECORD_LIMIT = 30
const OLDER_PAGE = 30

/* 서버 목록 행 → 패널 카드 재료. 기록에 없는 쓰레드라 담은 상품·평가 마커는 없다(이어보기를 하면 기록에 다시 들어온다).
   core status(exploring|surveying|planning|done)를 기록의 stage/status 문법으로 옮긴다 */
function olderCard(row) {
  const surveying = row.status === 'exploring' || row.status === 'surveying'
  return {
    id: row.id,
    title: row.title || (row.source && row.source.query) || '라이브 쓰레드',
    live: true,
    server: true,
    status: row.status === 'done' ? 'completed' : row.status,
    stage: surveying ? 'survey' : 'plan',
    startedAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export default function ThreadPanel({ api, open, origin = 'right', onClose }) {
  /* 평가한 쓰레드만 모아보기 — 라이브 체험에서 피드백을 저장한 쓰레드(t.feedback) 필터 */
  const [fbOnly, setFbOnly] = useState(false)
  /* 열린 시트 — null | { kind: 'more' | 'cart' | 'confirmDelete', id } | { kind: 'confirmClear' } */
  const [sheet, setSheet] = useState(null)
  useEffect(() => {
    if (!open) setSheet(null)
  }, [open])

  /* ── 지난 쓰레드 더 보기(무한스크롤) ──
     워크스페이스 기록은 최근 30개만 남기므로(App recordThread), 그 뒤의 라이브 쓰레드는 서버 목록(GET /threads —
     이 기기 기준 updatedAt 내림차순 키셋 커서)에서 30개씩 이어 받는다. 기록에 이미 있는 id 는 건너뛰고, 기록이
     상한(30)에 닿았을 때만 켠다 — 그 전엔 이 프로필의 라이브 쓰레드가 모두 기록에 있어 더 받을 게 없고, 패널에서
     지운 쓰레드가 되살아나 보이는 것도 막는다. 서버 목록은 기기 단위라 다른 프로필의 라이브 쓰레드도 섞일 수 있다 */
  const [older, setOlder] = useState({ items: [], cursor: null, exhausted: false, loading: false, error: null })
  const olderRef = useRef(older)
  olderRef.current = older
  const bodyRef = useRef(null)
  const sentinelRef = useRef(null)
  const olderEnabled = open && !fbOnly && api.threads.length >= THREAD_RECORD_LIMIT
  /* 총 개수는 스크롤 전에 미리 구한다 — 패널을 열 때 서버 목록 첫 페이지(limit 1)의 total(이 기기의 라이브 쓰레드 전체 수)을
     받아, 기록의 시나리오 쓰레드 수와 합쳐 "전체 n개"로 보여준다. 기록의 라이브 쓰레드는 모두 서버에도 있으므로 겹치지 않는다 */
  const [serverTotal, setServerTotal] = useState(null)
  useEffect(() => {
    if (!open || api.threads.length < THREAD_RECORD_LIMIT) return undefined
    let cancelled = false
    listLiveThreads({ limit: 1 })
      .then((res) => {
        if (!cancelled && typeof res.total === 'number') setServerTotal(res.total)
      })
      .catch(() => {
        /* 총 개수는 보조 정보 — 실패해도 기록 개수로 보여준다 */
      })
    return () => {
      cancelled = true
    }
  }, [open, api.threads.length])
  const localNonLive = api.threads.filter((t) => !t.live).length
  const totalCount = olderEnabled && serverTotal != null ? Math.max(api.threads.length, localNonLive + serverTotal) : api.threads.length
  const remainingOlder = Math.max(0, totalCount - api.threads.length - older.items.length)
  const olderDone = older.exhausted || (serverTotal != null && remainingOlder === 0)
  const loadOlder = async () => {
    const cur = olderRef.current
    if (cur.loading || cur.exhausted) return
    setOlder((prev) => ({ ...prev, loading: true, error: null }))
    const known = new Set([...api.threads.map((t) => t.id), ...cur.items.map((t) => t.id)])
    const added = []
    let cursor = cur.cursor
    let exhausted = false
    try {
      // 앞 페이지는 기록과 겹치므로 새 쓰레드가 30개 모일 때까지(최대 5페이지) 이어 받는다
      for (let page = 0; page < 5 && added.length < OLDER_PAGE; page += 1) {
        const res = await listLiveThreads({ cursor: cursor || undefined, limit: OLDER_PAGE })
        for (const row of res.items || []) {
          if (!row || known.has(row.id)) continue
          known.add(row.id)
          added.push(olderCard(row))
        }
        cursor = res.nextCursor || null
        if (!cursor) {
          exhausted = true
          break
        }
      }
      setOlder((prev) => ({ items: [...prev.items, ...added], cursor, exhausted, loading: false, error: null }))
    } catch (e) {
      setOlder((prev) => ({ ...prev, loading: false, error: e.message || '지난 쓰레드를 불러오지 못했어요.' }))
    }
  }
  useEffect(() => {
    if (!olderEnabled || olderDone || older.loading) return undefined
    const root = bodyRef.current
    const target = sentinelRef.current
    if (!root || !target || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadOlder()
      },
      { root, rootMargin: '120px 0px' },
    )
    io.observe(target)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [olderEnabled, olderDone, older.loading, older.items.length, api.threads.length])

  /* ── 옛 이름-만 기록의 썸네일 보정 ──
     시나리오 쓰레드는 그 시나리오의 상품 카드에서(즉시), 라이브 쓰레드는 서버 계획 페이지에서(한 번 받아 캐시) 재료를 찾아
     빈 필드를 채운다. 채워진 결과는 기록에도 저장해(갱신 시각은 안 건드림) 다음부터는 보정 없이 바로 그려진다 */
  const [, bump] = useState(0)
  const scenarioLookups = useMemo(() => new Map(), [api.scenarios])
  const lookupFor = (t) => {
    if (t.live) return liveLookupCache.get(t.id) || null
    const key = `${t.scenarioId}|${t.planCaseId || ''}`
    if (!scenarioLookups.has(key)) {
      const scenario = api.scenarios.find((s) => s.id === t.scenarioId)
      scenarioLookups.set(key, scenario ? scenarioLookup(scenario, t.planCaseId) : null)
    }
    return scenarioLookups.get(key)
  }
  const enrichedCartOf = (t) => {
    if (!cartNeedsEnrich(t.cart)) return t.cart
    const lookup = lookupFor(t)
    return lookup ? enrichCartEntries(t.cart, lookup) : t.cart
  }
  const liveNeedKey = open
    ? api.threads.filter((t) => t.live && cartNeedsEnrich(t.cart) && !liveLookupCache.has(t.id)).map((t) => t.id).join(',')
    : ''
  useEffect(() => {
    if (!liveNeedKey) return undefined
    let alive = true
    for (const id of liveNeedKey.split(',')) {
      liveLookupCache.set(id, null)
      fetchLiveThread(id)
        .then((page) => { liveLookupCache.set(id, productLookupFromPlanPage(page && page.plan)) })
        .catch(() => { liveLookupCache.set(id, new Map()) })
        .finally(() => { if (alive) bump((n) => n + 1) })
    }
    return () => { alive = false }
  }, [liveNeedKey])
  const persistedRef = useRef(new Set())
  useEffect(() => {
    if (!open) return
    for (const t of api.threads) {
      if (!cartNeedsEnrich(t.cart) || persistedRef.current.has(t.id)) continue
      const next = enrichedCartOf(t)
      if (next !== t.cart) {
        persistedRef.current.add(t.id)
        api.updateThread(t.id, { cart: next }, { touch: false })
      }
    }
  })
  if (!open) return null

  const fbCount = api.threads.filter((t) => t.feedback).length
  /* 평가 쓰레드가 하나도 없어지면(삭제 등) 필터를 무시하고 전체를 보여준다 — 빈 화면 잠금 방지 */
  const threads = fbOnly && fbCount > 0 ? api.threads.filter((t) => t.feedback) : api.threads
  const sheetThread = sheet && sheet.id ? api.threads.find((t) => t.id === sheet.id) || older.items.find((t) => t.id === sheet.id) || null : null

  /* 쓰레드 이동: 새 쓰레드를 만들지 않고 기존 쓰레드를 이어서, 마지막 단계의 맨 위에서 연다.
     라이브 쓰레드는 서버(BFF) 기록에서 생성된 설문·답변·계획을 복원한다 */
  const resume = (t) => {
    if (t.live) {
      onClose()
      api.resumeLive(t.id)
    } else if (api.scenarios.some((s) => s.id === t.scenarioId)) {
      onClose()
      api.playScenario(t.scenarioId, { threadId: t.id, stage: t.stage })
    } else {
      api.showToast('이 쓰레드의 시나리오를 찾을 수 없어요. (삭제되었거나 공유 체험이에요)')
    }
  }

  /* 링크 복사 — 라이브 쓰레드만 서버 id를 갖는다(#thread/<id>가 곧 이어보기 주소).
     시나리오 체험 쓰레드는 기기 안 기록이라 공유할 주소가 없다 */
  const copyLink = async (t) => {
    const url = `${location.origin}${location.pathname}${location.search}#thread/${t.id}`
    try {
      await navigator.clipboard.writeText(url)
      api.showToast('쓰레드 링크를 복사했어요.')
    } catch {
      api.showToast('복사에 실패했어요.')
    }
  }

  const newThread = () => {
    onClose()
    api.goHome()
    api.showToast('홈 검색창 아래 칩을 눌러 새 쓰레드를 시작해보세요.')
  }

  /* 상세 시트의 ⊖ — 기록의 담은 상품에서 뺀다 (원 배열 인덱스로 지목). 마지막 항목이면 시트도 닫는다 */
  const removeFromCart = (t, index) => {
    const next = cartEntries(t.cart).filter((_, i) => i !== index)
    api.updateThread(t.id, { cart: next })
    if (next.length === 0) setSheet(null)
  }

  return (
    <>
      <div className="sb-drawer-backdrop" onClick={onClose} />
      <aside
        className={`sb-thread-panel sb-thread-panel--${origin}`}
        role="dialog"
        aria-modal="true"
        aria-label="쇼핑 쓰레드"
      >
        <div className="sb-thread">
          <div className="sb-thread__head">
            <h2 className="sb-thread__title">
              쇼핑 쓰레드
              {totalCount > 0 && <span className="sb-thread__count">{totalCount}</span>}
            </h2>
            <div className="sb-thread__actions">
              <button type="button" className="sb-thread__icon-btn" aria-label="새 쇼핑 쓰레드 만들기" title="새 쓰레드" onClick={newThread}>
                <PlusIcon />
              </button>
              <button type="button" className="sb-thread__icon-btn" aria-label="쓰레드 패널 닫기" title="닫기" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="sb-thread__body" ref={bodyRef}>
            {api.threads.length === 0 ? (
              <div className="sb-thread-empty">
                <p className="sb-thread-empty__title">아직 쇼핑 쓰레드가 없어요</p>
                <p className="sb-thread-empty__hint">홈에서 칩을 눌러 시나리오를 체험하면 여기에 쓰레드가 쌓여요.</p>
                <button type="button" className="sb-thread-empty__btn" onClick={newThread}>쇼핑 쓰레드 만들기</button>
              </div>
            ) : (
              <>
                <div className="sb-thread__meta">
                  <span>
                    {fbOnly
                      ? `평가한 쓰레드 ${threads.length}개`
                      : totalCount > api.threads.length
                        ? `전체 ${totalCount}개 · 최근 ${api.threads.length}개`
                        : `최근 쓰레드 ${api.threads.length}개`}
                  </span>
                  <div className="sb-thread__meta-actions">
                    {fbCount > 0 && (
                      <button
                        type="button"
                        className={'sb-thread-fb-filter' + (fbOnly ? ' is-on' : '')}
                        title="라이브 체험에서 피드백을 저장한 쓰레드만 모아봐요"
                        onClick={() => setFbOnly((v) => !v)}
                      >
                        💬 평가한 쓰레드
                      </button>
                    )}
                    <button type="button" className="sb-thread__clear" onClick={() => setSheet({ kind: 'confirmClear' })}>
                      전체 지우기
                    </button>
                  </div>
                </div>

                <div className="sb-thread__list">
                  {threads.map((t) => {
                    const entries = cartEntries(enrichedCartOf(t))
                    const cta = ctaFor(t)
                    return (
                      <article key={t.id} className="sb-thread-card">
                        <div className="sb-thread-card__head">
                          <h3 className="sb-thread-card__title">{t.title}</h3>
                          <button
                            type="button"
                            className="sb-thread-card__more"
                            aria-label="쓰레드 관리"
                            aria-haspopup="dialog"
                            onClick={() => setSheet({ kind: 'more', id: t.id })}
                          >
                            <MoreIcon />
                          </button>
                        </div>
                        <div className="sb-thread-card__tags">
                          {t.live ? (
                            <span className="sb-thread-tag sb-thread-tag--ai">✦ AI 실시간 생성</span>
                          ) : (
                            <span className="sb-thread-tag">#{t.chip}</span>
                          )}
                          <span className="sb-thread-tag">{phaseLabel(t)}</span>
                          {t.feedback && (
                            <span className="sb-thread-tag sb-thread-tag--fb" title={`남긴 평가 — ${feedbackLabel(t.feedback)}`}>
                              💬 {feedbackLabel(t.feedback)}
                            </span>
                          )}
                          <span className="sb-thread-card__time">{timeAgo(t.updatedAt || t.startedAt)}</span>
                        </div>
                        {/* 담은 상품 요약 — Figma 는 썸네일 겹침 + "+n". 상품 카드 재료(이미지·이모지)로 그리고, 누르면 상세 시트 */}
                        {entries.length === 0 ? (
                          <div className="sb-thread-card__cart">
                            <span className="sb-thread-card__empty">아직 담은 상품이 없어요</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="sb-thread-card__cart sb-thread-card__cart--btn"
                            aria-haspopup="dialog"
                            title="담은 상품 자세히 보기"
                            onClick={() => setSheet({ kind: 'cart', id: t.id })}
                          >
                            <span className="sb-thread-card__thumbs" aria-hidden="true">
                              {entries.slice(0, 3).map((entry, i) => (
                                <CartThumb key={i} entry={entry} className="sb-thread-card__thumb" />
                              ))}
                            </span>
                            {entries.length > 3 && <span className="sb-thread-card__more-count">+{entries.length - 3}</span>}
                            <span className="sb-thread-card__cart-label">담은 상품 {entries.length}개 ›</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={'sb-thread-card__cta' + (cta.primary ? ' is-primary' : '')}
                          onClick={() => resume(t)}
                        >
                          {cta.label}
                        </button>
                      </article>
                    )
                  })}
                  {/* 지난 쓰레드 — 기록 상한 뒤의 라이브 쓰레드를 서버 목록에서 이어 받는다 (기기 단위, 점선 카드) */}
                  {olderEnabled && older.items.length > 0 && (
                    <p className="sb-thread__older-head">
                      지난 라이브 쓰레드 · 이 기기 기록 {older.items.length}개{serverTotal != null ? ` · 남은 ${remainingOlder}개` : ''}
                    </p>
                  )}
                  {olderEnabled &&
                    older.items.map((t) => {
                      const cta = ctaFor(t)
                      return (
                        <article key={t.id} className="sb-thread-card sb-thread-card--server">
                          <div className="sb-thread-card__head">
                            <h3 className="sb-thread-card__title">{t.title}</h3>
                            <button
                              type="button"
                              className="sb-thread-card__more"
                              aria-label="쓰레드 관리"
                              aria-haspopup="dialog"
                              onClick={() => setSheet({ kind: 'more', id: t.id })}
                            >
                              <MoreIcon />
                            </button>
                          </div>
                          <div className="sb-thread-card__tags">
                            <span className="sb-thread-tag sb-thread-tag--ai">✦ AI 실시간 생성</span>
                            <span className="sb-thread-tag">{phaseLabel(t)}</span>
                            <span className="sb-thread-card__time">{timeAgo(t.updatedAt || t.startedAt)}</span>
                          </div>
                          <div className="sb-thread-card__cart">
                            <span className="sb-thread-card__empty">서버 기록 — 담은 상품은 이어보기 뒤에 보여요</span>
                          </div>
                          <button
                            type="button"
                            className={'sb-thread-card__cta' + (cta.primary ? ' is-primary' : '')}
                            onClick={() => resume(t)}
                          >
                            {cta.label}
                          </button>
                        </article>
                      )
                    })}
                  {olderEnabled && (
                    <div className="sb-thread__more" ref={sentinelRef} aria-live="polite">
                      {older.loading ? (
                        <span className="sb-thread__more-text">지난 쓰레드를 불러오고 있어요…</span>
                      ) : older.error ? (
                        <button type="button" className="sb-thread__more-btn" onClick={loadOlder}>
                          다시 시도 — {older.error}
                        </button>
                      ) : olderDone ? (
                        older.items.length > 0 ? <span className="sb-thread__more-text">지난 쓰레드를 모두 불러왔어요</span> : null
                      ) : (
                        <button type="button" className="sb-thread__more-btn" onClick={loadOlder}>
                          지난 쓰레드 더 보기{serverTotal != null ? ` (${remainingOlder}개 남음)` : ''}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ⋯ 관리 시트 — Figma: 「삭제하기」(라이브 쓰레드는 링크 복사도) */}
      {sheet && sheet.kind === 'more' && sheetThread && (
        <BottomSheet title="쇼핑 쓰레드" onClose={() => setSheet(null)}>
          <div className="sb-sheet__menu">
            {sheetThread.live && (
              <button type="button" onClick={() => { copyLink(sheetThread); setSheet(null) }}>
                <LinkIcon /> 링크 복사
              </button>
            )}
            {/* 서버 목록에서 이어 받은 지난 쓰레드는 기기 기록이 없어 지울 대상이 없다 — 링크 복사만 */}
            {!sheetThread.server && (
              <button type="button" className="is-danger" onClick={() => setSheet({ kind: 'confirmDelete', id: sheetThread.id })}>
                <TrashIcon /> 삭제하기
              </button>
            )}
          </div>
        </BottomSheet>
      )}
      {sheet && sheet.kind === 'cart' && sheetThread && (
        <CartSheet
          thread={{ ...sheetThread, cart: enrichedCartOf(sheetThread) }}
          steps={(lookupFor(sheetThread) && lookupFor(sheetThread).steps) || []}
          onClose={() => setSheet(null)}
          onRemove={(index) => removeFromCart(sheetThread, index)}
          onOpenPlan={() => { setSheet(null); resume(sheetThread) }}
        />
      )}
      {sheet && sheet.kind === 'confirmDelete' && sheetThread && (
        <ConfirmSheet
          title="정말로 삭제하시겠습니까?"
          message={'삭제된 데이터는 복구할 수 없습니다.\n다시 한 번 확인해 주세요.'}
          confirmLabel="삭제할게요"
          onConfirm={() => { api.removeThread(sheetThread.id); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet && sheet.kind === 'confirmClear' && (
        <ConfirmSheet
          title="쓰레드를 모두 지울까요?"
          message={'삭제된 데이터는 복구할 수 없습니다.\n다시 한 번 확인해 주세요.'}
          confirmLabel="모두 지울게요"
          onConfirm={() => { api.clearThreads(); setSheet(null) }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  )
}
