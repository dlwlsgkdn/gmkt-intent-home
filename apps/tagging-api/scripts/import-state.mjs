#!/usr/bin/env node
/* 일회성 이관 스크립트 — 옛 Neon(app_state) 전체 덤프를 사내 Mongo(app_state 컬렉션)로 옮긴다.
   원본 API(api/state.js)의 전체 조회 응답 { <key>: { data, updatedAt }, ... } 을 그대로 받아
   MongoStateStore 와 같은 문서 형태 { _id: key, data, updated_at } 로 업서트한다.

   사용법:
     node scripts/import-state.mjs --from https://ddak-scenario-studio.vercel.app/api/state --overwrite
     node scripts/import-state.mjs --file ./state-dump.json
     node scripts/import-state.mjs --file ./state-dump.json --overwrite

   --from <url>   원본 전체 조회 응답을 그 주소에서 GET 으로 받는다 (인자 없는 GET /api/state)
   --file <path>  같은 모양의 JSON 파일에서 읽는다 (--from 과 동시 사용 불가)
   --overwrite    이미 있는 문서도 덮어쓴다. 안 주면 이미 있는 키는 건너뛰고 경고만 남긴다
                  (사내 데이터를 실수로 덮지 않기 위한 기본값)

   환경변수(.env 또는 셸): MONGO_URI(필수) · MONGO_DB(기본 eevee) · STATE_COLL(기본 app_state)
   이 스크립트는 만들기만 하고 이번 작업에서 실행하지 않는다 — 실행 전 반드시 --file/--from
   내용과 대상 Mongo가 맞는지 확인할 것. */
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { MongoClient } from 'mongodb'

/* apps/tagging-api/src/state-logic.ts 의 KEY_PATTERN 과 반드시 같은 문자열로 유지할 것 —
   빌드 산출물(dist)에 기대지 않으려고 이 스크립트에 그대로 복사해 둔다. */
const KEY_PATTERN =
  /^(accounts|keywords|accounts-meta|starters-meta|starter:[A-Za-z0-9_-]{1,64}|account:[A-Za-z0-9_-]{1,64}(?::threads|:(?:versions|scenario):[A-Za-z0-9_-]{1,64})?)$/

function parseArgs(argv) {
  const out = { from: null, file: null, overwrite: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--from') out.from = argv[++i]
    else if (a === '--file') out.file = argv[++i]
    else if (a === '--overwrite') out.overwrite = true
    else {
      console.error(`알 수 없는 인자: ${a}`)
      process.exit(1)
    }
  }
  if (!out.from && !out.file) {
    console.error('사용법: node scripts/import-state.mjs (--from <url> | --file <path>) [--overwrite]')
    process.exit(1)
  }
  if (out.from && out.file) {
    console.error('--from 과 --file 은 동시에 쓸 수 없습니다')
    process.exit(1)
  }
  return out
}

async function loadDump({ from, file }) {
  if (file) {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw)
  }
  const res = await fetch(from)
  if (!res.ok) throw new Error(`GET ${from} 실패: ${res.status}`)
  return res.json()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dump = await loadDump(args)
  const entries = Object.entries(dump || {})
  if (entries.length === 0) {
    console.log('덤프에 옮길 행이 없습니다.')
    return
  }

  const invalid = entries.filter(([key]) => !KEY_PATTERN.test(key))
  if (invalid.length > 0) {
    console.error(`알 수 없는 키 형식 ${invalid.length}개 — 이관을 멈춥니다:`, invalid.map(([k]) => k))
    process.exit(1)
  }

  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI 가 설정되지 않았습니다 (.env 확인)')
    process.exit(1)
  }
  const dbName = process.env.MONGO_DB || 'eevee'
  const collName = process.env.STATE_COLL || 'app_state'

  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect()
  try {
    const col = client.db(dbName).collection(collName)
    let inserted = 0
    let skipped = 0
    for (const [key, row] of entries) {
      const { data, updatedAt } = row || {}
      const existing = await col.findOne({ _id: key })
      if (existing && !args.overwrite) {
        console.warn(`건너뜀 (이미 있음, --overwrite 없이는 안 덮어씀): ${key}`)
        skipped += 1
        continue
      }
      await col.updateOne(
        { _id: key },
        { $set: { data, updated_at: updatedAt ? new Date(updatedAt) : new Date() } },
        { upsert: true },
      )
      inserted += 1
    }
    console.log(
      `완료 — ${dbName}.${collName}: ${inserted}건 반영, ${skipped}건 건너뜀 (전체 ${entries.length}건)`,
    )
  } finally {
    await client.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
