import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import {
  CreateThreadBody,
  Thread,
  ThreadListPage,
  ThreadStep,
  ThreadWithSteps,
  UpdateThreadBody,
  UpsertStepBody,
} from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { ParseThreadIdPipe } from '../common/thread-id.pipe'
import { toOpenApi } from '../common/openapi'
import { ThreadsService } from './threads.service'

const THREAD_ID_PARAM = {
  name: 'id',
  description: '스노우플레이크 threadId (19자리 십진 문자열 — 사전순 = 생성 시각순)',
  example: '2195943212345678901',
} as const

/** internal API — BFF 전용 (DESIGN-LLM-SERVICE.md §3). 계약은 @ddak/schema가 단일 출처 */
@ApiTags('threads')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치' })
@Controller('internal')
@UseGuards(ServiceTokenGuard)
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Post('threads')
  @ApiOperation({
    summary: '쓰레드 생성',
    description: '저니 시작 시 BFF가 호출한다. threadId는 core가 스노우플레이크로 발급해 응답에 담는다.',
  })
  @ApiBody({ schema: toOpenApi(CreateThreadBody) })
  @ApiCreatedResponse({ schema: toOpenApi(Thread) })
  create(@Body(new ZodValidationPipe(CreateThreadBody)) body: CreateThreadBody) {
    return this.threads.create(body)
  }

  @Patch('threads/:id')
  @ApiOperation({ summary: '쓰레드 갱신 (title/status)' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiBody({ schema: toOpenApi(UpdateThreadBody) })
  @ApiOkResponse({ schema: toOpenApi(Thread) })
  update(
    @Param('id', ParseThreadIdPipe) id: string,
    @Body(new ZodValidationPipe(UpdateThreadBody)) body: UpdateThreadBody,
  ) {
    return this.threads.update(id, body)
  }

  @Put('threads/:id/steps/:seq')
  @ApiOperation({
    summary: '스텝 멱등 upsert',
    description: '(thread_id, seq)가 멱등 키 — BFF 재시도가 중복 스텝을 만들지 않는다.',
  })
  @ApiParam(THREAD_ID_PARAM)
  @ApiParam({ name: 'seq', type: 'integer' })
  @ApiBody({ schema: toOpenApi(UpsertStepBody) })
  @ApiOkResponse({ schema: toOpenApi(ThreadStep) })
  upsertStep(
    @Param('id', ParseThreadIdPipe) id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body(new ZodValidationPipe(UpsertStepBody)) body: UpsertStepBody,
  ) {
    return this.threads.upsertStep(id, seq, body)
  }

  @Get('threads/:id')
  @ApiOperation({ summary: '쓰레드 + 스텝 전체 (이어보기 복원)' })
  @ApiParam(THREAD_ID_PARAM)
  @ApiOkResponse({ schema: toOpenApi(ThreadWithSteps) })
  get(@Param('id', ParseThreadIdPipe) id: string) {
    return this.threads.get(id)
  }

  @Get('users/:uid/threads')
  @ApiOperation({ summary: '사용자 쓰레드 목록 (히스토리 패널)' })
  @ApiQuery({ name: 'cursor', required: false, description: '이전 응답의 nextCursor' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 20 })
  @ApiOkResponse({ schema: toOpenApi(ThreadListPage) })
  list(
    @Param('uid') uid: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.threads.listByUser(uid, cursor, limit)
  }

  @Get('threads')
  @ApiOperation({
    summary: '전체 쓰레드 목록 (관리용)',
    description: 'archived 포함 전체 — id(스노우플레이크) 키셋 커서, 생성 최신순. BFF admin API가 쓴다.',
  })
  @ApiQuery({ name: 'cursor', required: false, description: '이전 응답의 nextCursor (threadId)' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 20 })
  @ApiOkResponse({ schema: toOpenApi(ThreadListPage) })
  listAll(
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.threads.listAll(cursor, limit)
  }
}
