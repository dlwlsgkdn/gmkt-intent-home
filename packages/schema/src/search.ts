import { z } from 'zod'
import { Profile } from './thread-flow'

/*
 * 홈 검색창 API 계약 — 검색어 하나로 두 갈래(DDAK 설문→계획 / 일반 검색 결과)를 가르는 라우터와,
 * 입력 중 보여 주는 AI 검색어 추천. 둘 다 짧은 구조화 LLM 호출이고, LLM 이 막히면 BFF 가 휴리스틱으로 대신 답한다
 * (source 가 그 사실을 알린다 — FE 는 source 와 무관하게 같은 흐름을 탄다).
 */
export const SearchRouteBody = z.object({
  query: z.string().trim().min(1).max(200),
  profile: Profile.optional(),
})
export type SearchRouteBody = z.infer<typeof SearchRouteBody>

export const SearchRouteResult = z.object({
  /** true = DDAK(뷰티 설문→맞춤 계획), false = 검색 결과 페이지(SRP) */
  ddak: z.boolean(),
  /** DDAK 로 갈 때 설문 생성에 넘길 의도 문장 (SRP 면 검색어 그대로) */
  normalized: z.string(),
  reason: z.string(),
  source: z.enum(['llm', 'fallback']),
})
export type SearchRouteResult = z.infer<typeof SearchRouteResult>

export const SearchSuggestBody = z.object({
  query: z.string().trim().min(1).max(100),
  profile: Profile.optional(),
})
export type SearchSuggestBody = z.infer<typeof SearchSuggestBody>

export const SearchSuggestResult = z.object({
  suggestions: z.array(z.string()).max(3),
  source: z.enum(['llm', 'fallback']),
})
export type SearchSuggestResult = z.infer<typeof SearchSuggestResult>
