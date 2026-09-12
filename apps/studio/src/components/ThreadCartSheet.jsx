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

export default function ThreadCartSheet({
  thread,
  steps = [],
  onClose,
  onRemove,
  onOpenPlan,
  ctaLabel = '뷰티 맞춤 계획 보기',
  onOpenList,
}) {
  const entries = cartEntries(thread.cart)
  const groups = groupCartByStep(thread.cart)
  const total = cartTotal(thread.cart)
  /* 파트 순서는 계획의 단계 목록을 따른다 — 담은 상품이 없는 단계도 빈 파트 행으로 보여 "어느 단계가 비었는지"가
     한눈에 들어온다 (Figma ThreadPartCardMargin/EmptyPartRow). 단계 목록을 모르는 옛 기록은 담은 순서 그대로 */
  /* 묶음 키·표시는 마크업을 걷어낸 제목으로 — 저자가 단계 제목에 [[키워드]] 밑줄을 넣어도 시트에는 원문 기호가 보이지 않는다 */
  const byStep = new Map(groups.map((group) => [plainStepTitle(group.step), group]))
  const ordered = steps.map((s) => {
    const key = plainStepTitle(s.title)
    return {
      step: key,
      stepBadge: byStep.get(key)?.stepBadge || s.badge || '',
      entries: byStep.get(key)?.entries || [],
    }
  })
  const leftovers = groups
    .filter((group) => !steps.some((s) => plainStepTitle(s.title) === plainStepTitle(group.step)))
    .map((group) => ({ ...group, step: plainStepTitle(group.step) }))
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
        /* 계획 단계도 담은 상품도 아직 없다 (설문 중인 체험) */
        <div className="sb-cart-sheet__empty">
          <p className="sb-cart-sheet__empty-title">아직 담은 상품이 없어요</p>
          <p className="sb-cart-sheet__empty-hint">맞춤 계획에서 상품을 담으면 단계별로 여기에 모여요.</p>
        </div>
      ) : (
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
      )}
    </BottomSheet>
  )
}
