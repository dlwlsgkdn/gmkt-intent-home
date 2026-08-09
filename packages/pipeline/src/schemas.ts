import { z } from 'zod'

/*
 * LLM 생성 출력 스키마 — 구조화 출력(zodOutputFormat)으로 강제된다.
 * 원칙(DESIGN-LLM-SERVICE.md §0-2): LLM은 콘텐츠만 만든다 — id·배치는 BFF 스캐폴드 소유.
 * 원소 스키마(SurveyQuestionGen·PlanSectionGen)는 분리 export — 부분 스트리밍이
 * 배열 원소 하나가 닫힐 때마다 단독 검증하는 데 재사용한다 (threads.service).
 */

export const SurveyQuestionGen = z.object({
  question: z.string().describe('질문 문구'),
  options: z.array(z.string()).min(2).max(6).describe('선택지 2~6개, 짧은 명사구'),
  multi: z.boolean().describe('복수 선택 허용 여부'),
})
export type SurveyQuestionGen = z.infer<typeof SurveyQuestionGen>

export const SurveyGen = z.object({
  intro: z.string().describe('설문 페이지 머리 문구 — 사용자의 의도를 되짚는 한두 문장'),
  questions: z.array(SurveyQuestionGen).min(3).max(5),
})
export type SurveyGen = z.infer<typeof SurveyGen>

/*
 * 계획은 2단계 병렬 생성이다 (DESIGN-LLM-SERVICE.md §9-1):
 * ① 뼈대(PlanSkeletonGen) — 검색 없이 제목·요약·안내(2~3단계)·순서 + 상품/콘텐츠 섹션 "자리"(제목·기준)만
 * ② 검색(PlanProductsGen) — 웹 검색 포함으로 상품 섹션 + 참고 콘텐츠(게시글·영상) 섹션만. 뼈대의 자리를 채운다
 */

const GuideSectionGen = z.object({
  kind: z.literal('guide'),
  title: z.string(),
  body: z.string().describe('가이드 본문 — 답변을 근거로 든다'),
})

const StepsSectionGen = z.object({
  kind: z.literal('steps'),
  title: z.string(),
  steps: z.array(z.string()).min(2).max(6).describe('실행 순서 — 아침/저녁 루틴 등'),
})

/** 웹 검색 상품 항목 — 부분 스트리밍이 완성된 항목만 개별 검증하는 데도 재사용한다 (threads.service) */
export const WebProductGen = z.object({
  name: z.string().describe('상품명 — 검색 결과에 나온 실제 상품명'),
  brand: z.string().describe('브랜드'),
  price: z.number().int().describe('판매가 (원 단위 정수) — 검색 결과에서 확인한 값'),
  mall: z.string().describe('판매처 이름 (예: 올리브영, 쿠팡)'),
  url: z.string().describe('상품 상세 페이지(PDP) URL — 검색 결과의 주소 그대로. 검색 결과·목록 페이지 금지'),
  imageUrl: z
    .string()
    .describe('상품 썸네일 이미지 URL — 검색 결과에서 확인한 경우만, 없으면 빈 문자열 (지어내기 금지)'),
  tags: z.array(z.string()).max(5).describe('특징 태그'),
})
export type WebProductGen = z.infer<typeof WebProductGen>

export const ProductsSectionGen = z.object({
  kind: z.literal('products'),
  title: z.string(),
  reason: z.string().describe('이 상품들을 고른 이유 한두 문장 — 답변을 근거로'),
  productIds: z.array(z.string()).max(4).describe('카탈로그에서 고른 상품 id (없으면 빈 배열)'),
  // 웹 검색 그라운딩: 검색 결과에서 확인한 상품만 — url은 BFF가 http(s)+PDP 검증 후 채택한다
  webProducts: z.array(WebProductGen).max(4).describe('웹 검색으로 찾은 상품 (없으면 빈 배열)'),
})
export type ProductsSectionGen = z.infer<typeof ProductsSectionGen>

/** 참고 콘텐츠 항목 — 웹 검색 결과에서 확인한 실제 게시글·영상만 (url은 BFF가 http(s) 검증 후 채택) */
export const ContentItemGen = z.object({
  type: z.enum(['video', 'article']).describe('video=영상(유튜브 등), article=게시글(블로그·커뮤니티)'),
  source: z.string().describe('출처 이름 (예: 유튜브, 네이버 블로그)'),
  title: z.string().describe('콘텐츠 제목 — 검색 결과의 실제 제목'),
  url: z.string().describe('콘텐츠 페이지 URL — 검색 결과의 주소 그대로 (지어내기·변형 금지)'),
  imageUrl: z.string().describe('썸네일 URL — 검색 결과에서 확인한 경우만, 없으면 빈 문자열 (지어내기 금지)'),
  meta: z.string().describe('부가 정보 — 영상은 채널·조회수, 게시글은 작성자·시점. 못 확인했으면 빈 문자열'),
  snippet: z.string().describe('게시글 본문 미리보기 한두 문장 — 영상이거나 없으면 빈 문자열'),
  duration: z.string().describe('영상 길이 (예: 5:24) — 게시글이거나 모르면 빈 문자열'),
})
export type ContentItemGen = z.infer<typeof ContentItemGen>

export const ContentsSectionGen = z.object({
  kind: z.literal('contents'),
  title: z.string(),
  reason: z.string().describe('이 콘텐츠들을 고른 이유 한두 문장 — 답변을 근거로'),
  items: z.array(ContentItemGen).min(1).max(4).describe('웹 검색으로 확인한 실제 게시글·영상 (확인 못 했으면 섹션 자체를 만들지 않는다)'),
})
export type ContentsSectionGen = z.infer<typeof ContentsSectionGen>

/** 검색 단계가 만드는 섹션 — 상품 또는 참고 콘텐츠 */
export const PlanSearchSectionGen = z.discriminatedUnion('kind', [ProductsSectionGen, ContentsSectionGen])
export type PlanSearchSectionGen = z.infer<typeof PlanSearchSectionGen>

/** 뼈대의 상품 섹션 자리 — 상품 없이 제목·기준만. 검색 단계 결과가 이 자리를 채운다 */
const ProductsSlotGen = z.object({
  kind: z.literal('products'),
  title: z.string().describe('상품 섹션 제목'),
  reason: z.string().describe('상품을 고를 기준 한두 문장 — 구체 상품명은 쓰지 않는다'),
})

/** 뼈대의 참고 콘텐츠 자리 — 제목·기준만. 검색 단계의 contents 섹션이 채운다 */
const ContentsSlotGen = z.object({
  kind: z.literal('contents'),
  title: z.string().describe('참고 콘텐츠 섹션 제목'),
  reason: z.string().describe('어떤 게시글·영상을 볼지 기준 한두 문장 — 구체 콘텐츠 제목은 쓰지 않는다'),
})

export const PlanSkeletonSectionGen = z.discriminatedUnion('kind', [
  GuideSectionGen,
  ProductsSlotGen,
  ContentsSlotGen,
  StepsSectionGen,
])
export type PlanSkeletonSectionGen = z.infer<typeof PlanSkeletonSectionGen>

export const PlanSkeletonGen = z.object({
  headline: z.string().describe('계획 페이지 제목 — 설문 결과를 반영한 맞춤 문구'),
  summary: z.string().describe('추천 방향 요약 두세 문장'),
  sections: z.array(PlanSkeletonSectionGen).min(2).max(7),
})
export type PlanSkeletonGen = z.infer<typeof PlanSkeletonGen>

export const PlanProductsGen = z.object({
  sections: z
    .array(PlanSearchSectionGen)
    .min(1)
    .max(3)
    .describe('추천 상품 섹션 1~2개 + 참고 콘텐츠 섹션 0~1개'),
})
export type PlanProductsGen = z.infer<typeof PlanProductsGen>

/*
 * 부분 스트리밍(토큰 단위 미리보기)용 느슨한 스키마 — 자라는 중(미완성)인 원소라
 * 필수·개수 제약을 걷어낸다. 확정 검증은 언제나 위의 본 스키마가 맡는다 (threads.service).
 * kind만 필수: 종류를 알아야 wire 섹션으로 투영할 수 있다 (kind 도착 전 조각은 스킵).
 */
export const SurveyQuestionPartialGen = z.object({
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  multi: z.boolean().optional(),
})
export type SurveyQuestionPartialGen = z.infer<typeof SurveyQuestionPartialGen>

export const PlanSectionPartialGen = z.object({
  kind: z.enum(['guide', 'steps', 'products', 'contents']),
  title: z.string().optional(),
  body: z.string().optional(),
  steps: z.array(z.string()).optional(),
})
export type PlanSectionPartialGen = z.infer<typeof PlanSectionPartialGen>

/** 검색 섹션(상품·콘텐츠)의 부분 스트리밍용 느슨한 스키마 — 항목 배열은 unknown으로 받고,
 * 완성된 항목만 항목 스키마(WebProductGen·ContentItemGen)로 개별 검증한다 (threads.service) */
export const PlanSearchSectionPartialGen = z.object({
  kind: z.enum(['products', 'contents']),
  title: z.string().optional(),
  reason: z.string().optional(),
  productIds: z.array(z.unknown()).optional(),
  webProducts: z.array(z.unknown()).optional(),
  items: z.array(z.unknown()).optional(),
})
export type PlanSearchSectionPartialGen = z.infer<typeof PlanSearchSectionPartialGen>
