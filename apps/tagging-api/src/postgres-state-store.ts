import { neon, NeonQueryFunction } from '@neondatabase/serverless'
import type { StateIndexRow, StateRow, StateStore } from './state-store'

/* api/state.js 와 같은 테이블·같은 스키마 — Vercel 배포본과 같은 Neon DB를 보게 하려는 것이라
   컬럼·타입을 여기서 다르게 가져가면 안 된다. */
export class PostgresStateStore implements StateStore {
  private sql: NeonQueryFunction<false, false>
  private ready?: Promise<unknown>

  constructor(url: string) {
    this.sql = neon(url)
  }

  private async ensureTable() {
    if (!this.ready) {
      this.ready = this.sql`CREATE TABLE IF NOT EXISTS app_state (
        key text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`.catch((e) => {
        this.ready = undefined
        throw e
      })
    }
    await this.ready
  }

  async listIndex(): Promise<StateIndexRow[]> {
    await this.ensureTable()
    const rows = await this.sql`SELECT key, updated_at FROM app_state`
    return rows.map((r: any) => ({ key: r.key, updatedAt: r.updated_at }))
  }

  async getMany(keys: string[]): Promise<StateRow[]> {
    await this.ensureTable()
    if (keys.length === 0) return []
    const rows = await this.sql`SELECT key, data, updated_at FROM app_state WHERE key = ANY(${keys})`
    return rows.map((r: any) => ({ key: r.key, data: r.data, updatedAt: r.updated_at }))
  }

  async put(key: string, data: unknown): Promise<void> {
    await this.ensureTable()
    await this.sql`INSERT INTO app_state (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`
  }

  async del(key: string): Promise<void> {
    await this.ensureTable()
    await this.sql`DELETE FROM app_state WHERE key = ${key}`
  }
}
