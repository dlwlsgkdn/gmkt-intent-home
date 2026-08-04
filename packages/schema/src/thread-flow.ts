import { z } from 'zod'
import { ThreadId, ThreadSource, ThreadStatus } from './thread'

/*
 * 쓰레드 플로우 계약 — FE ↔ BFF (threads API). 공식 용어는 thread 하나다:
 * 와이어 형식은 의미 단위 페이지 JSON이다. 스튜디오 레지스트리 아이템(x/y/w 배치)으로의
 * 투영은 FE 통합 단계에서 얹는다 — 매핑 기준: question→surveyQuestion, guide→planStep,
 * products→productCard, steps→checklist (DESIGN-LLM-SERVICE.md §2-1).
 */

/** 사용자 프로필 — 스튜디오 profilePanel 항목과 같은 라벨/값 쌍 */
export const Profile = z.array(z.object({ label: z.string(), value: z.string() }))
export type Profile = z.infer<typeof Profile>

/* ── 요청 ────────────────────────────────────────────────────────────── */

export const StartThreadBody = z
  .object({
    chipId: z.string().optional(),
    query: z.string().optional(),
    title: z.string().optional(),
    profile: Profile.optional(),
  })
  .refine((v) => v.chipId || v.query, { message: 'chipId 또는 query가 필요합니다' })
export type StartThreadBody = z.infer<typeof StartThreadBody>

export const SurveyRequestBody = z.object({
  profile: Profile.optional(),
})
export type SurveyRequestBody = z.infer<typeof SurveyRequestBody>

export const Answer = z.object({
  questionId: z.string(),
  choices: z.array(z.string()).min(1),
})
export type Answer = z.infer<typeof Answer>

export const PlanRequestBody = z.object({
  answers: z.array(Answer).min(1),
  profile: Profile.optional(),
})
export type PlanRequestBody = z.infer<typeof PlanRequestBody>

export const ThreadEventBody = z.object({
  /** cartAdd | cartRemove | complete | restart | feedback 등 — FE 정의 이벤트 이름 */
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type ThreadEventBody = z.infer<typeof ThreadEventBody>

/* ── 피드백 (사용자 평가) ─────────────────────────────────────────────────
 * 스튜디오 평가 스튜디오와 같은 문법: 별점 0~5 + 코멘트, null = 미평가 (0점과 구분).
 * 저장은 action 스텝(type='feedback')의 data — 제출 1회 = 스텝 1개(append)라 수정
 * 이력이 로그로 남고, 이어보기·관리 페이지는 단계별 최신 제출을 유효본으로 본다. */

export const FeedbackScore = z.number().int().min(0).max(5)

export const ThreadFeedbackComponent = z.object({
  /** livePage 투영 아이템 id — 설문 질문은 와이어 질문 id 그대로 */
  id: z.string(),
  /** 사람이 읽을 라벨(질문 문구·섹션 제목) — 관리 페이지 문서화용. 페이지가 재생성돼도 해석 가능하게 함께 저장 */
  label: z.string(),
  score: FeedbackScore.nullable(),
  feedback: z.string(),
})
export type ThreadFeedbackComponent = z.infer<typeof ThreadFeedbackComponent>

export const ThreadStageFeedback = z.object({
  stage: z.enum(['survey', 'plan']),
  /** 페이지 전체 평가 */
  review: z.object({ score: FeedbackScore.nullable(), feedback: z.string() }),
  /** 컴포넌트별 평가 — 별점이나 코멘트가 있는 항목만 실어 보낸다 */
  components: z.array(ThreadFeedbackComponent),
  /** 기록 시각 (이어보기 응답에서 action 스텝의 at으로 채워진다) */
  at: z.string().optional(),
})
export type ThreadStageFeedback = z.infer<typeof ThreadStageFeedback>

/* ── 와이어 페이지 (BFF → FE) ────────────────────────────────────────── */

export const SurveyQuestionWire = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).min(2).max(6),
  multi: z.boolean(),
})
export type SurveyQuestionWire = z.infer<typeof SurveyQuestionWire>

export const SurveyPageWire = z.object({
  intro: z.string(),
  questions: z.array(SurveyQuestionWire).min(1),
})
export type SurveyPageWire = z.infer<typeof SurveyPageWire>

export const CatalogProduct = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  price: z.number().int(),
  tags: z.array(z.string()),
  /** 상품 페이지 URL — 웹 검색 상품은 BFF 검증(http/https)을 거쳐 채워진다. FE 상세보기 패널이 연다 */
  url: z.string().optional(),
  /** 판매처 이름 (올리브영 등) — 웹 검색 상품 전용. 없으면 지마켓(데모 카탈로그) 상품 */
  mall: z.string().optional(),
  /** 상품 썸네일 URL — 카탈로그는 검증된 지마켓 이미지, 웹 상품은 BFF url 검증 통과분만. 없으면 FE가 이모지 목업으로 렌더 */
  imageUrl: z.string().optional(),
})
export type CatalogProduct = z.infer<typeof CatalogProduct>

export const PlanSectionWire = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guide'), title: z.string(), body: z.string() }),
  z.object({
    kind: z.literal('products'),
    title: z.string(),
    reason: z.string(),
    products: z.array(CatalogProduct).min(1),
  }),
  z.object({ kind: z.literal('steps'), title: z.string(), steps: z.array(z.string()).min(2) }),
])
export type PlanSectionWire = z.infer<typeof PlanSectionWire>

export const PlanPageWire = z.object({
  headline: z.string(),
  summary: z.string(),
  sections: z.array(PlanSectionWire).min(1),
})
export type PlanPageWire = z.infer<typeof PlanPageWire>

/** 쓰레드 시작 응답 — threadId는 core가 발급한 스노우플레이크 문자열 */
export const StartThreadResult = z.object({ threadId: ThreadId })
export type StartThreadResult = z.infer<typeof StartThreadResult>

/** 이어보기 응답 — 단계별 페이지를 FE가 복원하기 좋은 형태로 */
export const ThreadResumeWire = z.object({
  threadId: ThreadId,
  title: z.string().nullable(),
  status: ThreadStatus,
  source: ThreadSource.nullable(),
  survey: SurveyPageWire.nullable(),
  answers: z.array(Answer).nullable(),
  plan: PlanPageWire.nullable(),
  /** 단계별 최신 피드백 — action 스텝(type='feedback')에서 파생. 없으면 null (구 BFF 응답엔 필드 자체가 없다) */
  feedback: z
    .object({ survey: ThreadStageFeedback.nullable(), plan: ThreadStageFeedback.nullable() })
    .nullable()
    .optional(),
  updatedAt: z.string(),
})
export type ThreadResumeWire = z.infer<typeof ThreadResumeWire>
