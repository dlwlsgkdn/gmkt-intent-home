const clampRating = (value) => {
  const rating = Number(value)
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0
}

const nullableRating = (value) => {
  if (value == null || value === '') return null
  return clampRating(value)
}

export const EVALUATION_CASE_SLOTS = ['A', 'B', 'C']
export const EVALUATION_STEPS = [1, 2, 3]
export const EVALUATION_TARGETS = [
  { key: 'title', label: '제목', shortLabel: '제목' },
  { key: 'recommendation', label: '단계 추천', shortLabel: '단계 추천' },
  { key: 'product', label: '상품 추천', shortLabel: '상품 추천' },
]
export const EVALUATION_TOTAL_COUNT =
  EVALUATION_CASE_SLOTS.length * EVALUATION_STEPS.length * EVALUATION_TARGETS.length
export const EVALUATION_MAX_SCORE = EVALUATION_TOTAL_COUNT * 5

export const evaluationCriterionKey = (step, targetKey) => `step${step}.${targetKey}`

export function normalizeCriterionEvaluation(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    score: nullableRating(value.score),
    feedback: String(value.feedback || ''),
    resolved: !!value.resolved,
    updatedAt: value.updatedAt ? String(value.updatedAt) : null,
  }
}

export function normalizeComponentEvaluation(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    score: nullableRating(value.score),
    feedback: String(value.feedback || ''),
    resolved: !!value.resolved,
    updatedAt: value.updatedAt ? String(value.updatedAt) : null,
  }
}

export function normalizeCaseEvaluation(raw = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const components = value.components && typeof value.components === 'object' && !Array.isArray(value.components)
    ? Object.fromEntries(
        Object.entries(value.components).map(([itemId, review]) => [
          String(itemId),
          normalizeComponentEvaluation(review),
        ])
      )
    : {}
  const criteria = value.criteria && typeof value.criteria === 'object' && !Array.isArray(value.criteria)
    ? Object.fromEntries(
        Object.entries(value.criteria).map(([criterionKey, review]) => [
          String(criterionKey),
          normalizeCriterionEvaluation(review),
        ])
      )
    : {}
  return {
    selected: !!value.selected,
    slot: EVALUATION_CASE_SLOTS.includes(value.slot) ? value.slot : null,
    // 케이스 전체 평가 — 컴포넌트에 달기 애매한 피드백("영상을 넣어줘" 등)의 자리
    score: nullableRating(value.score),
    feedback: String(value.feedback || ''),
    components,
    criteria,
    updatedAt: value.updatedAt ? String(value.updatedAt) : null,
  }
}

/* 계획 케이스나 시나리오 복제 시 컴포넌트 평가 메모가 새 item id를 따라가게 한다. */
export function remapCaseEvaluation(raw, itemIdMap, overrides = {}) {
  const evaluation = normalizeCaseEvaluation(raw)
  const components = {}
  Object.entries(evaluation.components).forEach(([itemId, review]) => {
    const nextId = itemIdMap[itemId]
    if (nextId) components[nextId] = { ...review }
  })
  return normalizeCaseEvaluation({
    ...evaluation,
    ...overrides,
    components,
  })
}

const conditionTokens = (planCase) => {
  if (planCase?.isFallback) return new Set(['__fallback__'])
  const tokens = new Set()
  ;(planCase?.conditions || []).forEach((condition) => {
    if (!condition.questionId) return
    const values = Array.isArray(condition.values) && condition.values.length > 0
      ? condition.values
      : ['__answer_state__']
    values.forEach((value) => {
      tokens.add(`${condition.questionId}:${condition.operator || 'includesAny'}:${String(value)}`)
    })
  })
  return tokens
}

const similarity = (left, right) => {
  if (left.size === 0 && right.size === 0) return 1
  let overlap = 0
  left.forEach((token) => {
    if (right.has(token)) overlap++
  })
  const union = new Set([...left, ...right]).size
  return union > 0 ? overlap / union : 0
}

const hasMeaningfulContent = (item) =>
  Object.values(item?.props || {}).some((value) =>
    typeof value === 'string' ? value.trim().length >= 4 : value != null
  )

/*
 * 대표 케이스 추천 점수(100점):
 * - 세그먼트 구체성 30: 질문·조건·선택값이 실제로 정의됐는지
 * - 콘텐츠 완성도 34: 노출 컴포넌트 수·종류·실제 문구
 * - 케이스 차별성 24: 다른 조건 조합과 얼마나 겹치지 않는지
 * - 운영 중요도 12: 조건 케이스의 실행 가능성 또는 기본 폴백 역할
 *
 * 사용자가 입력한 1~5점은 추천 순위에 섞지 않는다. 추천과 평가를 분리해야
 * 낮게 평가한 중요 케이스도 다음 보강 대상으로 계속 남기 때문이다.
 */
export function rankSignificantCases(planCases = []) {
  const signatures = planCases.map(conditionTokens)
  return planCases
    .map((planCase, index) => {
      const conditions = (planCase.conditions || []).filter((condition) => condition.questionId)
      const questionCount = new Set(conditions.map((condition) => condition.questionId)).size
      const valueCount = conditions.reduce(
        (sum, condition) => sum + Math.max(1, (condition.values || []).length),
        0
      )
      const visibleItems = (planCase.items || []).filter((item) => !item.hidden)
      const typeCount = new Set(visibleItems.map((item) => item.type)).size
      const filledCount = visibleItems.filter(hasMeaningfulContent).length

      const segmentScore = planCase.isFallback
        ? 10
        : Math.min(14, conditions.length * 5)
          + Math.min(10, questionCount * 5)
          + Math.min(6, valueCount * 2)
      const contentScore =
        Math.min(18, visibleItems.length * 3)
        + Math.min(10, Math.round(typeCount * 2.5))
        + Math.min(6, filledCount)

      const peers = signatures.filter((_, peerIndex) => peerIndex !== index)
      const maxSimilarity = peers.length > 0
        ? Math.max(...peers.map((peer) => similarity(signatures[index], peer)))
        : 0.25
      const differentiationScore = Math.round((1 - maxSimilarity) * 24)
      const operationalScore = planCase.isFallback
        ? 12
        : Math.min(12, (conditions.length > 0 ? 8 : 0) + (questionCount > 1 ? 2 : 0) + (valueCount > 1 ? 2 : 0))
      const score = Math.max(0, Math.min(100, segmentScore + contentScore + differentiationScore + operationalScore))

      const reasons = []
      if (planCase.isFallback) reasons.push('모든 조건 미일치 사용자를 받는 기본 안전망')
      else if (questionCount >= 2) reasons.push(`${questionCount}개 설문 축을 조합한 구체적인 세그먼트`)
      else if (conditions.length > 0) reasons.push('명시적인 설문 조건으로 타깃이 정의됨')
      if (visibleItems.length >= 4) reasons.push(`노출 컴포넌트 ${visibleItems.length}개 · ${typeCount}종으로 구성`)
      else if (visibleItems.length > 0) reasons.push(`핵심 컴포넌트 ${visibleItems.length}개로 구성`)
      if (differentiationScore >= 18 && planCases.length > 1) reasons.push('다른 케이스와 조건 중복이 낮음')

      const issues = []
      if (visibleItems.length === 0) issues.push('실행 화면이 비어 있음')
      if (!planCase.isFallback && conditions.length === 0) issues.push('유효한 설문 조건이 없음')
      if (visibleItems.length > 0 && filledCount < visibleItems.length) {
        issues.push(`내용을 더 채울 컴포넌트 ${visibleItems.length - filledCount}개`)
      }

      return {
        caseId: planCase.id,
        index,
        score,
        reasons: reasons.slice(0, 3),
        issues,
        metrics: { conditions: conditions.length, questions: questionCount, items: visibleItems.length, types: typeCount },
      }
    })
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
}

export function recommendSignificantCaseIds(planCases, count) {
  const limit = Math.max(1, Math.min(planCases.length, Number(count) || 1))
  const ranked = rankSignificantCases(planCases)
  if (ranked.length <= 1) return ranked.map((entry) => entry.caseId)

  /*
   * 조합형 시나리오는 완성도가 같은 케이스가 수십 개일 수 있다.
   * 단순 상위 N개를 자르면 인접한 유사 조합만 뽑히므로, 첫 케이스 이후에는
   * 자동 점수 + 이미 고른 조건들과의 최소 차별성을 함께 최대화한다(MMR 방식).
   */
  const byId = Object.fromEntries(planCases.map((planCase) => [planCase.id, planCase]))
  const selected = [ranked[0]]
  while (selected.length < limit) {
    const next = ranked
      .filter((entry) => !selected.some((chosen) => chosen.caseId === entry.caseId))
      .map((entry) => {
        const signature = conditionTokens(byId[entry.caseId])
        const closestSimilarity = Math.max(
          ...selected.map((chosen) => similarity(signature, conditionTokens(byId[chosen.caseId])))
        )
        return {
          entry,
          shortlistScore: entry.score + Math.round((1 - closestSimilarity) * 24),
        }
      })
      .sort((left, right) =>
        (right.shortlistScore - left.shortlistScore)
        || (right.entry.score - left.entry.score)
        || (left.entry.index - right.entry.index)
      )[0]
    if (!next) break
    selected.push(next.entry)
  }
  return selected.map((entry) => entry.caseId)
}

/* 케이스에 사람 평가 흔적(별점·피드백)이 있는가 —
   로테이션 제외 기준이자 전파의 씨앗/대상 경계("본 케이스는 씨앗, 안 본 케이스만 대상") */
export function caseHasEvaluationInput(planCase) {
  const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
  if (evaluation.score != null || evaluation.feedback.trim()) return true
  return Object.values(evaluation.components).some(
    (review) => review.score != null || review.feedback.trim()
  )
}

/*
 * 케이스 리더보드 — 평가된 케이스를 평균 별점 내림차순으로 순위 매긴다.
 * 로테이션으로 라운드가 쌓여도 평가 자산이 흩어지지 않는 자리이며,
 * 이 순위가 피드백 전체 반영의 씨앗 우선순위(상위 N개)로 그대로 쓰인다.
 */
export function evaluationLeaderboard(planCases = []) {
  return planCases
    .map((planCase, index) => ({ planCase, index }))
    .filter(({ planCase }) => caseHasEvaluationInput(planCase))
    .map(({ planCase, index }) => {
      const evaluation = normalizeCaseEvaluation(planCase.evaluation)
      const reviews = Object.values(evaluation.components)
      const ratings = reviews
        .filter((review) => review.score != null)
        .map((review) => review.score)
      if (evaluation.score != null) ratings.push(evaluation.score)
      const feedbackCount = reviews.filter((review) => review.feedback.trim()).length
        + (evaluation.feedback.trim() ? 1 : 0)
      return {
        caseId: planCase.id,
        planCase,
        index,
        slot: evaluation.selected ? evaluation.slot : null,
        average: ratings.length > 0
          ? Math.round((ratings.reduce((sum, score) => sum + score, 0) / ratings.length) * 10) / 10
          : null,
        ratedCount: ratings.length,
        feedbackCount,
      }
    })
    .sort((left, right) =>
      ((right.average ?? -1) - (left.average ?? -1))
      || (right.feedbackCount - left.feedbackCount)
      || (left.index - right.index)
    )
    .map((entry, order) => ({ ...entry, rank: order + 1 }))
}

/*
 * 미평가 케이스 로테이션: 재선정은 평가 흔적이 있는 케이스를 후보에서 빼고 뽑는다 —
 * 이미 본 케이스를 다시 뽑으면 평가의 정보 이득이 없기 때문. 미평가가 모자라면
 * 평가된 케이스로 채워 A/B/C 3개 구성은 항상 유지한다.
 */
export function recommendRotationCaseIds(planCases, count) {
  const fresh = planCases.filter((planCase) => !caseHasEvaluationInput(planCase))
  const ids = fresh.length > 0
    ? recommendSignificantCaseIds(fresh, Math.min(count, fresh.length))
    : []
  const freshCount = ids.length
  if (ids.length < count) {
    const picked = new Set(ids)
    const rest = planCases.filter((planCase) => !picked.has(planCase.id))
    if (rest.length > 0) ids.push(...recommendSignificantCaseIds(rest, count - ids.length))
  }
  return { ids: ids.slice(0, count), freshCount }
}

export function evaluationStats(planCases = []) {
  const selectedCases = planCases.filter((planCase) => normalizeCaseEvaluation(planCase.evaluation).selected)
  const reviews = selectedCases.flatMap((planCase) =>
    Object.values(normalizeCaseEvaluation(planCase.evaluation).components)
  )
  const pending = reviews.filter((review) => review.feedback.trim() && !review.resolved).length
  const resolved = reviews.filter((review) => review.feedback.trim() && review.resolved).length
  const ratings = reviews.filter((review) => review.score != null).map((review) => review.score)
  return {
    selected: selectedCases.length,
    pending,
    resolved,
    rated: ratings.length,
    average: ratings.length > 0
      ? Math.round((ratings.reduce((sum, score) => sum + score, 0) / ratings.length) * 10) / 10
      : 0,
  }
}

export function evaluationCasesFor(planCases = []) {
  const selected = planCases.filter((planCase) => normalizeCaseEvaluation(planCase.evaluation).selected)
  return [...selected].sort((left, right) => {
    const leftSlot = EVALUATION_CASE_SLOTS.indexOf(normalizeCaseEvaluation(left.evaluation).slot)
    const rightSlot = EVALUATION_CASE_SLOTS.indexOf(normalizeCaseEvaluation(right.evaluation).slot)
    const safeLeft = leftSlot >= 0 ? leftSlot : 999
    const safeRight = rightSlot >= 0 ? rightSlot : 999
    return safeLeft - safeRight
  })
}

const LAYOUT_TYPES = new Set(['hscroll', 'gridPanel', 'carousel', 'vscroll'])
const SAFE_COMPONENT_FIELD_LABELS = {
  kicker: '키커',
  title: '제목',
  body: '본문',
  question: '질문',
  options: '선택지',
  desc: '설명',
  points: '체크포인트',
  brand: '브랜드',
  name: '상품명',
  summary: '추천 이유',
  label: '라벨',
  text: '문구',
  items: '항목',
  button: '버튼 문구',
}
const NON_LLM_EDITABLE_FIELDS = new Set([
  'price', 'was', 'score', 'imageUrl', 'url', 'external', 'mall', 'gradient',
  'emoji', 'no', 'badge', 'cardW', 'panelH', 'cols',
])

const componentPreviewText = (item) => {
  const props = item?.props || {}
  const preferred = [
    props.title,
    props.name,
    props.question,
    props.desc,
    props.body,
    props.summary,
    props.text,
  ]
    .map(plainEvaluationText)
    .filter(Boolean)
  if (preferred.length > 0) return preferred.slice(0, 2).join(' · ')
  return Object.values(props)
    .filter((value) => typeof value === 'string')
    .map(plainEvaluationText)
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ') || '입력된 내용이 없습니다.'
}

const componentEditableFields = (item) =>
  Object.entries(item?.props || {})
    .filter(([fieldKey, value]) =>
      typeof value === 'string'
      && !NON_LLM_EDITABLE_FIELDS.has(fieldKey)
    )
    .map(([fieldKey, value]) => ({
      itemId: item.id,
      itemType: item.type,
      fieldKey,
      fieldLabel: SAFE_COMPONENT_FIELD_LABELS[fieldKey] || fieldKey,
      value,
    }))

/*
 * 평가 단위는 의미 필드가 아니라 실제 렌더링되는 컴포넌트 인스턴스다.
 * 자식을 가진 레이아웃 컨테이너는 배치 껍데기이므로 중복 평가에서 제외하고,
 * 그 안의 productCard 등 실제 콘텐츠 컴포넌트를 각각 독립 평가한다.
 */
export function componentEvaluationStructureForCase(planCase) {
  const items = Array.isArray(planCase?.items) ? planCase.items : []
  const visibleItems = items.filter((item) => !item.hidden)
  const byId = Object.fromEntries(visibleItems.map((item) => [item.id, item]))
  const childrenByParent = new Map()
  visibleItems.forEach((item) => {
    if (!item.parentId) return
    const children = childrenByParent.get(item.parentId) || []
    children.push(item)
    childrenByParent.set(item.parentId, children)
  })
  childrenByParent.forEach((children) => {
    children.sort((left, right) => ((left.slot || 0) - (right.slot || 0)) || positionSort(left, right))
  })

  const topAncestor = (item) => {
    let current = item
    const visited = new Set()
    while (current?.parentId && byId[current.parentId] && !visited.has(current.parentId)) {
      visited.add(current.id)
      current = byId[current.parentId]
    }
    return current || item
  }
  const orderMeta = (item) => {
    const root = topAncestor(item)
    return {
      y: Number(root.y) || 0,
      x: Number(root.x) || 0,
      slot: Number(item.slot) || 0,
    }
  }
  const visualSort = (left, right) => {
    const a = orderMeta(left)
    const b = orderMeta(right)
    return (a.y - b.y) || (a.x - b.x) || (a.slot - b.slot) || positionSort(left, right)
  }
  const stepItems = visibleItems
    .filter((item) => item.type === 'planStep' && !item.parentId)
    .sort(positionSort)
    .map((item, index) => ({
      item,
      step: stepNumberOf(item, index + 1),
      y: Number(item.y) || 0,
    }))

  const evaluableItems = visibleItems
    .filter((item) => {
      const hasChildren = (childrenByParent.get(item.id) || []).length > 0
      return !(hasChildren && LAYOUT_TYPES.has(item.type))
    })
    .sort(visualSort)

  const sections = new Map()
  evaluableItems.forEach((item, index) => {
    const anchorY = orderMeta(item).y
    const marker = [...stepItems]
      .filter((entry) => entry.y <= anchorY || entry.item.id === item.id)
      .sort((left, right) => right.y - left.y)[0] || null
    const key = marker ? `step${marker.step}` : 'common'
    if (!sections.has(key)) {
      sections.set(key, {
        key,
        step: marker?.step || null,
        title: marker
          ? plainEvaluationText(marker.item.props?.title) || `STEP ${marker.step}`
          : '공통 결과',
        components: [],
      })
    }
    sections.get(key).components.push({
      index,
      item,
      itemId: item.id,
      type: item.type,
      reviewKey: `component:${item.id}`,
      preview: componentPreviewText(item),
      editableFields: componentEditableFields(item),
    })
  })

  return [...sections.values()]
}

export function structuredComponentEvaluationStats(planCases = []) {
  const selectedCases = evaluationCasesFor(planCases)
  const caseStats = EVALUATION_CASE_SLOTS.map((slot) => {
    const planCase = selectedCases.find(
      (candidate) => normalizeCaseEvaluation(candidate.evaluation).slot === slot
    ) || null
    const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
    const sections = componentEvaluationStructureForCase(planCase)
    const sectionStats = sections.map((section) => {
      const componentStats = section.components.map((component) => ({
        component,
        review: normalizeComponentEvaluation(evaluation.components[component.itemId]),
      }))
      const completed = componentStats.filter(({ review }) => review.score != null).length
      const score = componentStats.reduce((sum, { review }) => sum + (review.score ?? 0), 0)
      return {
        ...section,
        componentStats,
        completed,
        total: componentStats.length,
        score,
        maxScore: componentStats.length * 5,
      }
    })
    return {
      slot,
      planCase,
      sections,
      sectionStats,
      completed: sectionStats.reduce((sum, section) => sum + section.completed, 0),
      total: sectionStats.reduce((sum, section) => sum + section.total, 0),
      score: sectionStats.reduce((sum, section) => sum + section.score, 0),
      maxScore: sectionStats.reduce((sum, section) => sum + section.maxScore, 0),
    }
  })

  const byType = new Map()
  caseStats.forEach((caseStat) => {
    caseStat.sectionStats.forEach((section) => {
      section.componentStats.forEach(({ component, review }) => {
        const stat = byType.get(component.type) || {
          type: component.type,
          completed: 0,
          total: 0,
          score: 0,
        }
        stat.total++
        if (review.score != null) {
          stat.completed++
          stat.score += review.score
        }
        byType.set(component.type, stat)
      })
    })
  })
  const typeStats = [...byType.values()].map((stat) => ({
    ...stat,
    average: stat.completed > 0
      ? Math.round((stat.score / stat.completed) * 10) / 10
      : null,
  }))
  const completed = caseStats.reduce((sum, caseStat) => sum + caseStat.completed, 0)
  const total = caseStats.reduce((sum, caseStat) => sum + caseStat.total, 0)
  const score = caseStats.reduce((sum, caseStat) => sum + caseStat.score, 0)
  const maxScore = caseStats.reduce((sum, caseStat) => sum + caseStat.maxScore, 0)
  return {
    completed,
    total,
    progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    score,
    maxScore,
    average: completed > 0 ? Math.round((score / completed) * 10) / 10 : null,
    caseStats,
    typeStats,
  }
}

const positionSort = (left, right) =>
  (left.y - right.y) || (left.x - right.x) || ((left.slot || 0) - (right.slot || 0))

const stepNumberOf = (item, fallback) => {
  const raw = item?.props?.no || item?.props?.badge || ''
  const parsed = Number(String(raw).match(/\d+/)?.[0])
  return EVALUATION_STEPS.includes(parsed) ? parsed : fallback
}

/*
 * 실행 화면의 실제 컴포넌트를 3 STEP × 3 평가항목으로 연결한다.
 * 제목/단계 추천은 planStep의 title/desc에, 상품 추천은 해당 STEP 다음의
 * 상품 컨테이너(또는 첫 상품)에 연결해 "수정하러 가기"가 실제 편집기로 이동한다.
 */
export function evaluationStructureForCase(planCase) {
  const items = Array.isArray(planCase?.items) ? planCase.items : []
  const topItems = items.filter((item) => !item.parentId).sort(positionSort)
  const stepItems = topItems
    .filter((item) => item.type === 'planStep')
    .map((item, index) => ({ item, step: stepNumberOf(item, index + 1) }))
    .sort((left, right) => left.step - right.step)

  return EVALUATION_STEPS.map((step) => {
    const matched = stepItems.find((entry) => entry.step === step)
      || stepItems[step - 1]
      || null
    const stepItem = matched?.item || null
    const nextStepItem = stepItems
      .map((entry) => entry.item)
      .filter((item) => item.y > (stepItem?.y ?? -1))
      .sort(positionSort)[0]
    const productContainers = topItems.filter((item) => {
      if (!stepItem || item.y <= stepItem.y) return false
      if (nextStepItem && item.y >= nextStepItem.y) return false
      const children = items.filter((child) => child.parentId === item.id)
      return children.some((child) => child.type === 'productCard')
    })
    const productContainer = productContainers[0] || null
    const productItems = productContainer
      ? items
          .filter((item) => item.parentId === productContainer.id && item.type === 'productCard')
          .sort((left, right) => (left.slot || 0) - (right.slot || 0))
      : items
          .filter((item) =>
            item.type === 'productCard'
            && (!stepItem || item.y > stepItem.y)
            && (!nextStepItem || item.y < nextStepItem.y)
          )
          .sort(positionSort)
    // 첫 상품을 직접 선택하면 인스펙터의 상품명 필드와 부모 Navigator가 함께 열려
    // 상품 묶음 전체를 빠르게 교체·정렬할 수 있다.
    const productTarget = productItems[0] || productContainer || null
    const productNames = productItems
      .map((item) => plainEvaluationText(item.props?.name))
      .filter(Boolean)
    const editableField = (item, fieldKey, fieldLabel) => item
      ? {
          itemId: item.id,
          itemType: item.type,
          fieldKey,
          fieldLabel,
          value: String(item.props?.[fieldKey] ?? ''),
        }
      : null

    return {
      step,
      title: plainEvaluationText(stepItem?.props?.title) || '결과 없음',
      targets: [
        {
          key: 'title',
          label: '제목',
          itemId: stepItem?.id || null,
          fieldKey: 'title',
          preview: plainEvaluationText(stepItem?.props?.title) || '제목 결과가 없습니다.',
          supportingItemIds: stepItem ? [stepItem.id] : [],
          editableFields: [
            editableField(stepItem, 'title', '단계 제목'),
          ].filter(Boolean),
        },
        {
          key: 'recommendation',
          label: '단계 추천',
          itemId: stepItem?.id || null,
          fieldKey: 'desc',
          preview: [
            plainEvaluationText(stepItem?.props?.desc),
            plainEvaluationText(stepItem?.props?.points),
          ].filter(Boolean).join(' · ') || '단계 추천 결과가 없습니다.',
          supportingItemIds: stepItem ? [stepItem.id] : [],
          editableFields: [
            editableField(stepItem, 'desc', '설명'),
            editableField(stepItem, 'points', '체크포인트'),
          ].filter(Boolean),
        },
        {
          key: 'product',
          label: '상품 추천',
          itemId: productTarget?.id || null,
          fieldKey: productItems[0] ? 'name' : 'title',
          preview: productNames.length > 0
            ? productNames.join(' · ')
            : plainEvaluationText(productTarget?.props?.name) || '상품 추천 결과가 없습니다.',
          supportingItemIds: [
            ...(productContainer ? [productContainer.id] : []),
            ...productItems.map((item) => item.id),
          ],
          editableFields: productItems.flatMap((item, index) => [
            editableField(item, 'name', `상품 ${index + 1} 이름`),
            editableField(item, 'summary', `상품 ${index + 1} 추천 이유`),
          ]).filter(Boolean),
        },
      ],
    }
  })
}

export function structuredEvaluationStats(planCases = []) {
  const selectedCases = evaluationCasesFor(planCases)
  const caseStats = EVALUATION_CASE_SLOTS.map((slot) => {
    const planCase = selectedCases.find(
      (candidate) => normalizeCaseEvaluation(candidate.evaluation).slot === slot
    ) || null
    const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
    const stepStats = EVALUATION_STEPS.map((step) => {
      const reviews = EVALUATION_TARGETS.map((target) =>
        normalizeCriterionEvaluation(evaluation.criteria[evaluationCriterionKey(step, target.key)])
      )
      const completed = reviews.filter((review) => review.score != null).length
      const score = reviews.reduce((sum, review) => sum + (review.score ?? 0), 0)
      return { step, completed, total: 3, score, maxScore: 15, reviews }
    })
    return {
      slot,
      planCase,
      completed: stepStats.reduce((sum, step) => sum + step.completed, 0),
      total: 9,
      score: stepStats.reduce((sum, step) => sum + step.score, 0),
      maxScore: 45,
      stepStats,
    }
  })

  const targetStats = EVALUATION_TARGETS.map((target) => {
    const scores = caseStats.flatMap((caseStat) =>
      EVALUATION_STEPS.map((step) => {
        const review = normalizeCriterionEvaluation(
          normalizeCaseEvaluation(caseStat.planCase?.evaluation)
            .criteria[evaluationCriterionKey(step, target.key)]
        )
        return review.score
      })
    ).filter((score) => score != null)
    return {
      ...target,
      completed: scores.length,
      average: scores.length > 0
        ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
        : null,
    }
  })

  const completed = caseStats.reduce((sum, caseStat) => sum + caseStat.completed, 0)
  const score = caseStats.reduce((sum, caseStat) => sum + caseStat.score, 0)
  return {
    completed,
    total: EVALUATION_TOTAL_COUNT,
    progress: Math.round((completed / EVALUATION_TOTAL_COUNT) * 100),
    score,
    maxScore: EVALUATION_MAX_SCORE,
    average: completed > 0 ? Math.round((score / completed) * 10) / 10 : null,
    caseStats,
    targetStats,
  }
}

export function plainEvaluationText(value) {
  return String(value || '')
    .replace(/\{\{[^|{}]*\|([^{}]*?)\}\}/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
