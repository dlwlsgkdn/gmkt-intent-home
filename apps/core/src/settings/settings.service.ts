import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { Collection } from 'mongodb'
import { MongoService } from '../db/mongo.service'
import { SETTINGS_COLL, type SettingDoc } from '../db/schema'
import { settingToWire } from '../db/wire'

/** 운영 설정 KV — core는 값을 해석하지 않는다 (문서 저장·조회·삭제만). 예: llm-model */
@Injectable()
export class SettingsService {
  constructor(private readonly mongo: MongoService) {}

  private col(): Collection<SettingDoc> {
    const c = this.mongo.collection<SettingDoc>(SETTINGS_COLL)
    if (!c) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다')
    return c
  }

  async get(key: string) {
    const row = await this.col().findOne({ _id: key })
    if (!row) throw new NotFoundException('설정이 없습니다')
    return settingToWire(row)
  }

  async put(key: string, value: unknown) {
    const row = await this.col().findOneAndUpdate(
      { _id: key },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    )
    if (!row) throw new Error('설정 저장 결과가 비어 있습니다 (일어날 수 없는 경합)')
    return settingToWire(row)
  }

  /** 설정 제거 — 없는 키 삭제도 성공으로 본다 (멱등) */
  async remove(key: string) {
    await this.col().deleteOne({ _id: key })
    return { ok: true }
  }
}
