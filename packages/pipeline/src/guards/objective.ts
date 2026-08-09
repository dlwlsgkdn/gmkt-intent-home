/*
 * 0단계 목적어 가드 (전략 문서 STEP 0) — 범위 밖·막연한 발화는 LLM 호출 전에 되돌린다.
 * 규칙 기반 v0: 명백히 쓸 수 없는 입력만 보수적으로 거른다 (과차단이 더 나쁘다 —
 * 애매한 발화의 구체화는 1단계 의도 정규화·설문이 맡는다).
 */

export type ObjectiveCheck = { ok: true } | { ok: false; message: string }

/** 내용 문자(한글·영문·숫자)만 남긴 길이 */
const contentLength = (text: string) => (text.match(/[가-힣a-zA-Z0-9]/g) ?? []).length

const TOO_VAGUE_PATTERNS = [/^예뻐지고\s*싶/, /^추천\s*해?\s*줘?$/, /^뭐\s*(사|살까)/, /^아무거나/]

export function checkObjective(intent: string): ObjectiveCheck {
  const trimmed = intent.trim()
  if (contentLength(trimmed) < 2) {
    return { ok: false, message: '찾고 싶은 것을 조금 더 적어주세요 — 예: "여름 지속력 쿠션", "민감성 진정 토너".' }
  }
  if (TOO_VAGUE_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      ok: false,
      message: '조금 더 구체적으로 알려주시면 계획을 세울 수 있어요 — 예: "여름에 무너지지 않는 쿠션", "모공 커버 베이스".',
    }
  }
  return { ok: true }
}
