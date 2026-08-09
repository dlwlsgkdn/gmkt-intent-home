import type { z } from 'zod'
import type { LlmMeta } from '@ddak/schema'

/*
 * LlmPort — LLM 호출 계층의 프로바이더 중립 계약 (DESIGN-PIPELINE-LANGGRAPH.md §1).
 * 파이프라인(그래프 노드·스튜디오 dry-run)은 이 인터페이스만 알고, 구현체가
 * 프로바이더 SDK(1차: Anthropic — apps/bff llm.service)를 감싼다.
 * 프로바이더가 바뀌어도 프롬프트·스키마·가드는 그대로고 구현체만 추가된다.
 */

export type GenResult<T> = { content: T; meta: LlmMeta }

/** 생성 강도 — Anthropic effort와 1:1이지만 개념은 프로바이더 중립
 * (OpenAI reasoning_effort·Gemini thinking budget에 구현체가 매핑한다) */
export type LlmEffort = 'low' | 'medium' | 'high'

/** 조회를 마친 시스템 프롬프트 — custom이면 llmMeta.promptVersion에 `+custom`을 남긴다 */
export type ResolvedSystem = { text: string; custom: boolean }

/** 부분 스트리밍 핸들러 — 원소는 원시 JSON 조각으로 전달되고, 검증·투영은 호출자 몫.
 * *Partial은 자라는 중인 값의 토큰 단위 미리보기(같은 키/인덱스 반복 호출 — 완성 시 onHead/onElement가 최종본).
 * onSearch는 웹 검색 서버 도구의 실행을 알린다 (진행 문구용) */
export type LlmStreamHandlers = {
  arrayKey: string
  headKeys?: string[]
  onHead?: (key: string, value: string) => void
  onElement?: (element: unknown, index: number) => void
  onHeadPartial?: (key: string, value: string) => void
  onElementPartial?: (element: unknown, index: number) => void
  onSearch?: (query: string) => void
}

export type LlmGenerateRequest = {
  system: ResolvedSystem
  effort: LlmEffort
  user: string
  webSearch?: boolean
  stream?: LlmStreamHandlers
}

/** LLM 생성 실패 — 호출자(컨트롤러)가 SSE error 이벤트(실패 안내)로 변환한다 */
export class LlmGenerationError extends Error {
  constructor(
    readonly code: 'llm_not_configured' | 'llm_refused' | 'llm_failed',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

export interface LlmPort {
  generate<S extends z.ZodTypeAny>(
    label: string,
    schema: S,
    req: LlmGenerateRequest,
  ): Promise<GenResult<S['_output']>>
}
