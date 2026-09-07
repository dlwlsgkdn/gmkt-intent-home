import { ServiceUnavailableException } from '@nestjs/common'
import type { MongoService } from './mongo.service'
import type { StateIndexRow, StateRow, StateStore } from './state-store'

/* 문서 형태 { _id: key, data, updated_at } — Postgres 쪽 (key, data, updated_at) 과
   같은 세 필드를 그대로 옮긴 것뿐이다 (컬렉션 이름은 STATE_COLL, 기본 app_state). */
export class MongoStateStore implements StateStore {
  constructor(
    private readonly mongo: MongoService,
    private readonly collName: string,
  ) {}

  private col() {
    const c = this.mongo.collection(this.collName)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return c
  }

  async listIndex(): Promise<StateIndexRow[]> {
    const docs = await this.col().find({}, { projection: { _id: 1, updated_at: 1 } }).toArray()
    return docs.map((d: any) => ({ key: d._id, updatedAt: d.updated_at }))
  }

  async getMany(keys: string[]): Promise<StateRow[]> {
    if (keys.length === 0) return []
    const docs = await this.col().find({ _id: { $in: keys } } as any).toArray()
    return docs.map((d: any) => ({ key: d._id, data: d.data, updatedAt: d.updated_at }))
  }

  async put(key: string, data: unknown): Promise<void> {
    await this.col().updateOne({ _id: key } as any, { $set: { data, updated_at: new Date() } }, { upsert: true })
  }

  async del(key: string): Promise<void> {
    await this.col().deleteOne({ _id: key } as any)
  }
}
