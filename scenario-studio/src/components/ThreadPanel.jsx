import React from 'react'
import { hexToRgba } from '../lib/store.js'

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

/* 쇼핑 쓰레드 히스토리 패널 — 햄버거 버튼 위치(origin)에 맞는 방향에서 등장 */
export default function ThreadPanel({ api, open, origin = 'right', onClose }) {
  if (!open) return null

  const resume = (t) => {
    if (api.scenarios.some((s) => s.id === t.scenarioId)) {
      onClose()
      api.playScenario(t.scenarioId)
    } else {
      api.showToast('이 쓰레드의 시나리오를 찾을 수 없어요. (삭제되었거나 공유 체험이에요)')
    }
  }

  return (
    <>
      <div className="sb-drawer-backdrop" onClick={onClose} />
      <aside
        className={`sb-thread-panel sb-thread-panel--${origin}`}
        role="dialog"
        aria-modal="true"
        aria-label="쇼핑 쓰레드 히스토리"
      >
        <div className="sb-drawer__head">
          <div>
            <p className="sb-eyebrow">Shopping Threads</p>
            <h3>쓰레드 히스토리</h3>
          </div>
          <div className="sb-thread-panel__head-actions">
            {api.threads.length > 0 && (
              <button
                type="button"
                className="sb-thread-panel__clear"
                onClick={() => {
                  if (window.confirm('쓰레드 히스토리를 모두 지울까요?')) api.clearThreads()
                }}
              >
                전체 지우기
              </button>
            )}
            <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="sb-thread-panel__list">
          {api.threads.length === 0 && (
            <div className="sb-drawer__empty">
              아직 쇼핑 쓰레드가 없어요.<br />
              <span>홈에서 칩을 눌러 시나리오를 체험하면 여기에 쌓여요.</span>
            </div>
          )}
          {api.threads.map((t) => {
            const c = t.color || '#5f7465'
            return (
              <button key={t.id} type="button" className="sb-thread-card" onClick={() => resume(t)}>
                <div className="sb-thread-card__top">
                  <span
                    className="sb-thread-card__chip"
                    style={{ color: c, borderColor: hexToRgba(c, 0.45), background: hexToRgba(c, 0.08) }}
                  >
                    #{t.chip}
                  </span>
                  <span className={'sb-thread-card__status' + (t.status === 'completed' ? ' sb-thread-card__status--done' : '')}>
                    {t.status === 'completed' ? '체험 완료' : `진행 중 · ${t.stageLabel || '설문'}`}
                  </span>
                </div>
                <p className="sb-thread-card__title">{t.title}</p>
                <p className="sb-thread-card__meta">
                  {timeAgo(t.updatedAt || t.startedAt)}
                  {t.cart && t.cart.length > 0 && <> · 🧺 {t.cart.length}개 담음</>}
                </p>
                {t.cart && t.cart.length > 0 && (
                  <p className="sb-thread-card__cart">{t.cart.join(', ')}</p>
                )}
                <span
                  className="sb-thread-card__remove"
                  role="button"
                  tabIndex={0}
                  aria-label="이 쓰레드 삭제"
                  onClick={(e) => { e.stopPropagation(); api.removeThread(t.id) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); api.removeThread(t.id) }
                  }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
                </span>
              </button>
            )
          })}
        </div>
      </aside>
    </>
  )
}
