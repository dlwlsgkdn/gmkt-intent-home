import { Controller, Get, Module } from '@nestjs/common'
import { DbModule } from './db/db.module'
import { ThreadsModule } from './threads/threads.module'

/** 헬스체크 — 가드 밖 (배포 확인·모니터링용) */
@Controller()
export class AppController {
  @Get('healthz')
  healthz() {
    return { ok: true, service: 'ddak-core', now: new Date().toISOString() }
  }
}

@Module({
  imports: [DbModule, ThreadsModule],
  controllers: [AppController],
})
export class AppModule {}
