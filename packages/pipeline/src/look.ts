import type { LookScope, LookSpec, LookTone, PlanSectionWire } from '@ddak/schema'
import type { PlanSkeletonSectionGen } from './schemas'

/*
 * 룩 사양(LookSpec)의 결정적 도우미 — 화면 포인트 파생·색 정규화·요약.
 * 사양 자체는 뼈대 LLM 이 답변에서 정하고(schemas.ts LookSpecGen), 소비는 두 렌더가 한다:
 * FE 기기 합성(apps/studio lib/makeupComposite.js)과 정밀 렌더 지시문(image-edit.ts).
 * 여기 규칙 중 화면 문구(lookPointsOf)는 FE livePage.js 가 거울로 갖는다 — 바꾸면 같이 맞출 것.
 */

/** 부위 라벨 — 화면 포인트 "립 — …" 의 머리 (헤어·옷은 범위에 들 때만 실린다) */
export const LOOK_PART_LABELS = { lip: '립', cheek: '치크', eye: '눈', base: '베이스', hair: '헤어', outfit: '옷' } as const

/** 범위가 그 부위를 포함하는가 — 누적: hair ⊃ makeup, outfit ⊃ hair */
export function scopeIncludes(scope: LookScope | undefined, part: 'hair' | 'outfit'): boolean {
  const s = scope ?? 'makeup'
  if (part === 'hair') return s === 'hair' || s === 'outfit'
  return s === 'outfit'
}

/** 'keep' 이면 keep, hex 면 정규화, 그 밖에는 keep (헤어 컬러·상의 색) */
function keepOrHex(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === 'keep') return 'keep'
  return normalizeHex(text) ?? 'keep'
}

/** 색조 계열의 기본 발색 — 사양의 hex 가 깨졌을 때의 대체값 (FE TONE_PAINT 와 같은 값) */
export const LOOK_TONE_COLORS: Record<LookTone, { lip: string; cheek: string }> = {
  coral: { lip: '#f4553a', cheek: '#ff8f6d' },
  rose: { lip: '#d94b73', cheek: '#f0879f' },
  red: { lip: '#c22232', cheek: '#e07a80' },
  peach: { lip: '#f4744f', cheek: '#ffa584' },
  brown: { lip: '#9c5a44', cheek: '#c98a71' },
  plum: { lip: '#8d3b74', cheek: '#b16f9e' },
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/

/** '#rrggbb' 로 정규화 — 형식이 아니면 null (LLM 이 'coral' 같은 이름을 쓸 수 있다) */
export function normalizeHex(value: unknown): string | null {
  const m = HEX_RE.exec(String(value ?? '').trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

/** 사양의 색을 검증·정규화한다 — 깨진 립·치크 색은 tone 기본색으로, 깨진 섀도 색은 버린다.
 *  와이어에 실리는 사양은 언제나 이 함수를 거친 값이라 소비자는 hex 형식을 믿어도 된다 */
export function sanitizeLookSpec(spec: LookSpec | null | undefined, tone: LookTone): LookSpec | undefined {
  if (!spec) return undefined
  const base = LOOK_TONE_COLORS[tone] ?? LOOK_TONE_COLORS.coral
  const scope: LookScope = spec.scope ?? 'makeup'
  const { hair, outfit, ...rest } = spec
  const out: LookSpec = {
    ...rest,
    scope,
    lip: { ...spec.lip, color: normalizeHex(spec.lip?.color) ?? base.lip, note: String(spec.lip?.note ?? '').trim() },
    cheek: { ...spec.cheek, color: normalizeHex(spec.cheek?.color) ?? base.cheek, note: String(spec.cheek?.note ?? '').trim() },
    eye: {
      ...spec.eye,
      shadow: (spec.eye?.shadow ?? []).map(normalizeHex).filter((c): c is string => !!c).slice(0, 3),
      note: String(spec.eye?.note ?? '').trim(),
    },
    base: { ...spec.base, note: String(spec.base?.note ?? '').trim() },
  }
  // 범위 밖 부위는 뗀다 — 범위 안인데 LLM 이 비웠으면 'keep' 사양(바꾸지 않음)을 세워 렌더가 안내를 못 잃게
  if (scopeIncludes(scope, 'hair')) {
    out.hair = {
      style: hair?.style ?? 'keep',
      length: hair?.length ?? 'keep',
      color: keepOrHex(hair?.color),
      bangs: hair?.bangs ?? 'keep',
      note: String(hair?.note ?? '').trim(),
    }
  }
  if (scopeIncludes(scope, 'outfit')) {
    out.outfit = {
      top: outfit?.top ?? 'keep',
      color: keepOrHex(outfit?.color),
      fit: outfit?.fit ?? 'regular',
      neckline: outfit?.neckline ?? 'keep',
      note: String(outfit?.note ?? '').trim(),
    }
  }
  return out
}

/** 룩 사양 → 화면 포인트 문구 (부위별 note 를 "라벨 — note" 로, note 가 빈 부위는 건너뛴다) */
export function lookPointsOf(spec: LookSpec | null | undefined): string[] {
  if (!spec) return []
  const parts: Array<[keyof typeof LOOK_PART_LABELS, string | undefined]> = [
    ['lip', spec.lip?.note],
    ['cheek', spec.cheek?.note],
    ['eye', spec.eye?.note],
    ['base', spec.base?.note],
    ['hair', scopeIncludes(spec.scope, 'hair') ? spec.hair?.note : ''],
    ['outfit', scopeIncludes(spec.scope, 'outfit') ? spec.outfit?.note : ''],
  ]
  return parts
    .map(([part, note]) => {
      const text = String(note ?? '').trim()
      return text ? `${LOOK_PART_LABELS[part]} — ${text}` : ''
    })
    .filter(Boolean)
}

/** 사양 한 줄 요약 (심사 프롬프트·운영 문서용) — 렌더가 실제로 받은 값을 사람이 읽는 형태로 */
export function lookSpecSummary(spec: LookSpec | null | undefined): string {
  if (!spec) return ''
  const shadow = spec.eye.shadow.length ? `섀도 ${spec.eye.shadow.join('/')}` : '섀도 없음'
  const lines = [
    `범위 ${spec.scope ?? 'makeup'}`,
    `강도 ${spec.intensity}`,
    `립 ${spec.lip.color} ${spec.lip.finish}·${spec.lip.technique}`,
    `치크 ${spec.cheek.color} ${spec.cheek.placement}·${spec.cheek.strength}`,
    `눈 ${shadow}·라이너 ${spec.eye.liner}·속눈썹 ${spec.eye.lashes}·눈썹 ${spec.eye.brow}`,
    `베이스 ${spec.base.finish}·${spec.base.coverage}${spec.base.contour ? '·컨투어' : ''}${spec.base.highlight ? '·하이라이트' : ''}`,
  ]
  if (spec.hair) lines.push(`헤어 ${spec.hair.style}·${spec.hair.length}·${spec.hair.color}·앞머리 ${spec.hair.bangs}`)
  if (spec.outfit) lines.push(`옷 ${spec.outfit.top}·${spec.outfit.color}·${spec.outfit.fit}·${spec.outfit.neckline}`)
  return lines.join(' · ')
}

/** 뼈대의 텍스트 섹션 → 와이어 섹션. 자리(products·contents)는 null — 검색 결과가 그 인덱스를 차지한다.
 * look 은 사양(spec)을 검증·정규화하고 화면 포인트(points)를 부위별 note 에서 파생한다 — 스트리밍 조각·
 * 조기 확정·최종 병합(guards/merge composePlanSections)·dry-run 이 전부 이 한 곳을 지나므로 어느 경로든
 * 같은 와이어가 나간다. (merge.ts 가 이 파일을 import 하므로 여기서는 merge 의 isSlotKind 를 쓰지 않는다 — 순환 방지) */
export function skeletonSectionWire(s: PlanSkeletonSectionGen): PlanSectionWire | null {
  if (s.kind === 'products' || s.kind === 'contents') return null
  if (s.kind === 'look') {
    const spec = sanitizeLookSpec(s.spec, s.tone)
    // 옛 생성물(사양 없이 points 만 있던 v22 이전)은 원문 포인트를 그대로 둔다
    const legacyPoints = (s as { points?: string[] }).points ?? []
    return {
      kind: 'look',
      title: s.title,
      desc: s.desc,
      tone: s.tone,
      points: spec ? lookPointsOf(spec) : legacyPoints,
      ...(spec ? { spec } : {}),
    }
  }
  return s as PlanSectionWire
}
