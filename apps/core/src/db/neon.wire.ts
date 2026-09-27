import type { EvalCaseRow, EvalRunRow, SettingRow, ThreadRow, ThreadStepRow } from './neon.schema'
import type { EvalCaseWire, EvalRunWire, SettingWire, ThreadStepWire, ThreadWire } from './wire'

/*
 * Neon(Drizzle) 행 → API 응답(와이어). Mongo 구현의 wire.ts 와 **같은 모양**을 돌려주는 것이 이 파일의 유일한 일이다 —
 * 두 저장소가 컨트롤러·BFF 에게 구분되지 않아야 배포마다 저장소를 달리 골라도 계약이 하나로 남는다.
 * Drizzle 은 timestamptz 를 Date 로 주므로 ISO 문자열로 바꾼다(@ddak/schema zod 계약이 문자열 날짜).
 */

export function neonThreadToWire(row: ThreadRow): ThreadWire {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    source: row.source ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function neonStepToWire(row: ThreadStepRow): ThreadStepWire {
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    stage: row.stage,
    payload: row.payload,
    llmMeta: row.llmMeta ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export function neonSettingToWire(row: SettingRow): SettingWire {
  return { key: row.key, value: row.value, updatedAt: row.updatedAt.toISOString() }
}

export function neonEvalCaseToWire(row: EvalCaseRow): EvalCaseWire {
  return {
    id: row.id,
    title: row.title,
    intent: row.intent,
    profile: row.profile ?? null,
    survey: row.survey ?? null,
    answers: row.answers ?? null,
    sourceThreadId: row.sourceThreadId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function neonEvalRunToWire(row: EvalRunRow): EvalRunWire {
  return {
    id: row.id,
    caseId: row.caseId,
    config: row.config,
    page: row.page ?? null,
    // jsonb 컬럼은 unknown 으로 선언돼 있다 — 기본값이 '[]' 이라 배열이다 (Mongo 문서는 unknown[] 로 선언)
    dropLog: (row.dropLog ?? []) as unknown[],
    meta: row.meta ?? null,
    score: row.score,
    comment: row.comment,
    components: (row.components ?? []) as unknown[],
    judge: row.judge ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}
