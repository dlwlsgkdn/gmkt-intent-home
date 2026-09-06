import { z } from 'zod'
import { LookTone } from '@ddak/schema'

/*
 * LLM 생성 출력 스키마 — 구조화 출력(zodOutputFormat)으로 강제된다.
 * 원칙(DESIGN-LLM-SERVICE.md §0-2): LLM은 콘텐츠만 만든다 — id·배치는 BFF 스캐폴드 소유.
 * 원소 스키마(SurveyQuestionGen·PlanSectionGen)는 분리 export — 부분 스트리밍이
 * 배열 원소 하나가 닫힐 때마다 단독 검증하는 데 재사용한다 (threads.service).
 */

/* 선택지는 제목+부제 한 벌 — 제목은 고르는 말(짧은 명사구), 부제는 "이게 내 얘기인지" 판단할 기준 한 줄.
   와이어는 FE 옵션 문법과 같은 "제목|부제" 문자열로 직렬화된다 (survey-wire optionWire) */
export const SurveyOptionGen = z.object({
  label: z.string().describe('선택지 제목 — 고르기 쉬운 짧은 명사구(2~8자)'),
  desc: z.string().describe('선택지 부제 — 이 항목이 자기 얘기인지 판단할 기준·상황 한 줄(10~25자), 제목 되풀이 금지'),
})
export type SurveyOptionGen = z.infer<typeof SurveyOptionGen>

export const SurveyQuestionGen = z.object({
  question: z.string().describe('질문 문구'),
  options: z.array(SurveyOptionGen).min(2).max(8).describe('선택지 2~6개 — 각각 제목(label)+부제(desc)'),
  multi: z.boolean().describe('복수 선택 허용 여부'),
})
export type SurveyQuestionGen = z.infer<typeof SurveyQuestionGen>

export const SurveyGen = z.object({
  intro: z.string().describe('설문 페이지 머리 문구 — 사용자의 의도를 되짚는 한두 문장'),
  /* 얼굴 사진 질문 — 화면이 첫 질문 자리에 사진 업로드를 세운다. 선택지 질문 배열과 형태가
     달라(선택지 없음) 배열이 아닌 머리 필드로 둔다: 배열 스키마의 "선택지 2개 이상" 보장을
     지키면서, 자리도 결정적으로 맨 앞에 고정된다 (id·배치는 BFF 스캐폴드 소유 원칙) */
  photoQuestion: z
    .string()
    .describe(
      '얼굴 사진이 있어야 답할 수 있는 의도(가상 메이크업·룩 제안·발색 확인·퍼스널 컬러)면 사진을 요청하는 질문 문구, 그 밖에는 빈 문자열',
    ),
  // 전략 문서 3단계: 꼭 필요한 질문만 — 0문항(설문 스킵)은 FE 플로우 변경이 필요해 하한 1
  questions: z.array(SurveyQuestionGen).min(1).max(6),
})
export type SurveyGen = z.infer<typeof SurveyGen>

/* 1단계 의도 정규화 (전략 문서 STEP 1) — 발화를 구조로. 템플릿 밖 추측 금지, 결과는
 * 원장 facts(source='intent')로 흘러 가변부에 "의도 해석"으로 실린다. */

export const INTENT_TEMPLATES = [
  '제품 추천',
  '제품 비교',
  '고민 해결',
  '사용법·루틴',
  '선물 추천',
  '트렌드 탐색',
  '재구매·확인',
] as const

export const IntentGen = z.object({
  template: z.enum(INTENT_TEMPLATES).describe('7개 의도 템플릿 중 가장 가까운 하나'),
  goal: z.string().describe('목적 한 구 — 사용자의 말을 그대로 살려서 (예: 여름 지속력)'),
  timing: z.string().describe('시점 — 예: 지금 바로, 여름 대비, 다음 달 행사. 모르면 "지금 바로"'),
  audience: z.string().describe('대상 — 예: 본인, 어머니 선물. 모르면 "본인"'),
})
export type IntentGen = z.infer<typeof IntentGen>

/*
 * 계획은 2단계 병렬 생성이다 (DESIGN-LLM-SERVICE.md §9-1):
 * ① 뼈대(PlanSkeletonGen) — 검색 없이 제목·요약·안내(2~3단계)·순서 + 상품/콘텐츠 섹션 "자리"(제목·기준)만
 * ② 검색(PlanProductsGen) — 웹 검색 포함으로 상품 섹션 + 참고 콘텐츠(게시글·영상) 섹션만. 뼈대의 자리를 채운다
 */

const GuideSectionGen = z.object({
  kind: z.literal('guide'),
  title: z.string().describe('단계 제목 — 무엇을 하는 단계인지 짧게(번호 없이)'),
  subtitle: z.string().describe('단계 서브타이틀 — 이 단계에서 얻는 것·왜 지금 필요한지 한 줄(15~30자), 제목 아래에 선다'),
  body: z.string().describe('가이드 본문 — 답변을 근거로 든다'),
})

/** 가상 메이크업 결과 — 사진 질문에 답한 쓰레드에서만. 합성은 화면이 하고(올린 사진 + tone
 * 프리셋), 이 단계는 "어떤 룩인지"만 정한다. 상품 자리와 달리 검색이 채울 자리가 아니다 */
const LookSectionGen = z.object({
  kind: z.literal('look'),
  title: z.string().describe('룩 이름 — 예: 코랄 생기 데일리 룩'),
  desc: z.string().describe('이 룩을 고른 이유 한두 문장 — 답변을 근거로'),
  tone: LookTone.describe('룩의 기본 색조 — 화면이 올린 사진에 이 톤을 올려 보여준다'),
  points: z.array(z.string()).max(4).describe('포인트 한 줄씩 — 예: 립 — 코랄 틴트를 안쪽부터 그라데이션'),
})

const StepsSectionGen = z.object({
  kind: z.literal('steps'),
  title: z.string(),
  steps: z.array(z.string()).min(2).max(8).describe('실행 순서 — 아침/저녁 루틴 등'),
})

/** 상품 하나의 매칭 평가 — LLM 이 프로필·답변과 대조해 1~5 로 매기는 세 항목 + 근거 한 줄.
 * 퍼센트 계산은 LLM 이 아니라 검증 게이트(guards/match.ts)가 가중치 표로 한다 — 눈금은 여기, 가중치는 거기 */
export const ProductRatingGen = z.object({
  skin: z.number().int().min(1).max(5).describe('피부 타입·톤 적합 1~5 (프로필의 피부타입·퍼스널 컬러 대조)'),
  concern: z.number().int().min(1).max(5).describe('고민·목적 적합 1~5 (의도와 설문 답변의 고민·상황 대조)'),
  preference: z.number().int().min(1).max(5).describe('사용 선호 적합 1~5 (마감·질감·루틴 시간 등 선호 답변 대조)'),
  price: z.number().int().min(1).max(5).optional().describe('가격 대비 가치 1~5 — 예산 답변이 없을 때 참고'),
  notes: z
    .object({
      skin: z.string().describe('피부 타입 근거 한 줄 — 프로필 값을 인용'),
      concern: z.string().describe('고민·목적 근거 한 줄 — 답변을 인용'),
      preference: z.string().describe('사용 선호 근거 한 줄 — 답변을 인용'),
    })
    .describe('항목별 근거 — 사용자 답변·프로필을 직접 인용한 짧은 문장'),
})
export type ProductRatingGen = z.infer<typeof ProductRatingGen>

/** 웹 검색 상품 항목 — 부분 스트리밍이 완성된 항목만 개별 검증하는 데도 재사용한다 (threads.service) */
export const WebProductGen = z.object({
  name: z.string().describe('상품명 — 검색 결과에 나온 실제 상품명'),
  brand: z.string().describe('브랜드'),
  price: z.number().int().describe('판매가 (원 단위 정수) — 검색 결과에서 확인한 값'),
  mall: z.string().describe('판매처 이름 (예: 올리브영, 쿠팡)'),
  url: z
    .string()
    .describe('상품 링크 — 검색 결과에서 확인한 상세 페이지(PDP) 주소 그대로. PDP 를 못 찾았으면 그 몰의 검색 결과 주소(상품명 검색)를 넣고 urlKind 를 search 로'),
  urlKind: z.enum(['pdp', 'search']).describe('url 종류 — pdp: 상품 상세 페이지 주소, search: 상세 페이지를 못 찾아 몰 검색 결과 주소를 대신 실음'),
  imageUrl: z
    .string()
    .describe('상품 썸네일 이미지 URL — 검색 결과에서 확인한 경우만, 없으면 빈 문자열 (지어내기 금지)'),
  tags: z.array(z.string()).max(5).describe('특징 태그'),
  match: ProductRatingGen.optional().describe('이 상품의 매칭 평가 — 반드시 채운다'),
})
export type WebProductGen = z.infer<typeof WebProductGen>

/** 카탈로그 상품의 매칭 평가 — productIds 의 각 id 에 하나씩 */
export const CatalogRatingGen = z.object({
  id: z.string().describe('productIds 에 넣은 카탈로그 상품 id'),
  match: ProductRatingGen,
})
export type CatalogRatingGen = z.infer<typeof CatalogRatingGen>

export const ProductsSectionGen = z.object({
  kind: z.literal('products'),
  title: z.string(),
  reason: z.string().describe('이 상품들을 고른 이유 한두 문장 — 답변을 근거로'),
  productIds: z.array(z.string()).max(4).describe('카탈로그에서 고른 상품 id (없으면 빈 배열)'),
  // 웹 검색 그라운딩: 검색 결과에서 확인한 상품만 — url은 BFF가 http(s)+PDP 검증 후 채택한다
  webProducts: z.array(WebProductGen).max(10).describe('웹 검색으로 찾은 상품 — 섹션당 6~8개를 브랜드·가격대·제형 다양하게 (없으면 빈 배열)'),
  catalogRatings: z
    .array(CatalogRatingGen)
    .max(4)
    .optional()
    .describe('productIds 각 상품의 매칭 평가 (productIds 가 비었으면 빈 배열)'),
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
  items: z.array(ContentItemGen).min(1).max(8).describe('웹 검색으로 확인한 실제 게시글·영상 — 영상 2~3 + 게시글 2~3 으로 5~6개를 목표로 (검색해도 하나도 확인 못 했을 때만 섹션 생략)'),
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
  LookSectionGen,
  ProductsSlotGen,
  ContentsSlotGen,
  StepsSectionGen,
])
export type PlanSkeletonSectionGen = z.infer<typeof PlanSkeletonSectionGen>

export const PlanSkeletonGen = z.object({
  headline: z.string().describe('계획 페이지 제목 — 설문 결과를 반영한 맞춤 문구'),
  summary: z.string().describe('추천 방향 요약 두세 문장'),
  sections: z.array(PlanSkeletonSectionGen).min(2).max(10),
})
export type PlanSkeletonGen = z.infer<typeof PlanSkeletonGen>

export const PlanProductsGen = z.object({
  sections: z
    .array(PlanSearchSectionGen)
    .min(1)
    .max(5)
    .describe('추천 상품 섹션 1~2개 + 참고 콘텐츠 섹션 0~1개'),
})
export type PlanProductsGen = z.infer<typeof PlanProductsGen>

/*
 * 자동 채점(judge) — 실험 탭 실행 결과를 루브릭 4차원으로 심사하는 구조화 출력.
 * 차원을 고정 키 객체로 강제한다(배열이면 누락·중복을 스키마가 못 막는다).
 * 루브릭 차원 강제는 자동 채점 전용 — 사람 채점은 자유 코멘트다 (평가 레코드 문법의 source 축).
 */

export const JUDGE_DIMENSIONS = [
  { key: 'grounding', label: '근거 충실' },
  { key: 'personalization', label: '맞춤성' },
  { key: 'structure', label: '단계 구성' },
  { key: 'actionability', label: '실행 가능성' },
] as const
export type JudgeDimensionKey = (typeof JUDGE_DIMENSIONS)[number]['key']

const JudgeAxisGen = z.object({
  score: z.number().int().min(0).max(5).describe('0~5 정수 — 5=흠잡을 데 없음, 3=쓸 만하지만 아쉬움, 0=쓸 수 없음'),
  note: z.string().describe('점수 근거 한두 문장 — 구체 섹션·상품명을 들어서'),
})

export const JudgeGen = z.object({
  grounding: JudgeAxisGen.describe('근거 충실 — 상품·콘텐츠가 실제 확인된 것인가, 드롭·빈 자리가 없는가'),
  personalization: JudgeAxisGen.describe('맞춤성 — 프로필·설문 답변이 안내와 선정 근거에 실제로 반영됐는가'),
  structure: JudgeAxisGen.describe('단계 구성 — 안내가 단계 흐름으로 나뉘고 상품 자리가 제 단계에 붙었는가'),
  actionability: JudgeAxisGen.describe('실행 가능성 — 안내가 구체적이어서 그대로 따라 할 수 있는가'),
  overall: z.number().int().min(0).max(5).describe('종합 별점 0~5 — 차원 평균이 아니라 심사관의 종합 판단'),
  verdict: z.string().describe('종합 심사평 2~3문장 — 가장 큰 감점 요인과 개선 방향'),
})
export type JudgeGen = z.infer<typeof JudgeGen>

/** JudgeGen(고정 키) → 저장·표시용 루브릭 배열 [{key, label, score, note}] */
export function judgeRubricEntries(gen: JudgeGen) {
  return JUDGE_DIMENSIONS.map(({ key, label }) => ({ key, label, score: gen[key].score, note: gen[key].note }))
}

/* 설문 단계 judge — 계획과 실패 양상이 달라 루브릭도 따로 둔다 (단계 축의 차원 분리).
 * 눈금·구조(고정 키 4차원 + overall + verdict)는 계획 judge와 동일 문법. */

export const JUDGE_SURVEY_DIMENSIONS = [
  { key: 'necessity', label: '질문 절제' },
  { key: 'relevance', label: '의도 적합' },
  { key: 'answerability', label: '답하기 쉬움' },
  { key: 'tone', label: '말투' },
] as const

export const JudgeSurveyGen = z.object({
  necessity: JudgeAxisGen.describe('질문 절제 — 답이 계획을 바꾸는 질문만인가, 이미 아는 것(프로필·의도)을 다시 묻지 않는가'),
  relevance: JudgeAxisGen.describe('의도 적합 — 질문이 의도의 핵심 축(용도·고민·대상·예산)을 짚는가'),
  answerability: JudgeAxisGen.describe('답하기 쉬움 — 선택지가 짧고 고르기 쉬운가(2~6개), 기타·모르겠어요 남발이 없는가'),
  tone: JudgeAxisGen.describe('말투 — 친근한 존댓말, 이모지 없이 담백한가'),
  overall: z.number().int().min(0).max(5).describe('종합 별점 0~5 — 차원 평균이 아니라 심사관의 종합 판단'),
  verdict: z.string().describe('종합 심사평 2~3문장 — 가장 큰 감점 요인과 개선 방향'),
})
export type JudgeSurveyGen = z.infer<typeof JudgeSurveyGen>

export function judgeSurveyRubricEntries(gen: JudgeSurveyGen) {
  return JUDGE_SURVEY_DIMENSIONS.map(({ key, label }) => ({ key, label, score: gen[key].score, note: gen[key].note }))
}

/*
 * 부분 스트리밍(토큰 단위 미리보기)용 느슨한 스키마 — 자라는 중(미완성)인 원소라
 * 필수·개수 제약을 걷어낸다. 확정 검증은 언제나 위의 본 스키마가 맡는다 (threads.service).
 * kind만 필수: 종류를 알아야 wire 섹션으로 투영할 수 있다 (kind 도착 전 조각은 스킵).
 */
export const SurveyQuestionPartialGen = z.object({
  question: z.string().optional(),
  // 자라는 중인 선택지 객체({label, desc} 일부) — 와이어 직렬화(optionWire)가 제목 있는 것만 살린다
  options: z.array(z.unknown()).optional(),
  multi: z.boolean().optional(),
})
export type SurveyQuestionPartialGen = z.infer<typeof SurveyQuestionPartialGen>

export const PlanSectionPartialGen = z.object({
  kind: z.enum(['guide', 'look', 'steps', 'products', 'contents']),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  desc: z.string().optional(),
  tone: LookTone.optional(),
  points: z.array(z.string()).optional(),
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
  catalogRatings: z.array(z.unknown()).optional(),
  items: z.array(z.unknown()).optional(),
})
export type PlanSearchSectionPartialGen = z.infer<typeof PlanSearchSectionPartialGen>
