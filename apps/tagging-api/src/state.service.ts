import { Injectable, OnModuleInit } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { MongoStateStore } from './mongo-state-store'
import type { StateStore } from './state-store'

/* 워크스페이스 상태의 저장소는 사내 Mongo 하나다(app_state 컬렉션, 이미 붙어 있는
   MongoService 재사용).

   한때 DATABASE_URL 이 있으면 Neon Postgres 로 갈라 Vercel 배포본과 데이터를 공유하는
   길을 뒀다가 걷어냈다. Vercel 은 옛 공개 저장소에 연결돼 있어 이 리포의 변경이 영영
   닿지 않으므로, 데이터를 공유하면 동결된 옛 클라이언트와 새 클라이언트가 같은 행을
   쓰게 된다 — CLAUDE.md 가 이미 경고하는 "구 클라이언트가 새 행 체계를 덮는" 사고다.
   게다가 Mongo 연결은 검증됐고 Pod 에서 Neon(외부) 으로 나갈 수 있는지는 미지수였다.
   검증된 경로 하나 대신 미검증 분기를 남길 이유가 없다. */
@Injectable()
export class StateService implements OnModuleInit {
  private impl!: StateStore

  constructor(private readonly mongo: MongoService) {}

  onModuleInit() {
    const coll = process.env.STATE_COLL || 'app_state'
    this.impl = new MongoStateStore(this.mongo, coll)
    console.log(`[state] 저장소: mongo(${coll})`)
  }

  store(): StateStore {
    return this.impl
  }
}
