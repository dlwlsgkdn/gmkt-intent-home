import { Controller, Get, Module, Redirect } from '@nestjs/common'
import { ApiExcludeEndpoint } from '@nestjs/swagger'
import { DbModule } from './db/db.module'
import { ThreadsModule } from './threads/threads.module'
import { SettingsModule } from './settings/settings.module'
import { EvalModule } from './eval/eval.module'
import { CatalogModule } from './catalog/catalog.module'

/** 헬스체크·루트 — 가드 밖 (배포 확인·모니터링용) */
@Controller()
export class AppController {
  /** 루트 → API 문서 (API_DOCS=0이면 /docs가 404지만, 문서를 끈 배포에선 루트 접근도 무의미) */
  @Get()
  @ApiExcludeEndpoint()
  @Redirect('/docs', 302)
  root() {}

  /* 퓨전(OpenShift) 콘솔의 Readiness Probe Path 기본값이 /health 라 별칭을 함께 연다 —
     세 앱(core·bff·tagging-api)이 같은 경로로 응답해야 배포하는 쪽이 칸마다 확인할 일이 없다. */
  @Get(['healthz', 'health'])
  healthz() {
    return { ok: true, service: 'ddak-core', now: new Date().toISOString() }
  }
}

@Module({
  imports: [DbModule, ThreadsModule, SettingsModule, EvalModule, CatalogModule],
  controllers: [AppController],
})
export class AppModule {}
