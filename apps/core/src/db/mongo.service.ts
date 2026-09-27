import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Collection, Db, Document, MongoClient } from 'mongodb'
import { CATALOG_CONTENTS_COLL, CATALOG_PRODUCTS_COLL, EVAL_RUNS_COLL, THREAD_STEPS_COLL, THREADS_COLL } from './schema'
import { STORE } from './store'

/*
 * 사내 Mongo 연결 — apps/tagging-api의 MongoService와 같은 패턴이다: 연결 실패가
 * 부팅을 막지 않는다(사내망 밖에서 띄웠을 때 프로세스가 죽는 대신 DB 라우트만 503을 내는
 * 편이 진단하기 쉽고, 쿠버네티스 프로브가 healthz를 계속 200으로 본다). core는 tagging-api와
 * 별도 프로세스라 자기 연결을 따로 갖는다 — 같은 사내 Mongo 클러스터에 붙더라도 무관하다.
 * 저장소로 Mongo 를 고르지 않은 프로세스(STORE≠mongo, 예: Vercel 의 Neon 배포)는 MONGO_URI 가 있어도 연결하지 않는다.
 */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('mongo')
  private client: MongoClient | null = null

  async onModuleInit() {
    if (STORE !== 'mongo') return
    const uri = process.env.MONGO_URI
    if (!uri) {
      this.logger.warn('CORE_STORE=mongo 인데 MONGO_URI 가 없다 — DB 라우트는 503')
      return
    }
    const dbName = process.env.MONGO_DB || 'eevee'
    try {
      this.client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect()
      await ensureIndexes(this.client.db(dbName))
      this.logger.log(`연결됨 — db=${dbName}`)
    } catch (err) {
      this.logger.error(`연결 실패 — 사내망인지 확인하세요: ${(err as Error).message}`)
      this.client = null
    }
  }

  async onModuleDestroy() {
    await this.client?.close()
  }

  db(): Db | null {
    if (!this.client) return null
    return this.client.db(process.env.MONGO_DB || 'eevee')
  }

  collection<T extends Document = Document>(name: string): Collection<T> | null {
    return this.db()?.collection<T>(name) ?? null
  }
}

/** 기동 시 인덱스 보장 — Postgres가 FK·유니크 제약으로 공짜로 해 주던 것을 명시적으로
 * 만든다. createIndex는 멱등이라 재기동마다 다시 불러도 안전하다. */
async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection(THREADS_COLL).createIndex({ userId: 1, updatedAt: -1 }, { name: 'threads_user_updated_idx' }),
    db
      .collection(THREAD_STEPS_COLL)
      .createIndex({ threadId: 1, seq: 1 }, { name: 'thread_steps_thread_seq_uq', unique: true }),
    db.collection(EVAL_RUNS_COLL).createIndex({ caseId: 1, createdAt: -1 }, { name: 'eval_runs_case_idx' }),
    ensureCatalogIndexes(db),
  ])
}

/** 내재화 카탈로그 인덱스 — 기동 시와 `POST /internal/catalog/ensure-schema`(운영 콘솔 「표 만들기」)가 부른다. createIndex 는 멱등.
 * 검색(searchText 정규식 부분 일치)은 인덱스를 못 타므로 여기엔 없다 — 필터·정렬·커서 축만 건다 */
export async function ensureCatalogIndexes(db: Db) {
  const products = db.collection(CATALOG_PRODUCTS_COLL)
  const contents = db.collection(CATALOG_CONTENTS_COLL)
  await Promise.all([
    products.createIndex({ mall: 1, verified: 1 }, { name: 'catalog_products_mall_idx' }),
    products.createIndex({ status: 1, verified: 1 }, { name: 'catalog_products_status_idx' }),
    products.createIndex({ updatedAt: -1, _id: -1 }, { name: 'catalog_products_updated_idx' }),
    products.createIndex({ lastSeenAt: 1, _id: 1 }, { name: 'catalog_products_seen_idx' }),
    contents.createIndex({ type: 1, verified: 1 }, { name: 'catalog_contents_type_idx' }),
    contents.createIndex({ status: 1, verified: 1 }, { name: 'catalog_contents_status_idx' }),
    contents.createIndex({ updatedAt: -1, _id: -1 }, { name: 'catalog_contents_updated_idx' }),
  ])
}
