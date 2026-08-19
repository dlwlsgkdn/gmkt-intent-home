import React from 'react'
import { createPortal } from 'react-dom'

/*
 * 바텀 시트 공용 껍데기 — 배경을 덮고 아래에서 올라온다.
 * (Figma "사진 선택 옵션 / 샘플 얼굴 선택 / 날짜 선택 바텀 시트" 한 벌)
 *
 * body로 포털한다: 실행 화면(.sb-player)이 z-index 스택 문맥을 만들어서, 그 안에 두면
 * 아무리 z-index를 올려도 하단 플로팅 바 밑에 깔린다.
 * 쓰는 곳 — 설문 사진/날짜 질문(lib/registry/surveyComponents.jsx), 키워드 설명(Player·LivePlayer).
 */
export default function BottomSheet({ title, onClose, children }) {
  return createPortal(
    <div className="sb-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sb-sheet__panel" onClick={(e) => e.stopPropagation()}>
        <span className="sb-sheet__grip" aria-hidden="true" />
        <div className="sb-sheet__head">
          <p className="sb-sheet__title">{title}</p>
          <button type="button" className="sb-sheet__close" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
