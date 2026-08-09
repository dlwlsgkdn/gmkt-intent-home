import { Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import type { AdminModelOption, Answer, LlmMeta, Profile, SurveyPageWire } from '@ddak/schema'
import {
  LlmGenerationError,
  PROMPT_DEFS,
  PROMPT_VERSION,
  PlanProductsGen,
  PlanSkeletonGen,
  StructuredStreamParser,
  SurveyGen,
  buildPlanProductsRequest,
  buildPlanSkeletonRequest,
  buildSurveyRequest,
  renderSystemTemplate,
  type GenResult,
  type LlmGenerateRequest,
  type LlmPort,
  type LlmStreamHandlers,
  type PlanRevisionContext,
  type PromptDefId,
  type ResolvedSystem,
} from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'

export const DEFAULT_MODEL = 'claude-opus-5'

/** 관리 페이지에서 고를 수 있는 모델 카탈로그 — 여기 있는 id만 설정으로 저장을 허용한다.
 * supportsEffort=false(haiku)는 output_config.effort를 빼고 호출한다 (넣으면 400) */
export const MODEL_OPTIONS: AdminModelOption[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: '기본값 — 품질 우선 ($5/$25 per MTok)', supportsEffort: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: '속도·비용 균형 ($3/$15)', supportsEffort: true },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: '이전 세대 Opus ($5/$25)', supportsEffort: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: '최저 비용 ($1/$5) — effort 미지원', supportsEffort: false },
]

/** 런타임 모델 설정이 저장되는 core 설정 키 */
export const LLM_MODEL_SETTING_KEY = 'llm-model'
/** 시스템 프롬프트 재정의가 저장되는 core 설정 키 (id는 PROMPT_DEFS 카탈로그) */
export const promptSettingKey = (id: PromptDefId) => `llm-prompt-${id}`
/** 설정 조회 캐시 TTL — 관리 페이지 변경이 새 생성에 반영되는 최대 지연 */
const MODEL_CACHE_MS = 30_000

/** 동적 필터링 web_search_20260209 미지원 모델 — 기본 변형(20250305)으로 호출한다 */
const WEB_SEARCH_BASIC_MODELS = new Set(['claude-haiku-4-5'])
/** 생성 1회당 웹 검색 상한 — 상품·콘텐츠 확인용 소수 검색만 허용 (비용·지연 가드) */
const WEB_SEARCH_MAX_USES = 4
/** 서버 도구 루프가 pause_turn으로 멈췄을 때 이어붙이는 최대 횟수 */
const MAX_CONTINUATIONS = 3

/*
 * Claude 호출 계층 — LlmPort의 1차(Anthropic) 구현. 구조화 출력(parse) + 프롬프트 캐싱 + refusal 처리.
 * 계약 타입(GenResult·LlmStreamHandlers·LlmGenerationError)은 @ddak/pipeline llm-port가 소유한다.
 * 실패 정책은 "실패 안내"다: 가짜 맞춤 콘텐츠(폴백 템플릿)를 지어내지 않고
 * LlmGenerationError를 던져 FE가 사용자에게 상태를 정직하게 보여주게 한다.
 * (캐시 재서빙·스튜디오 시나리오 폴백 등 강등 사다리는 인프라 마련 후 백로그 —
 *  DESIGN-LLM-SERVICE.md §4-2 참고. 일시 장애 재시도는 SDK 기본 2회에 맡긴다)
 */
@Injectable()
export class LlmService implements LlmPort {
  private readonly logger = new Logger(LlmService.name)
  private client: Anthropic | null | undefined
  private modelCache: { value: string; at: number } | null = null
  private promptCache = new Map<PromptDefId, { value: ResolvedSystem; at: number }>()

  constructor(private readonly core: CoreClientService) {}

  /** 지금 생성에 쓸 모델 — core 설정(llm-model) 우선, 없거나 조회 실패면 기본값.
   * 짧은 캐시(30s)로 생성 1회당 core 왕복을 줄인다. 카탈로그 밖 값은 무시한다 */
  async resolveModel(): Promise<string> {
    if (this.modelCache && Date.now() - this.modelCache.at < MODEL_CACHE_MS) return this.modelCache.value
    let value = DEFAULT_MODEL
    try {
      const setting = await this.core.getSetting(LLM_MODEL_SETTING_KEY)
      const configured = typeof setting?.value === 'string' ? setting.value : null
      if (configured && MODEL_OPTIONS.some((option) => option.id === configured)) value = configured
      else if (configured) this.logger.warn(`설정된 모델이 카탈로그에 없어 기본값 사용: ${configured}`)
    } catch (e) {
      this.logger.warn(`모델 설정 조회 실패 — 기본값 사용: ${(e as Error).message}`)
    }
    this.modelCache = { value, at: Date.now() }
    return value
  }

  /** 관리 페이지가 모델을 바꾼 직후 캐시를 비워 즉시 반영한다 (같은 인스턴스 한정 — 다른 인스턴스는 TTL로 따라온다) */
  invalidateModelCache() {
    this.modelCache = null
  }

  /** 지금 생성에 쓸 시스템 프롬프트 — core 설정(llm-prompt-<id>) 재정의 우선, 없거나 조회
   * 실패면 코드 기본값. 모델과 같은 30s 캐시. 재정의도 자리표시자 치환(renderSystemTemplate)을
   * 거치며, 저장값이 고정인 한 결과도 바이트 고정이라 프롬프트 캐시는 계속 적중한다 */
  async resolveSystem(id: PromptDefId): Promise<ResolvedSystem> {
    const cached = this.promptCache.get(id)
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.value
    const def = PROMPT_DEFS.find((d) => d.id === id)
    if (!def) throw new Error(`알 수 없는 프롬프트 id: ${id}`)
    let value: ResolvedSystem = { text: renderSystemTemplate(def.template), custom: false }
    try {
      const setting = await this.core.getSetting(promptSettingKey(id))
      const configured = typeof setting?.value === 'string' ? setting.value : null
      if (configured?.trim()) value = { text: renderSystemTemplate(configured), custom: true }
    } catch (e) {
      this.logger.warn(`프롬프트 설정 조회 실패(${id}) — 기본값 사용: ${(e as Error).message}`)
    }
    this.promptCache.set(id, { value, at: Date.now() })
    return value
  }

  /** 관리 페이지가 프롬프트를 바꾼 직후 캐시를 비워 즉시 반영한다 (모델 캐시와 같은 규칙) */
  invalidatePromptCache() {
    this.promptCache.clear()
  }

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

  async generateSurvey(intent: string, profile?: Profile, stream?: LlmStreamHandlers): Promise<GenResult<SurveyGen>> {
    return this.generate('설문 생성', SurveyGen, {
      system: await this.resolveSystem('survey'),
      // low인 이유: Opus 5는 thinking을 빼면 적응형 사고가 기본으로 켜져 첫 토큰 전
      // 사고 구간이 effort에 비례해 길어진다(4.8까지는 생략 = 사고 없음). 질문 5개
      // 생성은 low로 충분하고, 사고를 끄는 것보다 effort를 낮추는 쪽이 안전하다
      effort: 'low' as const,
      user: buildSurveyRequest(intent, profile),
      stream,
    })
  }

  /** 계획 1단계 — 뼈대 (검색 없음·medium): 제목·요약·단계 안내·순서 + 상품/콘텐츠 자리. 수 초 안에 스트리밍된다.
   * revision이 있으면 피드백 반영 재생성 — 직전 계획+피드백이 사용자 메시지에 실린다 */
  async generatePlanSkeleton(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
    stream?: LlmStreamHandlers,
    revision?: PlanRevisionContext,
  ): Promise<GenResult<PlanSkeletonGen>> {
    return this.generate('계획 뼈대 생성', PlanSkeletonGen, {
      system: await this.resolveSystem('plan-skeleton'),
      effort: 'medium' as const, // 속도가 목적 — 텍스트 뼈대는 medium으로 충분
      user: buildPlanSkeletonRequest(intent, survey, answers, profile, revision),
      stream,
    })
  }

  /** 계획 2단계 — 검색 (검색 포함·high): 카탈로그+웹 그라운딩 상품 섹션 + 참고 콘텐츠 섹션. 뼈대와 병렬로 돈다 (§4-3·§9-1).
   * revision이 있으면 지적된 상품을 빼고 웹 검색으로 대안을 찾는 재생성이 된다 */
  async generatePlanProducts(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
    stream?: LlmStreamHandlers,
    revision?: PlanRevisionContext,
  ): Promise<GenResult<PlanProductsGen>> {
    return this.generate('계획 상품 생성', PlanProductsGen, {
      system: await this.resolveSystem('plan-products'),
      effort: 'high' as const,
      user: buildPlanProductsRequest(intent, survey, answers, profile, revision),
      webSearch: true,
      stream,
    })
  }

  async generate<S extends z.ZodTypeAny>(
    label: string,
    schema: S,
    req: LlmGenerateRequest,
  ): Promise<GenResult<S['_output']>> {
    const client = this.requireClient()
    const model = await this.resolveModel()
    // effort 미지원 모델(haiku)은 effort를 빼고 호출한다 — 넣으면 400
    const supportsEffort = MODEL_OPTIONS.find((option) => option.id === model)?.supportsEffort !== false
    // 웹 검색은 서버 도구 — 선언만 하면 검색·결과 소비를 API가 서버 쪽 루프로 처리한다.
    // 구세대 모델(haiku)은 동적 필터링 변형(20260209)을 지원하지 않아 기본 변형으로 선언한다
    const webSearchTool = WEB_SEARCH_BASIC_MODELS.has(model)
      ? { type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: WEB_SEARCH_MAX_USES }
      : { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: WEB_SEARCH_MAX_USES }
    // 컴포넌트 경계 파서 — pause_turn 연속 호출에 걸쳐 같은 인스턴스에 델타를 누적한다.
    // 스트리밍은 미리보기일 뿐, 권위는 아래의 전체 파싱·검증(parseOutput)이다
    const parser = req.stream
      ? new StructuredStreamParser({
          arrayKey: req.stream.arrayKey,
          headKeys: req.stream.headKeys,
          onHead: req.stream.onHead,
          onElement: req.stream.onElement,
          onHeadPartial: req.stream.onHeadPartial,
          onElementPartial: req.stream.onElementPartial,
        })
      : null
    const started = Date.now()
    let response: Anthropic.Message
    try {
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }]
      const call = () => {
        const stream = client.messages.stream({
          model,
          max_tokens: 16000,
          system: [{ type: 'text', text: req.system.text, cache_control: { type: 'ephemeral', ttl: '1h' } }],
          output_config: supportsEffort
            ? { effort: req.effort, format: zodOutputFormat(schema) }
            : { format: zodOutputFormat(schema) },
          ...(req.webSearch ? { tools: [webSearchTool] } : {}),
          messages,
        })
        if (parser) stream.on('text', (delta) => parser.push(delta))
        if (req.stream?.onSearch) {
          stream.on('contentBlock', (block) => {
            if (block.type === 'server_tool_use' && block.name === 'web_search') {
              const query = (block.input as { query?: string } | null)?.query
              if (query) req.stream?.onSearch?.(query)
            }
          })
        }
        return stream.finalMessage()
      }
      response = await call()
      // 서버 도구 루프가 반복 상한에 걸리면 pause_turn으로 멈춘다 — 어시스턴트 턴을
      // 그대로 이어붙여 재요청하면 서버가 이어서 진행한다 (추가 사용자 메시지 금지)
      for (let i = 0; i < MAX_CONTINUATIONS && response.stop_reason === 'pause_turn'; i++) {
        this.logger.log(`${label} pause_turn — 이어서 진행 (${i + 1}/${MAX_CONTINUATIONS})`)
        messages.push({ role: 'assistant', content: response.content })
        response = await call()
      }
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
    const content = this.parseOutput(schema, response)
    if (!content) {
      this.logger.warn(`${label} 결과 파싱 실패 — stop_reason=${response.stop_reason}`)
      throw new LlmGenerationError(
        'llm_failed',
        `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        true,
      )
    }
    return { content, meta: this.meta(started, response, req.system.custom) }
  }

  /** 구조화 출력 텍스트 → 스키마 검증. JSON은 보통 마지막 텍스트 블록이지만,
   * 도구 사용으로 블록이 쪼개진 경우를 대비해 전체 연결로 한 번 더 시도한다 */
  private parseOutput<S extends z.ZodTypeAny>(
    schema: S,
    response: Anthropic.Message,
  ): S['_output'] | null {
    const texts = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
    for (const candidate of [texts[texts.length - 1], texts.join('')]) {
      if (!candidate) continue
      try {
        return schema.parse(JSON.parse(candidate)) as S['_output']
      } catch {
        /* 다음 후보 */
      }
    }
    return null
  }

  private meta(started: number, response: Anthropic.Message, customPrompt: boolean): LlmMeta {
    const webSearchRequests = response.usage.server_tool_use?.web_search_requests
    return {
      model: response.model,
      // 재정의 프롬프트로 생성된 스텝은 promptVersion에 흔적을 남긴다 — 관리 페이지 대조용
      promptVersion: customPrompt ? `${PROMPT_VERSION}+custom` : PROMPT_VERSION,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
        webSearchRequests: webSearchRequests || undefined,
      },
      latencyMs: Date.now() - started,
    }
  }
}
