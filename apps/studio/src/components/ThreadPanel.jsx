import React, { useEffect, useState } from 'react'
import { timeAgo } from '../lib/timeAgo.js'
import BottomSheet from './ui/BottomSheet.jsx'
import { cartEntries, cartTotal, formatWon, groupCartByStep, parsePrice } from '../lib/cart.js'

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
function CartSheet({ thread, onClose, onRemove, onOpenPlan }) {
  const entries = cartEntries(thread.cart)
  const groups = groupCartByStep(thread.cart)
  const total = cartTotal(thread.cart)
  const parts = groups.filter((group) => group.step).length
  const summary = `${parts ? `${parts}파트 · ` : ''}${entries.length}개 담음`
  return (
    <BottomSheet
      title={thread.title}
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
        {groups.map((group) => (
          <section key={group.step || '__rest'} className="sb-cart-part">
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
export default function ThreadPanel({ api, open, origin = 'right', onClose }) {
  /* 평가한 쓰레드만 모아보기 — 라이브 체험에서 피드백을 저장한 쓰레드(t.feedback) 필터 */
  const [fbOnly, setFbOnly] = useState(false)
  /* 열린 시트 — null | { kind: 'more' | 'cart' | 'confirmDelete', id } | { kind: 'confirmClear' } */
  const [sheet, setSheet] = useState(null)
  useEffect(() => {
    if (!open) setSheet(null)
  }, [open])
  if (!open) return null

  const fbCount = api.threads.filter((t) => t.feedback).length
  /* 평가 쓰레드가 하나도 없어지면(삭제 등) 필터를 무시하고 전체를 보여준다 — 빈 화면 잠금 방지 */
  const threads = fbOnly && fbCount > 0 ? api.threads.filter((t) => t.feedback) : api.threads
  const sheetThread = sheet && sheet.id ? api.threads.find((t) => t.id === sheet.id) || null : null

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
              {api.threads.length > 0 && <span className="sb-thread__count">{api.threads.length}</span>}
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

          <div className="sb-thread__body">
            {api.threads.length === 0 ? (
              <div className="sb-thread-empty">
                <p className="sb-thread-empty__title">아직 쇼핑 쓰레드가 없어요</p>
                <p className="sb-thread-empty__hint">홈에서 칩을 눌러 시나리오를 체험하면 여기에 쓰레드가 쌓여요.</p>
                <button type="button" className="sb-thread-empty__btn" onClick={newThread}>쇼핑 쓰레드 만들기</button>
              </div>
            ) : (
              <>
                <div className="sb-thread__meta">
                  <span>{fbOnly ? `평가한 쓰레드 ${threads.length}개` : `최근 쓰레드 ${api.threads.length}개`}</span>
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
                    const entries = cartEntries(t.cart)
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
            <button type="button" className="is-danger" onClick={() => setSheet({ kind: 'confirmDelete', id: sheetThread.id })}>
              <TrashIcon /> 삭제하기
            </button>
          </div>
        </BottomSheet>
      )}
      {sheet && sheet.kind === 'cart' && sheetThread && (
        <CartSheet
          thread={sheetThread}
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
