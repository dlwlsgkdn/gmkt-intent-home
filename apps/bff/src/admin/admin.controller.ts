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
  AdminPromptsWire,
  AssistAdminPromptBody,
  AssistAdminPromptResult,
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
  customKnowledgeId,
  customKnowledgeSettingKey,
  judgeRubricEntries,
  judgeSurveyRubricEntries,
  knowledgeSettingKey,
  mergePlanSections,
  normalizePlaceholderToken,
  parseCustomSources,
  serializeCustomSources,
} from '@ddak/pipeline'
import { SEQ, combineMeta, intentOf } from '../threads/thread-io'
import { KnowledgeService } from '../llm/knowledge.service'
import { ENGINE_SETTING_KEY, EngineFlagService } from '../engine/engine-flag.service'
import { PipelineDryRunService } from '../engine/dry-run.service'
import { PipelineFlowRunService } from '../engine/flow-run.service'
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
  ) {}

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
      'plan-products의 {{CATALOG}} 자리표시자는 호출 시점에 상품 카탈로그 목록으로 치환된다.',
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
      '공통으로 ledger·meta·promptCustom) 또는 error({ code, message, retryable }).',
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
      'LastValue라 누적하면 스냅샷) → result(FlowRunResult) 또는 error.',
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

  private sendSseFailure(res: SseRes, label: string, e: unknown) {
    if (e instanceof LlmGenerationError) {
      this.logger.warn(`${label} 실패 안내 — code=${e.code}`)
      sseSend(res, 'error', { code: e.code, message: e.message, retryable: e.retryable })
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
      const sections = mergePlanSections(skeleton.skeleton!.sections, products.sections ?? [])
      const page: PlanPageWire = {
        headline: skeleton.skeleton!.headline,
        summary: skeleton.skeleton!.summary,
        sections,
      }
      const meta = combineMeta(skeleton.meta, products.meta, 'dry-run')
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
    const buckets = new Map<string, { latencies: number[]; skeletons: number[]; products: number[]; cacheHits: number; cacheKnown: number; versions: Set<string> }>()
    for (const row of items) {
      const meta = row.llmMeta as (Record<string, unknown> & { usage?: { cacheReadTokens?: number }; phases?: { skeletonMs?: number | null; productsMs?: number | null } }) | null
      if (!meta) continue
      const engine = typeof meta.engine === 'string' ? meta.engine : 'legacy'
      let bucket = buckets.get(engine)
      if (!bucket) {
        bucket = { latencies: [], skeletons: [], products: [], cacheHits: 0, cacheKnown: 0, versions: new Set() }
        buckets.set(engine, bucket)
      }
      if (typeof meta.latencyMs === 'number') bucket.latencies.push(meta.latencyMs)
      if (typeof meta.phases?.skeletonMs === 'number') bucket.skeletons.push(meta.phases.skeletonMs)
      if (typeof meta.phases?.productsMs === 'number') bucket.products.push(meta.phases.productsMs)
      if (meta.usage && meta.usage.cacheReadTokens !== undefined) {
        bucket.cacheKnown += 1
        if ((meta.usage.cacheReadTokens ?? 0) > 0) bucket.cacheHits += 1
      }
      if (typeof meta.promptVersion === 'string') bucket.versions.add(meta.promptVersion)
    }
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null)
    return {
      sampled: items.length,
      engines: [...buckets.entries()].map(([engine, b]) => ({
        engine,
        count: b.latencies.length,
        avgLatencyMs: avg(b.latencies),
        avgSkeletonMs: avg(b.skeletons),
        avgProductsMs: avg(b.products),
        cacheHitRate: b.cacheKnown ? Math.round((b.cacheHits / b.cacheKnown) * 100) / 100 : null,
        promptVersions: [...b.versions].sort(),
      })),
    }
  }
}
