import { Annotation } from '@langchain/langgraph'
import type { Answer, LlmMeta, PlanPageWire, Profile, SurveyPageWire, ThreadStageFeedback } from '@ddak/schema'
import type { ConstraintLedger, GroundingDrop, PlanSearchSectionGen, PlanSkeletonGen } from '@ddak/pipeline'

/*
 * 쓰레드 그래프 상태 (DESIGN-PIPELINE-LANGGRAPH.md §1) — 체크포인트로 직렬화되므로
 * JSON 가능 값만 담는다. 스트리밍 콜백·조율자는 config.configurable로 요청마다 주입한다.
 * 모든 채널은 LastValue — 재생성 실행이 이전 값을 덮는다. survey처럼 "있으면 건너뛰는"
 * 노드가 있어, 체크포인트가 없어도 core에서 시딩한 입력으로 전체 그래프를 재실행할 수 있다
 * (복구 경로 — 체크포인트는 재개 최적화일 뿐 진실 원천이 아니다).
 */
export const ThreadGraphState = Annotation.Root({
  threadId: Annotation<string>(),
  /** 쓰레드 소유자(deviceId) — 직전 쓰레드 피드백 압축 조회에 쓴다 */
  userId: Annotation<string>(),
  intent: Annotation<string>(),
  profile: Annotation<Profile | null>(),
  /** 제약 원장 — 가변부 주입(프롬프트)과 6단계 역대조가 같은 값을 본다. plan 스텝에 스냅샷 기록 */
  ledger: Annotation<ConstraintLedger | null>(),
  /** 상품 블록리스트 (KV guard-blocklist) — s2에서 굳혀 스트리밍·최종 검증이 같은 목록을 본다 */
  blocklist: Annotation<string[] | null>(),
  survey: Annotation<SurveyPageWire | null>(),
  surveyMeta: Annotation<LlmMeta | null>(),
  answers: Annotation<Answer[] | null>(),
  /** 계획 재생성 피드백 — 요청마다 입력으로 덮는다 (없으면 null — 이전 값 잔존 방지) */
  feedback: Annotation<ThreadStageFeedback | null>(),
  /** 피드백 반영 재생성의 직전 계획 — 복구·재생성 경로에서 core plan 스텝으로 시딩 */
  prevPlan: Annotation<PlanPageWire | null>(),
  skeleton: Annotation<PlanSkeletonGen | null>(),
  skeletonMeta: Annotation<LlmMeta | null>(),
  /** 검색 단계 원본 섹션 (그라운딩 전) — verify 노드가 최종 그라운딩·병합한다 */
  searchSections: Annotation<PlanSearchSectionGen[] | null>(),
  productsMeta: Annotation<LlmMeta | null>(),
  /** 검색 단계 실패 메시지 — 실패는 계획 전체를 죽이지 않는다 (legacy allSettled 정책 유지) */
  productsFailed: Annotation<string | null>(),
  page: Annotation<PlanPageWire | null>(),
  /** 검증 게이트 드롭 사유 (최종 검증 기준) — plan 스텝 payload.dropLog로 기록 (전략 문서 p.11) */
  dropLog: Annotation<GroundingDrop[] | null>(),
})

export type ThreadGraphStateType = typeof ThreadGraphState.State
