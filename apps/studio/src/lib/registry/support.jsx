import React from 'react'
import { splitTextList, joinTextList } from '../store.js'
import { TOKEN_RE, richSpanPresentation, InlineEditor } from '../richtext.jsx'

/*
 * 레지스트리 공용 렌더 도구 — 컴포넌트 정의들이 함께 쓰는 조각.
 * 개별 컴포넌트 정의는 lib/registry/*Components.jsx, 조립은 lib/registry.jsx.
 */

export const FALLBACK_IMG = './makeup-clone-assets/d9b261330f3ffccf.avif'

/* 유튜브 URL이면 별도 썸네일 입력 없이 공개 썸네일을 사용한다. */
export function youtubeThumbnail(rawUrl) {
  const raw = String(rawUrl || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '')
    let videoId = ''
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || ''
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      videoId = url.searchParams.get('v') || ''
      if (!videoId) {
        const [kind, id] = url.pathname.split('/').filter(Boolean)
        if (kind === 'shorts' || kind === 'embed' || kind === 'live') videoId = id || ''
      }
    }
    return /^[\w-]{6,}$/.test(videoId)
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : ''
  } catch {
    return ''
  }
}

export function Img({ src, alt }) {
  // draggable=false: 브라우저 기본 이미지 드래그(고스트)가 트랙 드래그 스크롤을 가로채지 않게
  return (
    <img
      src={src || FALLBACK_IMG}
      alt={alt || ''}
      draggable={false}
      onError={(e) => { e.currentTarget.src = FALLBACK_IMG }}
    />
  )
}

/* "제목|설명|이미지URL" 목록 파싱 — 가로/세로 스크롤·그리드·캐러셀 공용.
   줄바꿈 구분이면 설명 안에 쉼표를 쓸 수 있다 */
export function parseCards(text) {
  return splitTextList(text).map((chunk) => {
    const [title, sub, imageUrl] = chunk.split('|').map((s) => s.trim())
    return { title: title || '', sub: sub || '', imageUrl: imageUrl || '' }
  })
}

/* parseCards의 역방향 — GUI 목록 편집기가 만든 행을 저장 문자열로 */
export function joinCards(rows) {
  return joinTextList(
    (rows || [])
      .map((row) => ({
        title: String(row?.title || '').trim(),
        sub: String(row?.sub || '').trim(),
        imageUrl: String(row?.imageUrl || '').trim(),
      }))
      .filter((row) => row.title || row.sub || row.imageUrl)
      .map((row) =>
        row.imageUrl ? `${row.title}|${row.sub}|${row.imageUrl}` : row.sub ? `${row.title}|${row.sub}` : row.title
      )
  )
}

/* 테이블 행 파싱 — 행은 줄바꿈(없으면 쉼표), 셀은 "|" */
export function parseTableRows(text) {
  return splitTextList(text).map((row) => row.split('|').map((s) => s.trim()))
}

/* parseTableRows의 역방향 — 빈 행은 버리고, 셀 배열을 "|"로 잇는다 (쉼표 오파싱 가드는 joinTextList가) */
export function joinTableRows(rows) {
  return joinTextList(
    (rows || [])
      .map((cells) => (cells || []).map((cell) => String(cell || '').trim()))
      .filter((cells) => cells.some(Boolean))
      .map((cells) => cells.join('|'))
  )
}

/* 스크롤 컨테이너의 스크롤바 표시 유틸 클래스 */
export const scrollCls = (show) => (show ? ' sb-scroll-bar' : ' sb-scroll-hide')

/* 가로/세로 스크롤 트랙 — 데스크탑 마우스 드래그 + 옵션 좌우 화살표 (스냅 유지) */
export function ScrollTrack({ className, children, interactive, arrows, slideGap = 12, axis = 'x', style }) {
  const ref = React.useRef(null)
  const draggedRef = React.useRef(false)

  const onPointerDown = (e) => {
    const el = ref.current
    if (!el || e.button !== 0) return
    const horizontal = axis === 'x'
    const startPoint = horizontal ? e.clientX : e.clientY
    const startScroll = horizontal ? el.scrollLeft : el.scrollTop
    const prevSnap = el.style.scrollSnapType
    let moved = false
    const move = (ev) => {
      const point = horizontal ? ev.clientX : ev.clientY
      const delta = point - startPoint
      if (!moved && Math.abs(delta) > 5) {
        moved = true
        draggedRef.current = true
        el.style.scrollSnapType = 'none' // 드래그 중엔 스냅 해제
        el.classList.add('sb-drag-scroll--active')
      }
      if (moved) {
        ev.preventDefault()
        if (horizontal) el.scrollLeft = startScroll - delta
        else el.scrollTop = startScroll - delta
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.classList.remove('sb-drag-scroll--active')
      if (moved) {
        el.style.scrollSnapType = prevSnap // 복원 → 가장 가까운 슬라이드로 스냅
        setTimeout(() => { draggedRef.current = false }, 120)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const page = (dir) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * (el.clientWidth + slideGap), behavior: 'smooth' })
  }

  return (
    <div className="sb-track-wrap">
      <div
        ref={ref}
        className={className + (interactive ? ' sb-drag-scroll' : '')}
        style={style}
        onPointerDown={interactive ? onPointerDown : undefined}
        onDragStart={(e) => e.preventDefault()} // 이미지/링크의 네이티브 드래그 차단
        onClickCapture={(e) => {
          // 드래그 직후의 클릭은 카드 클릭으로 취급하지 않는다
          if (draggedRef.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        {children}
      </div>
      {arrows && (
        <>
          <button type="button" className="sb-track-arrow sb-track-arrow--prev" aria-label="이전" onClick={() => page(-1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button type="button" className="sb-track-arrow sb-track-arrow--next" aria-label="다음" onClick={() => page(1)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>
        </>
      )}
    </div>
  )
}

/* 캔버스 편집 모드 여부 — 컨테이너 경계와 자식 선택 셸만 표시한다.
   전체 자식 목록은 인스펙터 Navigator가 담당하므로 실제 뷰포트 크기는 늘리지 않는다. */
export const isEditView = (ctx) => ctx.mode === 'canvas' && ctx.canvasView !== 'preview'
export const isInteractionView = (ctx) => ctx.mode === 'player' || (ctx.mode === 'canvas' && ctx.canvasView === 'preview')

/* 캔버스 편집 모드의 빈 컨테이너 드롭존 (미리보기·실행 화면에서는 렌더 안 함) */
export const EmptyDropZone = ({ ctx }) =>
  isEditView(ctx) ? (
    <div className="sb-container-empty">컴포넌트를 여기로 끌어다 놓으세요</div>
  ) : null

/* 텍스트 안의 [[키워드]]를 점선 밑줄로 렌더 — 플레이어에서 클릭하면 설명 모달.
   사전은 탐색 페이지 편집기의 '키워드 사전'에서 관리한다. */
function RichSpan({ optsStr, content, ctx, i }) {
  const { spec, cls, style } = richSpanPresentation(optsStr)
  return (
    <span
      key={i}
      className={cls.join(' ')}
      style={style}
      role={spec.kw ? 'button' : undefined}
      onClick={spec.kw ? (e) => {
        if (ctx && ctx.mode === 'player' && ctx.player.showKeyword) {
          e.stopPropagation()
          ctx.player.showKeyword(content)
        }
      } : undefined}
    >
      {content}
    </span>
  )
}

/* 텍스트 렌더러: [[키워드]] 점선 밑줄 + {{서식|텍스트}} 부분 서식.
   fieldKey를 넘기면 캔버스에서 더블클릭 → 컴포넌트 안에서 바로 편집(WYSIWYG) */
export function kText(text, ctx, fieldKey) {
  const str = String(text ?? '')
  const parts = str.split(TOKEN_RE).map((part, i) => {
    const kw = part.match(/^\[\[([^\]]+)\]\]$/)
    if (kw) return <RichSpan key={i} optsStr="kw" content={kw[1]} ctx={ctx} i={i} />
    const rich = part.match(/^\{\{([^|{}]*)\|([^{}]*?)\}\}$/)
    if (rich) return <RichSpan key={i} optsStr={rich[1]} content={rich[2]} ctx={ctx} i={i} />
    return part
  })

  // 캔버스 인라인 편집 (미리보기에서는 beginEdit을 공급하지 않아 읽기 전용)
  if (fieldKey && ctx && ctx.mode === 'canvas' && ctx.beginEdit) {
    const editingThis = ctx.editing && ctx.editing.itemId === ctx.itemId && ctx.editing.key === fieldKey
    if (editingThis) {
      return <InlineEditor raw={str} onCommit={(v) => ctx.commitEdit(ctx.itemId, fieldKey, v)} />
    }
    return (
      <span
        className="sb-editable"
        title="더블클릭해서 바로 편집"
        onDoubleClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          ctx.beginEdit(ctx.itemId, fieldKey)
        }}
      >
        {parts}
      </span>
    )
  }
  return parts
}
