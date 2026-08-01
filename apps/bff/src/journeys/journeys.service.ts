import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  Answer,
  JourneyEventBody,
  PlanPageWire,
  PlanSectionWire,
  Profile,
  StartJourneyBody,
  SurveyPageWire,
  ThreadSource,
  ThreadWithSteps,
} from '@ddak/schema'
import { CoreClientService } from '../core-client.service'
import { LlmService } from '../llm/llm.service'
import { CATALOG_BY_ID } from '../llm/catalog'
import type { PlanGen } from '../llm/gen-schemas'

/** 스텝 순번 — (thread, seq)가 멱등 키라 단계별 고정 순번을 쓴다 */
const SEQ = { explore: 1, survey: 2, answers: 3, plan: 4, actionBase: 5 } as const

@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name)

  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
  ) {}

  /** 저니 시작 — 쓰레드 생성 + 탐색 스텝(의도·프로필) 기록 */
  async start(deviceId: string, body: StartJourneyBody) {
    const source: ThreadSource = body.chipId
      ? { kind: 'chip', chipId: body.chipId, query: body.query }
      : { kind: 'search', query: body.query }
    const thread = await this.core.createThread({
      userId: deviceId,
      title: body.title ?? body.query ?? body.chipId,
      source,
    })
    this.recordAsync(thread.id, SEQ.explore, {
      stage: 'explore',
      payload: { source, profile: body.profile ?? null },
    })
    return { threadId: thread.id }
  }

  /** 설문 페이지 생성 (LLM #1) — 생성 결과에 BFF가 질문 id를 부여한다 */
  async generateSurvey(threadId: string, profile?: Profile): Promise<SurveyPageWire> {
    const thread = await this.core.getThread(threadId)
    const intent = intentOf(thread)
    const { content, meta } = await this.llm.generateSurvey(intent, profile)
    const page: SurveyPageWire = {
      intro: content.intro,
      questions: content.questions.map((q, i) => ({ id: `q${i + 1}`, ...q })),
    }
    this.recordAsync(threadId, SEQ.survey, { stage: 'survey', payload: { page }, llmMeta: meta })
    void this.core.updateThread(threadId, { status: 'surveying' }).catch(() => undefined)
    return page
  }

  /** 응답 제출 → 계획 페이지 생성 (LLM #2, 카탈로그 그라운딩) */
  async generatePlan(threadId: string, answers: Answer[], profile?: Profile): Promise<PlanPageWire> {
    const thread = await this.core.getThread(threadId)
    const surveyStep = thread.steps.find((s) => s.seq === SEQ.survey)
    if (!surveyStep) throw new BadRequestException('설문이 아직 생성되지 않았습니다')
    const survey = (surveyStep.payload as { page: SurveyPageWire }).page
    const intent = intentOf(thread)

    const { content, meta } = await this.llm.generatePlan(intent, survey, answers, profile)
    const page = this.resolvePlan(content)

    this.recordAsync(threadId, SEQ.answers, { stage: 'answers', payload: { answers, profile: profile ?? null } })
    this.recordAsync(threadId, SEQ.plan, { stage: 'plan', payload: { page }, llmMeta: meta })
    void this.core.updateThread(threadId, { status: 'planning' }).catch(() => undefined)
    return page
  }

  /** 상품 그라운딩 검증 — 카탈로그 밖 id는 버리고, 빈 상품 섹션은 드롭한다 (§4-3) */
  private resolvePlan(gen: PlanGen): PlanPageWire {
    const sections: PlanSectionWire[] = []
    for (const s of gen.sections) {
      if (s.kind !== 'products') {
        sections.push(s)
        continue
      }
      const products = s.productIds
        .map((id) => CATALOG_BY_ID.get(id))
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
      if (products.length < s.productIds.length) {
        this.logger.warn(`카탈로그 밖 상품 id ${s.productIds.length - products.length}건 드롭`)
      }
      if (products.length) sections.push({ kind: 'products', title: s.title, reason: s.reason, products })
    }
    if (!sections.length) {
      sections.push({ kind: 'guide', title: '준비된 안내', body: gen.summary })
    }
    return { headline: gen.headline, summary: gen.summary, sections }
  }

  /** 담기/완료 등 행동 기록 — 다음 빈 seq에 기록, complete면 상태 갱신 */
  async recordEvent(threadId: string, event: JourneyEventBody) {
    const thread = await this.core.getThread(threadId)
    const nextSeq = Math.max(SEQ.actionBase - 1, ...thread.steps.map((s) => s.seq)) + 1
    await this.core.upsertStep(threadId, nextSeq, {
      stage: 'action',
      payload: { type: event.type, data: event.data ?? null, at: new Date().toISOString() },
    })
    if (event.type === 'complete') {
      await this.core.updateThread(threadId, { status: 'done' })
    }
    return { ok: true }
  }

  /** 이어보기 — 쓰레드 + 단계별 페이지를 FE가 복원하기 좋은 형태로 */
  async get(threadId: string) {
    const thread = await this.core.getThread(threadId)
    const step = (seq: number) => thread.steps.find((s) => s.seq === seq)
    return {
      threadId: thread.id,
      title: thread.title,
      status: thread.status,
      source: thread.source,
      survey: (step(SEQ.survey)?.payload as { page?: SurveyPageWire } | undefined)?.page ?? null,
      answers: (step(SEQ.answers)?.payload as { answers?: Answer[] } | undefined)?.answers ?? null,
      plan: (step(SEQ.plan)?.payload as { page?: PlanPageWire } | undefined)?.page ?? null,
      updatedAt: thread.updatedAt,
    }
  }

  list(deviceId: string, cursor?: string, limit?: number) {
    return this.core.listThreads(deviceId, cursor, limit)
  }

  /** 기록은 사용자 응답을 막지 않는다 — 실패는 로그만 (v1, §3 at-least-once는 추후) */
  private recordAsync(threadId: string, seq: number, body: Parameters<CoreClientService['upsertStep']>[2]) {
    void this.core.upsertStep(threadId, seq, body).catch((e: Error) => {
      this.logger.error(`스텝 기록 실패 thread=${threadId} seq=${seq}: ${e.message}`)
    })
  }
}

function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('저니 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
