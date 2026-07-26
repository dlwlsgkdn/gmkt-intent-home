import { createPlanCase, splitOptions, uid } from '../store.js'
import { plainEvaluationText } from '../evaluation.js'
import { parseJsonAnswer } from './jsonAnswer.js'

/*
 * 계획 케이스 자동 생성 파이프라인.
 * 원칙: 사람 = 구조(골든 케이스 레이아웃)·사실(상품 카탈로그)·페르소나 소유,
 *       LLM  = 텍스트 슬롯 채움 + 카탈로그 내 상품 선택.
 * 좌표·컴포넌트 구성은 골든 케이스를 복제하므로 LLM이 레이아웃을 건드릴 수 없다.
 */

export const GENERATION_BATCH_SIZE = 6

/* LLM이 채우면 안 되는 사실·설정 필드 (llmRevision의 NON_LLM_EDITABLE_FIELDS 확장판) */
const NON_GENERATED_FIELDS = new Set([
  'price', 'was', 'score', 'imageUrl', 'url', 'external', 'mall', 'gradient',
  'emoji', 'no', 'badge', 'cardW', 'panelH', 'cols', 'maxPerRow', 'optionShape',
  'defaultAnswer', 'hidden', 'hiddenProfile', 'hiddenQuestions', 'items', 'contentCatalog', 'answerLabel', 'catalogId',
  'source', 'channel', 'duration', 'scrollbar', 'options',
])

/* 외부 콘텐츠(영상 등)는 사실 필드라 생성 대상에서 제외 — 골든 케이스 것을 그대로 복제 */
const NON_GENERATED_TYPES = new Set(['videoCard'])

const FIELD_LABELS = {
  kicker: '키커', title: '제목', body: '본문', question: '질문', desc: '설명',
  points: '체크포인트', brand: '브랜드', name: '상품명', summary: '추천 이유',
  label: '라벨', text: '문구', button: '버튼 문구', hint: '안내 문구',
}

/* ── 설문 축 · 조합 전개 ───────────────────────────────────────────── */

export function generationAxes(surveyItems = []) {
  return surveyItems
    .filter((item) => item.type === 'surveyQuestion' && !item.hidden)
    .map((item) => ({
      questionId: item.id,
      question: plainEvaluationText(item.props?.question) || '설문',
      // 조건 값은 플레이어 답변과 같은 main만 — "메인|서브|상세" 원문이 새면 조건이 영영 안 맞는다
      options: splitOptions(item.props?.options).map((option) => option.main).filter(Boolean),
    }))
    .filter((axis) => axis.options.length > 0)
}

export function expandCombinations(axes = []) {
  let combos = [[]]
  axes.forEach((axis) => {
    combos = combos.flatMap((combo) =>
      axis.options.map((option) => [...combo, { questionId: axis.questionId, question: axis.question, value: option }])
    )
  })
  if (axes.length === 0) return []
  return combos.map((answers) => ({
    key: answers.map((answer) => answer.value).join(' / '),
    answers,
  }))
}

/* 케이스의 조건을 조합 시그니처로 환원 — "이미 있는 조합 제외"에 사용 */
export function caseComboSignature(planCase) {
  if (!planCase || planCase.isFallback) return null
  const tokens = (planCase.conditions || [])
    .filter((condition) => condition.questionId && (condition.values || []).length === 1)
    .map((condition) => `${condition.questionId}:${condition.values[0]}`)
  if (tokens.length === 0) return null
  return tokens.sort().join('|')
}

export function comboSignature(combo) {
  return combo.answers.map((answer) => `${answer.questionId}:${answer.value}`).sort().join('|')
}

/* ── 골든 케이스 → 템플릿 슬롯 추출 ────────────────────────────────── */

const positionSort = (left, right) =>
  ((left.y || 0) - (right.y || 0)) || ((left.x || 0) - (right.x || 0)) || ((left.slot || 0) - (right.slot || 0))

export function templateFromCase(goldenCase) {
  const items = (goldenCase?.items || []).filter((item) => !item.hidden)
  const byId = Object.fromEntries(items.map((item) => [item.id, item]))
  const rootOf = (item) => {
    let current = item
    const visited = new Set()
    while (current?.parentId && byId[current.parentId] && !visited.has(current.parentId)) {
      visited.add(current.id)
      current = byId[current.parentId]
    }
    return current || item
  }
  const orderedItems = [...items].sort((left, right) =>
    positionSort(rootOf(left), rootOf(right)) || ((left.slot || 0) - (right.slot || 0))
  )

  const textSlots = []
  const productSlots = []
  orderedItems.forEach((item) => {
    if (NON_GENERATED_TYPES.has(item.type)) return
    if (item.type === 'productCard') {
      productSlots.push({
        itemId: item.id,
        label: `상품 슬롯 ${productSlots.length + 1}`,
        goldenName: plainEvaluationText(item.props?.name) || '',
        goldenSummary: String(item.props?.summary || ''),
      })
      return
    }
    Object.entries(item.props || {}).forEach(([fieldKey, value]) => {
      if (typeof value !== 'string' || !value.trim()) return
      if (NON_GENERATED_FIELDS.has(fieldKey)) return
      textSlots.push({
        itemId: item.id,
        itemType: item.type,
        fieldKey,
        fieldLabel: FIELD_LABELS[fieldKey] || fieldKey,
        goldenValue: value,
      })
    })
  })

  return { goldenCase, items: goldenCase?.items || [], textSlots, productSlots }
}

/* ── 상품 카탈로그 ─────────────────────────────────────────────────── */

/* 시나리오의 모든 케이스에 등장하는 productCard를 카탈로그 초안으로 수집 */
export function catalogFromScenario(planCases = []) {
  const seen = new Map()
  planCases.forEach((planCase) => {
    ;(planCase.items || []).forEach((item) => {
      if (item.type !== 'productCard') return
      const name = plainEvaluationText(item.props?.name)
      if (!name || seen.has(name)) return
      seen.set(name, {
        brand: plainEvaluationText(item.props?.brand) || '',
        name,
        price: String(item.props?.price || ''),
        was: String(item.props?.was || ''),
        desc: plainEvaluationText(item.props?.summary).split('\n')[0] || '',
        emoji: String(item.props?.emoji || ''),
        gradient: String(item.props?.gradient || ''),
        imageUrl: String(item.props?.imageUrl || ''),
        url: String(item.props?.url || ''),
        mall: String(item.props?.mall || ''),
        external: !!item.props?.external,
        score: String(item.props?.score || ''),
      })
    })
  })
  return [...seen.values()]
}

export function catalogToText(entries = []) {
  return entries
    .map((entry) => [entry.brand, entry.name, entry.price, entry.was, entry.desc].join(' | '))
    .join('\n')
}

/* "브랜드 | 상품명 | 가격 | 정가 | 특징" 한 줄 = 상품 하나. 기존 카탈로그와 상품명이 같으면 사실 필드 승계 */
export function parseCatalogText(text, baseEntries = []) {
  const baseByName = Object.fromEntries(baseEntries.map((entry) => [entry.name, entry]))
  const entries = []
  const errors = []
  String(text || '').split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const parts = trimmed.split('|').map((part) => part.trim())
    if (parts.length < 2 || !parts[1]) {
      errors.push(`${index + 1}행: "브랜드 | 상품명 | 가격 | 정가 | 특징" 형식이 필요합니다.`)
      return
    }
    const base = baseByName[parts[1]] || {}
    entries.push({
      id: `p${entries.length + 1}`,
      brand: parts[0] || base.brand || '',
      name: parts[1],
      price: parts[2] || base.price || '',
      was: parts[3] || base.was || '',
      desc: parts[4] || base.desc || '',
      emoji: base.emoji || '🧴',
      gradient: base.gradient || 'linear-gradient(135deg,#f2ede7,#e4dbd0)',
      imageUrl: base.imageUrl || '',
      url: base.url || '',
      mall: base.mall || '',
      external: !!base.external,
      score: base.score || '',
    })
  })
  return { entries, errors }
}

/* ── LLM 요청 · 응답 스키마 ────────────────────────────────────────── */

export const GENERATION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cases'],
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['comboKey', 'texts', 'products'],
        properties: {
          comboKey: { type: 'string' },
          texts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['itemId', 'fieldKey', 'text'],
              properties: {
                itemId: { type: 'string' },
                fieldKey: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
          products: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['itemId', 'catalogId', 'summary'],
              properties: {
                itemId: { type: 'string' },
                catalogId: { type: 'string' },
                summary: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

export function buildGenerationRequest({ scenario, persona, axes, combos, template, catalog, notes }) {
  const goldenAnswers = (template.goldenCase?.conditions || [])
    .filter((condition) => condition.questionId && (condition.values || []).length > 0)
    .map((condition) => condition.values[0])
  return {
    schemaVersion: 1,
    scenario: {
      title: scenario?.title || '',
      query: scenario?.query || scenario?.title || '',
    },
    persona: String(persona || ''),
    notes: String(notes || ''),
    axes: axes.map((axis) => ({ questionId: axis.questionId, question: axis.question, options: axis.options })),
    combos: combos.map((combo) => ({ comboKey: combo.key, answers: combo.answers })),
    goldenExample: {
      comboKey: goldenAnswers.join(' / ') || '(조건 없음)',
      texts: template.textSlots.map((slot) => ({
        itemId: slot.itemId,
        itemType: slot.itemType,
        fieldKey: slot.fieldKey,
        fieldLabel: slot.fieldLabel,
        value: slot.goldenValue,
      })),
      products: template.productSlots.map((slot) => ({
        itemId: slot.itemId,
        label: slot.label,
        name: slot.goldenName,
        summary: slot.goldenSummary,
      })),
    },
    allowedTextSlots: template.textSlots.map((slot) => ({
      itemId: slot.itemId,
      itemType: slot.itemType,
      fieldKey: slot.fieldKey,
      fieldLabel: slot.fieldLabel,
    })),
    productSlots: template.productSlots.map((slot) => ({ itemId: slot.itemId, label: slot.label })),
    catalog: catalog.map((entry) => ({
      id: entry.id,
      brand: entry.brand,
      name: entry.name,
      price: entry.price,
      desc: entry.desc,
    })),
  }
}

export function buildGenerationPrompt(request) {
  return [
    '당신은 쇼핑 시나리오 콘텐츠 작가입니다. 설문 답변 조합별 "계획 케이스" 콘텐츠를 생성합니다.',
    '',
    '규칙:',
    '1. combos의 comboKey마다 정확히 하나의 케이스를 cases에 만듭니다.',
    '2. texts는 allowedTextSlots에 있는 itemId/fieldKey 조합마다 하나씩 만들고, 그 외 조합은 쓰지 않습니다.',
    '3. products는 productSlots의 itemId마다 하나씩, catalog의 id 중 해당 조합에 가장 적합한 상품을 고릅니다. 한 케이스 안에서 같은 상품을 중복 선택하지 않습니다(카탈로그가 부족할 때만 예외).',
    '4. summary(추천 이유)는 1~2줄, 줄바꿈은 \\n. catalog의 desc와 조합 특성에만 근거하고 가격·효능·링크 등 사실을 새로 만들지 않습니다.',
    '5. 문체·길이·구성은 goldenExample을 따르되, 조합마다 조합의 답변이 드러나게 표현을 달리합니다. 케이스 간에 같은 문장을 복사하지 않습니다.',
    '6. goldenExample에 {{옵션|텍스트}} 또는 [[키워드]] 마크업이 있으면 같은 방식으로 활용해도 좋습니다(필수 아님).',
    '7. persona와 scenario.query의 검색 의도를 반영해 한국어로 작성합니다.',
    '8. 설명 없이 아래 스키마의 JSON 하나만 출력합니다.',
    '',
    '출력 스키마:',
    JSON.stringify(GENERATION_RESPONSE_SCHEMA, null, 2),
    '',
    '입력 데이터:',
    JSON.stringify(request, null, 2),
  ].join('\n')
}

/* ── 응답 검증 ─────────────────────────────────────────────────────── */

export function validateGenerationResponse(raw, request) {
  let payload
  try {
    payload = parseJsonAnswer(raw)
    if (payload && typeof payload.output_text === 'string') payload = JSON.parse(stripCodeFence(payload.output_text))
  } catch (error) {
    return { cases: [], errors: [`JSON 해석 실패: ${error.message}`], warnings: [] }
  }
  if (!payload || !Array.isArray(payload.cases)) {
    return { cases: [], errors: ['cases 배열을 찾을 수 없습니다.'], warnings: [] }
  }

  const requestedKeys = new Set(request.combos.map((combo) => combo.comboKey))
  const textSlotKeys = new Set(request.allowedTextSlots.map((slot) => `${slot.itemId}:${slot.fieldKey}`))
  const productItemIds = new Set(request.productSlots.map((slot) => slot.itemId))
  const catalogIds = new Set(request.catalog.map((entry) => entry.id))

  const errors = []
  const warnings = []
  const cases = []
  const seenKeys = new Set()

  payload.cases.forEach((rawCase) => {
    const comboKey = String(rawCase?.comboKey || '')
    if (!requestedKeys.has(comboKey)) {
      warnings.push(`요청하지 않은 조합 "${comboKey}"은(는) 제외했습니다.`)
      return
    }
    if (seenKeys.has(comboKey)) {
      warnings.push(`"${comboKey}" 조합이 중복 생성되어 첫 번째만 사용합니다.`)
      return
    }
    seenKeys.add(comboKey)

    const texts = {}
    ;(Array.isArray(rawCase.texts) ? rawCase.texts : []).forEach((entry) => {
      const key = `${entry?.itemId}:${entry?.fieldKey}`
      if (!textSlotKeys.has(key)) {
        warnings.push(`"${comboKey}": 허용되지 않은 텍스트 슬롯(${key})을 제외했습니다.`)
        return
      }
      if (typeof entry.text !== 'string') return
      texts[key] = entry.text
    })

    const products = {}
    ;(Array.isArray(rawCase.products) ? rawCase.products : []).forEach((entry) => {
      if (!productItemIds.has(entry?.itemId)) {
        warnings.push(`"${comboKey}": 허용되지 않은 상품 슬롯(${entry?.itemId})을 제외했습니다.`)
        return
      }
      if (!catalogIds.has(entry?.catalogId)) {
        warnings.push(`"${comboKey}": 카탈로그에 없는 상품(${entry?.catalogId})을 제외했습니다.`)
        return
      }
      products[entry.itemId] = { catalogId: entry.catalogId, summary: String(entry.summary || '') }
    })

    const missingTexts = [...textSlotKeys].filter((key) => !(key in texts)).length
    const missingProducts = [...productItemIds].filter((itemId) => !(itemId in products)).length
    if (missingTexts > 0) warnings.push(`"${comboKey}": 텍스트 슬롯 ${missingTexts}개가 비어 골든 케이스 문구를 유지합니다.`)
    if (missingProducts > 0) warnings.push(`"${comboKey}": 상품 슬롯 ${missingProducts}개가 비어 골든 케이스 상품을 유지합니다.`)

    cases.push({ comboKey, texts, products })
  })

  const missingCombos = [...requestedKeys].filter((key) => !seenKeys.has(key))
  missingCombos.forEach((key) => errors.push(`"${key}" 조합이 응답에 없습니다.`))

  return { cases, errors, warnings, missingCombos }
}

/* ── 생성 결과 → 계획 케이스 조립 ──────────────────────────────────── */

export function assembleGeneratedCase({ template, combo, generated, catalog, generationId, sequence }) {
  const catalogById = Object.fromEntries(catalog.map((entry) => [entry.id, entry]))
  const idMap = {}
  template.items.forEach((item) => { idMap[item.id] = uid() })

  const items = template.items.map((item) => {
    const props = JSON.parse(JSON.stringify(item.props || {}))

    if (item.type === 'productCard' && generated.products[item.id]) {
      const pick = generated.products[item.id]
      const product = catalogById[pick.catalogId]
      if (product) {
        props.brand = product.brand
        props.name = product.name
        props.price = product.price
        props.was = product.was
        props.emoji = product.emoji
        props.gradient = product.gradient
        props.imageUrl = product.imageUrl
        props.url = product.url
        props.mall = product.mall
        props.external = product.external
        if (product.score) props.score = product.score
        props.summary = pick.summary || props.summary
      }
    } else {
      Object.keys(props).forEach((fieldKey) => {
        const key = `${item.id}:${fieldKey}`
        if (key in generated.texts) props[fieldKey] = generated.texts[key]
      })
    }

    return {
      ...item,
      id: idMap[item.id],
      parentId: item.parentId ? idMap[item.parentId] : undefined,
      props,
      style: item.style ? { ...item.style } : undefined,
    }
  })

  const values = combo.answers.map((answer) => answer.value)
  return createPlanCase({
    name: `${String(sequence).padStart(2, '0')} · ${values.join(' / ')}`,
    conditionMode: 'all',
    conditions: combo.answers.map((answer) => ({
      id: uid(),
      questionId: answer.questionId,
      operator: 'includesAny',
      values: [answer.value],
    })),
    isFallback: false,
    items,
    sourceAnswers: Object.fromEntries(combo.answers.map((answer) => [answer.questionId, answer.value])),
    generation: {
      id: generationId,
      comboKey: combo.key,
      generatedAt: new Date().toISOString(),
      sourceCaseId: template.goldenCase?.id || null,
    },
  })
}
