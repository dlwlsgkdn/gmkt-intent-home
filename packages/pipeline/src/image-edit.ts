import type { LookTone } from '@ddak/schema'

/*
 * ImageEditPort — 이미지 편집 계층의 프로바이더 중립 계약.
 *
 * LlmPort와 나란한 자리지만 **다른 포트**다: 텍스트 생성(무슨 룩을 왜 고르는가)은 LlmPort가,
 * 픽셀 편집(그 룩을 실제로 발라 보여주기)은 여기가 맡는다. Anthropic API에는 이미지 생성·편집이
 * 없어서(입력으로 읽기만 한다) 구현체는 다른 프로바이더가 된다 — 1차 구현은 OpenAI
 * images.edits (apps/bff image-edit.service). 프로바이더가 바뀌어도 프롬프트·호출부는 그대로다.
 */

export type ImageEditRequest = {
  /** 원본 이미지 (base64 본문만 — data URL 접두는 벗겨서 넘긴다) */
  imageBase64: string
  /** image/png · image/jpeg 등 */
  mediaType: string
  prompt: string
}

export type ImageEditResult = {
  imageBase64: string
  mediaType: string
  meta: { model?: string; latencyMs?: number }
}

/** 편집 실패 — 호출자가 사용자 안내로 바꾼다 (LlmGenerationError와 같은 정책: 가짜로 때우지 않는다) */
export class ImageEditError extends Error {
  constructor(
    readonly code: 'image_not_configured' | 'image_refused' | 'image_failed',
    message: string,
    readonly retryable: boolean,
    /** 프로바이더가 준 원인 원문(요약) — 사용자 문구가 아니라 운영자·개발자가 읽는 자리다.
     * 키·조직 검증·모델 접근 같은 설정 문제는 이게 없으면 로그를 못 보는 환경에서 진단이 막힌다 */
    readonly detail?: string,
  ) {
    super(message)
  }
}

export interface ImageEditPort {
  edit(req: ImageEditRequest): Promise<ImageEditResult>
}

/** 룩 색조 → 편집 지시문에 쓸 색 이름 (화면 라벨은 FE가 따로 갖는다) */
export const LOOK_TONE_PROMPT: Record<LookTone, string> = {
  coral: 'coral',
  rose: 'rose pink',
  red: 'classic red',
  peach: 'peach',
  brown: 'warm brown',
  plum: 'plum',
}

/*
 * 편집 지시문 — 이 프롬프트의 목적 절반은 "무엇을 바르는가"이고 절반은 **"무엇을 바꾸지 않는가"** 다.
 * 자기회귀 이미지 모델은 얼굴을 다시 그리는 구조라 그냥 두면 미묘하게 다른 사람이 나온다
 * (identity drift) — 뷰티 트라이온에서는 그게 곧 실패다. 그래서 동일성 보존을 먼저·구체적으로 못
 * 박고, 보정(피부 매끈하게·얼굴 갸름하게)도 명시로 금지한다. 영어로 쓰는 이유는 이미지 모델의
 * 지시 준수율이 영어에서 안정적이기 때문이고, 사용자에게 보이는 문구는 아니다.
 *
 * 강도(intensity)의 기본값은 **strong** 이다(2026-09): "subtle·natural everyday" 로 쓰면 모델이 립 틴트
 * 정도로 끝내 비포/애프터 차이가 거의 안 보였다. 기본은 립 불투명 풀커버 · 치크 또렷 · 아이섀도+라이너+
 * 눈썹까지 한 벌의 진한 메이크업으로 지시하고, 얼굴 자체의 보정 금지는 그대로 둔다. 'natural' 은 옛
 * 문구를 남겨 둔 선택지다(요청 본문이 고를 수 있게 남김 — 지금 FE 는 보내지 않는다).
 */
export type LookIntensity = 'strong' | 'natural'

export function buildLookRenderPrompt(input: {
  tone: LookTone
  title?: string
  points?: string[]
  intensity?: LookIntensity
}): string {
  const color = LOOK_TONE_PROMPT[input.tone] ?? 'natural'
  const detail = (input.points ?? []).filter(Boolean).slice(0, 4)
  const strong = (input.intensity ?? 'strong') === 'strong'
  const lines = [
    strong
      ? `Apply bold, clearly visible, full-face ${color} makeup to the person in this photo — a finished, polished look that is obvious at first glance.`
      : `Apply realistic ${color} makeup to the person in this photo.`,
    '',
    'Preserve exactly (most important):',
    '- The same person — identical facial features, face shape, eyes, nose, jawline, skin texture, moles and freckles.',
    '- Hair, clothing, pose, camera angle, lighting and background, unchanged.',
    '- Do not slim, reshape, smooth away skin texture, retouch or beautify the face itself — only add makeup on top of it.',
    '',
    'Change only the makeup:',
  ]
  if (strong) {
    lines.push(
      `- Lips: rich, saturated, opaque ${color} lipstick with a crisp, defined lip line — full coverage, not a sheer tint or stain.`,
      `- Cheeks: strongly pigmented blush in the ${color} family, clearly visible on the cheekbones and blended only at the edges.`,
      '- Eyes: eyeshadow in the same color family with a defined eyeliner, visibly lengthened lashes (mascara) and well-groomed, filled-in brows.',
      '- Base: even, luminous complexion makeup that still keeps the natural skin texture.',
      '- Intensity: high. The makeup must read as a deliberate statement look, not a no-makeup look — if in doubt, apply more pigment, never less.',
    )
  } else {
    lines.push(`- Lip color in ${color}, blush on the cheeks in the same family, subtle and blended.`)
  }
  if (detail.length) lines.push(...detail.map((d) => `- ${d}`))
  lines.push(
    '',
    strong
      ? 'Style: glamorous, camera-ready makeup as seen in a beauty campaign — vivid, yet photorealistic on real skin. Not a filter or illustration.'
      : 'Style: natural everyday makeup a real person would wear. Photorealistic, not a filter or illustration.',
    'Keep the original framing and aspect ratio.',
  )
  if (input.title) lines.push('', `Look name (for reference only): ${input.title}`)
  return lines.join('\n')
}

/** data URL → { mediaType, base64 }. 형식이 아니면 null (계약이 막지만 방어적으로) */
export function parseDataUrl(dataUrl: string): { mediaType: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '')
  return match ? { mediaType: match[1], base64: match[2] } : null
}
