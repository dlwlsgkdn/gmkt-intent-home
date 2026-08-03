import { z } from 'zod'

/*
 * LLM 생성 출력 스키마 — 구조화 출력(zodOutputFormat)으로 강제된다.
 * 원칙(DESIGN-LLM-SERVICE.md §0-2): LLM은 콘텐츠만 만든다 — id·배치는 BFF 스캐폴드 소유.
 */

export const SurveyGen = z.object({
  intro: z.string().describe('설문 페이지 머리 문구 — 사용자의 의도를 되짚는 한두 문장'),
  questions: z
    .array(
      z.object({
        question: z.string().describe('질문 문구'),
        options: z.array(z.string()).min(2).max(6).describe('선택지 2~6개, 짧은 명사구'),
        multi: z.boolean().describe('복수 선택 허용 여부'),
      }),
    )
    .min(3)
    .max(5),
})
export type SurveyGen = z.infer<typeof SurveyGen>

export const PlanGen = z.object({
  headline: z.string().describe('계획 페이지 제목 — 설문 결과를 반영한 맞춤 문구'),
  summary: z.string().describe('추천 방향 요약 두세 문장'),
  sections: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('guide'),
          title: z.string(),
          body: z.string().describe('가이드 본문 — 답변을 근거로 든다'),
        }),
        z.object({
          kind: z.literal('products'),
          title: z.string(),
          reason: z.string().describe('이 상품들을 고른 이유 한두 문장'),
          productIds: z.array(z.string()).max(4).describe('카탈로그에서 고른 상품 id (없으면 빈 배열)'),
          // 웹 검색 그라운딩: 검색 결과에서 확인한 상품만 — url은 BFF가 http(s) 검증 후 채택한다
          webProducts: z
            .array(
              z.object({
                name: z.string().describe('상품명 — 검색 결과에 나온 실제 상품명'),
                brand: z.string().describe('브랜드'),
                price: z.number().int().describe('판매가 (원 단위 정수) — 검색 결과에서 확인한 값'),
                mall: z.string().describe('판매처 이름 (예: 올리브영, 쿠팡)'),
                url: z.string().describe('상품 페이지 URL — 검색 결과의 주소 그대로, 지어내지 말 것'),
                tags: z.array(z.string()).max(5).describe('특징 태그'),
              }),
            )
            .max(4)
            .describe('웹 검색으로 찾은 상품 (없으면 빈 배열)'),
        }),
        z.object({
          kind: z.literal('steps'),
          title: z.string(),
          steps: z.array(z.string()).min(2).max(6).describe('실행 순서 — 아침/저녁 루틴 등'),
        }),
      ]),
    )
    .min(2)
    .max(5),
})
export type PlanGen = z.infer<typeof PlanGen>
