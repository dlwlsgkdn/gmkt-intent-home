import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { Command, MemorySaver } from '@langchain/langgraph'
import type { AdminFlowRunBody, Answer, LlmMeta, PlanPageWire, Profile, SurveyPageWire } from '@ddak/schema'
import {
  LlmGenerationError,
  buildIntentRequest,
  buildPlanProductsRequest,
  buildPlanSkeletonRequest,
  buildSurveyRequest,
  isSlotKind,
  type ConstraintLedger,
  type GroundingDrop,
  type PromptDefId,
} from '@ddak/pipeline'
import type { CoreClientService } from '../core-client.service'
import { KnowledgeService } from '../llm/knowledge.service'
import { LlmService } from '../llm/llm.service'
import type { DryRunPromptTrace } from './dry-run.service'
import { buildThreadGraph, type ThreadGraph } from './graph'
import { PlanStreamCoordinator, type GraphStreamChunk } from './stream'
import type { ThreadGraphStateType } from './state'

/*
 * 파이프라인 플레이그라운드 전체 플로우 실행 (flow-run) — 단계 단독 dry-run과 달리
 * **실제 LangGraph 그래프를 통째로** 돈다: 병렬(5a∥5b)·interrupt(답변 대기)·검증 게이트까지
 * 운영과 같은 토폴로지다. 다른 점은 기록뿐 — core는 no-op 스텁(쓰레드·스텝 기록 없음),
 * 체크포인터는 전용 MemorySaver(운영 lg 스키마와 격리, 유실 시 body 시딩 재실행 폴백).
 *
 * 실시간 관측: updates 스트림(노드 완료마다 개별 청크 — 병렬 노드도 각자 완료 시점에 도착)을
 * 단계 이벤트(onStage)로 바꾸고, LLM 단계 시작 이벤트에는 실행 직전에 재구성한 실제 프롬프트
 * (resolveSystem + build*Request — 노드가 소비하는 것과 같은 순수 함수·같은 입력)를 싣는다.
 * custom 스트림(설문 질문·계획 섹션 조각)은 onContent로 그대로 흘린다.
 */

/** 플로우 실행 소유자 표식 — 지식 서비스의 직전 피드백 조회에서 자연히 빈 결과가 된다 */
const FLOW_USER = 'ops-playground'

/** 그래프 노드 이름 → 다이어그램 단계 id (PIPELINE_STAGES · 'gate'=답변 대기) */
const NODE_STAGE: Record<string, string> = {
  's0-objective': 'objective',
  's1-intent': 'intent',
  's2-ledger': 'ledger',
  's3-survey': 'survey',
  'await-answers': 'gate',
  's2-ledger-update': 'ledger',
  's5a-skeleton': 'plan-skeleton',
  's5b-products': 'plan-products',
  's6-verify': 'verify',
  's7-record': 'record',
}

/** 노드 완료 → 다음에 시작하는 노드 (합류(verify)는 5a·5b 둘 다 완료 시 — markDone에서 처리) */
const SUCCESSORS: Record<string, string[]> = {
  's0-objective': ['s1-intent'],
  's1-intent': ['s2-ledger'],
  's2-ledger': ['s3-survey'],
  's3-survey': [],
  'await-answers': ['s2-ledger-update'],
  's2-ledger-update': ['s5a-skeleton', 's5b-products'],
  's5a-skeleton': [],
  's5b-products': [],
  's6-verify': ['s7-record'],
  's7-record': [],
}

export type FlowStageWireEvent = {
  /** 다이어그램 노드 id (PipelineStageId | 'gate') */
  id: string
  phase: 'start' | 'done'
  meta?: LlmMeta | null
  /** LLM 단계 실행 직전의 실제 프롬프트 — start 이벤트에 실린다 */
  prompt?: DryRunPromptTrace
  summary?: string
  /** verify — 병합 통과 섹션/드롭 수 */
  pass?: number
  drops?: number
}

export type FlowRunEvents = {
  onStatus?: (message: string) => void
  onStage?: (event: FlowStageWireEvent) => void
  onContent?: (chunk: GraphStreamChunk) => void
}

export type FlowRunResult = {
  phase: AdminFlowRunBody['phase']
  flowId: string
  ledger: ConstraintLedger | null
  /** phase=survey */
  survey?: SurveyPageWire | null
  meta?: LlmMeta | null
  /** phase=plan — 검증 게이트까지 지난 최종 병합 페이지 */
  page?: PlanPageWire | null
  dropLog?: GroundingDrop[]
  skeletonMeta?: LlmMeta | null
  productsMeta?: LlmMeta | null
  productsFailed?: string | null
}

type StatePatch = Partial<ThreadGraphStateType>

/** 노드 수명 이벤트 방출기 — 프롬프트 재구성용 상태를 누적하며 start/done을 중복 없이 내보낸다 */
class FlowStageEmitter {
  private readonly started = new Set<string>()
  private readonly done = new Set<string>()
  private readonly acc: {
    intent: string
    profile: Profile | null
    ledger: ConstraintLedger | null
    survey: SurveyPageWire | null
    answers: Answer[] | null
  }

  constructor(
    private readonly llm: LlmService,
    private readonly events: FlowRunEvents,
    seed: { intent: string; profile: Profile | null; survey: SurveyPageWire | null; answers: Answer[] | null },
  ) {
    this.acc = { ledger: null, ...seed }
  }

  /** LLM 노드의 실행 직전 프롬프트 재구성 — 노드가 소비하는 것과 같은 빌더·같은 입력 */
  private async promptFor(node: string): Promise<DryRunPromptTrace | undefined> {
    const build: Record<string, { id: PromptDefId; user: () => string | null }> = {
      's1-intent': { id: 'intent', user: () => buildIntentRequest(this.acc.intent) },
      's3-survey': {
        id: 'survey',
        user: () => buildSurveyRequest(this.acc.intent, this.acc.profile ?? undefined, this.acc.ledger),
      },
      's5a-skeleton': {
        id: 'plan-skeleton',
        user: () =>
          this.acc.survey && this.acc.answers
            ? buildPlanSkeletonRequest(
                this.acc.intent,
                this.acc.survey,
                this.acc.answers,
                this.acc.profile ?? undefined,
                undefined,
                this.acc.ledger,
              )
            : null,
      },
      's5b-products': {
        id: 'plan-products',
        user: () =>
          this.acc.survey && this.acc.answers
            ? buildPlanProductsRequest(
                this.acc.intent,
                this.acc.survey,
                this.acc.answers,
                this.acc.profile ?? undefined,
                undefined,
                this.acc.ledger,
              )
            : null,
      },
    }
    const def = build[node]
    if (!def) return undefined
    const user = def.user()
    if (user == null) return undefined
    const system = await this.llm.resolveSystem(def.id)
    return { promptId: def.id, system: system.text, custom: system.custom, user }
  }

  async start(node: string) {
    if (this.started.has(node)) return
    this.started.add(node)
    this.events.onStage?.({ id: NODE_STAGE[node] ?? node, phase: 'start', prompt: await this.promptFor(node) })
  }

  /** custom 스트림의 뼈대 조기 확정 — 5a 완료를 updates보다 먼저 알린다 (meta는 updates가 보강) */
  onCustom(chunk: GraphStreamChunk) {
    if (chunk.event === 'skeleton') {
      const sections = chunk.data.page.sections
      this.events.onStage?.({
        id: 'plan-skeleton',
        phase: 'done',
        summary: `뼈대 조기 확정 — 섹션 ${sections.length} · 자리 ${chunk.data.pending.length}`,
      })
    } else if (chunk.event === 'search') {
      this.events.onStatus?.(`웹에서 "${chunk.data.query}" 검색 중…`)
    }
  }

  async onUpdates(chunk: Record<string, unknown>) {
    for (const [node, rawPatch] of Object.entries(chunk)) {
      if (node === '__interrupt__') {
        this.events.onStage?.({ id: 'gate', phase: 'start', summary: '답변 대기 — interrupt' })
        continue
      }
      if (!(node in NODE_STAGE)) continue
      const patch = (rawPatch ?? {}) as StatePatch
      if (patch.ledger) this.acc.ledger = patch.ledger
      if (patch.survey) this.acc.survey = patch.survey
      if (patch.answers) this.acc.answers = patch.answers
      if (patch.profile) this.acc.profile = patch.profile
      await this.markDone(node, patch)
    }
  }

  private async markDone(node: string, patch: StatePatch) {
    if (!this.done.has(node)) {
      this.done.add(node)
      this.events.onStage?.({ id: NODE_STAGE[node] ?? node, phase: 'done', ...this.doneDetail(node, patch) })
    }
    for (const next of SUCCESSORS[node] ?? []) await this.start(next)
    // 병렬 합류 — 5a·5b 둘 다 끝나야 verify가 시작된다
    if (this.done.has('s5a-skeleton') && this.done.has('s5b-products')) await this.start('s6-verify')
  }

  private doneDetail(node: string, patch: StatePatch): Omit<FlowStageWireEvent, 'id' | 'phase'> {
    switch (node) {
      case 's0-objective':
        return { summary: '목적어 가드 통과' }
      case 's1-intent':
        return {
          meta: patch.intentMeta ?? undefined,
          summary: patch.intentProfile
            ? [patch.intentProfile.template, patch.intentProfile.goal].filter(Boolean).join(' · ')
            : '해석 없이 진행 (fail-open)',
        }
      case 's2-ledger':
      case 's2-ledger-update':
        return patch.ledger
          ? {
              summary: `사실 ${patch.ledger.facts.length} · 키워드 ${patch.ledger.trendKeywords.length} · 기피 ${patch.ledger.avoid.length}`,
            }
          : {}
      case 's3-survey':
        return {
          meta: patch.surveyMeta ?? undefined,
          summary: patch.survey ? `질문 ${patch.survey.questions.length}개` : '기존 설문 재사용 (멱등 스킵)',
        }
      case 'await-answers':
        return { summary: patch.answers ? `답변 ${patch.answers.length}개 수신 — 재개` : '답변 있음 — 통과' }
      case 's5a-skeleton':
        return {
          meta: patch.skeletonMeta ?? undefined,
          summary: patch.skeleton
            ? `섹션 ${patch.skeleton.sections.length} · 자리 ${patch.skeleton.sections.filter((s) => isSlotKind(s.kind)).length}`
            : undefined,
        }
      case 's5b-products':
        return patch.productsFailed
          ? { summary: `실패 — 상품 없이 진행: ${patch.productsFailed}` }
          : { meta: patch.productsMeta ?? undefined, summary: `검색 섹션 ${patch.searchSections?.length ?? 0}` }
      case 's6-verify':
        return {
          pass: patch.page?.sections.length ?? 0,
          drops: patch.dropLog?.length ?? 0,
          summary: `병합 ${patch.page?.sections.length ?? 0}섹션 · 드롭 ${patch.dropLog?.length ?? 0}`,
        }
      case 's7-record':
        return { summary: '기록 생략 — 플레이그라운드 (core 스텁)' }
      default:
        return {}
    }
  }
}

@Injectable()
export class PipelineFlowRunService {
  private readonly logger = new Logger(PipelineFlowRunService.name)
  private graph: ThreadGraph | null = null

  constructor(
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** 플로우 전용 그래프 — core 쓰기는 no-op 스텁, 체크포인터는 전용 MemorySaver.
   * (MemorySaver는 프로세스 수명 — 플레이그라운드 저빈도 사용 전제. 인스턴스가 갈리면
   * plan 페이즈가 body 시딩 재실행 폴백을 탄다) */
  private getGraph(): ThreadGraph {
    if (!this.graph) {
      const stubCore = {
        upsertStep: async () => null,
        updateThread: async () => null,
      } as unknown as CoreClientService
      this.graph = buildThreadGraph({ llm: this.llm, core: stubCore, knowledge: this.knowledge }, new MemorySaver())
    }
    return this.graph
  }

  /** 그래프 실행이 삼킨 LlmGenerationError를 cause 사슬에서 찾아 되던진다 (엔진 서비스와 동일) */
  private rethrow(e: unknown): never {
    for (let cur: unknown = e; cur; cur = (cur as { cause?: unknown }).cause) {
      if (cur instanceof LlmGenerationError) throw cur
    }
    throw e
  }

  async run(body: AdminFlowRunBody, events: FlowRunEvents = {}): Promise<FlowRunResult> {
    const graph = this.getGraph()
    const flowId = body.phase === 'survey' ? `flow-${randomUUID()}` : body.flowId
    if (!flowId) throw new BadRequestException('plan 페이즈에는 flowId(설문 페이즈 응답)가 필요합니다')
    const coord = new PlanStreamCoordinator()
    const config = { configurable: { thread_id: flowId, planCoord: coord } }

    const emitter = new FlowStageEmitter(this.llm, events, {
      intent: body.intent,
      profile: body.profile ?? null,
      survey: body.survey ?? null,
      answers: body.answers ?? null,
    })

    let runInput: Parameters<ThreadGraph['stream']>[0]
    if (body.phase === 'survey') {
      runInput = {
        threadId: flowId,
        userId: FLOW_USER,
        intent: body.intent,
        profile: body.profile ?? null,
        survey: null,
      }
      await emitter.start('s0-objective')
    } else {
      if (!body.answers?.length) throw new BadRequestException('plan 페이즈에는 answers가 필요합니다')
      const snapshot = await graph.getState(config)
      const tasks = (snapshot?.tasks ?? []) as { interrupts?: unknown[] }[]
      const pending = tasks.some((t) => (t.interrupts?.length ?? 0) > 0)
      if (pending) {
        // 정식 재개 — 체크포인트의 설문을 프롬프트 재구성 재료로 가져온다
        const values = (snapshot?.values ?? {}) as StatePatch
        if (values.survey) await emitter.onUpdates({ 's3-survey': { survey: values.survey } })
        runInput = new Command({
          resume: { answers: body.answers, profile: body.profile },
        }) as Parameters<ThreadGraph['stream']>[0]
      } else {
        // 체크포인트 유실(다른 인스턴스·재기동) — body 시딩으로 START부터 재실행 (survey 멱등 스킵)
        if (!body.survey) {
          throw new BadRequestException('플로우가 만료됐습니다 — 설문 페이즈부터 다시 실행해 주세요')
        }
        events.onStatus?.('플로우 상태가 만료돼 시딩 재실행해요 (설문은 재사용, 그래프 복구 경로)')
        runInput = {
          threadId: flowId,
          userId: FLOW_USER,
          intent: body.intent,
          survey: body.survey,
          answers: body.answers,
          profile: body.profile ?? null,
          feedback: null,
          prevPlan: null,
        }
        await emitter.start('s0-objective')
      }
    }

    try {
      const chunks = await graph.stream(runInput, { ...config, streamMode: ['custom', 'updates'] as const })
      for await (const raw of chunks) {
        const [mode, chunk] = raw as ['custom', GraphStreamChunk] | ['updates', Record<string, unknown>]
        if (mode === 'custom') {
          events.onContent?.(chunk as GraphStreamChunk)
          emitter.onCustom(chunk as GraphStreamChunk)
        } else {
          await emitter.onUpdates(chunk as Record<string, unknown>)
        }
      }
    } catch (e) {
      this.rethrow(e)
    }

    const after = await graph.getState(config)
    const values = (after?.values ?? {}) as StatePatch
    if (body.phase === 'survey') {
      if (!values.survey) {
        throw new LlmGenerationError('llm_failed', '일시적인 문제로 설문 생성에 실패했어요. 잠시 후 다시 시도해 주세요.', true)
      }
      return {
        phase: 'survey',
        flowId,
        survey: values.survey,
        ledger: values.ledger ?? null,
        meta: values.surveyMeta ?? null,
      }
    }
    if (!values.page) {
      throw new LlmGenerationError('llm_failed', '일시적인 문제로 계획 생성에 실패했어요. 잠시 후 다시 시도해 주세요.', true)
    }
    return {
      phase: 'plan',
      flowId,
      page: values.page,
      dropLog: values.dropLog ?? [],
      ledger: values.ledger ?? null,
      skeletonMeta: values.skeletonMeta ?? null,
      productsMeta: values.productsMeta ?? null,
      productsFailed: values.productsFailed ?? null,
    }
  }
}
