import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import type { CreateEvalCaseBody, CreateEvalRunBody, JudgeEvalRunBody, ScoreEvalRunBody } from '@ddak/schema'
import { DB, type DbOrNull } from '../db/db.module'
import type { Db } from '../db/neon.client'
import { evalCases, evalRuns } from '../db/neon.schema'
import { neonEvalCaseToWire, neonEvalRunToWire } from '../db/neon.wire'
import { notConnectedMessage } from '../db/store'
import { snowflake } from '../common/snowflake'
import { EvalService } from './eval.service'

/*
 * 평가·실험 저장 계층 — Neon Postgres(Drizzle) 구현. 케이스(입력 스냅샷)와 실행(설정×결과×채점)을 저장·조회만.
 * 실행 기록의 카스케이드 삭제는 FK(onDelete cascade)가 맡는다(마이그레이션 0003).
 */
@Injectable()
export class EvalNeonService extends EvalService {
  constructor(@Inject(DB) private readonly db: DbOrNull) {
    super()
  }

  private conn(): Db {
    if (!this.db) throw new ServiceUnavailableException(notConnectedMessage())
    return this.db
  }

  async createCase(body: CreateEvalCaseBody) {
    const [row] = await this.conn()
      .insert(evalCases)
      .values({
        id: snowflake.next(),
        title: body.title ?? null,
        intent: body.intent,
        profile: body.profile ?? null,
        survey: body.survey ?? null,
        answers: body.answers ?? null,
        sourceThreadId: body.sourceThreadId ?? null,
      })
      .returning()
    return neonEvalCaseToWire(row)
  }

  async listCases(limit = 100) {
    const rows = await this.conn().select().from(evalCases).orderBy(desc(evalCases.id)).limit(limit)
    return rows.map(neonEvalCaseToWire)
  }

  async getCase(id: string) {
    const [row] = await this.conn().select().from(evalCases).where(eq(evalCases.id, id))
    if (!row) throw new NotFoundException('평가 케이스가 없습니다')
    return neonEvalCaseToWire(row)
  }

  async deleteCase(id: string) {
    const rows = await this.conn().delete(evalCases).where(eq(evalCases.id, id)).returning({ id: evalCases.id })
    if (!rows.length) throw new NotFoundException('평가 케이스가 없습니다')
    return { ok: true }
  }

  async createRun(caseId: string, body: CreateEvalRunBody) {
    await this.getCase(caseId)
    const [row] = await this.conn()
      .insert(evalRuns)
      .values({
        id: snowflake.next(),
        caseId,
        config: body.config,
        page: body.page ?? null,
        dropLog: body.dropLog ?? [],
        meta: body.meta ?? null,
      })
      .returning()
    return neonEvalRunToWire(row)
  }

  async listRuns(caseId: string, limit = 50) {
    const rows = await this.conn()
      .select()
      .from(evalRuns)
      .where(eq(evalRuns.caseId, caseId))
      .orderBy(desc(evalRuns.id))
      .limit(limit)
    return rows.map(neonEvalRunToWire)
  }

  /** 실행 단건 + 소속 케이스 — 자동 채점(BFF)이 케이스 입력을 함께 쓴다 */
  async getRun(id: string) {
    const [run] = await this.conn().select().from(evalRuns).where(eq(evalRuns.id, id))
    if (!run) throw new NotFoundException('평가 실행이 없습니다')
    const evalCase = await this.getCase(run.caseId)
    return { run: neonEvalRunToWire(run), case: evalCase }
  }

  /** 사람 채점 — 전체(score·comment) + 항목별(components). judge는 건드리지 않는다 (source 분리) */
  async scoreRun(id: string, body: ScoreEvalRunBody) {
    const [row] = await this.conn()
      .update(evalRuns)
      .set({
        score: body.score,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
        ...(body.components !== undefined ? { components: body.components } : {}),
      })
      .where(eq(evalRuns.id, id))
      .returning()
    if (!row) throw new NotFoundException('평가 실행이 없습니다')
    return neonEvalRunToWire(row)
  }

  /** 자동 채점 판정 저장 — 사람 채점(score·comment·components)은 건드리지 않는다 (source 분리) */
  async setJudge(id: string, body: JudgeEvalRunBody) {
    const [row] = await this.conn()
      .update(evalRuns)
      .set({ judge: body.judge })
      .where(eq(evalRuns.id, id))
      .returning()
    if (!row) throw new NotFoundException('평가 실행이 없습니다')
    return neonEvalRunToWire(row)
  }
}
