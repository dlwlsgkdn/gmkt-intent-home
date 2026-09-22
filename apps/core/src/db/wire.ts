import type { CatalogContentRow, CatalogProductRow } from '@ddak/schema'
import type { CatalogContentDoc, CatalogProductDoc, EvalCaseDoc, EvalRunDoc, SettingDoc, ThreadDoc, ThreadStepDoc } from './schema'

/*
 * 문서(Mongo) ↔ API 응답(와이어) 변환 — 순수 함수만 모았다(IO 없음, Mongo 연결 없이
 * test/*.test.mjs가 이 파일만으로 검증한다). 규칙은 한 가지: `_id` → 원래 필드 이름
 * (id 또는 key), Date → ISO 문자열(@ddak/schema zod 계약이 문자열 날짜를 요구한다).
 */

export function threadToWire(doc: ThreadDoc) {
  return {
    id: doc._id,
    userId: doc.userId,
    title: doc.title,
    source: doc.source,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function stepToWire(doc: ThreadStepDoc) {
  return {
    id: doc._id,
    threadId: doc.threadId,
    seq: doc.seq,
    stage: doc.stage,
    payload: doc.payload,
    llmMeta: doc.llmMeta,
    createdAt: doc.createdAt.toISOString(),
  }
}

export function settingToWire(doc: SettingDoc) {
  return {
    key: doc._id,
    value: doc.value,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function evalCaseToWire(doc: EvalCaseDoc) {
  return {
    id: doc._id,
    title: doc.title,
    intent: doc.intent,
    profile: doc.profile,
    survey: doc.survey,
    answers: doc.answers,
    sourceThreadId: doc.sourceThreadId,
    createdAt: doc.createdAt.toISOString(),
  }
}

export function evalRunToWire(doc: EvalRunDoc) {
  return {
    id: doc._id,
    caseId: doc.caseId,
    config: doc.config,
    page: doc.page,
    dropLog: doc.dropLog,
    meta: doc.meta,
    score: doc.score,
    comment: doc.comment,
    components: doc.components,
    judge: doc.judge,
    createdAt: doc.createdAt.toISOString(),
  }
}

/**
 * 키셋 커서 페이지네이션의 공통 규칙 — listByUser(updatedAt 커서)·listAll(id 커서) 둘 다
 * "limit+1개를 가져와 마지막 한 개로 다음 페이지 유무를 판정"하는 이 함수 하나를 쓴다.
 * rows는 이미 정렬된 상태로 들어와야 한다(정렬은 Mongo 쿼리 책임).
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? cursorOf(items[items.length - 1]) : null
  return { items, nextCursor }
}

/** listFeedbackSteps 필터 규칙 — action 스텝 중 payload.type==='feedback'만.
 * core는 payload를 해석하지 않는다는 원칙대로 최상위 type 키 한 곳만 본다 */
export function isFeedbackStep(doc: Pick<ThreadStepDoc, 'stage' | 'payload'>): boolean {
  return doc.stage === 'action' && (doc.payload as { type?: unknown } | null)?.type === 'feedback'
}

/** listFeedbackSteps 정렬 규칙 — createdAt desc, 동점이면 seq desc (최신 제출이 먼저) */
export function compareFeedbackSteps(a: ThreadStepDoc, b: ThreadStepDoc): number {
  const byCreated = b.createdAt.getTime() - a.createdAt.getTime()
  return byCreated !== 0 ? byCreated : b.seq - a.seq
}

/** 카탈로그 상품 문서 → 와이어 (score 는 검색 응답에만 붙는다) */
export function catalogProductToWire(doc: CatalogProductDoc, score?: number) {
  return {
    id: doc._id,
    mall: doc.mall,
    mallProductId: doc.mallProductId,
    name: doc.name,
    brand: doc.brand,
    price: doc.price,
    url: doc.url,
    imageUrl: doc.imageUrl,
    tags: doc.tags,
    category: doc.category,
    source: doc.source as CatalogProductRow['source'],
    verified: doc.verified,
    status: doc.status as CatalogProductRow['status'],
    meta: doc.meta,
    recommendCount: doc.recommendCount,
    lastSeenAt: doc.lastSeenAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    ...(score !== undefined ? { score } : {}),
  }
}

export function catalogContentToWire(doc: CatalogContentDoc, score?: number) {
  return {
    id: doc._id,
    type: doc.type as CatalogContentRow['type'],
    source: doc.source,
    title: doc.title,
    url: doc.url,
    imageUrl: doc.imageUrl,
    meta: doc.meta,
    snippet: doc.snippet,
    duration: doc.duration,
    tags: doc.tags,
    year: doc.year,
    verified: doc.verified,
    status: doc.status as CatalogContentRow['status'],
    recommendCount: doc.recommendCount,
    lastSeenAt: doc.lastSeenAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    ...(score !== undefined ? { score } : {}),
  }
}
