import type { CatalogProduct } from '@ddak/schema'
import { CATALOG } from './catalog'
import type { ConstraintLedger } from './ledger'

/*
 * 4단계 근거 수집의 교체 지점 (전략 문서 STEP 4, DESIGN-PIPELINE-LANGGRAPH.md §6) —
 * "조건을 검색 도중에 걸어 통과분 상위 N, LLM은 후보 밖을 보지 못한다"의 계약.
 *
 * v0(staticCatalogProvider)는 정적 카탈로그를 원장(예산·기피)으로 걸러 준다 — 생성 경로에는 연결되어 있지 않다.
 * **v29(2026-09-17)부터 실구현은 catalog-candidates.ts + BFF CatalogService 다**: 후보 주입은 시스템(캐시)이 아니라
 * 사용자 메시지(요청별 표)로 옮겼고, 검증 게이트의 "후보 밖 드롭"은 GuardContext.candidates(이 요청의 후보 목록) 대조로
 * 넓혔다. 이 인터페이스는 상품 검색 API(실데이터)가 오면 core 조회를 대체할 자리로 남긴다.
 */

export type Candidate = CatalogProduct

export interface CandidateProvider {
  /** 원장 필터를 통과한 후보 상위 N — 검색어(intent)는 실검색 구현이 쓴다 */
  getCandidates(intent: string, ledger: ConstraintLedger | null, limit?: number): Promise<Candidate[]>
}

/** v0 — 정적 카탈로그 + 원장 필터 (예산 상한·기피 항목). 실검색 API의 자리 표시 구현 */
export const staticCatalogProvider: CandidateProvider = {
  async getCandidates(_intent, ledger, limit = 50) {
    let list: CatalogProduct[] = CATALOG
    const budget = ledger?.budgetKrw
    if (budget != null) list = list.filter((p) => p.price <= budget)
    const avoid = ledger?.avoid ?? []
    if (avoid.length) {
      list = list.filter((p) => !avoid.some((a) => a && (p.name.includes(a) || p.tags.some((t) => t.includes(a)))))
    }
    return list.slice(0, limit)
  },
}
