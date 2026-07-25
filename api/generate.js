/* DDAK Scenario Studio — 계획 케이스 자동 생성 LLM 프록시.
   POST /api/generate { prompt, responseSchema, effort? } → { output_text, model, usage }
   Vercel 프로젝트 환경변수 ANTHROPIC_API_KEY가 필요하다 (클라이언트에 키를 두지 않는다). */
import Anthropic from '@anthropic-ai/sdk'

const EFFORTS = new Set(['low', 'medium', 'high'])

const textFrom = (content) =>
  (content || []).filter((block) => block.type === 'text').map((block) => block.text).join('')

/* 웹 검색 서버 도구는 검색 루프가 길어지면 pause_turn으로 끊긴다 — 응답을 되돌려 보내 이어간다 */
async function runWebSearch(client, prompt, maxSearches) {
  const messages = [{ role: 'user', content: prompt }]
  let text = ''
  for (let turn = 0; turn <= 4; turn++) {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      output_config: { effort: 'medium' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }],
      messages,
    })
    if (response.stop_reason === 'refusal') throw new Error('모델이 검색 요청을 거절했어요.')
    text += textFrom(response.content)
    if (response.stop_reason !== 'pause_turn') return text
    messages.push({ role: 'assistant', content: response.content })
  }
  return text
}

export default async function handler(req, res) {
  // GitHub Pages 등 다른 오리진에서도 같은 함수를 쓸 수 있게 CORS 허용 (state.js와 동일 정책)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(501).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았어요. Vercel 프로젝트 환경변수에 추가한 뒤 다시 배포해주세요.',
    })
    return
  }

  const { prompt, responseSchema, effort, webSearch, maxSearches } = req.body || {}
  if (typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ error: 'prompt가 필요해요.' })
    return
  }

  try {
    const client = new Anthropic()

    if (webSearch) {
      const text = await runWebSearch(client, prompt, Number(maxSearches) || 6)
      res.status(200).json({ output_text: text })
      return
    }

    const outputConfig = { effort: EFFORTS.has(effort) ? effort : 'low' }
    if (responseSchema && typeof responseSchema === 'object') {
      outputConfig.format = { type: 'json_schema', schema: responseSchema }
    }
    // 콘텐츠 생성이 안전 분류기에 걸리는 드문 경우를 대비해 서버측 폴백을 기본 활성화
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: outputConfig,
      messages: [{ role: 'user', content: prompt }],
    })

    if (response.stop_reason === 'refusal') {
      res.status(502).json({ error: '모델이 요청을 거절했어요. 프롬프트 내용을 조정해 다시 시도해주세요.' })
      return
    }
    if (response.stop_reason === 'max_tokens') {
      res.status(502).json({ error: '응답이 잘렸어요. 한 번에 생성하는 조합 수를 줄여 다시 시도해주세요.' })
      return
    }

    const outputText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
    res.status(200).json({ output_text: outputText, model: response.model, usage: response.usage })
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
