import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'drizzle-kit'

/*
 * .env / .env.local 자동 로드 — dotenv 의존성 없이 최소 구현.
 * Vercel 스토리지 통합이 주입한 DATABASE_URL을 `vercel env pull`(.env.local)로 받아
 * 그대로 db:generate/push에 쓰기 위함. 이미 설정된 process.env가 항상 우선한다.
 */
for (const file of ['.env', '.env.local']) {
  const p = path.join(__dirname, file)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
})
