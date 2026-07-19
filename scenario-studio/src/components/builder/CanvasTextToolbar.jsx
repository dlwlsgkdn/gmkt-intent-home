import React, { useEffect, useState } from 'react'
import {
  FONT_OPTIONS, TEXT_COLORS, SizeMenu,
  domToMarkup, markupToHtml, boundaryToRaw, rawToBoundary, applyOptToRaw,
} from '../../lib/richtext.jsx'

/* 캔버스 인라인 편집 중, 텍스트를 드래그 선택하면 선택 위에 뜨는 서식 툴바.
   에디터 DOM을 직접 다시 그려 서식이 즉시 미리보기되고,
   적용한 구간을 자동 재선택해 연속으로 서식을 줄 수 있다. */
export default function CanvasTextToolbar({ active, ensureKeyword }) {
  const [rect, setRect] = useState(null)

  useEffect(() => {
    if (!active) {
      setRect(null)
      return
    }
    const onSelChange = () => {
      // 툴바 자체와 상호작용 중이면 유지
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.sb-seltb--canvas')) return
      const editor = document.getElementById('sb-inline-editor')
      const sel = window.getSelection()
      if (!editor || !sel.rangeCount || sel.isCollapsed) {
        setRect(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!editor.contains(range.commonAncestorContainer)) {
        setRect(null)
        return
      }
      const r = range.getBoundingClientRect()
      if (r.width < 1) { setRect(null); return }
      setRect({ top: r.top, left: r.left + r.width / 2 })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [active])

  if (!active || !rect) return null

  const apply = (opt) => {
    const editor = document.getElementById('sb-inline-editor')
    const sel = window.getSelection()
    if (!editor || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const s = boundaryToRaw(editor, range.startContainer, range.startOffset)
    const e = boundaryToRaw(editor, range.endContainer, range.endOffset)
    if (s === e) return
    const raw = domToMarkup(editor)
    if (opt === 'kw' && ensureKeyword) {
      const word = raw.slice(Math.min(s, e), Math.max(s, e))
      if (!/[,|{}[\]\n]/.test(word)) ensureKeyword(word.trim())
    }
    const res = applyOptToRaw(raw, Math.min(s, e), Math.max(s, e), opt)
    editor.innerHTML = markupToHtml(res.value) // 즉시 미리보기
    editor.focus()
    // 적용 구간 재선택 → 툴바 유지, 연속 적용 가능
    const start = rawToBoundary(editor, res.start)
    const end = rawToBoundary(editor, res.end)
    const nr = document.createRange()
    nr.setStart(start.node, start.offset)
    nr.setEnd(end.node, end.offset)
    sel.removeAllRanges()
    sel.addRange(nr)
    const r2 = nr.getBoundingClientRect()
    if (r2.width >= 1) setRect({ top: r2.top, left: r2.left + r2.width / 2 })
  }

  const style = {
    position: 'fixed',
    top: Math.max(8, rect.top - 44),
    left: rect.left,
    transform: 'translateX(-50%)',
    zIndex: 300,
  }

  return (
    <div className="sb-seltb sb-seltb--canvas" style={style} onMouseDown={(e) => e.preventDefault()}>
      <button type="button" title="볼드" onClick={() => apply('b')}><b>B</b></button>
      {FONT_OPTIONS.filter((f) => f.key).map((f) => (
        <button key={f.key} type="button" title={f.label} style={{ fontFamily: f.stack }} onClick={() => apply('f' + f.key)}>
          {f.label}
        </button>
      ))}
      <SizeMenu onPick={(n) => apply('s' + n)} />
      <span className="sb-seltb__sep" />
      {TEXT_COLORS.filter((c) => c.color).map((c) => (
        <button key={c.key} type="button" title={c.label} className="sb-seltb__color" style={{ background: c.color }} onClick={() => apply('c' + c.color)} />
      ))}
      <span className="sb-seltb__sep" />
      <button type="button" className="sb-seltb__kw" title="점선 밑줄 + 설명 모달 연결" onClick={() => apply('kw')}>
        <span className="keyword-detail-text">밑줄</span>
      </button>
      <button type="button" title="선택 구간 서식 지우기" onClick={() => apply('clear')}><s>가</s></button>
    </div>
  )
}
