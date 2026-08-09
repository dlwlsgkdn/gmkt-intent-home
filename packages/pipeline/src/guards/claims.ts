/*
 * 의학적 효능 단정 차단 (전략 문서 6단계 — "의학적 효능 단정 차단, 근거 없는 속성은 비워둔다").
 * 화장품 표시광고 관행상 단정적 의학 표현이 담긴 항목은 통째로 드롭한다 — 프롬프트로
 * 부탁하지 않고 목록과 대조한다. 패턴은 보수적으로 좁게 유지할 것: "트러블 케어" 같은
 * 통상 표현까지 걸면 오탐이 드롭 로그를 덮는다.
 */

export const MEDICAL_CLAIM_PATTERNS: readonly string[] = [
  '치료',
  '완치',
  '처방',
  '의학적 효능',
  '질병',
  '의약품',
  '항염 효과',
  '피부염',
]

/** 텍스트에서 첫 번째로 걸리는 의학 단정 표현 — 없으면 null */
export function findMedicalClaim(text: string): string | null {
  for (const pattern of MEDICAL_CLAIM_PATTERNS) {
    if (text.includes(pattern)) return pattern
  }
  return null
}
