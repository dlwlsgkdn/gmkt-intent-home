import { CHIP_COLORS, createItem, createPlanCase, uid } from './store.js'
import { LIBRARY } from './registry.jsx'

/*
 * 시나리오 전체(설문 + 골든 계획 케이스) 자동 생성.
 * 계획 케이스 자동 생성(caseGeneration.js)이 "골든 케이스가 이미 있을 때 조합을 늘리는" 도구라면,
 * 이쪽은 그 골든 케이스 자체를 페르소나·검색어·상품만으로 처음부터 만든다.
 *
 * 역할 분담은 동일하다:
 *   코드 = 레이아웃(좌표·컴포넌트 구성·컨테이너 중첩)과 상품 사실(가격·URL 등)
 *   LLM  = 텍스트 슬롯과 카탈로그 내 상품 배치
 * LLM은 좌표를 만들지 않으므로 레이아웃 엔진과 충돌할 수 없다.
 */

/* 검증된 레이아웃 상수 — date-makeup 팩의 실제 케이스 배치에서 가져왔다 */
const X = 24
const W = 672
const SURVEY_INTRO_Y = 194
const SURVEY_Q_Y = 438
const SURVEY_Q_GAP = 164
const PLAN_SUMMARY_Y = 24
const PLAN_TITLE_Y = 178
const PLAN_NOTICE_Y = 300
const PLAN_STEP_Y = 440
const PLAN_GROUP_GAP = 660 // planStep + 상품 패널 한 묶음의 높이
const PLAN_HINT_GAP = 480 // planStep + 상품 자리 안내 카드 묶음 (패널보다 낮다)
const PLAN_STEP_ONLY_GAP = 280 // planStep 단독
const PLAN_PANEL_OFFSET = 280 // planStep → 아래 붙는 패널/안내 카드 간격
const PLAN_CTA_OFFSET = 120 // 마지막 묶음 → CTA
const PRODUCT_CARD_W = 232

export const MIN_QUESTIONS = 2
export const MAX_QUESTIONS = 4
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 6
export const MIN_STEPS = 2
export const MAX_STEPS = 4

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const make = (type, props, y, w = W) => {
  const item = createItem(type, { ...LIBRARY[type].defaults, ...props })
  item.x = X
  item.y = y
  item.w = w
  item.h = null
  return item
}

/* 제목 → 칩 라벨 (기존 팩과 같은 규칙: 공백을 _로) */
export const chipFromTitle = (title) =>
  String(title || '새 시나리오')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w가-힣_·]/g, '')
    .slice(0, 40) || '새_시나리오'

/* 제목 기반 결정적 색상 선택 (Math.random 없이 시나리오마다 다른 색) */
const colorForTitle = (title) => {
  const sum = [...String(title || '')].reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return CHIP_COLORS[sum % CHIP_COLORS.length].color
}

/* ── LLM 요청 · 응답 스키마 ────────────────────────────────────────── */

export const SCENARIO_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'survey', 'plan'],
  properties: {
    title: { type: 'string' },
    survey: {
      type: 'object',
      additionalProperties: false,
      required: ['introKicker', 'introTitle', 'introDesc', 'questions', 'noticeTitle', 'noticeBody'],
      properties: {
        introKicker: { type: 'string' },
        introTitle: { type: 'string' },
        introDesc: { type: 'string' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['question', 'options'],
            properties: {
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        noticeTitle: { type: 'string' },
        noticeBody: { type: 'string' },
      },
    },
    plan: {
      type: 'object',
      additionalProperties: false,
      required: ['summaryTitle', 'titleKicker', 'titleText', 'noticeTitle', 'noticeBody', 'steps', 'cta'],
      properties: {
        summaryTitle: { type: 'string' },
        titleKicker: { type: 'string' },
        titleText: { type: 'string' },
        noticeTitle: { type: 'string' },
        noticeBody: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'desc', 'points', 'groupTitle', 'products', 'productHint'],
            properties: {
              title: { type: 'string' },
              desc: { type: 'string' },
              points: { type: 'string' },
              groupTitle: { type: 'string' },
              /* 카탈로그가 없을 때만 채우는 "어떤 상품을 넣으면 좋을지" 안내 (상품명을 지어내지 않는다) */
              productHint: { type: 'string' },
              products: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['catalogId', 'summary'],
                  properties: {
                    catalogId: { type: 'string' },
                    summary: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        cta: {
          type: 'object',
          additionalProperties: false,
          required: ['countLabel', 'price', 'buttonText'],
          properties: {
            countLabel: { type: 'string' },
            price: { type: 'string' },
            buttonText: { type: 'string' },
          },
        },
      },
    },
  },
}

export function buildScenarioRequest({ persona, query, catalog, questionCount, stepCount, notes }) {
  return {
    schemaVersion: 1,
    persona: String(persona || ''),
    searchQuery: String(query || ''),
    notes: String(notes || ''),
    plan: {
      questionCount: clamp(Number(questionCount) || 3, MIN_QUESTIONS, MAX_QUESTIONS),
      stepCount: clamp(Number(stepCount) || 3, MIN_STEPS, MAX_STEPS),
      optionsPerQuestion: { min: MIN_OPTIONS, max: MAX_OPTIONS },
    },
    catalog: catalog.map((entry) => ({
      id: entry.id,
      brand: entry.brand,
      name: entry.name,
      price: entry.price,
      desc: entry.desc,
    })),
  }
}

export function buildScenarioPrompt(request) {
  const hasCatalog = request.catalog.length > 0
  const productRules = hasCatalog
    ? [
      '3. 각 단계의 products는 catalog의 id 중에서만 고르고, 단계 주제에 맞는 상품을 1~3개 배치합니다. 같은 상품을 여러 단계에 반복하지 않습니다.',
      '4. summary(추천 이유)는 1~2줄, 줄바꿈은 \\n. catalog의 desc와 페르소나에만 근거하고 가격·효능·링크 등 사실을 새로 만들지 않습니다. productHint는 빈 문자열로 둡니다.',
    ]
    : [
      '3. 추천할 상품 목록이 주어지지 않았습니다. products는 반드시 빈 배열([])로 두고, 실제 상품명·브랜드·가격을 절대 만들어내지 마세요.',
      '4. 대신 productHint에 그 단계에 어떤 "종류"의 상품을 넣으면 좋을지 한 문장으로 적습니다. (예: "속당김을 잡아줄 저분자 수분 세럼") 특정 제품명이 아니라 카테고리와 기준으로 씁니다.',
    ]
  return [
    '당신은 쇼핑 시나리오 기획자입니다. 사용자의 검색 의도를 "설문 → 맞춤 계획" 흐름으로 설계합니다.',
    '',
    '만들 것:',
    '1) 설문 화면 — 안내 문구와 선택형 질문들. 각 질문은 계획을 실제로 갈라지게 하는 축이어야 합니다',
    `   (질문 ${request.plan.questionCount}개, 질문당 선택지 ${request.plan.optionsPerQuestion.min}~${request.plan.optionsPerQuestion.max}개).`,
    `2) 계획 화면 — 단계 ${request.plan.stepCount}개. 각 단계는 제목·설명·체크포인트를 가집니다.`,
    '',
    '규칙:',
    '1. 질문의 선택지는 서로 겹치지 않는 짧은 명사구로 씁니다. 선택지 안에 쉼표(,)와 세로줄(|)을 쓰지 않습니다.',
    '2. 질문 축은 사용자가 실제로 다르게 답할 만한 것이어야 합니다(고민·목적·상황 등). 예/아니오 질문은 피합니다.',
    ...productRules,
    '5. points(체크포인트)는 쉼표로 구분한 2~3개의 짧은 실행 항목입니다.',
    '6. 계획 단계는 설문에서 물어본 축의 순서와 대응되게 구성합니다.',
    '7. 페르소나의 호칭·상황을 자연스럽게 반영한 한국어 존댓말로 씁니다.',
    hasCatalog
      ? '8. cta의 price는 배치한 상품 가격의 합으로 씁니다.'
      : '8. 상품이 없으므로 cta의 countLabel과 price는 빈 문자열로 두고, buttonText만 이 계획에 어울리는 다음 행동으로 씁니다.',
    '9. 설명 없이 아래 스키마의 JSON 하나만 출력합니다.',
    '',
    '출력 스키마:',
    JSON.stringify(SCENARIO_RESPONSE_SCHEMA, null, 2),
    '',
    '입력 데이터:',
    JSON.stringify(request, null, 2),
  ].join('\n')
}

/* ── 응답 검증 ─────────────────────────────────────────────────────── */

const stripCodeFence = (value) => {
  const text = String(value || '').trim()
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) return fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

const cleanOption = (value) =>
  String(value || '')
    .replace(/[,|]/g, ' ') // 선택지는 쉼표로 join되므로 내부 쉼표·세로줄 제거
    .replace(/\s+/g, ' ')
    .trim()

export function validateScenarioResponse(raw, request) {
  let payload
  try {
    payload = typeof raw === 'string' ? JSON.parse(stripCodeFence(raw)) : raw
    if (payload && typeof payload.output_text === 'string') {
      payload = JSON.parse(stripCodeFence(payload.output_text))
    }
  } catch (error) {
    return { draft: null, errors: [`JSON 해석 실패: ${error.message}`], warnings: [] }
  }
  if (!payload || typeof payload !== 'object') {
    return { draft: null, errors: ['응답이 JSON 객체가 아닙니다.'], warnings: [] }
  }

  const errors = []
  const warnings = []
  const catalogIds = new Set(request.catalog.map((entry) => entry.id))

  const survey = payload.survey || {}
  const rawQuestions = Array.isArray(survey.questions) ? survey.questions : []
  const questions = rawQuestions
    .map((entry) => {
      const question = String(entry?.question || '').trim()
      const options = (Array.isArray(entry?.options) ? entry.options : [])
        .map(cleanOption)
        .filter(Boolean)
      if (!question || options.length < MIN_OPTIONS) return null
      if (options.length > MAX_OPTIONS) {
        warnings.push(`"${question}"의 선택지가 ${options.length}개라 ${MAX_OPTIONS}개로 줄였습니다.`)
      }
      return { question, options: [...new Set(options)].slice(0, MAX_OPTIONS) }
    })
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS)

  if (questions.length < MIN_QUESTIONS) {
    errors.push(`설문 질문이 ${questions.length}개뿐입니다. 최소 ${MIN_QUESTIONS}개가 필요해요.`)
  }

  const plan = payload.plan || {}
  const rawSteps = Array.isArray(plan.steps) ? plan.steps : []
  const usedProducts = new Set()
  const steps = rawSteps
    .map((entry) => {
      const title = String(entry?.title || '').trim()
      if (!title) return null
      const products = (Array.isArray(entry?.products) ? entry.products : [])
        .map((product) => {
          if (!catalogIds.has(product?.catalogId)) {
            warnings.push(`"${title}": 카탈로그에 없는 상품(${product?.catalogId})을 제외했습니다.`)
            return null
          }
          if (usedProducts.has(product.catalogId)) {
            warnings.push(`"${title}": 다른 단계와 중복된 상품(${product.catalogId})을 제외했습니다.`)
            return null
          }
          usedProducts.add(product.catalogId)
          return { catalogId: product.catalogId, summary: String(product.summary || '') }
        })
        .filter(Boolean)
      return {
        title,
        desc: String(entry?.desc || ''),
        points: String(entry?.points || ''),
        groupTitle: String(entry?.groupTitle || '추천 상품'),
        productHint: String(entry?.productHint || ''),
        products,
      }
    })
    .filter(Boolean)
    .slice(0, MAX_STEPS)

  if (steps.length < MIN_STEPS) {
    errors.push(`계획 단계가 ${steps.length}개뿐입니다. 최소 ${MIN_STEPS}개가 필요해요.`)
  }
  /* 카탈로그를 준 경우에만 "상품이 비었다"가 경고다. 안 준 경우는 의도된 동작 */
  if (catalogIds.size > 0) {
    const emptySteps = steps.filter((step) => step.products.length === 0).length
    if (emptySteps > 0) warnings.push(`상품이 배치되지 않은 단계가 ${emptySteps}개 있습니다.`)
  }

  if (errors.length > 0) return { draft: null, errors, warnings }

  const title = String(payload.title || request.searchQuery || '새 시나리오').trim()
  const cta = plan.cta || {}
  return {
    draft: {
      title,
      survey: {
        introKicker: String(survey.introKicker || 'Personal Brief'),
        introTitle: String(survey.introTitle || title),
        introDesc: String(survey.introDesc || ''),
        questions,
        noticeTitle: String(survey.noticeTitle || '선택 조합에 맞춰 계획이 달라져요'),
        noticeBody: String(survey.noticeBody || ''),
      },
      plan: {
        summaryTitle: String(plan.summaryTitle || '선택 요약'),
        titleKicker: String(plan.titleKicker || 'Plan'),
        titleText: String(plan.titleText || title),
        noticeTitle: String(plan.noticeTitle || '플랜 구성 기준'),
        noticeBody: String(plan.noticeBody || ''),
        steps,
        cta: {
          countLabel: String(cta.countLabel || (usedProducts.size > 0 ? `${usedProducts.size}개 선택` : '')),
          price: String(cta.price || ''),
          buttonText: String(cta.buttonText || '한 번에 담기'),
        },
      },
    },
    errors,
    warnings,
  }
}

/* ── 초안 → 시나리오 조립 ──────────────────────────────────────────── */

export function assembleScenario({ draft, catalog, query }) {
  const catalogById = Object.fromEntries(catalog.map((entry) => [entry.id, entry]))

  /* 설문 화면 */
  const surveyItems = [
    make('profilePanel', { hint: '이번엔 빼고 싶은 항목을 눌러주세요' }, 24),
    make('surveyIntro', {
      kicker: draft.survey.introKicker,
      title: draft.survey.introTitle,
      desc: draft.survey.introDesc,
    }, SURVEY_INTRO_Y),
    ...draft.survey.questions.map((entry, index) =>
      make('surveyQuestion', {
        question: entry.question,
        options: entry.options.join(', '),
        multi: false,
        maxPerRow: String(Math.min(4, entry.options.length)),
        optionShape: 'pill',
        horizontalScroll: true,
        defaultAnswer: '',
        locked: false,
      }, SURVEY_Q_Y + index * SURVEY_Q_GAP)
    ),
    make('noticeCard', {
      title: draft.survey.noticeTitle,
      body: draft.survey.noticeBody,
    }, SURVEY_Q_Y + draft.survey.questions.length * SURVEY_Q_GAP),
  ]

  /* 계획 화면(골든 케이스) — 단계마다 planStep + 가로 스크롤 상품 패널 */
  const planItems = [
    make('surveySummary', { title: draft.plan.summaryTitle }, PLAN_SUMMARY_Y),
    make('planTitle', { kicker: draft.plan.titleKicker, title: draft.plan.titleText }, PLAN_TITLE_Y),
    make('noticeCard', { title: draft.plan.noticeTitle, body: draft.plan.noticeBody }, PLAN_NOTICE_Y),
  ]

  /* 단계마다 붙는 블록 높이가 달라서(상품 패널 / 상품 자리 안내 / 없음) y를 누적한다 */
  let y = PLAN_STEP_Y
  draft.plan.steps.forEach((step, index) => {
    planItems.push(make('planStep', {
      no: String(index + 1),
      title: step.title,
      desc: step.desc,
      points: step.points,
    }, y))

    if (step.products.length === 0) {
      // 상품을 안 받았을 때: 상품을 지어내지 않고, 어떤 상품을 넣을 자리인지만 남긴다
      if (step.productHint.trim()) {
        planItems.push(make('noticeCard', {
          title: `${step.groupTitle} — 상품을 넣을 자리`,
          body: `${step.productHint} · 빌더에서 "추천 상품 카드"를 이 자리에 배치하세요.`,
        }, y + PLAN_PANEL_OFFSET))
        y += PLAN_HINT_GAP
      } else {
        y += PLAN_STEP_ONLY_GAP
      }
      return
    }

    const panel = make('hscroll', {
      title: step.groupTitle,
      cardW: String(PRODUCT_CARD_W),
      scrollbar: false,
      items: '',
    }, y + PLAN_PANEL_OFFSET)
    planItems.push(panel)
    step.products.forEach((pick, slot) => {
      const product = catalogById[pick.catalogId] || {}
      const card = make('productCard', {
        brand: product.brand || '',
        name: product.name || '',
        price: product.price || '',
        was: product.was || '',
        score: product.score || '',
        summary: pick.summary,
        emoji: product.emoji || '🛍️',
        gradient: product.gradient || 'linear-gradient(135deg,#f2ede7,#e4dbd0)',
        external: !!product.external,
        mall: product.mall || '',
        imageUrl: product.imageUrl || '',
        url: product.url || '',
      }, 0, PRODUCT_CARD_W)
      card.x = 0
      card.parentId = panel.id
      card.slot = slot
      planItems.push(card)
    })
    y += PLAN_GROUP_GAP
  })

  planItems.push(make('ctaBar', {
    countLabel: draft.plan.cta.countLabel,
    price: draft.plan.cta.price,
    buttonText: draft.plan.cta.buttonText,
  }, y + PLAN_CTA_OFFSET))

  const generationId = `sgen-${uid()}`
  return {
    title: draft.title,
    chip: chipFromTitle(draft.title),
    query: String(query || draft.title),
    color: colorForTitle(draft.title),
    device: 'desktop',
    compact: 'vertical',
    stages: { survey: surveyItems, plan: [] },
    planCases: [createPlanCase({
      name: '기본 계획',
      isFallback: true,
      items: planItems,
      generation: { id: generationId, kind: 'scenario', generatedAt: new Date().toISOString() },
    })],
  }
}
