import {
  GeneratedIndexAllocator,
  isSlotKind,
  slotIndexesOf,
  type PlanSkeletonGen,
} from '@ddak/pipeline'
import type { PlanSectionWire, SurveyQuestionWire } from '@ddak/schema'
import type { PlanSkeletonPageWire } from '../threads/threads.service'

/*
 * 그래프 → SSE 스트림 브리지 (DESIGN-PIPELINE-LANGGRAPH.md §1 스트리밍).
 * 노드는 LangGraph custom 스트림 writer로 GraphStreamChunk를 밀어 올리고,
 * 엔진 서비스가 graph.stream() 소비 루프에서 기존 핸들러(SSE 이벤트 계약)로 변환한다 —
 * FE 계약 무변경. 조율자는 요청 수명(비직렬화)이라 상태가 아닌 configurable로 주입한다.
 */

export type GraphStreamChunk =
  | { event: 'head'; data: Record<string, string> }
  | { event: 'question'; data: { index: number; question: SurveyQuestionWire } }
  | { event: 'skeleton'; data: { page: PlanSkeletonPageWire; pending: number[] } }
  | { event: 'section'; data: { index: number; section: PlanSectionWire; final: boolean } }
  | { event: 'search'; data: { query: string } }

export type ChunkWriter = (chunk: GraphStreamChunk) => void

/**
 * 계획 스트림 조율자 — legacy generatePlan의 클로저 조율(자리 배정·대기열·증분 재전송)을
 * 병렬 두 노드(skeleton·products)가 공유하는 객체로 옮긴 것. 규칙은 동일하다:
 * - 자리 인덱스는 뼈대 최종 검증본 기준으로 확정 (skeletonReady 전 도착분은 대기열)
 * - 검색 스트림 원소 index → 자리 index는 첫 방출에 배정, 재전송·최종본이 같은 자리를 쓴다
 * - 증분(final=false)은 뼈대 확정 후에만 — FE에 자리 카드가 있어야 한다
 */
export class PlanStreamCoordinator {
  private emit: ChunkWriter | null = null
  private allocator: GeneratedIndexAllocator | null = null
  private readonly slotByStream = new Map<number, number>()
  private readonly arrived: { section: PlanSectionWire; streamIndex: number }[] = []
  private emitted = 0

  /** 노드 진입 시 writer 바인딩 — 병렬 노드 둘 다 같은 스트림에 쓰므로 어느 쪽이든 무방 */
  bind(writer: ((chunk: unknown) => void) | undefined) {
    if (writer) this.emit = writer as ChunkWriter
  }

  head(patch: Record<string, string>) {
    this.emit?.({ event: 'head', data: patch })
  }

  section(section: PlanSectionWire, index: number, final: boolean) {
    this.emit?.({ event: 'section', data: { index, section, final } })
  }

  search(query: string) {
    this.emit?.({ event: 'search', data: { query } })
  }

  /** 뼈대 최종 검증본 도착 — 자리 인덱스 확정 + 조기 확정 알림 + 대기열 플러시 */
  skeletonReady(content: PlanSkeletonGen) {
    const sections = content.sections
    this.allocator = new GeneratedIndexAllocator(slotIndexesOf(sections), sections.length)
    const pending: number[] = []
    const wireSections = sections.map((s, i) => {
      if (isSlotKind(s.kind)) {
        pending.push(i)
        return null
      }
      return s as PlanSectionWire
    })
    this.emit?.({
      event: 'skeleton',
      data: { page: { headline: content.headline, summary: content.summary, sections: wireSections }, pending },
    })
    this.flush()
  }

  /** 검색 섹션 최종본(그라운딩 통과) 도착 — 뼈대 확정 전이면 대기열에 쌓인다 */
  searchArrived(section: PlanSectionWire, streamIndex: number) {
    this.arrived.push({ section, streamIndex })
    this.flush()
  }

  /** 자라는 중인 검색 섹션 증분 — 뼈대 확정(자리 카드) 전 조각은 버린다 (완성본은 대기열이 보전) */
  searchPartial(section: PlanSectionWire, streamIndex: number) {
    if (!this.allocator) return
    this.section(section, this.slotFor(streamIndex, section.kind), false)
  }

  private slotFor(streamIndex: number, kind: string): number {
    let slot = this.slotByStream.get(streamIndex)
    if (slot === undefined) {
      slot = (this.allocator as GeneratedIndexAllocator).next(kind === 'contents' ? 'contents' : 'products')
      this.slotByStream.set(streamIndex, slot)
    }
    return slot
  }

  private flush() {
    if (!this.allocator || !this.emit) return
    while (this.emitted < this.arrived.length) {
      const { section, streamIndex } = this.arrived[this.emitted]
      this.section(section, this.slotFor(streamIndex, section.kind), true)
      this.emitted += 1
    }
  }
}
