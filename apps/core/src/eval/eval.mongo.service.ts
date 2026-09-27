import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { Collection } from 'mongodb'
import type { CreateEvalCaseBody, CreateEvalRunBody, JudgeEvalRunBody, ScoreEvalRunBody } from '@ddak/schema'
import { MongoService } from '../db/mongo.service'
import { EvalService } from './eval.service'
import { EVAL_CASES_COLL, EVAL_RUNS_COLL, type EvalCaseDoc, type EvalRunDoc } from '../db/schema'
import { evalCaseToWire, evalRunToWire } from '../db/wire'
import { snowflake } from '../common/snowflake'

/*
 * 평가·실험 저장 계층 (페이즈 5) — 케이스(입력 스냅샷)와 실행(설정×결과×채점)을 저장·조회만.
 * 내용 해석·집계·비교는 BFF/FE 몫 — 쓰레드 payload와 같은 원칙이다.
 */
@Injectable()
export class EvalMongoService extends EvalService {
  constructor(private readonly mongo: MongoService) {
    super()
  }

  private cases(): Collection<EvalCaseDoc> {
    const c = this.mongo.collection<EvalCaseDoc>(EVAL_CASES_COLL)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다')
    return c
  }

  private runs(): Collection<EvalRunDoc> {
    const c = this.mongo.collection<EvalRunDoc>(EVAL_RUNS_COLL)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다')
    return c
  }

  async createCase(body: CreateEvalCaseBody) {
    const doc: EvalCaseDoc = {
      _id: snowflake.next(),
      title: body.title ?? null,
      intent: body.intent,
      profile: body.profile ?? null,
      survey: body.survey ?? null,
      answers: body.answers ?? null,
      sourceThreadId: body.sourceThreadId ?? null,
      createdAt: new Date(),
    }
    await this.cases().insertOne(doc)
    return evalCaseToWire(doc)
  }

  async listCases(limit = 100) {
    const rows = await this.cases().find().sort({ _id: -1 }).limit(limit).toArray()
    return rows.map(evalCaseToWire)
  }

  async getCase(id: string) {
    const row = await this.cases().findOne({ _id: id })
    if (!row) throw new NotFoundException('평가 케이스가 없습니다')
    return evalCaseToWire(row)
  }

  /**
   * 케이스 삭제 — Postgres FK(onDelete cascade)가 하던 실행 기록 삭제를 코드로 재현한다.
   * 실행부터 지우고 케이스를 나중에 지운다: 반대 순서면 "케이스 삭제 성공, 실행 삭제 전에
   * 죽음" 상황에서 재시도가 404(케이스가 이미 없음)라 고아 실행이 영영 남는다. 이 순서면
   * 최악의 경우도 "실행은 지웠는데 케이스가 남음"이라 재시도(같은 id로 다시 삭제 요청)가
   * 안전하다.
   */
  async deleteCase(id: string) {
    const existing = await this.cases().findOne({ _id: id }, { projection: { _id: 1 } })
    if (!existing) throw new NotFoundException('평가 케이스가 없습니다')
    await this.runs().deleteMany({ caseId: id })
    await this.cases().deleteOne({ _id: id })
    return { ok: true }
  }

  async createRun(caseId: string, body: CreateEvalRunBody) {
    await this.getCase(caseId)
    const doc: EvalRunDoc = {
      _id: snowflake.next(),
      caseId,
      config: body.config,
      page: body.page ?? null,
      dropLog: body.dropLog ?? [],
      meta: body.meta ?? null,
      score: null,
      comment: '',
      components: [],
      judge: null,
      createdAt: new Date(),
    }
    await this.runs().insertOne(doc)
    return evalRunToWire(doc)
  }

  async listRuns(caseId: string, limit = 50) {
    const rows = await this.runs().find({ caseId }).sort({ _id: -1 }).limit(limit).toArray()
    return rows.map(evalRunToWire)
  }

  /** 실행 단건 + 소속 케이스 — 자동 채점(BFF)이 케이스 입력을 함께 쓴다 */
  async getRun(id: string) {
    const run = await this.runs().findOne({ _id: id })
    if (!run) throw new NotFoundException('평가 실행이 없습니다')
    const evalCase = await this.getCase(run.caseId)
    return { run: evalRunToWire(run), case: evalCase }
  }

  /** 사람 채점 — 전체(score·comment) + 항목별(components). judge는 건드리지 않는다 (source 분리) */
  async scoreRun(id: string, body: ScoreEvalRunBody) {
    const set: Partial<Pick<EvalRunDoc, 'score' | 'comment' | 'components'>> = { score: body.score }
    if (body.comment !== undefined) set.comment = body.comment
    if (body.components !== undefined) set.components = body.components
    const row = await this.runs().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' })
    if (!row) throw new NotFoundException('평가 실행이 없습니다')
    return evalRunToWire(row)
  }

  /** 자동 채점 판정 저장 — 사람 채점(score·comment·components)은 건드리지 않는다 (source 분리) */
  async setJudge(id: string, body: JudgeEvalRunBody) {
    const row = await this.runs().findOneAndUpdate(
      { _id: id },
      { $set: { judge: body.judge } },
      { returnDocument: 'after' },
    )
    if (!row) throw new NotFoundException('평가 실행이 없습니다')
    return evalRunToWire(row)
  }
}
