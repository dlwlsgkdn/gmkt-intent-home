import { z } from 'zod'

/*
 * 쓰레드 도메인 계약 — backend core의 internal API와 BFF·FE가 공유하는 단일 출처.
 * DESIGN-LLM-SERVICE.md §2-2 참고. 필드는 스튜디오 recordThread 레코드와 정합을 유지한다.
 */

/**
 * threadId — core가 발급하는 스노우플레이크 id (64비트: 41b 타임스탬프 | 10b 워커 | 12b 시퀀스).
 * 분산 유니크 + 생성 시각순 정렬. 에포크(2010-01-01) 덕에 **항상 19자리 십진 문자열**이라
 * (2079년경까지) 문자열 사전순 정렬 = 시간순이다. 저장·와이어 모두 문자열로 다룬다.
 */
export const THREAD_ID_PATTERN = /^\d{19}$/
export const ThreadId = z.string().regex(THREAD_ID_PATTERN, 'threadId는 19자리 스노우플레이크 숫자 문자열입니다')
export type ThreadId = z.infer<typeof ThreadId>

/** 쓰레드 상태: 탐색 → 설문 → 계획 → 완료 (이탈은 abandoned) */
export const ThreadStatus = z.enum(['exploring', 'surveying', 'planning', 'done', 'abandoned'])
export type ThreadStatus = z.infer<typeof ThreadStatus>

/** 스텝 단계 — 쓰레드에서 일어난 일의 종류 (payload 형태는 단계별로 다르다) */
export const StepStage = z.enum(['explore', 'survey', 'answers', 'plan', 'action'])
export type StepStage = z.infer<typeof StepStage>

/** 쓰레드 시작점 — 칩 클릭 또는 검색 */
export const ThreadSource = z.object({
  kind: z.enum(['chip', 'search']),
  chipId: z.string().optional(),
  query: z.string().optional(),
})
export type ThreadSource = z.infer<typeof ThreadSource>

/** LLM 호출 메타 — 비용·품질 대시보드의 원천. core는 내용을 해석하지 않는다(jsonb 저장만) */
export const LlmMeta = z.looseObject({
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
    })
    .optional(),
  latencyMs: z.number().optional(),
  fallback: z.boolean().optional(),
})
export type LlmMeta = z.infer<typeof LlmMeta>

/* ── internal API 요청 본문 ───────────────────────────────────────────── */

export const CreateThreadBody = z.object({
  /** 익명 디바이스 id 또는 (추후) 로그인 사용자 id — core는 불투명 문자열로 다룬다 */
  userId: z.string().min(1),
  title: z.string().optional(),
  source: ThreadSource.optional(),
  status: ThreadStatus.optional(),
})
export type CreateThreadBody = z.infer<typeof CreateThreadBody>

export const UpdateThreadBody = z
  .object({
    title: z.string().optional(),
    status: ThreadStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 필드가 없습니다' })
export type UpdateThreadBody = z.infer<typeof UpdateThreadBody>

export const UpsertStepBody = z.object({
  stage: StepStage,
  payload: z.record(z.string(), z.unknown()),
  llmMeta: LlmMeta.optional(),
})
export type UpsertStepBody = z.infer<typeof UpsertStepBody>

/* ── internal API 응답 (와이어 형식 — 날짜는 ISO 문자열) ─────────────── */

export const Thread = z.object({
  id: ThreadId,
  userId: z.string(),
  title: z.string().nullable(),
  source: ThreadSource.nullable(),
  status: ThreadStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Thread = z.infer<typeof Thread>

export const ThreadStep = z.object({
  id: z.string().uuid(),
  threadId: ThreadId,
  seq: z.number().int(),
  stage: StepStage,
  payload: z.record(z.string(), z.unknown()),
  llmMeta: LlmMeta.nullable(),
  createdAt: z.string(),
})
export type ThreadStep = z.infer<typeof ThreadStep>

export const ThreadWithSteps = Thread.extend({ steps: z.array(ThreadStep) })
export type ThreadWithSteps = z.infer<typeof ThreadWithSteps>

export const ThreadListPage = z.object({
  items: z.array(Thread),
  /** 다음 페이지 커서 (마지막 항목의 updatedAt ISO) — 더 없으면 null */
  nextCursor: z.string().nullable(),
})
export type ThreadListPage = z.infer<typeof ThreadListPage>
