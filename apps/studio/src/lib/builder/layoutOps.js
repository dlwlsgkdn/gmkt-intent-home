import { alignItems, compactItems, resolveCollision } from '../layout.js'

/*
 * 레이아웃 연산 묶음.
 *
 * layout.js는 "겹침을 어떻게 푸는가"만 아는 순수 엔진이고, 여기는 그 엔진을
 * 이 캔버스의 설정(컴팩트 방향·캔버스 폭·측정 높이)에 묶어 주는 얇은 층이다.
 * 모든 배치 커밋은 settle()을 통과하므로, 커밋 규칙이 바뀌면 여기만 고치면 된다.
 *
 * 자식(parentId 있는 아이템)은 캔버스 절대배치 대상이 아니므로 모든 연산에서 제외되고
 * 그대로 통과한다 — withTopOnly가 그 경계를 지킨다.
 */
export function createLayoutOps({ heightsRef, compactType, canvasW }) {
  const compactOn = compactType !== 'none'
  const options = (pinnedIds = []) => ({ direction: compactType, pinnedIds, canvasW })

  /* 레이아웃 연산(fn)을 최상위 아이템에만 적용하고 자식은 그대로 통과 */
  const withTopOnly = (list, fn) => {
    const top = list.filter((item) => !item.parentId)
    const children = list.filter((item) => item.parentId)
    return [...fn(top), ...children]
  }

  /* 겹침 해소 후 컴팩트 — 모든 배치 커밋이 통과하는 관문 */
  const settle = (list, movedIds) =>
    withTopOnly(list, (top) => {
      const resolved = resolveCollision(top, movedIds, heightsRef.current)
      return compactOn ? compactItems(resolved, heightsRef.current, options()) : resolved
    })

  /* 겹침은 이미 없다고 보고 빈틈만 메운다 (삭제·추가 직후) */
  const compact = (list, pinnedIds) =>
    withTopOnly(list, (top) => (compactOn ? compactItems(top, heightsRef.current, options(pinnedIds)) : top))

  /* 지정한 방향으로 강제 컴팩트 — 컴팩트 방향을 바꿀 때 한 번 적용 */
  const compactTo = (list, direction) =>
    withTopOnly(list, (top) => compactItems(top, heightsRef.current, { direction, canvasW }))

  const align = (list, ids, mode) =>
    withTopOnly(list, (top) => {
      const aligned = alignItems(top, ids, mode, { canvasW }, heightsRef.current)
      return compactOn ? compactItems(aligned, heightsRef.current, options()) : aligned
    })

  return { compactOn, options, withTopOnly, settle, compact, compactTo, align }
}
