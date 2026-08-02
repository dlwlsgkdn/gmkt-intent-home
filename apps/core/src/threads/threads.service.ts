import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { and, asc, desc, eq, lt } from 'drizzle-orm'
import type { CreateThreadBody, ThreadStatus, UpdateThreadBody, UpsertStepBody } from '@ddak/schema'
import { DB, type DbOrNull } from '../db/db.module'
import type { Db } from '../db/client'
import { snowflake } from '../common/snowflake'
import { threadSteps, threads } from '../db/schema'

const FK_VIOLATION = '23503'

@Injectable()
export class ThreadsService {
  constructor(@Inject(DB) private readonly db: DbOrNull) {}

  private conn(): Db {
    if (!this.db) throw new ServiceUnavailableException('DATABASE_URL이 설정되지 않았습니다')
    return this.db
  }

  /** 쓰레드 생성 — threadId는 여기서 스노우플레이크로 발급한다 (분산 유니크·시간순 정렬) */
  async create(body: CreateThreadBody) {
    const [row] = await this.conn()
      .insert(threads)
      .values({
        id: snowflake.next(),
        userId: body.userId,
        title: body.title ?? null,
        source: body.source ?? null,
        status: body.status ?? 'exploring',
      })
      .returning()
    return row
  }

  async update(id: string, patch: UpdateThreadBody) {
    const set: Partial<{ title: string; status: ThreadStatus }> = {}
    if (patch.title !== undefined) set.title = patch.title
    if (patch.status !== undefined) set.status = patch.status
    const [row] = await this.conn()
      .update(threads)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(threads.id, id))
      .returning()
    if (!row) throw new NotFoundException('쓰레드가 없습니다')
    return row
  }

  /** (thread_id, seq) 멱등 upsert — BFF 재시도가 중복 스텝을 만들지 않는다 */
  async upsertStep(threadId: string, seq: number, body: UpsertStepBody) {
    const db = this.conn()
    try {
      const [row] = await db
        .insert(threadSteps)
        .values({
          threadId,
          seq,
          stage: body.stage,
          payload: body.payload,
          llmMeta: body.llmMeta ?? null,
        })
        .onConflictDoUpdate({
          target: [threadSteps.threadId, threadSteps.seq],
          set: { stage: body.stage, payload: body.payload, llmMeta: body.llmMeta ?? null },
        })
        .returning()
      await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId))
      return row
    } catch (e) {
      if ((e as { code?: string })?.code === FK_VIOLATION) throw new NotFoundException('쓰레드가 없습니다')
      throw e
    }
  }

  /** 쓰레드 + 스텝 전체 — 이어보기 복원용 aggregate */
  async get(id: string) {
    const db = this.conn()
    const [thread] = await db.select().from(threads).where(eq(threads.id, id))
    if (!thread) throw new NotFoundException('쓰레드가 없습니다')
    const steps = await db
      .select()
      .from(threadSteps)
      .where(eq(threadSteps.threadId, id))
      .orderBy(asc(threadSteps.seq))
    return { ...thread, steps }
  }

  /** 히스토리 패널용 목록 — updatedAt 키셋 커서 (cursor = 마지막 항목의 updatedAt ISO) */
  async listByUser(userId: string, cursor?: string, limit = 20) {
    const db = this.conn()
    const conds = [eq(threads.userId, userId)]
    if (cursor) conds.push(lt(threads.updatedAt, new Date(cursor)))
    const rows = await db
      .select()
      .from(threads)
      .where(and(...conds))
      .orderBy(desc(threads.updatedAt))
      .limit(limit + 1)
    const items = rows.slice(0, limit)
    const nextCursor = rows.length > limit ? items[items.length - 1].updatedAt.toISOString() : null
    return { items, nextCursor }
  }
}
