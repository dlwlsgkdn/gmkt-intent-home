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

/*
 * 홈 개인화 — 첫 화면 인사말과 개인화 추천 검색어(보라 칩). FE 가 쓰레드 히스토리 요약·현재 시각·(허용된 경우) 위치를 보내면
 * BFF 가 날씨를 붙여 LLM 1회(effort low)로 만든다. LLM 이 막히면 같은 재료로 휴리스틱 문장을 돌려준다(source=fallback) —
 * 홈은 기본 인사말을 먼저 보이고 이 결과가 오면 페이드인으로 바꾸므로, 응답이 늦거나 없어도 화면이 비지 않는다.
 */
export const HomeThreadDigest = z.object({
  /** 쓰레드 제목 — 라이브면 검색어, 시나리오 체험이면 시나리오 제목 */
  title: z.string().trim().min(1).max(120),
  stage: z.enum(['survey', 'plan']),
  status: z.enum(['ongoing', 'completed']),
  live: z.boolean().optional(),
  updatedAt: z.string().optional(),
  /** 담은 상품 이름 (최근 순, 최대 6) */
  cart: z.array(z.string().max(80)).max(6).optional(),
  /** 설문 답변 값 (선택지 제목만, 최대 8) */
  answers: z.array(z.string().max(60)).max(8).optional(),
})
export type HomeThreadDigest = z.infer<typeof HomeThreadDigest>

export const HomePersonalizeBody = z.object({
  /** 프로필 이름 — 인사말 머리("OO님,") */
  name: z.string().trim().max(40).optional(),
  profile: Profile.optional(),
  /** 사용자 기기의 현지 시각 — 서버(UTC)가 아니라 이 값으로 시간대를 정한다 */
  now: z.object({
    iso: z.string(),
    hour: z.number().int().min(0).max(23),
    weekday: z.number().int().min(0).max(6),
  }),
  /** 브라우저가 이미 위치 권한을 준 경우에만 실린다 — 없으면 서울 기준 날씨 */
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  /** 최근 쓰레드 요약 (최신순, 최대 10) */
  threads: z.array(HomeThreadDigest).max(10).optional(),
  recentSearches: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
})
export type HomePersonalizeBody = z.infer<typeof HomePersonalizeBody>

export const HomeWeather = z.object({
  tempC: z.number(),
  humidity: z.number().optional(),
  /** WMO weather_code (Open-Meteo) */
  code: z.number().int(),
  /** 한국어 한 단어 — 맑음·흐림·비·눈… */
  label: z.string(),
})
export type HomeWeather = z.infer<typeof HomeWeather>

export const HomePersonalizeResult = z.object({
  /** 상태 인사 한 줄 — 검색어 제안 없음. 최근 쓰레드를 가리키는 부분은 「」로 감싸져 있고(FE 가 탭 대상으로 만든다) threadIndex 가 그 쓰레드다 */
  greeting: z.string(),
  /** 인사말이 가리키는 쓰레드 — 요청 threads 의 1-based 번호. 쓰레드를 언급하지 않았으면 null */
  threadIndex: z.number().int().positive().nullable().optional(),
  /** 개인화 추천 검색어 (보라 칩) — 자연어 명사구, 최대 3 */
  suggestions: z.array(z.string()).max(3),
  weather: HomeWeather.nullable(),
  source: z.enum(['llm', 'fallback']),
})
export type HomePersonalizeResult = z.infer<typeof HomePersonalizeResult>

/* 인기 검색어(파랑 칩) — 전체 사용자 기준 후보 표를 인기순 내림차순으로 자른 것. 표는 core 설정 KV `search-popular` */
export const PopularSearchEntry = z.object({
  keyword: z.string(),
  count: z.number().int().nonnegative(),
})
export type PopularSearchEntry = z.infer<typeof PopularSearchEntry>

export const PopularSearchesResult = z.object({
  items: z.array(PopularSearchEntry),
  /** kv = core 설정 표, seed = 표가 아직 없어 내장 시드로 답함 */
  source: z.enum(['kv', 'seed']),
})
export type PopularSearchesResult = z.infer<typeof PopularSearchesResult>
