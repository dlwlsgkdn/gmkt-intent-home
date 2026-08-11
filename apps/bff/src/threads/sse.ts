/*
 * SSE 헬퍼 — POST 기반 스트림이라 @nestjs/common의 @Sse(GET 전용) 대신 응답에 직접 쓴다.
 * 이벤트: status(진행 문구) → head/question/section(부분 스트리밍 — 토큰 단위 미리보기:
 * 자라는 중인 값이 같은 키/index로 반복 전송되고 FE가 덮어쓴다, 완성 시 최종본 재전송.
 * section은 final:false=자라는 중 증분 / final:true·생략=최종본 — FE는 최종본까지 자리를 pending 유지)
 * → skeleton(계획 전용 — 뼈대 조기 확정: 자리는 null·pending 인덱스, 이후 section이 채운다)
 * → result(완성 페이지 — 권위) | error. 부분 이벤트를 모르는 구버전 FE는 무시해도 무방하다.
 * stage/content/state는 플레이그라운드 flow-run 전용(단계 수명·스트림 조각·그래프 상태 관측) — admin 콘솔만 소비한다.
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

export function sseSend(
  res: SseRes,
  event: 'status' | 'head' | 'question' | 'skeleton' | 'section' | 'stage' | 'content' | 'state' | 'result' | 'error',
  data: unknown,
) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function sseClose(res: SseRes) {
  res.end()
}
