import { Body, Controller, Get, Headers, Logger, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common'
import { ThreadEventBody, PlanRequestBody, StartThreadBody, SurveyRequestBody } from '@ddak/schema'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { LlmGenerationError } from '../llm/llm.service'
import { ThreadsService } from './threads.service'
import { openSse, sseClose, sseSend, type SseRes } from './sse'

/*
 * threads API — FE 대상 (DESIGN-LLM-SERVICE.md §4-1).
 * 사용자 식별은 x-device-id 헤더 (익명 디바이스 id). 설문·계획 생성은 SSE.
 */
@Controller('api/threads')
export class ThreadsController {
  private readonly logger = new Logger(ThreadsController.name)

  constructor(private readonly threads: ThreadsService) {}

  @Post()
  start(
    @Headers('x-device-id') deviceId: string | undefined,
    @Body(new ZodValidationPipe(StartThreadBody)) body: StartThreadBody,
  ) {
    return this.threads.start(deviceId || 'anonymous', body)
  }

  @Post(':id/survey')
  async survey(
    @Param('id', ParseUUIDPipe) id: string,
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
  async plan(
    @Param('id', ParseUUIDPipe) id: string,
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
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ThreadEventBody)) body: ThreadEventBody,
  ) {
    return this.threads.recordEvent(id, body)
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.threads.get(id)
  }

  @Get()
  list(
    @Headers('x-device-id') deviceId: string | undefined,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.threads.list(deviceId || 'anonymous', cursor, limit ? Number(limit) : undefined)
  }
}
