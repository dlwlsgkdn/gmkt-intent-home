import { Controller, Get, Module } from '@nestjs/common'
import { CoreClientService } from './core-client.service'
import { LlmService } from './llm/llm.service'
import { ThreadsController } from './threads/threads.controller'
import { ThreadsService } from './threads/threads.service'

/** 헬스체크 — 배포 확인·모니터링용 */
@Controller()
export class AppController {
  @Get('healthz')
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
  controllers: [AppController, ThreadsController],
  providers: [CoreClientService, LlmService, ThreadsService],
})
export class AppModule {}
