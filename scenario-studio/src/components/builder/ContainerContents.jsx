import React, { useEffect, useMemo, useState } from 'react'
import { LIBRARY } from '../../lib/registry.jsx'

const summaryOf = (item) =>
  String(
    item.props?.title ||
    item.props?.question ||
    item.props?.text ||
    item.props?.name ||
    item.props?.body ||
    item.props?.caption ||
    ''
  ).replace(/\s+/g, ' ').trim()

const FLOW_LABELS = {
  x: '가로 순서',
  y: '세로 순서',
  grid: '그리드 순서',
}

/* 선택한 컨테이너의 자식을 캔버스 크기와 무관하게 한눈에 관리하는 편집 전용 패널 */
export default function ContainerContents({
  container,
  children,
  selectedId,
  onSelect,
  onSelectContainer,
  onMove,
  onUpdate,
  onDuplicate,
  onRemove,
  onUnnest,
}) {
  const [query, setQuery] = useState('')

  useEffect(() => setQuery(''), [container.id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return children
    return children.filter((item) => {
      const def = LIBRARY[item.type]
      return `${def?.label || ''} ${summaryOf(item)}`.toLowerCase().includes(q)
    })
  }, [children, query])

  const flow = FLOW_LABELS[LIBRARY[container.type]?.flow] || '슬롯 순서'

  return (
    <section className="sb-container-contents" aria-label={`${LIBRARY[container.type]?.label || '레이아웃'} 내부 컴포넌트`}>
      <div className="sb-container-contents__head">
        <button type="button" className="sb-container-contents__parent" onClick={onSelectContainer}>
          <span>{LIBRARY[container.type]?.icon}</span>
          <span>
            <strong>{LIBRARY[container.type]?.label}</strong>
            <small>{flow} · 내부 컴포넌트 {children.length}개</small>
          </span>
        </button>
        <span className="sb-container-contents__mode">편집 전용 전체 보기</span>
      </div>

      {children.length >= 6 && (
        <input
          type="search"
          className="sb-container-contents__search"
          placeholder="내부 컴포넌트 검색…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {children.length === 0 ? (
        <div className="sb-container-contents__empty">
          아직 내부 컴포넌트가 없어요. 컨테이너를 선택한 채 팔레트에서 컴포넌트를 추가하세요.
        </div>
      ) : filtered.length === 0 ? (
        <div className="sb-container-contents__empty">“{query}”와 일치하는 컴포넌트가 없어요.</div>
      ) : (
        <div className="sb-container-contents__list">
          {filtered.map((item) => {
            const index = children.findIndex((child) => child.id === item.id)
            const def = LIBRARY[item.type]
            return (
              <div
                key={item.id}
                className={
                  'sb-container-entry' +
                  (selectedId === item.id ? ' sb-container-entry--selected' : '') +
                  (item.hidden ? ' sb-container-entry--hidden' : '')
                }
              >
                <button type="button" className="sb-container-entry__main" onClick={() => onSelect(item.id)}>
                  <span className="sb-container-entry__index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="sb-container-entry__icon">{def?.icon}</span>
                  <span className="sb-container-entry__text">
                    <strong>{def?.label || item.type}</strong>
                    <small>{summaryOf(item) || '내용 미입력'}</small>
                  </span>
                  <span className="sb-container-entry__size">{item.w || '자동'} × {item.h || '자동'}</span>
                </button>
                <div className="sb-container-entry__actions">
                  <button type="button" disabled={index <= 0} title="앞으로 이동" onClick={() => onMove(item.id, -1)}>←</button>
                  <button type="button" disabled={index >= children.length - 1} title="뒤로 이동" onClick={() => onMove(item.id, 1)}>→</button>
                  <button type="button" className={item.locked ? 'is-on' : ''} title={item.locked ? '잠금 해제' : '잠금'} onClick={() => onUpdate(item.id, { locked: !item.locked })}>{item.locked ? '🔒' : '🔓'}</button>
                  <button type="button" className={item.hidden ? 'is-on' : ''} title={item.hidden ? '보이기' : '숨기기'} onClick={() => onUpdate(item.id, { hidden: !item.hidden })}>{item.hidden ? '🚫' : '👁'}</button>
                  <button type="button" title="복제" onClick={() => onDuplicate(item.id)}>＋</button>
                  <button type="button" title="컨테이너에서 꺼내기" onClick={() => onUnnest(item.id)}>⤴</button>
                  <button type="button" className="is-danger" title="삭제" onClick={() => onRemove(item.id)}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
