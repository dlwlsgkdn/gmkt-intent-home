import { Controller, Get, Module, Redirect } from '@nestjs/common'
import { ApiExcludeEndpoint } from '@nestjs/swagger'
import { DbModule } from './db/db.module'
import { ThreadsModule } from './threads/threads.module'
import { SettingsModule } from './settings/settings.module'
import { EvalModule } from './eval/eval.module'

/** 헬스체크·루트 — 가드 밖 (배포 확인·모니터링용) */
@Controller()
export class AppController {
  /** 루트 → API 문서 (API_DOCS=0이면 /docs가 404지만, 문서를 끈 배포에선 루트 접근도 무의미) */
  @Get()
  @ApiExcludeEndpoint()
  @Redirect('/docs', 302)
  root() {}

  @Get('healthz')
  healthz() {
    return { ok: true, service: 'ddak-core', now: new Date().toISOString() }
  }
}

@Module({
  imports: [DbModule, ThreadsModule, SettingsModule, EvalModule],
  controllers: [AppController],
})
export class AppModule {}
