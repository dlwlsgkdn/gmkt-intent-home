import { NotFoundException } from '@nestjs/common'
import type { LlmMeta, PlanQuality, ThreadWithSteps } from '@ddak/schema'

/*
 * 쓰레드 영속 계약의 공용 조각 — legacy 경로(threads.service)와 LangGraph 엔진(engine/)이
 * 같은 스텝 배치·메타 결합·의도 해석을 쓴다. 별도 파일인 이유: threads.service ↔ engine이
 * 서로를 import하면 순환이 생기므로 둘 다 여기만 본다.
 */

/** 스텝 순번 — (thread, seq)가 멱등 키라 단계별 고정 순번을 쓴다 */
export const SEQ = { explore: 1, survey: 2, answers: 3, plan: 4, actionBase: 5 } as const

/** 3단계 메타 결합(뼈대 ∥ 상품 ∥ 참고 콘텐츠) — usage·검색 횟수는 합산, latency는 병렬이라 max. 단계별 소요는 phases로,
 * 계획 품질 요약은 quality로 남긴다 (admin 진단·전환 판정 계기판 KPI). engine 각인은 계기판의 비교 축이다.
 * promptVersion 은 어느 단계든 재정의(+custom)가 있으면 그 표식을 남긴다 */
export function combineMeta(
  skeleton: LlmMeta,
  products: LlmMeta | null,
  engine: string,
  extra: { contents?: LlmMeta | null; quality?: PlanQuality } = {},
): LlmMeta {
  const contents = extra.contents ?? null
  const parts = [skeleton, products, contents].filter((m): m is LlmMeta => !!m)
  const sum = (pick: (m: LlmMeta) => number | undefined) => {
    const values = parts.map(pick).filter((v): v is number => typeof v === 'number')
    return values.length ? values.reduce((a, b) => a + b, 0) : undefined
  }
  const custom = parts.some((m) => /\+custom$/.test(m.promptVersion ?? ''))
  const base = (skeleton.promptVersion ?? '').replace(/\+custom$/, '')
  return {
    engine,
    model: products?.model ?? skeleton.model,
    promptVersion: skeleton.promptVersion ? (custom ? `${base}+custom` : base) : undefined,
    usage: {
      inputTokens: sum((m) => m.usage?.inputTokens),
      outputTokens: sum((m) => m.usage?.outputTokens),
      cacheReadTokens: sum((m) => m.usage?.cacheReadTokens),
      webSearchRequests: sum((m) => m.usage?.webSearchRequests),
    },
    latencyMs: Math.max(skeleton.latencyMs ?? 0, products?.latencyMs ?? 0, contents?.latencyMs ?? 0),
    phases: {
      skeletonMs: skeleton.latencyMs ?? null,
      productsMs: products?.latencyMs ?? null,
      contentsMs: contents?.latencyMs ?? null,
    },
    ...(extra.quality ? { quality: extra.quality } : {}),
  } as LlmMeta
}

export function intentOf(thread: ThreadWithSteps): string {
  if (!thread.source) {
    if (!thread.title) throw new NotFoundException('쓰레드 의도를 알 수 없습니다')
    return thread.title
  }
  return thread.source.query ?? thread.source.chipId ?? thread.title ?? '뷰티 쇼핑'
}
