import { Global, Module } from '@nestjs/common'
import { createDb, type Db } from './client'

export const DB = Symbol('DB')
export type DbOrNull = Db | null

/*
 * DATABASE_URL이 없으면 null을 주입한다 — 부팅은 되고(healthz 등),
 * DB를 쓰는 라우트만 503으로 명확히 실패한다 (ThreadsService.conn 참고).
 */
@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): DbOrNull => (process.env.DATABASE_URL ? createDb() : null),
    },
  ],
  exports: [DB],
})
export class DbModule {}
