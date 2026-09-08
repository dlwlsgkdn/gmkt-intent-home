import { Global, Module } from '@nestjs/common'
import { MongoService } from './mongo.service'

/*
 * MONGO_URI가 없거나 연결에 실패해도 부팅은 된다(MongoService.onModuleInit 참고) —
 * DB를 쓰는 라우트만 503으로 명확히 실패하고, healthz는 계속 200이라 쿠버네티스
 * 프로브가 Pod을 죽이지 않는다.
 */
@Global()
@Module({
  providers: [MongoService],
  exports: [MongoService],
})
export class DbModule {}
