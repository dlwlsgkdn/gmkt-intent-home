import React, { useEffect, useState } from 'react'

function timeAgo(iso) {
  const t = new Date(iso || '').getTime()
  if (!t) return ''
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '방금 전'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}일 전`
  return new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/* 원본(gmarket-advanced-clean-home)의 "마지막 페이즈" 라벨을 스튜디오 단계에 맞게 매핑 */
function phaseLabel(t) {
  if (t.status === 'completed') return '체험 완료'
  return t.stage === 'plan'
    ? `계획 확인 중${t.planCaseName ? ` · ${t.planCaseName}` : ''}`
    : '설문 작성 중'
}

/* 쇼핑 쓰레드 히스토리 패널 — 원본 clean-home의 history-sidebar 룩 재사용.
   여는 버튼 위치(origin)에 맞는 방향(좌/우/중앙)에서 등장한다. */
export default function ThreadPanel({ api, open, origin = 'right', onClose }) {
  /* 아코디언: 패널을 열 때마다 가장 최근 쓰레드를 펼친다 */
  const [expandedId, setExpandedId] = useState(null)
  useEffect(() => {
    if (open) setExpandedId(api.threads[0] ? api.threads[0].id : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  if (!open) return null

  /* 쓰레드 이동: 새 쓰레드를 만들지 않고 기존 쓰레드를 이어서, 마지막 단계의 맨 위에서 연다 */
  const resume = (t) => {
    if (api.scenarios.some((s) => s.id === t.scenarioId)) {
      onClose()
      api.playScenario(t.scenarioId, { threadId: t.id, stage: t.stage })
    } else {
      api.showToast('이 쓰레드의 시나리오를 찾을 수 없어요. (삭제되었거나 공유 체험이에요)')
    }
  }

  const newThread = () => {
    onClose()
    api.goHome()
    api.showToast('홈 검색창 아래 칩을 눌러 새 쓰레드를 시작해보세요.')
  }

  /* 닫기 화살표는 패널이 사라질 방향을 가리킨다 */
  const closeArrow = origin === 'left' ? 'M15 19l-7-7 7-7' : origin === 'center' ? 'M6 9l6 6 6-6' : 'M9 5l7 7-7 7'

  return (
    <>
      <div className="sb-drawer-backdrop" onClick={onClose} />
      <aside
        className={`sb-thread-panel sb-thread-panel--${origin}`}
        role="dialog"
        aria-modal="true"
        aria-label="쇼핑 쓰레드 히스토리"
      >
        <div id="history-panel" className="history-sidebar history-sidebar-open h-full">
          <div className="flex h-full flex-col">
            {/* 원본 사이드바 탭 헤더 */}
            <div className="sidebar-tabs flex items-center border-b border-slate-200/80">
              <div className="sidebar-cart-control flex flex-1 items-center gap-2 px-3 py-3">
                <div id="cartTabBtn" className="sidebar-tab sidebar-tab-active flex-1 py-3 text-sm font-medium flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                  <span className="sidebar-tab-label">쇼핑 쓰레드</span>
                  {api.threads.length > 0 && (
                    <span id="cartBadge" className="sidebar-tab-badge sidebar-tab-cart-badge bg-gmarket-blue text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 font-bold">
                      {api.threads.length}
                    </span>
                  )}
                </div>
                <button type="button" className="new-thread-btn" aria-label="새 쇼핑 쓰레드 만들기" title="새 쓰레드" onClick={newThread}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 5v14M5 12h14" /></svg>
                </button>
                <button type="button" id="collapseHistorySidebar" className="inline-flex shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-slate-500 transition-colors" aria-label="쓰레드 패널 닫기" title="닫기" onClick={onClose}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d={closeArrow} /></svg>
                </button>
              </div>
            </div>

            {/* 스크롤 콘텐츠 */}
            <div className="flex-1 overflow-y-auto px-3 py-4">
              {api.threads.length === 0 ? (
                <div className="history-empty rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm leading-relaxed text-slate-400 font-normal text-center">
                  아직 쇼핑 쓰레드가 없어요.<br />
                  <span className="text-xs mt-1 block">홈에서 <span className="text-gmarket-blue font-semibold">칩</span>을 눌러 시나리오를 체험하면<br />여기에 쓰레드가 쌓여요.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <span className="text-[11px] text-slate-400 font-normal">최근 쓰레드 {api.threads.length}개</span>
                    <button
                      type="button"
                      className="history-clear-btn text-[11px] text-slate-400 font-normal transition-colors hover:text-slate-600"
                      onClick={() => {
                        if (window.confirm('쓰레드 히스토리를 모두 지울까요?')) api.clearThreads()
                      }}
                    >
                      전체 지우기
                    </button>
                  </div>

                  {api.threads.map((t) => {
                    const isExpanded = expandedId === t.id
                    const cart = t.cart || []
                    return (
                      <div key={t.id} className={'purpose-cart-group border border-slate-200 bg-white ' + (isExpanded ? 'purpose-cart-group-expanded' : 'purpose-cart-group-collapsed')}>
                        <div
                          className="purpose-cart-header purpose-cart-accordion-header px-4 pt-4 pb-3 border-b border-slate-100/80"
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedId((v) => (v === t.id ? null : t.id))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setExpandedId((v) => (v === t.id ? null : t.id))
                            }
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-gmarket-blue uppercase tracking-[0.16em]">#{t.chip}</span>
                            <div className="flex items-center gap-2">
                              <span className="purpose-cart-count text-[10px] text-slate-400 font-bold">{timeAgo(t.updatedAt || t.startedAt)}</span>
                              <span className={'purpose-cart-chevron' + (isExpanded ? ' is-expanded' : '')} aria-hidden="true">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" d="M6 9l6 6 6-6" /></svg>
                              </span>
                            </div>
                          </div>
                          <p className="purpose-cart-summary-preview text-[11px] text-slate-500 font-normal mt-2 leading-relaxed">{t.title}</p>
                          <p className="text-[10px] text-slate-400 font-normal mt-2">마지막 페이즈: <span className="text-slate-700">{phaseLabel(t)}</span></p>
                        </div>

                        {isExpanded && (
                          <>
                            <div className="purpose-cart-items px-4 py-3 space-y-2">
                              {cart.length === 0 && (
                                <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-dashed border-slate-200 opacity-60">
                                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[11px] text-slate-300 font-bold">아직 담은 상품이 없어요</p>
                                  </div>
                                </div>
                              )}
                              {cart.map((name, i) => (
                                <div key={i} className="cart-item flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                  <div className="w-10 h-10 rounded-lg bg-white border border-slate-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">담은 상품</p>
                                    <p className="text-xs font-bold text-slate-800 truncate leading-tight">{name}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div className="purpose-cart-footer px-4 pb-4 pt-2 border-t border-slate-100">
                              <div className="flex justify-between items-center mb-3">
                                <span className="text-xs text-slate-400 font-bold">담은 상품</span>
                                <span className="text-sm font-bold text-slate-800">{cart.length}개</span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  className="w-full py-2.5 bg-slate-100 text-slate-700 text-sm rounded-xl font-bold transition-all hover:bg-slate-200 active:scale-95"
                                  onClick={() => api.removeThread(t.id)}
                                >
                                  삭제
                                </button>
                                <button
                                  type="button"
                                  className="w-full py-2.5 bg-gmarket-blue text-white text-sm rounded-xl font-bold transition-all hover:bg-blue-600 active:scale-95"
                                  onClick={() => resume(t)}
                                >
                                  쓰레드 이동
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
