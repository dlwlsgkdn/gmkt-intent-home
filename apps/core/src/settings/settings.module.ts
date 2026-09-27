import { Module } from '@nestjs/common'
import { storeProvider } from '../db/store'
import { SettingsController } from './settings.controller'
import { SettingsMongoService } from './settings.mongo.service'
import { SettingsNeonService } from './settings.neon.service'
import { SettingsService } from './settings.service'

@Module({
  controllers: [SettingsController],
  // 저장소 구현은 배포 환경(CORE_STORE·접속 문자열)이 고른다 — db/store.ts
  providers: [storeProvider(SettingsService, SettingsNeonService, SettingsMongoService)],
})
export class SettingsModule {}
