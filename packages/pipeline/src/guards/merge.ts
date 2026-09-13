import type { PlanSectionWire } from '@ddak/schema'
import type { PlanSkeletonSectionGen } from '../schemas'

/*
 * 2단계 계획 병합 규칙 (§9-1) — 뼈대의 상품/콘텐츠 "자리"를 검색 단계 결과로 채운다.
 * 스트리밍 인덱스와 최종 병합이 같은 규칙을 쓰므로, 부분 렌더와 result가 어긋나지 않는다:
 *   - 뼈대의 비자리 섹션은 뼈대 배열 인덱스를 그대로 쓴다
 *   - kind별로 k번째 검색 섹션의 인덱스 = 같은 kind k번째 자리의 뼈대 인덱스,
 *     자리보다 많으면 뼈대 길이 뒤에 도착 순서대로 덧붙인다
 *   - 자리가 채워지지 않으면(검색 단계 부족·실패) 그 자리는 최종에서 빠진다 (드문 경우 —
 *     이때만 result에서 뒤 섹션 인덱스가 한 칸 당겨진다)
 */

export type SlotKind = 'products' | 'contents'

export function isSlotKind(kind: string): kind is SlotKind {
  return kind === 'products' || kind === 'contents'
}

/** 뼈대에서 kind별 자리 인덱스 추출 */
export function slotIndexesOf(skeleton: PlanSkeletonSectionGen[]): Record<SlotKind, number[]> {
  const slots: Record<SlotKind, number[]> = { products: [], contents: [] }
  skeleton.forEach((s, i) => {
    if (isSlotKind(s.kind)) slots[s.kind].push(i)
  })
  return slots
}

/** 검색 단계 섹션의 스트리밍 인덱스 배정 — kind별 k번째는 k번째 자리, 자리 초과분은
 * 뼈대 길이 뒤에 도착 순서대로. 최종 병합(mergePlanSections)과 같은 규칙이다 */
export class GeneratedIndexAllocator {
  private readonly emitted: Record<SlotKind, number> = { products: 0, contents: 0 }
  private extras = 0

  constructor(
    private readonly slots: Record<SlotKind, number[]>,
    private readonly skeletonLength: number,
  ) {}

  next(kind: SlotKind): number {
    const k = this.emitted[kind]++
    const slotList = this.slots[kind]
    return k < slotList.length ? slotList[k] : this.skeletonLength + this.extras++
  }
}

/** 최종 병합 — 뼈대 섹션 순서를 유지하며 kind별 자리를 순서대로 채운다. 남는 검색 섹션은
 * 도착 순서 그대로 끝에 덧붙인다. 채울 게 없는 자리는 드롭(빈 섹션을 보여주지 않는다) */
export function mergePlanSections(
  skeleton: PlanSkeletonSectionGen[],
  generated: PlanSectionWire[],
): PlanSectionWire[] {
  const queues: Record<SlotKind, PlanSectionWire[]> = {
    products: generated.filter((s) => s.kind === 'products'),
    contents: generated.filter((s) => s.kind === 'contents'),
  }
  const sections: PlanSectionWire[] = []
  for (const s of skeleton) {
    if (isSlotKind(s.kind)) {
      const filled = queues[s.kind].shift()
      if (filled) sections.push(filled)
    } else {
      sections.push(s as PlanSectionWire)
    }
  }
  // 자리보다 많이 온 섹션 — 원 배열(도착) 순서를 보존해 덧붙인다
  const leftovers = new Set<PlanSectionWire>([...queues.products, ...queues.contents])
  for (const s of generated) if (leftovers.has(s)) sections.push(s)
  return sections
}

/** 상품이 min개 미만인 상품 섹션은 가장 가까운(앞 우선) 다른 상품 섹션에 합친다 — 카드 한 장짜리 가로 트랙을 없앤다
 * (2026-09 운영 기록: 상품 섹션의 23%가 1개짜리). 합칠 다른 상품 섹션이 없으면 그대로 둔다. 이름이 겹치는 상품은 한 번만 */
export function consolidateSmallProductSections(sections: PlanSectionWire[], min = 2): PlanSectionWire[] {
  const productIdx = sections.map((s, i) => (s.kind === 'products' ? i : -1)).filter((i) => i >= 0)
  if (productIdx.length < 2) return sections
  const out = [...sections]
  const removed = new Set<number>()
  for (const i of productIdx) {
    const s = out[i]
    if (s.kind !== 'products' || s.products.length >= min) continue
    const target = productIdx
      .filter((j) => j !== i && !removed.has(j))
      .sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b)[0]
    if (target === undefined) continue
    const t = out[target]
    if (t.kind !== 'products') continue
    const names = new Set(t.products.map((p) => p.name))
    out[target] = { ...t, products: [...t.products, ...s.products.filter((p) => !names.has(p.name))] }
    removed.add(i)
  }
  return removed.size ? out.filter((_, i) => !removed.has(i)) : sections
}
