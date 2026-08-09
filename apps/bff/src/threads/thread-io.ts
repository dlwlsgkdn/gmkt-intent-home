import { NotFoundException } from '@nestjs/common'
import type { LlmMeta, ThreadWithSteps } from '@ddak/schema'

/*
 * 쓰레드 영속 계약의 공용 조각 — legacy 경로(threads.service)와 LangGraph 엔진(engine/)이
 * 같은 스텝 배치·메타 결합·의도 해석을 쓴다. 별도 파일인 이유: threads.service ↔ engine이
 * 서로를 import하면 순환이 생기므로 둘 다 여기만 본다.
 */

/** 스텝 순번 — (thread, seq)가 멱등 키라 단계별 고정 순번을 쓴다 */
export const SEQ = { explore: 1, survey: 2, answers: 3, plan: 4, actionBase: 5 } as const

/** 2단계 메타 결합 — usage는 합산, latency는 병렬이라 max. 단계별 소요는 phases로 남긴다 (admin 진단용).
 * engine 각인은 전환 판정 계기판(plan-metas 집계)의 비교 축이다 */
export function combineMeta(skeleton: LlmMeta, products: LlmMeta | null, engine: string): LlmMeta {
  const sum = (a?: number, b?: number) => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0))
  return {
    engine,
    model: products?.model ?? skeleton.model,
    promptVersion: skeleton.promptVersion,
    usage: {
      inputTokens: sum(skeleton.usage?.inputTokens, products?.usage?.inputTokens),
      outputTokens: sum(skeleton.usage?.outputTokens, products?.usage?.outputTokens),
      cacheReadTokens: sum(skeleton.usage?.cacheReadTokens, products?.usage?.cacheReadTokens),
      webSearchRequests: products?.usage?.webSearchRequests,
    },
    latencyMs: Math.max(skeleton.latencyMs ?? 0, products?.latencyMs ?? 0),
    phases: { skeletonMs: skeleton.latencyMs ?? null, productsMs: products?.latencyMs ?? null },
  } as LlmMeta
}

export function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('쓰레드 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
