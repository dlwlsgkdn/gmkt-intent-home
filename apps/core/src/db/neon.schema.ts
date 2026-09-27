import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
    /** 사람 채점(전체) — null = 미채점 (0점과 구분) */
    score: integer('score'),
    comment: text('comment').notNull().default(''),
    /** 사람 채점(항목별) — ThreadFeedbackComponent[] 모양이지만 core는 해석하지 않는다 */
    components: jsonb('components').$type<unknown>().notNull().default([]),
    /** 자동 채점(judge) 판정 — 사람 채점과 분리 저장 (BFF가 굳힌 EvalJudgeVerdict, core는 해석 안 함) */
    judge: jsonb('judge').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('eval_runs_case_idx').on(t.caseId, t.createdAt)],
)

/* ── 내재화 카탈로그 (2026-09-17) — 추천 상품·참고 콘텐츠의 내부 표. 계약은 @ddak/schema catalog.ts, 배경은 API.md §2-1.
 * core 는 저장·검색만 한다: 검색은 search_text(이름·브랜드·태그·카테고리를 소문자·공백 제거로 이어 붙인 문자열)의 부분 일치 개수로
 * 순위를 매긴다 — 한국어 형태소 분석 없이 어휘 표(@ddak/pipeline PRODUCT_TYPE_VOCAB)가 그 몫을 하고, pg_trgm GIN 인덱스가
 * ILIKE 를 받는다(마이그레이션 0005 가 확장을 켠다 — Neon 은 CREATE EXTENSION pg_trgm 을 지원한다). 수천~수만 행 규모에서 한 자리
 * ms 대 조회이며, 의미 검색이 필요해지면 pgvector 임베딩 컬럼을 더한다(Neon 지원) — 그때도 이 표가 원천이다 */

export const catalogProducts = pgTable(
  'catalog_products',
  {
    /** `gm-<상품번호>`(지마켓) · `oy-<goodsNo>`(올리브영) · `p-001`(데모) · `web-<해시>` — BFF/@ddak/pipeline 이 만든다 */
    id: text('id').primaryKey(),
    mall: text('mall').notNull(),
    mallProductId: text('mall_product_id'),
    name: text('name').notNull(),
    brand: text('brand').notNull().default(''),
    price: integer('price').notNull().default(0),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    category: text('category'),
    /** snapshot | catalog | thread | manual */
    source: text('source').notNull(),
    /** PDP 가 확인된 상품 — 검색은 기본으로 이 행만 돌려준다 */
    verified: boolean('verified').notNull().default(false),
    /** active | dead (점검에서 리스팅이 내려간 것으로 확인) */
    status: text('status').notNull().default('active'),
    meta: jsonb('meta').$type<Record<string, unknown> | null>(),
    /** 계획에 실린 횟수 — 수확 upsert 가 더한다 (검색 순위 보조) */
    recommendCount: integer('recommend_count').notNull().default(0),
    /** 검색 재료 — 이름·브랜드·태그·카테고리 정규화 연결 (앱이 만든다) */
    searchText: text('search_text').notNull().default(''),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('catalog_products_mall_idx').on(t.mall, t.verified),
    index('catalog_products_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export const catalogContents = pgTable(
  'catalog_contents',
  {
    /** `ct-<url 해시>` */
    id: text('id').primaryKey(),
    /** video | article */
    type: text('type').notNull(),
    source: text('source').notNull().default(''),
    title: text('title').notNull(),
    url: text('url').notNull(),
    imageUrl: text('image_url'),
    meta: text('meta'),
    snippet: text('snippet'),
    duration: text('duration'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    year: integer('year'),
    verified: boolean('verified').notNull().default(true),
    status: text('status').notNull().default('active'),
    recommendCount: integer('recommend_count').notNull().default(0),
    searchText: text('search_text').notNull().default(''),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('catalog_contents_type_idx').on(t.type, t.verified),
    index('catalog_contents_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export type ThreadRow = typeof threads.$inferSelect
export type ThreadStepRow = typeof threadSteps.$inferSelect
export type SettingRow = typeof settings.$inferSelect
export type EvalCaseRow = typeof evalCases.$inferSelect
export type EvalRunRow = typeof evalRuns.$inferSelect
export type CatalogProductDbRow = typeof catalogProducts.$inferSelect
export type CatalogContentDbRow = typeof catalogContents.$inferSelect
