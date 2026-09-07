import { Injectable } from '@nestjs/common'
import { readFileSync, statSync } from 'node:fs'
import { MongoService } from './mongo.service'
import { sanitizeTaxonomyDoc } from './mapping'

const CACHE_TTL_MS = 30_000

export type TaxonomyResult = {
  taxonomy: unknown
  source: 'mongo' | 'file' | 'none'
  rev: number | null
  updatedAt: string | null
}

/* 사전의 원천은 Mongo(<MONGO_DB>.taxonomy, _id=TAXONOMY_DOC_ID)로 옮겨졌다.
   Mongo가 안 닿거나 문서가 무효면 옛 Python 저장소의 taxonomy.json(TAXONOMY_PATH,
   이제는 폴백 경로)으로 떨어진다 — 사전이 아예 없으면 검증이 통째로 멈추므로,
   연결 문제로 죽는 것보다 낡은 사본으로 도는 편이 낫다. */
@Injectable()
export class TaxonomyService {
  private fileCache: { mtimeMs: number; data: unknown } | null = null
  private mongoCache: { at: number; result: TaxonomyResult } | null = null

  constructor(private readonly mongo: MongoService) {}

  async read(): Promise<TaxonomyResult> {
    if (this.mongoCache && Date.now() - this.mongoCache.at < CACHE_TTL_MS) {
      return this.mongoCache.result
    }
    const fromMongo = await this.readFromMongo()
    if (fromMongo) {
      this.mongoCache = { at: Date.now(), result: fromMongo }
      return fromMongo
    }
    const file = this.readFile()
    return file
      ? { taxonomy: file, source: 'file', rev: null, updatedAt: null }
      : { taxonomy: null, source: 'none', rev: null, updatedAt: null }
  }

  private async readFromMongo(): Promise<TaxonomyResult | null> {
    const collectionName = process.env.TAXONOMY_COLLECTION || 'taxonomy'
    const docId = process.env.TAXONOMY_DOC_ID || 'current'
    const collection = this.mongo.collection(collectionName)
    if (!collection) {
      console.warn('[taxonomy] Mongo 연결 없음 — 파일로 폴백합니다')
      return null
    }
    try {
      const doc = await collection.findOne({ _id: docId } as never)
      if (!doc) {
        console.warn(`[taxonomy] Mongo 문서 없음(_id=${docId}) — 파일로 폴백합니다`)
        return null
      }
      const sanitized = sanitizeTaxonomyDoc(doc)
      if (!sanitized) {
        console.warn('[taxonomy] Mongo 문서의 categories가 비어 있음 — 파일로 폴백합니다')
        return null
      }
      return { taxonomy: sanitized.taxonomy, source: 'mongo', rev: sanitized.rev, updatedAt: sanitized.updatedAt }
    } catch (err) {
      console.warn('[taxonomy] Mongo 조회 실패 — 파일로 폴백합니다:', (err as Error).message)
      return null
    }
  }

  private readFile(): unknown | null {
    const path = process.env.TAXONOMY_PATH
    if (!path) return null
    try {
      const { mtimeMs } = statSync(path)
      if (this.fileCache?.mtimeMs === mtimeMs) return this.fileCache.data
      const data = JSON.parse(readFileSync(path, 'utf8'))
      this.fileCache = { mtimeMs, data }
      return data
    } catch (err) {
      console.error('[taxonomy] 읽기 실패:', (err as Error).message)
      return null
    }
  }
}
