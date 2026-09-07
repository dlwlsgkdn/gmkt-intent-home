import type { CatalogProduct, ProductMatch, ProductMatchFactor } from '@ddak/schema'
import type { ProductRatingGen } from '../schemas'
import type { ConstraintLedger, LedgerFact } from '../ledger'

/*
 * 매칭율(MATCH) 계산 — 전략 문서 6단계 검증 게이트의 한 갈래. 상품마다 "왜 이 점수인가"를 항목별 수치로
 * 남겨 화면 팝오버(Figma 5-2 MATCH 태그 팝오버)가 그대로 그리고, plan 스텝 payload 에 함께 저장된다.
 *
 * 항목 5개 · 가중치 합 100 (MATCH_VERSION 으로 표 버전을 기록한다):
 *  - skin        피부 타입   25  LLM 1~5 (프로필의 피부타입·퍼스널 컬러 대조)
 *  - concern     고민·목적   30  LLM 1~5 (의도·답변의 고민 대조)
 *  - preference  사용 선호   20  LLM 1~5 (마감·질감·루틴 선호 대조)
 *  - price       가격 적합   15  결정적: 원장 예산 대비 가격 (예산이 없으면 LLM 의 가격 대비 가치 1~5, 그것도 없으면 4)
 *  - evidence    근거 신뢰   10  결정적: 카탈로그 검증 상품 5 · 외부몰 PDP+썸네일 4 · PDP만 3
 * 1~5 눈금은 (s-1)/4 로 0~100 에 펴고, score = round(Σ weight × 항목점수 / 100).
 * LLM 평가가 빠진 상품(옛 프롬프트·모의 서버·부분 스트리밍 조각)은 태그 대조 폴백으로 매긴다 — 태그·상품명에
 * 원장 사실값이 겹치면 4, 아니면 3 — 그래서 매칭율 태그는 어떤 상품에도 빠지지 않는다.
 */

export const MATCH_VERSION = 1

export type MatchDimensionKey = 'skin' | 'concern' | 'preference' | 'price' | 'evidence'

export const MATCH_DIMENSIONS: ReadonlyArray<{ key: MatchDimensionKey; label: string; weight: number }> = [
  { key: 'skin', label: '피부 타입', weight: 25 },
  { key: 'concern', label: '고민·목적', weight: 30 },
  { key: 'preference', label: '사용 선호', weight: 20 },
  { key: 'price', label: '가격 적합', weight: 15 },
  { key: 'evidence', label: '근거 신뢰', weight: 10 },
]

export const MATCH_BASIS = '피부 타입 25 · 고민·목적 30 · 사용 선호 20 · 가격 적합 15 · 근거 신뢰 10 가중 합산'

const clamp15 = (n: number) => Math.min(5, Math.max(1, Math.round(n)))
/** 1~5 눈금 → 0~100 */
const pct = (rating: number) => Math.round(((clamp15(rating) - 1) / 4) * 100)

const normalize = (text: string) => text.replace(/\s+/g, '').toLowerCase()

/** 태그 대조 폴백 — 원장 사실값(피부타입 등)이 상품 태그·이름에 겹치면 4, 아니면 3 */
function heuristicRating(product: CatalogProduct, facts: LedgerFact[]): { rating: number; note: string } {
  const haystack = normalize([product.name, product.brand, ...(product.tags ?? [])].join(' '))
  const hits = facts
    .map((f) => f.value)
    .filter((v) => v && v.length >= 2 && haystack.includes(normalize(v)))
  if (hits.length) return { rating: 4, note: `태그·상품명이 '${hits[0]}' 와 맞아요 (자동 대조)` }
  return { rating: 3, note: '직접 겹치는 근거가 없어 기본 점수예요 (자동 대조)' }
}

function priceFactor(product: CatalogProduct, ledger: ConstraintLedger | null | undefined, rating?: ProductRatingGen): { score: number; note: string } {
  const budget = ledger?.budgetKrw
  if (budget != null && budget > 0) {
    const ratio = product.price / budget
    const won = product.price.toLocaleString('ko-KR')
    const cap = budget.toLocaleString('ko-KR')
    if (ratio <= 0.5) return { score: 100, note: `예산 ${cap}원의 절반 이하 (${won}원)` }
    if (ratio <= 0.75) return { score: 75, note: `예산 ${cap}원 안에서 여유 있는 가격 (${won}원)` }
    if (ratio <= 1) return { score: 50, note: `예산 ${cap}원에 가까운 가격 (${won}원)` }
    return { score: 0, note: `예산 ${cap}원을 넘는 가격 (${won}원)` }
  }
  if (rating?.price != null) return { score: pct(rating.price), note: '예산 답변이 없어 가격 대비 가치로 봤어요' }
  return { score: 75, note: '예산 답변이 없어 가격대 무리 없음으로 봤어요' }
}

function evidenceFactor(product: CatalogProduct): { score: number; note: string } {
  const isCatalog = !product.mall
  if (isCatalog) return { score: 100, note: '지마켓 카탈로그의 검증된 상품이에요' }
  if (product.urlKind === 'search') return { score: 25, note: `${product.mall} 검색 결과로 확인한 상품이에요 (상세 페이지는 미확인)` }
  if (product.imageUrl) return { score: 75, note: `${product.mall} 상품 페이지와 썸네일을 확인했어요` }
  return { score: 50, note: `${product.mall} 상품 페이지를 확인했어요 (썸네일은 미확인)` }
}

const FACT_SOURCES: Record<'skin' | 'concern' | 'preference', LedgerFact['source'][]> = {
  skin: ['profile'],
  concern: ['intent', 'answer'],
  preference: ['answer'],
}

/** 상품 하나의 매칭율 — LLM 평가(있으면)와 원장으로 항목 5개를 채우고 가중 합산한다 */
export function scoreProductMatch(
  product: CatalogProduct,
  rating: ProductRatingGen | undefined,
  ledger?: ConstraintLedger | null,
): ProductMatch {
  const facts = ledger?.facts ?? []
  const factors: ProductMatchFactor[] = MATCH_DIMENSIONS.map((dim) => {
    if (dim.key === 'price') {
      const f = priceFactor(product, ledger, rating)
      return { key: dim.key, label: dim.label, weight: dim.weight, score: f.score, note: f.note }
    }
    if (dim.key === 'evidence') {
      const f = evidenceFactor(product)
      return { key: dim.key, label: dim.label, weight: dim.weight, score: f.score, note: f.note }
    }
    const llmKey = dim.key as 'skin' | 'concern' | 'preference'
    const llm = rating?.[llmKey]
    if (llm != null) {
      return { key: dim.key, label: dim.label, weight: dim.weight, score: pct(llm), note: rating?.notes?.[llmKey] || undefined }
    }
    const h = heuristicRating(product, facts.filter((f) => FACT_SOURCES[llmKey].includes(f.source)))
    return { key: dim.key, label: dim.label, weight: dim.weight, score: pct(h.rating), note: h.note }
  })
  const score = Math.round(factors.reduce((sum, f) => sum + (f.weight * f.score) / 100, 0))
  return { score: Math.min(100, Math.max(0, score)), factors, basis: MATCH_BASIS, version: MATCH_VERSION }
}
