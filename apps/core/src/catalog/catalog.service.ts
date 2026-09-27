import type {
  CatalogContentRow,
  CatalogListQuery,
  CatalogProductRow,
  CatalogSearchQuery,
  CatalogStatsWire,
  PatchCatalogRowBody,
} from '@ddak/schema'
import type { CatalogContentWire, CatalogProductWire } from '../db/wire'

/*
 * 내재화 카탈로그 저장·검색의 계약 = DI 토큰 (2026-09-17). core 원칙대로 내용은 해석하지 않는다 — 검색어 추출·후보 주입·
 * 검증은 BFF/@ddak/pipeline 몫. 구현은 저장소별로 둘이고 CatalogModule 이 STORE 에 따라 하나를 꽂는다:
 *  - catalog.neon.service.ts  — Postgres 표 2개(마이그레이션 0005) + pg_trgm ILIKE, 병합은 SQL(onConflictDoUpdate)
 *  - catalog.mongo.service.ts — 컬렉션 2개, 정규식 부분 일치로 거른 뒤 Node 점수·정렬(catalog.logic.ts), 수확은 $inc 원자 갱신
 * 검색 순위 규칙(부분 일치 개수, 제품 유형 2점, 동률은 검증·노출 횟수·리뷰)은 양쪽이 같아야 한다.
 */
export abstract class CatalogService {
  /** 둘러보기 — 운영 콘솔 표. updatedAt 내림차순 키셋 커서(`<updatedAt ISO>|<id>`), 검색과 달리 미검증·dead 도 보인다 */
  abstract listProducts(q: CatalogListQuery): Promise<{ items: CatalogProductWire[]; nextCursor: string | null; total: number }>
  abstract listContents(q: CatalogListQuery): Promise<{ items: CatalogContentWire[]; nextCursor: string | null; total: number }>
  /** 일괄 upsert (≤500). bump=true(수확)면 recommendCount 누적·source/verified(OR)/tags(합집합)/status 보존 */
  abstract upsertProducts(items: CatalogProductRow[], bump?: boolean): Promise<{ upserted: number }>
  abstract upsertContents(items: CatalogContentRow[], bump?: boolean): Promise<{ upserted: number }>
  /** 검색 — 기본 verified·active 만. total 은 검색어와 무관한 active 전체 */
  abstract searchProducts(q: CatalogSearchQuery): Promise<{ items: CatalogProductWire[]; total: number }>
  abstract searchContents(q: CatalogSearchQuery): Promise<{ items: CatalogContentWire[]; total: number }>
  abstract patchProduct(id: string, patch: PatchCatalogRowBody): Promise<CatalogProductWire>
  abstract patchContent(id: string, patch: PatchCatalogRowBody): Promise<CatalogContentWire>
  /** 점검 대상 — 오래 안 본 순. mall='*' 면 전 몰 */
  abstract listForVerify(mall?: string, limit?: number): Promise<{ items: CatalogProductWire[] }>
  /** 표 만들기(멱등) — Neon 은 마이그레이션 0005 DDL + drizzle 이력, Mongo 는 컬렉션·인덱스 보장 */
  abstract ensureSchema(): Promise<{ ok: true; created: boolean }>
  abstract stats(): Promise<CatalogStatsWire>
}
