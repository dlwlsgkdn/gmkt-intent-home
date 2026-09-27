import { Global, Logger, Module } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { createDb, type Db } from './neon.client'
import { STORE } from './store'

export const DB = Symbol('DB')
export type DbOrNull = Db | null

/*
 * 저장소 두 벌(Neon/Drizzle · 사내 Mongo)을 다 제공하고, 실제로 켜는 것은 STORE(store.ts) 하나다 — 코드는
 * 어느 배포에서나 같고 환경설정이 고른다. 고르지 않은 쪽은 연결하지 않는다(MongoService 는 onModuleInit 에서
 * 건너뛰고, drizzle DB 는 여기 팩토리가 null 을 준다). 어느 쪽도 없으면 부팅은 되고 DB 를 쓰는 라우트만 503 —
 * healthz 는 계속 200 이라 쿠버네티스 프로브가 Pod 을 죽이지 않는다.
 */
@Global()
@Module({
  providers: [
    MongoService,
    {
      provide: DB,
      useFactory: (): DbOrNull => (STORE === 'neon' && process.env.DATABASE_URL ? createDb() : null),
    },
  ],
  exports: [MongoService, DB],
})
export class DbModule {
  constructor() {
    new Logger('store').log(
      `저장소 = ${STORE}${STORE === 'none' ? ' (CORE_STORE·DATABASE_URL·MONGO_URI 없음 — DB 라우트는 503)' : ''}`,
    )
  }
}
