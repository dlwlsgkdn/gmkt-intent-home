import { useRef, useState } from 'react'

/*
 * Undo/Redo — 무엇을 스냅샷할지는 호출부가 정하고, 이 훅은 스택만 관리한다.
 *
 * takeSnapshot/applySnapshot을 주입받으므로 스냅샷 대상이 늘어도(예: 시나리오 필드 추가)
 * 여기는 손대지 않는다. 연속 편집은 mergeMs 안에서 한 단계로 합쳐 ⌘Z 한 번에
 * "글자 한 자"가 아니라 "한 동작"이 되돌려지게 한다.
 */
export function useBuilderHistory({ takeSnapshot, applySnapshot, enabled = true, mergeMs = 500, limit = 60 }) {
  const stackRef = useRef({ past: [], future: [], lastPush: 0 })
  const [, bump] = useState(0) // 버튼 활성화 상태를 갱신하기 위한 렌더 신호

  const push = () => {
    const stack = stackRef.current
    const now = Date.now()
    if (now - stack.lastPush < mergeMs) return
    stack.past.push(takeSnapshot())
    if (stack.past.length > limit) stack.past.shift()
    stack.future = []
    stack.lastPush = now
    bump((v) => v + 1)
  }

  const step = (from, to) => {
    if (!enabled) return
    const stack = stackRef.current
    const snapshot = stack[from].pop()
    if (!snapshot) return
    stack[to].push(takeSnapshot())
    stack.lastPush = 0 // 되돌린 직후의 편집은 병합하지 않는다
    bump((v) => v + 1)
    applySnapshot(snapshot)
  }

  return {
    pushHistory: push,
    undo: () => step('past', 'future'),
    redo: () => step('future', 'past'),
    canUndo: stackRef.current.past.length > 0,
    canRedo: stackRef.current.future.length > 0,
  }
}
