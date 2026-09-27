import { Module } from '@nestjs/common'
import { storeProvider } from '../db/store'
import { ThreadsController } from './threads.controller'
import { ThreadsMongoService } from './threads.mongo.service'
import { ThreadsNeonService } from './threads.neon.service'
import { ThreadsService } from './threads.service'

@Module({
  controllers: [ThreadsController],
  // 저장소 구현은 배포 환경(CORE_STORE·접속 문자열)이 고른다 — db/store.ts
  providers: [storeProvider(ThreadsService, ThreadsNeonService, ThreadsMongoService)],
})
export class ThreadsModule {}
