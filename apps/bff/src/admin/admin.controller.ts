import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  AdminCatalogHarvestResult,
  AdminCatalogImportBody,
  AdminCatalogImportResult,
  AdminCatalogSeedSearchBody,
  AdminCatalogSeedSearchResult,
  AdminCatalogVerifyResult,
  AdminCatalogWire,
  CatalogSeedJobWire,
  StartCatalogSeedJobBody,
  AdminDryRunBody,
  AdminChangesWire,
  type AdminChangeEntry,
  AdminEngineMetricsWire,
  AdminFlowRunBody,
  AdminFeedbackEntry,
  AdminFeedbackWire,
  AdminKnowledgeEntry,
  AdminModelWire,
  AdminPipelineWire,
  AdminPromptId,
  AdminPromptTrialDecisionBody,
  AdminPromptTrialRecord,
  AdminPromptsWire,
  AssistAdminPromptBody,
  AssistAdminPromptResult,
  AssistPromptFlowBody,
  AssistPromptFlowResult,
  ApplyPromptFlowBody,
  type AdminPromptRevision,
  EvalCasesWire,
  EvalRunsWire,
  PromoteEvalCaseBody,
  type EvalJudgeRubricEntry,
  PutAdminEngineBody,
  PostAdminKnowledgeSourceBody,
  PutAdminKnowledgeBody,
  PutAdminModelBody,
  PutAdminPromptBody,
  RunEvalCaseBody,
  ScoreEvalRunBody,
  SaveAdminPromptTrialBody,
  Thread,
  ThreadListPage,
  ThreadStageFeedback,
  ThreadWithSteps,
  type Answer,
  type PlanPageWire,
  type Profile,
  type SurveyPageWire,
} from '@ddak/schema'
import { CoreClientService } from '../core-client.service'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ParseThreadIdPipe } from '../common/thread-id.pipe'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { DEFAULT_MODEL, LLM_MODEL_SETTING_KEY, LlmService, MODEL_OPTIONS, promptSettingKey } from '../llm/llm.service'
import {
  CUSTOM_KNOWLEDGE_SETTING_KEY,
  GUARD_BLOCKLIST_SETTING_KEY,
  GUARD_CONTENT_HOSTS_SETTING_KEY,
  JudgeGen,
  JudgeSurveyGen,
  KNOWLEDGE_SOURCES,
  LlmGenerationError,
  PIPELINE_STAGES,
  PROMPT_DEFS,
  PROMPT_VERSION,
  RESERVED_PLACEHOLDERS,
  buildJudgeRequest,
  buildJudgeSurveyRequest,
  catalogTermsOf,
  harvestRowsOf,
  customKnowledgeId,
  customKnowledgeSettingKey,
  judgeRubricEntries,
  judgeSurveyRubricEntries,
  knowledgeSettingKey,
  consolidateSmallProductSections,
  mergePlanSections,
  planQualityOf,
  normalizePlaceholderToken,
  parseCustomSources,
  serializeCustomSources,
} from '@ddak/pipeline'
import { SEQ, combineMeta, intentOf } from '../threads/thread-io'
import { KnowledgeService } from '../llm/knowledge.service'
import { ENGINE_SETTING_KEY, EngineFlagService } from '../engine/engine-flag.service'
import { PipelineDryRunService } from '../engine/dry-run.service'
import { PipelineFlowRunService } from '../engine/flow-run.service'
import { CatalogService } from '../catalog/catalog.service'
import { CatalogSeedJobService } from '../catalog/seed-job.service'
import { openSse, sseClose, sseSend, type SseRes } from '../threads/sse'

const THREAD_ID_PARAM = {
  name: 'id',
  description: '스노우플레이크 threadId (19자리 십진 문자열)',
  example: '2195943212345678901',
} as const

const PROMPT_HISTORY_LIMIT = 12
const promptHistorySettingKey = (id: string) => `llm-prompt-history-${id}`
const ADMIN_CHANGE_LOG_KEY = 'admin-change-log'
const ADMIN_CHANGE_LOG_LIMIT = 100
const PROMPT_TRIAL_USER = 'ops-playground'

const summarizePromptChange = (before: string, after: string, next: string | null) => {
  if (next === null) return '기본 지시서로 복구'
  const beforeLines = new Set(before.split('\n').map((line) => line.trim()).filter(Boolean))
  const added = after
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !beforeLines.has(line))
  if (added.length) {
    const sample = added[0].length > 80 ? `${added[0].slice(0, 80)}…` : added[0]
    return `“${sample}” 추가`
  }
  return '지시서 문구 수정'
}

const parsePromptHistory = (value: unknown): AdminPromptRevision[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (entry): entry is AdminPromptRevision =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as AdminPromptRevision).id === 'string' &&
        typeof (entry as AdminPromptRevision).at === 'string' &&
        (typeof (entry as AdminPromptRevision).text === 'string' || (entry as AdminPromptRevision).text === null) &&
        typeof (entry as AdminPromptRevision).note === 'string',
    )
    .slice(0, PROMPT_HISTORY_LIMIT)
}

const parseAdminChanges = (value: unknown): AdminChangeEntry[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is AdminChangeEntry => {
      if (!entry || typeof entry !== 'object') return false
      const row = entry as AdminChangeEntry
      return (
        typeof row.id === 'string' &&
        typeof row.at === 'string' &&
        ['prompt', 'model', 'engine', 'knowledge'].includes(row.area) &&
        ['update', 'create', 'delete', 'restore'].includes(row.action) &&
        typeof row.targetId === 'string' &&
        typeof row.targetLabel === 'string' &&
        typeof row.summary === 'string' &&
        (typeof row.before === 'string' || row.before === null) &&
        (typeof row.after === 'string' || row.after === null) &&
        typeof row.restorable === 'boolean'
      )
    })
    .slice(0, ADMIN_CHANGE_LOG_LIMIT)
}

/*
 * admin API — 스튜디오 운영 콘솔(#ops) 전용.
 * 가드는 ServiceTokenGuard(스튜디오 프록시 경유 강제)뿐 — 옛 x-admin-token(사람이 아는
 * 관리 토큰) 이중 가드는 뗐다. 스튜디오를 열 수 있으면 누구나 관리 페이지도 쓸 수 있다.
 * 쓰레드 "삭제"는 보관(archived) 처리다 — 데이터는 보존하고 사용자 목록에서만 숨긴다.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치' })
@Controller('api/admin')
@UseGuards(ServiceTokenGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name)

  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
    private readonly engineFlag: EngineFlagService,
    private readonly dryRunService: PipelineDryRunService,
    private readonly flowRunService: PipelineFlowRunService,
    private readonly catalog: CatalogService,
    private readonly seedJobs: CatalogSeedJobService,
  ) {}

  /* ── 내재화 카탈로그 (v29, 2026-09-17) — 현황·시딩·수확·점검. core 표가 없으면(마이그레이션 전) available=false 로 안내한다 ── */

  @Get('catalog')
  @ApiOperation({
    summary: '내재화 카탈로그 현황 — 상품·콘텐츠 개수, 몰별·출처별, 검증·dead',
    description: 'core `GET /internal/catalog/stats`. 표가 없거나 core 미연결이면 available=false (마이그레이션 0005 안내).',
  })
  @ApiOkResponse({ schema: toOpenApi(AdminCatalogWire) })
  async catalogStats(): Promise<AdminCatalogWire> {
    try {
      const stats = await this.core.catalogStats()
      return { stats, available: true }
    } catch (e) {
      return {
        available: false,
        note: `카탈로그 표를 읽지 못했어요 — core 마이그레이션(0005_catalog_internalize) 적용 여부를 확인해 주세요: ${(e as Error).message}`,
        stats: {
          products: { total: 0, verified: 0, dead: 0, byMall: [], bySource: [] },
          contents: { total: 0, verified: 0, dead: 0, byType: [] },
          updatedAt: null,
        },
      }
    }
  }

  @Post('catalog/import')
  @ApiOperation({
    summary: '카탈로그 가져오기 — 올리브영 사내 Mongo 내보내기(tagging-api export:catalog) 등 행 JSON 을 올린다 (≤500/요청, 멱등 upsert)',
  })
  @ApiBody({ schema: toOpenApi(AdminCatalogImportBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminCatalogImportResult) })
  async catalogImport(
    @Body(new ZodValidationPipe(AdminCatalogImportBody)) body: AdminCatalogImportBody,
  ): Promise<AdminCatalogImportResult> {
    const result = await this.catalog.importRows(body.products ?? [], body.contents ?? [])
    await this.appendChange({
      area: 'knowledge',
      action: 'update',
      targetId: 'catalog',
      targetLabel: '내재화 카탈로그',
      summary: `가져오기 — 상품 ${result.products} · 콘텐츠 ${result.contents}`,
      before: null,
      after: null,
      restorable: false,
    })
    return result
  }

  /* ── 시딩 잡 — 서버가 상태를 갖고(core KV) 드라이버(콘솔 탭·스크립트)가 step 으로 전진시킨다. 콘솔 카드가 진행·결과를 본다 ── */

  @Get('catalog/seed-job')
  @ApiOperation({ summary: '시딩 잡 현재 상태 — 없으면 { job: null }' })
  @ApiOkResponse({ schema: toOpenApi(CatalogSeedJobWire) })
  async seedJob(): Promise<CatalogSeedJobWire> {
    return { job: await this.seedJobs.get() }
  }

  @Post('catalog/seed-job')
  @ApiOperation({
    summary: '시딩 잡 시작 — 검색 단위 = 유형 × 조건 축(catalogSeedQueries). 진행 중 잡이 있으면 reset 없이는 409',
    description: '시작만 한다 — 실제 전진은 step 호출이 한다(콘솔이 「이 탭에서 돌리기」로, 또는 apps/bff/scripts/seed-search.mjs 가).',
  })
  @ApiBody({ schema: toOpenApi(StartCatalogSeedJobBody) })
  @ApiOkResponse({ schema: toOpenApi(CatalogSeedJobWire) })
  async seedJobStart(@Body(new ZodValidationPipe(StartCatalogSeedJobBody)) body: StartCatalogSeedJobBody): Promise<CatalogSeedJobWire> {
    const job = await this.seedJobs.start(body)
    await this.appendChange({
      area: 'knowledge',
      action: 'create',
      targetId: 'catalog-seed-job',
      targetLabel: '내재화 카탈로그 시딩 잡',
      summary: `웹 검색 시딩 잡 시작 — 검색 단위 ${job.total}개 (조건 ${job.facets.join('+') || '없음'}${job.dense ? ' · dense' : ''})`,
      before: null,
      after: null,
      restorable: false,
    })
    return { job }
  }

  @Post('catalog/seed-job/step')
  @ApiOperation({
    summary: '시딩 잡 한 회차 전진 (≤8단위, 서버리스 300초 안) — running 이 아니거나 다른 드라이버가 잠금 중이면 처리 없이 상태만',
  })
  @ApiOkResponse({ schema: toOpenApi(CatalogSeedJobWire) })
  seedJobStep(): Promise<CatalogSeedJobWire> {
    return this.seedJobs.step()
  }

  @Post('catalog/seed-job/pause')
  @ApiOperation({ summary: '시딩 잡 일시정지 — step 이 처리하지 않는다' })
  async seedJobPause(): Promise<CatalogSeedJobWire> {
    return { job: await this.seedJobs.setStatus('paused') }
  }

  @Post('catalog/seed-job/resume')
  @ApiOperation({ summary: '시딩 잡 재개' })
  async seedJobResume(): Promise<CatalogSeedJobWire> {
    return { job: await this.seedJobs.setStatus('running') }
  }

  @Delete('catalog/seed-job')
  @ApiOperation({ summary: '시딩 잡 기록 지우기 (끝난 잡 정리 — 카탈로그 행은 그대로)' })
  seedJobClear() {
    return this.seedJobs.clear()
  }

  @Post('catalog/seed-search')
  @ApiOperation({
    summary: '시딩 웹 검색 배치 — 검색 단위(유형 또는 유형×조건, ≤8/요청)마다 LLM+web_search 1회로 실제 판매 상품 8~12개(dense 12~16)를 모아 카탈로그에 upsert',
    description:
      '운영 콘솔·배치 스크립트(apps/bff/scripts/seed-search.mjs)가 검색 단위 목록(@ddak/pipeline catalogSeedQueries — 유형 42 × 조건 축)을 8개씩 잘라 여러 번 부른다. ' +
      '검색 단위 하나당 약 $0.14(dense $0.18). 실패한 단위는 failed 로 돌려주고 나머지는 저장한다. keywords(유형만)·queries(유형×조건) 둘 다 받는다.',
  })
  @ApiBody({ schema: toOpenApi(AdminCatalogSeedSearchBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminCatalogSeedSearchResult) })
  async catalogSeedSearch(
    @Body(new ZodValidationPipe(AdminCatalogSeedSearchBody)) body: AdminCatalogSeedSearchBody,
  ): Promise<AdminCatalogSeedSearchResult> {
    // 옛 형식(keywords = 유형만)과 대량 형식(queries = 유형×조건)을 한 목록으로
    const queries = [
      ...(body.keywords ?? []).map((keyword) => ({ keyword, query: keyword })),
      ...(body.queries ?? []).map((q) => ({ keyword: q.keyword, query: q.query ?? q.keyword })),
    ]
    const result = await this.catalog.seedBySearch(queries, body.dense ?? false)
    await this.appendChange({
      area: 'knowledge',
      action: 'update',
      targetId: 'catalog',
      targetLabel: '내재화 카탈로그',
      summary: `웹 검색 시딩${body.dense ? '(dense)' : ''} — ${queries.map((q) => q.query).join('·')}: 상품 ${result.products}(검증 ${result.verified})${result.failed.length ? ` · 실패 ${result.failed.join('·')}` : ''}`,
      before: null,
      after: null,
      restorable: false,
    })
    return result
  }

  @Post('catalog/harvest')
  @ApiOperation({
    summary: '지난 쓰레드 계획에서 수확 (백필) — plan 스텝의 검증 통과 상품·콘텐츠를 카탈로그로',
    description: '전체 쓰레드 최신순 N개를 훑어 각 계획 페이지를 harvestRowsOf 로 행으로 만들어 bump upsert 한다. 실주행 7단계 수확과 같은 규칙.',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 100 })
  @ApiOkResponse({ schema: toOpenApi(AdminCatalogHarvestResult) })
  async catalogHarvest(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<AdminCatalogHarvestResult> {
    const out: AdminCatalogHarvestResult = { threads: 0, plans: 0, products: 0, contents: 0 }
    let cursor: string | undefined
    const max = Math.min(Math.max(limit, 1), 500)
    while (out.threads < max) {
      const page = await this.core.listAllThreads(cursor, Math.min(50, max - out.threads))
      for (const row of page.items) {
        out.threads += 1
        let thread: ThreadWithSteps
        try {
          thread = await this.core.getThread(row.id)
        } catch {
          continue
        }
        const plan = (thread.steps.find((s) => s.seq === SEQ.plan)?.payload as { page?: PlanPageWire } | undefined)?.page
        if (!plan) continue
        const survey = (thread.steps.find((s) => s.seq === SEQ.survey)?.payload as { page?: SurveyPageWire } | undefined)?.page ?? null
        const answersStep = thread.steps.find((s) => s.seq === SEQ.answers)?.payload as { answers?: Answer[]; profile?: Profile | null } | undefined
        let intent: string
        try {
          intent = intentOf(thread)
        } catch {
          intent = thread.title ?? ''
        }
        const terms = catalogTermsOf({ intent, survey, answers: answersStep?.answers ?? null, profile: answersStep?.profile ?? null })
        const rows = harvestRowsOf(plan, terms.terms)
        out.plans += 1
        try {
          if (rows.products.length) out.products += (await this.core.upsertCatalogProducts({ items: rows.products, bump: true })).upserted
          if (rows.contents.length) out.contents += (await this.core.upsertCatalogContents({ items: rows.contents, bump: true })).upserted
        } catch (e) {
          this.logger.warn(`수확 upsert 실패(${row.id}): ${(e as Error).message}`)
        }
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    await this.appendChange({
      area: 'knowledge',
      action: 'update',
      targetId: 'catalog',
      targetLabel: '내재화 카탈로그',
      summary: `쓰레드 수확 — 계획 ${out.plans}건에서 상품 ${out.products} · 콘텐츠 ${out.contents}`,
      before: null,
      after: null,
      restorable: false,
    })
    return out
  }

  @Post('catalog/verify')
  @ApiOperation({
    summary: '상품 링크 점검 — 오래 안 본 순 N개: 지마켓은 썸네일(gdimg)·그 밖의 몰은 상품 주소에 HEAD (404 → dead, 200 → verified). 올리브영·쿠팡은 건너뜀',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 50 })
  @ApiQuery({ name: 'mall', required: false, example: '*', description: "몰 이름 또는 '*'(전체, 기본)" })
  @ApiOkResponse({ schema: toOpenApi(AdminCatalogVerifyResult) })
  catalogVerify(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('mall', new DefaultValuePipe('*')) mall: string,
  ): Promise<AdminCatalogVerifyResult> {
    return this.catalog.verifyProducts(mall, Math.min(Math.max(limit, 1), 200))
  }

  /** 설정 변경 뒤 같은 core KV에 최신순으로 쌓는다. 설정 반영 자체를 로그 장애로 되돌리진 않는다. */
  private async appendChange(entry: Omit<AdminChangeEntry, 'id' | 'at'> & Partial<Pick<AdminChangeEntry, 'id' | 'at'>>) {
    try {
      const setting = await this.core.getSetting(ADMIN_CHANGE_LOG_KEY)
      const history = parseAdminChanges(setting?.value)
      const row: AdminChangeEntry = {
        ...entry,
        id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        at: entry.at || new Date().toISOString(),
      }
      await this.core.putSetting(
        ADMIN_CHANGE_LOG_KEY,
        [row, ...history.filter((item) => item.id !== row.id)].slice(0, ADMIN_CHANGE_LOG_LIMIT),
      )
    } catch (error) {
      this.logger.error(`운영 변경 로그 저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  @Get('threads')
  @ApiOperation({ summary: '전체 쓰레드 목록 — archived 포함, 생성 최신순 (id 키셋 커서)' })
  @ApiQuery({ name: 'cursor', required: false, description: '이전 응답의 nextCursor (threadId)' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 20 })
  @ApiOkResponse({ schema: toOpenApi(ThreadListPage) })
  listThreads(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.core.listAllThreads(cursor, limit)
  }

  @Get('threads/:id')
  @ApiOperation({
    summary: '쓰레드 상세 — 라이프사이클 스텝 로그 원본 (llmMeta·action 포함)',
    description: '사용자용 이어보기(GET /api/threads/:id)와 달리 core의 ThreadWithSteps를 그대로 준다.',
  })
  @ApiParam(THREAD_ID_PARAM)
  @ApiOkResponse({ schema: toOpenApi(ThreadWithSteps) })
  getThread(@Param('id', ParseThreadIdPipe) id: string) {
    return this.core.getThread(id)
  }

  @Post('threads/:id/archive')
  @ApiOperation({ summary: '쓰레드 보관 — 사용자 목록에서 숨긴다 (데이터 보존, 복구는 DB에서만)' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiOkResponse({ schema: toOpenApi(Thread) })
  archiveThread(@Param('id', ParseThreadIdPipe) id: string) {
    return this.core.updateThread(id, { status: 'archived' })
  }

  @Post('prompt-trials')
  @ApiOperation({ summary: '지시서 A/B 시험·전체 평가를 나중에 결정할 수 있는 admin 쓰레드로 저장' })
  @ApiBody({ schema: toOpenApi(SaveAdminPromptTrialBody) })
  @ApiOkResponse({ schema: toOpenApi(ThreadWithSteps) })
  async savePromptTrial(
    @Body(new ZodValidationPipe(SaveAdminPromptTrialBody)) body: SaveAdminPromptTrialBody,
  ): Promise<ThreadWithSteps> {
    const at = new Date().toISOString()
    const thread = await this.core.createThread({
      userId: PROMPT_TRIAL_USER,
      title: `[지시서 시험] ${body.promptLabel} · ${body.intent}`.slice(0, 200),
      source: { kind: 'search', query: body.intent },
      status: 'done',
    })
    await this.core.upsertStep(thread.id, SEQ.actionBase, {
      stage: 'action',
      payload: { type: 'prompt-trial', data: { ...body, savedAt: at }, at },
    })
    return this.core.getThread(thread.id)
  }

  @Post('threads/:id/prompt-trial/decision')
  @ApiOperation({ summary: '저장한 지시서 시험을 적용하거나 적용하지 않기로 기록' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiBody({ schema: toOpenApi(AdminPromptTrialDecisionBody) })
  @ApiOkResponse({ schema: toOpenApi(ThreadWithSteps) })
  async decidePromptTrial(
    @Param('id', ParseThreadIdPipe) id: string,
    @Body(new ZodValidationPipe(AdminPromptTrialDecisionBody)) body: AdminPromptTrialDecisionBody,
  ): Promise<ThreadWithSteps> {
    const thread = await this.core.getThread(id)
    const trialStep = [...thread.steps].reverse().find((step) => step.stage === 'action' && step.payload?.type === 'prompt-trial')
    const parsed = AdminPromptTrialRecord.safeParse(trialStep?.payload?.data)
    if (!parsed.success) throw new BadRequestException('이 쓰레드에는 적용할 지시서 시험안이 없습니다')
    const trial = parsed.data

    if (body.decision === 'applied' && trial.changes) {
      if (!trial.prompts) throw new BadRequestException('시험 당시 지시서가 없어 적용할 수 없어요. 다시 시험해 주세요.')
      await this.applyPromptFlow({ changes: trial.changes, prompts: trial.prompts, summary: trial.summary })
    } else if (body.decision === 'applied') {
      const def = PROMPT_DEFS.find((candidate) => candidate.id === trial.promptId)!
      const setting = await this.core.getSetting(promptSettingKey(trial.promptId))
      const currentText = typeof setting?.value === 'string' ? setting.value : def.template
      if (currentText !== trial.baseText) {
        throw new BadRequestException('시험 저장 후 현재 지시서가 바뀌었어요. 덮어쓰지 않도록 새로 시험해 주세요.')
      }
      await this.putPrompt(trial.promptId, {
        text: trial.proposedText,
        note: `저장한 시험 적용 · ${trial.summary}`,
      })
    }

    const at = new Date().toISOString()
    const nextSeq = Math.max(SEQ.actionBase, ...thread.steps.map((step) => step.seq)) + 1
    await this.core.upsertStep(id, nextSeq, {
      stage: 'action',
      payload: {
        type: 'prompt-trial-decision',
        data: { decision: body.decision, promptId: trial.promptId, summary: trial.summary },
        at,
      },
    })
    return this.core.getThread(id)
  }

  @Get('feedback')
  @ApiOperation({
    summary: '평가 모아보기 — 피드백 제출 전체를 최신순으로 (제출 1회 = 항목 1개)',
    description:
      "core의 피드백 스텝(action type='feedback') 원본을 파싱해 쓰레드 메타와 함께 돌려준다. " +
      '같은 (쓰레드, 단계)의 최신 제출에 latest=true — 집계는 latest 항목만으로 한다.',
  })
  @ApiOkResponse({ schema: toOpenApi(AdminFeedbackWire) })
  async listFeedback(): Promise<AdminFeedbackWire> {
    const { items, truncated } = await this.core.listFeedbackSteps()
    const seen = new Set<string>()
    const entries: AdminFeedbackEntry[] = []
    for (const { thread, step } of items) {
      const payload = (step.payload ?? {}) as { data?: unknown; at?: unknown }
      const parsed = ThreadStageFeedback.safeParse(payload.data)
      if (!parsed.success) continue // 형태가 다른 구/실험 제출은 조용히 건너뛴다 — 원본은 상세 로그에 있다
      const key = `${thread.id}:${parsed.data.stage}`
      entries.push({
        threadId: thread.id,
        title: thread.title,
        threadStatus: thread.status,
        userId: thread.userId,
        stage: parsed.data.stage,
        seq: step.seq,
        at: typeof payload.at === 'string' ? payload.at : step.createdAt,
        review: parsed.data.review,
        components: parsed.data.components,
        latest: !seen.has(key), // 입력이 최신순이라 첫 등장 = 최신 제출
      })
      seen.add(key)
    }
    return { items: entries, truncated }
  }

  @Get('model')
  @ApiOperation({ summary: 'LLM 모델 설정 — 현재값·기본값·선택지 카탈로그' })
  @ApiOkResponse({ schema: toOpenApi(AdminModelWire) })
  async getModel(): Promise<AdminModelWire> {
    const setting = await this.core.getSetting(LLM_MODEL_SETTING_KEY)
    const configured = typeof setting?.value === 'string' ? setting.value : null
    const current = await this.llm.resolveModel()
    return { current, defaultModel: DEFAULT_MODEL, configured, options: MODEL_OPTIONS }
  }

  @Put('model')
  @ApiOperation({
    summary: 'LLM 모델 변경 — 카탈로그 안의 id만 허용, null이면 기본값으로 복귀',
    description: '설정은 core DB(settings.llm-model)에 저장되고 새 생성부터 반영된다 (인스턴스 캐시 최대 30초).',
  })
  @ApiBody({ schema: toOpenApi(PutAdminModelBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminModelWire) })
  async putModel(@Body(new ZodValidationPipe(PutAdminModelBody)) body: PutAdminModelBody): Promise<AdminModelWire> {
    const beforeWire = await this.getModel()
    if (beforeWire.configured === body.model) return beforeWire
    if (body.model === null) {
      await this.core.deleteSetting(LLM_MODEL_SETTING_KEY)
    } else {
      if (!MODEL_OPTIONS.some((option) => option.id === body.model)) {
        throw new BadRequestException('카탈로그에 없는 모델입니다')
      }
      await this.core.putSetting(LLM_MODEL_SETTING_KEY, body.model)
    }
    this.llm.invalidateModelCache()
    await this.appendChange({
      area: 'model',
      action: body.model === null ? 'restore' : 'update',
      targetId: LLM_MODEL_SETTING_KEY,
      targetLabel: '생성 모델',
      summary: body.model === null ? `기본 모델(${DEFAULT_MODEL})로 복구` : `${body.model}로 변경`,
      before: beforeWire.configured,
      after: body.model,
      restorable: false,
    })
    return this.getModel()
  }

  @Get('changes')
  @ApiOperation({ summary: '운영 변경 로그 — AI 지시서 기존 버전과 설정 변경을 최신순으로' })
  @ApiOkResponse({ schema: toOpenApi(AdminChangesWire) })
  async getChanges(): Promise<AdminChangesWire> {
    const [setting, prompts] = await Promise.all([
      this.core.getSetting(ADMIN_CHANGE_LOG_KEY),
      this.getPrompts(),
    ])
    const logged = parseAdminChanges(setting?.value)
    const promptRows: AdminChangeEntry[] = prompts.prompts.flatMap((prompt) =>
      prompt.history.map((revision) => ({
        id: revision.id,
        at: revision.at,
        area: 'prompt' as const,
        action: /복구|복귀/.test(revision.note) ? 'restore' as const : 'update' as const,
        targetId: prompt.id,
        targetLabel: prompt.label,
        summary: revision.note,
        before: null,
        after: revision.text,
        restorable: true,
      })),
    )
    const byId = new Map<string, AdminChangeEntry>()
    for (const row of [...logged, ...promptRows]) if (!byId.has(row.id)) byId.set(row.id, row)
    const items = [...byId.values()]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, ADMIN_CHANGE_LOG_LIMIT)
    return { items, truncated: byId.size > ADMIN_CHANGE_LOG_LIMIT }
  }

  @Get('prompts')
  @ApiOperation({
    summary: 'LLM 시스템 프롬프트 — 단계별 기본값·재정의 원문 (카탈로그는 BFF prompts.ts 소유)',
    description:
      'defaultText는 코드 기본 템플릿, configured는 core 설정(llm-prompt-<id>)의 재정의 원문(없으면 null). ' +
      '상품 후보는 v29 부터 시스템 자리표시자가 아니라 요청별 가변부 표(내부 카탈로그)로 실린다 — 옛 재정의의 {{CATALOG}} 는 데모 14종으로 치환된다.',
  })
  @ApiOkResponse({ schema: toOpenApi(AdminPromptsWire) })
  async getPrompts(): Promise<AdminPromptsWire> {
    const prompts = await Promise.all(
      PROMPT_DEFS.map(async (def) => {
        const [setting, historySetting] = await Promise.all([
          this.core.getSetting(promptSettingKey(def.id)),
          this.core.getSetting(promptHistorySettingKey(def.id)),
        ])
        const configured = typeof setting?.value === 'string' ? setting.value : null
        return {
          id: def.id,
          label: def.label,
          note: def.note,
          defaultText: def.template,
          configured,
          history: parsePromptHistory(historySetting?.value),
        }
      }),
    )
    return { promptVersion: PROMPT_VERSION, prompts }
  }

  @Post('prompt-flow/assist')
  @ApiOperation({ summary: '자연어 요청 하나로 설문·계획·상품 지시서의 미저장 수정안 생성' })
  @ApiBody({ schema: toOpenApi(AssistPromptFlowBody) })
  @ApiOkResponse({ schema: toOpenApi(AssistPromptFlowResult) })
  async assistPromptFlow(@Body(new ZodValidationPipe(AssistPromptFlowBody)) body: AssistPromptFlowBody) {
    if (new Set(body.prompts.map((prompt) => prompt.id)).size !== 3) throw new BadRequestException('설문·계획·상품 지시서를 모두 보내주세요.')
    try {
      return await this.llm.assistFlowRevision(body)
    } catch (error) {
      if (error instanceof LlmGenerationError) throw new ServiceUnavailableException(error.message)
      throw error
    }
  }

  @Put('prompt-flow')
  @ApiOperation({ summary: '시험한 지시서 묶음 적용 — 전체 기준선 확인, 부분 실패는 명시하고 재시도 허용' })
  @ApiBody({ schema: toOpenApi(ApplyPromptFlowBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminPromptsWire) })
  async applyPromptFlow(@Body(new ZodValidationPipe(ApplyPromptFlowBody)) body: ApplyPromptFlowBody): Promise<AdminPromptsWire> {
    const snapshots = new Map(body.prompts.map((prompt) => [prompt.id, prompt.text]))
    if (snapshots.size !== 3 || new Set(body.changes.map((change) => change.id)).size !== body.changes.length) {
      throw new BadRequestException('지시서 목록이 중복되거나 빠져 있어요. 다시 시험해 주세요.')
    }
    for (const change of body.changes) {
      if (snapshots.get(change.id) !== change.baseText) throw new BadRequestException('수정안의 기준 지시서가 달라요. 다시 시험해 주세요.')
    }
    const wire = await this.getPrompts()
    for (const [id, baseText] of snapshots) {
      const entry = wire.prompts.find((prompt) => prompt.id === id)!
      const current = entry.configured ?? entry.defaultText
      const change = body.changes.find((item) => item.id === id)
      if (current !== baseText && current !== change?.proposedText) {
        throw new BadRequestException(entry.label + ' 설정이 시험 후 바뀌었어요. 최신 설정으로 다시 시험해 주세요.')
      }
    }
    let completed = 0
    try {
      for (const change of body.changes) {
        await this.putPrompt(change.id, { text: change.proposedText, note: body.summary })
        completed += 1
      }
    } catch {
      throw new ServiceUnavailableException('적용 도중 연결이 끊겼어요. ' + completed + '개 완료를 확인했고 나머지는 확인이 필요해요. 같은 적용 버튼을 다시 누르면 이어서 확인하고 적용합니다.')
    }
    return this.getPrompts()
  }

  @Post('prompts/:id/assist')
  @ApiOperation({
    summary: '운영자 자연어 요청으로 시스템 프롬프트 미저장 수정안 생성',
    description:
      '현재 편집 중인 원문과 자연어 변경 요청을 Claude에 보내 수정안·요약·주의점을 받는다. ' +
      '이 호출은 설정을 저장하지 않으며, 기존 {{PLACEHOLDER}} 집합이 달라진 결과는 서버가 거부한다.',
  })
  @ApiParam({ name: 'id', enum: AdminPromptId.options, description: '프롬프트 id (PROMPT_DEFS 카탈로그)' })
  @ApiBody({ schema: toOpenApi(AssistAdminPromptBody) })
  @ApiOkResponse({ schema: toOpenApi(AssistAdminPromptResult) })
  async assistPrompt(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AssistAdminPromptBody)) body: AssistAdminPromptBody,
  ): Promise<AssistAdminPromptResult> {
    const parsed = AdminPromptId.safeParse(id)
    if (!parsed.success) throw new BadRequestException('카탈로그에 없는 프롬프트입니다')
    const def = PROMPT_DEFS.find((candidate) => candidate.id === parsed.data)!
    try {
      return await this.llm.assistPromptRevision(body, `${def.label}: ${def.note}`)
    } catch (error) {
      if (error instanceof LlmGenerationError) throw new ServiceUnavailableException(error.message)
      throw error
    }
  }

  @Put('prompts/:id')
  @ApiOperation({
    summary: 'LLM 시스템 프롬프트 재정의 — null/공백/기본값과 동일하면 설정을 지우고 기본값 복귀',
    description:
      '재정의는 core 설정(llm-prompt-<id>)에 원문으로 저장되고 새 생성부터 반영된다 (인스턴스 캐시 최대 30초). ' +
      '재정의로 생성된 스텝은 llmMeta.promptVersion에 +custom 접미가 붙는다.',
  })
  @ApiParam({ name: 'id', enum: AdminPromptId.options, description: '프롬프트 id (PROMPT_DEFS 카탈로그)' })
  @ApiBody({ schema: toOpenApi(PutAdminPromptBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminPromptsWire) })
  async putPrompt(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PutAdminPromptBody)) body: PutAdminPromptBody,
  ): Promise<AdminPromptsWire> {
    const parsed = AdminPromptId.safeParse(id)
    if (!parsed.success) throw new BadRequestException('카탈로그에 없는 프롬프트입니다')
    const def = PROMPT_DEFS.find((d) => d.id === parsed.data)!
    const text = body.text?.trim() ? body.text : null
    const currentSetting = await this.core.getSetting(promptSettingKey(def.id))
    const current = typeof currentSetting?.value === 'string' ? currentSetting.value : null
    const next = text === def.template ? null : text

    if (current === next) return this.getPrompts()

    const historySetting = await this.core.getSetting(promptHistorySettingKey(def.id))
    const history = parsePromptHistory(historySetting?.value)
    const now = new Date().toISOString()
    const previous: AdminPromptRevision = {
      id: `${Date.now()}-previous`,
      at: currentSetting?.updatedAt || now,
      text: current,
      note: current === null ? '기본 지시서' : '직전 운영 버전',
    }
    const revision: AdminPromptRevision = {
      id: `${Date.now()}-current`,
      at: now,
      text: next,
      note: body.note || summarizePromptChange(current ?? def.template, next ?? def.template, next),
    }
    const merged = [revision, ...(history.length ? history : [previous])]
      .filter((entry, index, rows) => index === 0 || entry.text !== rows[index - 1].text)
      .slice(0, PROMPT_HISTORY_LIMIT)
    await this.core.putSetting(promptHistorySettingKey(def.id), merged)

    // 기본값과 동일한 저장은 재정의가 아니다 — 설정을 지워 코드 기본값 추종으로 되돌린다
    if (next === null) {
      await this.core.deleteSetting(promptSettingKey(def.id))
    } else {
      await this.core.putSetting(promptSettingKey(def.id), next)
    }
    this.llm.invalidatePromptCache()
    await this.appendChange({
      id: revision.id,
      at: revision.at,
      area: 'prompt',
      action: /복구|복귀/.test(revision.note) ? 'restore' : 'update',
      targetId: def.id,
      targetLabel: def.label,
      summary: revision.note,
      before: current,
      after: next,
      restorable: true,
    })
    return this.getPrompts()
  }

  /* ── 파이프라인 스튜디오 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4) ────────── */

  @Get('pipeline')
  @ApiOperation({
    summary: '파이프라인 현황 — 단계 카탈로그·지식 KV·엔진 플래그 (원천은 @ddak/pipeline PIPELINE_STAGES)',
    description:
      '단계 카드는 전략 문서 0~7 번호를 그대로 쓰고(active/planned 구분), LLM 단계에는 프롬프트 재정의 여부가 붙는다. ' +
      'knowledge에는 지식 5종(KV 4 + core 실데이터 1)과 검증 게이트 블록리스트가 실린다.',
  })
  @ApiOkResponse({ schema: toOpenApi(AdminPipelineWire) })
  async getPipeline(): Promise<AdminPipelineWire> {
    const engineSetting = await this.core.getSetting(ENGINE_SETTING_KEY)
    const stages = await Promise.all(
      PIPELINE_STAGES.map(async (stage) => {
        let promptCustom: boolean | null = null
        if (stage.promptId) {
          const setting = await this.core.getSetting(promptSettingKey(stage.promptId))
          promptCustom = typeof setting?.value === 'string' && Boolean(setting.value.trim())
        }
        return {
          id: stage.id,
          no: stage.no,
          label: stage.label,
          kind: stage.kind,
          status: stage.status,
          note: stage.note,
          promptId: stage.promptId ?? null,
          effort: stage.effort ?? null,
          promptCustom,
        }
      }),
    )
    const knowledge: AdminKnowledgeEntry[] = await Promise.all(
      KNOWLEDGE_SOURCES.map(async (source) => {
        const editable = source.backing === 'kv'
        const setting = editable ? await this.core.getSetting(knowledgeSettingKey(source.id)) : null
        return {
          id: source.id,
          label: source.label,
          backing: source.backing,
          injection: source.injection,
          placeholder: source.placeholder ?? null,
          note: source.note,
          editable,
          value: typeof setting?.value === 'string' && setting.value.trim() ? setting.value : null,
          custom: false,
          heading: null,
        }
      }),
    )
    const blocklistSetting = await this.core.getSetting(GUARD_BLOCKLIST_SETTING_KEY)
    knowledge.push({
      id: GUARD_BLOCKLIST_SETTING_KEY,
      label: '상품 블록리스트',
      backing: 'kv',
      injection: 'guard',
      placeholder: null,
      note: '검증 게이트(6단계) 정확 매칭 드롭 — 쓰레드 피드백에서 증류한 상품명을 줄바꿈으로. 상품명 또는 "브랜드 상품명" 전체와 일치해야 드롭된다.',
      editable: true,
      value:
        typeof blocklistSetting?.value === 'string' && blocklistSetting.value.trim() ? blocklistSetting.value : null,
      custom: false,
      heading: null,
    })
    const contentHostsSetting = await this.core.getSetting(GUARD_CONTENT_HOSTS_SETTING_KEY)
    knowledge.push({
      id: GUARD_CONTENT_HOSTS_SETTING_KEY,
      label: '콘텐츠 저신뢰 출처',
      backing: 'kv',
      injection: 'guard',
      placeholder: null,
      note: '검증 게이트(6단계) 참고 콘텐츠 드롭 — 제품 목록만 나열하는 SEO 어필리에이트 블로그처럼 믿기 어려운 출처의 도메인을 줄바꿈으로 (접미 일치, 예: example.com). 같은 출처 3개째·3년 넘은 콘텐츠는 목록 없이도 드롭된다.',
      editable: true,
      value:
        typeof contentHostsSetting?.value === 'string' && contentHostsSetting.value.trim() ? contentHostsSetting.value : null,
      custom: false,
      heading: null,
    })
    // 운영자가 추가한 지식 — 붙박이 뒤에 붙는다 (주입은 언제나 시스템 자리표시자)
    for (const source of await this.customSources()) {
      const setting = await this.core.getSetting(customKnowledgeSettingKey(source.id))
      knowledge.push({
        id: source.id,
        label: source.label,
        backing: 'kv',
        injection: 'system',
        placeholder: source.placeholder,
        note: source.note || `운영자가 추가한 지식 — ${source.placeholder} 자리표시자가 있는 단계 프롬프트에 실린다.`,
        editable: true,
        value: typeof setting?.value === 'string' && setting.value.trim() ? setting.value : null,
        custom: true,
        heading: source.heading,
      })
    }
    return {
      engine: {
        current: await this.engineFlag.resolve(),
        configured: typeof engineSetting?.value === 'string' ? engineSetting.value : null,
      },
      stages,
      knowledge,
    }
  }

  @Put('knowledge/:id')
  @ApiOperation({
    summary: '지식 KV 편집 — null/공백이면 설정을 지운다 (지식 없음)',
    description:
      '값은 core 설정 KV(knowledge-* 또는 guard-blocklist)에 원문으로 저장되고 새 생성부터 반영된다 ' +
      '(인스턴스 캐시 최대 30초). 시스템 자리표시자 지식이 바뀌면 프롬프트 캐시가 1회 미스 후 재적중한다.',
  })
  @ApiParam({ name: 'id', description: '지식 소스 id (kv 지원분) 또는 guard-blocklist' })
  @ApiBody({ schema: toOpenApi(PutAdminKnowledgeBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminPipelineWire) })
  async putKnowledge(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PutAdminKnowledgeBody)) body: PutAdminKnowledgeBody,
  ): Promise<AdminPipelineWire> {
    const key = await this.knowledgeValueKey(id)
    if (!key) throw new BadRequestException('편집할 수 없는 지식 소스입니다')
    const beforeSetting = await this.core.getSetting(key)
    const before = typeof beforeSetting?.value === 'string' ? beforeSetting.value : null
    const value = body.value?.trim() ? body.value : null
    if (before === value) return this.getPipeline()
    if (value === null) await this.core.deleteSetting(key)
    else await this.core.putSetting(key, value)
    this.knowledge.invalidate()
    this.llm.invalidatePromptCache() // 시스템 자리표시자 지식이 바뀌면 렌더된 프롬프트도 갱신돼야 한다
    const label = id === GUARD_BLOCKLIST_SETTING_KEY
      ? '상품 블록리스트'
      : id === GUARD_CONTENT_HOSTS_SETTING_KEY
      ? '콘텐츠 저신뢰 출처'
      : KNOWLEDGE_SOURCES.find((source) => source.id === id)?.label
        || (await this.customSources()).find((source) => source.id === id)?.label
        || id
    await this.appendChange({
      area: 'knowledge',
      action: value === null ? 'delete' : 'update',
      targetId: id,
      targetLabel: label,
      summary: value === null ? '내용을 비움' : `${value.length.toLocaleString('ko-KR')}자로 수정`,
      before,
      after: value,
      restorable: false,
    })
    return this.getPipeline()
  }

  /** 지식 id → 값 저장 키. 붙박이 KV·블록리스트·운영자 추가분만 편집 대상(core 파생은 null) */
  private async knowledgeValueKey(id: string): Promise<string | null> {
    if (id === GUARD_BLOCKLIST_SETTING_KEY) return GUARD_BLOCKLIST_SETTING_KEY
    if (id === GUARD_CONTENT_HOSTS_SETTING_KEY) return GUARD_CONTENT_HOSTS_SETTING_KEY
    const builtin = KNOWLEDGE_SOURCES.find((s) => s.id === id && s.backing === 'kv')
    if (builtin) return knowledgeSettingKey(builtin.id)
    const custom = (await this.customSources()).find((s) => s.id === id)
    return custom ? customKnowledgeSettingKey(custom.id) : null
  }

  /** 추가 지식 목록 — 저장 원천은 설정 KV 한 칸(knowledge-custom)의 JSON 배열 */
  private async customSources() {
    const setting = await this.core.getSetting(CUSTOM_KNOWLEDGE_SETTING_KEY)
    return parseCustomSources(typeof setting?.value === 'string' ? setting.value : null)
  }

  @Post('knowledge')
  @ApiOperation({
    summary: '지식 소스 추가 — 시스템 자리표시자 주입',
    description:
      '운영자가 새 지식 타입을 만든다. 목록은 설정 KV(knowledge-custom) JSON 배열, 값은 붙박이와 같은 ' +
      'knowledge-<id> 키에 저장된다. 자리표시자는 {{NAME}} 꼴로 정규화되며 예약 토큰·중복은 거절한다. ' +
      '만들기만 하면 아직 어느 단계에도 실리지 않는다 — 단계 프롬프트에 토큰을 넣어야 주입된다.',
  })
  @ApiBody({ schema: toOpenApi(PostAdminKnowledgeSourceBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminPipelineWire) })
  async postKnowledgeSource(
    @Body(new ZodValidationPipe(PostAdminKnowledgeSourceBody)) body: PostAdminKnowledgeSourceBody,
  ): Promise<AdminPipelineWire> {
    const placeholder = normalizePlaceholderToken(body.placeholder)
    if (!placeholder) {
      throw new BadRequestException('자리표시자는 영문 대문자·숫자·밑줄 2~31자여야 해요 (예: MY_BRIEF)')
    }
    if (RESERVED_PLACEHOLDERS.includes(placeholder)) {
      throw new BadRequestException(`${placeholder}는 코드가 쓰는 예약 자리표시자예요`)
    }
    const sources = await this.customSources()
    const id = customKnowledgeId(placeholder)
    if (sources.some((s) => s.id === id || s.placeholder === placeholder)) {
      throw new BadRequestException(`${placeholder}를 쓰는 지식이 이미 있어요`)
    }
    const label = body.label.trim()
    const next = [
      ...sources,
      {
        id,
        label,
        placeholder,
        heading: body.heading?.trim() || `${label}:`,
        note: body.note?.trim() || '',
      },
    ]
    await this.core.putSetting(CUSTOM_KNOWLEDGE_SETTING_KEY, serializeCustomSources(next))
    const value = body.value?.trim() ? body.value : null
    if (value) await this.core.putSetting(customKnowledgeSettingKey(id), value)
    this.knowledge.invalidate()
    this.llm.invalidatePromptCache()
    await this.appendChange({
      area: 'knowledge',
      action: 'create',
      targetId: id,
      targetLabel: label,
      summary: `새 지식 소스 ${placeholder} 추가`,
      before: null,
      after: value,
      restorable: false,
    })
    return this.getPipeline()
  }

  @Delete('knowledge/:id')
  @ApiOperation({
    summary: '추가 지식 소스 삭제 — 붙박이 카탈로그는 지울 수 없다',
    description:
      '목록에서 빼고 값 KV도 지운다. 남은 토큰이 프롬프트에 원문으로 새어 나가지 않도록 ' +
      '재정의 프롬프트에서 그 자리표시자도 함께 제거한다 (기본값 템플릿에는 애초에 없다).',
  })
  @ApiParam({ name: 'id', description: '추가 지식 소스 id (custom- 접두)' })
  @ApiOkResponse({ schema: toOpenApi(AdminPipelineWire) })
  async deleteKnowledgeSource(@Param('id') id: string): Promise<AdminPipelineWire> {
    const sources = await this.customSources()
    const target = sources.find((s) => s.id === id)
    if (!target) throw new BadRequestException('삭제할 수 있는 추가 지식이 아니에요')
    const valueSetting = await this.core.getSetting(customKnowledgeSettingKey(id))
    const before = typeof valueSetting?.value === 'string' ? valueSetting.value : null
    await this.core.putSetting(CUSTOM_KNOWLEDGE_SETTING_KEY, serializeCustomSources(sources.filter((s) => s.id !== id)))
    await this.core.deleteSetting(customKnowledgeSettingKey(id))
    // 재정의 프롬프트에 남은 토큰 청소 — 안 지우면 {{TOKEN}} 원문이 그대로 모델에 나간다
    for (const def of PROMPT_DEFS) {
      const setting = await this.core.getSetting(promptSettingKey(def.id))
      const configured = typeof setting?.value === 'string' ? setting.value : null
      if (!configured?.includes(target.placeholder)) continue
      const cleaned = configured.split(target.placeholder).join('')
      if (cleaned.trim() && cleaned !== def.template) await this.core.putSetting(promptSettingKey(def.id), cleaned)
      else await this.core.deleteSetting(promptSettingKey(def.id))
    }
    this.knowledge.invalidate()
    this.llm.invalidatePromptCache()
    await this.appendChange({
      area: 'knowledge',
      action: 'delete',
      targetId: id,
      targetLabel: target.label,
      summary: `지식 소스 ${target.placeholder} 삭제`,
      before,
      after: null,
      restorable: false,
    })
    return this.getPipeline()
  }

  @Put('engine')
  @ApiOperation({
    summary: '생성 엔진 플래그 — legacy | langgraph, null이면 설정을 지우고 기본값(legacy) 복귀',
    description:
      '병행 배치 전환 스위치 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 2). 요청 단위 오버라이드는 ' +
      'x-ddak-engine 헤더 — 전환 판정(페이즈 5) 전까지 기본값은 legacy다.',
  })
  @ApiBody({ schema: toOpenApi(PutAdminEngineBody) })
  @ApiOkResponse({ schema: toOpenApi(AdminPipelineWire) })
  async putEngine(
    @Body(new ZodValidationPipe(PutAdminEngineBody)) body: PutAdminEngineBody,
  ): Promise<AdminPipelineWire> {
    const beforeWire = await this.getPipeline()
    if (beforeWire.engine.configured === body.engine) return beforeWire
    if (body.engine === null) await this.core.deleteSetting(ENGINE_SETTING_KEY)
    else await this.core.putSetting(ENGINE_SETTING_KEY, body.engine)
    this.engineFlag.invalidate()
    await this.appendChange({
      area: 'engine',
      action: body.engine === null ? 'restore' : 'update',
      targetId: ENGINE_SETTING_KEY,
      targetLabel: '생성 엔진',
      summary: body.engine === null ? '기본 엔진(legacy)으로 복구' : `${body.engine}로 변경`,
      before: beforeWire.engine.configured,
      after: body.engine,
      restorable: false,
    })
    return this.getPipeline()
  }

  @Post('pipeline/dry-run')
  @ApiOperation({
    summary: 'LLM 단계 단독 실행 (플레이그라운드, SSE) — 그래프·쓰레드·core 기록 없음',
    description:
      '그래프 노드와 같은 빌더·스키마·가드를 그대로 실행한다. promptOverride가 있으면 저장하지 않은 ' +
      '임시 프롬프트로 실행(what-if — 자리표시자 치환 동일). 지식 KV는 실제 값으로 주입된다. ' +
      'SSE: status(진행 문구) → result(DryRunResult — survey 페이지 | skeleton 원본 | 검증 통과 sections+dropLog, ' +
      '공통으로 ledger·meta·promptCustom) 또는 error({ code, message, retryable, detail? } — detail 은 운영자용 원인 한 줄).',
  })
  @ApiBody({ schema: toOpenApi(AdminDryRunBody) })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result: DryRunResult' })
  async dryRun(@Body(new ZodValidationPipe(AdminDryRunBody)) body: AdminDryRunBody, @Res() res: SseRes) {
    openSse(res)
    sseSend(res, 'status', { message: '단계를 실행하고 있어요…' })
    try {
      const result = await this.dryRunService.run(body, {
        onStatus: (message) => sseSend(res, 'status', { message }),
      })
      sseSend(res, 'result', result)
    } catch (e) {
      this.sendSseFailure(res, 'dry-run', e)
    }
    sseClose(res)
  }

  @Post('pipeline/flow-run')
  @ApiOperation({
    summary: '전체 플로우 실행 (플레이그라운드, SSE) — 실제 LangGraph 그래프, 쓰레드·core 기록 없음',
    description:
      '운영과 같은 그래프 토폴로지(병렬 5a∥5b·interrupt·검증 게이트)를 스텁 core+전용 MemorySaver로 돈다. ' +
      'phase=survey는 답변 대기 interrupt까지, phase=plan은 flowId로 재개(유실 시 body의 survey·answers 시딩 재실행). ' +
      'SSE: status → stage({ id, phase: start|done, meta?, prompt?(실제 시스템 전문·가변부), summary? }) ' +
      '→ content(설문·계획 스트림 조각) → state({ node, id, patch } — 노드가 덮은 그래프 상태 채널, ' +
      'LastValue라 누적하면 스냅샷) → result(FlowRunResult) 또는 error({ code, message, retryable, detail? }).',
  })
  @ApiBody({ schema: toOpenApi(AdminFlowRunBody) })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result: FlowRunResult' })
  async flowRun(@Body(new ZodValidationPipe(AdminFlowRunBody)) body: AdminFlowRunBody, @Res() res: SseRes) {
    openSse(res)
    sseSend(res, 'status', { message: body.phase === 'survey' ? '플로우를 시작하고 있어요…' : '계획 구간을 재개하고 있어요…' })
    try {
      const result = await this.flowRunService.run(body, {
        onStatus: (message) => sseSend(res, 'status', { message }),
        onStage: (event) => sseSend(res, 'stage', event),
        onContent: (chunk) => sseSend(res, 'content', chunk),
        onState: (event) => sseSend(res, 'state', event),
      })
      sseSend(res, 'result', result)
    } catch (e) {
      this.sendSseFailure(res, 'flow-run', e)
    }
    sseClose(res)
  }

  /** 관리 SSE 의 실패 안내 — 운영자 화면이라 사용자 안내(message)에 더해 원인 한 줄(detail: API 상태·오류 문구·파싱 사유)을
   * 싣는다. 사용자 쓰레드 SSE(threads.controller)에는 detail 을 싣지 않는다 */
  private sendSseFailure(res: SseRes, label: string, e: unknown) {
    if (e instanceof LlmGenerationError) {
      this.logger.warn(`${label} 실패 안내 — code=${e.code}${e.detail ? ` (${e.detail})` : ''}`)
      sseSend(res, 'error', { code: e.code, message: e.message, retryable: e.retryable, ...(e.detail ? { detail: e.detail } : {}) })
    } else if (e instanceof BadRequestException) {
      sseSend(res, 'error', { code: 'bad_request', message: e.message, retryable: false })
    } else {
      this.logger.error(`${label} 오류: ${(e as Error).message}`)
      sseSend(res, 'error', {
        code: 'internal',
        message: `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        retryable: true,
      })
    }
  }

  /* ── 평가·실험 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 5) ────────────────── */

  @Get('eval/cases')
  @ApiOperation({ summary: '평가 케이스 목록 — 생성 최신순 (골든 케이스 셋)' })
  @ApiOkResponse({ schema: toOpenApi(EvalCasesWire) })
  listEvalCases(): Promise<EvalCasesWire> {
    return this.core.listEvalCases() as Promise<EvalCasesWire>
  }

  @Post('eval/cases')
  @ApiOperation({
    summary: '쓰레드 → 평가 케이스 승격 — 입력 스냅샷(의도·프로필·설문·답변)을 굳힌다',
    description: '"나쁜 실행을 본 그 자리에서 케이스로" 루프 (쓰레드 상세의 버튼). 설문·답변이 없는 쓰레드도 승격은 되지만 실행에는 설문·답변이 필요하다.',
  })
  @ApiBody({ schema: toOpenApi(PromoteEvalCaseBody) })
  async promoteEvalCase(@Body(new ZodValidationPipe(PromoteEvalCaseBody)) body: PromoteEvalCaseBody) {
    const thread = await this.core.getThread(body.threadId)
    const step = (seq: number) => thread.steps.find((s) => s.seq === seq)
    const profile =
      ((step(SEQ.explore)?.payload as { profile?: Profile } | undefined)?.profile ??
        (step(SEQ.answers)?.payload as { profile?: Profile } | undefined)?.profile) ?? null
    return this.core.createEvalCase({
      title: thread.title,
      intent: intentOf(thread),
      profile,
      survey: (step(SEQ.survey)?.payload as { page?: SurveyPageWire } | undefined)?.page ?? null,
      answers: (step(SEQ.answers)?.payload as { answers?: Answer[] } | undefined)?.answers ?? null,
      sourceThreadId: thread.id,
    })
  }

  @Post('eval/cases/:id/run')
  @ApiOperation({
    summary: '케이스 실행 (SSE) — 단계 축(stage)에 따라 계획(뼈대+상품) 또는 설문 페이지를 실행·기록',
    description:
      '그래프 노드와 같은 빌더·스키마·가드로 실행하고(쓰레드·core 스텝 기록 없음), 결과는 eval_runs에 저장된다. ' +
      'stage 생략 = plan(뼈대+상품 순차, 두 단계 모두 promptOverride 적용) · stage=survey는 의도·프로필만으로 ' +
      '설문 페이지를 재생성한다. SSE: status → result({ run }) | error.',
  })
  @ApiParam({ name: 'id', description: '평가 케이스 id' })
  @ApiBody({ schema: toOpenApi(RunEvalCaseBody) })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result: { run: EvalRun }' })
  async runEvalCase(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RunEvalCaseBody)) body: RunEvalCaseBody,
    @Res() res: SseRes,
  ) {
    openSse(res)
    try {
      const cases = await this.core.listEvalCases()
      const evalCase = cases.items.find((c) => c.id === id)
      if (!evalCase) throw new BadRequestException('평가 케이스가 없습니다')
      if ((body.stage ?? 'plan') === 'survey') {
        sseSend(res, 'status', { message: '설문 페이지를 실행하고 있어요…' })
        const result = await this.dryRunService.run(
          {
            stageId: 'survey',
            intent: evalCase.intent,
            profile: evalCase.profile ?? undefined,
            promptOverride: body.promptOverride,
          },
          { onStatus: (message) => sseSend(res, 'status', { message }) },
        )
        const run = await this.core.createEvalRun(id, {
          config: {
            engine: 'dry-run',
            model: result.meta?.model,
            promptVersion: result.meta?.promptVersion,
            promptOverride: Boolean(body.promptOverride?.trim()),
            stage: 'survey',
            ...(body.label?.trim() ? { label: body.label.trim() } : {}),
          },
          page: result.survey!,
          dropLog: [],
          meta: result.meta ?? null,
        })
        sseSend(res, 'result', { run })
        sseClose(res)
        return
      }
      if (!evalCase.survey || !evalCase.answers?.length) {
        throw new BadRequestException('이 케이스에는 설문·답변 스냅샷이 없어 계획 실행을 할 수 없습니다')
      }
      sseSend(res, 'status', { message: '계획 뼈대를 실행하고 있어요…' })
      const skeleton = await this.dryRunService.run({
        stageId: 'plan-skeleton',
        intent: evalCase.intent,
        profile: evalCase.profile ?? undefined,
        survey: evalCase.survey,
        answers: evalCase.answers,
        promptOverride: body.promptOverride,
      })
      sseSend(res, 'status', { message: '상품·콘텐츠를 실행하고 있어요…' })
      const products = await this.dryRunService.run(
        {
          stageId: 'plan-products',
          intent: evalCase.intent,
          profile: evalCase.profile ?? undefined,
          survey: evalCase.survey,
          answers: evalCase.answers,
          promptOverride: body.promptOverride,
        },
        { onStatus: (message) => sseSend(res, 'status', { message }) },
      )
      // 5c 참고 콘텐츠 — 상품과 분리된 검색 예산 (운영 그래프와 같은 구성, 2026-09)
      const contents = await this.dryRunService.run(
        {
          stageId: 'plan-contents',
          intent: evalCase.intent,
          profile: evalCase.profile ?? undefined,
          survey: evalCase.survey,
          answers: evalCase.answers,
          promptOverride: body.promptOverride,
        },
        { onStatus: (message) => sseSend(res, 'status', { message }) },
      )
      const sections = consolidateSmallProductSections(
        mergePlanSections(skeleton.skeleton!.sections, [...(products.sections ?? []), ...(contents.sections ?? [])]),
      )
      const page: PlanPageWire = {
        headline: skeleton.skeleton!.headline,
        summary: skeleton.skeleton!.summary,
        sections,
      }
      const meta = combineMeta(skeleton.meta, products.meta, 'dry-run', { contents: contents.meta, quality: planQualityOf(page, [...(products.dropLog ?? []), ...(contents.dropLog ?? [])]) })
      const run = await this.core.createEvalRun(id, {
        config: {
          engine: 'dry-run',
          model: meta.model,
          promptVersion: meta.promptVersion,
          promptOverride: Boolean(body.promptOverride?.trim()),
          stage: 'plan',
          ...(body.label?.trim() ? { label: body.label.trim() } : {}),
        },
        page,
        dropLog: products.dropLog ?? [],
        meta,
      })
      sseSend(res, 'result', { run })
    } catch (e) {
      this.sendSseFailure(res, '케이스 실행', e)
    }
    sseClose(res)
  }

  @Get('eval/cases/:id/runs')
  @ApiOperation({ summary: '케이스의 실행 기록 — 최신순 (채점 포함)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ schema: toOpenApi(EvalRunsWire) })
  listEvalRuns(@Param('id') id: string): Promise<EvalRunsWire> {
    return this.core.listEvalRuns(id) as Promise<EvalRunsWire>
  }

  @Delete('eval/cases/:id')
  @ApiOperation({ summary: '평가 케이스 삭제 — 실행 기록도 함께' })
  @ApiParam({ name: 'id' })
  deleteEvalCase(@Param('id') id: string) {
    return this.core.deleteEvalCase(id)
  }

  @Patch('eval/runs/:id')
  @ApiOperation({
    summary: '사람 채점 — 전체(별점 0~5·null=미채점, 코멘트) + 항목별 components (평가 레코드 문법)',
    description:
      'components의 id는 페이지 섹션 앵커(sec-<index>), label을 함께 저장해 재생성 후에도 해석 가능하다. ' +
      '자동 채점(judge)은 이 경로로 건드릴 수 없다 — source 축 분리.',
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(ScoreEvalRunBody) })
  scoreEvalRun(@Param('id') id: string, @Body(new ZodValidationPipe(ScoreEvalRunBody)) body: ScoreEvalRunBody) {
    return this.core.scoreEvalRun(id, body)
  }

  @Post('eval/runs/:id/judge')
  @ApiOperation({
    summary: '자동 채점 (SSE) — 실행 결과를 LLM 심사관이 루브릭 4차원으로 채점해 판정을 저장',
    description:
      "케이스 입력(의도·프로필·설문·답변)과 실행 결과(page·dropLog)를 대조해 채점한다. 판정은 run.judge에 " +
      "저장되며 사람 채점(score·comment·components)과 절대 섞이지 않는다 — source='judge' 레코드. " +
      "프롬프트는 PROMPT_DEFS 'judge' (재정의 가능 — llm-prompt-judge). SSE: status → result({ run }) | error.",
  })
  @ApiParam({ name: 'id', description: '평가 실행 id' })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result: { run: EvalRun }' })
  async judgeEvalRun(@Param('id') id: string, @Res() res: SseRes) {
    openSse(res)
    try {
      const { run, case: evalCase } = await this.core.getEvalRun(id)
      if (!run.page) throw new BadRequestException('결과 페이지가 없는 실행은 채점할 수 없습니다')
      sseSend(res, 'status', { message: '자동 채점을 실행하고 있어요…' })
      // 단계 축 분기 — 실행이 만든 산출물 종류에 맞는 심사관·루브릭을 쓴다 (config.stage 없음 = plan)
      let verdict: { overall: number; rubric: EvalJudgeRubricEntry[]; text: string }
      let meta
      if (run.config?.stage === 'survey') {
        if (!('questions' in run.page)) throw new BadRequestException('설문 실행의 결과 페이지 형태가 아닙니다')
        const result = await this.llm.generate('자동 채점(설문)', JudgeSurveyGen, {
          system: await this.llm.resolveSystem('judge-survey'),
          effort: 'medium' as const,
          user: buildJudgeSurveyRequest({
            intent: evalCase.intent,
            profile: evalCase.profile ?? undefined,
            survey: run.page,
          }),
        })
        verdict = { overall: result.content.overall, rubric: judgeSurveyRubricEntries(result.content), text: result.content.verdict }
        meta = result.meta
      } else {
        if (!('sections' in run.page)) throw new BadRequestException('계획 실행의 결과 페이지 형태가 아닙니다')
        if (!evalCase.survey || !evalCase.answers?.length) {
          throw new BadRequestException('케이스에 설문·답변 스냅샷이 없어 대조 채점을 할 수 없습니다')
        }
        const result = await this.llm.generate('자동 채점', JudgeGen, {
          system: await this.llm.resolveSystem('judge'),
          effort: 'medium' as const,
          user: buildJudgeRequest({
            intent: evalCase.intent,
            profile: evalCase.profile ?? undefined,
            survey: evalCase.survey,
            answers: evalCase.answers,
            page: run.page,
            dropLog: (run.dropLog ?? []) as { code: string; message: string }[],
          }),
        })
        verdict = { overall: result.content.overall, rubric: judgeRubricEntries(result.content), text: result.content.verdict }
        meta = result.meta
      }
      const updated = await this.core.setEvalRunJudge(id, {
        judge: {
          score: verdict.overall,
          rubric: verdict.rubric,
          verdict: verdict.text,
          meta,
          at: new Date().toISOString(),
        },
      })
      sseSend(res, 'result', { run: updated })
    } catch (e) {
      this.sendSseFailure(res, '자동 채점', e)
    }
    sseClose(res)
  }

  @Get('metrics/engines')
  @ApiOperation({
    summary: '전환 판정 계기판 — 실주행 plan 스텝 llmMeta를 엔진별 집계',
    description:
      '최근 plan 스텝 N개의 llmMeta(engine 각인)를 엔진별로 묶어 지연·단계별 소요·캐시 적중률·promptVersion을 비교한다. ' +
      'engine 미각인 구 기록은 legacy로 집계. 페이즈 5 전환 게이트(TTFT +20%·캐시 유지)의 실측 재료.',
  })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 200 })
  @ApiOkResponse({ schema: toOpenApi(AdminEngineMetricsWire) })
  async engineMetrics(
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ): Promise<AdminEngineMetricsWire> {
    const { items } = await this.core.listPlanMetas(limit)
    type Quality = {
      sections: number; productSections: number; singleProductSections: number; products: number; webProducts: number
      pdpProducts: number; productThumbnails: number; priceUnknown: number; contentSections: number; contentItems: number
      contentThumbnails: number; drops: number
    }
    const buckets = new Map<string, { latencies: number[]; skeletons: number[]; products: number[]; contents: number[]; cacheHits: number; cacheKnown: number; versions: Set<string>; qualities: Quality[] }>()
    for (const row of items) {
      const meta = row.llmMeta as (Record<string, unknown> & { usage?: { cacheReadTokens?: number }; phases?: { skeletonMs?: number | null; productsMs?: number | null; contentsMs?: number | null }; quality?: Quality }) | null
      if (!meta) continue
      const engine = typeof meta.engine === 'string' ? meta.engine : 'legacy'
      let bucket = buckets.get(engine)
      if (!bucket) {
        bucket = { latencies: [], skeletons: [], products: [], contents: [], cacheHits: 0, cacheKnown: 0, versions: new Set(), qualities: [] }
        buckets.set(engine, bucket)
      }
      if (typeof meta.latencyMs === 'number') bucket.latencies.push(meta.latencyMs)
      if (typeof meta.phases?.skeletonMs === 'number') bucket.skeletons.push(meta.phases.skeletonMs)
      if (typeof meta.phases?.productsMs === 'number') bucket.products.push(meta.phases.productsMs)
      if (typeof meta.phases?.contentsMs === 'number') bucket.contents.push(meta.phases.contentsMs)
      if (meta.quality && typeof meta.quality.products === 'number') bucket.qualities.push(meta.quality)
      if (meta.usage && meta.usage.cacheReadTokens !== undefined) {
        bucket.cacheKnown += 1
        if ((meta.usage.cacheReadTokens ?? 0) > 0) bucket.cacheHits += 1
      }
      if (typeof meta.promptVersion === 'string') bucket.versions.add(meta.promptVersion)
    }
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null)
    /* 품질 KPI — 비율은 분모가 0이면 null (2026-09 분석에서 손으로 세던 지표: 섹션당 상품 수·1개짜리 섹션·PDP·썸네일·가격 미확인·콘텐츠 누락·드롭) */
    const ratio = (num: number, den: number) => (den ? Math.round((num / den) * 100) / 100 : null)
    const qualityOf = (qs: Quality[]) => {
      if (!qs.length) return null
      const sum = (pick: (q: Quality) => number) => qs.reduce((a, q) => a + pick(q), 0)
      const productSections = sum((q) => q.productSections)
      const products = sum((q) => q.products)
      const webProducts = sum((q) => q.webProducts)
      const contentItems = sum((q) => q.contentItems)
      return {
        plans: qs.length,
        avgProductsPerSection: productSections ? Math.round((products / productSections) * 10) / 10 : null,
        singleProductSectionRate: ratio(sum((q) => q.singleProductSections), productSections),
        webPdpRate: ratio(sum((q) => q.pdpProducts), webProducts),
        productThumbnailRate: ratio(sum((q) => q.productThumbnails), products),
        priceUnknownRate: ratio(sum((q) => q.priceUnknown), products),
        contentMissingRate: ratio(qs.filter((q) => q.contentSections === 0).length, qs.length),
        avgContentItems: Math.round((contentItems / qs.length) * 10) / 10,
        contentThumbnailRate: ratio(sum((q) => q.contentThumbnails), contentItems),
        avgDrops: Math.round((sum((q) => q.drops) / qs.length) * 10) / 10,
      }
    }
    return {
      sampled: items.length,
      engines: [...buckets.entries()].map(([engine, b]) => ({
        engine,
        count: b.latencies.length,
        avgLatencyMs: avg(b.latencies),
        avgSkeletonMs: avg(b.skeletons),
        avgProductsMs: avg(b.products),
        avgContentsMs: avg(b.contents),
        cacheHitRate: b.cacheKnown ? Math.round((b.cacheHits / b.cacheKnown) * 100) / 100 : null,
        promptVersions: [...b.versions].sort(),
        quality: qualityOf(b.qualities),
      })),
    }
  }
}
