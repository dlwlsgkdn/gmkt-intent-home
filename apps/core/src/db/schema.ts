import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { LlmMeta, StepStage, ThreadSource, ThreadStatus } from '@ddak/schema'

/*
 * 쓰레드 = 저니 1회의 유일한 원본 (DESIGN-LLM-SERVICE.md §2-2).
 * payload/llm_meta는 jsonb — 스키마 진화가 빠른 초기라 정규화하지 않고, 조회는 쓰레드 단위 aggregate.
 */

export const threads = pgTable(
  'threads',
  {
    /** 스노우플레이크 (common/snowflake.ts — 앱이 생성, DB default 없음). 19자리 고정이라 text 정렬 = 생성 시각순 */
    id: text('id').primaryKey(),
    /** 익명 디바이스 id 또는 로그인 사용자 id — 불투명 문자열 */
    userId: text('user_id').notNull(),
    title: text('title'),
    source: jsonb('source').$type<ThreadSource | null>(),
    status: text('status').$type<ThreadStatus>().notNull().default('exploring'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('threads_user_updated_idx').on(t.userId, t.updatedAt)],
)

export const threadSteps = pgTable(
  'thread_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    /** BFF가 부여하는 순번 — (thread_id, seq) 유니크가 멱등 upsert 키 */
    seq: integer('seq').notNull(),
    stage: text('stage').$type<StepStage>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    llmMeta: jsonb('llm_meta').$type<LlmMeta | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('thread_steps_thread_seq_uq').on(t.threadId, t.seq)],
)

/** 운영 설정 KV — BFF가 런타임에 읽고 관리 페이지가 바꾼다 (예: llm-model). core는 값을 해석하지 않는다 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ── 평가·실험 (페이즈 5) — 골든 케이스와 실행 기록. core는 내용을 해석하지 않는다 ── */

export const evalCases = pgTable('eval_cases', {
  /** 스노우플레이크 — 쓰레드 id와 같은 체계 (앱 발급) */
  id: text('id').primaryKey(),
  title: text('title'),
  intent: text('intent').notNull(),
  profile: jsonb('profile').$type<unknown>(),
  survey: jsonb('survey').$type<unknown>(),
  answers: jsonb('answers').$type<unknown>(),
  /** 승격 원본 쓰레드 (수동 생성이면 null) — FK 없음: 쓰레드가 지워져도 케이스는 남는다 */
  sourceThreadId: text('source_thread_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    /** 실행 설정 스냅샷 (engine·model·promptVersion·promptOverride…) — 비교 축 */
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    /** 계획 결과(병합본)·드롭 로그·메타 — 결과 재현용 스냅샷 */
    page: jsonb('page').$type<unknown>(),
    dropLog: jsonb('drop_log').$type<unknown>().notNull().default([]),
    meta: jsonb('meta').$type<LlmMeta | null>(),
    /** 사람 채점 — null = 미채점 (0점과 구분) */
    score: integer('score'),
    comment: text('comment').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('eval_runs_case_idx').on(t.caseId, t.createdAt)],
)

export type ThreadRow = typeof threads.$inferSelect
export type ThreadStepRow = typeof threadSteps.$inferSelect
export type SettingRow = typeof settings.$inferSelect
export type EvalCaseRow = typeof evalCases.$inferSelect
export type EvalRunRow = typeof evalRuns.$inferSelect
