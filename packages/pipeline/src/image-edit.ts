import type { LookSpec, LookTone } from '@ddak/schema'

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
 * (identity drift) — 뷰티 트라이온에서는 그게 곧 실패다. 그래서 동일성 보존을 구체적으로 못 박고,
 * 보정(피부 매끈하게·얼굴 갸름하게)도 명시로 금지한다. 영어로 쓰는 이유는 이미지 모델의
 * 지시 준수율이 영어에서 안정적이기 때문이고, 사용자에게 보이는 문구는 아니다.
 *
 * **사양(spec)이 있으면 지시문을 사양에서 생성한다** (2026-09): 옛 방식은 고정 풀글램 템플릿 뒤에 한국어
 * 포인트를 덧붙여, 룩이 "틴트 그라데이션"이어도 템플릿의 "never a sheer tint"가 이겼다 — 어떤 룩을 골라도
 * 같은 글램이 나왔다. 지금은 부위별 사양(색 hex·마감·기법·위치·강도)을 영어 지시로 풀고, 강도(intensity)는
 * "무엇을"이 아니라 "얼마나"만 정하는 수식어다. 사양이 없는 옛 페이지·호출은 아래 풀글램 템플릿을 그대로 쓴다.
 */

const LIP_FINISH: Record<LookSpec['lip']['finish'], string> = {
  matte: 'matte, fully opaque',
  velvet: 'soft-matte velvet, opaque',
  glossy: 'glossy, high-shine',
  tint: 'sheer, juicy tint that stains the lips (translucent but clearly colored)',
}
const LIP_TECHNIQUE: Record<LookSpec['lip']['technique'], string> = {
  full: 'applied evenly over the whole lip with a clean, defined lip line',
  gradient: 'concentrated at the inner center of the lips and fading softly toward the edges (Korean gradient lip)',
  overlined: 'slightly overlined beyond the natural lip line for extra fullness, with crisp edges',
}
const CHEEK_STRENGTH: Record<LookSpec['cheek']['strength'], string> = {
  light: 'a light, sheer wash of',
  medium: 'a clearly visible',
  strong: 'a strong, heavily pigmented',
}
const CHEEK_PLACEMENT: Record<LookSpec['cheek']['placement'], string> = {
  apples: 'the apples of the cheeks',
  cheekbones: 'the cheekbones, swept upward',
  drape: 'the cheekbones extending up toward the temples (draping)',
}
const LINER: Record<LookSpec['eye']['liner'], string> = {
  none: 'no eyeliner',
  thin: 'a thin dark eyeliner tight along the upper lash line',
  winged: 'a sharp winged eyeliner along the upper lash line, flicked out and up at the outer corner',
}
const LASHES: Record<LookSpec['eye']['lashes'], string> = {
  natural: 'natural-looking mascara',
  volume: 'thick, dark, volumized lashes (false-lash effect)',
}
const BROW: Record<LookSpec['eye']['brow'], string> = {
  natural: 'brows left natural',
  defined: 'brows clearly defined and filled in',
}
const BASE_FINISH: Record<LookSpec['base']['finish'], string> = {
  matte: 'matte',
  'semi-matte': 'semi-matte',
  dewy: 'dewy, luminous',
}
const COVERAGE: Record<LookSpec['base']['coverage'], string> = {
  light: 'light-coverage',
  medium: 'medium-coverage',
  full: 'full-coverage',
}

const HAIR_STYLE: Record<NonNullable<LookSpec['hair']>['style'], string> = {
  keep: '',
  straight: 'sleek straight hair',
  wavy: 'soft loose waves',
  curly: 'defined curls',
  updo: 'an elegant updo',
  ponytail: 'a clean ponytail',
}
const HAIR_LENGTH: Record<NonNullable<LookSpec['hair']>['length'], string> = {
  keep: '',
  short: 'short (chin-length or above)',
  medium: 'medium (shoulder-length)',
  long: 'long (past the shoulders)',
}
const HAIR_BANGS: Record<NonNullable<LookSpec['hair']>['bangs'], string> = {
  keep: '',
  none: 'no bangs, forehead open',
  'see-through': 'light see-through bangs',
  full: 'full bangs',
}
const OUTFIT_TOP: Record<NonNullable<LookSpec['outfit']>['top'], string> = {
  keep: '',
  tee: 't-shirt',
  shirt: 'button-up shirt',
  blouse: 'blouse',
  knit: 'knit top',
  jacket: 'jacket over a simple top',
  dress: 'dress',
}
const OUTFIT_FIT: Record<NonNullable<LookSpec['outfit']>['fit'], string> = {
  regular: 'regular fit',
  oversized: 'relaxed, oversized fit',
  fitted: 'fitted silhouette',
}
const OUTFIT_NECKLINE: Record<NonNullable<LookSpec['outfit']>['neckline'], string> = {
  keep: '',
  crew: 'crew neckline',
  v: 'V-neckline',
  collar: 'collared neckline',
  'off-shoulder': 'off-shoulder neckline',
}

/** 헤어 지시 한 줄 — 'keep' 요소는 건드리지 않는다고 명시. 전부 keep 이면 빈 문자열 */
function hairPhrase(hair: NonNullable<LookSpec['hair']>): string {
  const changes: string[] = []
  if (hair.style !== 'keep') changes.push(HAIR_STYLE[hair.style])
  if (hair.length !== 'keep') changes.push(`${HAIR_LENGTH[hair.length]} length`)
  if (hair.color !== 'keep') changes.push(`hair color ${hair.color}`)
  if (hair.bangs !== 'keep') changes.push(HAIR_BANGS[hair.bangs])
  if (!changes.length) return ''
  return `- Hair: restyle the hair to ${changes.join(', ')}; keep the hairline, head shape and face framing natural. Everything not listed stays as in the photo.`
}

/** 옷차림 지시 한 줄 — 상의만 바꾼다. 전부 keep 이면 빈 문자열 */
function outfitPhrase(outfit: NonNullable<LookSpec['outfit']>): string {
  const changes: string[] = []
  if (outfit.top !== 'keep') changes.push(`a ${OUTFIT_FIT[outfit.fit]} ${OUTFIT_TOP[outfit.top]}`)
  if (outfit.color !== 'keep') changes.push(`in ${outfit.color}`)
  if (outfit.neckline !== 'keep') changes.push(`with a ${OUTFIT_NECKLINE[outfit.neckline]}`)
  if (!changes.length) return ''
  return `- Outfit: change only the clothing on the upper body to ${changes.join(' ')}; keep the body shape, pose, skin and background exactly as they are.`
}

function shadowPhrase(shadow: string[]): string {
  const [a, b, c] = shadow
  if (!a) return 'no eyeshadow — clean, bare eyelids'
  let text = `eyeshadow in ${a} washed over the lid`
  if (b) text += `, deepening to ${b} at the outer corner and crease`
  if (c) text += `, with ${c} as an inner-corner highlight`
  return text
}

/** 사양 → 지시문. 순서가 곧 무게다: 무엇을 바르는지가 먼저, 보존 규칙은 뒤에 짧게 */
function specPrompt(spec: LookSpec, color: string, title?: string): string {
  const glam = spec.intensity === 'glam'
  const lines = [
    glam
      ? `Apply bold, high-impact ${color} makeup to the person in this photo, following this exact specification. Every listed element must be clearly visible when compared side by side with the original.`
      : `Apply polished, clearly visible ${color} makeup to the person in this photo, following this exact specification. Every listed element must be visible when compared side by side with the original.`,
    '',
    'Makeup specification:',
    `- Lips: ${LIP_FINISH[spec.lip.finish]} lipstick in ${spec.lip.color} (${color} family), ${LIP_TECHNIQUE[spec.lip.technique]}.`,
    `- Cheeks: ${CHEEK_STRENGTH[spec.cheek.strength]} blush in ${spec.cheek.color} on ${CHEEK_PLACEMENT[spec.cheek.placement]}, blended only at the edges.`,
    `- Eyes: ${shadowPhrase(spec.eye.shadow)}; ${LINER[spec.eye.liner]}; ${LASHES[spec.eye.lashes]}; ${BROW[spec.eye.brow]}.`,
    `- Base: ${COVERAGE[spec.base.coverage]} complexion makeup with a ${BASE_FINISH[spec.base.finish]} finish` +
      (spec.base.contour ? ', soft contour under the cheekbones' : '') +
      (spec.base.highlight ? ', highlighter on the cheekbones and nose bridge' : '') +
      '.',
    glam
      ? '- Overall intensity: high — evening / editorial level, about twice as strong as everyday makeup. The before/after difference must be unmistakable side by side; if in doubt, apply more pigment, never less.'
      : '- Overall intensity: medium — refined everyday makeup that still reads clearly as makeup next to the original, never a bare-face look.',
    '- Apply only what is listed: no extra eyeshadow, eyeliner, contour or highlighter beyond this specification.',
  ]
  // 범위(scope) — 헤어·옷은 사양에 있을 때만 바꾸고, 그렇지 않으면 보존 목록에 남긴다
  const hairLine = spec.hair ? hairPhrase(spec.hair) : ''
  const outfitLine = spec.outfit ? outfitPhrase(spec.outfit) : ''
  if (hairLine || outfitLine) {
    lines.push('', 'Styling beyond makeup:')
    if (hairLine) lines.push(hairLine)
    if (outfitLine) lines.push(outfitLine)
  }
  const keepList = ['pose', 'camera angle', 'lighting', 'background']
  if (!hairLine) keepList.unshift('hair')
  if (!outfitLine) keepList.splice(hairLine ? 0 : 1, 0, 'clothing')
  lines.push(
    '',
    `Keep exactly: the same person — identical facial features, face shape, eyes, nose, jawline, skin texture, moles and freckles; ${keepList.join(', ')} unchanged. Do not slim, reshape, smooth or beautify the face itself — only apply the changes above.`,
    '',
    'Style: photorealistic on real skin and real fabric, not a filter or illustration.',
    'Keep the original framing and aspect ratio.',
  )
  if (title) lines.push('', `Look name (for reference only): ${title}`)
  return lines.join('\n')
}

export function buildLookRenderPrompt(input: {
  tone: LookTone
  title?: string
  points?: string[]
  /** 룩 사양 — 있으면 지시문을 사양에서 생성한다 (계획 look 섹션의 spec) */
  spec?: LookSpec | null
}): string {
  const color = LOOK_TONE_PROMPT[input.tone] ?? 'natural'
  if (input.spec) return specPrompt(input.spec, color, input.title)

  /* 사양 없는 옛 경로 — 풀글램 템플릿 + 한국어 포인트 (2026-09 이전 페이지·호출 호환) */
  const detail = (input.points ?? []).filter(Boolean).slice(0, 4)
  const lines = [
    `Apply dramatic, high-impact, full-glam ${color} makeup to the person in this photo — heavy evening/editorial-level makeup that is unmistakable at first glance and far stronger than everyday makeup.`,
    '',
    'Preserve exactly (most important):',
    '- The same person — identical facial features, face shape, eyes, nose, jawline, skin texture, moles and freckles.',
    '- Hair, clothing, pose, camera angle, lighting and background, unchanged.',
    '- Do not slim, reshape, smooth away skin texture, retouch or beautify the face itself — only add makeup on top of it.',
    '',
    'Change only the makeup:',
    `- Lips: deep, highly saturated, fully opaque ${color} lipstick with a crisp, sharply defined lip line, slightly overlined for fullness — full coverage, never a sheer tint or stain.`,
    `- Cheeks: heavy, strongly pigmented blush in the ${color} family, clearly visible even from a distance on the apples and cheekbones, blended only at the edges.`,
    '- Eyes: full eye makeup — gradient or smoky eyeshadow in the same color family built up to the crease, sharp winged eyeliner, thick dark volumized lashes (dramatic mascara / false-lash effect) and strongly defined, filled-in brows.',
    '- Base: flawless full-coverage complexion makeup with soft contour under the cheekbones and highlighter on the cheekbones and nose bridge, while the natural skin texture stays visible.',
    '- Intensity: very high — at least twice as intense as typical daily makeup. The before/after difference must be unmistakable side by side. If in doubt, apply more pigment and more coverage, never less.',
  ]
  if (detail.length) lines.push(...detail.map((d) => `- ${d}`))
  lines.push(
    '',
    'Style: full-glam, camera-ready editorial beauty-campaign makeup — vivid and dramatic, yet photorealistic on real skin. Not a filter or illustration.',
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
