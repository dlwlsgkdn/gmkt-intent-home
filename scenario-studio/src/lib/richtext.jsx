import React, { useEffect, useRef } from 'react'

/* ── 인라인 리치텍스트 엔진 ──
   마크업: {{옵션|텍스트}} (옵션: b, s18, c#hex, fserif|fmono, kw) + [[키워드]]
   캔버스 인라인 편집(contentEditable)과 인스펙터 툴바가 공유한다 */

export const FONT_OPTIONS = [
  { key: null, label: '기본', stack: null },
  { key: 'serif', label: '명조', stack: "'Nanum Myeongjo', 'Noto Serif KR', 'AppleMyungjo', serif" },
  { key: 'mono', label: '모노', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

export const TEXT_COLORS = [
  { key: null, label: '기본', color: null },
  { key: 'ink', label: '잉크', color: '#1f2933' },
  { key: 'muted', label: '뮤트', color: '#64748b' },
  { key: 'rose', label: '로즈', color: '#b45a6b' },
  { key: 'blue', label: '블루', color: '#3b5bdb' },
  { key: 'green', label: '그린', color: '#00996b' },
  { key: 'amber', label: '앰버', color: '#a9762c' },
]

export const TOKEN_RE = /(\{\{[^|{}]*\|[^{}]*?\}\}|\[\[[^\]]+\]\])/g

export function parseRichOpts(optsStr) {
  const spec = {}
  String(optsStr || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((o) => {
    if (o === 'b') spec.bold = true
    else if (o === 'kw') spec.kw = true
    else if (/^s\d+$/.test(o)) spec.size = Number(o.slice(1))
    else if (/^c#[0-9a-fA-F]{3,8}$/.test(o)) spec.color = o.slice(1)
    else if (/^f(serif|mono)$/.test(o)) spec.font = o.slice(1)
  })
  return spec
}

export function richSpanPresentation(optsStr) {
  const spec = parseRichOpts(optsStr)
  const cls = ['sb-rich']
  const style = {}
  if (spec.bold) cls.push('sb-rich-b')
  if (spec.size) { cls.push('sb-rich-size'); style['--sb-size'] = `${spec.size}px` }
  if (spec.color) { cls.push('sb-rich-color'); style['--sb-color'] = spec.color }
  if (spec.font) {
    const stack = FONT_OPTIONS.find((f) => f.key === spec.font)?.stack
    if (stack) { cls.push('sb-rich-font'); style['--sb-font'] = stack }
  }
  if (spec.kw) cls.push('keyword-detail-text')
  return { spec, cls, style }
}

const escHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')

/* 마크업 → contentEditable용 HTML */
export function markupToHtml(raw) {
  const parts = String(raw ?? '').split(TOKEN_RE)
  return parts
    .map((part) => {
      const kw = part.match(/^\[\[([^\]]+)\]\]$/)
      if (kw) return `<span data-kw="1" class="sb-rich keyword-detail-text">${escHtml(kw[1])}</span>`
      const rich = part.match(/^\{\{([^|{}]*)\|([^{}]*?)\}\}$/)
      if (rich) {
        const { cls, style } = richSpanPresentation(rich[1])
        const styleStr = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';')
        return `<span data-opts="${rich[1]}" class="${cls.join(' ')}" style="${styleStr}">${escHtml(rich[2])}</span>`
      }
      return escHtml(part)
    })
    .join('')
}

/* contentEditable DOM → 마크업 */
export function domToMarkup(el) {
  let out = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out += n.textContent
    else if (n.nodeName === 'BR') out += '\n'
    else if (n.nodeType === 1 && n.dataset && n.dataset.kw != null) out += `[[${n.textContent}]]`
    else if (n.nodeType === 1 && n.dataset && n.dataset.opts != null) out += `{{${n.dataset.opts}|${n.textContent}}}`
    else out += n.textContent || ''
  })
  return out
}

/* DOM 선택 경계 → 마크업 문자열 오프셋 */
export function boundaryToRaw(editor, node, offset) {
  let pos = 0
  const childLen = (c) => {
    if (c.nodeType === 3) return c.textContent.length
    if (c.nodeName === 'BR') return 1
    if (c.dataset && c.dataset.kw != null) return c.textContent.length + 4
    if (c.dataset && c.dataset.opts != null) return c.textContent.length + c.dataset.opts.length + 3 // {{ | }}
    return (c.textContent || '').length
  }
  if (node === editor) {
    for (let i = 0; i < offset; i++) pos += childLen(editor.childNodes[i])
    return pos
  }
  for (const c of editor.childNodes) {
    if (c === node) return pos + offset // 최상위 텍스트 노드
    if (c.contains && c.contains(node)) {
      // 스팬 내부 텍스트: 내용 시작 위치 + 내부 오프셋
      const prefix = c.dataset && c.dataset.kw != null ? 2 : 2 + (c.dataset?.opts?.length || 0) + 1
      return pos + prefix + offset
    }
    pos += childLen(c)
  }
  return pos
}

/* 선택 경계가 토큰 내용 안이면 토큰 전체로 확장 */
function snapRange(raw, s, e) {
  let m
  TOKEN_RE.lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  while ((m = re.exec(raw))) {
    const ts = m.index
    const te = ts + m[0].length
    if (s > ts && s < te) s = ts
    if (e > ts && e < te) e = te
  }
  return [s, e]
}

const unwrapAll = (str) =>
  str.replace(/\{\{[^|{}]*\|([^{}]*?)\}\}/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')

export function mergeOpts(existing, opt) {
  const list = existing.split(',').map((x) => x.trim()).filter(Boolean)
  const kind = opt === 'b' ? 'b' : opt === 'kw' ? 'kw' : opt[0]
  const filtered = list.filter((o) =>
    o === 'b' ? kind !== 'b' : o === 'kw' ? kind !== 'kw' : o[0] !== kind
  )
  if ((opt === 'b' && list.includes('b')) || (opt === 'kw' && list.includes('kw'))) return filtered.join(',')
  return [...filtered, opt].join(',')
}

/* 마크업 문자열의 [s,e) 구간에 서식 적용/해제. 반환: 새 문자열 */
export function applyOptToRaw(raw, s, e, opt) {
  ;[s, e] = snapRange(raw, s, e)
  const before = raw.slice(0, s)
  const range = raw.slice(s, e)
  const after = raw.slice(e)
  if (!range.trim()) return raw

  // 선택이 정확히 토큰 하나면 옵션 병합
  const single = range.match(/^\{\{([^|{}]*)\|([^{}]*?)\}\}$/)
  if (single) {
    const merged = opt === 'clear' ? '' : mergeOpts(single[1], opt)
    return before + (merged ? `{{${merged}|${single[2]}}}` : single[2]) + after
  }
  const singleKw = range.match(/^\[\[([^\]]+)\]\]$/)
  if (singleKw) {
    if (opt === 'clear' || opt === 'kw') return before + singleKw[1] + after
    return before + `{{${mergeOpts('kw', opt)}|${singleKw[1]}}}` + after
  }

  const cleaned = unwrapAll(range)
  if (opt === 'clear') return before + cleaned + after
  if (opt === 'kw' && !/[,|{}[\]\n]/.test(cleaned)) return before + `[[${cleaned}]]` + after
  return before + `{{${opt}|${cleaned}}}` + after
}

/* 캔버스 인라인 에디터 (contentEditable) */
export function InlineEditor({ raw, onCommit }) {
  const ref = useRef(null)
  const doneRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = markupToHtml(raw)
    el.focus()
    // 커서를 끝으로
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)

    const commit = () => {
      if (doneRef.current || !ref.current) return
      doneRef.current = true
      onCommit(domToMarkup(ref.current))
    }
    // 포커스 이탈 또는 에디터/툴바 바깥 클릭 시 커밋
    const onFocusOut = () => commit()
    const onDocDown = (e) => {
      if (!el.contains(e.target) && !(e.target.closest && e.target.closest('.sb-seltb--canvas'))) commit()
    }
    el.addEventListener('focusout', onFocusOut)
    document.addEventListener('pointerdown', onDocDown, true)
    return () => {
      el.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('pointerdown', onDocDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commitNow = () => {
    if (doneRef.current || !ref.current) return
    doneRef.current = true
    onCommit(domToMarkup(ref.current))
  }

  return (
    <span
      id="sb-inline-editor"
      ref={ref}
      className="sb-inline-editor"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); commitNow() }
      }}
    />
  )
}
