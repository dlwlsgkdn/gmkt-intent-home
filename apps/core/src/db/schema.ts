import type { LlmMeta, StepStage, ThreadSource, ThreadStatus } from '@ddak/schema'

/*
 * 쓰레드 = 저니 1회의 유일한 원본 (DESIGN-LLM-SERVICE.md §2-2).
 * Neon Postgres(Drizzle) → 사내 Mongo로 이관(2026-09) — 사내 OpenShift Pod에서 Neon(외부
 * 인터넷)에 닿을지 불확실했고, 사내 Mongo는 apps/tagging-api가 이미 검증했다.
 * payload/llmMeta 등 원래 jsonb였던 필드는 값 자체가 이미 JSON 직렬화 가능한 구조라 그대로
 * BSON 문서 필드로 옮겨진다 — 스키마 진화가 빠른 초기라 정규화하지 않는 것도 그대로 유지.
 *
 * 이 파일은 저장 형태(문서)만 정의한다. 문서 ↔ API 응답(zod, @ddak/schema) 변환은
 * wire.ts의 순수 함수가 맡는다(테스트가 Mongo 없이 그 파일만으로 검증한다).
 */

export const THREADS_COLL = 'threads'
export const THREAD_STEPS_COLL = 'thread_steps'
export const SETTINGS_COLL = 'settings'
export const EVAL_CASES_COLL = 'eval_cases'
export const EVAL_RUNS_COLL = 'eval_runs'

/** _id = 스노우플레이크 threadId (common/snowflake.ts — 앱이 발급, DB default 없음).
 * 인덱스 (userId, updatedAt) 필요 — listByUser의 정렬·필터 (mongo.service.ts ensureIndexes) */
export interface ThreadDoc {
  _id: string
  userId: string
  title: string | null
  source: ThreadSource | null
  status: ThreadStatus
  createdAt: Date
  updatedAt: Date
}

/** _id = uuid (앱이 crypto.randomUUID()로 발급 — Postgres의 uuid 기본값을 대신한다).
 * (threadId, seq) 유니크 인덱스가 upsertStep의 멱등 키다(ensureIndexes 참고).
 * threadId가 가리키는 쓰레드가 지워지는 경로는 지금 없다(카스케이드 미구현 — 원래도 없었다) */
export interface ThreadStepDoc {
  _id: string
  threadId: string
  seq: number
  stage: StepStage
  payload: Record<string, unknown>
  llmMeta: LlmMeta | null
  createdAt: Date
}

/** _id = key. 운영 설정 KV — core는 값을 해석하지 않는다 */
export interface SettingDoc {
  _id: string
  value: unknown
  updatedAt: Date
}

/** _id = 스노우플레이크 (쓰레드 id와 같은 체계, 앱이 발급) */
export interface EvalCaseDoc {
  _id: string
  title: string | null
  intent: string
  profile: unknown
  survey: unknown
  answers: unknown
  sourceThreadId: string | null
  createdAt: Date
}

/** caseId → eval_cases 참조 — 카스케이드 삭제는 EvalService.deleteCase가 코드로 재현한다
 * (Postgres FK onDelete cascade가 하던 일). 인덱스 (caseId, createdAt) 필요 */
export interface EvalRunDoc {
  _id: string
  caseId: string
  config: Record<string, unknown>
  page: unknown
  dropLog: unknown[]
  meta: LlmMeta | null
  score: number | null
  comment: string
  components: unknown[]
  judge: unknown
  createdAt: Date
}

/* ── 내재화 카탈로그 (2026-09-17, Mongo 포팅 2026-09-22) — 추천 상품·참고 콘텐츠의 내부 표. 계약은 @ddak/schema catalog.ts,
 * 배경은 API.md §1-4. GitHub 저장소(옛 Neon/Drizzle)에서는 마이그레이션 0005 의 표 2개 + pg_trgm ILIKE 였고, 이 저장소의 core 는
 * Mongo 라 같은 계약을 컬렉션으로 옮겼다. core 는 저장·검색만 한다: searchText(이름·브랜드·태그·카테고리를 소문자·공백 제거로 이어
 * 붙인 문자열 — 콘텐츠는 제목·출처·태그·요약 200자)에 검색어가 부분 일치하는 개수로 순위를 매기되, pg_trgm 대신 정규식 부분 일치로
 * 후보를 거른 뒤 Node 에서 점수·정렬한다(규칙은 catalog/catalog.logic.ts 순수 함수 — test/catalog.test.mjs). 인덱스는
 * mongo.service.ts ensureCatalogIndexes 가 기동 시·「표 만들기」 때 멱등으로 만든다 */

export const CATALOG_PRODUCTS_COLL = 'catalog_products'
export const CATALOG_CONTENTS_COLL = 'catalog_contents'

/** _id = 카탈로그 id — `gm-<상품번호>`(지마켓) · `oy-<goodsNo>`(올리브영) · `p-001`(데모) · `web-<해시>`(그 밖 몰). BFF/@ddak/pipeline 이 만든다 */
export interface CatalogProductDoc {
  _id: string
  mall: string
  mallProductId: string | null
  name: string
  brand: string
  price: number
  url: string
  imageUrl: string | null
  tags: string[]
  category: string | null
  /** search | thread | manual */
  source: string
  /** PDP 가 확인된 상품 — 검색은 기본으로 이 행만 돌려준다 */
  verified: boolean
  /** active | dead (점검에서 상품이 내려간 것으로 확인) */
  status: string
  meta: Record<string, unknown> | null
  /** 계획에 실린 횟수 — 수확(bump) upsert 가 더한다 (검색 순위 보조) */
  recommendCount: number
  /** 검색 재료 — 정규화 연결 문자열 (앱이 만든다, catalog.logic.ts productSearchText) */
  searchText: string
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** _id = `ct-<url 해시>` */
export interface CatalogContentDoc {
  _id: string
  /** video | article */
  type: string
  source: string
  title: string
  url: string
  imageUrl: string | null
  meta: string | null
  snippet: string | null
  duration: string | null
  tags: string[]
  year: number | null
  verified: boolean
  status: string
  recommendCount: number
  searchText: string
  lastSeenAt: Date | null
  createdAt: Date
  updatedAt: Date
}
