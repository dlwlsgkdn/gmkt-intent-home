import { Controller, Get, Module } from '@nestjs/common'
import { CoreClientService } from './core-client.service'
import { LlmService } from './llm/llm.service'
import { JourneysController } from './journeys/journeys.controller'
import { JourneysService } from './journeys/journeys.service'

/** 헬스체크 — 배포 확인·모니터링용 */
@Controller()
export class AppController {
  @Get('healthz')
  healthz() {
    return {
      ok: true,
      service: 'ddak-bff',
      llm: Boolean(process.env.ANTHROPIC_API_KEY) ? 'configured' : 'fallback-only',
      core: Boolean(process.env.CORE_URL) ? 'configured' : 'missing',
      now: new Date().toISOString(),
    }
  }
}

@Module({
  controllers: [AppController, JourneysController],
  providers: [CoreClientService, LlmService, JourneysService],
})
export class AppModule {}
