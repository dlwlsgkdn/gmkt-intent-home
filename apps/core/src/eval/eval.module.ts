import { Module } from '@nestjs/common'
import { DbModule } from '../db/db.module'
import { storeProvider } from '../db/store'
import { EvalController } from './eval.controller'
import { EvalMongoService } from './eval.mongo.service'
import { EvalNeonService } from './eval.neon.service'
import { EvalService } from './eval.service'

@Module({
  imports: [DbModule],
  controllers: [EvalController],
  // 저장소 구현은 배포 환경(CORE_STORE·접속 문자열)이 고른다 — db/store.ts
  providers: [storeProvider(EvalService, EvalNeonService, EvalMongoService)],
})
export class EvalModule {}
