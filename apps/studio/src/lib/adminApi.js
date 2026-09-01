/* 운영 콘솔(#ops) 클라이언트 — BFF `/api/admin/*` (API 경로·오리진 규칙은 liveApi.js와 동일).
   별도 인증 없음 — 서비스 토큰은 엣지 미들웨어가 주입하고, 옛 관리 토큰(x-admin-token) 게이트는 뗐다. */

const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const BASE = (SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app') + '/api/bff/admin'
export const PROMPT_TEST_SESSION_KEY = 'ddak-ops-prompt-test-v1'

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

/** LLM 시스템 프롬프트 조회 — 현재값과 복구 가능한 저장 이력을 함께 받는다 */
export function fetchAdminPrompts() {
  return req('GET', '/prompts')
}

/** 자연어 변경 요청 → 저장되지 않은 Claude 수정안. 실제 반영은 putAdminPrompt를 다시 호출해야 한다. */
export function assistAdminPrompt(id, instruction, currentText) {
  return req('POST', `/prompts/${encodeURIComponent(id)}/assist`, { instruction, currentText })
}

/** LLM 시스템 프롬프트 재정의 — note는 변경 기록과 시험 쓰레드 제목에 쓰는 운영 메모 */
export function putAdminPrompt(id, text, note) {
  return req('PUT', `/prompts/${encodeURIComponent(id)}`, { text, ...(note?.trim() ? { note: note.trim() } : {}) })
}

/** 지시서 A/B 결과와 전체 평가를 admin 쓰레드로 저장 — 실제 지시서는 아직 적용하지 않는다. */
export function saveAdminPromptTrial(body) {
  return req('POST', '/prompt-trials', body)
}

/** 저장한 시험 쓰레드에서 최종 결정 — applied만 운영 지시서를 갱신하고 rejected는 기록만 남긴다. */
export function decideAdminPromptTrial(threadId, decision) {
  return req('POST', `/threads/${encodeURIComponent(threadId)}/prompt-trial/decision`, { decision })
}

/** 운영 설정 변경 로그 — AI 지시서의 기존 버전도 합쳐 최신순으로 받는다 */
export function fetchAdminChanges() {
  return req('GET', '/changes')
}

/** 파이프라인 현황 — { engine, stages(전략 문서 0~7 카탈로그), knowledge(지식 KV+블록리스트) } */
export function fetchAdminPipeline() {
  return req('GET', '/pipeline')
}

/** 지식 KV 편집 — value: 원문 또는 null(설정 삭제 = 지식 없음). 응답은 갱신된 pipeline wire */
export function putAdminKnowledge(id, value) {
  return req('PUT', `/knowledge/${encodeURIComponent(id)}`, { value })
}

/** 지식 소스 추가 — { label, placeholder, heading?, note?, value? }. 주입은 시스템 자리표시자 한 가지다
 * (만들기만 해서는 어느 단계에도 실리지 않는다 — 단계 프롬프트에 토큰을 넣어야 유입된다) */
export function postAdminKnowledgeSource(body) {
  return req('POST', '/knowledge', body)
}

/** 추가 지식 소스 삭제 — 값 KV와 재정의 프롬프트에 남은 토큰까지 서버가 함께 지운다 */
export function deleteAdminKnowledgeSource(id) {
  return req('DELETE', `/knowledge/${encodeURIComponent(id)}`)
}

/** 생성 엔진 플래그 — engine: 'legacy' | 'langgraph' | null(기본값 legacy 복귀) */
export function putAdminEngine(engine) {
  return req('PUT', '/engine', { engine })
}


/** SSE POST 공용 소비자 — status(진행 문구) 콜백 + 마지막 result 반환, error 이벤트는 예외로.
 * onEvent(name, data)는 그 밖의 이벤트(flow-run의 stage·content 등)를 받는다 */
async function ssePost(path, body, { onStatus, onEvent } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AdminApiError(0, '관리 서버에 연결하지 못했어요. 네트워크 상태를 확인해주세요.')
  }
  if (!res.ok || !res.body) throw new AdminApiError(res.status, `요청에 실패했어요. (HTTP ${res.status})`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null
  let error = null
  const handle = (block) => {
    const ev = block.match(/^event: (.+)$/m)?.[1]
    const dataLine = block.match(/^data: (.+)$/m)?.[1]
    if (!ev || !dataLine) return
    let data
    try {
      data = JSON.parse(dataLine)
    } catch {
      return
    }
    if (ev === 'status') onStatus?.(data.message)
    else if (ev === 'result') result = data
    else if (ev === 'error') error = data
    else onEvent?.(ev, data)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      handle(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
    if (done) break
  }
  if (error) {
    const e = new AdminApiError(0, error.message || '실행에 실패했어요.')
    e.code = error.code
    throw e
  }
  if (!result) throw new AdminApiError(0, '결과를 받지 못했어요. 잠시 후 다시 시도해 주세요.')
  return result
}

/** LLM 단계 단독 실행 (플레이그라운드, SSE) — 그래프·쓰레드·core 기록 없음.
 * body: { stageId, intent, profile?, survey?, answers?, promptOverride? } → DryRunResult */
export function dryRunStage(body, opts) {
  return ssePost('/pipeline/dry-run', body, opts)
}

/** 전체 플로우 실행 (플레이그라운드, SSE) — 실제 LangGraph 그래프이며 core 연결 시 쓰레드로 기록된다.
 * body: { phase: 'survey'|'plan', flowId?, intent, profile?, survey?, answers?, testLabel? } → FlowRunResult.
 * opts.onEvent가 stage({ id, phase, meta?, prompt?, summary? })·content(스트림 조각)를 받는다 */
export function flowRunPipeline(body, opts) {
  return ssePost('/pipeline/flow-run', body, opts)
}

/* ── 평가·실험 (페이즈 5) ── */

/** 골든 케이스 목록 — { items: EvalCase[] } */
export function fetchEvalCases() {
  return req('GET', '/eval/cases')
}

/** 쓰레드 → 케이스 승격 — 입력 스냅샷을 굳힌다 (쓰레드 상세의 버튼) */
export function promoteEvalCase(threadId) {
  return req('POST', '/eval/cases', { threadId })
}

export function deleteEvalCase(id) {
  return req('DELETE', `/eval/cases/${encodeURIComponent(id)}`)
}

/** 케이스 실행 (SSE) — 뼈대+상품 dry-run 순차 실행·기록. → { run: EvalRun } */
export function runEvalCase(id, body, opts) {
  return ssePost(`/eval/cases/${encodeURIComponent(id)}/run`, body || {}, opts)
}

/** 케이스의 실행 기록 — { items: EvalRun[] } (최신순) */
export function fetchEvalRuns(caseId) {
  return req('GET', `/eval/cases/${encodeURIComponent(caseId)}/runs`)
}

/** 사람 채점 — 전체(score 0~5 | null(미채점), comment) + 항목별 components(생략 시 유지).
 * 라이브 피드백과 같은 평가 레코드 문법 — components: [{ id, label, score, feedback }] */
export function scoreEvalRun(id, score, comment, components) {
  return req('PATCH', `/eval/runs/${encodeURIComponent(id)}`, {
    score,
    comment,
    ...(components !== undefined ? { components } : {}),
  })
}

/** 자동 채점 (SSE) — LLM 심사관이 루브릭 4차원으로 채점해 run.judge에 저장. → { run: EvalRun }
 * 사람 채점과 절대 섞이지 않는다 (source 축) */
export function judgeEvalRun(id, opts) {
  return ssePost(`/eval/runs/${encodeURIComponent(id)}/judge`, {}, opts)
}

/** 전환 판정 계기판 — 실주행 plan 스텝 llmMeta 엔진별 집계 */
export function fetchEngineMetrics() {
  return req('GET', '/metrics/engines')
}
