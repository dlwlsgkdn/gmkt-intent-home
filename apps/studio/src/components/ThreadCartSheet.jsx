import React, { useState } from 'react'
import BottomSheet from './ui/BottomSheet.jsx'
import { cartEntries, cartTotal, formatWon, groupCartByStep, parsePrice, plainStepTitle } from '../lib/cart.js'

/*
 * 담은 상품 상세 시트 — Figma "내 프로필 · 쇼핑쓰레드 바텀시트" ThreadMoreSheet (2026-09-06 대조):
 * 제목 + ✕ · 요약 행(파트 · 개수 | 합계) · 파트 카드(단계 제목 + 배지, 상품 행: 60px 썸네일 · [브랜드] 상품명 · 가격 · 몰 · 빼기 ⊖,
 * 담은 상품이 없는 단계는 빈 파트 행) · 푸터 「뷰티 맞춤 계획 보기」.
 * 쓰는 곳 — 쇼핑 쓰레드 패널의 카드(담은 상품 요약 클릭, ThreadPanel)와 설문·계획 체험 화면의 플로팅 버튼(지금 진행 중인 쓰레드 —
 * Player·LivePlayer, 2026-09). 후자는 담기 상태가 화면 로컬이라 onRemove 가 그 상태를 고치고, 계획이 아직 없으면 ctaLabel 로
 * 「설문 이어서 답하기」를 단다. onOpenList 를 주면 푸터 밑에 「다른 쇼핑 쓰레드 보기」 링크가 선다(체험 화면에서 목록으로 가는 길).
 * onOpenStep(part) 을 주면 **파트가 곧 계획의 그 단계로 가는 링크**다(2026-09) — 파트 머리(담은 상품이 있는 파트)와 빈 파트 행
 * (추천 상품 없음까지) 어느 것을 눌러도 시트가 닫히고 체험 화면이 그 단계(part.id = 단계 아이템 id)로 앵커 스크롤한다.
 * 안 주면(홈 쓰레드 패널) 빈 파트 행만 onOpenPlan(이어보기)으로 가고 추천 상품 없음 행은 누를 곳이 없다.
 * 스타일은 styles/home.css `.sb-cart-*`.
 */
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
)
const MinusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 12h12" />
  </svg>
)

/* 담은 상품 썸네일 — 상품 카드와 같은 재료(lib/cart.js 항목): 이미지가 있으면 잘라(cover) 채우고, 목업 이모지면
   그 배경·이모지를, 둘 다 없으면(옛 이름-만 기록) 첫 글자를 보여준다. 쓰레드 패널 카드의 겹침 썸네일도 이걸 쓴다 */
export function CartThumb({ entry, className }) {
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

/* 담을 수 없는 이유 문구 — 카드가 「담기」를 주지 않는 상품(품절 = 버튼 비활성)만 있는 단계. 외부몰 상품은 2026-09-14부터 담긴다 */
function blockedText(part) {
  const n = part.products ?? 0
  return n > 0 && part.soldOut === n ? `품절 상품 ${n}개 · 담을 수 없어요` : '담을 수 있는 상품이 없어요'
}

/* 빈 파트 행 한 벌 — 네 상태 (2026-09): 담을 것이 있음(플러스 자리·「상품을 추가해 보세요」·쉐브론, 누르면 계획으로 = Figma
   EmptyPartRow) · 찾는 중(라이브 조기 확정 뒤 그 단계의 자리에 검색 결과 대기 — ✦ 맥동, 누르면 계획으로) · 추천 상품 없음(상품이
   하나도 안 실린 단계 — 플러스 없이 자리만) · 담을 수 없음(추천은 있지만 전부 품절이라 카드에 「담기」가 없는 단계 —
   「품절 상품 n개 · 담을 수 없어요」, 플러스 없이 자리만). 담을 수 없는 단계까지 플러스 행으로 그리면 고를 상품이 있는 것처럼 보인다.
   linked(파트가 계획 단계 링크)면 뒤의 두 상태도 쉐브론을 달고 누르면 그 단계로 간다 — 안내·상세보기는 계획 화면에 있으니.
   아니면 예전처럼 누를 곳이 없다 */
function EmptyPartRow({ group, mode, onOpen, linked }) {
  const head = (
    <span className="sb-cart-part__head sb-cart-part__head--empty">
      <span className="sb-cart-part__title">{group.step || '담은 상품'}</span>
      {group.stepBadge ? <span className="sb-cart-part__badge">{group.stepBadge}</span> : null}
    </span>
  )
  const none = mode === 'none' || mode === 'blocked' // 담을 것이 없는 두 상태 — 플러스 없이 자리만
  const pending = mode === 'pending'
  const placeholder = pending ? '상품을 찾고 있어요…' : mode === 'none' ? '이 단계엔 추천 상품이 없어요' : mode === 'blocked' ? blockedText(group) : '상품을 추가해 보세요'
  if (none && !linked) {
    return (
      <div className="sb-cart-part__empty is-none">
        <span className="sb-cart-part__empty-thumb" aria-hidden="true" />
        <span className="sb-cart-part__empty-info">
          {head}
          <span className="sb-cart-part__placeholder">{placeholder}</span>
        </span>
      </div>
    )
  }
  return (
    <button
      type="button"
      className={'sb-cart-part__empty' + (pending ? ' is-pending' : '') + (none ? ' is-none is-link' : '')}
      onClick={onOpen}
      title={linked ? '계획에서 이 단계 보기' : pending ? '계획에서 진행 상황 보기' : '계획에서 이 단계의 상품을 담기'}
    >
      <span className="sb-cart-part__empty-thumb" aria-hidden="true">{pending ? '✦' : none ? null : <PlusIcon />}</span>
      <span className="sb-cart-part__empty-info">
        {head}
        <span className="sb-cart-part__placeholder">{placeholder}</span>
      </span>
      <span className="sb-cart-part__chevron" aria-hidden="true"><ChevronIcon /></span>
    </button>
  )
}

export default function ThreadCartSheet({
  thread,
  steps = [],
  pending = false, // 라이브 계획을 아직 만드는 중(단계 목록 전) 또는 자리가 아직 안 찼음 — 「추천 상품 없음」으로 단정하지 않는다
  onClose,
  onRemove,
  onOpenPlan,
  ctaLabel = '뷰티 맞춤 계획 보기',
  onOpenList,
  onOpenStep, // (part) => void — 파트 클릭 = 계획의 그 단계로 (체험 화면). 없으면 파트는 링크가 아니다
}) {
  const entries = cartEntries(thread.cart)
  const groups = groupCartByStep(thread.cart)
  const total = cartTotal(thread.cart)
  /* 파트 순서는 계획의 단계 목록을 따른다 — 담은 상품이 없는 단계도 빈 파트 행으로 보여 "어느 단계가 비었는지"가
     한눈에 들어온다 (Figma ThreadPartCardMargin/EmptyPartRow). 단계 목록을 모르는 옛 기록은 담은 순서 그대로 */
  /* 묶음 키·표시는 마크업을 걷어낸 제목으로 — 저자가 단계 제목에 [[키워드]] 밑줄을 넣어도 시트에는 원문 기호가 보이지 않는다 */
  const byStep = new Map(groups.map((group) => [plainStepTitle(group.step), group]))
  /* 같은 제목의 단계는 한 파트로 합친다(상품 수 합산) — 키가 겹치면 파트가 두 번 서고 React 키도 충돌한다 */
  const ordered = []
  const seen = new Map()
  for (const s of steps) {
    const key = plainStepTitle(s.title)
    if (!key) continue
    const known = typeof s.products === 'number'
    // 담을 수 있는 상품 수 — 옛 재료(addable 없음)는 실린 상품 전부를 담을 수 있다고 본다
    const addable = known ? (typeof s.addable === 'number' ? s.addable : s.products) : null
    if (seen.has(key)) {
      const part = seen.get(key)
      if (known) {
        part.products = (part.products ?? 0) + s.products
        part.addable = (part.addable ?? 0) + addable
        part.soldOut = (part.soldOut ?? 0) + (s.soldOut || 0)
      }
      part.pending = part.pending || !!s.pending
      continue
    }
    const part = {
      id: s.id || null, // 단계 아이템 id — onOpenStep 앵커 (옛 재료·담은 순서만 아는 묶음은 없다)
      step: key,
      stepBadge: byStep.get(key)?.stepBadge || s.badge || '',
      entries: byStep.get(key)?.entries || [],
      products: known ? s.products : null, // null = 상품 수를 모르는 옛 재료 → 담을 수 있다고 본다
      addable,
      soldOut: s.soldOut || 0,
      pending: !!s.pending,
    }
    seen.set(key, part)
    ordered.push(part)
  }
  const leftovers = groups
    .filter((group) => !seen.has(plainStepTitle(group.step)))
    .map((group) => ({ ...group, step: plainStepTitle(group.step), products: null, addable: null, soldOut: 0, pending: false }))
  const parts = [...ordered, ...leftovers]
  /* 빈 파트의 상태 — 찾는 중이면 pending, 실린 상품이 0개로 확인되면 none, 실렸지만 담을 수 있는 게 0개(전부 품절)면
     blocked, 그 밖은 담을 수 있는 pick */
  const emptyMode = (part) =>
    part.pending ? 'pending' : part.products === 0 ? 'none' : part.products != null && part.addable === 0 ? 'blocked' : 'pick'
  /* 파트 → 계획 단계 링크 (onOpenStep 이 있고 단계 아이템 id 를 아는 파트만). 없으면 빈 파트 행은 예전처럼 계획으로(onOpenPlan) */
  const linked = typeof onOpenStep === 'function'
  const openPart = (part) => (linked && part.id ? () => onOpenStep(part) : onOpenPlan)
  const filled = parts.filter((part) => part.entries.length > 0).length
  /* 담을 수 있는 파트 — 추천 상품이 없거나 전부 담을 수 없다고 확인된 단계는 "k/n 파트"의 분모에서 뺀다 */
  const fillable = parts.filter((part) => part.entries.length > 0 || !['none', 'blocked'].includes(emptyMode(part))).length
  /* 계획은 있는데 어느 단계에도 담을 수 있는 상품이 없고 담은 것도 없다 — 파트 목록 대신 정직한 빈 상태.
     추천 자체가 없는 계획(검증 게이트 드롭 등)과, 추천은 있지만 전부 품절이라 카드에 「담기」가 없는 계획을 가른다 */
  const nothingToPick = steps.length > 0 && !pending && entries.length === 0 && fillable === 0
  const recommended = parts.reduce((sum, part) => sum + (part.products ?? 0), 0)
  const blockedPlan = nothingToPick && recommended > 0
  const summary = nothingToPick
    ? blockedPlan ? '담을 수 있는 상품 없음' : '추천 상품 없음'
    : steps.length
      ? `${filled}/${fillable} 파트 · ${entries.length}개 담음`
      : `${filled ? `${filled}파트 · ` : ''}${entries.length}개 담음`
  return (
    <BottomSheet
      title={thread.title}
      align="start"
      closable
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sb-cart-sheet__cta" onClick={onOpenPlan}>{ctaLabel}</button>
          {onOpenList ? (
            <button type="button" className="sb-cart-sheet__link" onClick={onOpenList}>다른 쇼핑 쓰레드 보기 ›</button>
          ) : null}
        </>
      }
    >
      <div className="sb-cart-sheet__summary">
        <span>{summary}</span>
        {total != null && <strong className="sb-cart-sheet__total">{formatWon(total)}</strong>}
      </div>
      {parts.length === 0 ? (
        pending ? (
          /* 계획을 만드는 중 — 단계 목록이 아직 없다 */
          <div className="sb-cart-sheet__empty">
            <p className="sb-cart-sheet__empty-title">맞춤 계획을 만들고 있어요</p>
            <p className="sb-cart-sheet__empty-hint">계획이 완성되면 단계별 추천 상품을 여기서 담을 수 있어요.</p>
          </div>
        ) : (
          /* 계획 단계도 담은 상품도 아직 없다 (설문 중인 체험) */
          <div className="sb-cart-sheet__empty">
            <p className="sb-cart-sheet__empty-title">아직 담은 상품이 없어요</p>
            <p className="sb-cart-sheet__empty-hint">맞춤 계획에서 상품을 담으면 단계별로 여기에 모여요.</p>
          </div>
        )
      ) : blockedPlan ? (
        /* 추천은 있지만 전부 담을 수 없는 상품(품절 — 시나리오 목업) — "상품을 추가해 보세요"라고 하지 않는다 */
        <div className="sb-cart-sheet__empty">
          <p className="sb-cart-sheet__empty-title">담을 수 있는 상품이 없어요</p>
          <p className="sb-cart-sheet__empty-hint">{`추천 상품 ${recommended}개가 모두 품절이라 담을 수 없어요. 계획 화면에서 확인할 수 있어요.`}</p>
        </div>
      ) : nothingToPick ? (
        /* 추천 상품이 전부 빠진 계획(검증 게이트 드롭 등) — 고를 상품이 있는 것처럼 빈 파트 행을 늘어놓지 않는다 */
        <div className="sb-cart-sheet__empty">
          <p className="sb-cart-sheet__empty-title">이 계획에는 담을 상품이 없어요</p>
          <p className="sb-cart-sheet__empty-hint">추천 상품이 하나도 실리지 않은 계획이에요. 단계 안내는 계획 화면에서 볼 수 있어요.</p>
        </div>
      ) : (
      <div className="sb-cart-sheet__parts">
        {parts.map((group) => (
          <section key={group.step || '__rest'} className="sb-cart-part">
            {group.entries.length === 0 ? (
              <EmptyPartRow group={group} mode={emptyMode(group)} onOpen={openPart(group)} linked={linked && !!group.id} />
            ) : (
              <>
                {linked && group.id ? (
                  /* 파트 머리 = 계획의 그 단계로 가는 버튼 (button 안이라 제목은 h4 대신 span) */
                  <button type="button" className="sb-cart-part__head sb-cart-part__head--link" onClick={openPart(group)} title="계획에서 이 단계 보기">
                    <span className="sb-cart-part__title">{group.step || '담은 상품'}</span>
                    {group.stepBadge ? <span className="sb-cart-part__badge">{group.stepBadge}</span> : null}
                    <span className="sb-cart-part__chevron" aria-hidden="true"><ChevronIcon /></span>
                  </button>
                ) : (
                  <div className="sb-cart-part__head">
                    <h4 className="sb-cart-part__title">{group.step || '담은 상품'}</h4>
                    {group.stepBadge ? <span className="sb-cart-part__badge">{group.stepBadge}</span> : null}
                  </div>
                )}
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
      )}
    </BottomSheet>
  )
}
