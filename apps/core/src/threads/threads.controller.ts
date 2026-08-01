import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
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
import { toOpenApi } from '../common/openapi'
import { ThreadsService } from './threads.service'

/** internal API — BFF 전용 (DESIGN-LLM-SERVICE.md §3). 계약은 @ddak/schema가 단일 출처 */
@ApiTags('threads')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '서비스 토큰 없음/불일치' })
@Controller('internal')
@UseGuards(ServiceTokenGuard)
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Post('threads')
  @ApiOperation({ summary: '쓰레드 생성', description: '저니 시작 시 BFF가 호출한다.' })
  @ApiBody({ schema: toOpenApi(CreateThreadBody) })
  @ApiCreatedResponse({ schema: toOpenApi(Thread) })
  create(@Body(new ZodValidationPipe(CreateThreadBody)) body: CreateThreadBody) {
    return this.threads.create(body)
  }

  @Patch('threads/:id')
  @ApiOperation({ summary: '쓰레드 갱신 (title/status)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: toOpenApi(UpdateThreadBody) })
  @ApiOkResponse({ schema: toOpenApi(Thread) })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateThreadBody)) body: UpdateThreadBody,
  ) {
    return this.threads.update(id, body)
  }

  @Put('threads/:id/steps/:seq')
  @ApiOperation({
    summary: '스텝 멱등 upsert',
    description: '(thread_id, seq)가 멱등 키 — BFF 재시도가 중복 스텝을 만들지 않는다.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'seq', type: 'integer' })
  @ApiBody({ schema: toOpenApi(UpsertStepBody) })
  @ApiOkResponse({ schema: toOpenApi(ThreadStep) })
  upsertStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body(new ZodValidationPipe(UpsertStepBody)) body: UpsertStepBody,
  ) {
    return this.threads.upsertStep(id, seq, body)
  }

  @Get('threads/:id')
  @ApiOperation({ summary: '쓰레드 + 스텝 전체 (이어보기 복원)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: toOpenApi(ThreadWithSteps) })
  get(@Param('id', ParseUUIDPipe) id: string) {
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
}
