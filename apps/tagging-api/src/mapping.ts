/*
 * 문서(Mongo) ↔ 태깅 단위(화면) 변환. 순수 함수만 둔다 — Nest·Mongo를 모르게 해서
 * 테스트가 쉽고, 되쓰기 화이트리스트가 이 파일 하나에만 있게 하려는 것이다.
 */
export type FieldKey = 'category' | 'subtype' | 'area' | 'type' | 'concern' | 'result' | 'condition'
export type Field = { selected: string[]; rep: string | null; status: 'done' | 'unreviewed' | 'fix'; origin: 'ai' | 'human' }

/* 화면 필드 → 문서 필드. scalar는 값 하나(문서에 배열이 아니다), list는 배열+대표. */
type Slot = { scalar?: string; list?: string; primary?: string }
export const FIELD_SLOTS: Record<FieldKey, Slot> = {
  category: { scalar: 'inferred_category' },
  subtype: { scalar: 'sub_type' },
  area: { scalar: 'body_part' },
  type: { list: 'skin_types', primary: 'skin_types_primary' },
  concern: { list: 'concerns', primary: 'concerns_primary' },
  result: { list: 'results', primary: 'results_primary' },
  condition: { list: 'conditions', primary: 'conditions_primary' },
}
export const FIELD_KEYS = Object.keys(FIELD_SLOTS) as FieldKey[]

/* 문서엔 등급 하나뿐이다. 화면의 확신도 바가 0~100을 받으므로 환산해 보낸다. */
const CONFIDENCE_PCT: Record<string, number> = { high: 90, medium: 70, low: 45 }

const asList = (doc: any, slot: Slot): string[] => {
  if (slot.list) return Array.isArray(doc[slot.list]) ? doc[slot.list].filter((v: unknown) => typeof v === 'string') : []
  const v = doc[slot.scalar!]
  return typeof v === 'string' && v ? [v] : []
}

const repOf = (doc: any, slot: Slot, selected: string[]): string | null => {
  if (selected.length === 1) return selected[0]
  const primary = slot.primary ? doc[slot.primary] : null
  return typeof primary === 'string' && selected.includes(primary) ? primary : null
}

const reviewText = (doc: any): string => {
  const features = doc.review_ai_summary?.features
  const lines = Array.isArray(features)
    ? features.map((f: any) => `${f.title} — ${f.description}`)
    : []
  const stats = doc.review_stats
  if (stats?.count) lines.push(`리뷰 ${Number(stats.count).toLocaleString('ko-KR')}건 · 평점 ${stats.avg_rating}`)
  return lines.join('\n')
}

export function toUnit(doc: any) {
  const meta = doc.review_meta || {}
  const reviewed = doc.review_status === 'reviewed' || doc.review_status === 'auto_ok'
  const fields = {} as Record<FieldKey, Field>
  const aiFields = {} as Record<FieldKey, Field>
  for (const key of FIELD_KEYS) {
    const slot = FIELD_SLOTS[key]
    const selected = asList(doc, slot)
    fields[key] = {
      selected,
      rep: repOf(doc, slot, selected),
      status: meta.fieldStatus?.[key] || (reviewed ? 'done' : 'unreviewed'),
      origin: meta.fieldOrigin?.[key] === 'human' ? 'human' : 'ai',
    }
    const snapshot = meta.aiOriginal?.[key]
    aiFields[key] = snapshot
      ? { selected: [...(snapshot.selected || [])], rep: snapshot.rep ?? null, status: 'unreviewed', origin: 'ai' }
      : { ...fields[key], status: 'unreviewed', origin: 'ai', selected: [...selected] }
  }
  return {
    id: doc.product_id,
    brand: doc.brand || doc.inferred_brand || '',
    name: doc.name || '',
    option: doc.options?.length ? `옵션 ${doc.options.length}개` : '단일 옵션',
    price: typeof doc.price === 'number' ? doc.price : null,
    imageUrl: doc.image_url || null,
    url: doc.url || null,
    catalogTags: [doc.sub_type, doc.formulation, ...(doc.ingredient_tags || [])]
      .filter((v: unknown): v is string => typeof v === 'string' && !!v)
      .filter((v, i, all) => all.indexOf(v) === i)
      .slice(0, 5),
    copy: doc.product_info?.['제품 주요 사양'] || doc.usage_method || '',
    review: reviewText(doc),
    confidence: CONFIDENCE_PCT[doc.confidence] ?? 0,
    confidenceLevel: doc.confidence || null,
    rationale: doc.rationale || '',
    decision: doc.review_status === 'reviewed' ? 'approved' : doc.review_status === 'needs_fix' ? 'rejected' : null,
    note: meta.note || '',
    tagRequest: meta.tagRequest || {},
    fields,
    aiFields,
  }
}
