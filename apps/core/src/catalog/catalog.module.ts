import { Module } from '@nestjs/common'
import { storeProvider } from '../db/store'
import { CatalogController } from './catalog.controller'
import { CatalogMongoService } from './catalog.mongo.service'
import { CatalogNeonService } from './catalog.neon.service'
import { CatalogService } from './catalog.service'

@Module({
  controllers: [CatalogController],
  // 저장소 구현은 배포 환경(CORE_STORE·접속 문자열)이 고른다 — db/store.ts
  providers: [storeProvider(CatalogService, CatalogNeonService, CatalogMongoService)],
})
export class CatalogModule {}
