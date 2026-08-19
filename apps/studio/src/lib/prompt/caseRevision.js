import { LIBRARY } from '../registry.jsx'
import { MIN_ITEM_W } from '../builder/geometry.js'
import {
  componentEvaluationStructureForCase,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  plainEvaluationText,
  remapCaseEvaluation,
} from '../evaluation.js'
import { componentReference } from './scenarioDb.js'
import { parseJsonAnswer } from './jsonAnswer.js'

/*
 * 계획 케이스 통째 재생성 왕복.
 *
 * 필드 단위 수정(revision.js)이 "문구만 바꿀 수 있는" 안전 모델이라면,
 * 이쪽은 케이스의 items 전체를 AI가 다시 구성한다 — 컴포넌트 추가·삭제·순서·배치까지.
 * "영상 카드를 넣어줘", "CTA는 빼줘" 같은 구조 피드백은 이 경로만 처리할 수 있다.
 *
 * 대신 안전장치가 다르다:
 *   · 기존 컴포넌트는 id를 유지시킨다 — 평가 기록이 evaluation.components[itemId]로
 *     키가 걸려 있어, id가 바뀌면 점수·피드백이 전부 고아가 된다
 *   · 유지된 아이템의 사실 필드(가격·이미지·URL 등)는 AI 응답을 버리고 원본을 승계한다
 *   · 새 상품 카드는 카탈로그에서만 고르고, 사실 필드는 카탈로그가 채운다
 *   · 조건(conditions)은 재생성 대상이 아니다 — 다른 케이스들과의 우선순위가 꼬인다
 *   · 부분 적용은 없다. 레이아웃은 통짜라 전부 아니면 전무, 되돌리기는 ⌘Z
 */

/* AI가 값을 정하면 안 되는 사실·설정 필드 (evaluation.js의 NON_LLM_EDITABLE_FIELDS와 동일 철학) */
const FACT_FIELDS = new Set([
  'price', 'was', 'score', 'imageUrl', 'url', 'external', 'mall', 'gradient',
  'emoji', 'no', 'badge', 'hidden', 'hiddenProfile', 'hiddenQuestions',

  // Figma 기준으로 추가된 설정·자산 필드 — 사람이 인스펙터로만 정한다
  'photoUrl', 'beforeImage', 'afterImage', 'split', 'state', 'current', 'total',
  'customOption', 'noticeOpen', 'highlight', 'matchLabel', 'samples',
])

/* 새로 추가된 미디어 카드는 url을 스스로 채울 수 있다(국내 기준 실제 주소만) — 검토 경고 대상 */
const MEDIA_TYPES = new Set(['videoCard', 'articleCard', 'imageCard'])

export const CASE_REVISION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'props'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string' },
          parentId: { type: 'string' },
          slot: { type: 'number' },
          w: { type: 'number' },
          props: { type: 'object' },
        },
      },
    },
  },
}

/* 케이스에 이미 적힌 평가 피드백을 컴포넌트 단위로 모은다 (점수·완료 여부 포함) */
export function collectCaseFeedback(planCase) {
  const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
  const entries = []
  componentEvaluationStructureForCase(planCase).forEach((section) => {
    section.components.forEach((component) => {
      const review = normalizeComponentEvaluation(evaluation.components[component.itemId])
      if (!review.feedback.trim()) return
      entries.push({
        itemId: component.itemId,
        type: component.type,
        preview: component.preview,
        score: review.score,
        resolved: review.resolved,
        feedback: review.feedback.trim(),
      })
    })
  })
  return entries
}

const conditionText = (planCase, surveyQuestions) => {
  if (planCase?.isFallback) return '기본(폴백) 케이스 — 어떤 조건에도 맞지 않을 때 실행'
  const byId = Object.fromEntries(surveyQuestions.map((q) => [q.id, q]))
  const parts = (planCase?.conditions || []).map((condition) => {
    const question = byId[condition.questionId]
    const label = question ? plainEvaluationText(question.props?.question) : condition.questionId
    return `${label}: ${(condition.values || []).join(', ') || condition.operator}`
  })
  return parts.join(' / ') || '(조건 없음)'
}

export function buildCaseRevisionRequest({ scenario, planCase, persona, notes, catalog }) {
  const surveyQuestions = (scenario?.stages?.survey || []).filter((item) => item.type === 'surveyQuestion')
  return {
    schemaVersion: 2, // v2: 순서 모델 — 좌표 없음, items 배열 순서 = 화면 순서
    scenario: { title: scenario?.title || '', query: scenario?.query || scenario?.title || '' },
    persona: String(persona || ''),
    notes: String(notes || ''),
    case: {
      caseId: planCase.id,
      name: planCase.name,
      conditionSummary: conditionText(planCase, surveyQuestions),
      // 케이스 헤더에 기록된 전체 평가 — 재구성의 최우선 지시가 된다
      note: (() => {
        const evaluation = normalizeCaseEvaluation(planCase.evaluation)
        return { score: evaluation.review.score, feedback: evaluation.review.feedback.trim() }
      })(),
    },
    feedback: collectCaseFeedback(planCase),
    catalog: catalog.map((entry) => ({
      brand: entry.brand,
      name: entry.name,
      price: entry.price,
      desc: entry.desc,
    })),
    /* 배열 순서 = 화면 순서. 컨테이너 자식만 parentId/slot(+카드 폭 w)을 갖는다 */
    currentItems: (planCase.items || []).map((item) => ({
      id: item.id,
      type: item.type,
      ...(item.parentId ? { parentId: item.parentId, slot: item.slot || 0, ...(item.w != null ? { w: item.w } : {}) } : {}),
      props: item.props || {},
    })),
  }
}

export function buildCaseRevisionPrompt(request) {
  return [
    '당신은 쇼핑 시나리오 페이지 에디터입니다.',
    '아래 계획 케이스 페이지(currentItems)를 피드백에 맞게 다시 구성하세요.',
    '컴포넌트 추가·삭제·순서 변경·문구 수정이 모두 가능합니다.',
    '',
    '규칙:',
    '0. case.note.feedback(케이스 전체 피드백)과 feedback[](컴포넌트별 피드백), notes(추가 지시)를 모두 반영합니다.',
    '1. **유지하는 컴포넌트는 id를 반드시 그대로 둡니다.** 평가 기록이 id에 연결되어 있습니다.',
    '   새로 추가하는 컴포넌트만 새 id(16자 내외 영숫자, 목록 안에서 유일)를 만듭니다.',
    '2. 피드백이 없는 컴포넌트는 되도록 그대로 유지합니다(불필요한 재작성 금지).',
    '3. 가격·이미지·URL 등 사실 정보는 만들지 않습니다. 유지한 컴포넌트의 사실 필드는 어차피 원본 값으로 되돌려집니다.',
    '4. 새 상품 카드(productCard)는 catalog 목록의 브랜드·상품명만 사용합니다. 카탈로그 밖 상품을 지어내지 마세요.',
    '5. 새 영상·게시글·이미지 카드(videoCard/articleCard/imageCard)는 대한민국 기준으로 실제 확인한 콘텐츠만 씁니다.',
    '   url·imageUrl은 확인된 실제 주소만 넣고, 확인 못 했으면 빈 문자열("")로 둡니다. 주소를 지어내면 안 됩니다.',
    '6. 배치 규칙:',
    '   - 좌표는 없습니다. items 배열의 순서가 곧 화면의 위→아래 순서입니다.',
    '   - 컨테이너(hscroll/gridPanel/carousel/vscroll)의 자식은 같은 items 배열에 parentId와 slot(0부터)으로 넣습니다.',
    '   - 자식 카드의 폭이 중요하면 w(px)를 줄 수 있습니다(예: 상품 카드 232). 최상위에는 w를 넣지 않습니다.',
    '   - 컨테이너 안에 컨테이너를 넣지 않습니다.',
    '7. summary에는 무엇을 추가/삭제/수정했고 왜 그랬는지 2~4문장으로 적습니다.',
    '8. 설명 없이 아래 스키마의 JSON 하나만 출력합니다. items에는 유지·수정·추가된 컴포넌트 전부를 담습니다(빠진 id는 삭제로 처리됩니다).',
    '',
    '사용할 수 있는 컴포넌트:',
    componentReference(),
    '',
    '출력 스키마:',
    JSON.stringify(CASE_REVISION_RESPONSE_SCHEMA, null, 2),
    '',
    '케이스 데이터:',
    JSON.stringify(request, null, 2),
  ].join('\n')
}

/* ── 응답 검증 ─────────────────────────────────────────────────────── */

const allowedPropKeys = (type) => new Set(Object.keys(LIBRARY[type]?.defaults || {}))

export function validateCaseRevisionResponse(raw, request, { originalItems, catalog }) {
  let payload
  try {
    payload = parseJsonAnswer(raw)
  } catch (error) {
    return { items: null, errors: [`JSON 해석 실패: ${error.message}`], warnings: [], summary: '', diff: null }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) {
    return { items: null, errors: ['응답에서 items 배열을 찾을 수 없습니다.'], warnings: [], summary: '', diff: null }
  }

  const errors = []
  const warnings = []
  const originalById = Object.fromEntries(originalItems.map((item) => [item.id, item]))
  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]))
  const seenIds = new Set()
  const items = []

  payload.items.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {}
    const id = String(row.id || '')
    const type = String(row.type || '')
    const label = `${index + 1}번(${type || '타입 없음'})`
    const def = LIBRARY[type]
    if (!id) { errors.push(`${label}: id가 없습니다.`); return }
    if (seenIds.has(id)) { errors.push(`${label}: id "${id}"가 중복됩니다.`); return }
    if (!def) { errors.push(`${label}: 없는 컴포넌트 타입입니다.`); return }
    if (def.stage !== 'plan' && def.stage !== 'common') {
      errors.push(`${label}: ${def.stage} 단계 컴포넌트는 계획 케이스에 넣을 수 없습니다.`)
      return
    }
    const original = originalById[id]
    if (original && original.type !== type) {
      errors.push(`${label}: 기존 id "${id}"의 타입을 ${original.type}에서 바꿀 수 없습니다. 타입을 바꾸려면 새 id로 추가하세요.`)
      return
    }
    if (!row.props || typeof row.props !== 'object' || Array.isArray(row.props)) {
      errors.push(`${label}: props가 객체가 아닙니다.`)
      return
    }

    const allowed = allowedPropKeys(type)
    let props
    if (original) {
      // 유지 아이템: 원본 props에서 시작한다 — 팩·생성 흐름이 붙여 둔 메타데이터
      // (catalogId, contentCatalog 등 레지스트리 밖 키)를 잃지 않기 위해서다.
      // AI 응답에서는 레지스트리에 정의된 편집 가능 키만 덮고, 사실 필드는 건드리지 않는다.
      props = JSON.parse(JSON.stringify(original.props || {}))
      Object.entries(row.props).forEach(([key, value]) => {
        if (!allowed.has(key) || FACT_FIELDS.has(key)) return
        props[key] = typeof value === 'boolean' ? value : String(value ?? '')
      })
    } else {
      // 새 아이템: 레지스트리에 정의된 키만 통과 (설정 오염 방지)
      props = {}
      const unknown = []
      Object.entries(row.props).forEach(([key, value]) => {
        if (!allowed.has(key)) { unknown.push(key); return }
        props[key] = typeof value === 'boolean' ? value : String(value ?? '')
      })
      if (unknown.length) warnings.push(`${label}: 정의에 없는 필드 ${unknown.join(', ')}를 제외했습니다.`)
    }

    if (!original && type === 'productCard') {
      // 새 상품: 카탈로그 대조 — 사실 필드는 카탈로그가 채운다
      const name = plainEvaluationText(props.name)
      const entry = catalogByName.get(name)
      if (!entry) {
        warnings.push(`${label}: "${name}"이(가) 카탈로그에 없어 가격·링크를 비웠습니다. 확인 후 직접 채워주세요.`)
        FACT_FIELDS.forEach((key) => delete props[key])
      } else {
        props.brand = entry.brand
        props.price = entry.price
        if (entry.was) props.was = entry.was
        if (entry.imageUrl) props.imageUrl = entry.imageUrl
        if (entry.url) props.url = entry.url
        if (entry.mall) props.mall = entry.mall
        if (entry.emoji) props.emoji = entry.emoji
        if (entry.gradient) props.gradient = entry.gradient
        if (entry.score) props.score = entry.score
        if (entry.external) props.external = true
      }
    } else if (!original && MEDIA_TYPES.has(type)) {
      const urls = ['url', 'imageUrl'].map((key) => String(props[key] || '')).filter(Boolean)
      if (urls.length) warnings.push(`${label}: 새 외부 주소가 있습니다 — 실제로 열리는지 확인해주세요. (${urls.join(', ')})`)
    }

    seenIds.add(id)
    const isChild = !!row.parentId
    items.push({
      id,
      type,
      ...(isChild
        ? {
            parentId: String(row.parentId),
            slot: Math.max(0, Math.round(Number(row.slot) || 0)),
            ...(row.w != null ? { w: Math.max(MIN_ITEM_W, Math.round(Number(row.w))) } : {}),
          }
        : {}),
      props,
    })
  })

  // 컨테이너 관계 검증 — parentId는 같은 목록의 컨테이너를 가리켜야 하고, 컨테이너는 중첩 불가
  const byId = Object.fromEntries(items.map((item) => [item.id, item]))
  items.forEach((item) => {
    if (LIBRARY[item.type]?.container && item.parentId) {
      errors.push(`"${item.id}": 레이아웃 안에 레이아웃은 넣을 수 없습니다.`)
    }
    if (item.parentId) {
      const parent = byId[item.parentId]
      if (!parent) errors.push(`"${item.id}": parentId "${item.parentId}"가 목록에 없습니다.`)
      else if (!LIBRARY[parent.type]?.container) errors.push(`"${item.id}": parentId가 컨테이너가 아닙니다.`)
    }
  })
  // 유지 아이템의 카드 크기(w/h)는 원본을 승계한다 — AI가 좌우할 값이 아니다
  items.forEach((item) => {
    const original = originalById[item.id]
    if (!original) return
    if (original.w != null && item.parentId) item.w = original.w
    if (original.h != null && item.parentId) item.h = original.h
  })

  if (items.length === 0 && errors.length === 0) errors.push('items가 비어 있습니다.')

  /* diff — 적용 전에 사람이 판단할 근거 */
  const originalIds = new Set(originalItems.map((item) => item.id))
  const nextIds = new Set(items.map((item) => item.id))
  const added = items.filter((item) => !originalIds.has(item.id))
  const removed = originalItems.filter((item) => !nextIds.has(item.id))
  const kept = items.filter((item) => originalIds.has(item.id))
  const changed = kept.filter((item) => {
    const original = originalById[item.id]
    return JSON.stringify(item.props) !== JSON.stringify(original.props || {})
      || !!item.parentId !== !!original.parentId
  })

  return {
    items: errors.length > 0 ? null : items,
    errors,
    warnings,
    summary: String(payload.summary || ''),
    diff: {
      total: items.length,
      added: added.map((item) => ({ id: item.id, type: item.type, label: LIBRARY[item.type]?.label || item.type })),
      removed: removed.map((item) => ({ id: item.id, type: item.type, label: LIBRARY[item.type]?.label || item.type })),
      changedCount: changed.length,
      keptCount: kept.length - changed.length,
    },
  }
}

/* 검증 통과한 items를 케이스에 반영 — 평가 기록은 유지된 id만 승계하고 삭제된 id는 함께 버린다 */
export function mergeRevisedCase(planCase, validated) {
  const identity = {}
  const nextIds = new Set(validated.items.map((item) => item.id))
  ;(planCase.items || []).forEach((item) => {
    if (nextIds.has(item.id)) identity[item.id] = item.id
  })
  const evaluation = normalizeCaseEvaluation(planCase.evaluation)
  const droppedRecords = Object.entries(evaluation.components).filter(([itemId, review]) => {
    if (nextIds.has(itemId)) return false
    const normalized = normalizeComponentEvaluation(review)
    return normalized.score != null || normalized.feedback.trim()
  }).length

  return {
    planCase: {
      ...planCase,
      items: validated.items,
      evaluation: remapCaseEvaluation(planCase.evaluation, identity),
    },
    droppedRecords,
  }
}

/* 삭제될 컴포넌트 중 평가 기록(점수 또는 피드백)이 있는 개수 — 적용 전 경고용 */
export function countRemovedRecords(planCase, diff) {
  if (!diff) return 0
  const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
  return diff.removed.filter((entry) => {
    const review = normalizeComponentEvaluation(evaluation.components[entry.id])
    return review.score != null || review.feedback.trim()
  }).length
}
