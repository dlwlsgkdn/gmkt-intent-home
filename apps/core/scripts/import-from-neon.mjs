#!/usr/bin/env node
/*
 * Neon Postgres → 사내 Mongo 데이터 이관 — 일회성 스크립트.
 * 이번 작업(Mongo 이관)에서는 실행하지 않는다 — 이 환경에는 Neon 자격증명이 없다.
 *
 *   DATABASE_URL=<neon 접속 문자열> MONGO_URI=<mongo 접속 문자열> \
 *     node apps/core/scripts/import-from-neon.mjs --dry-run     # 테이블별 건수만 세고 종료
 *
 *   DATABASE_URL=<neon 접속 문자열> MONGO_URI=<mongo 접속 문자열> \
 *     node apps/core/scripts/import-from-neon.mjs --overwrite   # 실제 적재
 *
 * --overwrite 없이 그냥 실행하면 거부한다 — 운영 컬렉션을 실수로 덮지 않기 위한 안전장치다.
 * 문서는 _id(원본 PK)로 upsert하므로 재실행해도 멱등하다.
 *
 * @neondatabase/serverless는 core의 의존성이 아니다(Mongo 이관 후 걷어냈다) — 워크스페이스
 * 루트 package.json이 api/state.js(스튜디오 서버리스)용으로 여전히 갖고 있어 호이스팅된
 * node_modules에서 그대로 resolve된다. Pool은 WebSocket을 쓰므로 Node 22+ 필요(전역 WebSocket).
 */
import { Pool } from '@neondatabase/serverless'
import { MongoClient } from 'mongodb'

const DATABASE_URL = process.env.DATABASE_URL
const MONGO_URI = process.env.MONGO_URI
const MONGO_DB = process.env.MONGO_DB || 'eevee'

const dryRun = process.argv.includes('--dry-run')
const overwrite = process.argv.includes('--overwrite')

if (!DATABASE_URL) {
  console.error('DATABASE_URL이 없습니다 (Neon 접속 문자열)')
  process.exit(1)
}
if (!dryRun && !MONGO_URI) {
  console.error('MONGO_URI가 없습니다')
  process.exit(1)
}
if (!dryRun && !overwrite) {
  console.error('실제 적재에는 --overwrite가 필요합니다 (안전장치). 건수만 보려면 --dry-run')
  process.exit(1)
}

/* 테이블 → 컬렉션 매핑 + 문서 변환. 컬럼 이름은 apps/core/src/db/schema.ts(구 drizzle 정의,
 * git 이력 참고)와 같고, 문서 형태는 현재 apps/core/src/db/schema.ts(Mongo 문서 타입)와 같다. */
const TABLES = [
  { table: 'threads', collection: 'threads', mapDoc: mapThread },
  { table: 'thread_steps', collection: 'thread_steps', mapDoc: mapThreadStep },
  { table: 'settings', collection: 'settings', mapDoc: mapSetting },
  { table: 'eval_cases', collection: 'eval_cases', mapDoc: mapEvalCase },
  { table: 'eval_runs', collection: 'eval_runs', mapDoc: mapEvalRun },
]

function mapThread(row) {
  return {
    _id: row.id,
    userId: row.user_id,
    title: row.title,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function mapThreadStep(row) {
  return {
    _id: row.id,
    threadId: row.thread_id,
    seq: row.seq,
    stage: row.stage,
    payload: row.payload,
    llmMeta: row.llm_meta,
    createdAt: row.created_at,
  }
}
function mapSetting(row) {
  return { _id: row.key, value: row.value, updatedAt: row.updated_at }
}
function mapEvalCase(row) {
  return {
    _id: row.id,
    title: row.title,
    intent: row.intent,
    profile: row.profile,
    survey: row.survey,
    answers: row.answers,
    sourceThreadId: row.source_thread_id,
    createdAt: row.created_at,
  }
}
function mapEvalRun(row) {
  return {
    _id: row.id,
    caseId: row.case_id,
    config: row.config,
    page: row.page,
    dropLog: row.drop_log,
    meta: row.meta,
    score: row.score,
    comment: row.comment,
    components: row.components,
    judge: row.judge,
    createdAt: row.created_at,
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const mongo = dryRun ? null : await new MongoClient(MONGO_URI).connect()
  try {
    for (const { table, collection, mapDoc } of TABLES) {
      const { rows } = await pool.query(`select * from ${table}`)
      console.log(`${table}: ${rows.length}건`)
      if (dryRun || rows.length === 0) continue
      const col = mongo.db(MONGO_DB).collection(collection)
      const ops = rows.map((row) => {
        const doc = mapDoc(row)
        return { replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } }
      })
      const result = await col.bulkWrite(ops)
      console.log(`  → ${collection}: upserted ${result.upsertedCount}, replaced ${result.modifiedCount}`)
    }
  } finally {
    await pool.end()
    await mongo?.close()
  }
  console.log(dryRun ? '건수 확인 완료 (dry-run — Mongo에 쓰지 않았습니다)' : '이관 완료')
}

void main()
