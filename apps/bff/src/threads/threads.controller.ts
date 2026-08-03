import { Body, Controller, Get, Headers, Logger, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  PlanRequestBody,
  StartThreadBody,
  StartThreadResult,
  SurveyRequestBody,
  ThreadEventBody,
  ThreadListPage,
  ThreadResumeWire,
} from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { ParseThreadIdPipe } from '../common/thread-id.pipe'
import { toOpenApi } from '../common/openapi'
import { LlmGenerationError } from '../llm/llm.service'
import { ThreadsService } from './threads.service'
import { openSse, sseClose, sseSend, type SseRes } from './sse'

const SSE_DESC =
  'SSE 스트림(text/event-stream)으로 응답한다: `event: status`(진행 문구) → `event: result`(완성 페이지) 또는 ' +
  '`event: error`(실패 안내 `{ code, message, retryable }` — llm_not_configured|llm_refused|llm_failed|internal).'

const DEVICE_HEADER = {
  name: 'x-device-id',
  required: false,
  description: '익명 디바이스 id (없으면 anonymous)',
} as const

const THREAD_ID_PARAM = {
  name: 'id',
  description: '스노우플레이크 threadId (19자리 십진 문자열 — 쓰레드 시작 응답의 threadId)',
  example: '2195943212345678901',
} as const

/*
 * threads API — FE 대상 (DESIGN-LLM-SERVICE.md §4-1, 계약은 @ddak/schema).
 * 사용자 식별은 x-device-id 헤더 (익명 디바이스 id). 설문·계획 생성은 SSE.
 * FE는 스튜디오 same-origin 경로(/api/bff/*)로 호출하고, 스튜디오 엣지 미들웨어(루트 middleware.js)가
 * 서비스 토큰을 주입한다 — 직접 호출은 BFF_SERVICE_TOKEN 설정 시 401.
 */
@ApiTags('threads')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치 (BFF_SERVICE_TOKEN 설정 시)' })
@UseGuards(ServiceTokenGuard)
@Controller('api/threads')
export class ThreadsController {
  private readonly logger = new Logger(ThreadsController.name)

  constructor(private readonly threads: ThreadsService) {}

  @Post()
  @ApiOperation({ summary: '쓰레드 시작', description: '쓰레드 생성 + 탐색 스텝(의도·프로필) 기록.' })
  @ApiHeader(DEVICE_HEADER)
  @ApiBody({ schema: toOpenApi(StartThreadBody) })
  @ApiCreatedResponse({ schema: toOpenApi(StartThreadResult) })
  start(
    @Headers('x-device-id') deviceId: string | undefined,
    @Body(new ZodValidationPipe(StartThreadBody)) body: StartThreadBody,
  ) {
    return this.threads.start(deviceId || 'anonymous', body)
  }

  @Post(':id/survey')
  @ApiOperation({
    summary: '설문 페이지 생성 (LLM #1, SSE)',
    description: `result.page = SurveyPageWire. ${SSE_DESC}`,
  })
  @ApiParam(THREAD_ID_PARAM)
  @ApiBody({ schema: toOpenApi(SurveyRequestBody) })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result.page: SurveyPageWire' })
  async survey(
    @Param('id', ParseThreadIdPipe) id: string,
    @Body(new ZodValidationPipe(SurveyRequestBody)) body: SurveyRequestBody,
    @Res() res: SseRes,
  ) {
    openSse(res)
    sseSend(res, 'status', { message: '질문을 구성하고 있어요…' })
    try {
      const page = await this.threads.generateSurvey(id, body.profile)
      sseSend(res, 'result', { page })
    } catch (e) {
      this.sendFailure(res, '설문 생성', e)
    }
    sseClose(res)
  }

  @Post(':id/plan')
  @ApiOperation({
    summary: '응답 제출 → 계획 페이지 생성 (LLM #2, SSE)',
    description: `카탈로그 그라운딩 — 상품 id는 허용 목록 검증을 거친다. result.page = PlanPageWire. ${SSE_DESC}`,
  })
  @ApiParam(THREAD_ID_PARAM)
  @ApiBody({ schema: toOpenApi(PlanRequestBody) })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE 스트림 — result.page: PlanPageWire' })
  async plan(
    @Param('id', ParseThreadIdPipe) id: string,
    @Body(new ZodValidationPipe(PlanRequestBody)) body: PlanRequestBody,
    @Res() res: SseRes,
  ) {
    openSse(res)
    sseSend(res, 'status', { message: '답변에 맞는 계획을 세우고 있어요…' })
    try {
      const page = await this.threads.generatePlan(id, body.answers, body.profile)
      sseSend(res, 'result', { page })
    } catch (e) {
      this.sendFailure(res, '계획 생성', e)
    }
    sseClose(res)
  }

  /*
   * 실패 안내 정책: 가짜 콘텐츠로 대체하지 않고 코드·문구·재시도 가능 여부를 그대로 알린다.
   * FE는 retryable이면 "다시 시도" 버튼을, 아니면 안내 문구를 보여준다.
   */
  private sendFailure(res: SseRes, label: string, e: unknown) {
    if (e instanceof LlmGenerationError) {
      this.logger.warn(`${label} 실패 안내 — code=${e.code}`)
      sseSend(res, 'error', { code: e.code, message: e.message, retryable: e.retryable })
      return
    }
    this.logger.error(`${label} 오류: ${(e as Error).message}`)
    sseSend(res, 'error', {
      code: 'internal',
      message: `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
      retryable: true,
    })
  }

  @Post(':id/events')
  @ApiOperation({ summary: '행동 기록', description: '담기/완료 등. type이 complete면 status=done.' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiBody({ schema: toOpenApi(ThreadEventBody) })
  @ApiCreatedResponse({ schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
  events(
    @Param('id', ParseThreadIdPipe) id: string,
    @Body(new ZodValidationPipe(ThreadEventBody)) body: ThreadEventBody,
  ) {
    return this.threads.recordEvent(id, body)
  }

  @Get(':id')
  @ApiOperation({ summary: '이어보기', description: '단계별 페이지(survey/answers/plan)를 복원한다.' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiOkResponse({ schema: toOpenApi(ThreadResumeWire) })
  get(@Param('id', ParseThreadIdPipe) id: string) {
    return this.threads.get(id)
  }

  @Get()
  @ApiOperation({ summary: '쓰레드 목록', description: '히스토리 패널용 — updatedAt 키셋 커서.' })
  @ApiHeader(DEVICE_HEADER)
  @ApiQuery({ name: 'cursor', required: false, description: '이전 응답의 nextCursor' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 20 })
  @ApiOkResponse({ schema: toOpenApi(ThreadListPage) })
  list(
    @Headers('x-device-id') deviceId: string | undefined,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.threads.list(deviceId || 'anonymous', cursor, limit ? Number(limit) : undefined)
  }
}
