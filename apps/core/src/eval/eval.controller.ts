import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { CreateEvalCaseBody, CreateEvalRunBody, EvalRunWithCase, JudgeEvalRunBody, ScoreEvalRunBody } from '@ddak/schema'
import { ServiceTokenGuard } from '../common/service-token.guard'
import { ZodValidationPipe } from '../common/zod-validation.pipe'
import { toOpenApi } from '../common/openapi'
import { EvalService } from './eval.service'

/** 평가·실험 internal API (BFF 전용) — 케이스·실행 저장/조회 (페이즈 5, API.md §2) */
@ApiTags('internal-eval')
@ApiBearerAuth()
@Controller('internal/eval')
@UseGuards(ServiceTokenGuard)
export class EvalController {
  constructor(private readonly evals: EvalService) {}

  @Post('cases')
  @ApiOperation({ summary: '평가 케이스 생성 — 입력 스냅샷 (id는 core가 스노우플레이크로 발급)' })
  @ApiBody({ schema: toOpenApi(CreateEvalCaseBody) })
  createCase(@Body(new ZodValidationPipe(CreateEvalCaseBody)) body: CreateEvalCaseBody) {
    return this.evals.createCase(body)
  }

  @Get('cases')
  @ApiOperation({ summary: '평가 케이스 목록 — 생성 최신순' })
  @ApiQuery({ name: 'limit', required: false, type: 'integer', example: 100 })
  async listCases(@Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number) {
    return { items: await this.evals.listCases(limit) }
  }

  @Delete('cases/:id')
  @ApiOperation({ summary: '평가 케이스 삭제 — 실행 기록도 함께 (cascade)' })
  @ApiParam({ name: 'id' })
  deleteCase(@Param('id') id: string) {
    return this.evals.deleteCase(id)
  }

  @Post('cases/:id/runs')
  @ApiOperation({ summary: '실행 기록 저장 — 설정×결과×메타 스냅샷' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(CreateEvalRunBody) })
  createRun(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateEvalRunBody)) body: CreateEvalRunBody,
  ) {
    return this.evals.createRun(id, body)
  }

  @Get('cases/:id/runs')
  @ApiOperation({ summary: '케이스의 실행 기록 — 최신순' })
  @ApiParam({ name: 'id' })
  async listRuns(@Param('id') id: string) {
    return { items: await this.evals.listRuns(id) }
  }

  @Get('runs/:id')
  @ApiOperation({ summary: '실행 단건 + 소속 케이스 — 자동 채점(BFF)이 케이스 입력을 함께 쓴다' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ schema: toOpenApi(EvalRunWithCase) })
  getRun(@Param('id') id: string) {
    return this.evals.getRun(id)
  }

  @Patch('runs/:id')
  @ApiOperation({ summary: '사람 채점 — score(0~5, null=미채점)·comment + 항목별 components (judge는 불변)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(ScoreEvalRunBody) })
  scoreRun(@Param('id') id: string, @Body(new ZodValidationPipe(ScoreEvalRunBody)) body: ScoreEvalRunBody) {
    return this.evals.scoreRun(id, body)
  }

  @Put('runs/:id/judge')
  @ApiOperation({ summary: '자동 채점 판정 저장 — BFF가 LLM 심사 후 굳힌다 (사람 채점은 불변)' })
  @ApiParam({ name: 'id' })
  @ApiBody({ schema: toOpenApi(JudgeEvalRunBody) })
  setJudge(@Param('id') id: string, @Body(new ZodValidationPipe(JudgeEvalRunBody)) body: JudgeEvalRunBody) {
    return this.evals.setJudge(id, body)
  }
}
