import { z } from 'zod'
import { Thread, ThreadId, ThreadStatus, ThreadStep } from './thread'
import { FeedbackScore, ThreadFeedbackComponent } from './thread-flow'

/*
 * 관리(admin) 계약 — 스튜디오 #admin 페이지 ↔ BFF `/api/admin/*` ↔ core 설정 KV.
 * 관리 페이지는 유저 진입점에 노출되지 않으며, x-admin-token 헤더(ADMIN_TOKEN)로 보호된다.
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
