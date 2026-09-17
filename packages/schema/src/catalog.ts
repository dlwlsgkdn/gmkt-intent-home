import { z } from 'zod'

/*
 * 내재화 카탈로그 계약 (2026-09-17) — 추천 상품·참고 콘텐츠를 core DB(Neon)에 쌓아 계획 생성이 웹 검색 절반 + 내부 절반으로
 * 추천하게 하는 자리. 원천은 세 갈래다: ① 지마켓 검색 스냅샷 시딩(상품 번호로 PDP·썸네일이 결정되는 검증된 상품),
 * ② 계획 기록(7단계)이 남기는 검증 게이트 통과 상품·콘텐츠(수확 — 계획이 만들어질수록 자란다), ③ 운영자 가져오기.
 * core 는 내용을 해석하지 않고 저장·검색만 한다 — 검색어 추출·후보 주입·그라운딩은 @ddak/pipeline·BFF 몫.
 */

export const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,120}$/
export const CatalogId = z.string().regex(CATALOG_ID_PATTERN, '카탈로그 id 는 소문자·숫자·하이픈 2~121자입니다')

/** 상품 행이 어디서 왔는가 — search: 시딩 웹 검색 배치 · thread: 지난 계획 수확 · manual: 가져오기(올리브영 사내 Mongo 내보내기 등) */
export const CatalogProductSource = z.enum(['search', 'thread', 'manual'])
export type CatalogProductSource = z.infer<typeof CatalogProductSource>

export const CatalogRowStatus = z.enum(['active', 'dead'])
export type CatalogRowStatus = z.infer<typeof CatalogRowStatus>

/** 상품 행 — 화면 CatalogProduct 로 투영되는 필드(name·brand·price·url·imageUrl·tags)와 검색·품질 메타 */
export const CatalogProductRow = z.object({
  /** `gm-<상품번호>`(지마켓) · `oy-<goodsNo>`(올리브영) · `p-001`(데모 카탈로그) · `web-<해시>`(그 밖의 몰) */
  id: CatalogId,
  mall: z.string().min(1),
  /** 몰 안의 상품 식별자 (지마켓 goodscode 등) — 없으면 null */
  mallProductId: z.string().nullable().optional(),
  name: z.string().min(1),
  brand: z.string(),
  price: z.number().int().nonnegative(),
  url: z.string().url(),
  imageUrl: z.string().nullable().optional(),
  /** 제품 유형·특징 태그 — 검색어 대조의 1차 재료 */
  tags: z.array(z.string()).max(30),
  /** 검색 어휘 키(예: 쿠션·선크림) — 스냅샷 시딩이 채운다 */
  category: z.string().nullable().optional(),
  source: CatalogProductSource,
  /** PDP 가 확인된 상품인가 — 지마켓은 상품 번호 형식으로, 그 밖은 사람이 담았거나 운영자가 표시했을 때 */
  verified: z.boolean(),
  status: CatalogRowStatus.optional(),
  /** 별점·리뷰 수·구매 수·배송 등 스냅샷 부가 정보 — core 는 해석하지 않는다 */
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
  /** 계획에 실린 횟수 — 수확 때마다 +1 (검색 순위 보조) */
  recommendCount: z.number().int().nonnegative().optional(),
  lastSeenAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type CatalogProductRow = z.infer<typeof CatalogProductRow>

export const CatalogContentType = z.enum(['video', 'article'])

/** 참고 콘텐츠 행 — 계획에 실렸던(검증 게이트 통과) 게시글·영상 */
export const CatalogContentRow = z.object({
  /** `ct-<url 해시>` */
  id: CatalogId,
  type: CatalogContentType,
  source: z.string(),
  title: z.string().min(1),
  url: z.string().url(),
  imageUrl: z.string().nullable().optional(),
  meta: z.string().nullable().optional(),
  snippet: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  /** 어떤 의도·답변의 계획에 실렸나 — 검색어 대조 재료 (수확 때 누적) */
  tags: z.array(z.string()).max(40),
  /** 작성·업로드 연도 (meta 에서 읽은 값) — 신선도 판정 */
  year: z.number().int().nullable().optional(),
  verified: z.boolean(),
  status: CatalogRowStatus.optional(),
  recommendCount: z.number().int().nonnegative().optional(),
  lastSeenAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})
export type CatalogContentRow = z.infer<typeof CatalogContentRow>

/** 검색 요청 — 검색어(terms)는 BFF 가 의도·답변·프로필에서 뽑은 낱말 목록. core 는 search_text 부분 일치 개수로 순위를 매긴다 */
export const CatalogSearchQuery = z.object({
  terms: z.array(z.string().min(1).max(40)).min(1).max(24),
  /** 제품 유형 낱말(쿠션·선크림…) — 이름·태그에 이게 맞으면 가중치를 더 준다 */
  typeTerms: z.array(z.string().min(1).max(40)).max(12).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  /** true(기본) = 검증된 행만. 운영 점검 화면만 false 로 전체를 본다 */
  verifiedOnly: z.boolean().optional(),
  mall: z.string().optional(),
})
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuery>

export const CatalogProductSearchWire = z.object({
  items: z.array(CatalogProductRow.extend({ score: z.number() })),
  /** 검색어와 매칭된 행이 하나도 없을 때도 total 로 표가 비었는지(0) 검색이 빗나갔는지 알 수 있다 */
  total: z.number().int(),
})
export type CatalogProductSearchWire = z.infer<typeof CatalogProductSearchWire>

export const CatalogContentSearchWire = z.object({
  items: z.array(CatalogContentRow.extend({ score: z.number() })),
  total: z.number().int(),
})
export type CatalogContentSearchWire = z.infer<typeof CatalogContentSearchWire>

/** 둘러보기 목록 — 운영 콘솔 「데이터 시딩」의 상품·콘텐츠 표 (무한 스크롤). updated_at 내림차순 키셋 커서(`<updatedAt ISO>|<id>`).
 * q 는 search_text 부분 일치, verified 는 'true'|'false'(없으면 전부), 검색과 달리 미검증·dead 행도 보인다 */
export const CatalogListQuery = z.object({
  q: z.string().max(80).optional(),
  mall: z.string().max(40).optional(),
  source: z.string().max(20).optional(),
  verified: z.enum(['true', 'false']).optional(),
  status: CatalogRowStatus.optional(),
  /** 콘텐츠 전용 — video | article */
  type: CatalogContentType.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})
export type CatalogListQuery = z.infer<typeof CatalogListQuery>

export const CatalogProductListWire = z.object({
  items: z.array(CatalogProductRow),
  nextCursor: z.string().nullable(),
  /** 필터를 적용한 전체 개수 */
  total: z.number().int(),
})
export type CatalogProductListWire = z.infer<typeof CatalogProductListWire>

export const CatalogContentListWire = z.object({
  items: z.array(CatalogContentRow),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
})
export type CatalogContentListWire = z.infer<typeof CatalogContentListWire>

/** 일괄 upsert — id 충돌이면 덮되 recommendCount 는 더한다(수확이 누적되게) */
export const UpsertCatalogProductsBody = z.object({
  items: z.array(CatalogProductRow).min(1).max(500),
  /** true 면 recommendCount 를 기존 값에 더한다 (수확) — 기본 false(시딩·가져오기는 값 그대로) */
  bump: z.boolean().optional(),
})
export type UpsertCatalogProductsBody = z.infer<typeof UpsertCatalogProductsBody>

export const UpsertCatalogContentsBody = z.object({
  items: z.array(CatalogContentRow).min(1).max(500),
  bump: z.boolean().optional(),
})
export type UpsertCatalogContentsBody = z.infer<typeof UpsertCatalogContentsBody>

export const UpsertCatalogResult = z.object({ upserted: z.number().int() })
export type UpsertCatalogResult = z.infer<typeof UpsertCatalogResult>

export const PatchCatalogRowBody = z.object({
  verified: z.boolean().optional(),
  status: CatalogRowStatus.optional(),
})
export type PatchCatalogRowBody = z.infer<typeof PatchCatalogRowBody>

/** 카탈로그 현황 — 운영 콘솔 카드 */
export const CatalogStatsWire = z.object({
  products: z.object({
    total: z.number().int(),
    verified: z.number().int(),
    dead: z.number().int(),
    byMall: z.array(z.object({ mall: z.string(), count: z.number().int() })),
    bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  }),
  contents: z.object({
    total: z.number().int(),
    verified: z.number().int(),
    dead: z.number().int(),
    byType: z.array(z.object({ type: z.string(), count: z.number().int() })),
  }),
  updatedAt: z.string().nullable(),
})
export type CatalogStatsWire = z.infer<typeof CatalogStatsWire>

/** 점검 대상 목록 — 지마켓 썸네일 HEAD 로 살아 있는지 보는 verify 작업의 입력 (오래 안 본 순) */
export const CatalogVerifyListQuery = z.object({
  mall: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})
export type CatalogVerifyListQuery = z.infer<typeof CatalogVerifyListQuery>

/* ── BFF admin — 내재화 카탈로그 운영 (스튜디오 운영 콘솔 카드) ──────────────────── */

/** 운영자 가져오기 — 스튜디오가 지마켓 검색 스냅샷(srpSnapshot.json)을 행으로 바꿔 올리거나, 손으로 만든 행을 올린다 */
export const AdminCatalogImportBody = z.object({
  products: z.array(CatalogProductRow).max(500).optional(),
  contents: z.array(CatalogContentRow).max(500).optional(),
})
export type AdminCatalogImportBody = z.infer<typeof AdminCatalogImportBody>

export const AdminCatalogImportResult = z.object({ products: z.number().int(), contents: z.number().int() })
export type AdminCatalogImportResult = z.infer<typeof AdminCatalogImportResult>

/** 지난 쓰레드 계획에서 수확 — plan 스텝의 검증 통과 상품·콘텐츠를 카탈로그로 (백필) */
export const AdminCatalogHarvestResult = z.object({
  threads: z.number().int(),
  plans: z.number().int(),
  products: z.number().int(),
  contents: z.number().int(),
})
export type AdminCatalogHarvestResult = z.infer<typeof AdminCatalogHarvestResult>

/** 상품 링크 점검 — 지마켓 썸네일(gdimg)·그 밖 몰 상품 주소 HEAD: 200 이면 살아 있음(verified), 404 면 dead. 올리브영은 CDN 썸네일에 HEAD, 쿠팡은 건너뜀 */
export const AdminCatalogVerifyResult = z.object({
  checked: z.number().int(),
  alive: z.number().int(),
  dead: z.number().int(),
  skipped: z.number().int(),
})
export type AdminCatalogVerifyResult = z.infer<typeof AdminCatalogVerifyResult>

/** 썸네일 채우기 — 빈 imageUrl 행에 몰별 결정적 썸네일(지마켓 gdimg·올리브영 CDN)을 소급 적용. scanned = 훑은 행, filled = 채운 행 */
export const AdminCatalogFillThumbsResult = z.object({
  scanned: z.number().int(),
  filled: z.number().int(),
})
export type AdminCatalogFillThumbsResult = z.infer<typeof AdminCatalogFillThumbsResult>

/** 시딩 웹 검색 배치 — 제품 유형 몇 개(≤4/요청 — 4병렬 한 라운드, 서버리스 시간 한도)마다 LLM+web_search 1회로 판매 상품을 모아 행으로 upsert.
 * 운영 콘솔이 어휘 표(@ddak/pipeline CATALOG_SEED_KEYWORDS)를 잘라 여러 번 부른다 */
export const CatalogSeedQueryWire = z.object({
  /** 제품 유형(정식 이름) — 행의 category·태그 */
  keyword: z.string().min(1).max(40),
  /** 검색 초점 문구(유형×조건, @ddak/pipeline catalogSeedQueries) — 없으면 keyword 그대로 */
  query: z.string().min(1).max(80).optional(),
})
export type CatalogSeedQueryWire = z.infer<typeof CatalogSeedQueryWire>

export const AdminCatalogSeedSearchBody = z
  .object({
    /** 유형만 (옛 형식) — queries 와 둘 중 하나 */
    keywords: z.array(z.string().min(1).max(40)).max(4).optional(),
    /** 유형×조건 검색 단위 — 대량 시딩 */
    queries: z.array(CatalogSeedQueryWire).max(4).optional(),
    /** 검색 4회·16개까지 — 검색 1회당 비용이 조금 더 든다 */
    dense: z.boolean().optional(),
  })
  .refine((b) => (b.keywords?.length ?? 0) + (b.queries?.length ?? 0) > 0, { message: 'keywords 또는 queries 가 필요합니다' })
  .refine((b) => (b.keywords?.length ?? 0) + (b.queries?.length ?? 0) <= 4, { message: '요청당 4개까지' })
export type AdminCatalogSeedSearchBody = z.infer<typeof AdminCatalogSeedSearchBody>

export const AdminCatalogSeedSearchResult = z.object({
  /** 처리한 검색 단위 수 (keywords 형식이면 유형 수) */
  keywords: z.number().int(),
  /** LLM 호출이 실패한 유형 (검색 오류·거절) — 다시 돌리면 된다 */
  failed: z.array(z.string()),
  products: z.number().int(),
  verified: z.number().int(),
  webSearchRequests: z.number().int(),
})
export type AdminCatalogSeedSearchResult = z.infer<typeof AdminCatalogSeedSearchResult>

/* ── 시딩 잡 — 서버(core 설정 KV `catalog-seed-job`)가 관리하는 대량 웹 검색 시딩 (2026-09-17). 운영 콘솔 카드가 진행·결과를 보고,
 * 콘솔 탭이나 배치 스크립트(apps/bff/scripts/seed-search.mjs)가 `step` 을 반복 호출해 4단위씩(한 라운드) 전진시킨다 — 서버리스라 서버가 스스로
 * 오래 돌 수 없어 「상태는 서버, 박자는 드라이버」로 나눴다. 어느 드라이버든 같은 잡을 이어 돌리고, 콘솔은 어디서 돌려도 같은 진행을 본다 */

export const CatalogSeedJobStatus = z.enum(['running', 'paused', 'done'])
export type CatalogSeedJobStatus = z.infer<typeof CatalogSeedJobStatus>

export const CatalogSeedJobBatch = z.object({
  at: z.string(),
  queries: z.array(z.string()),
  products: z.number().int(),
  verified: z.number().int(),
  webSearchRequests: z.number().int(),
  failed: z.array(z.string()),
  /** main = 본 회차, retry = 실패 단위 재시도 회차 */
  pass: z.enum(['main', 'retry']),
})
export type CatalogSeedJobBatch = z.infer<typeof CatalogSeedJobBatch>

export const CatalogSeedJob = z.object({
  id: z.string(),
  status: CatalogSeedJobStatus,
  /** 검색 단위 목록은 저장하지 않는다 — facets·types 에서 결정적으로 다시 만든다(@ddak/pipeline catalogSeedQueries) */
  facets: z.array(z.enum(['skin', 'concern', 'price', 'mall'])),
  types: z.array(z.string()),
  dense: z.boolean(),
  total: z.number().int(),
  /** 본 회차 진행 위치 (다음에 처리할 검색 단위 인덱스) */
  cursor: z.number().int(),
  /** 본 회차에서 실패한 단위(초점 문구) — 본 회차가 끝나면 한 번 더 돈다 */
  retry: z.array(z.string()),
  retryCursor: z.number().int(),
  /** 재시도까지 실패한 단위 */
  failed: z.array(z.string()),
  products: z.number().int(),
  verified: z.number().int(),
  webSearchRequests: z.number().int(),
  /** 드라이버가 step 을 처리하는 동안 잠금 (ISO) — 다른 드라이버는 busy 로 물러난다. 만료되면 풀린 것으로 본다 */
  lockUntil: z.string().nullable(),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** 최근 회차 기록 (최신 앞, 최대 40) */
  history: z.array(CatalogSeedJobBatch),
  /** 마지막 오류(드라이버 예외) — 있으면 카드가 보인다 */
  lastError: z.string().nullable(),
})
export type CatalogSeedJob = z.infer<typeof CatalogSeedJob>

export const StartCatalogSeedJobBody = z.object({
  facets: z.array(z.enum(['skin', 'concern', 'price', 'mall'])).optional(),
  types: z.array(z.string().min(1).max(40)).max(60).optional(),
  dense: z.boolean().optional(),
  /** 진행 중·일시정지 잡이 있어도 버리고 새로 시작 */
  reset: z.boolean().optional(),
})
export type StartCatalogSeedJobBody = z.infer<typeof StartCatalogSeedJobBody>

export const CatalogSeedJobWire = z.object({
  job: CatalogSeedJob.nullable(),
  /** step 응답 전용 — 다른 드라이버가 잠금 중이라 이번엔 처리하지 않았다 */
  busy: z.boolean().optional(),
})
export type CatalogSeedJobWire = z.infer<typeof CatalogSeedJobWire>

export const AdminCatalogWire = z.object({
  stats: CatalogStatsWire,
  /** core 미연결·표 없음(마이그레이션 전) 이면 false — 카드가 안내를 보인다 */
  available: z.boolean(),
  note: z.string().optional(),
})
export type AdminCatalogWire = z.infer<typeof AdminCatalogWire>

/** 표 만들기 — core 가 마이그레이션 0005 DDL 을 멱등 적용한 결과 + 적용 뒤 현황 */
export const AdminCatalogMigrateResult = z.object({
  /** 이번 호출로 표가 새로 생겼는가 (이미 있었으면 false) */
  created: z.boolean(),
  catalog: AdminCatalogWire,
})
export type AdminCatalogMigrateResult = z.infer<typeof AdminCatalogMigrateResult>
