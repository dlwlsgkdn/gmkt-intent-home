/* 관리 페이지(#admin) 클라이언트 — BFF `/api/admin/*` (API 경로·오리진 규칙은 liveApi.js와 동일).
   별도 인증 없음 — 서비스 토큰은 엣지 미들웨어가 주입하고, 옛 관리 토큰(x-admin-token) 게이트는 뗐다. */

const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const BASE = (SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app') + '/api/bff/admin'

export class AdminApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function req(method, path, body) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
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
    if (res.status === 503) throw new AdminApiError(503, detail || '백엔드(core)가 연결되지 않은 환경이에요.')
    throw new AdminApiError(res.status, detail || `요청에 실패했어요. (HTTP ${res.status})`)
  }
  return res.json()
}

/** 전체 쓰레드 목록 — { items, nextCursor } */
export function fetchAdminThreads(cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return req('GET', `/threads${qs}`)
}

/** 쓰레드 상세 — core ThreadWithSteps 원본 (라이프사이클 로그) */
export function fetchAdminThread(threadId) {
  return req('GET', `/threads/${encodeURIComponent(threadId)}`)
}

/** 보관 처리 — 사용자 목록에서 숨긴다 (데이터 보존) */
export function archiveAdminThread(threadId) {
  return req('POST', `/threads/${encodeURIComponent(threadId)}/archive`)
}

/** 평가 모아보기 — { items(제출 1회 = 항목 1개, 최신순, latest=유효본 표시), truncated } */
export function fetchAdminFeedback() {
  return req('GET', '/feedback')
}

/** LLM 모델 설정 조회 — { current, defaultModel, configured, options } */
export function fetchAdminModel() {
  return req('GET', '/model')
}

/** LLM 모델 변경 — model: 카탈로그 id 또는 null(기본값 복귀) */
export function putAdminModel(model) {
  return req('PUT', '/model', { model })
}
