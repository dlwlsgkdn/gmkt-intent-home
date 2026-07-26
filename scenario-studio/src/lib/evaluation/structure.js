import { plainEvaluationText } from './model.js'

/*
 * 케이스 → 평가 단위 변환.
 *
 * 평가 단위는 의미 필드가 아니라 실제 렌더링되는 컴포넌트 인스턴스다.
 * 여기서 만든 editableFields가 그대로 AI 왕복(revision/caseRevision/propagation)의
 * 허용 목록이 된다 — 가격·URL 같은 사실 필드는 NON_LLM_EDITABLE_FIELDS로 처음부터 뺀다.
 */

const LAYOUT_TYPES = new Set(['hscroll', 'gridPanel', 'carousel', 'vscroll'])
const STEP_NUMBERS = [1, 2, 3]

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

const positionSort = (left, right) =>
  (left.y - right.y) || (left.x - right.x) || ((left.slot || 0) - (right.slot || 0))

const stepNumberOf = (item, fallback) => {
  const raw = item?.props?.no || item?.props?.badge || ''
  const parsed = Number(String(raw).match(/\d+/)?.[0])
  return STEP_NUMBERS.includes(parsed) ? parsed : fallback
}

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
 * 자식을 가진 레이아웃 컨테이너는 배치 껍데기이므로 중복 평가에서 제외하고,
 * 그 안의 productCard 등 실제 콘텐츠 컴포넌트를 각각 독립 평가한다.
 * 섹션은 planStep 마커의 세로 위치 기준으로 나눈다("이 STEP 아래의 컴포넌트들").
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
