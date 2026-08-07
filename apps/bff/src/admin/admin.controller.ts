import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  AdminFeedbackEntry,
  AdminFeedbackWire,
  AdminModelWire,
  AdminPromptId,
  AdminPromptsWire,
  PutAdminModelBody,
  PutAdminPromptBody,
  Thread,
  ThreadListPage,
  ThreadStageFeedback,
  ThreadWithSteps,
} from '@ddak/schema'
import { CoreClientService } from '../core-client.service'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ParseThreadIdPipe } from '../common/thread-id.pipe'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { DEFAULT_MODEL, LLM_MODEL_SETTING_KEY, LlmService, MODEL_OPTIONS, promptSettingKey } from '../llm/llm.service'
import { PROMPT_DEFS, PROMPT_VERSION } from '../llm/prompts'

const THREAD_ID_PARAM = {
  name: 'id',
  description: '스노우플레이크 threadId (19자리 십진 문자열)',
  example: '2195943212345678901',
} as const

/*
 * admin API — 스튜디오 관리 페이지(#admin) 전용.
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
  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
  ) {}

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
    if (body.model === null) {
      await this.core.deleteSetting(LLM_MODEL_SETTING_KEY)
    } else {
      if (!MODEL_OPTIONS.some((option) => option.id === body.model)) {
        throw new BadRequestException('카탈로그에 없는 모델입니다')
      }
      await this.core.putSetting(LLM_MODEL_SETTING_KEY, body.model)
    }
    this.llm.invalidateModelCache()
    return this.getModel()
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
        const setting = await this.core.getSetting(promptSettingKey(def.id))
        const configured = typeof setting?.value === 'string' ? setting.value : null
        return { id: def.id, label: def.label, note: def.note, defaultText: def.template, configured }
      }),
    )
    return { promptVersion: PROMPT_VERSION, prompts }
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
    // 기본값과 동일한 저장은 재정의가 아니다 — 설정을 지워 코드 기본값 추종으로 되돌린다
    if (text === null || text === def.template) {
      await this.core.deleteSetting(promptSettingKey(def.id))
    } else {
      await this.core.putSetting(promptSettingKey(def.id), text)
    }
    this.llm.invalidatePromptCache()
    return this.getPrompts()
  }
}
