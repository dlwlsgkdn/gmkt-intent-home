import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

/*
 * 바텀 시트 / 가운데 모달 공용 껍데기 — Figma [PP1K] 설문 시트 한 벌 (2026-09):
 *  - variant 'sheet'(기본): 아래에서 올라오는 패널. 그립(36×4) → (제목 Gumi 18 가운데 · 부제) → 본문.
 *    상단 radius 24, 패딩 8/16/34. Figma 시트에는 ✕ 가 없다 — 배경 탭·Esc 로 닫는다.
 *  - variant 'center': 화면 가운데 카드 (샘플 얼굴 "모델 얼굴 선택" 모달). radius 24, 패딩 20,
 *    제목(16/21) 왼쪽 + ✕ 오른쪽, 부제 12/17.
 *
 * body로 포털한다: 실행 화면(.sb-player)이 z-index 스택 문맥을 만들어서, 그 안에 두면
 * 아무리 z-index를 올려도 하단 플로팅 바 밑에 깔린다.
 * 쓰는 곳 — 설문 사진/날짜 질문(lib/registry/surveyComponents.jsx), 키워드 설명(Player·LivePlayer).
 */
export default function BottomSheet({ title, subtitle, variant = 'sheet', onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const center = variant === 'center'
  return createPortal(
    <div
      className={'sb-sheet' + (center ? ' sb-sheet--center' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      onClick={onClose}
    >
      <div className="sb-sheet__panel" onClick={(e) => e.stopPropagation()}>
        {!center && <span className="sb-sheet__grip" aria-hidden="true" />}
        {(title || center) && (
          <div className="sb-sheet__head">
            {title ? <p className="sb-sheet__title">{title}</p> : <span />}
            {center && (
              <button type="button" className="sb-sheet__close" aria-label="닫기" onClick={onClose}>✕</button>
            )}
          </div>
        )}
        {subtitle ? <p className="sb-sheet__subtitle">{subtitle}</p> : null}
        {children}
      </div>
    </div>,
    document.body
  )
}
