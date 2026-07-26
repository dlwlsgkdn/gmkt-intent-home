import React from 'react'
import CanvasItem from './CanvasItem.jsx'

/*
 * 캔버스 표면 — 배치된 컴포넌트와 드래그 보조선(스냅 가이드·삽입 캐럿·러버밴드)을 그린다.
 * 좌표 계산과 상태 변경은 전부 Builder(와 그 훅들) 소관이고, 여기는 받은 값을 그린다.
 */
export default function BuilderCanvas({
  canvasRef,
  canvasW,
  canvasHeight,
  zoom,
  canvasView,
  previewMode,
  items,
  displayItems,
  selectedIds,
  dropTargetId,
  dragPos,
  sizeDraft,
  guides,
  gateCharging,
  insertHint,
  marquee,
  heightsRef,
  renderCtx,
  onClearSelection,
  onCanvasPointerDown,
  onContextMenu,
  onPaletteDragOver,
  onPaletteDragLeave,
  onPaletteDrop,
  onItemMeasure,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onResize,
  onResizeEnd,
  onInspect,
}) {
  return (
    <main
      className="sb-canvas-wrap"
      onPointerDown={(event) => {
        if (!previewMode && event.target === event.currentTarget) onClearSelection()
      }}
    >
      <div className="sb-canvas-col" style={{ width: canvasW * zoom }}>
        <div className="sb-canvas-scale" style={{ width: canvasW * zoom, height: canvasHeight * zoom }}>
          <div
            ref={canvasRef}
            className={'sb-canvas' + (canvasView === 'preview' ? ' sb-canvas--preview' : ' sb-canvas--edit')}
            style={{ width: canvasW, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
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
                <span>추가한 컴포넌트는 마우스로 끌어 배치할 수 있어요.</span>
              </div>
            )}
            {guides.map((guide, index) => (
              <div
                key={index}
                className={'sb-guide sb-guide--' + guide.type}
                style={guide.type === 'v' ? { left: guide.pos } : { top: guide.pos }}
              />
            ))}
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
            {marquee && (
              <div
                className="sb-marquee"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
            {displayItems.filter((item) => !item.parentId).map((item) => (
              <CanvasItem
                key={item.id}
                item={item}
                editable={!previewMode}
                zoom={zoom}
                dropTarget={dropTargetId === item.id}
                gateChargeMs={gateCharging?.[item.id] || 0}
                selected={selectedIds.includes(item.id)}
                dragPos={dragPos && dragPos.positions[item.id] ? dragPos.positions[item.id] : null}
                sizeDraft={sizeDraft && sizeDraft.id === item.id ? sizeDraft : null}
                heightsRef={heightsRef}
                onMeasure={onItemMeasure}
                renderCtx={renderCtx}
                onSelect={onSelect}
                onDragStart={onDragStart}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                onResize={onResize}
                onResizeEnd={onResizeEnd}
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
