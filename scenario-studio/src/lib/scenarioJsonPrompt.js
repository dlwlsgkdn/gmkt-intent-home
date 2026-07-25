import { LIBRARY } from './registry.jsx'
import { CHIP_COLORS, DEVICE_PRESETS } from './store.js'

/*
 * "AI 프롬프트 생성" — 시나리오 DB JSON(내보내기와 같은 형식)을 통째로 만들어 달라는 프롬프트.
 *
 * 앞서 만든 시나리오 생성(scenarioGeneration.js)은 레이아웃을 코드가 소유하고 LLM은 텍스트만 채우는 방식이라
 * 구성이 스캐폴드에 고정된다. 이 경로는 반대로 LLM에게 DB JSON 전체(컴포넌트 선택·좌표 포함)를 맡겨
 * 자유로운 구성을 얻고, 결과는 기존 "가져오기"와 동일한 검증(normalizeScenario)을 거쳐 들어온다.
 * 컴포넌트 목록은 레지스트리에서 자동 생성하므로 컴포넌트가 늘면 프롬프트도 따라 늘어난다.
 */

const STAGE_LABEL = {
  survey: '설문 단계 (stages.survey)',
  plan: '계획 단계 (planCases[].items)',
  common: '공통 — 설문·계획 어디서나 사용',
}

/* 레지스트리 → 컴포넌트 사양 문서. props는 defaults를 그대로 보여줘 키·타입을 알 수 있게 한다 */
export function componentReference() {
  const groups = { survey: [], plan: [], common: [] }
  Object.entries(LIBRARY).forEach(([type, def]) => {
    if (!groups[def.stage]) return // explore 전용 컴포넌트는 시나리오 생성 대상이 아니다
    const notes = []
    if (def.container) notes.push('컨테이너 — 다른 컴포넌트를 자식으로 담는다')
    if (def.defaultW) notes.push(`기본 너비 ${def.defaultW}`)
    groups[def.stage].push(
      `- "${type}" · ${def.label}${notes.length ? ` (${notes.join(', ')})` : ''}\n`
      + `  props: ${JSON.stringify(def.defaults || {})}`
    )
  })
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([stage, list]) => `[${STAGE_LABEL[stage]}]\n${list.join('\n')}`)
    .join('\n\n')
}

/* 조합 폭발을 사용자가 미리 가늠할 수 있게 — 질문 수^선택지 수 */
export function combinationCount(questionCount, optionCount) {
  return Math.pow(Number(optionCount) || 0, Number(questionCount) || 0)
}

const SHAPE_DOC = `시나리오 하나는 아래 형태의 객체입니다. 최종 출력은 이 객체 하나를 담은 **배열**입니다.

{
  "title": "시나리오 제목",
  "chip": "홈에_노출될_칩_라벨",          // 공백 대신 _
  "query": "사용자가 홈에서 검색할 문장",
  "device": "desktop",                    // ${DEVICE_PRESETS.map((d) => d.key).join(' | ')}
  "color": "${CHIP_COLORS[0].color}",                     // 칩 색상 (${CHIP_COLORS.map((c) => c.color).join(', ')} 중 하나)
  "compact": "vertical",
  "status": "draft",
  "stages": { "survey": [ ...아이템... ] },
  "planCases": [
    {
      "name": "케이스 이름",
      "conditionMode": "all",              // all = 모든 조건 만족, any = 하나만 만족
      "conditions": [
        { "questionId": "<설문 질문 아이템의 id>", "operator": "includesAny", "values": ["선택지 텍스트"] }
      ],
      "isFallback": false,                 // 마지막 케이스 하나는 반드시 true (조건 미일치 시 실행)
      "evaluation": { "selected": true, "slot": "A" },   // 평가 대상 3개에만. slot은 "A"/"B"/"C"
      "items": [ ...아이템... ]
    }
  ]
}

아이템(컴포넌트) 하나는 이 형태입니다.

{
  "id": "고유문자열",        // 16자 내외 영숫자. 시나리오 안에서 유일해야 합니다
  "type": "surveyQuestion",  // 아래 목록의 type
  "x": 24,
  "y": 194,
  "w": 672,
  "h": null,                 // null = 자동 높이 (항상 null 권장)
  "props": { ... }           // 아래 목록의 props 키만 사용
}

컨테이너(가로 스크롤 등)에 담는 자식 아이템은 같은 items 배열에 두고 부모를 가리킵니다.

{ "id": "...", "type": "productCard", "x": 0, "y": 0, "w": 232, "h": null,
  "parentId": "<컨테이너 아이템의 id>", "slot": 0, "props": { ... } }`

const LAYOUT_RULES = `배치 규칙:
- 최상위 아이템은 x=24, w=672로 두고 y만 늘려가며 세로로 쌓습니다. 겹치지 않게 충분히 띄우세요.
- 권장 y 간격: 설문 질문 164, 안내/제목 카드 120~250, 계획 단계 카드 280, 가로 스크롤 패널 380.
- 계획 케이스 items는 보통 이 순서입니다: surveySummary → planTitle → noticeCard → (planStep → hscroll(+productCard 자식)) 반복 → hscroll(+videoCard/articleCard 자식) → ctaBar.
- 컨테이너 자식은 x=0, y=0, slot을 0부터 매기고 w는 컨테이너 props.cardW와 맞춥니다(예: 232).
- 컨테이너 안에 컨테이너를 넣지 않습니다.

조건 규칙:
- conditions[].questionId는 stages.survey에 넣은 surveyQuestion 아이템의 id와 정확히 일치해야 합니다.
- values는 그 질문 props.options에 실제로 있는 선택지 문자열이어야 합니다(options는 쉼표로 구분된 하나의 문자열).
- 케이스 배열의 마지막 하나는 isFallback: true로 두고 conditions는 빈 배열로 둡니다.

계획 구성 규칙 (가장 중요):
- **질문 하나에 계획 단계 하나를 1:1로 대응시키지 마세요.** "1단계는 첫 번째 질문의 답, 2단계는 두 번째 질문의 답"처럼 기계적으로 나누면 안 됩니다.
- 설문 질문들은 서로 독립적일 수도, 얽혀 있을 수도 있습니다. 각 케이스의 계획은 **그 조합의 모든 답변과 페르소나 속성(나이대·성별·피부 타입·상황 등)을 함께 놓고 판단한 결과**여야 합니다.
- 조합마다 계획을 좌우하는 핵심 답변이 다릅니다. 그 조합에서 가장 먼저 해결해야 할 것을 1단계에 두고, 나머지 답변은 단계의 설명·체크포인트 안에 녹여 넣으세요.
- 그래서 조합이 달라지면 단계의 주제와 순서도 달라져야 합니다. 모든 케이스가 같은 골격(예: 항상 1단계=세안, 2단계=고민, 3단계=마무리)을 반복하지 마세요.
- 두 답변이 서로 상충하거나(예: 강한 관리를 원하지만 민감함) 함께 있을 때 의미가 달라지는 조합이라면, 그 점을 계획 문구에서 짚어 주세요.
- 요약하면, 모든 조합에 대해 계획을 빠짐없이 만들되 **내용은 그 조합에 가장 유효하다고 판단되는 계획을 스스로 설계**하면 됩니다.

평가 케이스 지정:
- 만든 케이스 중 이 시나리오를 가장 잘 대표하는 3개를 골라 "evaluation": { "selected": true, "slot": "A" } 를 넣습니다(나머지 두 개는 "B", "C").
- 고르는 기준: 서로 답변 조합이 최대한 겹치지 않고, 사용자가 실제로 자주 고를 법하며, 계획 내용과 추천 상품의 차이가 뚜렷한 케이스.
- 기본(폴백) 케이스에는 evaluation을 넣지 않습니다. 나머지 케이스에도 넣지 않습니다.`

export function buildScenarioDbPrompt({
  query,
  persona = '',
  notes = '',
  catalogText = '',
  questionCount = 3,
  optionCount = 3,
  stepCount = 3,
} = {}) {
  const catalog = String(catalogText || '').trim()
  const total = combinationCount(questionCount, optionCount)
  return [
    'DDAK 시나리오 스튜디오에 그대로 가져올(import) 시나리오 데이터를 JSON 파일로 만들어 주세요.',
    '',
    '## 만들 시나리오',
    `- 검색 의도: ${query}`,
    persona ? `- 대상 페르소나: ${persona}` : null,
    notes ? `- 추가 조건: ${notes}` : null,
    `- 설문 질문 ${questionCount}개. **질문마다 선택지를 정확히 ${optionCount}개**씩 만듭니다.`,
    `- 계획 단계 ${stepCount}개`,
    `- **설문 선택지의 모든 조합에 대해 계획 케이스를 하나씩 빠짐없이** 만듭니다.`,
    `  ${questionCount}개 질문 × 선택지 ${optionCount}개 = **총 ${total.toLocaleString()}개 케이스** + 기본(폴백) 케이스 1개 = ${(total + 1).toLocaleString()}개.`,
    '  조합을 하나라도 빠뜨리거나 중복해서는 안 됩니다. 첫 번째 질문의 선택지를 바깥 루프로 두고 순서대로 전개하세요.',
    '  다만 계획 내용은 조합마다 스스로 판단해 설계합니다(아래 "계획 구성 규칙" 참고).',
    '  케이스마다 그 조합에 맞게 제목·설명·체크포인트·추천 상품·참고 콘텐츠가 실제로 달라야 합니다. 문장을 그대로 복사하지 마세요.',
    '',
    catalog
      ? `## 사용할 상품 (이 목록에서만 고르고, 가격·브랜드를 바꾸지 마세요)\n형식: 브랜드 | 상품명 | 가격 | 정가 | 특징\n${catalog}`
      : '## 상품\n대한민국에서 실제로 판매되는 상품을 조사해 사용하세요. 웹 검색을 쓸 수 있으면 한국어로 검색하고, 확인되지 않은 가격은 비워 두세요.',
    '',
    '## 웹 검색과 외부 콘텐츠',
    '- **검색은 대한민국 기준으로 합니다.** 한국어로 검색하고, 국내 사용자가 실제로 보고 살 수 있는 것만 고릅니다.',
    '  (예: 유튜브 한국 채널, 네이버 블로그·포스트, 국내 매체 기사, 올리브영·지마켓·무신사 등 국내 판매처)',
    '  해외 전용 제품이나 국내에서 접근하기 어려운 자료는 쓰지 마세요.',
    '- 검색으로 찾은 **실제 게시글·영상·기사·이미지를 계획 단계에 함께 배치**하세요. 상품만 나열하지 말고, 그 조합의 사용자가 참고할 만한 콘텐츠를 곁들입니다.',
    '  · videoCard — 유튜브 등 영상. title·channel·duration·url을 검색에서 확인한 실제 값으로 채웁니다.',
    '  · articleCard — 블로그·기사. source·title·snippet·author·url을 실제 값으로 채웁니다.',
    '  · imageCard — 참고 이미지. imageUrl은 실제로 접근 가능한 주소만 씁니다.',
    '- 케이스마다 1~3개를 붙이되 그 조합의 주제와 실제로 관련 있는 것만 고르고, 조합이 다르면 다른 콘텐츠를 고릅니다.',
    '- **url과 imageUrl은 검색으로 확인한 실제 주소만** 씁니다. 확인되지 않으면 빈 문자열("")로 두세요. 주소를 지어내면 안 됩니다.',
    '- 외부 콘텐츠는 하나의 hscroll 패널(예: title "내 상황에 맞는 참고 콘텐츠")에 자식으로 담고, 계획 단계들 뒤 ctaBar 앞에 둡니다.',
    '',
    '## 출력할 JSON 형태',
    SHAPE_DOC,
    '',
    '## 사용할 수 있는 컴포넌트',
    componentReference(),
    '',
    '## 규칙',
    LAYOUT_RULES,
    '',
    '작성 규칙:',
    '- 모든 사용자 노출 문구는 한국어 존댓말로 씁니다.',
    '- props는 위 목록에 있는 키만 사용하고, 값은 모두 문자열/불리언 등 목록의 기본값과 같은 타입으로 씁니다.',
    '',
    '## 출력 방법',
    `- 결과를 **\`ddak-scenario.json\` 파일 하나로 만들어** 주세요. 내용은 시나리오 객체 하나를 담은 배열입니다.`,
    '- 케이스가 많아 내용이 기므로 대화창에 JSON을 길게 붙여넣지 말고, 반드시 다운로드할 수 있는 파일로 만들어 주세요.',
    '- 답변 본문에는 만든 케이스 수와 평가용으로 고른 A/B/C 케이스만 짧게 적어 주세요.',
    '',
    `다시 강조합니다: 조합 ${total.toLocaleString()}개를 하나도 빠뜨리지 말되 계획 내용은 조합마다 스스로 판단해 설계하고, 결과는 \`ddak-scenario.json\` 파일로 만들어 주세요.`,
    '(이 파일을 스튜디오의 "결과 가져오기"에서 그대로 업로드합니다.)',
  ].filter((line) => line !== null).join('\n') // null만 제거 — ''는 단락 구분용 빈 줄
}

/* ── 붙여넣은 결과 파싱 ────────────────────────────────────────────── */

const stripCodeFence = (value) => {
  const text = String(value || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const arrayStart = text.indexOf('[')
  const objectStart = text.indexOf('{')
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart
  if (start < 0) return text
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
  return end > start ? text.slice(start, end + 1) : text
}

/* import 가능한 배열로 정규화 — 문제가 있으면 사람이 읽을 수 있는 이유를 돌려준다 */
export function parseScenarioDbJson(raw) {
  let payload
  try {
    payload = JSON.parse(stripCodeFence(raw))
  } catch (error) {
    return { scenarios: [], errors: [`JSON 해석 실패: ${error.message}`], warnings: [] }
  }

  const list = Array.isArray(payload) ? payload : [payload]
  const errors = []
  const warnings = []
  const scenarios = []

  list.forEach((entry, index) => {
    const label = `${index + 1}번 시나리오`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${label}: 객체가 아닙니다.`)
      return
    }
    if (!entry.stages || typeof entry.stages !== 'object') {
      errors.push(`${label}: stages가 없습니다. 가져오기는 stages를 가진 시나리오만 받습니다.`)
      return
    }
    if (!Array.isArray(entry.stages.survey)) {
      warnings.push(`${label}: stages.survey가 배열이 아니라 빈 설문으로 처리합니다.`)
    }
    const planCases = Array.isArray(entry.planCases) ? entry.planCases : []
    if (planCases.length === 0) {
      warnings.push(`${label}: planCases가 없어 기본 계획 케이스 하나로 만들어집니다.`)
    } else if (!planCases.some((planCase) => planCase?.isFallback)) {
      warnings.push(`${label}: isFallback 케이스가 없어 마지막 케이스가 기본으로 지정됩니다.`)
    }

    /* 조건이 실제 설문 질문·선택지를 가리키는지 — 어긋나면 플레이어에서 조용히 안 맞는다 */
    const questions = (Array.isArray(entry.stages.survey) ? entry.stages.survey : [])
      .filter((item) => item?.type === 'surveyQuestion')
    const optionsById = Object.fromEntries(questions.map((item) => [
      item.id,
      String(item.props?.options || '').split(',').map((option) => option.trim()).filter(Boolean),
    ]))
    /* 평가 A/B/C 지정 — 슬롯이 어긋나면 평가 탭에서 케이스가 비어 보인다 */
    const slots = planCases
      .filter((planCase) => planCase?.evaluation?.selected)
      .map((planCase) => planCase.evaluation.slot)
    const validSlots = slots.filter((slot) => ['A', 'B', 'C'].includes(slot))
    if (slots.length === 0) {
      warnings.push(`${label}: 평가용 A/B/C 케이스가 지정되지 않았습니다. 평가 탭에서 직접 선정해야 합니다.`)
    } else if (validSlots.length !== 3 || new Set(validSlots).size !== 3) {
      warnings.push(`${label}: 평가 슬롯이 A·B·C 각각 하나씩이어야 하는데 [${slots.join(', ')}]로 지정됐습니다.`)
    }

    planCases.forEach((planCase, caseIndex) => {
      ;(Array.isArray(planCase?.conditions) ? planCase.conditions : []).forEach((condition) => {
        const options = optionsById[condition?.questionId]
        if (!options) {
          warnings.push(`${label} ${caseIndex + 1}번 케이스: 존재하지 않는 질문 id(${condition?.questionId})를 가리킵니다.`)
          return
        }
        ;(Array.isArray(condition.values) ? condition.values : []).forEach((value) => {
          if (!options.includes(String(value))) {
            warnings.push(`${label} ${caseIndex + 1}번 케이스: 선택지에 없는 값("${value}")을 조건으로 씁니다.`)
          }
        })
      })
    })

    scenarios.push(entry)
  })

  if (scenarios.length === 0 && errors.length === 0) {
    errors.push('가져올 수 있는 시나리오가 없습니다.')
  }
  return { scenarios, errors, warnings }
}
