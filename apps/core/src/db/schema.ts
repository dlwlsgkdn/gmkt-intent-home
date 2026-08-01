import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { LlmMeta, StepStage, ThreadSource, ThreadStatus } from '@ddak/schema'

/*
 * 쓰레드 = 저니 1회의 유일한 원본 (DESIGN-LLM-SERVICE.md §2-2).
 * payload/llm_meta는 jsonb — 스키마 진화가 빠른 초기라 정규화하지 않고, 조회는 쓰레드 단위 aggregate.
 */

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    threadId: uuid('thread_id')
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

export type ThreadRow = typeof threads.$inferSelect
export type ThreadStepRow = typeof threadSteps.$inferSelect
