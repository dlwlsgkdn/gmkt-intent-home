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
  SurveyQuestionWire,
  ThreadSource,
  ThreadWithSteps,
} from '@ddak/schema'
import { CoreClientService } from '../core-client.service'
import { LlmService } from '../llm/llm.service'
import { CATALOG_BY_ID } from '../llm/catalog'
import { PlanSectionGen, SurveyQuestionGen, type PlanGen } from '../llm/gen-schemas'

/** 스텝 순번 — (thread, seq)가 멱등 키라 단계별 고정 순번을 쓴다 */
const SEQ = { explore: 1, survey: 2, answers: 3, plan: 4, actionBase: 5 } as const

/*
 * 부분 스트리밍 핸들러 — 생성 중 완성되는 컴포넌트를 SSE로 미리 내보내기 위한 콜백.
 * 원소는 여기서 단독 검증·그라운딩을 거친 "확정 wire 형태"로만 나간다 — FE가 그대로 렌더한다.
 * 어디까지나 미리보기: 최종 result(전체 검증)가 언제나 권위이고, 저장도 result 기준이다.
 */
export type SurveyStreamHandlers = {
  onIntro?: (intro: string) => void
  onQuestion?: (question: SurveyQuestionWire, index: number) => void
}
export type PlanStreamHandlers = {
  onHead?: (patch: { headline?: string; summary?: string }) => void
  onSection?: (section: PlanSectionWire, index: number) => void
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
        onElement: (element, index) => {
          const parsed = SurveyQuestionGen.safeParse(element)
          if (parsed.success) stream.onQuestion?.({ id: `q${index + 1}`, ...parsed.data }, index)
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

  /** 응답 제출 → 계획 페이지 생성 (LLM #2, 카탈로그+웹 그라운딩).
   * stream 핸들러가 있으면 섹션 하나가 완성될 때마다 그라운딩을 거쳐 미리 내보낸다 */
  async generatePlan(
    threadId: string,
    answers: Answer[],
    profile?: Profile,
    stream?: PlanStreamHandlers,
  ): Promise<PlanPageWire> {
    const thread = await this.core.getThread(threadId)
    const surveyStep = thread.steps.find((s) => s.seq === SEQ.survey)
    if (!surveyStep) throw new BadRequestException('설문이 아직 생성되지 않았습니다')
    const survey = (surveyStep.payload as { page: SurveyPageWire }).page
    const intent = intentOf(thread)

    const { content, meta } = await this.llm.generatePlan(
      intent,
      survey,
      answers,
      profile,
      stream && {
        arrayKey: 'sections',
        headKeys: ['headline', 'summary'],
        onHead: (key, value) => stream.onHead?.({ [key]: value }),
        onElement: (element, index) => {
          const parsed = PlanSectionGen.safeParse(element)
          if (!parsed.success) return
          // 스트림 조각도 최종과 같은 그라운딩을 통과시킨다 — 검증은 결정적이라
          // 같은 섹션은 result에서도 같은 모습으로 확정된다 (드롭 섹션은 안 내보냄)
          const section = this.resolveSection(parsed.data, index)
          if (section) stream.onSection?.(section, index)
        },
        onSearch: stream.onSearch,
      },
    )
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

  /** 섹션 하나의 그라운딩 검증 — 카탈로그 밖 id는 버리고, 웹 상품은 URL 검증 통과분만 채택.
   * 상품이 하나도 안 남은 products 섹션은 null(드롭). 결정적이라 스트림 조각과 최종 결과가 일치한다 (§4-3) */
  private resolveSection(s: PlanSectionGen, sectionIndex: number): PlanSectionWire | null {
    if (s.kind !== 'products') return s
    const products: CatalogProduct[] = s.productIds
      .map((id) => CATALOG_BY_ID.get(id))
      .filter((p): p is NonNullable<ReturnType<typeof CATALOG_BY_ID.get>> => Boolean(p))
    if (products.length < s.productIds.length) {
      this.logger.warn(`카탈로그 밖 상품 id ${s.productIds.length - products.length}건 드롭`)
    }
    s.webProducts.forEach((w, webIndex) => {
      const url = parseHttpUrl(w.url)
      if (!url) {
        this.logger.warn(`웹 상품 URL 검증 실패로 드롭: ${w.name} (${w.url})`)
        return
      }
      if (isSearchLikeUrl(url)) {
        this.logger.warn(`웹 상품 URL이 검색/목록 페이지로 보여 드롭 (PDP만 허용): ${w.name} (${w.url})`)
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
    return products.length ? { kind: 'products', title: s.title, reason: s.reason, products } : null
  }

  /** 전체 계획 그라운딩 — 섹션별 resolveSection을 적용하고, 전부 드롭되면 안내로 대체한다 */
  private resolvePlan(gen: PlanGen): PlanPageWire {
    const sections: PlanSectionWire[] = []
    gen.sections.forEach((s, sectionIndex) => {
      const section = this.resolveSection(s, sectionIndex)
      if (section) sections.push(section)
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

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return ['http:', 'https:'].includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

/** 검색 결과·목록 페이지로 보이는 URL 판정 — 상세보기는 PDP만 허용한다 (프롬프트 지시의 서버측 가드).
 * 검색어 쿼리 키나 /search 경로가 있으면 검색 페이지로 본다 — PDP는 보통 상품 번호 키(goodsNo 등)를 쓴다 */
const SEARCH_QUERY_KEYS = new Set(['q', 'query', 'keyword', 'kwd', 'searchterm', 'searchkeyword', 'searchword', 'sq', 'k'])
function isSearchLikeUrl(url: URL): boolean {
  if (/\/(search|srchall|category|display)\b/i.test(url.pathname)) return true
  for (const key of url.searchParams.keys()) {
    if (SEARCH_QUERY_KEYS.has(key.toLowerCase())) return true
  }
  return false
}

function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('쓰레드 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
