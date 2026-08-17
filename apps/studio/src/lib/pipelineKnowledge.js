/*
 * 지식 소스 ↔ 파이프라인 단계 결선 — "이 지식이 어느 단계에 실리는가"를 한 곳에서 계산한다
 * (운영 콘솔 파이프라인 탭: 지식 카드 ↔ 흐름 다이어그램 상호 강조의 원천).
 *
 * 결선의 원천은 두 갈래다:
 *  - **시스템 자리표시자**({{VOCAB}}·{{RULES}}·{{CRITERIA}}·{{FEWSHOT}}): 그 단계의 **실효 프롬프트**
 *    (재정의가 있으면 재정의, 없으면 코드 기본값)에 토큰이 실제로 들어 있는지로 판정한다 — 운영자가
 *    재정의에서 토큰을 지우면 결선도 끊긴 것으로 보이고, 기본값엔 있는데 재정의가 지운 자리는
 *    `dropped`로 따로 남아 "이 단계에서 빠졌다"고 경고할 수 있다.
 *  - **자리표시자가 없는 지식**(원장 경유 가변부·검증 게이트): 프롬프트가 아니라 코드 배선이라
 *    아래 STRUCTURAL_ROUTES 표가 원천이다 (packages/pipeline — ledger.ts·guards/grounding.ts).
 */

/** 자리표시자 밖 결선 — 지식 id → 이 지식이 실제로 소비되는 단계 id */
export const STRUCTURAL_ROUTES = {
  'trend-keywords': ['ledger'], // 원장 trendKeywords → 가변부(설문·계획)로 실린다
  'thread-feedback': ['ledger'], // 원장 recentFeedback (유일한 실데이터)
  'guard-blocklist': ['verify'], // 검증 게이트 정확 매칭 드롭
}

/** 주입 위치별 묶음 — 지식 카드의 그룹 머리 (AdminKnowledgeEntry.injection) */
export const INJECTION_GROUPS = [
  {
    id: 'system',
    label: '시스템 프롬프트에 박힘',
    note: '자리표시자 자리에 통째로 들어가 프롬프트 캐시에 흡수돼요.',
  },
  {
    id: 'user',
    label: '제약 원장 → 요청 가변부',
    note: '2단계 원장에 모여 요청마다 새로 실려요.',
  },
  {
    id: 'guard',
    label: '검증 게이트',
    note: '생성 뒤 6단계에서 대조해 걸러내요.',
  },
]

/** 프롬프트 원문에서 자리표시자를 뺀다 (그 단계로의 유입 끊기) */
export function removePlaceholder(text, token) {
  return text.split(token).join('')
}

/**
 * 프롬프트 원문에 자리표시자를 넣는다 (그 단계로 유입 켜기).
 * 붙박이 지식이 관례상 템플릿 끝에 붙어 있으므로 끝에 이어 붙인다 — 이미 있으면 그대로 둔다.
 * 위치를 손보고 싶으면 단계 레이어 모달의 프롬프트 편집기에서 직접 옮기면 된다.
 */
export function addPlaceholder(text, token) {
  if (text.includes(token)) return text
  return text.replace(/\s*$/, '') + `\n${token}`
}

/**
 * 지식 ↔ 단계 결선 계산.
 * @param knowledge AdminKnowledgeEntry[] (wire.knowledge)
 * @param stages AdminPipelineStage[] (wire.stages — promptId 보유)
 * @param prompts AdminPromptsWire | null (defaultText·configured — 실효 프롬프트 판정용)
 * @returns { byKnowledge: Map<지식id, {stageIds, dropped}>, byStage: Map<단계id, 지식id[]>,
 *            droppedByStage: Map<단계id, 지식id[]> }
 */
export function knowledgeRouting(knowledge, stages, prompts) {
  const promptById = new Map((prompts?.prompts || []).map((p) => [p.id, p]))
  const byKnowledge = new Map()
  const byStage = new Map()
  const droppedByStage = new Map()
  const push = (map, key, value) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }

  for (const entry of knowledge || []) {
    const stageIds = []
    const dropped = []
    if (entry.placeholder) {
      for (const stage of stages || []) {
        const prompt = stage.promptId ? promptById.get(stage.promptId) : null
        if (!prompt) continue
        const effective = prompt.configured ?? prompt.defaultText
        if (effective.includes(entry.placeholder)) stageIds.push(stage.id)
        else if (prompt.defaultText.includes(entry.placeholder)) dropped.push(stage.id)
      }
    }
    for (const id of STRUCTURAL_ROUTES[entry.id] || []) {
      if (!stageIds.includes(id)) stageIds.push(id)
    }
    byKnowledge.set(entry.id, { stageIds, dropped })
    for (const id of stageIds) push(byStage, id, entry.id)
    for (const id of dropped) push(droppedByStage, id, entry.id)
  }
  return { byKnowledge, byStage, droppedByStage }
}
