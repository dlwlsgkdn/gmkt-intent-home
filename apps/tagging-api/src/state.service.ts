import { Injectable, OnModuleInit } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { MongoStateStore } from './mongo-state-store'
import { PostgresStateStore } from './postgres-state-store'
import type { StateStore } from './state-store'

/* 저장소 선택 — DATABASE_URL(없으면 POSTGRES_URL)이 있으면 Neon Postgres(Vercel 배포본과
   같은 DB), 없으면 사내 Mongo(app_state 컬렉션, 이미 붙어 있는 MongoService 재사용).
   둘 중 어느 쪽인지는 부팅 로그로 한 줄 남긴다 — 조용한 실패가 이 프로젝트의 반복 사고 유형이라서. */
@Injectable()
export class StateService implements OnModuleInit {
  private impl!: StateStore

  constructor(private readonly mongo: MongoService) {}

  onModuleInit() {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (url) {
      this.impl = new PostgresStateStore(url)
      console.log('[state] 저장소: postgres(DATABASE_URL)')
    } else {
      const coll = process.env.STATE_COLL || 'app_state'
      this.impl = new MongoStateStore(this.mongo, coll)
      console.log(`[state] 저장소: mongo(${coll})`)
    }
  }

  store(): StateStore {
    return this.impl
  }
}
