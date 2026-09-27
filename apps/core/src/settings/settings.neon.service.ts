import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DB, type DbOrNull } from '../db/db.module'
import type { Db } from '../db/neon.client'
import { settings } from '../db/neon.schema'
import { neonSettingToWire } from '../db/neon.wire'
import { notConnectedMessage } from '../db/store'
import { SettingsService } from './settings.service'

/** 운영 설정 KV — Neon Postgres(Drizzle) 구현. core는 값을 해석하지 않는다 (jsonb 저장·조회·삭제만). 예: llm-model */
@Injectable()
export class SettingsNeonService extends SettingsService {
  constructor(@Inject(DB) private readonly db: DbOrNull) {
    super()
  }

  private conn(): Db {
    if (!this.db) throw new ServiceUnavailableException(notConnectedMessage())
    return this.db
  }

  async get(key: string) {
    const [row] = await this.conn().select().from(settings).where(eq(settings.key, key))
    if (!row) throw new NotFoundException('설정이 없습니다')
    return neonSettingToWire(row)
  }

  async put(key: string, value: unknown) {
    const [row] = await this.conn()
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
      .returning()
    return neonSettingToWire(row)
  }

  /** 설정 제거 — 없는 키 삭제도 성공으로 본다 (멱등) */
  async remove(key: string) {
    await this.conn().delete(settings).where(eq(settings.key, key))
    return { ok: true }
  }
}
