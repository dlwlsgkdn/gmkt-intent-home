import React from 'react'

/*
 * AI 수정 방식 선택 — 평가 탭의 단일 진입점.
 *
 * "문구 다듬기"(필드 단위)와 "페이지 재구성"(케이스 통째)은 안전 모델이 달라
 * 별개 기능이어야 하지만, 버튼을 나란히 두면 뭘 눌러야 할지 고르는 부담이
 * 사용자에게 넘어온다. 그래서 입구는 하나로 두고 여기서 "무엇을 고치고 싶은지"
 * 기준으로 갈라 준다 — 예시 문장이 곧 선택 기준이다.
 */
export default function AiFixChooser({
  activeCaseName,
  activeSlot,
  seedCount = 0,
  targetCount = 0,
  onPickPolish,
  onPickRebuild,
  onPickPropagate,
  onClose,
}) {
  return (
    <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="sb-llm-dialog sb-fix-chooser" role="dialog" aria-modal="true" aria-labelledby="sb-fixc-title">
        <div className="sb-llm-dialog__head">
          <div>
            <p className="sb-panel-label">피드백 → 프롬프트 → 내 AI → 적용</p>
            <h2 id="sb-fixc-title">무엇을 고치고 싶으세요?</h2>
            <p>둘 다 프롬프트 왕복으로 진행돼요. 고치려는 범위에 따라 골라주세요.</p>
          </div>
          <button type="button" className="sb-icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="sb-fix-chooser__cards">
          <button type="button" className="sb-mode-card" onClick={onPickPolish}>
            <span className="sb-mode-card__head">
              <strong>문구 다듬기</strong>
              <em>CASE A/B/C 전체 · 필드 단위</em>
            </span>
            <small>
              구성은 그대로 두고 문구·표현만 고칩니다.
              수정안을 하나씩 확인하고 골라서 적용해요.
            </small>
            <span className="sb-fix-chooser__examples">
              예: "설명이 어색해요" · "톤을 존댓말로" · "제목이 조합과 안 맞아요"
            </span>
          </button>

          <button type="button" className="sb-mode-card" onClick={onPickRebuild}>
            <span className="sb-mode-card__head">
              <strong>페이지 재구성</strong>
              <em>CASE {activeSlot} 하나 · 통째 교체</em>
            </span>
            <small>
              지금 보고 있는 <b>{activeCaseName}</b> 케이스의 페이지 전체를 다시 짭니다.
              컴포넌트 추가·삭제·재배치까지 가능하고, 통째로 적용돼요(⌘Z로 되돌리기).
            </small>
            <span className="sb-fix-chooser__examples">
              예: "영상·게시글을 넣어줘" · "CTA는 빼줘" · "상품을 바꿔줘"
            </span>
          </button>

          <button
            type="button"
            className="sb-mode-card"
            disabled={seedCount === 0}
            title={seedCount === 0 ? '대표 케이스에 피드백을 먼저 남겨주세요' : undefined}
            onClick={onPickPropagate}
          >
            <span className="sb-mode-card__head">
              <strong>피드백 전체 반영</strong>
              <em>나머지 {targetCount}개 케이스 · 필드 단위</em>
            </span>
            <small>
              대표 3개에 남긴 피드백 {seedCount}개를 패턴 삼아, <b>평가하지 않은 나머지 케이스</b>의
              같은 자리에서 같은 문제를 찾아 고칩니다. 대표만 보고 전체에 영향을 주는 단계예요.
            </small>
            <span className="sb-fix-chooser__examples">
              흐름: 대표 평가·수정 → 전체 반영 (수정안은 하나씩 골라 적용)
            </span>
          </button>
        </div>

        <div className="sb-llm-dialog__foot">
          <p>애매하면 문구 다듬기부터 — 거기서 처리 못 하는 피드백은 페이지 재구성으로 이어갈 수 있어요.</p>
          <div>
            <button type="button" className="sb-btn sb-btn--ghost" onClick={onClose}>취소</button>
          </div>
        </div>
      </section>
    </div>
  )
}
