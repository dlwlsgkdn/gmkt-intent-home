import type { LlmMeta } from '@ddak/schema'
import type { GenResult, PlanContentsGen } from '@ddak/pipeline'

/*
 * 5c 참고 콘텐츠의 「빈 결과 재시도」 (2026-09-17). 운영 계획 18건 중 44% 가 콘텐츠 0개였는데 드롭 로그는 비어 있었다 —
 * 실패가 아니라 모델이 검색 3회를 쓰고도 `sections: []` 를 돌려준 것(재현 3회: 5개·1개·0개, 같은 검색어를 되풀이했다).
 * 첫 호출이 항목을 하나도 안 주면 가변부에 검색 전략을 바꾸라는 힌트(CONTENTS_RETRY_HINT)를 붙여 **한 번 더** 부른다.
 * 5c 는 상품(5b, 평균 123초)과 병렬이고 자체는 평균 40초라 재시도 1회(≤ ~60초)는 대개 전체 지연에 안 실린다.
 * 그래프·legacy·dry-run 이 같은 규칙을 쓴다. 두 번째도 비면 그대로 빈 채 반환한다(계획은 산다).
 */

export type ContentsAttempt = (opts: { retry: boolean }) => Promise<GenResult<PlanContentsGen>>

export const contentItemCount = (content: PlanContentsGen): number =>
  content.sections.reduce((n, s) => n + (s.items?.length ?? 0), 0)

/** 두 시도의 메타 합산 — 사용량·검색 횟수·지연은 더하고 모델·프롬프트 버전은 마지막 시도 것 */
export function mergeAttemptMeta(first: LlmMeta, second: LlmMeta): LlmMeta {
  const add = (a?: number, b?: number) => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0))
  return {
    ...second,
    usage: {
      inputTokens: add(first.usage?.inputTokens, second.usage?.inputTokens),
      outputTokens: add(first.usage?.outputTokens, second.usage?.outputTokens),
      cacheReadTokens: add(first.usage?.cacheReadTokens, second.usage?.cacheReadTokens),
      webSearchRequests: add(first.usage?.webSearchRequests, second.usage?.webSearchRequests),
    },
    latencyMs: (first.latencyMs ?? 0) + (second.latencyMs ?? 0),
  }
}

export async function generatePlanContentsRobust(
  attempt: ContentsAttempt,
  opts: { onRetry?: () => void } = {},
): Promise<{ result: GenResult<PlanContentsGen>; attempts: number }> {
  const first = await attempt({ retry: false })
  if (contentItemCount(first.content) > 0) return { result: first, attempts: 1 }
  opts.onRetry?.()
  const second = await attempt({ retry: true })
  return { result: { content: second.content, meta: mergeAttemptMeta(first.meta, second.meta) }, attempts: 2 }
}
