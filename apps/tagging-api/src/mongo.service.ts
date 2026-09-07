import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Collection, MongoClient } from 'mongodb'

/* 사내망 replica set에만 닿는다. 연결 실패는 부팅을 막지 않는다 —
   사내망 밖에서 띄웠을 때 서비스가 죽는 대신 라우트가 503을 내는 편이 진단하기 쉽다. */
@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private client: MongoClient | null = null

  async onModuleInit() {
    const uri = process.env.MONGO_URI
    if (!uri) return
    try {
      this.client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5000 }).connect()
    } catch (err) {
      console.error('[mongo] 연결 실패 — 사내망인지 확인하세요:', (err as Error).message)
      this.client = null
    }
  }

  async onModuleDestroy() {
    await this.client?.close()
  }

  collection(name?: string): Collection | null {
    if (!this.client) return null
    return this.client.db(process.env.MONGO_DB || 'eevee').collection(name || process.env.MONGO_COLL || 'products')
  }
}
