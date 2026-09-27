import crypto from 'node:crypto'
import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { Collection, Filter } from 'mongodb'
import type { CreateThreadBody, ThreadStatus, UpdateThreadBody, UpsertStepBody } from '@ddak/schema'
import { MongoService } from '../db/mongo.service'
import { ThreadsService } from './threads.service'
import { THREAD_STEPS_COLL, THREADS_COLL, type ThreadDoc, type ThreadStepDoc } from '../db/schema'
import { compareFeedbackSteps, isFeedbackStep, paginate, stepToWire, threadToWire } from '../db/wire'
import { snowflake } from '../common/snowflake'

/** Mongo 유니크 인덱스 위반 에러 코드 (E11000) */
const DUPLICATE_KEY = 11000

@Injectable()
export class ThreadsMongoService extends ThreadsService {
  constructor(private readonly mongo: MongoService) {
    super()
  }

  private threads(): Collection<ThreadDoc> {
    const c = this.mongo.collection<ThreadDoc>(THREADS_COLL)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다')
    return c
  }

  private steps(): Collection<ThreadStepDoc> {
    const c = this.mongo.collection<ThreadStepDoc>(THREAD_STEPS_COLL)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다')
    return c
  }

  /** 쓰레드 생성 — threadId는 여기서 스노우플레이크로 발급한다 (분산 유니크·시간순 정렬) */
  async create(body: CreateThreadBody) {
    const now = new Date()
    const doc: ThreadDoc = {
      _id: snowflake.next(),
      userId: body.userId,
      title: body.title ?? null,
      source: body.source ?? null,
      status: body.status ?? 'exploring',
      createdAt: now,
      updatedAt: now,
    }
    await this.threads().insertOne(doc)
    return threadToWire(doc)
  }

  async update(id: string, patch: UpdateThreadBody) {
    const set: Partial<{ title: string; status: ThreadStatus }> = {}
    if (patch.title !== undefined) set.title = patch.title
    if (patch.status !== undefined) set.status = patch.status
    const row = await this.threads().findOneAndUpdate(
      { _id: id },
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    if (!row) throw new NotFoundException('쓰레드가 없습니다')
    return threadToWire(row)
  }

  /**
   * (thread_id, seq) 멱등 upsert — BFF 재시도가 중복 스텝을 만들지 않는다.
   * Postgres의 onConflictDoUpdate는 단일 원자 연산이지만, Mongo의 upsert는 문서가
   * 아직 없을 때 동시 요청 두 개가 동시에 들어오면 유니크 인덱스 위반(E11000)으로
   * 하나가 실패할 수 있다 — 그 시점엔 반드시 문서가 이미 존재하므로 순수 update로
   * 한 번 더 시도해 같은 멱등 결과를 낸다.
   */
  async upsertStep(threadId: string, seq: number, body: UpsertStepBody) {
    const thread = await this.threads().findOne({ _id: threadId })
    if (!thread) throw new NotFoundException('쓰레드가 없습니다')

    const set = { stage: body.stage, payload: body.payload, llmMeta: body.llmMeta ?? null }
    let row: ThreadStepDoc | null
    try {
      row = await this.steps().findOneAndUpdate(
        { threadId, seq },
        { $set: set, $setOnInsert: { _id: crypto.randomUUID(), createdAt: new Date() } },
        { upsert: true, returnDocument: 'after' },
      )
    } catch (e) {
      if ((e as { code?: number })?.code === DUPLICATE_KEY) {
        row = await this.steps().findOneAndUpdate({ threadId, seq }, { $set: set }, { returnDocument: 'after' })
      } else {
        throw e
      }
    }
    if (!row) throw new Error('스텝 upsert 결과가 비어 있습니다 (일어날 수 없는 경합)')
    await this.threads().updateOne({ _id: threadId }, { $set: { updatedAt: new Date() } })
    return stepToWire(row)
  }

  /** 쓰레드 + 스텝 전체 — 이어보기 복원용 aggregate */
  async get(id: string) {
    const thread = await this.threads().findOne({ _id: id })
    if (!thread) throw new NotFoundException('쓰레드가 없습니다')
    const steps = await this.steps().find({ threadId: id }).sort({ seq: 1 }).toArray()
    return { ...threadToWire(thread), steps: steps.map(stepToWire) }
  }

  /** 히스토리 패널용 목록 — updatedAt 키셋 커서 (cursor = 마지막 항목의 updatedAt ISO).
   * 보관(archived) 쓰레드는 사용자 목록에서 숨긴다 — 관리 목록(listAll)에만 보인다 */
  async listByUser(userId: string, cursor?: string, limit = 20) {
    const baseFilter: Filter<ThreadDoc> = { userId, status: { $ne: 'archived' } }
    const filter: Filter<ThreadDoc> = cursor ? { ...baseFilter, updatedAt: { $lt: new Date(cursor) } } : baseFilter
    // 총 개수는 커서와 무관한 전체(archived 제외) — 히스토리 패널이 스크롤 전에 "전체 n개"를 알아야 한다
    const [rows, total] = await Promise.all([
      this.threads().find(filter).sort({ updatedAt: -1 }).limit(limit + 1).toArray(),
      this.threads().countDocuments(baseFilter),
    ])
    const { items, nextCursor } = paginate(rows, limit, (r) => r.updatedAt.toISOString())
    return { items: items.map(threadToWire), nextCursor, total }
  }

  /** 관리 평가 모아보기의 원천 — 피드백 제출 스텝(stage='action', payload.type='feedback')을
   * 쓰레드 메타와 함께 최신순으로 나열한다. core는 payload를 해석하지 않는다는 원칙대로
   * jsonb(문서) 최상위 type 필터만 걸고, 파싱·최신 판정·집계는 BFF가 맡는다.
   * 페이지네이션 없이 limit 상한 + truncated 신호 — 수동 평가라 건수가 적은 데이터다.
   * Mongo에는 조인이 없어 스텝을 먼저 걸러 정렬한 뒤, 관련 쓰레드를 한 번에 모아 온다
   * (원본 SQL의 INNER JOIN과 같은 효과 — 쓰레드가 없는 스텝은 결과에서 빠진다) */
  async listFeedbackSteps(limit = 300) {
    const actionSteps = await this.steps().find({ stage: 'action' }).toArray()
    const feedback = actionSteps.filter(isFeedbackStep).sort(compareFeedbackSteps)
    const limited = feedback.slice(0, limit + 1)
    const items = limited.slice(0, limit)
    const truncated = limited.length > limit

    const threadIds = [...new Set(items.map((s) => s.threadId))]
    const threadDocs = threadIds.length ? await this.threads().find({ _id: { $in: threadIds } }).toArray() : []
    const threadMap = new Map(threadDocs.map((t) => [t._id, t]))

    const joined = items
      .map((step) => {
        const thread = threadMap.get(step.threadId)
        return thread ? { thread: threadToWire(thread), step: stepToWire(step) } : null
      })
      .filter((row): row is { thread: ReturnType<typeof threadToWire>; step: ReturnType<typeof stepToWire> } => row !== null)
    return { items: joined, truncated }
  }

  /** 전환 판정 계기판의 원천 — 실주행 plan 스텝의 llmMeta만 최신순으로 (엔진·지연·캐시 집계는 BFF 몫) */
  async listPlanMetas(limit = 200) {
    const rows = await this.steps().find({ stage: 'plan' }).sort({ createdAt: -1 }).limit(limit).toArray()
    return { items: rows.map((r) => ({ threadId: r.threadId, createdAt: r.createdAt.toISOString(), llmMeta: r.llmMeta })) }
  }

  /** 관리 페이지용 전체 목록 — archived 포함, id(스노우플레이크) 키셋 커서.
   * id는 유니크·시간 단조라 updatedAt과 달리 동점 없이 깔끔하게 페이징된다 (생성 최신순) */
  async listAll(cursor?: string, limit = 20) {
    const filter: Filter<ThreadDoc> = cursor ? { _id: { $lt: cursor } } : {}
    const rows = await this.threads().find(filter).sort({ _id: -1 }).limit(limit + 1).toArray()
    const { items, nextCursor } = paginate(rows, limit, (r) => r._id)
    return { items: items.map(threadToWire), nextCursor }
  }
}
