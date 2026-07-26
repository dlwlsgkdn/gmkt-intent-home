import React, { useEffect, useRef } from 'react'
import Dropdown from '../ui/Dropdown.jsx'
import PlanCaseEditor from './PlanCaseEditor.jsx'

/*
 * 계획 케이스 탭 바 — 케이스가 수십 개까지 늘어나므로 가로 스크롤 목록이 핵심이다.
 * 목록 스크롤 동작(선택 케이스 자동 노출, 휠 가로 스크롤)은 이 바만의 관심사라 여기 둔다.
 */
export default function PlanCaseBar({
  planCases,
  activePlanCase,
  activeCaseIndex,
  surveyQuestions,
  previewMode,
  openMenu,
  toggleMenu,
  closeMenu,
  onSelectCase,
  onAddCase,
  onGenerateCases,
  onReviseCase,
  onChangeCase,
  onSetFallback,
  onDuplicate,
  onDelete,
  onMove,
}) {
  const tabsRef = useRef(null)

  /* 선택한 케이스가 긴 탭 목록 안에서 항상 보이도록 자동 스크롤 */
  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector(`[data-plan-case-id="${activePlanCase?.id}"]`)
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activePlanCase?.id])

  /* React의 합성 wheel은 브라우저에 따라 문서 기본 스크롤을 늦게 막는다.
     비수동 네이티브 리스너에서 기본 동작과 버블링을 선제 차단해 탭 행만 움직인다. */
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      if (!el.contains(event.target)) return
      if (el.scrollWidth <= el.clientWidth) return
      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!rawDelta) return
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? el.clientWidth : 1
      event.preventDefault()
      event.stopImmediatePropagation()
      el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + rawDelta * scale))
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [planCases.length])

  const scrollBy = (direction) => {
    const el = tabsRef.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(280, el.clientWidth * 0.72), behavior: 'smooth' })
  }

  return (
    <div className="sb-topbar__row sb-topbar__row--cases">
      <span className="sb-plan-cases__label">계획 케이스</span>
      <div className="sb-plan-case-tabs-wrap">
        <button type="button" className="sb-plan-case-scroll" aria-label="이전 계획 케이스 보기" title="이전 계획 케이스" onClick={() => scrollBy(-1)}>
          ‹
        </button>
        <div ref={tabsRef} className="sb-plan-case-tabs" role="tablist" aria-label="계획 케이스">
          {planCases.map((planCase, index) => (
            <button
              key={planCase.id}
              type="button"
              role="tab"
              data-plan-case-id={planCase.id}
              aria-selected={planCase.id === activePlanCase.id}
              className={'sb-plan-case-tab' + (planCase.id === activePlanCase.id ? ' sb-plan-case-tab--active' : '')}
              title={`${index + 1}순위 · ${planCase.isFallback ? '기본 케이스' : `${planCase.conditionMode === 'all' ? 'AND' : 'OR'} 조건 ${planCase.conditions.length}개`}`}
              onClick={() => onSelectCase(planCase.id)}
            >
              <span>{index + 1}</span>
              {planCase.name || `계획 케이스 ${index + 1}`}
              <b>{planCase.isFallback ? '기본' : planCase.conditions.length}</b>
            </button>
          ))}
        </div>
        <button type="button" className="sb-plan-case-scroll" aria-label="다음 계획 케이스 보기" title="다음 계획 케이스" onClick={() => scrollBy(1)}>
          ›
        </button>
      </div>
      <button type="button" className="sb-btn sb-btn--small sb-plan-case-add" disabled={previewMode} onClick={onAddCase}>
        + 새 케이스
      </button>
      <button
        type="button"
        className="sb-btn sb-btn--small sb-btn--ai"
        disabled={previewMode}
        onClick={onGenerateCases}
        title="조합별 케이스를 만들 프롬프트를 생성해요. 쓰던 AI에 붙여넣고 결과를 가져오면 케이스가 추가됩니다."
      >
        ⇄ 케이스 프롬프트
      </button>
      <button
        type="button"
        className="sb-btn sb-btn--small sb-btn--ai"
        disabled={previewMode}
        onClick={onReviseCase}
        title="현재 케이스의 페이지 전체를 다시 구성할 프롬프트를 만들어요. 컴포넌트 추가·삭제까지 가능합니다."
      >
        ⇄ 다시 만들기
      </button>
      <Dropdown
        open={openMenu === 'case'}
        onClose={closeMenu}
        menuClass="sb-plan-case-menu"
        button={
          <button
            type="button"
            className={'sb-btn sb-btn--small' + (openMenu === 'case' ? ' sb-btn--open' : '')}
            disabled={previewMode}
            onClick={() => toggleMenu('case')}
          >
            조건 · 우선순위 설정
          </button>
        }
      >
        <PlanCaseEditor
          planCase={activePlanCase}
          caseIndex={activeCaseIndex}
          caseCount={planCases.length}
          questions={surveyQuestions}
          onChange={onChangeCase}
          onSetFallback={onSetFallback}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onMove={onMove}
        />
      </Dropdown>
      <span className="sb-plan-cases__note">
        {activePlanCase.isFallback
          ? '조건 미일치 시 실행되는 기본 페이지'
          : `${activePlanCase.conditionMode === 'all' ? '모든 조건' : '조건 중 하나'} 만족 시 실행 · 앞 케이스 우선`}
      </span>
    </div>
  )
}
