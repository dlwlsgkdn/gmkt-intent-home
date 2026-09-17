import { Injectable, Logger } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  AssistAdminPromptResult,
  AssistPromptFlowResult,
  PromptFlowChange,
  PromptFlowReview,
  PromptFlowScoreParts,
  type AssistPromptFlowBody,
  type AdminModelOption,
  type Answer,
  type AssistAdminPromptBody,
  type LlmMeta,
  type Profile,
  type SurveyPageWire,
} from '@ddak/schema'
import {
  CATALOG_SEED_SYSTEM,
  CatalogSeedGen,
  HOME_PERSONALIZE_SYSTEM,
  HomePersonalizeGen,
  IntentGen,
  LlmGenerationError,
  PROMPT_DEFS,
  PROMPT_VERSION,
  PlanContentsGen,
  PlanProductsGen,
  SEARCH_ROUTE_SYSTEM,
  SEARCH_SUGGEST_SYSTEM,
  SearchRouteGen,
  SearchSuggestGen,
  StructuredStreamParser,
  SurveyGen,
  buildCatalogSeedRequest,
  buildHomePersonalizeRequest,
  buildIntentRequest,
  buildPlanContentsRequest,
  buildPlanProductsRequest,
  buildPlanSkeletonRequest,
  buildSearchRouteRequest,
  buildSearchSuggestRequest,
  buildSurveyRequest,
  hasPhotoAnswer,
  planSkeletonGenFor,
  renderSystemTemplate,
  type CatalogCandidates,
  type ConstraintLedger,
  type GenResult,
  type LlmGenerateRequest,
  type LlmPort,
  type LlmStreamHandlers,
  type PlanRevisionContext,
  type PlanSkeletonGen,
  type PromptDefId,
  type ResolvedSystem,
} from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'
import { KnowledgeService } from './knowledge.service'

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
/** 생성 1회당 웹 검색 상한 — 상품·콘텐츠 확인용 소수 검색만 허용 (비용·지연 가드). 내부 후보가 넉넉하면 webSearchBudget 이 1 줄인다 */
export const WEB_SEARCH_MAX_USES = 4
/** 참고 콘텐츠 단계(5c)의 검색 예산 — 영상 1회 + 게시글 1회 + 보완 2회 (2026-09-17: 3→4. 운영 계획의 44% 가 콘텐츠 0개였고
 * 재현에서 같은 검색어를 되풀이해 예산을 태운 뒤 빈 배열을 돌려줬다 — 프롬프트 v27 이 검색어 중복을 금하고 확인 기준을 낮췄다).
 * dry-run 도 같은 값을 쓴다 */
export const WEB_SEARCH_CONTENTS_MAX_USES = 4
/** 서버 도구 루프가 pause_turn으로 멈췄을 때 이어붙이는 최대 횟수 */
const MAX_CONTINUATIONS = 3
/** 내부 카탈로그 후보가 넉넉할 때의 웹 검색 예산 — 후보가 절반을 채우니 검색은 외부몰·보완 몫만 (v29, 지연 단축).
 * 상품 후보 6개 이상 / 콘텐츠 후보 4개 이상이면 상한을 1 줄인다 (catalog.service RICH_*). 후보가 없으면 예전 예산 그대로 */
const WEB_SEARCH_RICH_REDUCTION = 1
export const RICH_PRODUCT_CANDIDATES = 6
export const RICH_CONTENT_CANDIDATES = 4
export const webSearchBudget = (base: number, rich: boolean) => (rich ? Math.max(2, base - WEB_SEARCH_RICH_REDUCTION) : base)

/** API 오류를 운영자용 한 줄로 — 상태 코드·오류 타입·문구·request-id (SDK 오류는 status 를, 그 밖은 message 만).
 * SDK 의 APIError.error 는 응답 본문 `{ type: 'error', error: { type, message } }` 그대로다 */
function describeLlmFailure(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const body = (e as { error?: { error?: { type?: string; message?: string } } }).error?.error
    const type = body?.type ? ` ${body.type}` : ''
    const requestId = e.requestID ? ` (request-id ${e.requestID})` : ''
    return `HTTP ${e.status ?? '?'}${type}: ${body?.message ?? e.message}${requestId}`
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

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

  constructor(
    private readonly core: CoreClientService,
    private readonly knowledge: KnowledgeService,
  ) {}

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
   * 실패면 코드 기본값. 모델과 같은 30s 캐시. 재정의·기본값 모두 자리표시자 치환
   * (renderSystemTemplate — 지식 4종 {{VOCAB}}/{{RULES}}/{{CRITERIA}}/{{FEWSHOT}} + 옛 재정의 호환 {{CATALOG}})을
   * 거치며, 저장값·지식 KV가 고정인 한 결과도 바이트 고정이라 프롬프트 캐시는 계속 적중한다 */
  async resolveSystem(id: PromptDefId): Promise<ResolvedSystem> {
    const cached = this.promptCache.get(id)
    if (cached && Date.now() - cached.at < MODEL_CACHE_MS) return cached.value
    const def = PROMPT_DEFS.find((d) => d.id === id)
    if (!def) throw new Error(`알 수 없는 프롬프트 id: ${id}`)
    const knowledge = await this.knowledge.systemKnowledge()
    let value: ResolvedSystem = { text: renderSystemTemplate(def.template, knowledge), custom: false }
    try {
      const setting = await this.core.getSetting(promptSettingKey(id))
      const configured = typeof setting?.value === 'string' ? setting.value : null
      if (configured?.trim()) value = { text: renderSystemTemplate(configured, knowledge), custom: true }
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
        // 429·5xx(529 overloaded)·연결 오류는 SDK 가 지수 백오프로 재시도한다 — 기본 2회를 3회로 (필수 단계는 llm/retry.ts 가 한 번 더)
        this.client = new Anthropic({ maxRetries: 3 })
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

  /** 1단계 의도 정규화 — 작고 빠른 구조화 호출 (스트리밍 없음). 실패 처리는 호출자(fail-open) */
  async generateIntent(intent: string): Promise<GenResult<IntentGen>> {
    return this.generate('의도 정규화', IntentGen, {
      system: await this.resolveSystem('intent'),
      effort: 'low' as const,
      user: buildIntentRequest(intent),
    })
  }

  /** 홈 검색창 진입 분기 — 검색어를 DDAK(설문→계획)/SRP 로 가른다. 작고 빠른 구조화 호출(스트리밍 없음).
   * 실패 처리는 호출자(SearchController)가 휴리스틱으로 대신 답한다 */
  async routeSearch(query: string, profile?: Profile): Promise<GenResult<SearchRouteGen>> {
    return this.generate('검색 라우팅', SearchRouteGen, {
      system: { text: SEARCH_ROUTE_SYSTEM, custom: false },
      effort: 'low' as const,
      user: buildSearchRouteRequest(query, profile),
    })
  }

  /** 홈 검색창 AI 검색어 추천 — 입력 중인 검색어에 상황·피부·계절을 덧붙인 자연어 검색어 3개 */
  async suggestSearch(query: string, profile?: Profile): Promise<GenResult<SearchSuggestGen>> {
    return this.generate('검색어 추천', SearchSuggestGen, {
      system: { text: SEARCH_SUGGEST_SYSTEM, custom: false },
      effort: 'low' as const,
      user: buildSearchSuggestRequest(query, profile),
    })
  }
  /** 내재화 카탈로그 시딩 — 제품 유형 하나의 판매 상품을 웹 검색(2~3회)으로 모은다 (2026-09-17). 운영 콘솔 배치가 유형마다 1회 부른다.
   * 실패는 호출자가 그 유형만 건너뛰고 다음으로 간다 */
  async collectCatalogProducts(keyword: string, opts: { query?: string; dense?: boolean } = {}): Promise<GenResult<CatalogSeedGen>> {
    return this.generate(`카탈로그 수집(${opts.query && opts.query !== keyword ? opts.query : keyword})`, CatalogSeedGen, {
      system: { text: CATALOG_SEED_SYSTEM, custom: false },
      effort: 'medium' as const,
      user: buildCatalogSeedRequest(keyword, opts),
      webSearch: true,
      webSearchMaxUses: opts.dense ? 4 : 3,
    })
  }

  /** 홈 개인화 — 인사말 + 개인화 추천 검색어(보라 칩). 작고 빠른 구조화 호출(스트리밍 없음). 실패 처리는 호출자(휴리스틱 대체) */
  async personalizeHome(input: Parameters<typeof buildHomePersonalizeRequest>[0]): Promise<GenResult<HomePersonalizeGen>> {
    return this.generate('홈 개인화', HomePersonalizeGen, {
      system: { text: HOME_PERSONALIZE_SYSTEM, custom: false },
      effort: 'low' as const,
      user: buildHomePersonalizeRequest(input),
    })
  }

  /** 운영자의 자연어 요청 → 검토 가능한 시스템 프롬프트 수정안.
   * 저장과 완전히 분리되어 있고, 현재 템플릿의 {{PLACEHOLDER}} 집합은 서버가 재검증한다. */
  async assistPromptRevision(input: AssistAdminPromptBody, promptContext?: string): Promise<AssistAdminPromptResult> {
    const system = [
      '너는 운영 중인 AI 서비스의 시스템 프롬프트 편집자다.',
      '입력 JSON의 instruction만 반영해 currentText를 필요한 만큼만 수정한다.',
      'proposedText에는 설명이나 코드 펜스 없이 수정된 시스템 프롬프트 전체 원문을 넣는다.',
      'currentText의 {{PLACEHOLDER}} 토큰은 철자, 개수, 중괄호를 포함해 모두 그대로 보존한다.',
      '기존 출력 계약, 사실 필드, 안전 규칙은 instruction이 명시적으로 요구하지 않는 한 바꾸지 않는다.',
      'instruction이 기존 규칙과 충돌하거나 영향 범위가 넓으면 warnings에 짧게 알린다.',
      'summary는 운영 변경 기록에 쓸 수 있도록 한국어 한 문장으로 작성한다.',
    ].join('\n')
    const placeholders = (text: string) => [...text.matchAll(/\{\{[^{}\r\n]+\}\}/g)].map((match) => match[0]).sort()
    const before = placeholders(input.currentText)

    const generateProposal = async () => {
      const result = await this.generate('지시서 수정안 생성', AssistAdminPromptResult, {
        system: { text: system, custom: false },
        effort: 'low',
        user: JSON.stringify({ ...input, promptContext }),
      })
      const after = placeholders(result.content.proposedText)
      if (before.length !== after.length || before.some((token, index) => token !== after[index])) {
        this.logger.warn('지시서 수정안 자리표시자 검증 실패')
        throw new LlmGenerationError(
          'llm_failed',
          'AI 수정안이 필수 데이터 자리를 보존하지 못했어요. 요청을 조금 더 구체적으로 바꿔 다시 시도해 주세요.',
          true,
        )
      }
      return result.content
    }

    try {
      return await generateProposal()
    } catch (error) {
      if (!(error instanceof LlmGenerationError) || !error.retryable) throw error
      this.logger.warn(`지시서 수정안 첫 시도 실패 — 자동 재시도: ${error.code}`)
      return generateProposal()
    }
  }

  async assistFlowRevision(input: AssistPromptFlowBody): Promise<AssistPromptFlowResult> {
    const system = [
      '너는 고객 여정 전체의 지시서 조정자다. 쉬운 자연어 요청 하나를 설문 → 계획 안내·상품 검색 전체에 일관되게 반영한다.',
      'instruction의 핵심 목적을 먼저 해석하고 prompts 세 원문을 함께 읽어 필요한 지시서만 changes에 담는다. 무관한 지시서는 바꾸지 않는다.',
      'focus는 특히 신경 쓸 부분이며 수정 범위 제한이 아니다. 비어 있으면 스스로 관련 부분을 판단한다. 다른 부분도 필요하면 바꾸고 reason으로 연결 이유를 설명한다.',
      '예: 실전 팁을 원하면 설문은 실제로 막히는 상황과 가진 도구를 확인하고, 계획은 상황·행동·확인·실패 보정을 설명하며, 상품은 그 행동에 필요한 제품과 사용법 근거를 찾도록 역할을 나눈다. 모든 요청에 이 예시를 강제로 적용하지 않는다.',
      '현재 실행 구조: 설문 응답 뒤 계획 안내와 상품·콘텐츠 검색이 병렬 실행된다. 안내는 검색 결과를 읽지 못한다. 실행 순서 변경, 영상 시청·외부 자료 분석, 자동 학습을 프롬프트만으로 구현했다고 약속하지 않는다. 이런 요청은 가능한 문구 개선과 구분해 warnings에 쉬운 한국어로 알린다.',
      '각 변경은 id, proposedText(수정된 전체 원문), reason(사용자에게 설명할 이유)를 담는다. id는 입력 목록에서만 고르고 중복시키지 않는다.',
      '각 원문의 {{PLACEHOLDER}}는 철자와 개수를 모두 보존한다. 출력 스키마·사실 검증·허용 상품 규칙은 유지한다. 구체적 팁을 위해 경험·수치·출처를 지어내지 않는다.',
      '새 지시와 충돌하는 기존 문장을 함께 고친다. 규칙을 맨 끝에 덧붙여 모순을 남기지 않는다.',
      'summary는 무엇이 바뀌는지 60자 이내 한 문장으로, reason은 항목별 90자 이내 한 문장으로 쓴다. 초등학생도 읽게 전문 용어 대신 일상어를 쓴다. 예: 원장·가변부·그라운딩 대신 고객 정보·답변·확인한 근거. 실제 변경이 필요 없으면 changes를 비우고 이유를 summary에 쓴다.',
      'previousChanges가 있으면 직전 수정안에서 시작해 refinements를 순서대로 반영한다. 최신 추가 요청을 우선하고 이전에 합의한 개선은 유지한다. 결과 changes는 원래 prompts와 비교한 최종 전체 변경 목록이다. 직전 수정안의 변경을 누락시키지 않는다.',
      'review는 이번 수정안 자체를 비판적으로 점검한 결과다. good은 기대되는 좋은 점, bad는 아직 부족한 점, risks는 적용할 때 생길 수 있는 문제와 확인 방법이다. 각 배열에는 가장 중요한 내용 하나만, 55자 이내 한 문장으로 적는다. 실제 수정 문구에 근거해 적는다. 빈 칭찬·추상적 경고·전문 용어는 쓰지 않는다.',
      'scoreParts는 수정안의 완성도를 요청 반영(request, 0~40), 쉬운 설명(clarity, 0~30), 앞뒤 일관성(consistency, 0~30)으로 평가한다. 관성적으로 높은 점수를 주지 않는다. 감점 이유를 bad나 risks에 짧게 쓴다. 요청한 일을 구현할 수 없거나 규칙이 충돌하면 해당 항목에서 감점한다. 이는 수정안 평가이며 실제 고객 결과의 품질·정확도·성공 확률 점수가 아니다.',
      '실제 고객 화면과 사용 효과를 평가한 것처럼 쓰지 않는다. 확인할 수 없는 효과는 예상임을 밝힌다. 부족한 점이나 위험을 못 찾으면 해당 배열을 비우며 억지로 만들어내지 않는다. warnings는 실행 구조상 불가능한 요청에만 쓰고 review와 중복시키지 않는다.',
    ].join('\n')
    const before = new Map(input.prompts.map((prompt) => [prompt.id, prompt.text]))
    const placeholders = (text: string) => [...text.matchAll(/\{\{[^{}\r\n]+\}\}/g)].map((match) => match[0]).sort().join('\n')
    const { content } = await this.generate('전체 지시서 수정안 생성', AssistPromptFlowResult.extend({
      summary: z.string().trim().min(1).max(60),
      review: PromptFlowReview.omit({ score: true }).extend({
        scoreParts: PromptFlowScoreParts,
        good: z.array(z.string().trim().min(1).max(55)).max(1),
        bad: z.array(z.string().trim().min(1).max(55)).max(1),
        risks: z.array(z.string().trim().min(1).max(55)).max(1),
      }),
      changes: z.array(PromptFlowChange.omit({ baseText: true }).extend({ reason: z.string().trim().min(1).max(90) })).max(3),
    }), {
      system: { text: system, custom: false }, effort: 'medium', user: JSON.stringify(input),
    })
    const seen = new Set<string>()
    for (const change of content.changes) {
      const original = before.get(change.id)
      if (!original || seen.has(change.id) || placeholders(original) !== placeholders(change.proposedText)) {
        throw new LlmGenerationError('llm_failed', '수정안이 원래 지시서의 필수 정보를 유지하지 못했어요. 다시 만들어 주세요.', true)
      }
      seen.add(change.id)
    }
    return { ...content, review: { ...content.review, score: Object.values(content.review.scoreParts).reduce((total, value) => total + value, 0) }, changes: content.changes.filter((change) => before.get(change.id) !== change.proposedText).map((change) => ({ ...change, baseText: before.get(change.id)! })) }
  }

  async generateSurvey(
    intent: string,
    profile?: Profile,
    stream?: LlmStreamHandlers,
    ledger?: ConstraintLedger | null,
  ): Promise<GenResult<SurveyGen>> {
    return this.generate('설문 생성', SurveyGen, {
      system: await this.resolveSystem('survey'),
      // low인 이유: Opus 5는 thinking을 빼면 적응형 사고가 기본으로 켜져 첫 토큰 전
      // 사고 구간이 effort에 비례해 길어진다(4.8까지는 생략 = 사고 없음). 질문 5개
      // 생성은 low로 충분하고, 사고를 끄는 것보다 effort를 낮추는 쪽이 안전하다
      effort: 'low' as const,
      user: buildSurveyRequest(intent, profile, ledger),
      stream,
    })
  }

  /** 계획 1단계 — 뼈대 (검색 없음·medium): 제목·요약·단계 안내·순서 + 상품/콘텐츠 자리. 수 초 안에 스트리밍된다.
   * revision이 있으면 피드백 반영 재생성 — 직전 계획+피드백이 사용자 메시지에 실린다.
   * 출력 스키마는 사진 답변 여부로 look 갈래 | compare·caution 갈래 중 하나만 싣는다(@ddak/pipeline planSkeletonGenFor —
   * 전부 한 합집합에 실으면 구조화 출력 문법이 커져 API 가 400 으로 거절한다, 2026-09-17) */
  async generatePlanSkeleton(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
    stream?: LlmStreamHandlers,
    revision?: PlanRevisionContext,
    ledger?: ConstraintLedger | null,
  ): Promise<GenResult<PlanSkeletonGen>> {
    return this.generate('계획 뼈대 생성', planSkeletonGenFor({ photo: hasPhotoAnswer(survey, answers) }), {
      system: await this.resolveSystem('plan-skeleton'),
      effort: 'medium' as const, // 속도가 목적 — 텍스트 뼈대는 medium으로 충분
      user: buildPlanSkeletonRequest(intent, survey, answers, profile, revision, ledger),
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
    ledger?: ConstraintLedger | null,
    /** 내부 카탈로그 후보 (v29) — 가변부 표로 실린다. 후보가 넉넉하면 웹 검색 예산을 4→3 으로 줄인다(지연 단축) */
    candidates?: CatalogCandidates | null,
  ): Promise<GenResult<PlanProductsGen>> {
    return this.generate('계획 상품 생성', PlanProductsGen, {
      system: await this.resolveSystem('plan-products'),
      effort: 'high' as const,
      user: buildPlanProductsRequest(intent, survey, answers, profile, revision, ledger, candidates),
      webSearch: true,
      webSearchMaxUses: webSearchBudget(WEB_SEARCH_MAX_USES, (candidates?.products.length ?? 0) >= RICH_PRODUCT_CANDIDATES),
      stream,
    })
  }

  /** 계획 5c — 참고 콘텐츠 (검색 포함·medium): 웹 게시글·영상 섹션 1~2개. 상품 단계와 분리된 검색 예산(3회)으로 병렬로 돈다
   * (2026-09 — 한 호출에 몰아 두면 상품 검색이 예산을 다 써 콘텐츠가 굶었다). 실패는 호출자가 콘텐츠 없이 진행한다 */
  async generatePlanContents(
    intent: string,
    survey: SurveyPageWire,
    answers: Answer[],
    profile?: Profile,
    stream?: LlmStreamHandlers,
    revision?: PlanRevisionContext,
    ledger?: ConstraintLedger | null,
    /** retry = 첫 호출이 콘텐츠를 못 찾아 검색어를 바꿔 다시 부르는 2회차 (가변부에 CONTENTS_RETRY_HINT — 시스템 고정·캐시 유지) */
    opts: { retry?: boolean } = {},
    /** 내부 콘텐츠 후보 (v29) — 가변부 표로 실린다. 후보가 넉넉하면 웹 검색 예산을 4→3 으로 줄인다 */
    candidates?: CatalogCandidates | null,
  ): Promise<GenResult<PlanContentsGen>> {
    return this.generate(opts.retry ? '계획 참고 콘텐츠 생성(재시도)' : '계획 참고 콘텐츠 생성', PlanContentsGen, {
      system: await this.resolveSystem('plan-contents'),
      effort: 'medium' as const,
      user: buildPlanContentsRequest(intent, survey, answers, profile, revision, ledger, opts, candidates),
      webSearch: true,
      webSearchMaxUses: webSearchBudget(WEB_SEARCH_CONTENTS_MAX_USES, (candidates?.contents.length ?? 0) >= RICH_CONTENT_CANDIDATES),
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
    const maxUses = req.webSearchMaxUses ?? WEB_SEARCH_MAX_USES
    const webSearchTool = WEB_SEARCH_BASIC_MODELS.has(model)
      ? { type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: maxUses }
      : { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: maxUses }
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
      // 원인은 운영자용 detail 로 따로 싣는다 — 사용자 안내는 그대로, 관리 dry-run·flow-run 오류 이벤트가 보여 준다
      const detail = describeLlmFailure(e)
      this.logger.warn(`${label} 호출 실패: ${detail}`)
      throw new LlmGenerationError(
        'llm_failed',
        `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        true,
        { detail, cause: e },
      )
    }
    if (response.stop_reason === 'refusal') {
      this.logger.warn(`${label} 거절 — category=${response.stop_details?.category ?? 'null'}`)
      throw new LlmGenerationError('llm_refused', '이 요청은 처리할 수 없어요. 다른 검색어로 시도해 주세요.', false)
    }
    const parsed = this.parseOutput(schema, response)
    if (!parsed.content) {
      const detail = `결과 파싱 실패 — stop_reason=${response.stop_reason}${parsed.issue ? `: ${parsed.issue}` : ''}`
      this.logger.warn(`${label} ${detail}`)
      throw new LlmGenerationError(
        'llm_failed',
        `일시적인 문제로 ${label}에 실패했어요. 잠시 후 다시 시도해 주세요.`,
        true,
        { detail },
      )
    }
    const content = parsed.content
    return { content, meta: this.meta(started, response, req.system.custom) }
  }

  /** 구조화 출력 텍스트 → 스키마 검증. JSON은 보통 마지막 텍스트 블록이지만,
   * 도구 사용으로 블록이 쪼개진 경우를 대비해 전체 연결로 한 번 더 시도한다.
   * 실패하면 마지막 후보의 사유(JSON 오류 또는 첫 zod 이슈 경로)를 진단용으로 돌려준다 */
  private parseOutput<S extends z.ZodTypeAny>(
    schema: S,
    response: Anthropic.Message,
  ): { content: S['_output'] | null; issue?: string } {
    const texts = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
    let issue: string | undefined
    for (const candidate of [texts[texts.length - 1], texts.join('')]) {
      if (!candidate) continue
      let json: unknown
      try {
        json = JSON.parse(candidate)
      } catch (e) {
        issue = `JSON 아님(${(e as Error).message})`
        continue
      }
      const result = schema.safeParse(json)
      if (result.success) return { content: result.data as S['_output'] }
      const first = result.error.issues[0]
      issue = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : result.error.message
    }
    return { content: null, issue: issue ?? (texts.length ? undefined : '텍스트 블록 없음') }
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
