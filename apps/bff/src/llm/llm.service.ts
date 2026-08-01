import { Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Answer, LlmMeta, Profile, SurveyPageWire } from '@ddak/schema'
import { PlanGen, SurveyGen } from './gen-schemas'
import { PLAN_SYSTEM, PROMPT_VERSION, SURVEY_SYSTEM, buildPlanRequest, buildSurveyRequest } from './prompts'

const MODEL = 'claude-opus-5'

export type GenResult<T> = { content: T; meta: LlmMeta }

/*
 * Claude 호출 계층 — 구조화 출력(parse) + 프롬프트 캐싱 + refusal 처리 + 폴백.
 * 키가 없거나 호출이 실패하면 폴백 템플릿으로 응답해 저니가 끊기지 않는다
 * (meta.fallback=true 로 기록 — DESIGN-LLM-SERVICE.md §4-2).
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private client: Anthropic | null | undefined

  private clientOrNull(): Anthropic | null {
    if (this.client !== undefined) return this.client
    try {
      this.client = new Anthropic()
    } catch {
      this.logger.warn('Anthropic 클라이언트 생성 실패 (자격증명 없음) — 폴백 템플릿으로 동작')
      this.client = null
    }
    return this.client
  }

  async generateSurvey(intent: string, profile?: Profile): Promise<GenResult<SurveyGen>> {
    const client = this.clientOrNull()
    if (!client) return { content: fallbackSurvey(), meta: { fallback: true, promptVersion: PROMPT_VERSION } }
    const started = Date.now()
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: SURVEY_SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        output_config: { effort: 'medium', format: zodOutputFormat(SurveyGen) },
        messages: [{ role: 'user', content: buildSurveyRequest(intent, profile) }],
      })
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        this.logger.warn(`설문 생성 폴백 — stop_reason=${response.stop_reason}`)
        return { content: fallbackSurvey(), meta: this.meta(started, response, true) }
      }
      return { content: response.parsed_output, meta: this.meta(started, response) }
    } catch (e) {
      this.logger.warn(`설문 생성 실패 → 폴백: ${(e as Error).message}`)
      return { content: fallbackSurvey(), meta: { fallback: true, promptVersion: PROMPT_VERSION, latencyMs: Date.now() - started } }
    }
  }

  async generatePlan(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
  ): Promise<GenResult<PlanGen>> {
    const client = this.clientOrNull()
    if (!client) return { content: fallbackPlan(), meta: { fallback: true, promptVersion: PROMPT_VERSION } }
    const started = Date.now()
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: PLAN_SYSTEM, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        output_config: { effort: 'high', format: zodOutputFormat(PlanGen) },
        messages: [{ role: 'user', content: buildPlanRequest(intent, survey, answers, profile) }],
      })
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        this.logger.warn(`계획 생성 폴백 — stop_reason=${response.stop_reason}`)
        return { content: fallbackPlan(), meta: this.meta(started, response, true) }
      }
      return { content: response.parsed_output, meta: this.meta(started, response) }
    } catch (e) {
      this.logger.warn(`계획 생성 실패 → 폴백: ${(e as Error).message}`)
      return { content: fallbackPlan(), meta: { fallback: true, promptVersion: PROMPT_VERSION, latencyMs: Date.now() - started } }
    }
  }

  private meta(started: number, response: Anthropic.Message, fallback?: boolean): LlmMeta {
    return {
      model: response.model,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      latencyMs: Date.now() - started,
      ...(fallback ? { fallback: true } : {}),
    }
  }
}

/* ── 폴백 템플릿 — LLM 없이도 저니가 동작하게 하는 안전망 ─────────────── */

function fallbackSurvey(): SurveyGen {
  return {
    intro: '몇 가지만 여쭤보면 딱 맞는 계획을 세워드릴 수 있어요.',
    questions: [
      { question: '어떤 고민을 해결하고 싶으세요?', options: ['수분 부족', '트러블·진정', '탄력·주름', '톤·잡티'], multi: true },
      { question: '피부 타입을 알려주세요.', options: ['건성', '지성', '복합성', '민감성'], multi: false },
      { question: '예산은 어느 정도로 생각하세요?', options: ['3만원 이하', '3~6만원', '6~10만원', '상관없음'], multi: false },
    ],
  }
}

function fallbackPlan(): PlanGen {
  return {
    headline: '기본 스킨케어 플랜을 준비했어요',
    summary: '응답을 바탕으로 한 맞춤 생성이 잠시 어려워, 무난하게 쓰기 좋은 기본 구성을 담았어요.',
    sections: [
      { kind: 'guide', title: '이렇게 시작해 보세요', body: '순한 클렌저와 보습 중심의 기본 루틴부터 잡는 것이 좋아요. 피부가 안정되면 기능성 제품을 하나씩 더해 보세요.' },
      { kind: 'products', title: '기본 추천', reason: '피부 타입을 가리지 않고 무난하게 쓰기 좋은 구성이에요.', productIds: ['p-010', 'p-001', 'p-006'] },
      { kind: 'steps', title: '사용 순서', steps: ['약산성 클렌저로 세안', '토너로 결 정돈', '크림으로 마무리', '아침에는 선크림 필수'] },
    ],
  }
}
