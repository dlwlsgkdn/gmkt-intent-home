import { Logger } from '@nestjs/common'
import { END, START, StateGraph, getWriter, interrupt } from '@langchain/langgraph'
import type { BaseCheckpointSaver, LangGraphRunnableConfig } from '@langchain/langgraph'
import type { Answer, PlanSectionWire, Profile, SurveyPageWire, ThreadStageFeedback } from '@ddak/schema'
import {
  LlmGenerationError,
  PlanSearchSectionGen,
  PlanSectionPartialGen,
  PlanSkeletonSectionGen,
  assembleLedger,
  buildSurveyPage,
  checkObjective,
  completeSearchSection,
  groundContentsSection,
  groundProductsSection,
  isSlotKind,
  mergePlanSections,
  surveyStreamHandlers,
  type GroundingDrop,
  type GuardContext,
  type PlanRevisionContext,
} from '@ddak/pipeline'
import type { CoreClientService } from '../core-client.service'
import type { KnowledgeService } from '../llm/knowledge.service'
import type { LlmService } from '../llm/llm.service'
import { SEQ, combineMeta } from '../threads/thread-io'
import { ThreadGraphState, type ThreadGraphStateType } from './state'
import type { ChunkWriter, PlanStreamCoordinator } from './stream'

/*
 * 쓰레드 그래프 (DESIGN-PIPELINE-LANGGRAPH.md §1) — 전략 문서 8단계의 StateGraph 구현.
 *
 *   START → ledger(2) → survey(3) → [interrupt: 답변 대기] → ledgerUpdate(2')
 *         → skeleton(5a) ∥ products(4+5b) → verify(6) → record(7) → END
 *
 * 노드는 얇은 어댑터다: 생성·검증 로직은 @ddak/pipeline과 LlmService(LlmPort)가 소유하고,
 * 노드는 상태를 읽어 호출하고 결과를 상태에 쓴다. 스트리밍은 custom 스트림 writer로,
 * 조율자(PlanStreamCoordinator)는 configurable.planCoord로 요청마다 주입된다.
 *
 * 멱등 규칙: 산출물이 이미 상태에 있으면 노드는 건너뛴다(survey) — 체크포인트가 없어도
 * core에서 시딩한 입력으로 전체 그래프를 재실행할 수 있게 하는 복구 경로의 기반.
 */

/** awaitAnswers interrupt의 재개 값 — 계획 요청 본문이 그대로 실린다 */
export type PlanResume = { answers: Answer[]; profile?: Profile; feedback?: ThreadStageFeedback }

export type GraphDeps = { llm: LlmService; core: CoreClientService; knowledge: KnowledgeService }

const logger = new Logger('ThreadGraph')

/** configurable에서 계획 스트림 조율자 꺼내기 — 없으면 스트리밍 생략 (dry-run 대비) */
function planCoordOf(config: LangGraphRunnableConfig): PlanStreamCoordinator | undefined {
  return (config.configurable as { planCoord?: PlanStreamCoordinator } | undefined)?.planCoord
}

/** 기록 실패는 로그만 남기고 흐름을 실패시키지 않는다 (legacy persist와 동일 정책) */
async function persistAll(label: string, ops: Promise<unknown>[]) {
  const results = await Promise.allSettled(ops)
  for (const r of results) {
    if (r.status === 'rejected') {
      logger.error(`${label} 기록 실패: ${(r.reason as Error)?.message ?? r.reason}`)
    }
  }
}

/** 검색 섹션 그라운딩 + 드롭 로깅 — quiet는 부분 스트리밍 재호출(로그 중복 방지).
 * onDrop이 있으면 드롭 사유를 수집한다 (verify 노드의 dropLog 재료) */
function groundLogged(
  s: PlanSearchSectionGen,
  index: number,
  quiet: boolean,
  guard?: GuardContext,
  onDrop?: (d: GroundingDrop) => void,
): PlanSectionWire | null {
  const { section, drops } =
    s.kind === 'contents' ? groundContentsSection(s, guard) : groundProductsSection(s, index, guard)
  drops.forEach((d) => {
    if (!quiet) logger.warn(d.message)
    onDrop?.(d)
  })
  return section
}

/** 상태에서 확장 게이트 컨텍스트 구성 — 스트리밍(products)과 최종 검증(verify)이 같은 값을 본다 */
function guardOf(state: ThreadGraphStateType): GuardContext {
  return { blocklist: state.blocklist ?? [], ledger: state.ledger ?? null }
}

export function buildThreadGraph(deps: GraphDeps, checkpointer: BaseCheckpointSaver) {
  /** 0단계: 목적어 가드 — 명백히 쓸 수 없는 발화는 LLM 호출 전에 되돌린다 (규칙 기반, 보수적) */
  const objectiveNode = (state: ThreadGraphStateType) => {
    const check = checkObjective(state.intent)
    if (!check.ok) throw new LlmGenerationError('llm_refused', check.message, false)
    return {}
  }

  /** 1단계: 의도 정규화 (LLM, low) — 이미 있으면 건너뛴다. 실패해도 플로우는 계속(fail-open) */
  const intentNode = async (state: ThreadGraphStateType) => {
    if (state.intentProfile) return {}
    try {
      const { content, meta } = await deps.llm.generateIntent(state.intent)
      return { intentProfile: content, intentMeta: meta }
    } catch (e) {
      logger.warn(`의도 정규화 실패 — 없이 진행: ${(e as Error).message}`)
      return { intentProfile: null, intentMeta: null }
    }
  }

  /** 2단계: 제약 원장 조립 — 의도 해석·프로필·답변 + 지식 소스(트렌드 키워드 KV·직전 쓰레드
   * 피드백 압축). 블록리스트도 여기서 굳혀 스트리밍·최종 검증이 같은 목록을 본다 */
  const ledgerNode = async (state: ThreadGraphStateType) => {
    const [trendKeywords, recentFeedback, blocklist] = await Promise.all([
      deps.knowledge.trendKeywords(),
      deps.knowledge.recentFeedbackFor(state.userId, state.threadId),
      deps.knowledge.blocklist(),
    ])
    return {
      ledger: assembleLedger({
        profile: state.profile ?? undefined,
        survey: state.survey ?? undefined,
        answers: state.answers ?? undefined,
        intentProfile: state.intentProfile ?? undefined,
        trendKeywords,
        recentFeedback,
      }),
      blocklist,
    }
  }

  /** 3단계: 설문 생성 (LLM) — 이미 있으면 건너뛴다 (재시도 멱등·복구 시딩) */
  const surveyNode = async (state: ThreadGraphStateType, config: LangGraphRunnableConfig) => {
    if (state.survey) return {}
    const writer = getWriter(config) as ChunkWriter | undefined
    const { content, meta } = await deps.llm.generateSurvey(
      state.intent,
      state.profile ?? undefined,
      writer &&
        surveyStreamHandlers({
          onIntro: (intro) => writer({ event: 'head', data: { intro } }),
          onQuestion: (question, index) => writer({ event: 'question', data: { index, question } }),
        }),
      state.ledger,
    )
    // 질문 자리(사진 질문이 있으면 맨 앞)는 legacy 경로와 같은 규칙 — @ddak/pipeline 소유
    const page: SurveyPageWire = buildSurveyPage(content)
    await persistAll('survey', [
      deps.core.upsertStep(state.threadId, SEQ.survey, { stage: 'survey', payload: { page }, llmMeta: meta }),
      deps.core.updateThread(state.threadId, { status: 'surveying' }),
    ])
    return { survey: page, surveyMeta: meta }
  }

  /** interrupt 경계: 답변 대기 — 설문 요청은 여기서 멈추고, 계획 요청이 재개한다.
   * 복구·재생성 경로(답변이 입력으로 시딩됨)는 interrupt 없이 통과한다 */
  const awaitAnswersNode = (state: ThreadGraphStateType) => {
    if (state.answers?.length) return {}
    const resume = interrupt<{ survey: SurveyPageWire | null }, PlanResume>({ survey: state.survey ?? null })
    return { answers: resume.answers, profile: resume.profile ?? null, feedback: resume.feedback ?? null }
  }

  /** 2단계 갱신: 받은 답을 원장에 굳힌다 (전략 문서 3단계 규칙) */
  const ledgerUpdateNode = ledgerNode

  /** 5a: 계획 뼈대 (LLM, 검색 없음) — 조기 확정 스트리밍 */
  const skeletonNode = async (state: ThreadGraphStateType, config: LangGraphRunnableConfig) => {
    const coord = planCoordOf(config)
    coord?.bind(getWriter(config))
    const revision: PlanRevisionContext | undefined = state.feedback
      ? { feedback: state.feedback, prevPlan: state.prevPlan ?? null }
      : undefined
    const result = await deps.llm.generatePlanSkeleton(
      state.intent,
      state.survey as SurveyPageWire,
      state.answers as Answer[],
      state.profile ?? undefined,
      coord && {
        arrayKey: 'sections',
        headKeys: ['headline', 'summary'],
        onHead: (key, value) => coord.head({ [key]: value }),
        onHeadPartial: (key, value) => coord.head({ [key]: value }),
        onElement: (element, index) => {
          const parsed = PlanSkeletonSectionGen.safeParse(element)
          if (!parsed.success) return
          // 상품·콘텐츠 자리는 내보내지 않는다 — 검색 단계 결과가 이 인덱스를 차지한다
          if (!isSlotKind(parsed.data.kind)) coord.section(parsed.data as PlanSectionWire, index, true)
        },
        // 자라는 중인 섹션 — 제목이 나오기 시작하면 토큰 단위로 같은 index에 재전송한다
        onElementPartial: (element, index) => {
          const parsed = PlanSectionPartialGen.safeParse(element)
          if (!parsed.success) return
          const s = parsed.data
          if (!s.title) return
          if (s.kind === 'guide') coord.section({ kind: 'guide', title: s.title, body: s.body ?? '' }, index, false)
          else if (s.kind === 'steps')
            coord.section({ kind: 'steps', title: s.title, steps: (s.steps ?? []).filter(Boolean) }, index, false)
          // products·contents 자리는 부분도 내보내지 않는다 — 검색 단계 결과가 차지할 인덱스
        },
      },
      revision,
      state.ledger,
    )
    // 자리 인덱스는 스트림 조각이 아니라 최종 검증본 기준으로 확정한다 (조각 파싱 누락 보정)
    coord?.skeletonReady(result.content)
    return { skeleton: result.content, skeletonMeta: result.meta }
  }

  /** 4+5b: 근거 수집(웹 검색 병행) + 상품·콘텐츠 섹션 (LLM) — 실패해도 계획을 죽이지 않는다 */
  const productsNode = async (state: ThreadGraphStateType, config: LangGraphRunnableConfig) => {
    const coord = planCoordOf(config)
    coord?.bind(getWriter(config))
    const revision: PlanRevisionContext | undefined = state.feedback
      ? { feedback: state.feedback, prevPlan: state.prevPlan ?? null }
      : undefined
    try {
      const result = await deps.llm.generatePlanProducts(
        state.intent,
        state.survey as SurveyPageWire,
        state.answers as Answer[],
        state.profile ?? undefined,
        coord && {
          arrayKey: 'sections',
          onElement: (element, index) => {
            const parsed = PlanSearchSectionGen.safeParse(element)
            if (!parsed.success) return
            // 스트림 조각도 최종과 같은 그라운딩·확장 게이트를 통과시킨다 — 결정적이라 result와 어긋나지 않는다
            const section = groundLogged(parsed.data, index, false, guardOf(state))
            if (section) coord.searchArrived(section, index)
          },
          // 자라는 중인 검색 섹션 — 완성된 항목만 추려 같은 자리에 증분 재전송한다
          onElementPartial: (element, index) => {
            const gen = completeSearchSection(element)
            if (!gen) return
            const section = groundLogged(gen, index, true, guardOf(state))
            if (section) coord.searchPartial(section, index)
          },
          onSearch: (query) => coord.search(query),
        },
        revision,
        state.ledger,
      )
      return { searchSections: result.content.sections, productsMeta: result.meta, productsFailed: null }
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      logger.warn(`계획 검색 단계 실패 — 상품·콘텐츠 없이 계획 반환: ${message}`)
      return { searchSections: [], productsMeta: null, productsFailed: message }
    }
  }

  /** 6단계: 검증 게이트 — 그라운딩+확장 게이트(블록리스트·의학 단정·원장 역대조) 통과분만
   * 뼈대 자리에 병합 (결정적). 드롭 사유는 dropLog로 수집 — "드롭 사유는 그대로 품질 로그로" */
  const verifyNode = (state: ThreadGraphStateType) => {
    const skeleton = state.skeleton
    if (!skeleton) throw new Error('계획 뼈대가 없습니다 — skeleton 노드가 실패했는데 verify에 도달했습니다')
    const dropLog: GroundingDrop[] = []
    const generated = (state.searchSections ?? [])
      .map((s, i) => groundLogged(s, i, false, guardOf(state), (d) => dropLog.push(d)))
      .filter((s): s is PlanSectionWire => s !== null)
    const sections = mergePlanSections(skeleton.sections, generated)
    if (!sections.length) {
      sections.push({ kind: 'guide', title: '준비된 안내', body: skeleton.summary })
    }
    return { page: { headline: skeleton.headline, summary: skeleton.summary, sections }, dropLog }
  }

  /** 7단계: 쓰레드 기록 — 화면에 흘러간 조각과 저장 결과 일치가 불변식.
   * 원장 스냅샷·dropLog를 payload에 함께 남긴다 (관리 페이지·평가의 품질 로그 재료) */
  const recordNode = async (state: ThreadGraphStateType) => {
    await persistAll('plan', [
      deps.core.upsertStep(state.threadId, SEQ.answers, {
        stage: 'answers',
        payload: { answers: state.answers, profile: state.profile ?? null },
      }),
      deps.core.upsertStep(state.threadId, SEQ.plan, {
        stage: 'plan',
        payload: { page: state.page, ledger: state.ledger ?? null, dropLog: state.dropLog ?? [] },
        llmMeta: combineMeta(state.skeletonMeta!, state.productsMeta ?? null, 'langgraph'),
      }),
      deps.core.updateThread(state.threadId, { status: 'planning' }),
    ])
    return {}
  }

  // 노드 이름은 전략 문서 단계 번호를 접두로 쓴다 — 상태 채널 이름(ledger·survey…)과
  // 겹치면 LangGraph가 거부하고, 스튜디오(페이즈 4)가 이 이름을 단계 카드로 그대로 보여준다
  return new StateGraph(ThreadGraphState)
    .addNode('s0-objective', objectiveNode)
    .addNode('s1-intent', intentNode)
    .addNode('s2-ledger', ledgerNode)
    .addNode('s3-survey', surveyNode)
    .addNode('await-answers', awaitAnswersNode)
    .addNode('s2-ledger-update', ledgerUpdateNode)
    .addNode('s5a-skeleton', skeletonNode)
    .addNode('s5b-products', productsNode)
    .addNode('s6-verify', verifyNode)
    .addNode('s7-record', recordNode)
    .addEdge(START, 's0-objective')
    .addEdge('s0-objective', 's1-intent')
    .addEdge('s1-intent', 's2-ledger')
    .addEdge('s2-ledger', 's3-survey')
    .addEdge('s3-survey', 'await-answers')
    .addEdge('await-answers', 's2-ledger-update')
    .addEdge('s2-ledger-update', 's5a-skeleton')
    .addEdge('s2-ledger-update', 's5b-products')
    .addEdge(['s5a-skeleton', 's5b-products'], 's6-verify')
    .addEdge('s6-verify', 's7-record')
    .addEdge('s7-record', END)
    .compile({ checkpointer })
}

export type ThreadGraph = ReturnType<typeof buildThreadGraph>
