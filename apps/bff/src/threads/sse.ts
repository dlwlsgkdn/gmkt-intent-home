/*
 * SSE 헬퍼 — POST 기반 스트림이라 @nestjs/common의 @Sse(GET 전용) 대신 응답에 직접 쓴다.
 * 이벤트: status(진행 문구) → head/question/section(부분 스트리밍 — 컴포넌트 단위 미리보기)
 * → result(완성 페이지 — 권위) | error. 부분 이벤트를 모르는 구버전 FE는 무시해도 무방하다.
 */
export type SseRes = {
  setHeader(key: string, value: string): void
  write(chunk: string): boolean
  end(): void
  flushHeaders?: () => void
}

export function openSse(res: SseRes) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

export function sseSend(res: SseRes, event: 'status' | 'head' | 'question' | 'section' | 'result' | 'error', data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function sseClose(res: SseRes) {
  res.end()
}
