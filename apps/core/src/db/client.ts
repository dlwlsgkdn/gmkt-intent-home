import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

/** Neon HTTP 드라이버 — 요청당 HTTP 질의라 서버리스에서 커넥션 풀이 필요 없다 */
export function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL이 설정되지 않았습니다')
  return drizzle(neon(url), { schema })
}

export type Db = ReturnType<typeof createDb>
