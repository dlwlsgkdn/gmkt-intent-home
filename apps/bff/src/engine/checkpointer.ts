import { Logger } from '@nestjs/common'
import { MemorySaver, type BaseCheckpointSaver } from '@langchain/langgraph'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

/*
 * checkpointer 팩토리 (DESIGN-PIPELINE-LANGGRAPH.md §1) — LANGGRAPH_DATABASE_URL이 있으면
 * 기존 Neon DB의 별도 스키마(lg)에 PostgresSaver, 없으면 MemorySaver(프로세스 내 한정).
 * 체크포인트는 그래프 재개 전용 실행 상태이고 진실 원천은 core 스텝이므로, 유실돼도
 * 엔진의 복구 경로(core 시딩 재실행)가 받는다 — MemorySaver 폴백이 안전한 이유.
 */

const logger = new Logger('EngineCheckpointer')
let cached: Promise<BaseCheckpointSaver> | null = null

export function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!cached) cached = create()
  return cached
}

async function create(): Promise<BaseCheckpointSaver> {
  const url = process.env.LANGGRAPH_DATABASE_URL
  if (!url) {
    logger.warn('LANGGRAPH_DATABASE_URL 미설정 — MemorySaver 사용 (프로세스 내 한정, 유실 시 core 복구 경로가 받는다)')
    return new MemorySaver()
  }
  const saver = PostgresSaver.fromConnString(url, { schema: 'lg' })
  await saver.setup()
  logger.log('PostgresSaver 준비 완료 (schema=lg)')
  return saver
}
