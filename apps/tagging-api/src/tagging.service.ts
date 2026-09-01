import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { toDocPatch, toUnit } from './mapping'

@Injectable()
export class TaggingService {
  constructor(private readonly mongo: MongoService, private readonly taxonomy: TaxonomyService) {}

  private collection() {
    const collection = this.mongo.collection()
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  /* 719건을 한 번에 보낸다. 응답 1~3MB는 지금 규모에서 충분하다 —
     느려지면 그때 목록/상세를 나눈다. */
  async bootstrap() {
    const docs = await this.collection().find({ status: 'analyzed' }).toArray()
    return { taxonomy: this.taxonomy.read(), units: docs.map(toUnit) }
  }

  /* 대시보드 타일용 — 719건 본문을 받지 않으려고 따로 둔다. */
  async summary() {
    const docs = await this.collection()
      .find({ status: 'analyzed' }, { projection: { review_status: 1 } })
      .toArray()
    const counts = { done: 0, unreviewed: 0, approved: 0, rejected: 0 }
    for (const doc of docs) {
      if (doc.review_status === 'reviewed') counts.approved += 1
      else if (doc.review_status === 'needs_fix') counts.rejected += 1
      else if (doc.review_status === 'auto_ok') counts.done += 1
      else counts.unreviewed += 1
    }
    return { counts, total: docs.length }
  }

  async saveUnit(productId: string, patch: unknown) {
    const collection = this.collection()
    const doc = await collection.findOne({ product_id: productId })
    if (!doc) throw new NotFoundException(`상품 ${productId}을(를) 찾을 수 없습니다`)
    const set = toDocPatch(patch, doc)
    await collection.updateOne({ product_id: productId }, { $set: set })
    return toUnit({ ...doc, ...set })
  }
}
