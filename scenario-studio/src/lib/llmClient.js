/*
 * 케이스 자동 생성 LLM 호출 클라이언트.
 * - 사용자가 입력한 본인 API 키가 있으면: 브라우저에서 Anthropic API로 직접 호출
 *   (키는 localStorage에만 저장, 우리 서버로는 전송되지 않음)
 * - 키가 없으면: /api/generate 서버 프록시(운영자가 Vercel 환경변수에 키를 둔 경우)로 폴백
 */

export const LLM_API_KEY_STORAGE_KEY = 'ddak-anthropic-api-key-v1'

export function loadLlmApiKey() {
  try {
    return window.localStorage.getItem(LLM_API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function saveLlmApiKey(value) {
  try {
    const trimmed = String(value || '').trim()
    if (trimmed) window.localStorage.setItem(LLM_API_KEY_STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(LLM_API_KEY_STORAGE_KEY)
  } catch {
    /* 저장 실패는 무시 — 세션 내 상태로만 동작 */
  }
}

export function isLikelyAnthropicKey(value) {
  return /^sk-ant-/.test(String(value || '').trim())
}

const textFromContent = (content) =>
  (Array.isArray(content) ? content : [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')

/* 공통 반환: { output_text } — 실패 시 사용자에게 보여줄 한국어 메시지로 throw */
export async function requestCaseGeneration({ apiKey, prompt, responseSchema, effort = 'low' }) {
  const key = String(apiKey || '').trim()

  if (key) {
    // Anthropic 공식 브라우저 직접 호출 (CORS 허용 헤더 필요)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 32000,
        output_config: {
          effort,
          ...(responseSchema ? { format: { type: 'json_schema', schema: responseSchema } } : {}),
        },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`
      if (response.status === 401) throw new Error(`API 키가 유효하지 않아요. (${message})`)
      if (response.status === 429) throw new Error(`요청 한도에 걸렸어요. 잠시 후 다시 시도해주세요. (${message})`)
      throw new Error(`Anthropic API 오류: ${message}`)
    }
    if (data.stop_reason === 'refusal') {
      throw new Error('모델이 요청을 거절했어요. 프롬프트 내용을 조정해 다시 시도해주세요.')
    }
    if (data.stop_reason === 'max_tokens') {
      throw new Error('응답이 잘렸어요. 한 번에 생성하는 조합 수를 줄여 다시 시도해주세요.')
    }
    return { output_text: textFromContent(data.content), model: data.model, usage: data.usage }
  }

  return proxyRequest({ prompt, responseSchema, effort })
}

/*
 * 웹 검색(서버 도구)을 켠 호출 — 구조화 출력 대신 텍스트를 그대로 받는다.
 * 서버 도구는 Anthropic 쪽에서 실행되며, 검색 루프가 길어지면 stop_reason='pause_turn'으로
 * 끊기므로 assistant 응답을 되돌려 보내 이어서 진행한다.
 */
export async function requestWebSearch({ apiKey, prompt, maxSearches = 6, maxContinuations = 4 }) {
  const key = String(apiKey || '').trim()
  if (!key) {
    const payload = await proxyRequest({ prompt, webSearch: true, maxSearches })
    return payload.output_text || ''
  }

  const messages = [{ role: 'user', content: prompt }]
  let text = ''
  for (let turn = 0; turn <= maxContinuations; turn++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }],
        messages,
      }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`
      if (response.status === 401) throw new Error(`API 키가 유효하지 않아요. (${message})`)
      if (response.status === 429) throw new Error(`요청 한도에 걸렸어요. 잠시 후 다시 시도해주세요. (${message})`)
      throw new Error(`Anthropic API 오류: ${message}`)
    }
    if (data.stop_reason === 'refusal') throw new Error('모델이 검색 요청을 거절했어요.')
    text += textFromContent(data.content)
    if (data.stop_reason !== 'pause_turn') return text
    // 서버 도구 루프가 일시 정지됨 — 응답을 그대로 돌려보내 이어서 실행
    messages.push({ role: 'assistant', content: data.content })
  }
  return text
}

async function proxyRequest(body) {
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const rawText = await response.text()
  let payload = null
  try { payload = JSON.parse(rawText) } catch { /* 아래에서 원문 그대로 처리 */ }
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`
    if (response.status === 501 || response.status === 404) {
      throw new Error(`서버에 키가 없어요. 위에 본인 Anthropic API 키를 입력하거나 수동 모드를 사용해주세요. (${message})`)
    }
    throw new Error(message)
  }
  return payload && typeof payload.output_text === 'string' ? payload : { output_text: rawText }
}
