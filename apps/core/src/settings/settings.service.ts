import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DB, type DbOrNull } from '../db/db.module'
import type { Db } from '../db/client'
import { settings } from '../db/schema'

/** 운영 설정 KV — core는 값을 해석하지 않는다 (jsonb 저장·조회·삭제만). 예: llm-model */
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: DbOrNull) {}

  private conn(): Db {
    if (!this.db) throw new ServiceUnavailableException('DATABASE_URL이 설정되지 않았습니다')
    return this.db
  }

  async get(key: string) {
    const [row] = await this.conn().select().from(settings).where(eq(settings.key, key))
    if (!row) throw new NotFoundException('설정이 없습니다')
    return row
  }

  async put(key: string, value: unknown) {
    const [row] = await this.conn()
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
      .returning()
    return row
  }

  /** 설정 제거 — 없는 키 삭제도 성공으로 본다 (멱등) */
  async remove(key: string) {
    await this.conn().delete(settings).where(eq(settings.key, key))
    return { ok: true }
  }
}
