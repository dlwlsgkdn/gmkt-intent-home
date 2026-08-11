import { Controller, Get, Module, Redirect } from '@nestjs/common'
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CoreClientService } from './core-client.service'
import { KnowledgeService } from './llm/knowledge.service'
import { LlmService } from './llm/llm.service'
import { AdminController } from './admin/admin.controller'
import { EngineFlagService } from './engine/engine-flag.service'
import { GraphEngineService } from './engine/graph-engine.service'
import { PipelineDryRunService } from './engine/dry-run.service'
import { PipelineFlowRunService } from './engine/flow-run.service'
import { ThreadsController } from './threads/threads.controller'
import { ThreadsService } from './threads/threads.service'

@ApiTags('app')
@Controller()
export class AppController {
  /** 루트 → API 문서 (API_DOCS=0이면 /docs가 404지만, 문서를 끈 배포에선 루트 접근도 무의미) */
  @Get()
  @ApiExcludeEndpoint()
  @Redirect('/docs', 302)
  root() {}

  @Get('healthz')
  @ApiOperation({ summary: '상태 확인', description: 'llm: configured|not_configured, core: configured|missing' })
  healthz() {
    return {
      ok: true,
      service: 'ddak-bff',
      llm: Boolean(process.env.ANTHROPIC_API_KEY) ? 'configured' : 'not_configured',
      core: Boolean(process.env.CORE_URL) ? 'configured' : 'missing',
      now: new Date().toISOString(),
    }
  }
}

@Module({
  controllers: [AppController, ThreadsController, AdminController],
  providers: [
    CoreClientService,
    KnowledgeService,
    LlmService,
    EngineFlagService,
    GraphEngineService,
    PipelineDryRunService,
    PipelineFlowRunService,
    ThreadsService,
  ],
})
export class AppModule {}
