import React, { useEffect, useState } from 'react'
import { timeAgo } from '../lib/timeAgo.js'

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
const BagIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8h12l1 12H5L6 8z" />
    <path d="M9 10V7a3 3 0 0 1 6 0v3" />
  </svg>
)

/* 쇼핑 쓰레드 히스토리 패널 — Figma [PP1K] Shopping Threads(내 프로필 · 쇼핑쓰레드 탭) 룩 (2026-09):
   머리(제목 + 개수 · 새 쓰레드 · 닫기) 아래 bg/subtle 바닥에 카드가 12px 간격으로 쌓인다. 카드 = 제목 + ⋯ · 태그 칩
   (칩/AI 배지 · 단계 · 평가) · 담은 상품 동그라미 겹침 + "+n" · CTA(이어서 답하기 / 계획 보기). ⋯ 를 누르면 담은 상품
   목록과 관리(링크 복사 · 삭제)가 펼쳐진다. 여는 버튼 위치(origin)에 맞는 방향(좌/우/중앙)에서 등장한다. */
export default function ThreadPanel({ api, open, origin = 'right', onClose }) {
  /* ⋯ 로 펼친 카드 — Figma 카드는 접힌 모습이 기본이라 열 때마다 전부 접는다 */
  const [expandedId, setExpandedId] = useState(null)
  /* 평가한 쓰레드만 모아보기 — 라이브 체험에서 피드백을 저장한 쓰레드(t.feedback) 필터 */
  const [fbOnly, setFbOnly] = useState(false)
  useEffect(() => {
    if (open) setExpandedId(null)
  }, [open])
  if (!open) return null

  const fbCount = api.threads.filter((t) => t.feedback).length
  /* 평가 쓰레드가 하나도 없어지면(삭제 등) 필터를 무시하고 전체를 보여준다 — 빈 화면 잠금 방지 */
  const threads = fbOnly && fbCount > 0 ? api.threads.filter((t) => t.feedback) : api.threads

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
                    <button
                      type="button"
                      className="sb-thread__clear"
                      onClick={() => {
                        if (window.confirm('쓰레드 히스토리를 모두 지울까요?')) api.clearThreads()
                      }}
                    >
                      전체 지우기
                    </button>
                  </div>
                </div>

                <div className="sb-thread__list">
                  {threads.map((t) => {
                    const isExpanded = expandedId === t.id
                    const cart = t.cart || []
                    const cta = ctaFor(t)
                    return (
                      <article key={t.id} className={'sb-thread-card' + (isExpanded ? ' is-expanded' : '')}>
                        <div className="sb-thread-card__head">
                          <h3 className="sb-thread-card__title">{t.title}</h3>
                          <button
                            type="button"
                            className="sb-thread-card__more"
                            aria-label={isExpanded ? '접기' : '담은 상품과 관리 메뉴 펼치기'}
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedId((v) => (v === t.id ? null : t.id))}
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
                        {/* 담은 상품 — Figma 는 48px 썸네일 겹침 + "+n". 체험 기록엔 상품 이름만 남으므로 첫 글자 동그라미로 그린다 */}
                        <div className="sb-thread-card__cart">
                          {cart.length === 0 ? (
                            <span className="sb-thread-card__empty">아직 담은 상품이 없어요</span>
                          ) : (
                            <>
                              <div className="sb-thread-card__thumbs" aria-hidden="true">
                                {cart.slice(0, 3).map((name, i) => (
                                  <span key={i} className="sb-thread-card__thumb" title={name}>{String(name).trim().charAt(0)}</span>
                                ))}
                              </div>
                              {cart.length > 3 && <span className="sb-thread-card__more-count">+{cart.length - 3}</span>}
                              <span className="sb-thread-card__cart-label">담은 상품 {cart.length}개</span>
                            </>
                          )}
                        </div>
                        {isExpanded && (
                          <div className="sb-thread-card__detail">
                            {cart.map((name, i) => (
                              <div key={i} className="sb-thread-item">
                                <span className="sb-thread-item__thumb" aria-hidden="true"><BagIcon /></span>
                                <span className="sb-thread-item__name">{name}</span>
                              </div>
                            ))}
                            <div className="sb-thread-card__manage">
                              {t.live && (
                                <button type="button" className="sb-thread-card__link" onClick={() => copyLink(t)}>링크 복사</button>
                              )}
                              <button
                                type="button"
                                className="sb-thread-card__link sb-thread-card__link--danger"
                                onClick={() => api.removeThread(t.id)}
                              >
                                삭제
                              </button>
                            </div>
                          </div>
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
    </>
  )
}
