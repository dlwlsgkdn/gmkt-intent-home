import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [, , inputPath, outputPath] = process.argv

if (!inputPath || !outputPath) {
  console.error('사용법: node scripts/merge-scenarios-to-plan-cases.mjs <입력.json> <출력.json>')
  process.exit(1)
}

const freshId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
const clone = (value) => JSON.parse(JSON.stringify(value))

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
if (!Array.isArray(source) || source.length === 0) {
  throw new Error('입력 JSON은 한 개 이상의 시나리오가 든 배열이어야 합니다.')
}

const queryGroups = new Map()
source.forEach((scenario, index) => {
  if (!scenario || typeof scenario !== 'object' || !scenario.stages) {
    throw new Error(`${index + 1}번째 항목이 시나리오 형식이 아닙니다.`)
  }
  const query = String(scenario.query || '').trim()
  if (!query) throw new Error(`${index + 1}번째 시나리오에 검색어(query)가 없습니다.`)
  if (!queryGroups.has(query)) queryGroups.set(query, [])
  queryGroups.get(query).push(scenario)
})

function cloneItemsWithFreshIds(items) {
  const list = Array.isArray(items) ? items : []
  const idMap = Object.fromEntries(list.map((item) => [item.id, freshId()]))
  return list.map((item) => ({
    ...clone(item),
    id: idMap[item.id],
    parentId: item.parentId ? idMap[item.parentId] : undefined,
  }))
}

function questionSignature(question) {
  return JSON.stringify({
    type: question.type,
    question: question.props?.question || '',
    options: question.props?.options || '',
    multi: !!question.props?.multi,
  })
}

function chipFromQuery(query) {
  return query
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/_+/g, '_')
    .slice(0, 80) || '통합_시나리오'
}

function fallbackItemsFrom(firstPlan, itemWidth) {
  const summary = firstPlan.find((item) => item.type === 'surveySummary')
  const title = firstPlan.find((item) => item.type === 'planTitle')
  const notice = firstPlan.find((item) => item.type === 'noticeCard')
  const fallback = []

  if (summary) fallback.push({ ...clone(summary), id: freshId(), parentId: undefined })
  if (title) {
    fallback.push({
      ...clone(title),
      id: freshId(),
      parentId: undefined,
      props: {
        ...clone(title.props || {}),
        kicker: 'DDAK Plan',
        title: '설문을 완료하면 맞춤 계획을 보여드려요',
      },
    })
  }
  if (notice) {
    fallback.push({
      ...clone(notice),
      id: freshId(),
      parentId: undefined,
      props: {
        ...clone(notice.props || {}),
        title: '설문 선택이 더 필요해요',
        body: '설문 단계에서 베이스 고민, 원하는 피부 표현, 소개팅 장소를 모두 선택해주세요. 선택 조합에 맞는 계획 페이지로 연결해드려요.',
      },
    })
  }

  if (fallback.length === 0) {
    fallback.push(
      {
        id: freshId(),
        type: 'planTitle',
        x: 24,
        y: 24,
        w: itemWidth,
        h: null,
        props: { kicker: 'DDAK Plan', title: '설문을 완료하면 맞춤 계획을 보여드려요' },
      },
      {
        id: freshId(),
        type: 'noticeCard',
        x: 24,
        y: 160,
        w: itemWidth,
        h: null,
        props: {
          title: '설문 선택이 더 필요해요',
          body: '설문 단계의 선택을 모두 완료해주세요. 선택 조합에 맞는 계획 페이지로 연결해드려요.',
        },
      }
    )
  }
  return fallback
}

function mergeGroup(query, scenarios) {
  const first = scenarios[0]
  const originalSurvey = first.stages.survey || []
  const firstQuestions = originalSurvey.filter((item) => item.type === 'surveyQuestion')
  if (firstQuestions.length === 0) throw new Error(`"${query}" 그룹에 설문 질문이 없습니다.`)

  const expectedSignatures = firstQuestions.map(questionSignature)
  const seenCombinations = new Set()

  scenarios.forEach((scenario, index) => {
    const questions = (scenario.stages.survey || []).filter((item) => item.type === 'surveyQuestion')
    const signatures = questions.map(questionSignature)
    if (JSON.stringify(signatures) !== JSON.stringify(expectedSignatures)) {
      throw new Error(`"${query}" 그룹 ${index + 1}번째 시나리오의 설문 질문 구성이 다릅니다.`)
    }
    if (!Array.isArray(scenario.stages.plan) || scenario.stages.plan.length === 0) {
      throw new Error(`"${scenario.title}" 시나리오의 계획 단계가 비어 있습니다.`)
    }
    const answers = questions.map((question) => String(question.props?.defaultAnswer || '').trim())
    if (answers.some((answer) => !answer)) {
      throw new Error(`"${scenario.title}" 시나리오에 미리 선택된 설문 답이 없습니다.`)
    }
    const key = JSON.stringify(answers)
    if (seenCombinations.has(key)) {
      throw new Error(`"${query}" 그룹에 중복 설문 조합이 있습니다: ${answers.join(' / ')}`)
    }
    seenCombinations.add(key)
  })

  const surveyIdMap = Object.fromEntries(originalSurvey.map((item) => [item.id, freshId()]))
  const survey = originalSurvey.map((item) => {
    const next = {
      ...clone(item),
      id: surveyIdMap[item.id],
      parentId: item.parentId ? surveyIdMap[item.parentId] : undefined,
    }
    if (next.type === 'surveyQuestion') {
      next.props = { ...next.props, defaultAnswer: '', locked: false }
    } else if (next.type === 'surveyIntro') {
      next.props = {
        ...next.props,
        desc: '세 가지를 선택하면 조합에 맞는 소개팅 메이크업 계획을 보여드려요.',
      }
    } else if (next.type === 'noticeCard') {
      next.props = {
        ...next.props,
        title: '선택 조합에 맞춰 계획이 달라져요',
        body: `${scenarios.length}개 설문 조합별 계획이 준비되어 있어요. 세 가지 질문을 선택한 뒤 맞춤 계획을 확인해보세요.`,
      }
    }
    return next
  })
  const canonicalQuestionIds = survey
    .filter((item) => item.type === 'surveyQuestion')
    .map((item) => item.id)

  const planCases = scenarios.map((scenario, index) => {
    const answers = (scenario.stages.survey || [])
      .filter((item) => item.type === 'surveyQuestion')
      .map((question) => String(question.props.defaultAnswer).trim())
    return {
      id: freshId(),
      name: `${String(index + 1).padStart(2, '0')} · ${answers.join(' / ')}`,
      conditionMode: 'all',
      conditions: answers.map((answer, answerIndex) => ({
        id: freshId(),
        questionId: canonicalQuestionIds[answerIndex],
        operator: 'includesAny',
        values: [answer],
      })),
      isFallback: false,
      items: cloneItemsWithFreshIds(scenario.stages.plan),
      sourceScenarioId: scenario.id,
      sourceCaseNo: scenario.sourceCaseNo ?? index + 1,
      sourceAnswers: clone(scenario.sourceAnswers || {}),
    }
  })

  const deviceWidths = { desktop: 720, galaxy: 360, 'iphone-se': 375, 'iphone-15': 390, 'iphone-pro-max': 430, tablet: 768 }
  const itemWidth = (deviceWidths[first.device] || 390) - 48
  planCases.push({
    id: freshId(),
    name: '기본 계획 · 설문 미완료',
    conditionMode: 'all',
    conditions: [],
    isFallback: true,
    items: fallbackItemsFrom(first.stages.plan || [], itemWidth),
  })

  const merged = {
    ...clone(first),
    id: freshId(),
    title: query,
    chip: chipFromQuery(query),
    query,
    versions: [],
    status: scenarios.every((scenario) => scenario.status === 'published') ? 'published' : 'draft',
    createdAt: first.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stages: { ...clone(first.stages), survey, plan: [] },
    planCases,
    sourcePackId: `${first.sourcePackId || 'converted'}-merged-plan-cases`,
    sourceCaseCount: scenarios.length,
  }
  delete merged.sourceCaseNo
  delete merged.sourceAnswers
  return merged
}

const converted = [...queryGroups.entries()].map(([query, scenarios]) => mergeGroup(query, scenarios))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(converted, null, 2) + '\n')

console.log(JSON.stringify({
  inputScenarios: source.length,
  queryGroups: queryGroups.size,
  outputScenarios: converted.length,
  planCases: converted.map((scenario) => ({
    query: scenario.query,
    conditional: scenario.planCases.filter((planCase) => !planCase.isFallback).length,
    fallback: scenario.planCases.filter((planCase) => planCase.isFallback).length,
  })),
  outputPath: path.resolve(outputPath),
}, null, 2))
