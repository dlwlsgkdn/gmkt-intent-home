import React from 'react'
import CanvasItem from './CanvasItem.jsx'

/*
 * 캔버스 표면 — 최상위 컴포넌트를 배열 순서대로 세로 스택으로 그리고,
 * 드래그 보조선(순서 삽입 라인·컨테이너 삽입 캐럿)을 얹는다.
 * 순서 계산과 상태 변경은 전부 Builder(와 그 훅들) 소관이고, 여기는 받은 값을 그린다.
 */
export default function BuilderCanvas({
  canvasRef,
  canvasW,
  zoom,
  canvasView,
  previewMode,
  items,
  selectedIds,
  dropTargetId,
  dragIds,
  insertHint,
  insertLine,
  renderCtx,
  onCanvasPointerDown,
  onContextMenu,
  onPaletteDragOver,
  onPaletteDragLeave,
  onPaletteDrop,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onInspect,
}) {
  return (
    <main className="sb-canvas-wrap">
      <div className="sb-canvas-col" style={{ width: canvasW * zoom }}>
        {/* 확대·축소는 transform이 아니라 CSS zoom — 문서 흐름 스택이라 레이아웃 크기에 반영돼야 한다 */}
        <div className="sb-canvas-scale" style={{ width: canvasW * zoom }}>
          <div
            ref={canvasRef}
            className={'sb-canvas' + (canvasView === 'preview' ? ' sb-canvas--preview' : ' sb-canvas--edit')}
            style={{ width: canvasW, zoom }}
            onPointerDown={previewMode ? undefined : onCanvasPointerDown}
            onContextMenu={previewMode ? undefined : (event) => {
              if (event.target === event.currentTarget) onContextMenu(event, null)
            }}
            onDragOver={onPaletteDragOver}
            onDragLeave={onPaletteDragLeave}
            onDrop={onPaletteDrop}
          >
            {items.length === 0 && (
              <div className="sb-canvas__empty">
                왼쪽 팔레트에서 컴포넌트를 누르거나 끌어다 놓으세요.<br />
                <span>추가한 컴포넌트는 끌어서 순서를 바꿀 수 있어요.</span>
              </div>
            )}
            {insertHint && (
              <div
                className={'sb-insert-line sb-insert-line--' + insertHint.dir}
                style={
                  insertHint.dir === 'v'
                    ? { left: insertHint.x, top: insertHint.y, height: insertHint.len }
                    : { left: insertHint.x, top: insertHint.y, width: insertHint.len }
                }
              />
            )}
            {insertLine && (
              <div
                className="sb-insert-line sb-insert-line--h"
                style={{ left: insertLine.x, top: insertLine.y, width: insertLine.len }}
              />
            )}
            {items.filter((item) => !item.parentId).map((item) => (
              <CanvasItem
                key={item.id}
                item={item}
                editable={!previewMode}
                dropTarget={dropTargetId === item.id}
                selected={selectedIds.includes(item.id)}
                dragging={!!dragIds && dragIds.includes(item.id)}
                renderCtx={renderCtx}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onInspect={onInspect}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
