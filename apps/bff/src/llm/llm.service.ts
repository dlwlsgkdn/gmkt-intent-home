import { Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Answer, LlmMeta, Profile, SurveyPageWire } from '@ddak/schema'
import { PlanGen, SurveyGen } from './gen-schemas'
import { PLAN_SYSTEM, PROMPT_VERSION, SURVEY_SYSTEM, buildPlanRequest, buildSurveyRequest } from './prompts'

const MODEL = 'claude-opus-5'

export type GenResult<T> = { content: T; meta: LlmMeta }

/** LLM 생성 실패 — 컨트롤러가 SSE error 이벤트(실패 안내)로 변환한다 */
export class LlmGenerationError extends Error {
  constructor(
    readonly code: 'llm_not_configured' | 'llm_refused' | 'llm_failed',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
  }
}

/*
 * Claude 호출 계층 — 구조화 출력(parse) + 프롬프트 캐싱 + refusal 처리.
 * 실패 정책은 "실패 안내"다: 가짜 맞춤 콘텐츠(폴백 템플릿)를 지어내지 않고
 * LlmGenerationError를 던져 FE가 사용자에게 상태를 정직하게 보여주게 한다.
 * (캐시 재서빙·스튜디오 시나리오 폴백 등 강등 사다리는 인프라 마련 후 백로그 —
 *  DESIGN-LLM-SERVICE.md §4-2 참고. 일시 장애 재시도는 SDK 기본 2회에 맡긴다)
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name)
  private client: Anthropic | null | undefined

  private requireClient(): Anthropic {
    if (this.client === undefined) {
      try {
        this.client = new Anthropic()
      } catch {
        this.client = null
      }
    }
    if (!this.client) {
      throw new LlmGenerationError(
        'llm_not_configured',
        'AI 생성이 아직 준비되지 않았어요. 잠시 후 다시 찾아주세요.',
        false,
      )
    }
    return this.client
  }

  async generateSurvey(intent: string, profile?: Profile): Promise<GenResult<SurveyGen>> {
    return this.generate('설문 생성', SurveyGen, {
      system: SURVEY_SYSTEM,
      effort: 'medium' as const,
      user: buildSurveyRequest(intent, profile),
    })
  }

  async generatePlan(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
  ): Promise<GenResult<PlanGen>> {
    return this.generate('계획 생성', PlanGen, {
      system: PLAN_SYSTEM,
      effort: 'high' as const,
      user: buildPlanRequest(intent, survey, answers, profile),
    })
  }

  private async generate<S extends typeof SurveyGen | typeof PlanGen>(
    label: string,
    schema: S,
    req: { system: string; effort: 'medium' | 'high'; user: string },
  ): Promise<GenResult<S['_output']>> {
    const client = this.requireClient()
    const started = Date.now()
    let response: Awaited<ReturnType<typeof client.messages.parse>>
    try {
      response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
        output_config: { effort: req.effort, format: zodOutputFormat(schema) },
        messages: [{ role: 'user', content: req.user }],
      })
    } catch (e) {
      // 인증 실패 = 키 미설정/무효. SDK는 자격증명 부재를 호출 시점에 일반 AnthropicError
      // ("Could not resolve authentication method")로 던지므로 그 경우까지 함께 매핑한다
      if (
        e instanceof Anthropic.AuthenticationError ||
        (e instanceof Error && e.message.includes('Could not resolve authentication method'))
      ) {
        this.logger.warn(`${label} 인증 실패 — ANTHROPIC_API_KEY 확인 필요`)
        throw new LlmGenerationError(
          'llm_not_configured',
          'AI 생성이 아직 준비되지 않았어요. 잠시 후 다시 찾아주세요.',
          false,
        )
      }
      this.logger.warn(`${label} 호출 실패: ${(e as Error).message}`)
      throw new LlmGenerationError(
        'llm_failed',
        `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        true,
      )
    }
    if (response.stop_reason === 'refusal') {
      this.logger.warn(`${label} 거절 — category=${response.stop_details?.category ?? 'null'}`)
      throw new LlmGenerationError('llm_refused', '이 요청은 처리할 수 없어요. 다른 검색어로 시도해 주세요.', false)
    }
    if (!response.parsed_output) {
      this.logger.warn(`${label} 결과 파싱 실패 — stop_reason=${response.stop_reason}`)
      throw new LlmGenerationError(
        'llm_failed',
        `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        true,
      )
    }
    return { content: response.parsed_output as S['_output'], meta: this.meta(started, response) }
  }

  private meta(started: number, response: Anthropic.Message): LlmMeta {
    return {
      model: response.model,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      },
      latencyMs: Date.now() - started,
    }
  }
}
