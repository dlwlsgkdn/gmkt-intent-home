import { LlmGenerationError } from '@ddak/pipeline'

/** 필수 LLM 단계의 한 번 더 시도 — 계획 뼈대(5a)는 상품·콘텐츠와 달리 실패하면 계획 전체가 죽는 유일한 호출이라
 * (2026-09-13 운영에서 「일시적인 문제로 계획 뼈대 생성에 실패했어요」 — 재시도로 성공), SDK 자동 재시도(429·5xx·연결
 * 오류, maxRetries)까지 다 쓴 뒤에도 `llm_failed`(일시 오류·파싱 실패)면 잠깐 쉬고 한 번 더 부른다.
 * 인증 미설정·거절(retryable=false)과 그 밖의 예외는 그대로 던진다. 스트림 조각은 같은 index 로 다시 나가므로
 * FE 미리보기는 덮어써진다(확정·기록은 언제나 최종 result). */
export const LLM_STAGE_RETRY_DELAY_MS = 2000

export type LlmStageRetryOptions = {
  /** 추가 시도 횟수 (기본 1 = 총 2회) */
  retries?: number
  delayMs?: number
  /** 재시도 직전 알림 — 로그·status 이벤트 */
  onRetry?: (error: LlmGenerationError, attempt: number) => void
}

export async function retryLlmStage<T>(attempt: () => Promise<T>, opts: LlmStageRetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1
  const delayMs = opts.delayMs ?? LLM_STAGE_RETRY_DELAY_MS
  for (let n = 0; ; n++) {
    try {
      return await attempt()
    } catch (e) {
      const transient = e instanceof LlmGenerationError && e.retryable && e.code === 'llm_failed'
      if (!transient || n >= retries) throw e
      opts.onRetry?.(e, n + 1)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
