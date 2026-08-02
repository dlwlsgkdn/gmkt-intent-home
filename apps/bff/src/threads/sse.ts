/*
 * SSE 헬퍼 — POST 기반 스트림이라 @nestjs/common의 @Sse(GET 전용) 대신 응답에 직접 쓴다.
 * 이벤트: status(진행 문구) → result(완성 페이지) | error. v1은 부분 스트리밍 없음 (§4-1).
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

export function sseSend(res: SseRes, event: 'status' | 'result' | 'error', data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function sseClose(res: SseRes) {
  res.end()
}
