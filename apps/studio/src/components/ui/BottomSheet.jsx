import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'

/*
 * 바텀 시트 / 가운데 모달 공용 껍데기 — Figma [PP1K] 시트 한 벌 (2026-09):
 *  - variant 'sheet'(기본): 아래에서 올라오는 패널. 그립(36×4) → (제목 · 부제) → 본문 → (푸터).
 *    상단 radius 24, 패딩 8/16/34. 제목은 가운데(날짜 선택)가 기본이고, closable 이면 Figma SheetHeader(ShowClose)처럼
 *    제목 왼쪽 + ✕ 오른쪽으로 바뀐다(쇼핑 쓰레드 상세). footer 를 주면 본문만 스크롤하고 푸터는 밑에 고정된다.
 *  - variant 'center': 화면 가운데 카드(샘플 얼굴 "모델 얼굴 선택" 모달). radius 24, 패딩 20, 제목(16/21) 왼쪽 + ✕, 부제 12/17.
 *    align 'center' 면 확인 모달(삭제 확인 — 제목·설명 가운데, ✕ 없음, 버튼은 children)이다.
 *
 * body로 포털한다: 실행 화면(.sb-player)이 z-index 스택 문맥을 만들어서, 그 안에 두면
 * 아무리 z-index를 올려도 하단 플로팅 바 밑에 깔린다.
 * 쓰는 곳 — 설문 사진/날짜 질문(lib/registry/surveyComponents.jsx), 키워드 설명(Player·LivePlayer), 쇼핑 쓰레드 패널.
 */
export default function BottomSheet({
  title,
  subtitle,
  variant = 'sheet',
  align,
  closable,
  footer = null,
  onClose,
  children,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const center = variant === 'center'
  const centered = align ? align === 'center' : !center // 시트 제목은 가운데, 카드 제목은 왼쪽이 기본
  const showClose = closable != null ? closable : center
  const hasHead = !!title || showClose
  return createPortal(
    <div
      className={'sb-sheet' + (center ? ' sb-sheet--center' : '') + (footer ? ' sb-sheet--footed' : '')}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      onClick={onClose}
    >
      <div className={'sb-sheet__panel' + (footer ? ' has-footer' : '')} onClick={(e) => e.stopPropagation()}>
        {!center && <span className="sb-sheet__grip" aria-hidden="true" />}
        {hasHead && (
          <div className={'sb-sheet__head' + (centered ? ' sb-sheet__head--center' : ' sb-sheet__head--start')}>
            {title ? <p className="sb-sheet__title">{title}</p> : <span />}
            {showClose && (
              <button type="button" className="sb-sheet__close" aria-label="닫기" onClick={onClose}>✕</button>
            )}
          </div>
        )}
        {subtitle ? <p className={'sb-sheet__subtitle' + (centered ? ' is-center' : '')}>{subtitle}</p> : null}
        {footer ? <div className="sb-sheet__body">{children}</div> : children}
        {footer ? <div className="sb-sheet__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
