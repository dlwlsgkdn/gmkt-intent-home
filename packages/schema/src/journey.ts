import { z } from 'zod'

/*
 * 저니(journeys) 계약 — FE ↔ BFF.
 * 와이어 형식은 의미 단위 페이지 JSON이다. 스튜디오 레지스트리 아이템(x/y/w 배치)으로의
 * 투영은 FE 통합 단계에서 얹는다 — 매핑 기준: question→surveyQuestion, guide→planStep,
 * products→productCard, steps→checklist (DESIGN-LLM-SERVICE.md §2-1).
 */

/** 사용자 프로필 — 스튜디오 profilePanel 항목과 같은 라벨/값 쌍 */
export const Profile = z.array(z.object({ label: z.string(), value: z.string() }))
export type Profile = z.infer<typeof Profile>

/* ── 요청 ────────────────────────────────────────────────────────────── */

export const StartJourneyBody = z
  .object({
    chipId: z.string().optional(),
    query: z.string().optional(),
    title: z.string().optional(),
    profile: Profile.optional(),
  })
  .refine((v) => v.chipId || v.query, { message: 'chipId 또는 query가 필요합니다' })
export type StartJourneyBody = z.infer<typeof StartJourneyBody>

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

export const JourneyEventBody = z.object({
  /** cartAdd | cartRemove | complete | restart 등 — FE 정의 이벤트 이름 */
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type JourneyEventBody = z.infer<typeof JourneyEventBody>

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
