import type { CatalogProduct } from '@ddak/schema'

/*
 * v0 데모 카탈로그 — 상품 그라운딩용 (DESIGN-LLM-SERVICE.md §4-3).
 * LLM은 이 목록의 id만 쓸 수 있고, 응답의 상품 id는 여기 대조 검증된다.
 * 전 상품이 실제 지마켓 PDP url을 가진다 (2026-08 웹 리서치로 채움) — FE 상세보기
 * 사이드 패널이 이 페이지를 연다. url 없는 상품은 추천에서 제외된다(threads.service 가드)
 * — 새 상품을 추가할 때는 반드시 PDP url을 확인해 넣을 것.
 * imageUrl은 지마켓 썸네일(gdimg.gmarket.co.kr/{goodsCode}/still/280) — 2026-08 전수
 * curl 200 확인분만 넣었다 (없으면 FE가 이모지 목업으로 렌더). 새 상품도 확인 후 넣을 것.
 * 실서비스 전환 시 상품 검색 API 결과가 이 자리를 대체한다.
 */
const gdimg = (goodsCode: string) => `https://gdimg.gmarket.co.kr/${goodsCode}/still/280`

export const CATALOG: CatalogProduct[] = [
  { id: 'p-001', name: '자작나무 수분 토너 300ml', brand: '라운드랩', price: 16900, tags: ['토너', '수분', '진정', '민감성'], url: 'https://m.gmarket.co.kr/vi/product/4075320386', imageUrl: gdimg('4075320386') },
  { id: 'p-002', name: '어성초 스팟 토너 패드 카밍터치 (본품+리필)', brand: '아비브', price: 19800, tags: ['토너패드', '진정', '트러블'], url: 'https://m.gmarket.co.kr/vi/product/4446018108', imageUrl: gdimg('4446018108') },
  { id: 'p-003', name: '다이브인 저분자 히알루론산 세럼 100ml+20ml', brand: '토리든', price: 38500, tags: ['세럼', '수분', '속건조'], url: 'https://item.gmarket.co.kr/Item?goodsCode=3694639295', imageUrl: gdimg('3694639295') },
  { id: 'p-004', name: '레티놀 시카 흔적 앰플 50ml', brand: '이니스프리', price: 42750, tags: ['세럼', '주름', '탄력', '레티놀'], url: 'https://m.gmarket.co.kr/vi/product/3775017167', imageUrl: gdimg('3775017167') },
  { id: 'p-005', name: '청귤 비타C 잡티 케어 세럼 30ml', brand: '구달', price: 22000, tags: ['세럼', '미백', '잡티', '비타민'], url: 'https://m.gmarket.co.kr/vi/product/4468727856', imageUrl: gdimg('4468727856') },
  { id: 'p-006', name: '레드 블레미쉬 클리어 수딩 크림 50ml 듀오', brand: '닥터지', price: 28000, tags: ['크림', '진정', '수분', '민감성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=3463379181', imageUrl: gdimg('3463379181') },
  // p-007·p-008·p-014: 지마켓 리스팅이 내려가 썸네일도 404 — imageUrl 없음(FE 이모지 목업). PDP 교체 필요
  { id: 'p-007', name: '아토베리어365 크림 80ml', brand: '에스트라', price: 25000, tags: ['크림', '장벽', '건성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=2715265644' },
  { id: 'p-008', name: '브라이트닝 업 선 플러스 SPF50+ 50ml', brand: '닥터지', price: 21900, tags: ['선크림', '톤업', '무기자차', '민감성'], url: 'https://item.gmarket.co.kr/Item?goodsCode=2258029039' },
  { id: 'p-009', name: 'UV 아쿠아리치 워터리 에센스 선크림 70g', brand: '비오레', price: 12900, tags: ['선크림', '수분', '지성'], url: 'https://m.gmarket.co.kr/vi/product/3471531930', imageUrl: gdimg('3471531930') },
  { id: 'p-010', name: '1025 독도 클렌저 200ml', brand: '라운드랩', price: 14000, tags: ['클렌저', '약산성', '민감성'], url: 'https://m.gmarket.co.kr/vi/product/3209544905', imageUrl: gdimg('3209544905') },
  { id: 'p-011', name: '퓨어 클렌징 오일 200ml 더블 기획 (+55ml)', brand: '마녀공장', price: 33000, tags: ['클렌징오일', '모공', '블랙헤드'], url: 'https://m.gmarket.co.kr/vi/product/4419642825', imageUrl: gdimg('4419642825') },
  { id: 'p-012', name: '킬커버 더뉴 파운웨어 쿠션 (본품+리필)', brand: '클리오', price: 32000, tags: ['쿠션', '베이스', '커버', '지속력'], url: 'https://item.gmarket.co.kr/Item?goodsCode=4123344949', imageUrl: gdimg('4123344949') },
  { id: 'p-013', name: '노세범 미네랄 파우더 팩트 8.5g', brand: '이니스프리', price: 12000, tags: ['파우더', '픽서', '유분', '지속력'], url: 'https://m.gmarket.co.kr/vi/product/4314605095', imageUrl: gdimg('4314605095') },
  { id: 'p-014', name: '더 쥬시 래스팅 틴트', brand: '롬앤', price: 13000, tags: ['립', '틴트', '보습'], url: 'https://m.gmarket.co.kr/vi/product/4252936476' },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((p) => [p.id, p]))
