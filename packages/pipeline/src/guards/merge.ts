import type { PlanSectionWire } from '@ddak/schema'
import { skeletonSectionWire } from '../look'
import type { PlanSkeletonSectionGen } from '../schemas'

/*
 * 2단계 계획 병합 규칙 (§9-1, 2026-09 개정) — 뼈대의 상품/콘텐츠 "자리"를 검색 단계 결과로 채운다.
 *
 * 옛 규칙은 "kind별 k번째 검색 섹션 = k번째 자리, 남으면 끝에 덧붙임"이었다. 뼈대(5a)와 검색(5b·5c)은 병렬이라
 * 서로의 단계 구성을 모르고, 뼈대가 자리를 1개만 두고 검색이 섹션을 2개 만들면 두 번째가 사용 순서(steps) 뒤에
 * 매달렸으며, 뼈대가 첫 단계에 자리를 안 두면 첫 단계 상품이 뒤 단계 자리로 밀렸다(2026-09 운영 기록 두 건 모두).
 *
 * 새 규칙 — **단계 묶음(guide + 바로 뒤 자리들)에 의미 대조·순서 보존으로 배정**한다 (PlanPlacer):
 *   - 뼈대를 단계 묶음으로 자른다: guide 가 묶음을 열고 바로 이어지는 products/contents 자리가 그 묶음의 연속 구간이다.
 *     첫 guide 앞(look 등)은 앞머리 묶음, steps 같은 닫는 섹션은 연속 구간을 끊는다(끼워 넣을 위치는 그 앞).
 *     성분 비교표(compare)·주의 성분(caution)은 단계 본문이라 구간을 끊지 않는다 — 자리 없는 상품·콘텐츠는 그 뒤에 선다 (v26).
 *   - 검색 섹션은 kind 별로 도착 순서대로, 직전 섹션이 간 묶음 **이후**(같은 묶음 포함)의 묶음 중에서 고른다:
 *     제목(+reason 은 0.3 가중 — reason 은 설문 답변을 되풀이해 단계 안내 본문과 두루 겹친다)의 글자 2-gram 이
 *     묶음 텍스트(안내 제목·서브타이틀·본문 + 자리 제목·기준)에 얼마나 덮이는지를 재되, 모든 묶음에 나오는
 *     2-gram("피부"·"복합성" 같은 공통어)은 묶음 간 문서 빈도로 가중을 0 에 가깝게 낮춘다. 여기에 아직 안 찬 자리가
 *     있는 묶음(뼈대의 배치는 대개 옳다)과 직전 섹션보다 뒤 묶음(검색 섹션은 단계 순서대로 하나씩 온다)에 가산점.
 *   - 닮은 정도가 미미하면(대조할 말이 없음) 옛 규칙대로 첫 빈자리, 빈자리도 없으면 그 kind 를 아직 받지 않은 다음 묶음.
 *   - 고른 묶음에 빈자리가 있으면 그 자리(뼈대 인덱스)를 차지하고, 없으면 묶음 연속 구간 끝에 **끼워 넣는다**
 *     (더는 steps 뒤에 매달리지 않는다). 채워지지 않은 자리는 최종에서 빠진다(빈 섹션을 보여주지 않는다).
 *   - 스트리밍 인덱스(GeneratedIndexAllocator)도 같은 배정을 쓴다: 자리를 받은 섹션은 그 뼈대 인덱스, 끼워 넣을 섹션은
 *     뼈대 길이 뒤 도착 순 인덱스(FE 엔 끝에 보였다가 result 에서 제자리로 — 옛 "끝에 덧붙임"과 같은 표시 방식).
 *   배정은 (뼈대, 같은 kind 의 순서, 제목·reason)만의 함수라 부분 스트림과 result 가 같은 자리를 쓴다 — 증분 조각은
 *   title·reason 이 완성된 뒤에만 나간다(partial.ts completeSearchSection — 항목 배열이 열린 뒤라 앞 키는 닫혀 있다).
 */

export type SlotKind = 'products' | 'contents'

export function isSlotKind(kind: string): kind is SlotKind {
  return kind === 'products' || kind === 'contents'
}

/** 단계 본문에 속하는 텍스트 섹션 — 성분 비교표·주의 성분 (v26). 자리는 아니지만 안내 뒤 연속 구간의 일부다: 자리 없이
 * 배정된 상품·콘텐츠는 이 뒤에 끼우고(표가 세운 기준 → 그 기준으로 고른 상품 순서), 성분·제품 유형 텍스트는 묶음의 대조
 * 재료에 더한다 — "약산성 저자극 쉐이빙 젤" 상품 섹션이 비교표를 둔 단계를 찾아가게 */
export function isStepBodyKind(kind: string): kind is 'compare' | 'caution' {
  return kind === 'compare' || kind === 'caution'
}

/** 뼈대에서 kind별 자리 인덱스 추출 (조기 확정 알림의 pending 목록 재료) */
export function slotIndexesOf(skeleton: PlanSkeletonSectionGen[]): Record<SlotKind, number[]> {
  const slots: Record<SlotKind, number[]> = { products: [], contents: [] }
  skeleton.forEach((s, i) => {
    if (isSlotKind(s.kind)) slots[s.kind].push(i)
  })
  return slots
}

/** 배정 대조 재료 — 와이어(PlanSectionWire)·생성(PlanSearchSectionGen) 어느 쪽이든 kind·title·reason 만 본다 */
export type PlacedSectionLike = { kind: string; title?: string; reason?: string }

/** 단계 묶음 — guide 하나와 그 뒤에 이어지는 자리들. index -1 은 첫 guide 앞의 앞머리 묶음 */
export type PlanGroup = {
  index: number
  guideAt: number | null
  /** 이 묶음에 속한 자리의 뼈대 인덱스 (kind 별, 뼈대 순서) */
  slots: Record<SlotKind, number[]>
  /** 자리 없이 배정된 섹션을 끼울 뼈대 인덱스(이 인덱스 **앞**) — 콘텐츠는 묶음의 마지막 콘텐츠 자리 뒤(없으면 안내·비교표 바로 뒤,
   * 상품 자리 앞), 상품은 연속 구간 끝. 뼈대의 [안내 → (비교표·주의 성분) → 콘텐츠 → 상품] 순서를 지킨다 (2026-09-17 — 참고
   * 콘텐츠가 상품보다 위에 선다) */
  insertAt: Record<SlotKind, number>
  /** 대조용 텍스트(정규화) — 안내 제목·서브타이틀·본문 + 자리 제목·기준 */
  text: string
}

const normalizeText = (parts: (string | undefined | null)[]): string =>
  parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

const bigramsOf = (text: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i + 1 < text.length; i += 1) out.add(text.slice(i, i + 2))
  return out
}

/** 뼈대의 자리 순서 정규화 (2026-09-17) — 단계 묶음의 연속 구간 안에서 **콘텐츠 자리가 상품 자리보다 앞**에 오도록 안정 정렬한다
 * (텍스트 섹션·구간 밖 섹션은 제자리, 같은 종류끼리 순서 유지). 뼈대 프롬프트가 [안내 → 콘텐츠 → 상품] 을 요구하지만 모델·옛 재정의
 * 프롬프트가 [안내 → 상품 → 콘텐츠] 로 내도 화면 규칙(참고 콘텐츠가 상품 위)이 지켜지도록 5a 완료 직후(스트림 skeleton 이벤트·
 * 배정기·최종 병합 전) 한 번 적용한다 — 그 뒤 모든 인덱스는 정규화된 뼈대 기준이다. 멱등 */
export function orderSkeletonSlots<T extends PlanSkeletonSectionGen>(skeleton: T[]): T[] {
  const out: T[] = []
  let run: T[] = [] // 현재 연속 구간의 자리 섹션들
  const flushRun = () => {
    if (!run.length) return
    out.push(...run.filter((s) => s.kind === 'contents'), ...run.filter((s) => s.kind === 'products'))
    run = []
  }
  for (const s of skeleton) {
    if (isSlotKind(s.kind)) {
      run.push(s)
      continue
    }
    flushRun()
    out.push(s)
  }
  flushRun()
  return out
}

/** 뼈대 → 단계 묶음 목록 (첫 원소는 언제나 앞머리 묶음 index -1, 이어서 guide 순서대로 0, 1, …) */
export function planGroupsOf(skeleton: PlanSkeletonSectionGen[]): PlanGroup[] {
  const lead: PlanGroup = {
    index: -1,
    guideAt: null,
    slots: { products: [], contents: [] },
    insertAt: { products: 0, contents: 0 },
    text: '',
  }
  const groups: PlanGroup[] = [lead]
  let current = lead
  let runOpen = true // 현재 묶음의 연속 구간(안내 직후 자리들)이 아직 이어지는가
  skeleton.forEach((s, i) => {
    if (s.kind === 'guide') {
      current = {
        index: groups.length - 1,
        guideAt: i,
        slots: { products: [], contents: [] },
        insertAt: { products: i + 1, contents: i + 1 },
        text: normalizeText([s.title, s.subtitle, s.body]),
      }
      groups.push(current)
      runOpen = true
      return
    }
    if (s.kind === 'products' || s.kind === 'contents') {
      current.slots[s.kind].push(i)
      current.text += normalizeText([s.title, s.reason])
      if (runOpen) {
        // 상품 끼움 위치는 구간 끝을 따라가고, 콘텐츠 끼움 위치는 콘텐츠 자리 뒤까지만(상품 자리 앞에 머문다)
        current.insertAt.products = i + 1
        if (s.kind === 'contents') current.insertAt.contents = i + 1
      }
      return
    }
    if (s.kind === 'compare' || s.kind === 'caution') {
      // 단계 본문 섹션 — 연속 구간을 끊지 않고 끼울 위치를 그 뒤로 미룬다. 성분·제품 유형은 대조 텍스트에 더한다
      current.text += normalizeText(
        s.kind === 'compare'
          ? [s.title, s.alt.name, s.pick.name, ...s.rows.map((r) => r.ingredient)]
          : [s.title, s.desc, ...s.items.map((it) => it.name)],
      )
      if (runOpen) current.insertAt = { products: i + 1, contents: i + 1 }
      return
    }
    // look·steps 같은 닫는 섹션 — 연속 구간이 끝난다. 앞머리 묶음의 look 만은 구간에 포함(끼울 위치를 그 뒤로)
    if (current.index === -1 && s.kind === 'look' && runOpen) {
      current.insertAt = { products: i + 1, contents: i + 1 }
      return
    }
    runOpen = false
  })
  return groups
}

/* 배정 상수 — 2026-09 운영 기록 두 쓰레드(메이크업·토너패드)로 맞췄다(제목만 보면 빈자리 가산점이 첫 단계 상품을 뒤로 끌고,
   reason 을 제목과 같은 무게로 보면 답변 인용이 다른 단계 본문과 겹쳐 뒤 단계 상품이 앞 단계로 온다) */
const REASON_WEIGHT = 0.3
const SLOT_BONUS = 0.05
const SPREAD_BONUS = 0.05
const MIN_SIMILARITY = 0.04

export type SectionPlacement = {
  /** 배정된 묶음(PlanGroup.index) */
  group: number
  /** 차지한 자리의 뼈대 인덱스 — null 이면 자리 없이 묶음 끝에 끼워 넣는 섹션 */
  slot: number | null
}

/** 검색 섹션 → 단계 묶음 배정기. 같은 뼈대·같은 순서로 place 를 부르면 언제나 같은 답을 낸다(스트리밍·최종 공용) */
export class PlanPlacer {
  readonly groups: PlanGroup[]
  private readonly groupBigrams: Set<string>[]
  private readonly weightOf: (bigram: string) => number
  private readonly filled = new Set<number>()
  private readonly last: Record<SlotKind, number> = { products: -1, contents: -1 }
  private readonly taken: Record<SlotKind, Set<number>> = { products: new Set(), contents: new Set() }

  constructor(skeleton: PlanSkeletonSectionGen[]) {
    this.groups = planGroupsOf(skeleton)
    this.groupBigrams = this.groups.map((g) => bigramsOf(g.text))
    // 묶음 간 문서 빈도 가중 — 여러 묶음에 두루 나오는 2-gram 은 가릴 힘이 없다
    const df = new Map<string, number>()
    for (const bag of this.groupBigrams) for (const b of bag) df.set(b, (df.get(b) ?? 0) + 1)
    const n = this.groupBigrams.filter((bag) => bag.size > 0).length
    this.weightOf = (b) => (n > 1 ? 1 - (df.get(b) ?? 0) / n : 1)
  }

  private unfilledSlot(group: PlanGroup, kind: SlotKind): number | null {
    const slot = group.slots[kind].find((i) => !this.filled.has(i))
    return slot === undefined ? null : slot
  }

  place(section: PlacedSectionLike): SectionPlacement {
    const kind: SlotKind = section.kind === 'contents' ? 'contents' : 'products'
    // 후보 — 직전 같은 kind 섹션이 간 묶음 이후. 앞머리 묶음은 빈자리가 있을 때만(안내 없는 뼈대·안내 앞 자리)
    let candidates = this.groups.filter(
      (g) => g.index >= this.last[kind] && (g.index >= 0 || this.unfilledSlot(g, kind) != null),
    )
    if (!candidates.length) candidates = [this.groups[0]]
    const title = bigramsOf(normalizeText([section.title]))
    const reason = bigramsOf(normalizeText([section.reason]))
    let denom = 0
    for (const b of title) denom += this.weightOf(b)
    for (const b of reason) denom += this.weightOf(b) * REASON_WEIGHT
    const scored = candidates.map((group) => {
      const bag = this.groupBigrams[group.index + 1]
      let sum = 0
      for (const b of title) if (bag.has(b)) sum += this.weightOf(b)
      for (const b of reason) if (bag.has(b)) sum += this.weightOf(b) * REASON_WEIGHT
      const similarity = denom > 0 ? sum / denom : 0
      const hasSlot = this.unfilledSlot(group, kind) != null
      const spread = this.taken[kind].size > 0 && group.index > this.last[kind]
      return { group, similarity, hasSlot, score: similarity + (hasSlot ? SLOT_BONUS : 0) + (spread ? SPREAD_BONUS : 0) }
    })
    let best = scored[0]
    for (const s of scored.slice(1)) {
      if (s.score > best.score + 1e-9 || (Math.abs(s.score - best.score) <= 1e-9 && s.hasSlot && !best.hasSlot)) best = s
    }
    if (best.similarity < MIN_SIMILARITY) {
      // 대조할 말이 없다 — 옛 규칙: 첫 빈자리, 없으면 이 kind 를 아직 받지 않은 다음 묶음, 그것도 없으면 마지막 후보
      best =
        scored.find((s) => s.hasSlot) ??
        scored.find((s) => s.group.index >= 0 && !this.taken[kind].has(s.group.index)) ??
        scored[scored.length - 1]
    }
    const slot = this.unfilledSlot(best.group, kind)
    if (slot != null) this.filled.add(slot)
    this.last[kind] = best.group.index
    this.taken[kind].add(best.group.index)
    return { group: best.group.index, slot }
  }
}

/** 검색 단계 섹션의 스트리밍 인덱스 배정 — 자리를 받으면 그 뼈대 인덱스, 자리 없이 끼워 넣을 섹션은 뼈대 길이 뒤에
 * 도착 순서대로. 최종 병합(composePlanSections)과 같은 배정기(PlanPlacer)를 쓴다 */
export class GeneratedIndexAllocator {
  private readonly placer: PlanPlacer
  private extras = 0

  private readonly skeleton: PlanSkeletonSectionGen[]

  constructor(rawSkeleton: PlanSkeletonSectionGen[]) {
    this.skeleton = orderSkeletonSlots(rawSkeleton)
    this.placer = new PlanPlacer(this.skeleton)
  }

  next(section: PlacedSectionLike): number {
    const placed = this.placer.place(section)
    return placed.slot ?? this.skeleton.length + this.extras++
  }
}

export type ComposedPlan = {
  /** 병합된 섹션 — 채워지지 않은 자리는 null 로 남긴다(미리보기의 자리 카드) */
  sections: (PlanSectionWire | null)[]
  /** null 자리의 인덱스(sections 기준) */
  pending: number[]
}

/** 최종 병합(자리 유지판) — 뼈대 순서를 지키며 검색 섹션을 배정된 자리에 넣고, 자리 없이 배정된 섹션은 그 묶음의 연속
 * 구간에 끼운다(콘텐츠는 그 묶음의 콘텐츠 자리 뒤·없으면 안내 바로 뒤 = 상품 앞, 상품은 구간 끝 — 뼈대의 [안내 → 콘텐츠 → 상품] 순).
 * 뼈대는 orderSkeletonSlots 로 정규화해 쓴다(호출자가 이미 정규화했으면 그대로 — 멱등). 안 채워진 자리는 null + pending */
export function composePlanSections(rawSkeleton: PlanSkeletonSectionGen[], generated: PlanSectionWire[]): ComposedPlan {
  const skeleton = orderSkeletonSlots(rawSkeleton)
  const placer = new PlanPlacer(skeleton)
  const bySlot = new Map<number, PlanSectionWire>()
  const extras = new Map<number, Record<SlotKind, PlanSectionWire[]>>()
  for (const section of generated) {
    if (!isSlotKind(section.kind)) continue
    const placed = placer.place(section)
    if (placed.slot != null) {
      bySlot.set(placed.slot, section)
      continue
    }
    const bucket = extras.get(placed.group) ?? { products: [], contents: [] }
    bucket[section.kind].push(section)
    extras.set(placed.group, bucket)
  }
  const insertBefore = new Map<number, PlanSectionWire[]>() // 뼈대 인덱스(이 앞) → 끼울 섹션들 (콘텐츠 먼저, 상품 다음)
  const queueAt = (position: number, list: PlanSectionWire[]) => {
    if (!list.length) return
    insertBefore.set(position, [...(insertBefore.get(position) ?? []), ...list])
  }
  for (const group of placer.groups) {
    const bucket = extras.get(group.index)
    if (!bucket) continue
    queueAt(group.insertAt.contents, bucket.contents)
    queueAt(group.insertAt.products, bucket.products)
  }
  const sections: (PlanSectionWire | null)[] = []
  const pending: number[] = []
  const flush = (position: number) => {
    const list = insertBefore.get(position)
    if (list) sections.push(...list)
  }
  skeleton.forEach((s, i) => {
    flush(i)
    if (isSlotKind(s.kind)) {
      const filled = bySlot.get(i)
      if (filled) sections.push(filled)
      else {
        pending.push(sections.length)
        sections.push(null)
      }
      return
    }
    // 텍스트 섹션은 와이어 변환을 거친다 — look 은 사양 정규화 + 포인트 파생 (look.ts skeletonSectionWire, 스트리밍 조각과 같은 규칙)
    sections.push(skeletonSectionWire(s) as PlanSectionWire)
  })
  flush(skeleton.length)
  return { sections, pending }
}

/** 최종 병합 — composePlanSections 에서 안 채워진 자리를 뺀 것 */
export function mergePlanSections(skeleton: PlanSkeletonSectionGen[], generated: PlanSectionWire[]): PlanSectionWire[] {
  return composePlanSections(skeleton, generated).sections.filter((s): s is PlanSectionWire => s !== null)
}

/** 상품이 min개 미만인 상품 섹션은 가장 가까운(앞 우선) 다른 상품 섹션에 합친다 — 카드 한 장짜리 가로 트랙을 없앤다
 * (2026-09 운영 기록: 상품 섹션의 23%가 1개짜리). 합칠 다른 상품 섹션이 없으면 그대로 둔다. 이름이 겹치는 상품은 한 번만 */
export function consolidateSmallProductSections(sections: PlanSectionWire[], min = 2): PlanSectionWire[] {
  const productIdx = sections.map((s, i) => (s.kind === 'products' ? i : -1)).filter((i) => i >= 0)
  if (productIdx.length < 2) return sections
  const out = [...sections]
  const removed = new Set<number>()
  for (const i of productIdx) {
    const s = out[i]
    if (s.kind !== 'products' || s.products.length >= min) continue
    const target = productIdx
      .filter((j) => j !== i && !removed.has(j))
      .sort((a, b) => Math.abs(a - i) - Math.abs(b - i) || a - b)[0]
    if (target === undefined) continue
    const t = out[target]
    if (t.kind !== 'products') continue
    const names = new Set(t.products.map((p) => p.name))
    out[target] = { ...t, products: [...t.products, ...s.products.filter((p) => !names.has(p.name))] }
    removed.add(i)
  }
  return removed.size ? out.filter((_, i) => !removed.has(i)) : sections
}
