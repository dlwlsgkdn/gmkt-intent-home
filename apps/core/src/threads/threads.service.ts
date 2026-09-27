import type { CreateThreadBody, LlmMeta, UpdateThreadBody, UpsertStepBody } from '@ddak/schema'
import type { ThreadStepWire, ThreadWire } from '../db/wire'

/*
 * 쓰레드 저장 계층의 계약 = DI 토큰. 구현은 저장소별로 둘(threads.neon.service.ts · threads.mongo.service.ts)이고
 * ThreadsModule 이 STORE(db/store.ts)에 따라 하나를 꽂는다. 컨트롤러는 이 추상 클래스만 안다 — 두 구현은 같은
 * 와이어(db/wire.ts 의 모양)를 돌려주어야 하며, 새 메서드는 여기에 먼저 적고 두 구현에 같이 넣는다.
 */
export abstract class ThreadsService {
  abstract create(body: CreateThreadBody): Promise<ThreadWire>
  abstract update(id: string, patch: UpdateThreadBody): Promise<ThreadWire>
  /** (thread_id, seq) 멱등 upsert — BFF 재시도가 중복 스텝을 만들지 않는다 */
  abstract upsertStep(threadId: string, seq: number, body: UpsertStepBody): Promise<ThreadStepWire>
  /** 쓰레드 + 스텝 전체 — 이어보기 복원용 aggregate */
  abstract get(id: string): Promise<ThreadWire & { steps: ThreadStepWire[] }>
  /** 히스토리 패널용 목록 — updatedAt 키셋 커서, archived 제외, total 은 커서와 무관한 전체 */
  abstract listByUser(userId: string, cursor?: string, limit?: number): Promise<{ items: ThreadWire[]; nextCursor: string | null; total: number }>
  /** 관리 평가 모아보기의 원천 — 피드백 제출 스텝을 쓰레드 메타와 함께 최신순으로 */
  abstract listFeedbackSteps(limit?: number): Promise<{ items: { thread: ThreadWire; step: ThreadStepWire }[]; truncated: boolean }>
  /** 전환 판정 계기판의 원천 — plan 스텝의 llmMeta 만 최신순으로 */
  abstract listPlanMetas(limit?: number): Promise<{ items: { threadId: string; createdAt: string; llmMeta: LlmMeta | null }[] }>
  /** 관리 페이지용 전체 목록 — archived 포함, id 키셋 커서 */
  abstract listAll(cursor?: string, limit?: number): Promise<{ items: ThreadWire[]; nextCursor: string | null }>
}
