import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  Answer,
  LlmMeta,
  ThreadEventBody,
  PlanPageWire,
  PlanSectionWire,
  Profile,
  StartThreadBody,
  SurveyPageWire,
  SurveyQuestionWire,
  ThreadSource,
  ThreadWithSteps,
} from '@ddak/schema'
import { ThreadStageFeedback } from '@ddak/schema'
import {
  ContentsSectionGen,
  GeneratedIndexAllocator,
  PlanSearchSectionGen,
  PlanSectionPartialGen,
  PlanSkeletonSectionGen,
  ProductsSectionGen,
  SurveyQuestionGen,
  SurveyQuestionPartialGen,
  completeSearchSection,
  groundContentsSection,
  groundProductsSection,
  isSlotKind,
  mergePlanSections,
  slotIndexesOf,
} from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'
import { LlmService } from '../llm/llm.service'

/** 스텝 순번 — (thread, seq)가 멱등 키라 단계별 고정 순번을 쓴다 */
const SEQ = { explore: 1, survey: 2, answers: 3, plan: 4, actionBase: 5 } as const

/*
 * 부분 스트리밍 핸들러 — 생성 중인 컴포넌트를 SSE로 미리 내보내기 위한 콜백.
 * 원소는 여기서 단독 검증·그라운딩을 거친 wire 형태로만 나간다 — FE가 그대로 렌더한다.
 * 텍스트는 토큰 단위로 스트리밍된다: 자라는 중인 질문/섹션이 같은 index로 반복 전송되고
 * (FE는 슬롯 덮어쓰기), 완성 시점에 검증 통과한 최종본이 같은 index로 한 번 더 나간다.
 * 어디까지나 미리보기: 최종 result(전체 검증)가 언제나 권위이고, 저장도 result 기준이다.
 */
export type SurveyStreamHandlers = {
  onIntro?: (intro: string) => void
  onQuestion?: (question: SurveyQuestionWire, index: number) => void
}
/** 뼈대 확정 페이지 — 자리(상품·콘텐츠)는 null, pending이 그 인덱스 목록.
 * FE는 이 시점에 계획을 조기 확정하고 자리에는 로딩 카드를 그린다 */
export type PlanSkeletonPageWire = {
  headline: string
  summary: string
  sections: (PlanSectionWire | null)[]
}
export type PlanStreamHandlers = {
  onHead?: (patch: { headline?: string; summary?: string }) => void
  onSkeleton?: (page: PlanSkeletonPageWire, pending: number[]) => void
  /** final=false는 자라는 중인 재전송(상품·콘텐츠 항목 단위 증분) — FE는 최종본(final=true)
   * 이 올 때까지 그 자리를 pending(재생성 게이트)으로 유지한다 */
  onSection?: (section: PlanSectionWire, index: number, final: boolean) => void
  onSearch?: (query: string) => void
}

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

  /** 설문 페이지 생성 (LLM #1) — 생성 결과에 BFF가 질문 id를 부여한다.
   * stream 핸들러가 있으면 질문 하나가 완성될 때마다 미리 내보낸다 (id 부여 규칙 동일 = q{i+1}) */
  async generateSurvey(threadId: string, profile?: Profile, stream?: SurveyStreamHandlers): Promise<SurveyPageWire> {
    const thread = await this.core.getThread(threadId)
    const intent = intentOf(thread)
    const { content, meta } = await this.llm.generateSurvey(
      intent,
      profile,
      stream && {
        arrayKey: 'questions',
        headKeys: ['intro'],
        onHead: (key, value) => {
          if (key === 'intro') stream.onIntro?.(value)
        },
        onHeadPartial: (key, value) => {
          if (key === 'intro') stream.onIntro?.(value)
        },
        onElement: (element, index) => {
          const parsed = SurveyQuestionGen.safeParse(element)
          if (parsed.success) stream.onQuestion?.({ id: `q${index + 1}`, ...parsed.data }, index)
        },
        // 자라는 중인 질문 — 문구가 나오기 시작하면 토큰 단위로 같은 index에 재전송한다
        onElementPartial: (element, index) => {
          const parsed = SurveyQuestionPartialGen.safeParse(element)
          if (!parsed.success || !parsed.data.question) return
          stream.onQuestion?.(
            {
              id: `q${index + 1}`,
              question: parsed.data.question,
              options: parsed.data.options ?? [],
              multi: parsed.data.multi ?? false,
            },
            index,
          )
        },
      },
    )
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

  /** 응답 제출 → 계획 페이지 생성 (LLM #2, 2단계 병렬 — §9-1).
   * 뼈대(검색 없음, 수 초)가 제목·단계 안내·순서와 상품/콘텐츠 "자리"를 확정해 먼저
   * 스트리밍되고, 뼈대가 끝나면 onSkeleton으로 **조기 확정**을 알린다 — FE는 이 시점에
   * 계획을 확정 렌더하고 자리에 로딩 카드를 둔다. 검색 단계(상품+참고 콘텐츠, 웹 검색
   * 포함)는 병렬로 돌아 자리를 나중에 비동기로 채운다 — 섹션 완성을 기다리지 않고
   * 완성·그라운딩 통과한 항목부터 같은 자리에 증분 재전송(final=false)하고, 섹션이 닫히면
   * 최종본(final=true)으로 마감한다. 검색 섹션 스트림은 뼈대 완료로 자리 인덱스가 확정된 뒤
   * 내보낸다 — 실측상 뼈대가 항상 훨씬 먼저 끝난다.
   * feedback(stage='plan')이 오면 피드백 반영 재생성: 저장된 직전 계획과 피드백을 프롬프트에
   * 실어, 지적된 상품은 빼고 웹 검색으로 대안을 찾는다 (카탈로그 밖 상품도 webProducts로) */
  async generatePlan(
    threadId: string,
    answers: Answer[],
    profile?: Profile,
    stream?: PlanStreamHandlers,
    feedback?: ThreadStageFeedback,
  ): Promise<PlanPageWire> {
    const thread = await this.core.getThread(threadId)
    const surveyStep = thread.steps.find((s) => s.seq === SEQ.survey)
    if (!surveyStep) throw new BadRequestException('설문이 아직 생성되지 않았습니다')
    const survey = (surveyStep.payload as { page: SurveyPageWire }).page
    const intent = intentOf(thread)
    // 피드백 반영 재생성 컨텍스트 — 직전 계획은 저장된 plan 스텝에서 (없어도 피드백만으로 진행)
    const revision = feedback
      ? {
          feedback,
          prevPlan:
            (thread.steps.find((s) => s.seq === SEQ.plan)?.payload as { page?: PlanPageWire } | undefined)?.page ??
            null,
        }
      : undefined

    let allocator: GeneratedIndexAllocator | null = null // null = 뼈대 미완 — 검색 섹션은 대기열에 쌓인다
    const arrivedSections: { section: PlanSectionWire; streamIndex: number }[] = [] // 그라운딩 통과분 (도착 순)
    // 검색 스트림 원소 index → 자리 index. 첫 방출(대개 partial)에 배정하고 재전송·최종본이 같은 자리를 쓴다.
    // 검색 스트림은 원소를 순차로 내보내므로 첫 방출 순서 = 완성 순서 — 도착 순 배정 규칙이 유지된다
    const slotByStream = new Map<number, number>()
    const slotFor = (streamIndex: number, kind: string): number => {
      let slot = slotByStream.get(streamIndex)
      if (slot === undefined) {
        slot = (allocator as GeneratedIndexAllocator).next(kind === 'contents' ? 'contents' : 'products')
        slotByStream.set(streamIndex, slot)
      }
      return slot
    }
    let emitted = 0
    const flushGenerated = () => {
      if (!allocator || !stream?.onSection) return
      while (emitted < arrivedSections.length) {
        const { section, streamIndex } = arrivedSections[emitted]
        stream.onSection(section, slotFor(streamIndex, section.kind), true)
        emitted += 1
      }
    }

    const skeletonPromise = this.llm
      .generatePlanSkeleton(
        intent,
        survey,
        answers,
        profile,
        stream && {
          arrayKey: 'sections',
          headKeys: ['headline', 'summary'],
          onHead: (key, value) => stream.onHead?.({ [key]: value }),
          onHeadPartial: (key, value) => stream.onHead?.({ [key]: value }),
          onElement: (element, index) => {
            const parsed = PlanSkeletonSectionGen.safeParse(element)
            if (!parsed.success) return
            // 상품·콘텐츠 자리는 내보내지 않는다 — 검색 단계 결과가 이 인덱스를 차지한다
            if (!isSlotKind(parsed.data.kind)) stream.onSection?.(parsed.data as PlanSectionWire, index, true)
          },
          // 자라는 중인 섹션 — 제목이 나오기 시작하면 토큰 단위로 같은 index에 재전송한다
          onElementPartial: (element, index) => {
            const parsed = PlanSectionPartialGen.safeParse(element)
            if (!parsed.success) return
            const s = parsed.data
            if (!s.title) return
            if (s.kind === 'guide')
              stream.onSection?.({ kind: 'guide', title: s.title, body: s.body ?? '' }, index, false)
            else if (s.kind === 'steps')
              stream.onSection?.({ kind: 'steps', title: s.title, steps: (s.steps ?? []).filter(Boolean) }, index, false)
            // products·contents 자리는 부분도 내보내지 않는다 — 검색 단계 결과가 차지할 인덱스
          },
        },
        revision,
      )
      .then((result) => {
        // 자리 인덱스는 스트림 조각이 아니라 최종 검증본 기준으로 확정한다 (조각 파싱 누락 보정)
        const skeletonSections = result.content.sections
        allocator = new GeneratedIndexAllocator(slotIndexesOf(skeletonSections), skeletonSections.length)
        // 뼈대 조기 확정 알림 — 텍스트 완성본 + 아직 안 채워진 자리 인덱스. 대기열 플러시보다 먼저
        if (stream?.onSkeleton) {
          const pending: number[] = []
          const wireSections = skeletonSections.map((s, i) => {
            if (isSlotKind(s.kind)) {
              pending.push(i)
              return null
            }
            return s as PlanSectionWire
          })
          stream.onSkeleton(
            { headline: result.content.headline, summary: result.content.summary, sections: wireSections },
            pending,
          )
        }
        flushGenerated()
        return result
      })

    const searchPromise = this.llm.generatePlanProducts(
      intent,
      survey,
      answers,
      profile,
      stream && {
        arrayKey: 'sections',
        onElement: (element, index) => {
          const parsed = PlanSearchSectionGen.safeParse(element)
          if (!parsed.success) return
          // 스트림 조각도 최종과 같은 그라운딩을 통과시킨다 — 결정적이라 result와 어긋나지 않는다
          const section =
            parsed.data.kind === 'contents'
              ? this.resolveContentsSection(parsed.data)
              : this.resolveProductsSection(parsed.data, index)
          if (section) {
            arrivedSections.push({ section, streamIndex: index })
            flushGenerated()
          }
        },
        // 자라는 중인 검색 섹션 — 완성된 항목(상품·콘텐츠)만 추려 같은 자리에 증분 재전송한다.
        // 그라운딩이 결정적이고 항목은 앞에서부터 확정되므로, 한 번 나간 카드는 최종본에서 사라지지 않는다
        onElementPartial: (element, index) => {
          // 뼈대 완료(allocator) 전 조각은 버린다 — FE에 아직 자리 카드가 없다 (완성본은 대기열이 보전)
          if (!allocator || !stream.onSection) return
          const gen = completeSearchSection(element)
          if (!gen) return
          const section =
            gen.kind === 'contents'
              ? this.resolveContentsSection(gen, true)
              : this.resolveProductsSection(gen, index, true)
          if (section) stream.onSection(section, slotFor(index, section.kind), false)
        },
        onSearch: stream.onSearch,
      },
      revision,
    )

    const [skeletonSettled, searchSettled] = await Promise.allSettled([skeletonPromise, searchPromise])
    if (skeletonSettled.status === 'rejected') throw skeletonSettled.reason
    const skeleton = skeletonSettled.value

    // 검색 단계 실패는 계획 전체를 죽이지 않는다 — 상품·콘텐츠 없는 계획을 정직하게 반환하고 로그만 남긴다
    let generatedSections: PlanSectionWire[] = []
    let productsMeta: LlmMeta | null = null
    if (searchSettled.status === 'fulfilled') {
      productsMeta = searchSettled.value.meta
      generatedSections = searchSettled.value.content.sections
        .map((s, i) => (s.kind === 'contents' ? this.resolveContentsSection(s) : this.resolveProductsSection(s, i)))
        .filter((s): s is PlanSectionWire => s !== null)
    } else {
      this.logger.warn(
        `계획 검색 단계 실패 — 상품·콘텐츠 없이 계획 반환: ${(searchSettled.reason as Error)?.message ?? searchSettled.reason}`,
      )
    }

    const sections = mergePlanSections(skeleton.content.sections, generatedSections)
    if (!sections.length) {
      sections.push({ kind: 'guide', title: '준비된 안내', body: skeleton.content.summary })
    }
    const page: PlanPageWire = { headline: skeleton.content.headline, summary: skeleton.content.summary, sections }

    await this.persist(
      'plan',
      this.core.upsertStep(threadId, SEQ.answers, {
        stage: 'answers',
        payload: { answers, profile: profile ?? null },
      }),
      this.core.upsertStep(threadId, SEQ.plan, {
        stage: 'plan',
        payload: { page },
        llmMeta: combineMeta(skeleton.meta, productsMeta),
      }),
      this.core.updateThread(threadId, { status: 'planning' }),
    )
    return page
  }

  /** 상품 섹션 그라운딩 검증 — 가드(@ddak/pipeline groundProductsSection)에 위임하고 드롭 사유를 로깅한다.
   * 결정적이라 스트림 조각과 최종 결과가 일치한다 (§4-3). quiet=부분 스트리밍 재호출(로그 중복 방지).
   * 드롭 사유의 스텝 payload(dropLog) 기록은 페이즈 3 */
  private resolveProductsSection(s: ProductsSectionGen, sectionIndex: number, quiet = false): PlanSectionWire | null {
    const { section, drops } = groundProductsSection(s, sectionIndex)
    if (!quiet) drops.forEach((d) => this.logger.warn(d.message))
    return section
  }

  /** 참고 콘텐츠 섹션 그라운딩 검증 — 가드(@ddak/pipeline groundContentsSection) 위임 + 드롭 사유 로깅 */
  private resolveContentsSection(s: ContentsSectionGen, quiet = false): PlanSectionWire | null {
    const { section, drops } = groundContentsSection(s)
    if (!quiet) drops.forEach((d) => this.logger.warn(d.message))
    return section
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
      feedback: latestFeedback(thread),
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

/** 2단계 메타 결합 — usage는 합산, latency는 병렬이라 max. 단계별 소요는 phases로 남긴다 (admin 진단용) */
function combineMeta(skeleton: LlmMeta, products: LlmMeta | null): LlmMeta {
  const sum = (a?: number, b?: number) => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0))
  return {
    model: products?.model ?? skeleton.model,
    promptVersion: skeleton.promptVersion,
    usage: {
      inputTokens: sum(skeleton.usage?.inputTokens, products?.usage?.inputTokens),
      outputTokens: sum(skeleton.usage?.outputTokens, products?.usage?.outputTokens),
      cacheReadTokens: sum(skeleton.usage?.cacheReadTokens, products?.usage?.cacheReadTokens),
      webSearchRequests: products?.usage?.webSearchRequests,
    },
    latencyMs: Math.max(skeleton.latencyMs ?? 0, products?.latencyMs ?? 0),
    phases: { skeletonMs: skeleton.latencyMs ?? null, productsMs: products?.latencyMs ?? null },
  } as LlmMeta
}

/** 단계별 최신 피드백 파생 — action 스텝(type='feedback')은 append 로그라 seq 순회의
 * 마지막 유효 제출이 유효본이다. 형태가 어긋난 옛 기록은 조용히 건너뛴다 */
function latestFeedback(thread: ThreadWithSteps) {
  const feedback: { survey: ThreadStageFeedback | null; plan: ThreadStageFeedback | null } = {
    survey: null,
    plan: null,
  }
  for (const step of thread.steps) {
    if (step.stage !== 'action') continue
    const p = step.payload as { type?: string; data?: unknown; at?: string }
    if (p.type !== 'feedback') continue
    const parsed = ThreadStageFeedback.safeParse(p.data)
    if (!parsed.success) continue
    feedback[parsed.data.stage] = { ...parsed.data, at: p.at ?? parsed.data.at }
  }
  return feedback.survey || feedback.plan ? feedback : null
}

function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('쓰레드 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
