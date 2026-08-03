/* 라이브 생성 체험 클라이언트 — BFF threads API (API.md §1).
   FE는 same-origin `/api/bff/*`만 부른다: 배포에선 루트 middleware.js(엣지)가 BFF로
   rewrite + 서비스 토큰을 주입하고, 로컬 개발에선 vite 프록시(vite.config.js)가 로컬
   BFF(8788)로 넘긴다. GitHub Pages 등 교차 오리진은 스튜디오 Vercel 도메인으로 부른다
   (remote.js와 같은 규칙). 설문·계획 생성은 SSE(status→result|error)를 fetch 스트림으로
   소비한다 — POST라 EventSource를 못 쓴다. */

const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const BASE = (SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app') + '/api/bff'

/* 실패 안내 정책(API.md): 가짜 콘텐츠로 대체하지 않고 code·message·retryable을 그대로 전한다 */
export class LiveApiError extends Error {
  constructor(code, message, retryable) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

/* 익명 디바이스 id — BFF의 사용자 식별(x-device-id). 기기당 1회 발급해 보관 */
export function liveDeviceId() {
  try {
    let id = localStorage.getItem('ddak-device-id')
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem('ddak-device-id', id)
    }
    return id
  } catch {
    return 'anonymous'
  }
}

function headers(json) {
  const h = { 'x-device-id': liveDeviceId() }
  if (json) h['content-type'] = 'application/json'
  return h
}

/* HTTP 실패 → 사용자 문구. 503은 미들웨어의 "BFF_URL 미설정"(연결 안 된 배포)일 수 있다 */
async function toLiveError(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body.message || body.error || ''
  } catch { /* 본문 없음 */ }
  if (res.status === 503) {
    return new LiveApiError('not_configured', 'AI 생성 서버가 아직 연결되지 않은 환경이에요. 배포 설정(BFF_URL)을 확인해주세요.', false)
  }
  if (res.status === 401) {
    return new LiveApiError('unauthorized', 'AI 생성 서버 접근이 거절됐어요. 스튜디오 도메인을 통해 접속했는지 확인해주세요.', false)
  }
  if (res.status === 400) {
    return new LiveApiError('bad_request', detail || '요청 형식 문제로 실패했어요.', false)
  }
  return new LiveApiError('internal', detail || `일시적인 문제로 실패했어요. (HTTP ${res.status})`, true)
}

function networkError() {
  return new LiveApiError('network', 'AI 생성 서버에 연결하지 못했어요. 네트워크 상태를 확인하고 다시 시도해주세요.', true)
}

/* 쓰레드 시작 — { chipId?|query, title?, profile? } → { threadId } (core 발급 스노우플레이크) */
export async function startLiveThread(body) {
  let res
  try {
    res = await fetch(`${BASE}/threads`, { method: 'POST', headers: headers(true), body: JSON.stringify(body) })
  } catch {
    throw networkError()
  }
  if (!res.ok) throw await toLiveError(res)
  return res.json()
}

/* 이어보기 — 단계별 페이지(survey/answers/plan) 복원 */
export async function fetchLiveThread(threadId) {
  let res
  try {
    res = await fetch(`${BASE}/threads/${encodeURIComponent(threadId)}`, { headers: headers(false) })
  } catch {
    throw networkError()
  }
  if (!res.ok) throw await toLiveError(res)
  return res.json()
}

/* 행동 기록(담기/완료 등) — fire-and-forget. 실패해도 체험을 막지 않는다 */
export function recordLiveEvent(threadId, type, data) {
  fetch(`${BASE}/threads/${encodeURIComponent(threadId)}/events`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify(data ? { type, data } : { type }),
  }).catch(() => {})
}

/* SSE 소비 — event/data 블록을 빈 줄 기준으로 잘라 status·result·error 핸들러에 배분한다.
   result·error 없이 스트림이 끝나면(중간 끊김) internal 오류로 정직하게 알린다 */
async function consumeSse(res, handlers) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let terminal = false
  const dispatch = (block) => {
    let event = 'message'
    const dataLines = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) return
    let payload
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    if (event === 'status') {
      if (handlers.onStatus && payload.message) handlers.onStatus(payload.message)
    } else if (event === 'result') {
      terminal = true
      handlers.onResult(payload.page)
    } else if (event === 'error') {
      terminal = true
      handlers.onError(new LiveApiError(payload.code || 'internal', payload.message || '생성에 실패했어요.', payload.retryable !== false))
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      if (block.trim()) dispatch(block)
    }
  }
  if (buf.trim()) dispatch(buf)
  if (!terminal) {
    handlers.onError(new LiveApiError('internal', '생성 응답이 중간에 끊겼어요. 다시 시도해주세요.', true))
  }
}

async function streamGeneration(path, body, handlers) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { ...headers(true), accept: 'text/event-stream' },
      body: JSON.stringify(body),
    })
  } catch {
    handlers.onError(networkError())
    return
  }
  if (!res.ok || !res.body) {
    handlers.onError(await toLiveError(res))
    return
  }
  try {
    await consumeSse(res, handlers)
  } catch {
    handlers.onError(networkError())
  }
}

/* 설문 페이지 생성 (LLM #1) — handlers: { onStatus(message), onResult(SurveyPageWire), onError(LiveApiError) } */
export function streamLiveSurvey(threadId, body, handlers) {
  return streamGeneration(`/threads/${encodeURIComponent(threadId)}/survey`, body, handlers)
}

/* 응답 제출 → 계획 페이지 생성 (LLM #2) — handlers: { onStatus, onResult(PlanPageWire), onError } */
export function streamLivePlan(threadId, body, handlers) {
  return streamGeneration(`/threads/${encodeURIComponent(threadId)}/plan`, body, handlers)
}
