import { useEffect } from 'react'

/*
 * 키보드 단축키 — "어떤 키가 어떤 동작인가"만 안다. 동작 자체는 전부 주입받는다.
 *
 * 입력 중(input/textarea/contenteditable)에는 아무것도 가로채지 않는다. 이게 빠지면
 * 텍스트 편집 중 ⌘C가 컴포넌트 복사로 새어 나가거나 Backspace가 컴포넌트를 지운다.
 */
export function useBuilderShortcuts({ enabled, actions }) {
  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (event) => {
      if (event.target.closest && event.target.closest('input, textarea, select, [contenteditable]')) return
      const meta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (meta) {
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) actions.redo()
          else actions.undo()
          return
        }
        if (key === 'a') {
          event.preventDefault()
          actions.selectAll()
          return
        }
        if (key === 'd' && actions.hasSelection()) {
          event.preventDefault()
          actions.duplicate()
          return
        }
        if (key === 'c') {
          if (actions.copy()) event.preventDefault()
          return
        }
        if (key === 'x') {
          if (actions.copy()) {
            event.preventDefault()
            actions.remove()
          }
          return
        }
        if (key === 'v') {
          if (actions.canPaste()) {
            event.preventDefault()
            actions.paste()
          }
          return
        }
        if (event.key === '=' || event.key === '+') {
          event.preventDefault()
          actions.zoomIn()
          return
        }
        if (event.key === '-') {
          event.preventDefault()
          actions.zoomOut()
          return
        }
        if (event.key === '0') {
          event.preventDefault()
          actions.zoomReset()
          return
        }
      }

      if (event.key === 'Escape' && actions.closeContextMenu()) return
      if (!actions.hasSelection()) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        actions.remove()
        return
      }
      if (event.key === 'Escape') {
        actions.clearSelection()
        return
      }
      // 방향키 = 선택 컴포넌트를 스택에서 한 칸 위/아래로
      const dir = { ArrowUp: -1, ArrowDown: 1 }[event.key]
      if (dir) {
        event.preventDefault()
        actions.moveOrder(dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
