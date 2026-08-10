import { z } from 'zod'
import { LlmMeta } from './thread'
import { Answer, FeedbackScore, Profile, SurveyPageWire, PlanPageWire, ThreadFeedbackComponent } from './thread-flow'

/*
 * 평가·실험 계약 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 5) — 골든 케이스와 실행 기록.
 * 케이스 = 입력 스냅샷(의도·프로필·설문·답변), 실행 = 케이스 × 설정 1회의 결과·메트릭·채점.
 * core는 내용을 해석하지 않고 저장·조회만 한다 — 집계·비교는 BFF/FE 몫.
 *
 * 평가 레코드 문법은 라이브 피드백(ThreadStageFeedback)과 한 벌이다:
 *   review(전체) = score·comment 컬럼 + components(항목별) = ThreadFeedbackComponent[].
 * 판정자(source) 축은 필드 분리로 굳힌다 — score·comment·components는 사람, judge는 자동.
 * 둘은 절대 서로 덮지 않고, 집계도 섞지 않는다 (비교축은 config 스냅샷).
 */

/** 스노우플레이크 19자리 — 쓰레드 id와 같은 체계 */
export const EvalId = z.string().regex(/^\d{19}$/)

export const EvalCase = z.object({
  id: EvalId,
  title: z.string().nullable(),
  intent: z.string(),
  profile: Profile.nullable(),
  survey: SurveyPageWire.nullable(),
  answers: z.array(Answer).nullable(),
  /** 승격 원본 쓰레드 (수동 생성이면 null) — "나쁜 실행 → 클릭 1번 → 케이스" 루프의 흔적 */
  sourceThreadId: z.string().nullable(),
  createdAt: z.string(),
})
export type EvalCase = z.infer<typeof EvalCase>

export const CreateEvalCaseBody = z.object({
  title: z.string().max(200).nullable().optional(),
  intent: z.string().min(1).max(500),
  profile: Profile.nullable().optional(),
  survey: SurveyPageWire.nullable().optional(),
  answers: z.array(Answer).nullable().optional(),
  sourceThreadId: z.string().nullable().optional(),
})
export type CreateEvalCaseBody = z.infer<typeof CreateEvalCaseBody>

/** 실행 설정 스냅샷 — 비교 축 (느슨한 객체: 축은 실험이 진화하며 늘어난다) */
export const EvalRunConfig = z.looseObject({
  /** 실행 경로 — 'dry-run'(플레이그라운드 경로) 또는 향후 'legacy'/'langgraph' 실주행 */
  engine: z.string().optional(),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  /** 임시 프롬프트(what-if)로 실행했는가 */
  promptOverride: z.boolean().optional(),
  label: z.string().optional(),
})
export type EvalRunConfig = z.infer<typeof EvalRunConfig>

/** 자동 채점(judge) 판정 — source='judge' 레코드. 사람 채점(score·comment·components)과
 * 절대 섞지 않는다: 덮어쓰기·합산 금지, 화면·집계에서도 별도 축이다. 루브릭 차원 강제는
 * 자동 채점에만 한다 (사람에게 차원 필수 입력을 강제하면 죽는다 — 스튜디오 v2의 criteria 폐기 교훈) */
export const EvalJudgeRubricEntry = z.object({
  key: z.string(),
  label: z.string(),
  score: FeedbackScore,
  /** 점수 근거 한두 문장 */
  note: z.string(),
})
export type EvalJudgeRubricEntry = z.infer<typeof EvalJudgeRubricEntry>

export const EvalJudgeVerdict = z.object({
  /** 종합 별점 0~5 — 사람 별점과 같은 눈금이지만 별도 필드 */
  score: FeedbackScore,
  rubric: z.array(EvalJudgeRubricEntry),
  /** 종합 심사평 */
  verdict: z.string(),
  /** 채점 호출 메타 — model·promptVersion(+custom 접미 포함)·지연 */
  meta: LlmMeta.nullable(),
  at: z.string(),
})
export type EvalJudgeVerdict = z.infer<typeof EvalJudgeVerdict>

export const EvalRun = z.object({
  id: EvalId,
  caseId: EvalId,
  config: EvalRunConfig,
  /** 계획 결과 (뼈대+검증 통과 상품·콘텐츠 병합본) */
  page: PlanPageWire.nullable(),
  /** 검증 게이트 드롭 로그 — 품질 신호 */
  dropLog: z.array(z.looseObject({ code: z.string(), message: z.string() })),
  meta: LlmMeta.nullable(),
  /** 사람 채점(전체) — null = 미채점 (0점과 구분, 평가 스튜디오 문법) */
  score: FeedbackScore.nullable(),
  comment: z.string(),
  /** 사람 채점(항목별) — id는 페이지 섹션 앵커(sec-<index>), label을 함께 저장해 재생성 후에도 해석 가능 */
  components: z.array(ThreadFeedbackComponent),
  /** 자동 채점 — 없으면 null (미실행) */
  judge: EvalJudgeVerdict.nullable(),
  createdAt: z.string(),
})
export type EvalRun = z.infer<typeof EvalRun>

export const CreateEvalRunBody = z.object({
  config: EvalRunConfig,
  page: PlanPageWire.nullable().optional(),
  dropLog: z.array(z.looseObject({ code: z.string(), message: z.string() })).optional(),
  meta: LlmMeta.nullable().optional(),
})
export type CreateEvalRunBody = z.infer<typeof CreateEvalRunBody>

export const ScoreEvalRunBody = z.object({
  score: FeedbackScore.nullable(),
  comment: z.string().max(2000).optional(),
  /** 항목별 채점 — 생략하면 기존 값 유지, 배열이 오면 통째 교체 (빈 배열 = 비움) */
  components: z.array(ThreadFeedbackComponent).max(40).optional(),
})
export type ScoreEvalRunBody = z.infer<typeof ScoreEvalRunBody>

/** core internal — 자동 채점 판정 저장 (BFF가 LLM 심사 후 굳힌다) */
export const JudgeEvalRunBody = z.object({ judge: EvalJudgeVerdict })
export type JudgeEvalRunBody = z.infer<typeof JudgeEvalRunBody>

/** core internal — 실행 단건 조회 (자동 채점이 케이스 입력을 함께 쓴다) */
export const EvalRunWithCase = z.object({ run: EvalRun, case: EvalCase })
export type EvalRunWithCase = z.infer<typeof EvalRunWithCase>

export const EvalCasesWire = z.object({ items: z.array(EvalCase) })
export type EvalCasesWire = z.infer<typeof EvalCasesWire>
export const EvalRunsWire = z.object({ items: z.array(EvalRun) })
export type EvalRunsWire = z.infer<typeof EvalRunsWire>

/* ── 전환 판정 계기판 — 실주행 plan 스텝 llmMeta를 엔진별로 집계 (원천은 core plan-metas) ── */

export const PlanMetaRow = z.object({
  threadId: z.string(),
  createdAt: z.string(),
  llmMeta: LlmMeta.nullable(),
})
export type PlanMetaRow = z.infer<typeof PlanMetaRow>
export const PlanMetasWire = z.object({ items: z.array(PlanMetaRow) })
export type PlanMetasWire = z.infer<typeof PlanMetasWire>

export const AdminEngineMetric = z.object({
  engine: z.string(),
  count: z.number().int(),
  avgLatencyMs: z.number().nullable(),
  avgSkeletonMs: z.number().nullable(),
  avgProductsMs: z.number().nullable(),
  /** 캐시 읽기 토큰 > 0 인 실행 비율 (프롬프트 캐시 적중 신호) */
  cacheHitRate: z.number().nullable(),
  promptVersions: z.array(z.string()),
})
export type AdminEngineMetric = z.infer<typeof AdminEngineMetric>
export const AdminEngineMetricsWire = z.object({
  /** 집계 표본 수 (최근 plan 스텝 N개) */
  sampled: z.number().int(),
  engines: z.array(AdminEngineMetric),
})
export type AdminEngineMetricsWire = z.infer<typeof AdminEngineMetricsWire>

/* ── BFF admin 실험 탭 전용 바디 ── */

export const PromoteEvalCaseBody = z.object({
  /** 승격할 쓰레드 — intent·프로필·설문·답변 스냅샷을 케이스로 굳힌다 */
  threadId: z.string().regex(/^\d{19}$/),
})
export type PromoteEvalCaseBody = z.infer<typeof PromoteEvalCaseBody>

export const RunEvalCaseBody = z.object({
  /** 임시 시스템 프롬프트 (what-if) — 뼈대·상품 두 단계 모두에 적용, 저장 안 됨 */
  promptOverride: z.string().max(20000).optional(),
  /** 실행 라벨 — 리스트에서 사람이 알아볼 이름 (예: "프롬프트 A안") */
  label: z.string().max(100).optional(),
})
export type RunEvalCaseBody = z.infer<typeof RunEvalCaseBody>
