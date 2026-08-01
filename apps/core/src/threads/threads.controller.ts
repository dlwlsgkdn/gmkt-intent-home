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
import { CreateThreadBody, UpdateThreadBody, UpsertStepBody } from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { ThreadsService } from './threads.service'

/** internal API — BFF 전용 (DESIGN-LLM-SERVICE.md §3). 계약은 @ddak/schema가 단일 출처 */
@Controller('internal')
@UseGuards(ServiceTokenGuard)
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Post('threads')
  create(@Body(new ZodValidationPipe(CreateThreadBody)) body: CreateThreadBody) {
    return this.threads.create(body)
  }

  @Patch('threads/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateThreadBody)) body: UpdateThreadBody,
  ) {
    return this.threads.update(id, body)
  }

  @Put('threads/:id/steps/:seq')
  upsertStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('seq', ParseIntPipe) seq: number,
    @Body(new ZodValidationPipe(UpsertStepBody)) body: UpsertStepBody,
  ) {
    return this.threads.upsertStep(id, seq, body)
  }

  @Get('threads/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.threads.get(id)
  }

  @Get('users/:uid/threads')
  list(
    @Param('uid') uid: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.threads.listByUser(uid, cursor, limit)
  }
}
