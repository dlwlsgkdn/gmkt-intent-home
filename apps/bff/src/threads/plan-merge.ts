import type { PlanSectionWire } from '@ddak/schema'
import type { PlanSkeletonSectionGen } from '../llm/gen-schemas'

/*
 * 2단계 계획 병합 규칙 (§9-1) — 뼈대의 상품 "자리"를 상품 단계 결과로 채운다.
 * 스트리밍 인덱스와 최종 병합이 같은 규칙을 쓰므로, 부분 렌더와 result가 어긋나지 않는다:
 *   - 뼈대의 비상품 섹션은 뼈대 배열 인덱스를 그대로 쓴다
 *   - k번째 상품 섹션의 인덱스 = k번째 자리의 뼈대 인덱스, 자리보다 많으면 뼈대 길이 뒤에 덧붙인다
 *   - 자리가 채워지지 않으면(상품 단계 부족·실패) 그 자리는 최종에서 빠진다 (드문 경우 —
 *     이때만 result에서 뒤 섹션 인덱스가 한 칸 당겨진다)
 */

/** k번째(0부터) 상품 섹션이 스트리밍/병합에서 차지할 인덱스 */
export function productSectionIndex(slotIndexes: number[], skeletonLength: number, k: number): number {
  return k < slotIndexes.length ? slotIndexes[k] : skeletonLength + (k - slotIndexes.length)
}

/** 최종 병합 — 뼈대 섹션 순서를 유지하며 상품 자리를 순서대로 채운다. 남는 상품 섹션은 끝에 덧붙인다 */
export function mergePlanSections(
  skeleton: PlanSkeletonSectionGen[],
  products: PlanSectionWire[],
): PlanSectionWire[] {
  const sections: PlanSectionWire[] = []
  let next = 0
  for (const s of skeleton) {
    if (s.kind === 'products') {
      if (next < products.length) sections.push(products[next++])
      // 채울 상품이 없으면 자리 드롭 — 빈 상품 섹션을 보여주지 않는다
    } else {
      sections.push(s)
    }
  }
  while (next < products.length) sections.push(products[next++])
  return sections
}
