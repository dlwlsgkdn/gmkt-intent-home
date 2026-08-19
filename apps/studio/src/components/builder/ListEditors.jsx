import React from 'react'
import { splitTextList, joinTextList, splitOptions, joinOptions } from '../../lib/store.js'
import { parseCards, joinCards, parseTableRows, joinTableRows } from '../../lib/registry/support.jsx'

/*
 * 목록형 필드 GUI 편집기 — 인스펙터의 kind: 'options' | 'stringList' | 'cards' | 'table'.
 * 저장 형식은 기존 문자열("A|B|C" · 쉼표/줄바꿈 목록) 그대로 두고, 행 단위 UI로 편집한다.
 *
 * 공통 규칙:
 * - 빈 행은 직렬화에서 떨어지므로 로컬 상태로 유지한다 (입력 중인 새 행이 사라지지 않게)
 * - 외부 변경(undo·AI 반영)은 마지막으로 내보낸 문자열과 비교해 감지되면 다시 파싱한다
 * - "텍스트로 일괄 편집" 토글로 원문 구문 편집(서식 툴바 포함)을 항상 남겨 둔다
 */

/* kind별 행 스키마: pair = 첫 줄에 나란히, full = 아랫줄 전체 폭 */
const LIST_KINDS = {
  options: {
    columns: [
      { key: 'main', placeholder: '메인 문구' },
      { key: 'sub', placeholder: '서브 (선택)' },
      { key: 'desc', placeholder: '상세 설명 (선택)', full: true, textarea: true },
    ],
    parse: splitOptions,
    serialize: joinOptions,
    addLabel: '+ 선택지 추가',
    hint: <>한 줄에 하나씩 <code>메인|서브|상세 설명</code> — 줄바꿈 구분이면 상세 설명에 쉼표를 쓸 수 있어요.</>,
  },
  stringList: {
    columns: [{ key: 'text', placeholder: '항목 문구', full: true }],
    parse: (text) => splitTextList(text).map((line) => ({ text: line })),
    serialize: (rows) => joinTextList(rows.map((row) => row.text)),
    addLabel: '+ 항목 추가',
    hint: <>한 줄에 하나씩 — 줄바꿈 구분이면 항목 안에 쉼표를 쓸 수 있어요.</>,
  },
  cards: {
    columns: [
      { key: 'title', placeholder: '제목' },
      { key: 'sub', placeholder: '설명 (선택)' },
      { key: 'imageUrl', placeholder: '이미지 URL (선택)', full: true },
    ],
    parse: parseCards,
    serialize: joinCards,
    addLabel: '+ 카드 추가',
    hint: <>한 줄에 하나씩 <code>제목|설명|이미지URL</code> — 줄바꿈 구분이면 설명에 쉼표를 쓸 수 있어요.</>,
  },
}

const blankRow = (columns) => Object.fromEntries(columns.map((col) => [col.key, '']))
const rowHasContent = (row) => Object.values(row).some((v) => String(v || '').trim())

function EditorHead({ count, textMode, onToggle }) {
  return (
    <div className="sb-optlist__head">
      <span className="sb-optlist__count">{count}개</span>
      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={onToggle}>
        {textMode ? '목록으로 편집' : '텍스트로 일괄 편집'}
      </button>
    </div>
  )
}

function RowTools({ index, total, onMove, onRemove, removeTitle }) {
  return (
    <div className="sb-optlist__tools">
      <button type="button" title="위로" disabled={index === 0} onClick={() => onMove(index, -1)}>↑</button>
      <button type="button" title="아래로" disabled={index === total - 1} onClick={() => onMove(index, 1)}>↓</button>
      <button type="button" className="sb-optlist__remove" title={removeTitle} onClick={() => onRemove(index)}>✕</button>
    </div>
  )
}

export function ListFieldEditor({ kind, value, onChange, textFieldProps }) {
  const spec = LIST_KINDS[kind]
  const text = String(value ?? '')
  const [rows, setRows] = React.useState(() => spec.parse(text))
  const [textMode, setTextMode] = React.useState(false)
  const lastRef = React.useRef(text)
  // 같은 틱에 커밋이 두 번 일어나도(연속 조작) 이전 커밋을 잃지 않게 최신 행을 ref로 미러링
  const rowsRef = React.useRef(rows)
  rowsRef.current = rows

  React.useEffect(() => {
    if (text !== lastRef.current) {
      lastRef.current = text
      setRows(spec.parse(text))
    }
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => {
    rowsRef.current = next
    setRows(next)
    const serialized = spec.serialize(next)
    lastRef.current = serialized
    onChange(serialized)
  }
  const patchRow = (i, key, v) => commit(rowsRef.current.map((row, j) => (j === i ? { ...row, [key]: v } : row)))
  const moveRow = (i, dir) => {
    const j = i + dir
    const cur = rowsRef.current
    if (j < 0 || j >= cur.length) return
    const next = [...cur]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }

  if (textMode) {
    return (
      <div className="sb-optlist">
        <EditorHead count={rows.filter(rowHasContent).length} textMode onToggle={() => setTextMode(false)} />
        <textarea rows={5} value={text} onChange={(e) => onChange(e.target.value)} {...textFieldProps} />
        <p className="sb-optlist__hint">{spec.hint}</p>
      </div>
    )
  }

  const pairCols = spec.columns.filter((col) => !col.full)
  const fullCols = spec.columns.filter((col) => col.full)
  return (
    <div className="sb-optlist">
      <EditorHead count={rows.filter(rowHasContent).length} onToggle={() => setTextMode(true)} />
      {rows.map((row, i) => (
        <div key={i} className="sb-optlist__row">
          <div className="sb-optlist__inputs">
            {pairCols.length > 0 && (
              <div className="sb-optlist__pair" style={pairCols.length === 1 ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
                {pairCols.map((col) => (
                  <input
                    key={col.key}
                    type="text"
                    value={row[col.key] || ''}
                    placeholder={col.placeholder}
                    onChange={(e) => patchRow(i, col.key, e.target.value)}
                  />
                ))}
              </div>
            )}
            {fullCols.map((col) =>
              col.textarea ? (
                <textarea
                  key={col.key}
                  rows={row[col.key] ? 2 : 1}
                  value={row[col.key] || ''}
                  placeholder={col.placeholder}
                  onChange={(e) => patchRow(i, col.key, e.target.value.replace(/\n+/g, ' '))}
                />
              ) : (
                <input
                  key={col.key}
                  type="text"
                  value={row[col.key] || ''}
                  placeholder={col.placeholder}
                  onChange={(e) => patchRow(i, col.key, e.target.value)}
                />
              )
            )}
          </div>
          <RowTools
            index={i}
            total={rows.length}
            onMove={moveRow}
            onRemove={(idx) => commit(rowsRef.current.filter((_, j) => j !== idx))}
            removeTitle="행 삭제"
          />
        </div>
      ))}
      <button
        type="button"
        className="sb-btn sb-btn--ghost sb-btn--small sb-optlist__add"
        onClick={() => commit([...rowsRef.current, blankRow(spec.columns)])}
      >
        {spec.addLabel}
      </button>
    </div>
  )
}

/* ── 테이블 편집기 (kind: 'table') ──
   rows 필드가 headersKey의 헤더 원문("제품|용량|가격")까지 함께 편집한다.
   열 수 = 헤더 셀 수(없으면 행 중 최대 셀 수, 최소 1) */
export function TableFieldEditor({ value, headers, onChange, onChangeHeaders, textFieldProps, showHeaders = true }) {
  const rowsText = String(value ?? '')
  const headText = String(headers ?? '')
  // headersKey 없는 필드(예: 성분 비교표의 "왼쪽|항목|오른쪽")는 헤더 행 자체가 없다
  const parseHead = (t) => (showHeaders ? String(t || '').split('|').map((s) => s.trim()) : [])
  const [grid, setGrid] = React.useState(() => ({ head: parseHead(headText), body: parseTableRows(rowsText) }))
  const [textMode, setTextMode] = React.useState(false)
  const lastRef = React.useRef({ rows: rowsText, head: headText })
  // 같은 틱에 커밋이 두 번 일어나도(연속 조작) 이전 커밋을 잃지 않게 최신 그리드를 ref로 미러링
  const gridRef = React.useRef(grid)
  gridRef.current = grid

  React.useEffect(() => {
    if (rowsText !== lastRef.current.rows || headText !== lastRef.current.head) {
      lastRef.current = { rows: rowsText, head: headText }
      setGrid({ head: parseHead(headText), body: parseTableRows(rowsText) })
    }
  }, [rowsText, headText]) // eslint-disable-line react-hooks/exhaustive-deps

  const cols = Math.max(1, grid.head.length, ...grid.body.map((cells) => cells.length))
  const cellAt = (cells, ci) => cells[ci] ?? ''

  const commit = (next) => {
    gridRef.current = next
    setGrid(next)
    const serializedRows = joinTableRows(next.body)
    const serializedHead = next.head.map((s) => String(s || '').trim()).join('|')
    lastRef.current = { rows: serializedRows, head: serializedHead }
    if (serializedRows !== rowsText) onChange(serializedRows)
    if (showHeaders && serializedHead !== headText) onChangeHeaders(serializedHead)
  }
  // 셀 값에 구분자가 섞이지 않게 정리 (| = 셀 구분, 줄바꿈 = 행 구분)
  const clean = (v) => v.replace(/[|\n]+/g, ' ')
  const patchHead = (ci, v) => {
    const cur = gridRef.current
    commit({ ...cur, head: cur.head.map((c, j) => (j === ci ? clean(v) : c)) })
  }
  const patchCell = (ri, ci, v) => {
    const cur = gridRef.current
    commit({
      ...cur,
      body: cur.body.map((cells, r) => {
        if (r !== ri) return cells
        const next = [...cells]
        while (next.length <= ci) next.push('')
        next[ci] = clean(v)
        return next
      }),
    })
  }
  const moveRow = (ri, dir) => {
    const cur = gridRef.current
    const rj = ri + dir
    if (rj < 0 || rj >= cur.body.length) return
    const body = [...cur.body]
    ;[body[ri], body[rj]] = [body[rj], body[ri]]
    commit({ ...cur, body })
  }
  const addRow = () => commit({ ...gridRef.current, body: [...gridRef.current.body, Array(cols).fill('')] })
  const removeRow = (ri) => commit({ ...gridRef.current, body: gridRef.current.body.filter((_, r) => r !== ri) })
  const addCol = () => {
    const cur = gridRef.current
    commit({ head: [...cur.head, ''], body: cur.body.map((cells) => [...cells, '']) })
  }
  const removeCol = (ci) => {
    const cur = gridRef.current
    commit({
      head: cur.head.filter((_, j) => j !== ci),
      body: cur.body.map((cells) => cells.filter((_, j) => j !== ci)),
    })
  }

  if (textMode) {
    return (
      <div className="sb-optlist">
        <EditorHead count={grid.body.filter((cells) => cells.some((c) => String(c).trim())).length} textMode onToggle={() => setTextMode(false)} />
        {showHeaders && (
          <div className="sb-field" style={{ marginBottom: 0 }}>
            <input type="text" value={headText} placeholder="헤더 (| 구분)" onChange={(e) => onChangeHeaders(e.target.value)} />
          </div>
        )}
        <textarea rows={5} value={rowsText} onChange={(e) => onChange(e.target.value)} {...textFieldProps} />
        <p className="sb-optlist__hint">셀은 <code>|</code>, 행은 줄바꿈으로 구분 — 셀 안에 쉼표를 쓸 수 있어요.</p>
      </div>
    )
  }

  return (
    <div className="sb-optlist sb-tbledit">
      <EditorHead count={grid.body.filter((cells) => cells.some((c) => String(c).trim())).length} onToggle={() => setTextMode(true)} />
      <div className="sb-tbledit__grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr)) auto` }}>
        {/* 열 삭제 줄 */}
        {Array.from({ length: cols }, (_, ci) => (
          <button
            key={`colx${ci}`}
            type="button"
            className="sb-tbledit__colx"
            title="열 삭제"
            disabled={cols <= 1}
            onClick={() => removeCol(ci)}
          >
            ✕
          </button>
        ))}
        <span />
        {/* 헤더 행 — headersKey가 있는 필드만 */}
        {showHeaders && (
          <>
            {Array.from({ length: cols }, (_, ci) => (
              <input
                key={`h${ci}`}
                type="text"
                className="sb-tbledit__headcell"
                value={grid.head[ci] ?? ''}
                placeholder={`헤더 ${ci + 1}`}
                onChange={(e) => patchHead(ci, e.target.value)}
              />
            ))}
            <span />
          </>
        )}
        {/* 본문 행 */}
        {grid.body.map((cells, ri) => (
          <React.Fragment key={ri}>
            {Array.from({ length: cols }, (_, ci) => (
              <input
                key={ci}
                type="text"
                value={cellAt(cells, ci)}
                placeholder="셀"
                onChange={(e) => patchCell(ri, ci, e.target.value)}
              />
            ))}
            <RowTools index={ri} total={grid.body.length} onMove={moveRow} onRemove={removeRow} removeTitle="행 삭제" />
          </React.Fragment>
        ))}
      </div>
      <div className="sb-tbledit__actions">
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={addRow}>+ 행 추가</button>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={addCol}>+ 열 추가</button>
      </div>
    </div>
  )
}
