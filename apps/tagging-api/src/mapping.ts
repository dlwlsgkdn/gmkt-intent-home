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

/* Python store.py의 _now()와 같은 형식이어야 한다 — 두 도구가 같은 필드를 쓴다. */
export const nowIso = () => `${new Date().toISOString().slice(0, 19)}+00:00`

/* Flask 대시보드와 공유하는 필드다. store.py set_review_status와 같은 규칙으로 쓴다. */
/* 사전(taxonomy) 문서: 메타 세 필드를 걷어내고 유효성(categories 존재)을 가른다.
   Mongo I/O를 모르는 순수 함수라 taxonomy.service.ts가 이 판정만 위임한다. */
export const TAXONOMY_META_KEYS = ['_id', '_rev', 'updated_at'] as const

export type SanitizedTaxonomy = {
  taxonomy: Record<string, unknown>
  rev: number | null
  updatedAt: string | null
}

export function sanitizeTaxonomyDoc(doc: unknown): SanitizedTaxonomy | null {
  if (!doc || typeof doc !== 'object') return null
  const record = doc as Record<string, unknown>
  if (!Array.isArray(record.categories) || record.categories.length === 0) return null
  const taxonomy: Record<string, unknown> = { ...record }
  for (const key of TAXONOMY_META_KEYS) delete taxonomy[key]
  const rev = typeof record._rev === 'number' ? record._rev : null
  const updatedAt = typeof record.updated_at === 'string' ? record.updated_at : null
  return { taxonomy, rev, updatedAt }
}

export function decisionToReview(decision: unknown) {
  if (decision === 'approved') return { review_status: 'reviewed', reviewed_at: nowIso() }
  if (decision === 'rejected') return { review_status: 'needs_fix', reviewed_at: null }
  return { review_status: 'unreviewed', reviewed_at: null }
}

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
        .filter((v, i, all) => all.indexOf(v) === i)
    : []

/* tagRequest는 FIELD_KEYS 밖 키를 허용하지 않고 값은 boolean으로 강제한다 — FE
   loadTaggingReview가 로컬 저장분을 걸러 읽는 것과 같은 수준. 화이트리스트 안이라
   파이프라인 필드를 덮을 위험은 없지만, 임의 키·값이 문서에 그대로 쌓이는 것은 막는다. */
const sanitizeTagRequest = (value: Record<string, unknown>): Record<string, boolean> => {
  const out: Record<string, boolean> = {}
  for (const key of FIELD_KEYS) {
    if (key in value) out[key] = !!value[key]
  }
  return out
}

const NOTE_MAX_LEN = 2000
const sanitizeNote = (value: string): string => value.slice(0, NOTE_MAX_LEN)

/*
 * 화면 → 문서. 여기 적힌 필드만 $set 된다 — 수집 파이프라인이 채운 값을 검토 화면이
 * 덮는 사고를 구조로 막는다(그래서 화이트리스트가 이 함수 밖에 없다).
 */
export function toDocPatch(patch: any, doc: any): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  const fieldStatus: Record<string, string> = {}
  const fieldOrigin: Record<string, string> = {}
  const existingOriginal = doc?.review_meta?.aiOriginal
  const aiOriginal: Record<string, unknown> = existingOriginal ? { ...existingOriginal } : {}
  let tagsChanged = false

  for (const key of FIELD_KEYS) {
    const incoming = patch?.fields?.[key]
    if (!incoming) continue
    const slot = FIELD_SLOTS[key]
    const selected = cleanList(incoming.selected)
    const rep = selected.length === 1 ? selected[0] : (selected.includes(incoming.rep) ? incoming.rep : null)

    /* 값이 실제로 바뀌었는지 판정: 선택 목록이나 대표가 다르면 changed */
    const currentSelected = asList(doc || {}, slot)
    const currentRep = repOf(doc || {}, slot, currentSelected)
    const selectedChanged = selected.length !== currentSelected.length ||
                           !selected.every((s, i) => s === currentSelected[i])
    const repChanged = rep !== currentRep
    if (selectedChanged || repChanged) {
      tagsChanged = true
    }

    if (slot.list) {
      set[slot.list] = selected
      if (slot.primary) set[slot.primary] = rep
    } else {
      set[slot.scalar!] = selected[0] ?? null
    }
    fieldStatus[key] = ['done', 'unreviewed', 'fix'].includes(incoming.status) ? incoming.status : 'unreviewed'
    fieldOrigin[key] = incoming.origin === 'human' ? 'human' : 'ai'
    /* 첫 저장에서만 원본을 굳힌다. 이미 있으면 덮지 않는다 — 두 번째 저장이 사람이
       고친 값을 원본으로 만들면 '되돌리기'가 영영 망가진다. */
    if (!existingOriginal?.[key]) {
      const before = asList(doc || {}, slot)
      aiOriginal[key] = { selected: before, rep: repOf(doc || {}, slot, before) }
    }
  }

  set.review_meta = {
    ...(doc?.review_meta || {}),
    fieldStatus: { ...(doc?.review_meta?.fieldStatus || {}), ...fieldStatus },
    fieldOrigin: { ...(doc?.review_meta?.fieldOrigin || {}), ...fieldOrigin },
    tagRequest: patch?.tagRequest && typeof patch.tagRequest === 'object' ? sanitizeTagRequest(patch.tagRequest) : (doc?.review_meta?.tagRequest || {}),
    note: typeof patch?.note === 'string' ? sanitizeNote(patch.note) : (doc?.review_meta?.note || ''),
    aiOriginal,
  }
  set.updated_at = nowIso()

  /* 태그가 실제로 바뀌고, 현재 상태가 reviewed 또는 needs_fix면 리셋 */
  if (tagsChanged && (doc?.review_status === 'reviewed' || doc?.review_status === 'needs_fix')) {
    set.review_status = 'unreviewed'
    set.reviewed_at = null
  }

  return set
}
