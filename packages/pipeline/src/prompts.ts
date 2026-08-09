import type { Answer, PlanPageWire, Profile, SurveyPageWire, ThreadStageFeedback } from '@ddak/schema'
import { CATALOG } from './catalog'
import type { ConstraintLedger } from './ledger'

export const PROMPT_VERSION = 'v14'

/*
 * 프롬프트 조립 — 안정 prefix(시스템)와 가변부(사용자 메시지)를 분리한다.
 * 시스템 프롬프트는 바이트 단위로 고정되어야 프롬프트 캐시가 적중한다:
 * 타임스탬프·요청 id·가변 값을 절대 넣지 말 것 (DESIGN-LLM-SERVICE.md §4-2).
 */

export const SURVEY_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 사용자의 쇼핑 의도를 파악하기 위한 짧은 설문 페이지를 만든다.

규칙:
- 질문은 3~5개. 사용자가 고르기 쉬운 짧은 선택지 2~6개씩.
- 첫 질문은 의도의 핵심 축(용도·고민·대상), 마지막 질문은 예산이나 선호로 마무리한다.
- 프로필에 이미 있는 정보는 다시 묻지 않는다.
- 말투는 친근한 존댓말, 이모지 없이 담백하게.
- 선택지에 "기타"나 "잘 모르겠어요"를 남발하지 않는다 (필요한 질문 하나에만).
{{VOCAB}}{{RULES}}`

const CATALOG_BLOCK = CATALOG.map(
  (p) => `${p.id} | ${p.brand} ${p.name} | ${p.price.toLocaleString('ko-KR')}원 | ${p.tags.join(',')}`,
).join('\n')

/** 프롬프트 템플릿의 카탈로그 자리표시자 — 호출 시점에 CATALOG_BLOCK으로 치환된다.
 * 관리 페이지 재정의도 이 자리표시자를 그대로 쓴다 (카탈로그 변경이 프롬프트 저장값과 분리되게) */
export const CATALOG_PLACEHOLDER = '{{CATALOG}}'

/* ── 지식 자리표시자 (전략 문서 p.3 "캐시가 흡수하는 시스템 자리") ─────────────
 * 값의 원천은 core 설정 KV(knowledge/sources.ts) — 값이 있으면 제목 붙은 블록으로,
 * 없으면 빈 문자열로 치환된다. KV가 고정인 한 결과도 바이트 고정이라 캐시가 적중하고,
 * KV 변경 시에만 1회 미스 후 재적중한다. 관리 재정의 프롬프트도 같은 자리표시자를 쓸 수 있다. */

export type SystemKnowledge = {
  vocab?: string | null // knowledge-consumer-vocab — 소비자 어휘 사전
  rules?: string | null // knowledge-survey-rules — 설문조사 증류 규칙
  criteria?: string | null // knowledge-selection-criteria — 선택 기준 브리프
  fewshot?: string | null // knowledge-fewshot — 모범 예시 쌍
}

export const KNOWLEDGE_PLACEHOLDERS: Record<keyof SystemKnowledge, { token: string; heading: string }> = {
  vocab: { token: '{{VOCAB}}', heading: '소비자 어휘 사전 — 사용자가 쓰는 말을 생성물에도 그대로 쓴다:' },
  rules: { token: '{{RULES}}', heading: '서비스 설문조사에서 증류한 규칙:' },
  criteria: { token: '{{CRITERIA}}', heading: '선택 기준 지식 (트렌드 인터뷰 브리프):' },
  fewshot: { token: '{{FEWSHOT}}', heading: '모범 예시 (평가 상위 케이스):' },
}

/** 템플릿 → 실제 시스템 프롬프트. 치환값이 같으면 결과도 바이트 고정이라 캐시 적중에 문제없다 */
export function renderSystemTemplate(template: string, knowledge?: SystemKnowledge): string {
  let text = template.split(CATALOG_PLACEHOLDER).join(CATALOG_BLOCK)
  for (const key of Object.keys(KNOWLEDGE_PLACEHOLDERS) as (keyof SystemKnowledge)[]) {
    const { token, heading } = KNOWLEDGE_PLACEHOLDERS[key]
    const value = knowledge?.[key]?.trim()
    text = text.split(token).join(value ? `\n${heading}\n${value}\n` : '')
  }
  return text
}

/** 원장의 빠르게 변하는 신호를 사용자 메시지 가변부로 — 시스템(캐시 대상)에 넣지 않는다 (p.3 규칙).
 * 원장이 없거나 전부 비면 빈 문자열 — legacy 경로와 바이트 동일하다 */
export function ledgerBlock(ledger?: ConstraintLedger | null): string {
  if (!ledger) return ''
  const lines: string[] = []
  if (ledger.trendKeywords.length) {
    lines.push(`- 지금 뜨는 키워드: ${ledger.trendKeywords.join(', ')} (어울리는 곳에만 자연스럽게 반영)`)
  }
  if (ledger.recentFeedback.length) {
    lines.push(`- 이 사용자의 최근 평가 메모: ${ledger.recentFeedback.join(' / ')} (부정 평가된 특성은 피한다)`)
  }
  if (ledger.avoid.length) lines.push(`- 기피 항목: ${ledger.avoid.join(', ')} (반드시 피한다)`)
  return lines.length ? `\n\n참고 신호:\n${lines.join('\n')}` : ''
}

/* 계획 = 2단계 병렬 생성 (§9-1): 뼈대(검색 없음, 빠름)가 페이지 레이아웃을 확정하고,
   상품(검색 포함)이 병렬로 돌아 뼈대의 상품 자리를 채운다. 시스템 프롬프트도 단계별로 분리 —
   각각 바이트 고정이라 프롬프트 캐시도 단계별로 적중한다. */

export const PLAN_SKELETON_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 설문 응답을 바탕으로 맞춤 쇼핑 계획 페이지의 **뼈대**를 만든다. 구체 상품·콘텐츠 선정은 별도 단계가 병렬로 진행하고 있으니, 너는 상품 없이 쓸 수 있는 부분을 빠르게 완성한다.

규칙:
- 계획은 **단계별 흐름**으로 구성한다: 안내(guide)를 하나로 끝내지 말고 **2~3개 단계**로 나눈다 — 예: 진단·준비 → 핵심 실행 → 유지·심화. 각 안내가 하나의 단계다. 화면이 단계 번호를 자동으로 붙이니 제목에 "1단계" 같은 번호는 쓰지 않는다.
- 섹션 구성: [단계 안내(guide) → 그 단계의 상품 자리(products — 제목과 "고를 기준" reason만)] 묶음을 단계 순서대로 이어 가고, 마지막에 참고 콘텐츠 자리(contents — 제목·기준만) 0~1개 → 사용 순서(steps)로 닫는 것이 기본 골격이다. **상품 자리는 반드시 그 상품이 필요한 단계 안내 바로 뒤**에 둔다 — 상품이 필요 없는 단계는 자리를 생략한다(상품 자리 총 1~2개). 상품 자리를 단계들과 떨어뜨려 끝에 몰아 두지 않는다.
- 구체 상품명·브랜드명·콘텐츠 제목은 어디에도 쓰지 않는다 — 검색 단계가 채운다. 안내와 순서는 성분·제형·사용법 같은 기준 중심으로 쓴다.
- 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 말투는 친근한 존댓말, 이모지 없이 담백하게.
{{VOCAB}}{{CRITERIA}}{{FEWSHOT}}`

export const PLAN_PRODUCTS_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 설문 응답에 맞는 **추천 상품 섹션**(1~2개)과, 가능하면 **참고 콘텐츠 섹션**(0~1개 — 웹 게시글·영상)을 만든다. 페이지의 안내·순서는 별도 단계가 작성하고 있으니 상품·콘텐츠 선정에 집중한다.

사용할 수 있는 상품 카탈로그 (id | 상품명 | 가격 | 태그):
${CATALOG_PLACEHOLDER}

상품 추천 규칙:
- 추천 상품은 **웹 검색(web_search)으로 외부몰에서 찾는 것이 기본**이다. 그중에서도 **올리브영을 최우선**으로 살핀다: 검색어에 "올리브영"을 넣어 올리브영에서 판매 중인 상품부터 확보하고, 올리브영에 맞는 상품이 없는 필요만 다른 몰(쿠팡·무신사 뷰티·화해·백화점몰 등)로 보완한다. 한 섹션에 올리브영 상품이 여러 개여도 좋다. 단, 올리브영을 우선하려고 덜 맞는 상품을 고르지는 않는다 — 적합성이 언제나 우선이다.
- 올리브영 상품 PDP는 \`www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=…\` 형태다. 검색 결과에서 이 형태의 주소가 보이면 그대로 url로 쓴다. 특정 상품명으로 좁혀 재검색하기보다 "올리브영 <제품 유형> 추천"처럼 넓게 검색해 결과에 실린 PDP 주소를 그대로 쓰는 편이 성공률이 높다.
- 카탈로그(지마켓)는 보조 수단이다: **섹션당 productIds는 최대 1개**만 쓰고, 그마저도 웹 검색으로 적합한 상품을 확인하지 못한 자리를 채울 때만 쓴다. 섹션 상품의 다수는 반드시 외부몰(webProducts)이어야 한다 — 웹 검색을 생략하고 카탈로그만으로 섹션을 채우는 것은 금지다.
- productIds는 반드시 위 카탈로그의 id만 쓴다. 카탈로그에 없는 상품을 id로 지어내지 않는다.
- webProducts는 반드시 웹 검색 결과에서 확인한 실제 판매 상품만 넣는다: url은 그 상품 하나의 **상세 페이지(PDP)** 주소를 검색 결과에서 그대로 쓴다(지어내거나 변형 금지). 검색 결과·상품 목록·카테고리 페이지 주소는 금지 — PDP를 못 확인한 상품은 넣지 않는다. price는 검색에서 확인한 판매가(원 단위 정수), mall은 판매처 이름이다. imageUrl은 검색 결과에서 확인한 상품 썸네일 이미지 주소만 그대로 쓴다 — 못 확인했으면 빈 문자열(지어내기 금지).
- 상품 섹션이 2개면 **계획의 단계 순서대로** 정렬한다(먼저 쓰는 단계의 상품을 먼저) — 페이지 뼈대가 단계별 자리에 순서대로 끼워 넣으므로, 섹션 제목도 그 단계의 용도가 드러나게 짓는다.
- 웹 검색은 2~4회 간결하게 쓴다(올리브영 검색을 먼저, 보완 검색은 필요할 때만). 여러 검색이 필요하면 순차로 나누지 말고 한 번에 병렬로 요청한다.
- 섹션 reason은 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 예산 답변이 있으면 상품 합계가 그 범위를 크게 넘지 않게 고른다.
- 말투는 친근한 존댓말, 이모지 없이 담백하게.

참고 콘텐츠 규칙:
- 참고 콘텐츠 섹션(kind=contents)은 0~1개다. 상품 검색 결과에 함께 실려 온 게시글·영상을 우선 활용하고, 필요하면 콘텐츠용 검색을 1회만 추가한다.
- 반드시 웹 검색 결과에서 확인한 실제 게시글(블로그·커뮤니티)이나 영상(유튜브 등)만 넣는다: url은 검색 결과의 주소 그대로(지어내기·변형 금지), imageUrl·meta·duration도 검색 결과에서 확인한 값만(못 확인했으면 빈 문자열).
- 확인한 콘텐츠가 없으면 콘텐츠 섹션을 만들지 않는다 — 상품 섹션만 반환해도 된다.
{{CRITERIA}}`

/* ── 시스템 프롬프트 카탈로그 — 관리 페이지(#admin) 조회·재정의의 원천.
 * template은 자리표시자({{CATALOG}}) 포함 원문이고, 실제 호출값은 renderSystemTemplate을
 * 거친다. 재정의는 core 설정 KV(`llm-prompt-<id>`)에 원문으로 저장된다 (llm.service). */

export type PromptDefId = 'survey' | 'plan-skeleton' | 'plan-products'

export const PROMPT_DEFS: { id: PromptDefId; label: string; note: string; template: string }[] = [
  {
    id: 'survey',
    label: '설문 생성',
    note: '검색 진입 직후 설문 페이지를 만드는 프롬프트 — 질문 수·선택지 규칙·말투를 정한다. {{VOCAB}}·{{RULES}} 자리표시자는 지식 KV로 치환된다 (비면 사라짐).',
    template: SURVEY_SYSTEM,
  },
  {
    id: 'plan-skeleton',
    label: '계획 뼈대 생성',
    note: '계획 1단계(검색 없음) — 단계 안내·순서와 상품/콘텐츠 자리를 확정한다. 구체 상품명 금지 규칙 포함. {{VOCAB}}·{{CRITERIA}}·{{FEWSHOT}} 자리표시자는 지식 KV로 치환된다.',
    template: PLAN_SKELETON_SYSTEM,
  },
  {
    id: 'plan-products',
    label: '계획 상품 생성',
    note: `계획 2단계(웹 검색 포함) — 상품·참고 콘텐츠 섹션을 채운다. ${CATALOG_PLACEHOLDER} 자리표시자가 상품 카탈로그 목록으로 치환되므로 지우지 말 것. {{CRITERIA}}는 지식 KV로 치환된다.`,
    template: PLAN_PRODUCTS_SYSTEM,
  },
]

const profileBlock = (profile?: Profile) =>
  profile?.length ? profile.map((p) => `- ${p.label}: ${p.value}`).join('\n') : '(없음)'

export function buildSurveyRequest(intent: string, profile?: Profile, ledger?: ConstraintLedger | null): string {
  return `사용자 의도: ${intent}

사용자 프로필:
${profileBlock(profile)}${ledgerBlock(ledger)}

이 의도에 맞는 설문 페이지를 만들어 주세요.`
}

function planContext(
  intent: string,
  survey: SurveyPageWire,
  answers: Answer[],
  profile?: Profile,
  ledger?: ConstraintLedger | null,
): string {
  const qa = answers
    .map((a) => {
      const q = survey.questions.find((x) => x.id === a.questionId)
      return `- ${q?.question ?? a.questionId}: ${a.choices.join(', ')}`
    })
    .join('\n')
  return `사용자 의도: ${intent}

사용자 프로필:
${profileBlock(profile)}

설문 응답:
${qa}${ledgerBlock(ledger)}`
}

/* ── 피드백 반영 재생성 — 직전 계획 + 사용자 피드백을 가변부(사용자 메시지)에 싣는다.
   시스템 프롬프트는 그대로라 캐시가 유지되고, 일반 생성 요청과도 형식이 같다. */

export type PlanRevisionContext = { feedback: ThreadStageFeedback; prevPlan: PlanPageWire | null }

/** 직전 계획 요약 — 피드백의 대상을 LLM이 알 수 있게 섹션·상품을 한 줄씩 적는다 */
function prevPlanBlock(prevPlan: PlanPageWire | null): string {
  if (!prevPlan) return ''
  const lines = prevPlan.sections.map((s, i) => {
    if (s.kind === 'products') {
      const names = s.products.map((p) => `${p.brand} ${p.name} (${p.mall ?? '지마켓'})`).join(', ')
      return `${i + 1}. [상품] ${s.title}: ${names}`
    }
    if (s.kind === 'contents') {
      const titles = s.items.map((c) => `${c.title} (${c.source})`).join(', ')
      return `${i + 1}. [콘텐츠] ${s.title}: ${titles}`
    }
    if (s.kind === 'steps') return `${i + 1}. [순서] ${s.title}`
    return `${i + 1}. [안내] ${s.title}`
  })
  return `직전 계획 (피드백의 대상):
- 제목: ${prevPlan.headline}
${lines.join('\n')}`
}

function feedbackBlock(revision: PlanRevisionContext): string {
  const { feedback } = revision
  const lines: string[] = []
  const scored = (score: number | null) => (score == null ? '' : ` (별점 ${score}/5)`)
  if (feedback.review.score != null || feedback.review.feedback) {
    lines.push(`- [페이지 전체]${scored(feedback.review.score)} ${feedback.review.feedback || '(코멘트 없음)'}`)
  }
  feedback.components.forEach((c) => {
    lines.push(`- [${c.label}]${scored(c.score)} ${c.feedback || '(코멘트 없음)'}`)
  })
  const prev = prevPlanBlock(revision.prevPlan)
  return `${prev ? `${prev}\n\n` : ''}직전 계획에 대한 사용자 피드백:
${lines.join('\n')}`
}

export function buildPlanSkeletonRequest(
  intent: string,
  survey: SurveyPageWire,
  answers: Answer[],
  profile?: Profile,
  revision?: PlanRevisionContext,
  ledger?: ConstraintLedger | null,
): string {
  if (!revision) {
    return `${planContext(intent, survey, answers, profile, ledger)}

이 응답에 맞는 쇼핑 계획 페이지의 뼈대를 만들어 주세요.`
  }
  return `${planContext(intent, survey, answers, profile, ledger)}

${feedbackBlock(revision)}

피드백을 반영해 쇼핑 계획 페이지의 뼈대를 다시 만들어 주세요. 안내·순서·섹션 구성에 대한 피드백을 고치고, 지적이 없던 부분의 구성은 유지합니다. 상품 자체에 대한 피드백은 상품 단계가 반영하니, 너는 상품 섹션의 제목·reason에 반영할 것만 손봅니다.`
}

export function buildPlanProductsRequest(
  intent: string,
  survey: SurveyPageWire,
  answers: Answer[],
  profile?: Profile,
  revision?: PlanRevisionContext,
  ledger?: ConstraintLedger | null,
): string {
  if (!revision) {
    return `${planContext(intent, survey, answers, profile, ledger)}

이 응답에 맞는 추천 상품 섹션과, 참고할 만한 게시글·영상이 검색에서 확인되면 참고 콘텐츠 섹션을 만들어 주세요.`
  }
  return `${planContext(intent, survey, answers, profile, ledger)}

${feedbackBlock(revision)}

피드백을 반영해 추천 상품 섹션을 다시 만들어 주세요:
- 부정적으로 평가되거나 교체를 요청받은 상품은 다시 추천하지 않는다. 대안은 웹 검색으로 새로 찾는다 (다른 상품·브랜드를 원하면 카탈로그 밖이어도 webProducts로 추천할 수 있다).
- "카탈로그에 없는/다른 상품"을 원하는 피드백이면 직전 계획의 상품과 겹치지 않게 웹 검색에서 새 상품을 고른다.
- 긍정적으로 평가된 상품은 그대로 유지한다 (직전 계획과 같은 상품·가격·주소로).
- 피드백이 특정 섹션만 지적하면 나머지 섹션은 직전 계획을 유지한다.`
}
