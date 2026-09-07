import { Injectable } from '@nestjs/common'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MongoService } from './mongo.service'
import { readCacheEnvelope, sanitizeTaxonomyDoc } from './mapping'

const CACHE_TTL_MS = 30_000
const DEFAULT_CACHE_PATH = join(tmpdir(), 'ddak-taxonomy-cache.json')

export type TaxonomyResult = {
  taxonomy: unknown
  source: 'mongo' | 'cache' | 'file' | 'none'
  rev: number | null
  updatedAt: string | null
  cachedAt: string | null
}

/* 사전의 원천은 Mongo(<MONGO_DB>.taxonomy, _id=TAXONOMY_DOC_ID)로 옮겨졌다.
   Mongo를 성공적으로 읽을 때마다 그 내용을 로컬 캐시 파일(TAXONOMY_CACHE_PATH)에
   써두고, Mongo가 안 닿으면 그 캐시를 먼저 본다 — 컨테이너 배치에서도 항상 쓸 수
   있는 자리(기본 os.tmpdir())라 옛 파일 폴백(TAXONOMY_PATH, 다른 저장소 소유라
   더 이상 갱신되지 않고 컨테이너엔 아예 없을 수 있다)보다 최신 판일 가능성이 높다.
   캐시조차 없으면 그제서야 옛 파일로, 그마저 없으면 포기한다 — 사전이 아예 없어
   검증이 통째로 멈추는 것보다 판을 알 수 없는 사본으로라도 도는 편이 낫기 때문
   (다만 이 경우 rev가 null이라 화면이 "어느 판인지 모른다"고 경고할 수 있다). */
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
      this.writeCache(fromMongo)
      this.mongoCache = { at: Date.now(), result: fromMongo }
      return fromMongo
    }
    const fromCache = this.readCache()
    if (fromCache) return fromCache
    const file = this.readFile()
    return file
      ? { taxonomy: file, source: 'file', rev: null, updatedAt: null, cachedAt: null }
      : { taxonomy: null, source: 'none', rev: null, updatedAt: null, cachedAt: null }
  }

  private async readFromMongo(): Promise<TaxonomyResult | null> {
    const collectionName = process.env.TAXONOMY_COLLECTION || 'taxonomy'
    const docId = process.env.TAXONOMY_DOC_ID || 'current'
    const collection = this.mongo.collection(collectionName)
    if (!collection) {
      console.warn('[taxonomy] Mongo 연결 없음 — 캐시로 폴백합니다')
      return null
    }
    try {
      const doc = await collection.findOne({ _id: docId } as never)
      if (!doc) {
        console.warn(`[taxonomy] Mongo 문서 없음(_id=${docId}) — 캐시로 폴백합니다`)
        return null
      }
      const sanitized = sanitizeTaxonomyDoc(doc)
      if (!sanitized) {
        console.warn('[taxonomy] Mongo 문서의 categories가 비어 있음 — 캐시로 폴백합니다')
        return null
      }
      return {
        taxonomy: sanitized.taxonomy,
        source: 'mongo',
        rev: sanitized.rev,
        updatedAt: sanitized.updatedAt,
        cachedAt: null,
      }
    } catch (err) {
      console.warn('[taxonomy] Mongo 조회 실패 — 캐시로 폴백합니다:', (err as Error).message)
      return null
    }
  }

  private cachePath(): string {
    return process.env.TAXONOMY_CACHE_PATH || DEFAULT_CACHE_PATH
  }

  /* best-effort — 캐시 쓰기가 실패해도 요청 자체는 방금 읽은 Mongo 결과로 정상 응답한다. */
  private writeCache(result: TaxonomyResult) {
    try {
      const envelope = {
        taxonomy: result.taxonomy,
        rev: result.rev,
        updatedAt: result.updatedAt,
        cachedAt: new Date().toISOString(),
      }
      writeFileSync(this.cachePath(), JSON.stringify(envelope), 'utf8')
    } catch (err) {
      console.warn('[taxonomy] 캐시 쓰기 실패(무시하고 계속 진행합니다):', (err as Error).message)
    }
  }

  private readCache(): TaxonomyResult | null {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.cachePath(), 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[taxonomy] 캐시 파일 읽기 실패 — 옛 파일 폴백으로 넘어갑니다:', (err as Error).message)
      }
      return null
    }
    const envelope = readCacheEnvelope(raw)
    if (!envelope) {
      console.warn('[taxonomy] 캐시 파일이 무효함 — 옛 파일 폴백으로 넘어갑니다')
      return null
    }
    console.warn(`[taxonomy] 캐시로 폴백합니다 (rev=${envelope.rev}, cachedAt=${envelope.cachedAt})`)
    return {
      taxonomy: envelope.taxonomy,
      source: 'cache',
      rev: envelope.rev,
      updatedAt: envelope.updatedAt,
      cachedAt: envelope.cachedAt,
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
