import type { CatalogProduct } from '@ddak/schema'

/*
 * v0 데모 카탈로그 — 상품 그라운딩용 (DESIGN-LLM-SERVICE.md §4-3).
 * LLM은 이 목록의 id만 쓸 수 있고, 응답의 상품 id는 여기 대조 검증된다.
 * 실서비스 전환 시 상품 검색 API 결과가 이 자리를 대체한다.
 */
export const CATALOG: CatalogProduct[] = [
  { id: 'p-001', name: '수분 진정 토너 300ml', brand: '라운드랩', price: 16900, tags: ['토너', '수분', '진정', '민감성'] },
  { id: 'p-002', name: '어성초 카밍 토너 패드', brand: '아비브', price: 19800, tags: ['토너패드', '진정', '트러블'] },
  { id: 'p-003', name: '히알루론 세럼 50ml', brand: '토리든', price: 22000, tags: ['세럼', '수분', '속건조'] },
  { id: 'p-004', name: '레티놀 슬로우에이징 세럼', brand: '이니스프리', price: 32000, tags: ['세럼', '주름', '탄력', '레티놀'] },
  { id: 'p-005', name: '비타민C 잡티 세럼', brand: '구달', price: 24900, tags: ['세럼', '미백', '잡티', '비타민'] },
  { id: 'p-006', name: '시카 수분 크림 100ml', brand: '닥터지', price: 28000, tags: ['크림', '진정', '수분', '민감성'] },
  { id: 'p-007', name: '세라마이드 배리어 크림', brand: '에스트라', price: 25000, tags: ['크림', '장벽', '건성'] },
  { id: 'p-008', name: '무기자차 톤업 선크림 SPF50+', brand: '라로슈포제', price: 27500, tags: ['선크림', '무기자차', '민감성', '톤업'] },
  { id: 'p-009', name: '수분 산뜻 선젤 SPF50+', brand: '비오레', price: 12900, tags: ['선크림', '수분', '지성'] },
  { id: 'p-010', name: '약산성 젤 클렌저 200ml', brand: '라운드랩', price: 14000, tags: ['클렌저', '약산성', '민감성'] },
  { id: 'p-011', name: '딥 클렌징 오일 200ml', brand: '마녀공장', price: 19900, tags: ['클렌징오일', '모공', '블랙헤드'] },
  { id: 'p-012', name: '글로우 쿠션 파운데이션', brand: '클리오', price: 32000, tags: ['쿠션', '베이스', '속광', '커버'] },
  { id: 'p-013', name: '벨벳 픽서 파우더', brand: '헤라', price: 35000, tags: ['파우더', '픽서', '유분', '지속력'] },
  { id: 'p-014', name: '데일리 립 세럼 틴트', brand: '롬앤', price: 13000, tags: ['립', '틴트', '보습'] },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((p) => [p.id, p]))
