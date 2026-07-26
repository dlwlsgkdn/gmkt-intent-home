import React from 'react'
import {
  EmptyDropZone,
  Img,
  ScrollTrack,
  isEditView,
  isInteractionView,
  kText,
  parseCards,
  scrollCls,
} from './support.jsx'

/*
 * 레이아웃 컴포넌트 — container: true는 다른 컴포넌트를 자식으로 수용한다.
 * 자식은 같은 스테이지 배열에 parentId + slot으로 저장되고, 여기서는 ctx.children으로
 * 렌더된 노드를 받아 슬롯에 배치만 한다. 자식이 없으면 items 텍스트 목록이 안전망.
 */
export const LAYOUT_COMPONENTS = {
  hscroll: {
    label: '가로 스크롤 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'x',
    icon: '↔️',
    hint: '가로 스크롤 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드 목록도 가능)',
    defaults: {
      title: '함께 보면 좋아요',
      cardW: '168',
      scrollbar: false,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'cardW', label: '카드 너비(px)', kind: 'text' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const cardW = Math.max(96, Number(p.cardW) || 168)
      const kids = ctx.children || []
      const edit = isEditView(ctx)
      return (
        <div className={'sb-hscroll' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <ScrollTrack
            interactive={isInteractionView(ctx)}
            className={'sb-hscroll__track' + scrollCls(p.scrollbar)}
          >
            {kids.length > 0 ? (
              /* 자식은 편집자가 정한 자체 너비 유지 (없으면 카드 너비), 높이 지정 시 그대로 */
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-hscroll__slot"
                  style={{ width: c.item.w || cardW, height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))
            ) : (
              <>
                {cards.length === 0 && <EmptyDropZone ctx={ctx} />}
                {cards.map((c, i) => (
                  <div
                    key={i}
                    className="sb-hscroll__card"
                    style={{ width: cardW }}
                    role="button"
                    onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
                  >
                    <div className="sb-hscroll__thumb">
                      <Img src={c.imageUrl} alt={c.title} />
                    </div>
                    <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                    {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
                  </div>
                ))}
              </>
            )}
          </ScrollTrack>
        </div>
      )
    },
  },

  gridPanel: {
    label: '그리드 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'grid',
    icon: '🔲',
    hint: 'N열 그리드 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드 목록도 가능)',
    defaults: {
      title: '카테고리 둘러보기',
      cols: '2',
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'cols', label: '열 수 (1~4)', kind: 'text' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const cols = Math.max(1, Math.min(4, Number(p.cols) || 2))
      const kids = ctx.children || []
      return (
        <div className={'sb-gridpanel' + (isEditView(ctx) ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <div className="sb-gridpanel__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {kids.length > 0 &&
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-gridpanel__slot"
                  style={{ width: c.item.w || undefined, height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-hscroll__card sb-gridpanel__card"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-hscroll__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
              </div>
            ))}
          </div>
        </div>
      )
    },
  },

  carousel: {
    label: '싱글 스크롤 캐러셀',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'x',
    icon: '🎠',
    hint: '한 장씩 스냅되는 캐러셀 레이아웃 — 다른 컴포넌트를 끌어다 슬라이드로 (텍스트 카드도 가능)',
    defaults: {
      title: '',
      scrollbar: false,
      arrows: true,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'arrows', label: '좌우 화살표 버튼', kind: 'toggle' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const kids = ctx.children || []
      const slideCount = kids.length > 0 ? kids.length : cards.length
      const edit = isEditView(ctx)
      return (
        <div className={'sb-carousel' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <ScrollTrack
            interactive={isInteractionView(ctx)}
            arrows={!edit && !!p.arrows && slideCount > 1}
            className={'sb-carousel__track' + scrollCls(p.scrollbar)}
          >
            {kids.length > 0 && kids.map((c) => (
              /* 자식이 고유 크기를 가지면 슬라이드도 그 크기를 따른다 (없으면 한 장 = 컨테이너 폭). */
              <div
                key={c.key}
                className="sb-carousel__slot"
                style={{
                  ...(c.item.w ? { flex: `0 0 ${c.item.w}px` } : null),
                  ...(c.item.h ? { height: c.item.h } : null),
                }}
              >
                {c.node}
              </div>
            ))}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-carousel__card"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-carousel__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <p className="sb-hscroll__name">{kText(c.title, ctx)}</p>
                {c.sub ? <p className="sb-hscroll__sub">{kText(c.sub, ctx)}</p> : null}
              </div>
            ))}
          </ScrollTrack>
          {slideCount > 1 && (
            <p className="sb-carousel__hint" aria-hidden="true">← 옆으로 넘겨보세요 · {slideCount}장 →</p>
          )}
        </div>
      )
    },
  },

  tablePanel: {
    label: '테이블',
    stage: 'common',
    category: 'layout',
    icon: '📊',
    hint: '헤더 + 행 표. 셀은 "|", 행은 줄바꿈으로 구분 (셀 안 쉼표 사용 가능)',
    defaults: {
      title: '용량별 가격 비교',
      headers: '제품|용량|가격',
      rows: '수분광 프라이머|30ml|18,900원\n톤업 쿠션|15g|24,900원\n세팅 픽서|100ml|12,500원',
    },
    fields: [
      { key: 'title', label: '표 제목 (비우면 숨김)', kind: 'text' },
      { key: 'headers', label: '헤더 (| 구분)', kind: 'text' },
      { key: 'rows', label: '행 목록 (셀은 |, 행은 줄바꿈 — 줄바꿈이 없으면 쉼표)', kind: 'textarea', list: true },
    ],
    render: (p, ctx) => {
      const headers = String(p.headers || '').split('|').map((s) => s.trim()).filter(Boolean)
      // 행 구분: 줄바꿈 우선(셀 안 쉼표 허용), 줄바꿈이 없으면 쉼표
      const raw = String(p.rows || '')
      const rows = (raw.includes('\n') ? raw.split('\n') : raw.split(','))
        .map((s) => s.trim())
        .filter(Boolean)
        .map((row) => row.split('|').map((s) => s.trim()))
      return (
        <div className="sb-table">
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <div className="sb-table__scroll">
            <table>
              {headers.length > 0 && (
                <thead>
                  <tr>
                    {headers.map((h, i) => <th key={i}>{kText(h, ctx)}</th>)}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={Math.max(1, headers.length)} className="sb-table__empty">행을 입력하세요 — 예: 이름|용량|가격</td></tr>
                )}
                {rows.map((cells, ri) => (
                  <tr key={ri}>
                    {(headers.length ? headers : cells).map((_, ci) => (
                      <td key={ci}>{kText(cells[ci] || '', ctx)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )
    },
  },

  vscroll: {
    label: '세로 스크롤 패널',
    stage: 'common',
    category: 'layout',
    container: true,
    flow: 'y',
    icon: '↕️',
    hint: '고정 높이 세로 스크롤 레이아웃 — 다른 컴포넌트를 끌어다 안에 배치 (텍스트 카드도 가능)',
    defaults: {
      title: '더 볼만한 항목',
      panelH: '280',
      scrollbar: true,
      items: '',
    },
    fields: [
      { key: 'title', label: '패널 제목 (비우면 숨김)', kind: 'text' },
      { key: 'items', label: '카드 목록 (제목|설명|이미지URL, 쉼표 구분)', kind: 'textarea', list: true },
      { key: 'panelH', label: '스크롤 영역 높이(px)', kind: 'text' },
      { key: 'scrollbar', label: '스크롤바 상시 표시', kind: 'toggle' },
    ],
    render: (p, ctx) => {
      const cards = parseCards(p.items)
      const panelH = Math.max(120, Number(p.panelH) || 280)
      const kids = ctx.children || []
      const edit = isEditView(ctx)
      return (
        <div className={'sb-vscroll' + (edit ? ' sb-container-edit' : '')}>
          {p.title ? <p className="sb-hscroll__title">{kText(p.title, ctx, 'title')}</p> : null}
          <ScrollTrack
            axis="y"
            interactive={isInteractionView(ctx)}
            className={'sb-vscroll__list' + scrollCls(p.scrollbar)}
            style={{ height: panelH }}
          >
            {kids.length > 0 &&
              kids.map((c) => (
                <div
                  key={c.key}
                  className="sb-vscroll__slot"
                  style={{ width: c.item.w || undefined, height: c.item.h || undefined }}
                >
                  {c.node}
                </div>
              ))}
            {kids.length === 0 && cards.length === 0 && <EmptyDropZone ctx={ctx} />}
            {kids.length === 0 && cards.map((c, i) => (
              <div
                key={i}
                className="sb-vscroll__row"
                role="button"
                onClick={() => { if (ctx.mode === 'player') ctx.player.openExternal(c.title) }}
              >
                <div className="sb-vscroll__thumb">
                  <Img src={c.imageUrl} alt={c.title} />
                </div>
                <div className="sb-vscroll__body">
                  <p className="sb-vscroll__name">{kText(c.title, ctx)}</p>
                  {c.sub ? <p className="sb-vscroll__sub">{kText(c.sub, ctx)}</p> : null}
                </div>
              </div>
            ))}
          </ScrollTrack>
        </div>
      )
    },
  },
}
