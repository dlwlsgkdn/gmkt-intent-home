import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { MongoService } from './mongo.service'
import { TaxonomyService } from './taxonomy.service'
import { decisionToReview, joinListings, nowIso, toCatalogUnit, toDocPatch } from './mapping'

/* 화면이 쓰는 필드만 가져온다. 투영이 없으면 11.53MB 를 통째로 끌어와 2.7초가 걸린다
   (실측) — toUnit 이 대부분 버리는데도. 투영 후 두 질의 병렬로 276ms. */
const CATALOG_FIELDS = [
  'catalog_id', 'merged_into', 'name', 'brand', 'brand_name', 'inferred_brand', 'image_url',
  'ingredients_from_spec', 'volume_ml', 'formulation', 'ingredient_tags',
  'confidence', 'field_confidence', 'rationale', 'review_status', 'review_meta',
  'inferred_category', 'sub_type', 'body_part',
  'skin_types', 'skin_types_primary', 'concerns', 'concerns_primary',
  'results', 'results_primary', 'conditions', 'conditions_primary',
]
const LISTING_FIELDS = [
  'product_id', 'catalog_ids', 'source', 'name', 'brand', 'brand_name', 'inferred_brand',
  'price', 'url', 'image_url', 'options', 'product_info', 'usage_method',
  'review_stats', 'review_ai_summary',
]
const projection = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, 1]))

@Injectable()
export class TaggingService {
  constructor(private readonly mongo: MongoService, private readonly taxonomy: TaxonomyService) {}

  private catalog() {
    const collection = this.mongo.collection(process.env.CATALOG_COLL || 'catalog')
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  private listings() {
    const collection = this.mongo.collection()
    if (!collection) throw new ServiceUnavailableException('Mongo에 연결되지 않았습니다 (사내망 확인)')
    return collection
  }

  /* 카탈로그 946건 + 리스팅 요약을 한 번에 보낸다(gzip 후 506KB). 목록/상세를 나누지
     않는 이유: 병목은 건수가 아니라 투영 누락이었다 — 설계 문서 §4-5. */
  async bootstrap() {
    const [catalogDocs, productDocs] = await Promise.all([
      this.catalog().find({}, { projection: projection(CATALOG_FIELDS) }).toArray(),
      this.listings().find({ status: 'analyzed' }, { projection: projection(LISTING_FIELDS) }).toArray(),
    ])
    const { units, unlinked } = joinListings(catalogDocs, productDocs)
    const { taxonomy, source, rev, updatedAt, cachedAt } = await this.taxonomy.read()
    return { taxonomy, units, unlinked, taxonomyMeta: { source, rev, updatedAt, cachedAt } }
  }

  /* 대시보드 타일용 — 본문을 받지 않으려고 따로 둔다. */
  async summary() {
    const docs = await this.catalog()
      .find({ merged_into: { $exists: false } }, { projection: { review_status: 1 } })
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

  private async findUnit(catalogId: string) {
    const doc = await this.catalog().findOne({ catalog_id: catalogId })
    if (!doc) throw new NotFoundException(`카탈로그 ${catalogId}을(를) 찾을 수 없습니다`)
    return doc
  }

  /* 되쓰기 뒤 화면에 돌려줄 단위를 만들 때도 묶인 리스팅을 다시 붙인다 —
     응답 모양이 bootstrap 과 같아야 FE 가 한 규칙으로 읽는다. */
  private async withListings(doc: any) {
    const listings = await this.listings()
      .find({ catalog_ids: doc.catalog_id }, { projection: projection(LISTING_FIELDS) })
      .toArray()
    return toCatalogUnit(doc, listings)
  }

  async saveUnit(catalogId: string, patch: unknown) {
    const doc = await this.findUnit(catalogId)
    const set = toDocPatch(patch, doc)
    await this.catalog().updateOne({ catalog_id: catalogId }, { $set: set })
    return this.withListings({ ...doc, ...set })
  }

  async setDecision(catalogId: string, decision: unknown) {
    const doc = await this.findUnit(catalogId)
    const set = { ...decisionToReview(decision), updated_at: nowIso() }
    await this.catalog().updateOne({ catalog_id: catalogId }, { $set: set })
    return this.withListings({ ...doc, ...set })
  }
}
