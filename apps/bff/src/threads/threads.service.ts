import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  Answer,
  CatalogProduct,
  ThreadEventBody,
  PlanPageWire,
  PlanSectionWire,
  Profile,
  StartThreadBody,
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
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name)

  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
  ) {}

  /** 쓰레드 시작 — 생성 + 탐색 스텝(의도·프로필) 기록 */
  async start(deviceId: string, body: StartThreadBody) {
    const source: ThreadSource = body.chipId
      ? { kind: 'chip', chipId: body.chipId, query: body.query }
      : { kind: 'search', query: body.query }
    const thread = await this.core.createThread({
      userId: deviceId,
      title: body.title ?? body.query ?? body.chipId,
      source,
    })
    await this.persist(
      'explore',
      this.core.upsertStep(thread.id, SEQ.explore, {
        stage: 'explore',
        payload: { source, profile: body.profile ?? null },
      }),
    )
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
    await this.persist(
      'survey',
      this.core.upsertStep(threadId, SEQ.survey, { stage: 'survey', payload: { page }, llmMeta: meta }),
      this.core.updateThread(threadId, { status: 'surveying' }),
    )
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

    await this.persist(
      'plan',
      this.core.upsertStep(threadId, SEQ.answers, {
        stage: 'answers',
        payload: { answers, profile: profile ?? null },
      }),
      this.core.upsertStep(threadId, SEQ.plan, { stage: 'plan', payload: { page }, llmMeta: meta }),
      this.core.updateThread(threadId, { status: 'planning' }),
    )
    return page
  }

  /** 상품 그라운딩 검증 — 카탈로그 밖 id는 버리고, 웹 상품은 URL 검증 통과분만 채택하고,
   * 빈 상품 섹션은 드롭한다 (§4-3). 웹 상품은 검색 결과 기반이라 상품명·가격을 그대로 싣되
   * url이 http(s)가 아니면 지어낸 것으로 보고 버린다 */
  private resolvePlan(gen: PlanGen): PlanPageWire {
    const sections: PlanSectionWire[] = []
    gen.sections.forEach((s, sectionIndex) => {
      if (s.kind !== 'products') {
        sections.push(s)
        return
      }
      const products: CatalogProduct[] = s.productIds
        .map((id) => CATALOG_BY_ID.get(id))
        .filter((p): p is NonNullable<ReturnType<typeof CATALOG_BY_ID.get>> => Boolean(p))
      if (products.length < s.productIds.length) {
        this.logger.warn(`카탈로그 밖 상품 id ${s.productIds.length - products.length}건 드롭`)
      }
      s.webProducts.forEach((w, webIndex) => {
        if (!isHttpUrl(w.url)) {
          this.logger.warn(`웹 상품 URL 검증 실패로 드롭: ${w.name} (${w.url})`)
          return
        }
        products.push({
          id: `web-${sectionIndex}-${webIndex}`,
          name: w.name,
          brand: w.brand,
          price: w.price,
          tags: w.tags,
          url: w.url,
          mall: w.mall.trim() || '외부몰',
        })
      })
      if (products.length) sections.push({ kind: 'products', title: s.title, reason: s.reason, products })
    })
    if (!sections.length) {
      sections.push({ kind: 'guide', title: '준비된 안내', body: gen.summary })
    }
    return { headline: gen.headline, summary: gen.summary, sections }
  }

  /** 담기/완료 등 행동 기록 — 다음 빈 seq에 기록, complete면 상태 갱신 */
  async recordEvent(threadId: string, event: ThreadEventBody) {
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

  /*
   * 기록 실패는 로그만 남기고 응답을 실패시키지 않는다 — 단, fire-and-forget은 금지.
   * Vercel 서버리스는 응답 종료 직후 실행을 동결하므로, 응답 전에 완료를 기다려야
   * 스텝이 유실되지 않는다 (SSE status가 선행해 체감 지연은 없다).
   */
  private async persist(label: string, ...ops: Promise<unknown>[]) {
    const results = await Promise.allSettled(ops)
    for (const r of results) {
      if (r.status === 'rejected') {
        this.logger.error(`${label} 기록 실패: ${(r.reason as Error)?.message ?? r.reason}`)
      }
    }
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(raw).protocol)
  } catch {
    return false
  }
}

function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('쓰레드 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
