import { z } from 'zod'
import { Thread, ThreadId, ThreadStatus, ThreadStep } from './thread'
import { Answer, FeedbackScore, Profile, SurveyPageWire, ThreadFeedbackComponent } from './thread-flow'

/*
 * 관리(admin) 계약 — 스튜디오 운영 콘솔(#ops) ↔ BFF `/api/admin/*` ↔ core 설정 KV.
 * 관리 페이지는 홈 드로어 도구 행에서 진입하며 별도 인증이 없다 (BFF는 서비스 토큰 가드만).
 */

/* ── core 설정 KV (internal API) ─────────────────────────────────────── */

/** 설정 키는 소문자·숫자·하이픈 — 예: 'llm-model' */
export const SETTING_KEY_PATTERN = /^[a-z0-9-]{1,64}$/
export const SettingKey = z.string().regex(SETTING_KEY_PATTERN, '설정 키는 소문자·숫자·하이픈 1~64자입니다')
export type SettingKey = z.infer<typeof SettingKey>

export const PutSettingBody = z.object({
  /** jsonb로 저장되는 값 — core는 내용을 해석하지 않는다 */
  value: z.unknown(),
})
export type PutSettingBody = z.infer<typeof PutSettingBody>

export const SettingWire = z.object({
  key: SettingKey,
  value: z.unknown(),
  updatedAt: z.string(),
})
export type SettingWire = z.infer<typeof SettingWire>

/* ── BFF admin — LLM 모델 관리 ───────────────────────────────────────── */

/** 관리 페이지에 노출되는 선택지 하나 — 카탈로그는 BFF(llm.service)가 소유한다 */
export const AdminModelOption = z.object({
  id: z.string(),
  label: z.string(),
  note: z.string().optional(),
  /** output_config.effort 지원 여부 — false면 BFF가 effort를 빼고 호출한다 (예: haiku) */
  supportsEffort: z.boolean(),
})
export type AdminModelOption = z.infer<typeof AdminModelOption>

export const AdminModelWire = z.object({
  /** 지금 생성에 쓰이는 모델 (설정값 또는 기본값) */
  current: z.string(),
  /** 설정이 없을 때의 코드 기본값 */
  defaultModel: z.string(),
  /** 설정 저장소에서 읽은 원본 값 — 없으면 null (= 기본값 사용 중) */
  configured: z.string().nullable(),
  options: z.array(AdminModelOption),
})
export type AdminModelWire = z.infer<typeof AdminModelWire>

export const PutAdminModelBody = z.object({
  /** 카탈로그에 있는 모델 id — null이면 설정을 지우고 기본값으로 되돌린다 */
  model: z.string().nullable(),
})
export type PutAdminModelBody = z.infer<typeof PutAdminModelBody>

/* ── BFF admin — 시스템 프롬프트 관리 ─────────────────────────────────────
 * 생성 단계별 시스템 프롬프트의 조회·재정의. 기본 프롬프트는 코드(BFF prompts.ts)가
 * 소유하고, 재정의는 core 설정 KV(`llm-prompt-<id>`)에 원문으로 저장된다.
 * 프롬프트는 캐시 적중을 위해 바이트 고정이어야 하므로 저장값 자체가 곧 시스템 프롬프트다
 * (plan-products의 카탈로그 목록만 {{CATALOG}} 자리표시자로 호출 시점에 치환). */

export const AdminPromptId = z.enum(['intent', 'survey', 'plan-skeleton', 'plan-products', 'judge', 'judge-survey'])
export type AdminPromptId = z.infer<typeof AdminPromptId>

export const AdminPromptEntry = z.object({
  id: AdminPromptId,
  label: z.string(),
  /** 이 프롬프트가 쓰이는 자리·주의점 설명 */
  note: z.string().optional(),
  /** 코드 기본 프롬프트 원문 (자리표시자 포함 템플릿) */
  defaultText: z.string(),
  /** 설정 저장소의 재정의 원문 — 없으면 null (= 기본값 사용 중) */
  configured: z.string().nullable(),
})
export type AdminPromptEntry = z.infer<typeof AdminPromptEntry>

export const AdminPromptsWire = z.object({
  /** 코드 기본 프롬프트의 버전 표기 (llmMeta.promptVersion과 대조용 — 재정의 사용 시 `+custom` 접미) */
  promptVersion: z.string(),
  prompts: z.array(AdminPromptEntry),
})
export type AdminPromptsWire = z.infer<typeof AdminPromptsWire>

export const PutAdminPromptBody = z.object({
  /** 재정의 원문 — null/공백이거나 기본값과 같으면 설정을 지우고 기본값으로 복귀 */
  text: z.string().max(20000).nullable(),
})
export type PutAdminPromptBody = z.infer<typeof PutAdminPromptBody>

/* ── core internal — 피드백 스텝 나열 (평가 모아보기의 원천) ──────────────
 * core는 payload를 해석하지 않는다는 원칙 그대로: action 스텝 중 payload.type='feedback'
 * 필터만 걸어 쓰레드 메타와 함께 원본을 돌려준다. 해석(zod 파싱·최신 판정·집계)은 BFF 몫. */

export const FeedbackStepRow = z.object({ thread: Thread, step: ThreadStep })
export type FeedbackStepRow = z.infer<typeof FeedbackStepRow>

export const FeedbackStepsWire = z.object({
  /** 스텝 createdAt 내림차순 (같은 시각이면 seq 내림차순) — 최신 제출이 먼저 */
  items: z.array(FeedbackStepRow),
  /** limit에 걸려 잘렸으면 true — 화면은 "최근 N건 기준"을 표시한다 */
  truncated: z.boolean(),
})
export type FeedbackStepsWire = z.infer<typeof FeedbackStepsWire>

/* ── BFF admin — 평가 모아보기 ───────────────────────────────────────────
 * 피드백 제출(action type='feedback') 1건 = 항목 1개. append 로그라 같은 (쓰레드, 단계)에
 * 여러 제출이 있을 수 있고, 최신 제출이 유효본이다(latest). 집계(평균·분포)는 FE가
 * latest 항목만으로 계산한다 — 항목 전체가 한 응답에 실려 오기 때문(§1-1 표 참고). */

export const AdminFeedbackEntry = z.object({
  threadId: ThreadId,
  /** 쓰레드 제목 — 목록에서 사람이 알아볼 이름 (없으면 null) */
  title: z.string().nullable(),
  threadStatus: ThreadStatus,
  userId: z.string(),
  stage: z.enum(['survey', 'plan']),
  /** 스텝 seq — 상세 로그와 대조용 */
  seq: z.number().int(),
  /** 제출 시각 — payload.at(클라이언트 시각) 우선, 없으면 스텝 createdAt */
  at: z.string(),
  review: z.object({ score: FeedbackScore.nullable(), feedback: z.string() }),
  components: z.array(ThreadFeedbackComponent),
  /** 같은 (쓰레드, 단계)의 최신 제출인가 — 유효본 판정 */
  latest: z.boolean(),
})
export type AdminFeedbackEntry = z.infer<typeof AdminFeedbackEntry>

export const AdminFeedbackWire = z.object({
  items: z.array(AdminFeedbackEntry),
  truncated: z.boolean(),
})
export type AdminFeedbackWire = z.infer<typeof AdminFeedbackWire>

/* ── BFF admin — 파이프라인 스튜디오 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 4) ────────
 * 단계 카탈로그·지식 KV·엔진 플래그의 열람/편집 + 단계 단독 실행(dry-run).
 * 단계 정의의 원천은 @ddak/pipeline PIPELINE_STAGES — 여기는 그 와이어 투영이다. */

export const AdminEngineId = z.enum(['legacy', 'langgraph'])
export type AdminEngineId = z.infer<typeof AdminEngineId>

export const AdminPipelineStage = z.object({
  id: z.string(),
  /** 전략 문서 단계 번호 — 병렬 단계는 '5a'/'5b' */
  no: z.string(),
  label: z.string(),
  kind: z.enum(['llm', 'deterministic', 'interrupt-boundary']),
  status: z.enum(['active', 'planned']),
  note: z.string(),
  /** LLM 단계의 시스템 프롬프트 id (PROMPT_DEFS) — 비 LLM 단계는 null */
  promptId: AdminPromptId.nullable(),
  effort: z.string().nullable(),
  /** LLM 단계의 프롬프트 재정의 사용 여부 — 비 LLM 단계는 null */
  promptCustom: z.boolean().nullable(),
})
export type AdminPipelineStage = z.infer<typeof AdminPipelineStage>

export const AdminKnowledgeEntry = z.object({
  id: z.string(),
  label: z.string(),
  /** kv = 설정 KV 수동 편집(editable), core = 실데이터 파생(읽기 전용) */
  backing: z.enum(['kv', 'core']),
  /** system = 시스템 자리표시자(캐시 흡수), user = 원장 경유 가변부, guard = 검증 게이트 */
  injection: z.enum(['system', 'user', 'guard']),
  placeholder: z.string().nullable(),
  note: z.string(),
  editable: z.boolean(),
  /** 현재 KV 원문 (없거나 core 파생이면 null) */
  value: z.string().nullable(),
})
export type AdminKnowledgeEntry = z.infer<typeof AdminKnowledgeEntry>

export const AdminPipelineWire = z.object({
  engine: z.object({ current: AdminEngineId, configured: z.string().nullable() }),
  stages: z.array(AdminPipelineStage),
  knowledge: z.array(AdminKnowledgeEntry),
})
export type AdminPipelineWire = z.infer<typeof AdminPipelineWire>

export const PutAdminKnowledgeBody = z.object({
  /** KV 원문 — null/공백이면 설정을 지운다 (지식 없음) */
  value: z.string().max(20000).nullable(),
})
export type PutAdminKnowledgeBody = z.infer<typeof PutAdminKnowledgeBody>

export const PutAdminEngineBody = z.object({
  /** null = 설정을 지우고 기본값(legacy) 복귀 */
  engine: AdminEngineId.nullable(),
})
export type PutAdminEngineBody = z.infer<typeof PutAdminEngineBody>

/** dry-run 대상 — LLM 단계만 (결정적 단계는 실행할 LLM이 없다. 검증 게이트는 products 결과에 포함) */
export const AdminDryRunStageId = z.enum(['survey', 'plan-skeleton', 'plan-products'])
export type AdminDryRunStageId = z.infer<typeof AdminDryRunStageId>

export const AdminDryRunBody = z.object({
  stageId: AdminDryRunStageId,
  /** 한 줄 의도 — 파이프라인의 유일한 씨앗 (전략 문서 0단계) */
  intent: z.string().min(1).max(500),
  profile: Profile.optional(),
  /** plan-* 단계 필수 — 보통 survey dry-run 결과를 그대로 싣는다 */
  survey: SurveyPageWire.optional(),
  answers: z.array(Answer).optional(),
  /** what-if: 저장하지 않은 임시 시스템 프롬프트로 실행 (자리표시자 치환은 동일 적용) */
  promptOverride: z.string().max(20000).optional(),
})
export type AdminDryRunBody = z.infer<typeof AdminDryRunBody>
