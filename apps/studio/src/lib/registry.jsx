import React from 'react'
import { FONT_OPTIONS } from './richtext.jsx'
import { isEditView, kText } from './registry/support.jsx'
import { EXPLORE_COMPONENTS } from './registry/exploreComponents.jsx'
import { SURVEY_COMPONENTS } from './registry/surveyComponents.jsx'
import { PLAN_COMPONENTS } from './registry/planComponents.jsx'
import { COMMON_COMPONENTS } from './registry/commonComponents.jsx'
import { LAYOUT_COMPONENTS } from './registry/layoutComponents.jsx'

/*
 * 컴포넌트 레지스트리 — 팔레트의 모든 컴포넌트 사양을 한 맵으로 조립한다.
 *  - stage: 이 컴포넌트가 기본으로 속하는 단계 (explore | survey | plan | common)
 *  - fields: 인스펙터에서 편집 가능한 플레이스홀더 정의
 *  - render(props, ctx): ctx.mode = 'canvas' | 'player'
 *    ctx.player = { query, setQuery, submitQuery, answers, setAnswer, itemId }
 *
 * 개별 정의는 lib/registry/의 카테고리 모듈에, 공용 렌더 도구(kText·ScrollTrack 등)는
 * lib/registry/support.jsx에 있다. 여기는 조립 + LIBRARY를 아는 렌더 진입점만 남는다.
 */

export { kText, isQuestionType } from './registry/support.jsx'

export const LIBRARY = {
  ...EXPLORE_COMPONENTS,
  ...SURVEY_COMPONENTS,
  ...PLAN_COMPONENTS,
  ...COMMON_COMPONENTS,
  ...LAYOUT_COMPONENTS,
}

export function libraryForStage(stageKey) {
  return Object.entries(LIBRARY)
    .filter(([, def]) => def.stage === stageKey || def.stage === 'common')
    .map(([type, def]) => ({ type, ...def }))
}

/* 컨테이너(레이아웃) 컴포넌트의 자식 아이템 — 같은 스테이지 배열에 parentId로 저장 */
export function childrenOf(items, parentId) {
  return (items || [])
    .filter((it) => it.parentId === parentId)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
}

/* 캔버스에서 컨테이너 자식을 감싸는 셸 — 클릭 선택/더블클릭 편집/드래그 재배치/리사이즈 핸들.
   LIBRARY에서 라벨을 찾아야 해서 카테고리 모듈이 아니라 조립부에 산다. */
function ChildShell({ item, index, ctx, children }) {
  const selected = ctx.selectedIds && ctx.selectedIds.includes(item.id)
  const def = LIBRARY[item.type]
  return (
    <div
      className={
        'sb-child' +
        (selected ? ' sb-child--selected' : '') +
        (ctx.draggingChildId === item.id ? ' sb-child--dragging' : '') +
        (item.hidden ? ' sb-child--hidden' : '')
      }
      data-child-id={item.id}
      data-child-of={item.parentId}
      onPointerDown={(e) => ctx.childPointerDown && ctx.childPointerDown(e, item.id)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (ctx.inspectChild) ctx.inspectChild(item.id)
      }}
    >
      <span className="sb-child__identity" aria-hidden="true">
        <b>{index + 1}</b>
        {def?.icon} {def?.label}
      </span>
      {children}
      {ctx.childResizeDown && (
        <span
          className="sb-resize-handle sb-child__resize"
          title="크기 조절"
          onPointerDown={(e) => ctx.childResizeDown(e, item.id)}
        />
      )}
    </div>
  )
}

export function renderItem(item, ctx) {
  const def = LIBRARY[item.type]
  if (!def) return <div className="text-xs text-red-400">알 수 없는 컴포넌트: {item.type}</div>

  /* 컨테이너면 자식들을 먼저 렌더해 ctx.children으로 공급 (ctx.allItems 필요) */
  let renderCtx = { ...ctx, itemId: item.id }
  if (def.container) {
    const kids = childrenOf(ctx.allItems, item.id).filter(
      (k) => !(ctx.mode === 'player' && k.hidden)
    )
    renderCtx.children = kids.map((k, index) => ({
      key: k.id,
      item: k, // 슬롯이 자식의 고유 크기(w/h)를 존중할 수 있도록 전달
      node:
        isEditView(ctx) && ctx.childPointerDown ? (
          <ChildShell item={k} index={index} ctx={ctx}>{renderItem(k, ctx)}</ChildShell>
        ) : (
          renderItem(k, ctx)
        ),
    }))
  }
  const el = def.render(item.props, renderCtx)

  /* 텍스트 스타일이 지정된 경우 래퍼로 감싸 강제 상속시킨다 */
  const st = item.style || {}
  const hasStyle = st.font || st.size || st.color || st.bold
  if (!hasStyle) return el

  const fontStack = FONT_OPTIONS.find((f) => f.key === st.font)?.stack || null
  const cls = ['sb-styled']
  const style = {}
  if (fontStack) { style['--sb-font'] = fontStack; cls.push('sb-style-font') }
  if (st.color) { style['--sb-color'] = st.color; cls.push('sb-style-color') }
  if (st.size) { style['--sb-size'] = `${st.size}px`; cls.push('sb-style-size') }
  if (st.bold) { cls.push('sb-style-bold'); style.fontWeight = 700 }
  return <div className={cls.join(' ')} style={style}>{el}</div>
}
