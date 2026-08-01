import { Body, Controller, Get, Headers, Logger, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common'
import { JourneyEventBody, PlanRequestBody, StartJourneyBody, SurveyRequestBody } from '@ddak/schema'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { JourneysService } from './journeys.service'
import { openSse, sseClose, sseSend, type SseRes } from './sse'

/*
 * journeys API — FE 대상 (DESIGN-LLM-SERVICE.md §4-1).
 * 사용자 식별은 x-device-id 헤더 (익명 디바이스 id). 설문·계획 생성은 SSE.
 */
@Controller('api/journeys')
export class JourneysController {
  private readonly logger = new Logger(JourneysController.name)

  constructor(private readonly journeys: JourneysService) {}

  @Post()
  start(
    @Headers('x-device-id') deviceId: string | undefined,
    @Body(new ZodValidationPipe(StartJourneyBody)) body: StartJourneyBody,
  ) {
    return this.journeys.start(deviceId || 'anonymous', body)
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
      const page = await this.journeys.generateSurvey(id, body.profile)
      sseSend(res, 'result', { page })
    } catch (e) {
      this.logger.error(`설문 생성 오류: ${(e as Error).message}`)
      sseSend(res, 'error', { message: (e as Error).message })
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
      const page = await this.journeys.generatePlan(id, body.answers, body.profile)
      sseSend(res, 'result', { page })
    } catch (e) {
      this.logger.error(`계획 생성 오류: ${(e as Error).message}`)
      sseSend(res, 'error', { message: (e as Error).message })
    }
    sseClose(res)
  }

  @Post(':id/events')
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(JourneyEventBody)) body: JourneyEventBody,
  ) {
    return this.journeys.recordEvent(id, body)
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.journeys.get(id)
  }

  @Get()
  list(
    @Headers('x-device-id') deviceId: string | undefined,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.journeys.list(deviceId || 'anonymous', cursor, limit ? Number(limit) : undefined)
  }
}
