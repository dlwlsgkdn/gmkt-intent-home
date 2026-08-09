import type { CatalogProduct } from '@ddak/schema'
import { CATALOG } from './catalog'
import type { ConstraintLedger } from './ledger'

/*
 * 4단계 근거 수집의 교체 지점 (전략 문서 STEP 4, DESIGN-PIPELINE-LANGGRAPH.md §6) —
 * "조건을 검색 도중에 걸어 통과분 상위 N, LLM은 후보 밖을 보지 못한다"의 계약.
 *
 * v0(staticCatalogProvider)는 정적 카탈로그를 원장(예산·기피)으로 걸러 준다. 다만 현재
 * 프롬프트 배선은 {{CATALOG}} 자리표시자(시스템·바이트 고정 = 캐시 흡수)로 전 카탈로그를
 * 싣고 웹 검색 서버 도구가 후보를 보완하는 구조라, 이 프로바이더는 아직 생성 경로에
 * 연결되어 있지 않다. 상품 검색 API(실데이터)가 도착하면:
 *   1) 이 인터페이스의 구현을 검색 API로 교체하고
 *   2) 후보 주입을 시스템(캐시)에서 사용자 메시지(요청별)로 옮기며 캐시 경제성을 재평가,
 *   3) 검증 게이트의 "후보 밖 드롭"을 카탈로그 대조에서 후보 목록 대조로 넓힌다.
 * 계약이 프레임워크·프로바이더 중립이라 프로덕션 빌드가 그대로 소비한다.
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
