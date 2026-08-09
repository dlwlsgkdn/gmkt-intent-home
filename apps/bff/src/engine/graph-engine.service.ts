import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Command } from '@langchain/langgraph'
import type { Answer, PlanPageWire, Profile, SurveyPageWire, ThreadStageFeedback } from '@ddak/schema'
import { LlmGenerationError } from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'
import { KnowledgeService } from '../llm/knowledge.service'
import { LlmService } from '../llm/llm.service'
import { SEQ, intentOf } from '../threads/thread-io'
import type { PlanStreamHandlers, SurveyStreamHandlers } from '../threads/threads.service'
import { buildThreadGraph, type PlanResume, type ThreadGraph } from './graph'
import { getCheckpointer } from './checkpointer'
import { PlanStreamCoordinator, type GraphStreamChunk } from './stream'

/*
 * LangGraph 엔진 서비스 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 2) — ThreadsService와 같은
 * 공개 시그니처(generateSurvey/generatePlan)를 제공해 컨트롤러·FE 계약을 그대로 지킨다.
 *
 * 실행 모델: HTTP 요청 1회 = 그래프 실행 1구간.
 * - 설문: 입력 시딩 후 START부터 실행 → survey 생성 → awaitAnswers interrupt에서 멈춤
 * - 계획: 살아 있는 interrupt가 있으면 Command(resume)로 정식 재개, 없으면(체크포인트
 *   유실·재생성) core에서 시딩해 START부터 재실행 — 멱등 노드(survey 스킵)가 받는다.
 *   체크포인트는 재개 최적화일 뿐, 진실 원천은 언제나 core 스텝이다.
 * 스트리밍: custom 스트림으로 GraphStreamChunk를 소비해 기존 SSE 핸들러에 그대로 변환.
 */
@Injectable()
export class GraphEngineService {
  private readonly logger = new Logger(GraphEngineService.name)
  private compiledP: Promise<ThreadGraph> | null = null

  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private getGraph(): Promise<ThreadGraph> {
    if (!this.compiledP) {
      this.compiledP = getCheckpointer().then((checkpointer) =>
        buildThreadGraph({ llm: this.llm, core: this.core, knowledge: this.knowledge }, checkpointer),
      )
    }
    return this.compiledP
  }

  /** 살아 있는 interrupt(답변 대기)가 있는지 — Command 재개 가능 여부 판정 */
  private async pendingInterrupt(graph: ThreadGraph, config: { configurable: { thread_id: string } }) {
    const snapshot = await graph.getState(config)
    const tasks = (snapshot?.tasks ?? []) as { interrupts?: unknown[] }[]
    return { snapshot, pending: tasks.some((t) => (t.interrupts?.length ?? 0) > 0) }
  }

  /** 그래프 실행이 삼킨 LlmGenerationError를 cause 사슬에서 찾아 되던진다 — SSE 실패 안내 유지 */
  private rethrow(e: unknown): never {
    for (let cur: unknown = e; cur; cur = (cur as { cause?: unknown }).cause) {
      if (cur instanceof LlmGenerationError) throw cur
    }
    throw e
  }

  async generateSurvey(threadId: string, profile?: Profile, stream?: SurveyStreamHandlers): Promise<SurveyPageWire> {
    const graph = await this.getGraph()
    const config = { configurable: { thread_id: threadId } }
    // 멱등 재응답: 이미 설문을 만들고 답변 대기 중이면 재생성 없이 그대로 돌려준다 (SSE 재시도)
    const { snapshot, pending } = await this.pendingInterrupt(graph, config)
    const existing = (snapshot?.values as { survey?: SurveyPageWire } | undefined)?.survey
    if (pending && existing) return existing

    const thread = await this.core.getThread(threadId)
    // 멱등 재응답 2: core에 설문이 있으면 그래프 실행 없이 그대로 돌려준다 — 설문은 쓰레드당
    // 1회 생성으로 불변이고, 완주한 쓰레드를 START부터 재실행하면 잔존 answers 채널 때문에
    // awaitAnswers가 통과해 계획까지 몰래 재생성되는 사고를 막는다
    const coreSurvey =
      (thread.steps.find((s) => s.seq === SEQ.survey)?.payload as { page?: SurveyPageWire } | undefined)?.page ?? null
    if (coreSurvey) return coreSurvey
    const input = {
      threadId,
      userId: thread.userId,
      intent: intentOf(thread),
      profile: profile ?? null,
      survey: null,
    }
    try {
      const chunks = await graph.stream(input, { ...config, streamMode: 'custom' as const })
      for await (const chunk of chunks) this.onSurveyChunk(chunk as GraphStreamChunk, stream)
    } catch (e) {
      this.rethrow(e)
    }
    const after = await graph.getState(config)
    const page = (after?.values as { survey?: SurveyPageWire } | undefined)?.survey
    if (!page) {
      throw new LlmGenerationError('llm_failed', '일시적인 문제로 설문 생성에 실패했어요. 잠시 후 다시 시도해 주세요.', true)
    }
    return page
  }

  async generatePlan(
    threadId: string,
    answers: Answer[],
    profile?: Profile,
    stream?: PlanStreamHandlers,
    feedback?: ThreadStageFeedback,
  ): Promise<PlanPageWire> {
    const graph = await this.getGraph()
    const coord = stream ? new PlanStreamCoordinator() : undefined
    const config = { configurable: { thread_id: threadId, planCoord: coord } }
    const { pending } = await this.pendingInterrupt(graph, config)

    let runInput: Parameters<ThreadGraph['stream']>[0]
    if (pending) {
      // 정식 재개 — awaitAnswers interrupt가 살아 있다 (같은 프로세스 또는 PostgresSaver)
      const resume: PlanResume = { answers, profile, feedback }
      runInput = new Command({ resume }) as Parameters<ThreadGraph['stream']>[0]
    } else {
      // 복구·재생성 경로 — core 스텝에서 상태를 시딩해 START부터 재실행 (survey 노드는 스킵)
      const thread = await this.core.getThread(threadId)
      const survey =
        (thread.steps.find((s) => s.seq === SEQ.survey)?.payload as { page?: SurveyPageWire } | undefined)?.page ?? null
      if (!survey) throw new BadRequestException('설문이 아직 생성되지 않았습니다')
      const prevPlan = feedback
        ? ((thread.steps.find((s) => s.seq === SEQ.plan)?.payload as { page?: PlanPageWire } | undefined)?.page ?? null)
        : null
      runInput = {
        threadId,
        userId: thread.userId,
        intent: intentOf(thread),
        survey,
        answers,
        profile: profile ?? null,
        feedback: feedback ?? null,
        prevPlan,
      }
    }

    try {
      const chunks = await graph.stream(runInput, { ...config, streamMode: 'custom' as const })
      for await (const chunk of chunks) this.onPlanChunk(chunk as GraphStreamChunk, stream)
    } catch (e) {
      this.rethrow(e)
    }
    const after = await graph.getState(config)
    const page = (after?.values as { page?: PlanPageWire } | undefined)?.page
    if (!page) {
      throw new LlmGenerationError('llm_failed', '일시적인 문제로 계획 생성에 실패했어요. 잠시 후 다시 시도해 주세요.', true)
    }
    return page
  }

  private onSurveyChunk(chunk: GraphStreamChunk, stream?: SurveyStreamHandlers) {
    if (!stream) return
    if (chunk.event === 'head' && typeof chunk.data.intro === 'string') stream.onIntro?.(chunk.data.intro)
    else if (chunk.event === 'question') stream.onQuestion?.(chunk.data.question, chunk.data.index)
  }

  private onPlanChunk(chunk: GraphStreamChunk, stream?: PlanStreamHandlers) {
    if (!stream) return
    switch (chunk.event) {
      case 'head':
        stream.onHead?.(chunk.data)
        break
      case 'skeleton':
        stream.onSkeleton?.(chunk.data.page, chunk.data.pending)
        break
      case 'section':
        stream.onSection?.(chunk.data.section, chunk.data.index, chunk.data.final)
        break
      case 'search':
        stream.onSearch?.(chunk.data.query)
        break
    }
  }
}
