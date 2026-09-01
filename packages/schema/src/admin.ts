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

export const AdminPromptRevision = z.object({
  /** 사람이 복구 대상을 고를 때 쓰는 불변 id */
  id: z.string(),
  /** 저장 시각(ISO) */
  at: z.string(),
  /** null = 이 시점에는 코드 기본 지시서를 사용했다 */
  text: z.string().nullable(),
  /** 운영자가 남긴 변경 이유 또는 서버가 만든 짧은 설명 */
  note: z.string(),
})
export type AdminPromptRevision = z.infer<typeof AdminPromptRevision>

export const AdminPromptEntry = z.object({
  id: AdminPromptId,
  label: z.string(),
  /** 이 프롬프트가 쓰이는 자리·주의점 설명 */
  note: z.string().optional(),
  /** 코드 기본 프롬프트 원문 (자리표시자 포함 템플릿) */
  defaultText: z.string(),
  /** 설정 저장소의 재정의 원문 — 없으면 null (= 기본값 사용 중) */
  configured: z.string().nullable(),
  /** 최신순 저장 이력 — 현재 버전과 이전 복구 지점을 함께 싣는다 */
  history: z.array(AdminPromptRevision),
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
  /** 이번 변경을 실행 쓰레드와 대조할 때 보여 줄 짧은 메모 */
  note: z.string().trim().max(200).optional(),
})
export type PutAdminPromptBody = z.infer<typeof PutAdminPromptBody>

/* ── BFF admin — 운영 변경 로그 ─────────────────────────────────────────
 * 설정을 바꾼 사실을 한 타임라인에 모은다. 값은 현재 텍스트 설정들의 복구·대조에
 * 충분한 문자열 스냅샷이며 null은 코드 기본값/값 없음 상태다. */

export const AdminChangeArea = z.enum(['prompt', 'model', 'engine', 'knowledge'])
export type AdminChangeArea = z.infer<typeof AdminChangeArea>

export const AdminChangeEntry = z.object({
  id: z.string(),
  at: z.string(),
  area: AdminChangeArea,
  action: z.enum(['update', 'create', 'delete', 'restore']),
  targetId: z.string(),
  targetLabel: z.string(),
  summary: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** 현재 API에서 안전하게 복구할 수 있는 변경인지. 우선 프롬프트 버전만 true다. */
  restorable: z.boolean(),
})
export type AdminChangeEntry = z.infer<typeof AdminChangeEntry>

export const AdminChangesWire = z.object({
  items: z.array(AdminChangeEntry),
  truncated: z.boolean(),
})
export type AdminChangesWire = z.infer<typeof AdminChangesWire>

/** 운영자의 자연어 요청을 현재 시스템 프롬프트에 반영한 "미저장 수정안" 요청.
 * 저장 API와 분리해 AI 결과가 검토 없이 운영에 반영되지 않게 한다. */
export const AssistAdminPromptBody = z.object({
  instruction: z.string().trim().min(2).max(2000),
  currentText: z.string().min(1).max(20000),
})
export type AssistAdminPromptBody = z.infer<typeof AssistAdminPromptBody>

export const AssistAdminPromptResult = z.object({
  /** 자리표시자를 보존한 전체 시스템 프롬프트 원문 */
  proposedText: z.string().min(1).max(20000),
  /** 변경 기록의 기본 메모로 재사용할 짧은 설명 */
  summary: z.string().trim().min(1).max(200),
  /** 의미 충돌·넓은 영향 등 운영자가 적용 전에 볼 주의점 */
  warnings: z.array(z.string().trim().min(1).max(300)).max(5),
})
export type AssistAdminPromptResult = z.infer<typeof AssistAdminPromptResult>

/** 저장 없이 비교한 지시서 시험을 나중에 검토·적용할 수 있도록 쓰레드에 남기는 스냅샷. */
export const AdminPromptTrialRecord = z.object({
  promptId: AdminPromptId,
  promptLabel: z.string().trim().min(1).max(100),
  instruction: z.string().trim().min(2).max(2000),
  summary: z.string().trim().min(1).max(200),
  warnings: z.array(z.string().trim().min(1).max(300)).max(5),
  /** 시험 당시 운영 중이던 원문 — 나중 적용 시 그 사이 다른 변경이 있었는지 비교하는 기준선 */
  baseText: z.string().min(1).max(20000),
  proposedText: z.string().min(1).max(20000),
  intent: z.string().trim().min(1).max(500),
  baseline: z.unknown(),
  trial: z.unknown(),
  evaluation: z.object({
    score: FeedbackScore.nullable(),
    comment: z.string().max(2000),
  }),
  savedAt: z.string(),
})
export type AdminPromptTrialRecord = z.infer<typeof AdminPromptTrialRecord>

export const SaveAdminPromptTrialBody = AdminPromptTrialRecord.omit({ savedAt: true })
export type SaveAdminPromptTrialBody = z.infer<typeof SaveAdminPromptTrialBody>

export const AdminPromptTrialDecisionBody = z.object({
  decision: z.enum(['applied', 'rejected']),
})
export type AdminPromptTrialDecisionBody = z.infer<typeof AdminPromptTrialDecisionBody>

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
  /** 운영자가 화면에서 추가한 지식인가 — true면 삭제할 수 있다 (붙박이 카탈로그는 false) */
  custom: z.boolean(),
  /** 시스템 자리표시자 치환 시 값 위에 붙는 제목 줄 (자리표시자가 없으면 null) */
  heading: z.string().nullable(),
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

/** 새 지식 소스 등록 — 주입은 언제나 시스템 자리표시자다 (원장·게이트 주입은 코드 배선) */
export const PostAdminKnowledgeSourceBody = z.object({
  label: z.string().min(1).max(60),
  /** `{{NAME}}` 또는 `NAME` — 서버가 정규화하고 예약·중복 토큰은 거절한다 */
  placeholder: z.string().min(1).max(40),
  /** 치환 시 값 위에 붙는 제목 줄 — 비우면 라벨로 만든다 */
  heading: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  /** 최초 값 — 비우면 값 없는 소스로 만들어진다 */
  value: z.string().max(20000).nullable().optional(),
})
export type PostAdminKnowledgeSourceBody = z.infer<typeof PostAdminKnowledgeSourceBody>

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

/* ── BFF admin — 전체 플로우 실행 (플레이그라운드 flow-run) ──────────────────
 * 실제 LangGraph 그래프를 전용 MemorySaver로 통째로 돌고, admin 프로필(ops-playground)의
 * core 쓰레드로 실기록한다 — flowId = 쓰레드 id (core 미연결이면 flow- 임시 id로 기록 없이
 * 강등). HTTP 요청 1회 = 그래프 실행 1구간(운영과 동일): survey 페이즈는 interrupt(답변
 * 대기)에서 멈추고, plan 페이즈가 재개한다. interrupt가 유실된 인스턴스에서는 body의
 * 설문·답변으로 시딩해 START부터 재실행한다(그래프 복구 경로 그대로 — survey 노드는 멱등 스킵). */

export const AdminFlowRunBody = z.object({
  phase: z.enum(['survey', 'plan']),
  /** survey 페이즈 응답이 발급한 플로우 id — plan 페이즈 재개 키 */
  flowId: z.string().max(64).optional(),
  intent: z.string().min(1).max(500),
  profile: Profile.optional(),
  /** plan 페이즈 필수 — interrupt 유실 시 시딩 재실행 폴백 재료 */
  survey: SurveyPageWire.optional(),
  answers: z.array(Answer).optional(),
  /** AI 지시서 화면에서 시작한 시험이면 쓰레드 제목에 남길 변경 메모 */
  testLabel: z.string().trim().max(200).optional(),
})
export type AdminFlowRunBody = z.infer<typeof AdminFlowRunBody>
