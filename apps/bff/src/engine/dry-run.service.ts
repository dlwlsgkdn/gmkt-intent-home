import { BadRequestException, Injectable } from '@nestjs/common'
import type { AdminDryRunBody, LlmMeta, PlanSectionWire, SurveyPageWire } from '@ddak/schema'
import {
  PlanProductsGen,
  PlanSkeletonGen,
  STAGE_BY_ID,
  SurveyGen,
  assembleLedger,
  buildPlanProductsRequest,
  buildPlanSkeletonRequest,
  buildSurveyRequest,
  groundContentsSection,
  groundProductsSection,
  renderSystemTemplate,
  type ConstraintLedger,
  type GroundingDrop,
  type GuardContext,
  type LlmEffort,
  type PromptDefId,
  type ResolvedSystem,
} from '@ddak/pipeline'
import { KnowledgeService } from '../llm/knowledge.service'
import { LlmService } from '../llm/llm.service'

/*
 * 파이프라인 플레이그라운드 dry-run (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4) — LLM 단계 하나를
 * 그래프·쓰레드·core 기록 없이 단독 실행한다. "노드는 얇은 어댑터, 로직은 순수 함수" 원칙의
 * 수혜자: 그래프 노드가 소비하는 것과 같은 빌더·스키마·가드를 그대로 부른다.
 * promptOverride가 있으면 저장하지 않은 임시 프롬프트로 실행(what-if) — 자리표시자 치환 동일.
 * 지식 KV(어휘·트렌드 키워드·블록리스트)는 실제 값으로 주입돼 운영과 같은 조건으로 실행된다
 * (직전 쓰레드 피드백만 제외 — 플레이그라운드에는 사용자 문맥이 없다).
 */

export type DryRunEvents = { onStatus?: (message: string) => void }

/** 이 실행에 실제로 들어간 프롬프트 — 자리표시자 치환이 끝난 시스템 전문 + user 가변부 원문.
 * 운영 콘솔 "이번 실행" 투명성 패널의 원천 (평가 실행 저장(createEvalRun)은 이 필드를 싣지 않는다) */
export type DryRunPromptTrace = {
  promptId: PromptDefId
  system: string
  /** 재정의/임시 프롬프트였는가 (meta.promptVersion `+custom`과 같은 판정) */
  custom: boolean
  user: string
}

export type DryRunResult = {
  stageId: AdminDryRunBody['stageId']
  /** 이 실행이 쓴 제약 원장 (프로필·답변·트렌드 키워드 반영) */
  ledger: ConstraintLedger
  /** 재정의/임시 프롬프트로 실행됐는가 */
  promptCustom: boolean
  /** 실제 사용 프롬프트 (시스템 전문·가변부) */
  prompt: DryRunPromptTrace
  meta: LlmMeta
  /** stageId=survey — 질문 id 부여 규칙은 실제 생성과 동일(q{i+1}) */
  survey?: SurveyPageWire
  /** stageId=plan-skeleton — LLM 원본 (자리 포함) */
  skeleton?: PlanSkeletonGen
  /** stageId=plan-products — 검증 게이트 통과분 (6단계까지 적용된 wire 섹션) */
  sections?: PlanSectionWire[]
  /** stageId=plan-products — 드롭 사유 (검증 게이트 품질 로그) */
  dropLog?: GroundingDrop[]
}

@Injectable()
export class PipelineDryRunService {
  constructor(
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
  ) {}

  private async systemFor(promptId: PromptDefId, override?: string): Promise<ResolvedSystem> {
    if (override?.trim()) {
      return { text: renderSystemTemplate(override, await this.knowledge.systemKnowledge()), custom: true }
    }
    return this.llm.resolveSystem(promptId)
  }

  private effortOf(stageId: string, fallback: LlmEffort): LlmEffort {
    return (STAGE_BY_ID.get(stageId as never)?.effort as LlmEffort | undefined) ?? fallback
  }

  async run(body: AdminDryRunBody, events: DryRunEvents = {}): Promise<DryRunResult> {
    const trendKeywords = await this.knowledge.trendKeywords()
    const ledger = assembleLedger({
      profile: body.profile,
      survey: body.survey,
      answers: body.answers,
      trendKeywords,
    })

    if (body.stageId === 'survey') {
      const system = await this.systemFor('survey', body.promptOverride)
      const user = buildSurveyRequest(body.intent, body.profile, ledger)
      const { content, meta } = await this.llm.generate('설문 생성(dry-run)', SurveyGen, {
        system,
        effort: this.effortOf('survey', 'low'),
        user,
      })
      const survey: SurveyPageWire = {
        intro: content.intro,
        questions: content.questions.map((q, i) => ({ id: `q${i + 1}`, ...q })),
      }
      return {
        stageId: body.stageId,
        ledger,
        promptCustom: system.custom,
        prompt: { promptId: 'survey', system: system.text, custom: system.custom, user },
        meta,
        survey,
      }
    }

    // plan-* 단계는 설문·답변이 입력이다 — 보통 survey dry-run 결과를 그대로 싣는다
    if (!body.survey || !body.answers?.length) {
      throw new BadRequestException('계획 단계 dry-run에는 survey(설문 페이지)와 answers(답변)가 필요합니다')
    }

    if (body.stageId === 'plan-skeleton') {
      const system = await this.systemFor('plan-skeleton', body.promptOverride)
      const user = buildPlanSkeletonRequest(body.intent, body.survey, body.answers, body.profile, undefined, ledger)
      const { content, meta } = await this.llm.generate('계획 뼈대 생성(dry-run)', PlanSkeletonGen, {
        system,
        effort: this.effortOf('plan-skeleton', 'medium'),
        user,
      })
      return {
        stageId: body.stageId,
        ledger,
        promptCustom: system.custom,
        prompt: { promptId: 'plan-skeleton', system: system.text, custom: system.custom, user },
        meta,
        skeleton: content,
      }
    }

    const guard: GuardContext = { blocklist: await this.knowledge.blocklist(), ledger }
    const system = await this.systemFor('plan-products', body.promptOverride)
    const user = buildPlanProductsRequest(body.intent, body.survey, body.answers, body.profile, undefined, ledger)
    const { content, meta } = await this.llm.generate('계획 상품 생성(dry-run)', PlanProductsGen, {
      system,
      effort: this.effortOf('plan-products', 'high'),
      user,
      webSearch: true,
      stream: events.onStatus
        ? { arrayKey: 'sections', onSearch: (query) => events.onStatus?.(`웹에서 "${query}" 검색 중…`) }
        : undefined,
    })
    // 6단계 검증 게이트까지 그대로 적용 — 운영에서 살아남을 결과와 드롭 사유를 함께 보여준다
    const dropLog: GroundingDrop[] = []
    const sections = content.sections
      .map((s, i) => {
        const { section, drops } = s.kind === 'contents' ? groundContentsSection(s, guard) : groundProductsSection(s, i, guard)
        dropLog.push(...drops)
        return section
      })
      .filter((s): s is PlanSectionWire => s !== null)
    return {
      stageId: body.stageId,
      ledger,
      promptCustom: system.custom,
      prompt: { promptId: 'plan-products', system: system.text, custom: system.custom, user },
      meta,
      sections,
      dropLog,
    }
  }
}
