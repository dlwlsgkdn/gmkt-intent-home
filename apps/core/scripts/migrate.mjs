/*
 * DB 마이그레이션 러너 — drizzle/ 폴더의 SQL을 저널 순서대로 적용한다.
 * db:push(diff 반영)와 달리 커밋된 마이그레이션 SQL을 그대로 실행하므로,
 * push가 못 하는 변경(uuid→text 타입 전환 등)도 파일에 적힌 대로 재현된다.
 * 적용 이력은 drizzle 표준 추적 테이블(drizzle.__drizzle_migrations)에 남는다.
 *
 *   node scripts/migrate.mjs              # 미적용 마이그레이션 적용
 *   node scripts/migrate.mjs --status     # 저널 vs 적용 이력 조회 (읽기 전용)
 *   node scripts/migrate.mjs --baseline   # push 등으로 이미 최신 스키마인 DB에
 *                                         # 전체 이력을 "적용됨"으로 표시만 (SQL 실행 없음, 최초 1회)
 *
 * WebSocket 드라이버를 쓰므로 Node 22+ 필요 (전역 WebSocket).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'

const coreDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// drizzle.config.ts와 같은 .env/.env.local 로드 — 이미 설정된 process.env가 우선
for (const file of ['.env', '.env.local']) {
  const p = path.join(coreDir, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 없습니다 — apps/core/.env 또는 .env.local 확인 (vercel env pull)')
  process.exit(1)
}

const migrationsFolder = path.join(coreDir, 'drizzle')
const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'))
/** drizzle-orm 마이그레이터와 동일한 해시 — SQL 파일 원문의 sha256 */
const entryHash = (tag) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), 'utf8')).digest('hex')

const mode = process.argv[2]
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  if (mode === '--status') {
    let applied = []
    try {
      const r = await pool.query('select hash, created_at from drizzle.__drizzle_migrations order by created_at')
      applied = r.rows
    } catch (e) {
      if (e.code !== '42P01') throw e // 42P01 = 추적 테이블 없음 (한 번도 migrate/baseline 안 함)
    }
    const lastAt = applied.length ? Number(applied[applied.length - 1].created_at) : 0
    console.log(`적용 이력 ${applied.length}건${applied.length ? '' : ' — 추적 테이블 없음/비어 있음'}`)
    for (const m of journal.entries) {
      console.log(` ${m.when <= lastAt ? '✔ 적용됨 ' : '· 미적용'}  ${m.tag}`)
    }
  } else if (mode === '--baseline') {
    await pool.query('CREATE SCHEMA IF NOT EXISTS "drizzle"')
    await pool.query(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    )
    const { rows } = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations')
    if (rows[0].n > 0) {
      console.error(`이미 적용 이력이 ${rows[0].n}건 있습니다 — baseline은 빈 이력에만 씁니다 (--status로 확인)`)
      process.exit(1)
    }
    for (const m of journal.entries) {
      await pool.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [
        entryHash(m.tag),
        m.when,
      ])
      console.log(`✔ 적용됨 표시: ${m.tag}`)
    }
    console.log('baseline 완료 — DB 스키마가 이미 최신이라는 전제입니다. 이후엔 db:migrate만 쓰세요.')
  } else {
    await migrate(drizzle(pool), { migrationsFolder })
    console.log('✔ 마이그레이션 적용 완료 (--status로 이력 확인)')
  }
} finally {
  await pool.end()
}
