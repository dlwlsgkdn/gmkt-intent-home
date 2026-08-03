import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const [, , inputPath, outputPath] = process.argv

if (!inputPath || !outputPath) {
  console.error('사용법: node scripts/add-external-content-to-plan-cases.mjs <입력.json> <출력.json>')
  process.exit(1)
}

const CATALOG_VERSION = 'date-makeup-youtube-guides-v1'
const freshId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
const clone = (value) => JSON.parse(JSON.stringify(value))

/* 2026-07-23 YouTube 공개 검색 결과에서 확인한 한국어 튜토리얼.
   각 설문 축의 선택지 하나에 콘텐츠 하나를 연결하고, 계획 케이스에서는 세 축을 조합한다. */
const CONTENT_BY_ANSWER = {
  '밀림': {
    id: 'base-pilling',
    title: "'쿠션 안 뜨게 바르는 방법' 분명 있어요!",
    channel: '해니 haeni beauty · 조회수 284만회',
    duration: '15:30',
    url: 'https://www.youtube.com/watch?v=HJ3aqJOOUVM',
  },
  '모공부각': {
    id: 'base-pores',
    title: '모공 순삭 커버 베이스 메이크업',
    channel: 'JUNGSAEMMOOL · 조회수 104만회',
    duration: '18:13',
    url: 'https://www.youtube.com/watch?v=PAorQ4tVqzM',
  },
  '각질': {
    id: 'base-flakes',
    title: '미세한 화장 들뜸·파운데이션 뭉침 원인과 해결책',
    channel: '화이화이해 · 조회수 13만회',
    duration: '12:04',
    url: 'https://www.youtube.com/watch?v=Hm2T5WSw7ig',
  },
  '번들거림': {
    id: 'base-oil',
    title: '기름 무너짐 이제 그만! 10시간 지속력 메이크업',
    channel: '뷰드름 유튜버 인씨 · 조회수 18만회',
    duration: '50:36',
    url: 'https://www.youtube.com/watch?v=Oj40GfCiRYI',
  },
  '다크닝': {
    id: 'base-darkening',
    title: '8시간 지나도 뽀샤시한 다크닝 방지 방법',
    channel: '뷰드름 유튜버 인씨 · 조회수 12만회',
    duration: '31:06',
    url: 'https://www.youtube.com/watch?v=OznNqGlf6iY',
  },
  '뜸': {
    id: 'base-patchy',
    title: '베이스 절대 안 뜨는 법! No-Patchy Base Tip',
    channel: 'PONY Syndrome · 조회수 36만회',
    duration: '17:54',
    url: 'https://www.youtube.com/watch?v=VEGsIvQr5Xc',
  },
  '은은한 물광': {
    id: 'finish-soft-glow',
    title: '매끈하고 은은한 광의 고급진 메이크업',
    channel: '해니 haeni beauty · 조회수 19만회',
    duration: '14:57',
    url: 'https://www.youtube.com/watch?v=DGDQ2Qmeyzo',
  },
  '촉촉한 물광': {
    id: 'finish-dewy-glow',
    title: '청담샵 고급광 베이스 꿀팁',
    channel: '쩡유 JJeong U · 조회수 72만회',
    duration: '20:51',
    url: 'https://www.youtube.com/watch?v=AXX9XoZsx08',
  },
  '뽀송': {
    id: 'finish-matte',
    title: '무더위에도 매끈한 여름철 완벽 베이스 루틴 7단계',
    channel: '다예 Daily Daye · 조회수 162만회',
    duration: '17:10',
    url: 'https://www.youtube.com/watch?v=UYw7tJK6Sz0',
  },
  '얇고 가벼운': {
    id: 'finish-thin',
    title: '베이스 메이크업을 처음 시작하는 여러분에게',
    channel: 'RISABAE · 조회수 150만회',
    duration: '19:28',
    url: 'https://www.youtube.com/watch?v=eaHL8py-GTw',
  },
  '실내 카페·식당': {
    id: 'place-indoor',
    title: '완벽한 첫인상을 남기는 소개팅 메이크업',
    channel: '김크리스탈 KimCrystal · 조회수 8.8만회',
    duration: '10:11',
    url: 'https://www.youtube.com/watch?v=HmsvxY96-OQ',
  },
  '야외': {
    id: 'place-outdoor',
    title: '습함에도 살아남는 오래가는 여름 베이스 루틴',
    channel: '최모나choimona · 조회수 68만회',
    duration: '13:56',
    url: 'https://www.youtube.com/watch?v=msBrj0UoMB0',
  },
  '술자리·장시간': {
    id: 'place-longwear',
    title: '수정화장 필요 없는 완벽한 베이스 루틴',
    channel: '소피 SOPHY · 조회수 19만회',
    duration: '27:45',
    url: 'https://www.youtube.com/watch?v=IF3QGrpGrBw',
  },
}

const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
if (!Array.isArray(source) || source.length === 0) {
  throw new Error('입력 JSON은 한 개 이상의 시나리오가 든 배열이어야 합니다.')
}

const axisKeys = ['base', 'finish', 'place']

function answersFor(planCase) {
  if (planCase.sourceAnswers && axisKeys.every((key) => planCase.sourceAnswers[key])) {
    return axisKeys.map((key) => String(planCase.sourceAnswers[key]).trim())
  }
  const conditions = Array.isArray(planCase.conditions) ? planCase.conditions : []
  return conditions.slice(0, 3).map((condition) => String(condition.values?.[0] || '').trim())
}

function removePreviousCatalog(items) {
  const list = Array.isArray(items) ? items : []
  const catalogParentIds = new Set(
    list
      .filter((item) => item.props?.contentCatalog === CATALOG_VERSION && item.type === 'hscroll')
      .map((item) => item.id)
  )
  return list.filter((item) => (
    item.props?.contentCatalog !== CATALOG_VERSION
    && !catalogParentIds.has(item.parentId)
  ))
}

function addContentGroup(planCase) {
  if (planCase.isFallback) return planCase

  const answers = answersFor(planCase)
  if (answers.length !== 3 || answers.some((answer) => !CONTENT_BY_ANSWER[answer])) {
    throw new Error(`"${planCase.name}" 케이스의 선택값에 대응하는 콘텐츠가 없습니다: ${answers.join(' / ')}`)
  }

  const cleanItems = removePreviousCatalog(planCase.items)
  const cta = cleanItems.find((item) => item.type === 'ctaBar' && !item.parentId)
  const maxTopY = Math.max(0, ...cleanItems.filter((item) => !item.parentId && item !== cta).map((item) => Number(item.y) || 0))
  const panelY = cta ? Number(cta.y) || maxTopY + 380 : maxTopY + 380
  const panelId = freshId()
  const panel = {
    id: panelId,
    type: 'hscroll',
    x: 24,
    y: panelY,
    w: 672,
    h: null,
    props: {
      title: '내 선택에 맞는 메이크업 튜토리얼',
      cardW: '232',
      scrollbar: false,
      items: '',
      contentCatalog: CATALOG_VERSION,
    },
  }
  const cards = answers.map((answer, index) => {
    const content = CONTENT_BY_ANSWER[answer]
    return {
      id: freshId(),
      type: 'videoCard',
      x: 0,
      y: 0,
      w: 232,
      h: null,
      parentId: panelId,
      slot: index,
      props: {
        source: 'YouTube',
        title: content.title,
        channel: content.channel,
        duration: content.duration,
        imageUrl: '',
        url: content.url,
        answerLabel: answer,
        catalogId: content.id,
        contentCatalog: CATALOG_VERSION,
      },
    }
  })

  const withoutCta = cleanItems.filter((item) => item !== cta)
  const nextCta = cta ? { ...cta, y: panelY + 400 } : null
  return {
    ...planCase,
    items: [...withoutCta, panel, ...cards, ...(nextCta ? [nextCta] : [])],
  }
}

const converted = source.map((scenario) => ({
  ...clone(scenario),
  updatedAt: new Date().toISOString(),
  externalContentCatalog: CATALOG_VERSION,
  planCases: (scenario.planCases || []).map(addContentGroup),
}))

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, JSON.stringify(converted, null, 2) + '\n')

const conditionalCases = converted.flatMap((scenario) => scenario.planCases || []).filter((planCase) => !planCase.isFallback)
const videoCards = conditionalCases.flatMap((planCase) => planCase.items || []).filter(
  (item) => item.type === 'videoCard' && item.props?.contentCatalog === CATALOG_VERSION
)
console.log(JSON.stringify({
  scenarios: converted.length,
  conditionalCases: conditionalCases.length,
  contentPanels: conditionalCases.filter((planCase) => planCase.items.some(
    (item) => item.type === 'hscroll' && item.props?.contentCatalog === CATALOG_VERSION
  )).length,
  videoCards: videoCards.length,
  uniqueVideos: new Set(videoCards.map((item) => item.props.url)).size,
  outputPath: path.resolve(outputPath),
}, null, 2))

