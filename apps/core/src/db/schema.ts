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
