/* 관리 페이지(#admin) 클라이언트 — BFF `/api/admin/*` (API 경로·오리진 규칙은 liveApi.js와 동일).
   인증: 사람이 입력한 관리 토큰(ADMIN_TOKEN)을 `x-admin-token` 헤더로 보낸다.
   토큰은 localStorage에 보관해 반복 입력을 없앤다 — 보안 트레이드오프는 AdminView 참고. */

const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const BASE = (SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app') + '/api/bff/admin'

const TOKEN_KEY = 'ddak-admin-token'

export function getAdminToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setAdminToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* localStorage 불가 환경 — 세션 동안 메모리 입력만으로 동작 */
  }
}

export class AdminApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
    this.unauthorized = status === 401
  }
}

async function req(method, path, token, body) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'x-admin-token': token,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new AdminApiError(0, '관리 서버에 연결하지 못했어요. 네트워크 상태를 확인해주세요.')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const parsed = await res.json()
      detail = parsed.message || parsed.error || ''
    } catch {
      /* 본문 없음 */
    }
    if (res.status === 401) throw new AdminApiError(401, '관리 토큰이 올바르지 않아요.')
    if (res.status === 503) throw new AdminApiError(503, detail || '백엔드(core)가 연결되지 않은 환경이에요.')
    throw new AdminApiError(res.status, detail || `요청에 실패했어요. (HTTP ${res.status})`)
  }
  return res.json()
}

/** 전체 쓰레드 목록 — { items, nextCursor } */
export function fetchAdminThreads(token, cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return req('GET', `/threads${qs}`, token)
}

/** 쓰레드 상세 — core ThreadWithSteps 원본 (라이프사이클 로그) */
export function fetchAdminThread(token, threadId) {
  return req('GET', `/threads/${encodeURIComponent(threadId)}`, token)
}

/** 보관 처리 — 사용자 목록에서 숨긴다 (데이터 보존) */
export function archiveAdminThread(token, threadId) {
  return req('POST', `/threads/${encodeURIComponent(threadId)}/archive`, token)
}

/** 평가 모아보기 — { items(제출 1회 = 항목 1개, 최신순, latest=유효본 표시), truncated } */
export function fetchAdminFeedback(token) {
  return req('GET', '/feedback', token)
}

/** LLM 모델 설정 조회 — { current, defaultModel, configured, options } */
export function fetchAdminModel(token) {
  return req('GET', '/model', token)
}

/** LLM 모델 변경 — model: 카탈로그 id 또는 null(기본값 복귀) */
export function putAdminModel(token, model) {
  return req('PUT', '/model', token, { model })
}
