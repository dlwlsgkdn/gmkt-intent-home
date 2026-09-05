import type { Answer, PlanPageWire, Profile, SurveyPageWire, ThreadStageFeedback } from '@ddak/schema'
import { CATALOG } from './catalog'
import type { ConstraintLedger } from './ledger'
import { optionParts } from './survey-wire'

export const PROMPT_VERSION = 'v18'

/*
 * 프롬프트 조립 — 안정 prefix(시스템)와 가변부(사용자 메시지)를 분리한다.
 * 시스템 프롬프트는 바이트 단위로 고정되어야 프롬프트 캐시가 적중한다:
 * 타임스탬프·요청 id·가변 값을 절대 넣지 말 것 (DESIGN-LLM-SERVICE.md §4-2).
 */

export const SURVEY_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 사용자의 쇼핑 의도를 파악하기 위한 짧은 설문 페이지를 만든다.

규칙:
- 질문은 **꼭 필요한 1~3개만** — 답이 계획을 실제로 바꾸는 질문만 만들고, 이미 아는 것(프로필·의도 해석·참고 신호에 있는 정보)은 절대 다시 묻지 않는다.
- 선택지는 질문당 2~6개, 각 선택지는 **제목(label)과 부제(desc)** 한 벌이다: 제목은 고르기 쉬운 짧은 명사구(2~8자), 부제는 그 항목이 자기 얘기인지 바로 판단할 수 있는 기준·상황을 담백하게 한 줄(10~25자)로 쓴다 — 예: 제목 "지성" · 부제 "오후만 되면 T존이 번들거려요". 부제는 제목을 되풀이하지 않고, 부제 없는 선택지를 남기지 않는다.
- 첫 질문은 의도의 핵심 축(용도·고민·대상), 마지막 질문은 예산이나 선호로 마무리한다.
- 말투는 친근한 존댓말, 이모지 없이 담백하게.
- 선택지에 "기타"나 "잘 모르겠어요"를 남발하지 않는다 (필요한 질문 하나에만).

얼굴 사진 질문(photoQuestion):
- **얼굴을 봐야 답이 달라지는 의도**(가상 메이크업·룩 제안·발색 확인·퍼스널 컬러·얼굴형 고민)면 photoQuestion에 사진을 요청하는 질문 문구를 쓴다 — 화면이 이 질문을 **첫 화면**으로 세워 사진을 받고, 계획에서 그 사진 위에 룩을 올려 보여준다.
- 그 밖의 의도(성분·지속력·선물·가격 비교 등 사진 없이도 답이 같은 경우)에는 **반드시 빈 문자열**이다. 사진을 습관적으로 요구하지 않는다.
- 사진을 요청했다면 questions에서 얼굴형·피부톤·눈매처럼 사진으로 알 수 있는 것을 다시 묻지 않는다 — 취향·상황·예산처럼 사진에 없는 것만 묻는다.
{{VOCAB}}{{RULES}}`

/* 1단계 의도 정규화 (전략 문서 STEP 1) — 발화를 7템플릿 구조로. 스키마 100% 준수는
   구조화 출력이 보장하고, 이 프롬프트는 추측 금지·소비자 어휘 보존만 지시한다. */
export const INTENT_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 사용자의 한 줄 발화를 의도 구조(7개 의도 템플릿 중 하나 + 목적·시점·대상)로 정규화한다.

규칙:
- 발화에 없는 정보를 추측하지 않는다 — 시점을 모르면 "지금 바로", 대상을 모르면 "본인".
- 목적(goal)은 사용자가 쓴 말을 그대로 살린다 (내부 용어로 바꾸지 않는다 — "무너짐"은 "무너짐"으로).
{{VOCAB}}`

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
  /** 운영자가 관리 페이지에서 추가한 지식 (knowledge/sources.ts CustomKnowledgeSource) —
   * 토큰·제목이 붙박이처럼 코드에 없고 값과 함께 실려 온다. 값이 비면 붙박이와 같이 자리가 사라진다 */
  custom?: CustomKnowledgeValue[]
}

export type CustomKnowledgeValue = { token: string; heading: string; value: string | null }

/** 붙박이 자리표시자 4종 (운영자 추가분은 SystemKnowledge.custom으로 값과 함께 실려 온다) */
export const KNOWLEDGE_PLACEHOLDERS: Record<
  'vocab' | 'rules' | 'criteria' | 'fewshot',
  { token: string; heading: string }
> = {
  vocab: { token: '{{VOCAB}}', heading: '소비자 어휘 사전 — 사용자가 쓰는 말을 생성물에도 그대로 쓴다:' },
  rules: { token: '{{RULES}}', heading: '서비스 설문조사에서 증류한 규칙:' },
  criteria: { token: '{{CRITERIA}}', heading: '선택 기준 지식 (트렌드 인터뷰 브리프):' },
  fewshot: { token: '{{FEWSHOT}}', heading: '모범 예시 (평가 상위 케이스):' },
}

/** 템플릿 → 실제 시스템 프롬프트. 치환값이 같으면 결과도 바이트 고정이라 캐시 적중에 문제없다 */
export function renderSystemTemplate(template: string, knowledge?: SystemKnowledge): string {
  let text = template.split(CATALOG_PLACEHOLDER).join(CATALOG_BLOCK)
  for (const key of Object.keys(KNOWLEDGE_PLACEHOLDERS) as (keyof typeof KNOWLEDGE_PLACEHOLDERS)[]) {
    const { token, heading } = KNOWLEDGE_PLACEHOLDERS[key]
    const value = typeof knowledge?.[key] === 'string' ? (knowledge[key] as string).trim() : ''
    text = text.split(token).join(value ? `\n${heading}\n${value}\n` : '')
  }
  // 운영자 추가 지식 — 붙박이와 같은 규칙(값 있으면 제목 붙은 블록, 없으면 자리 삭제)
  for (const entry of knowledge?.custom || []) {
    const value = entry.value?.trim()
    text = text.split(entry.token).join(value ? `\n${entry.heading}\n${value}\n` : '')
  }
  return text
}

/** 원장의 빠르게 변하는 신호를 사용자 메시지 가변부로 — 시스템(캐시 대상)에 넣지 않는다 (p.3 규칙).
 * 원장이 없거나 전부 비면 빈 문자열 — legacy 경로와 바이트 동일하다 */
export function ledgerBlock(ledger?: ConstraintLedger | null): string {
  if (!ledger) return ''
  const lines: string[] = []
  const intentFacts = ledger.facts.filter((f) => f.source === 'intent')
  if (intentFacts.length) {
    lines.push(`- 의도 해석: ${intentFacts.map((f) => `${f.label} ${f.value}`).join(' · ')}`)
  }
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
- 각 단계 안내(guide)는 **제목(title) · 서브타이틀(subtitle) · 본문(body)** 세 요소를 모두 채운다. 제목은 "무엇을 하는 단계"인지 짧게, 서브타이틀은 그 단계에서 얻는 것이나 왜 지금 필요한지를 한 줄(15~30자)로 요약해 제목 아래에 세우고, 본문은 그 근거와 실행 요령을 2~3문장으로 푼다. 서브타이틀을 비우거나 제목·본문 첫 문장을 되풀이하지 않는다 — 예: 제목 "베이스 정돈" · 서브타이틀 "유분만 덜어내고 속광은 남기는 준비" · 본문 "지성 피부를 고르셨으니 …".
- 섹션 구성: [단계 안내(guide) → 그 단계의 상품 자리(products — 제목과 "고를 기준" reason만)] 묶음을 단계 순서대로 이어 가고, 마지막에 참고 콘텐츠 자리(contents — 제목·기준만) 0~1개 → 사용 순서(steps)로 닫는 것이 기본 골격이다. **상품 자리는 반드시 그 상품이 필요한 단계 안내 바로 뒤**에 둔다 — 상품이 필요 없는 단계는 자리를 생략한다(상품 자리 총 1~2개). 상품 자리를 단계들과 떨어뜨려 끝에 몰아 두지 않는다.
- 설문 응답에 **얼굴 사진 제출**이 있으면 **첫 섹션을 가상 메이크업 결과(kind=look) 하나로 연다**: 올린 사진에 올려 볼 룩 이름(title)·고른 이유(desc)·색조(tone)·포인트(points)를 담는다. 화면이 사용자의 사진 위에 그 톤을 올려 비포/애프터로 보여주므로, 실제로 그 사진에 올릴 수 있는 하나의 룩으로 좁혀 쓴다. 사진 제출이 없으면 look 섹션을 **절대 만들지 않는다**.
- 구체 상품명·브랜드명·콘텐츠 제목은 어디에도 쓰지 않는다 — 검색 단계가 채운다. 안내와 순서는 성분·제형·사용법 같은 기준 중심으로 쓴다.
- 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 말투는 친근한 존댓말, 이모지 없이 담백하게.
{{VOCAB}}{{CRITERIA}}{{FEWSHOT}}`

export const PLAN_PRODUCTS_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 설문 응답에 맞는 **추천 상품 섹션**(1~2개)과, 가능하면 **참고 콘텐츠 섹션**(0~1개 — 웹 게시글·영상)을 만든다. 페이지의 안내·순서는 별도 단계가 작성하고 있으니 상품·콘텐츠 선정에 집중한다. **목록은 넉넉하게** — 상품 섹션마다 상품 4~6개, 콘텐츠 섹션에는 4~6개 항목을 목표로 한다(사용자가 비교하고 고를 폭이 있어야 한다).

사용할 수 있는 상품 카탈로그 (id | 상품명 | 가격 | 태그):
${CATALOG_PLACEHOLDER}

상품 추천 규칙:
- 추천 상품은 **웹 검색(web_search)으로 외부몰에서 찾는 것이 기본**이다. 그중에서도 **올리브영을 최우선**으로 살핀다: 검색어에 "올리브영"을 넣어 올리브영에서 판매 중인 상품부터 확보하고, 올리브영에 맞는 상품이 없는 필요만 다른 몰(쿠팡·무신사 뷰티·화해·백화점몰 등)로 보완한다. 한 섹션에 올리브영 상품이 여러 개여도 좋다. 단, 올리브영을 우선하려고 덜 맞는 상품을 고르지는 않는다 — 적합성이 언제나 우선이다.
- 올리브영 상품 PDP는 \`www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=…\` 형태다. 검색 결과에서 이 형태의 주소가 보이면 그대로 url로 쓴다. 특정 상품명으로 좁혀 재검색하기보다 "올리브영 <제품 유형> 추천"처럼 넓게 검색해 결과에 실린 PDP 주소를 그대로 쓰는 편이 성공률이 높다.
- **한 섹션에 상품 4~6개**를 담는다(최소 4개를 목표로). 검색 결과에서 PDP 를 확인한 상품이 모자라면 보완 검색으로 채우되, 확인되지 않은 상품으로 개수를 맞추지는 않는다 — 검증된 상품 3개가 지어낸 6개보다 낫다. 같은 섹션 안에서는 가격대·브랜드·제형을 다양하게 섞어 고를 폭을 준다.
- 카탈로그(지마켓)는 보조 수단이다: **섹션당 productIds는 최대 1개**만 쓰고, 그마저도 웹 검색으로 적합한 상품을 확인하지 못한 자리를 채울 때만 쓴다. 섹션 상품의 다수는 반드시 외부몰(webProducts)이어야 한다 — 웹 검색을 생략하고 카탈로그만으로 섹션을 채우는 것은 금지다.
- productIds는 반드시 위 카탈로그의 id만 쓴다. 카탈로그에 없는 상품을 id로 지어내지 않는다.
- webProducts는 반드시 웹 검색 결과에서 확인한 실제 판매 상품만 넣는다: url은 그 상품 하나의 **상세 페이지(PDP)** 주소를 검색 결과에서 그대로 쓴다(지어내거나 변형 금지). 검색 결과·상품 목록·카테고리 페이지 주소는 금지 — PDP를 못 확인한 상품은 넣지 않는다. price는 검색에서 확인한 판매가(원 단위 정수), mall은 판매처 이름이다. imageUrl은 검색 결과에서 확인한 상품 썸네일 이미지 주소만 그대로 쓴다 — 못 확인했으면 빈 문자열(지어내기 금지).
- 상품 섹션이 2개면 **계획의 단계 순서대로** 정렬한다(먼저 쓰는 단계의 상품을 먼저) — 페이지 뼈대가 단계별 자리에 순서대로 끼워 넣으므로, 섹션 제목도 그 단계의 용도가 드러나게 짓는다.
- 웹 검색은 3~5회 안에서 쓴다(올리브영 검색을 먼저, 확인된 후보가 섹션당 4개에 못 미치면 보완 검색으로 채운다). 여러 검색이 필요하면 순차로 나누지 말고 한 번에 병렬로 요청한다.
- 섹션 reason은 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 예산 답변이 있으면 상품 합계가 그 범위를 크게 넘지 않게 고른다.
- **매칭 평가(match)는 상품마다 반드시 채운다**: webProducts 의 각 항목에 match 를, productIds 의 각 상품엔 catalogRatings 에 {id, match} 를 넣는다. match 는 skin(피부 타입·톤 적합)·concern(고민·목적 적합)·preference(사용 선호 적합)를 1~5 정수로, notes 의 각 항목에는 근거 한 줄을 사용자 프로필·답변을 인용해 쓴다 ("지성 피부에 맞는 세미매트 마감" 처럼). 예산 답변이 없으면 price(가격 대비 가치)도 1~5 로 준다. 관대하게 주지 않는다 — 답변에서 확인되는 만큼만. 최종 매칭율(%)은 시스템이 가중 합산으로 계산하므로 퍼센트는 쓰지 않는다.
- 말투는 친근한 존댓말, 이모지 없이 담백하게.

참고 콘텐츠 규칙:
- 참고 콘텐츠 섹션(kind=contents)은 0~1개다. 상품 검색 결과에 함께 실려 온 게시글·영상을 우선 활용하고, 필요하면 콘텐츠용 검색을 1~2회 추가한다. **섹션에는 4~6개 항목**을 영상·게시글을 섞어 담는다 — 확인된 콘텐츠가 그보다 적으면 그만큼만 넣고 억지로 채우지 않는다.
- 반드시 웹 검색 결과에서 확인한 실제 게시글(블로그·커뮤니티)이나 영상(유튜브 등)만 넣는다: url은 검색 결과의 주소 그대로(지어내기·변형 금지), imageUrl·meta·duration도 검색 결과에서 확인한 값만(못 확인했으면 빈 문자열).
- 확인한 콘텐츠가 없으면 콘텐츠 섹션을 만들지 않는다 — 상품 섹션만 반환해도 된다.
{{CRITERIA}}`

/* 자동 채점(judge) — 실험 탭 실행 결과를 사용자 입력과 대조해 루브릭 4차원으로 심사한다.
   생성 파이프라인의 단계가 아니라 평가 계층의 판정자(source='judge')다: 사람 채점을 대체하지
   않고 별도 레코드로 저장된다. 채점 눈금·차원 정의는 schemas.ts JUDGE_DIMENSIONS와 한 벌.
   주의: 모의 Anthropic(e2e)이 시스템 문구로 호출을 판별한다 — "품질 심사관" 마커 유지. */
export const JUDGE_SYSTEM = `너는 지마켓 뷰티 AI 쇼핑 플래너의 **품질 심사관**이다. 생성된 쇼핑 계획 페이지를 사용자 입력(의도·프로필·설문 답변)과 대조해 루브릭 4개 차원으로 채점한다.

채점 원칙:
- 점수는 0~5 정수 — 5=흠잡을 데 없음, 4=좋음(사소한 아쉬움), 3=쓸 만하지만 아쉬움, 2=문제가 눈에 띔, 1=크게 부족, 0=쓸 수 없음.
- 관대하게 주지 않는다: 근거 없이 4 이상을 주지 말고, 페이지에서 확인되지 않는 장점은 점수에 반영하지 않는다.
- 각 차원의 note에는 점수 근거를 한두 문장으로, 구체 섹션 제목·상품명을 들어 쓴다.
- verdict는 종합 심사평 2~3문장 — 가장 큰 감점 요인과 개선 방향을 짚는다. overall은 차원 평균이 아니라 종합 판단이다.

루브릭:
- grounding (근거 충실): 상품·콘텐츠가 실제 확인된 것인가. 검증 게이트 드롭이 많거나, 상품 자리가 비었거나, 근거(reason)가 상품과 어긋나면 감점.
- personalization (맞춤성): 프로필·설문 답변이 안내 문구와 상품 선정 근거에 실제로 반영됐는가. 답변과 무관한 일반론이면 감점.
- structure (단계 구성): 안내가 2~3개 단계 흐름으로 나뉘고 상품 섹션이 해당 단계 안내 뒤에 붙었는가, 사용 순서로 닫히는가. 각 단계 안내에 목적을 한 줄로 요약한 서브타이틀이 있는가.
- actionability (실행 가능성): 안내가 구체적이어서 그대로 따라 할 수 있는가. 추상적 조언만 있으면 감점.`

/* 설문 단계 judge — 실행 단계 축(config.stage='survey')의 판정자. 계획 judge와 눈금은
   같지만 루브릭이 다르다 (schemas.ts JUDGE_SURVEY_DIMENSIONS).
   주의: 모의 Anthropic(e2e)이 시스템 문구로 호출을 판별한다 — "설문 심사관" 마커 유지. */
export const JUDGE_SURVEY_SYSTEM = `너는 지마켓 뷰티 AI 쇼핑 플래너의 **설문 심사관**이다. 생성된 설문 페이지를 사용자 입력(의도·프로필)과 대조해 루브릭 4개 차원으로 채점한다.

채점 원칙:
- 점수는 0~5 정수 — 5=흠잡을 데 없음, 4=좋음(사소한 아쉬움), 3=쓸 만하지만 아쉬움, 2=문제가 눈에 띔, 1=크게 부족, 0=쓸 수 없음.
- 관대하게 주지 않는다: 근거 없이 4 이상을 주지 말고, 각 차원의 note에는 점수 근거를 한두 문장으로, 구체 질문 문구를 들어 쓴다.
- verdict는 종합 심사평 2~3문장 — 가장 큰 감점 요인과 개선 방향을 짚는다. overall은 차원 평균이 아니라 종합 판단이다.

루브릭:
- necessity (질문 절제): 답이 계획을 실제로 바꾸는 질문만 있는가. 프로필·의도에서 이미 아는 것을 다시 물으면 크게 감점. 질문 수가 1~3개를 넘으면 감점.
- relevance (의도 적합): 첫 질문이 의도의 핵심 축(용도·고민·대상)을 짚고, 예산·선호로 마무리하는가. 의도와 무관한 일반 질문이면 감점.
- answerability (답하기 쉬움): 선택지가 2~6개의 짧은 명사구 제목에 판단 기준을 알려주는 부제가 붙어 고르기 쉬운가. 부제가 빠졌거나 제목을 되풀이하면 감점, "기타"·"잘 모르겠어요" 남발이면 감점.
- tone (말투): 친근한 존댓말, 이모지 없이 담백한가.`

/* ── 시스템 프롬프트 카탈로그 — 운영 콘솔(#ops) 조회·재정의의 원천.
 * template은 자리표시자({{CATALOG}}) 포함 원문이고, 실제 호출값은 renderSystemTemplate을
 * 거친다. 재정의는 core 설정 KV(`llm-prompt-<id>`)에 원문으로 저장된다 (llm.service). */

export type PromptDefId = 'intent' | 'survey' | 'plan-skeleton' | 'plan-products' | 'judge' | 'judge-survey'

export const PROMPT_DEFS: { id: PromptDefId; label: string; note: string; template: string }[] = [
  {
    id: 'intent',
    label: '의도 정규화',
    note: '1단계 — 발화를 7개 의도 템플릿 + 목적·시점·대상 구조로. 실패해도 플로우는 계속된다(fail-open). {{VOCAB}} 자리표시자는 지식 KV로 치환된다.',
    template: INTENT_SYSTEM,
  },
  {
    id: 'survey',
    label: '설문 생성',
    note: '검색 진입 직후 설문 페이지를 만드는 프롬프트 — 질문 수·선택지(제목+부제 한 벌) 규칙·말투와 얼굴 사진 질문(photoQuestion) 판단을 정한다. {{VOCAB}}·{{RULES}} 자리표시자는 지식 KV로 치환된다 (비면 사라짐).',
    template: SURVEY_SYSTEM,
  },
  {
    id: 'plan-skeleton',
    label: '계획 뼈대 생성',
    note: '계획 1단계(검색 없음) — 단계 안내(제목·서브타이틀·본문 세 요소)·순서와 상품/콘텐츠 자리, 사진을 받았을 때의 가상 메이크업 결과(look) 섹션을 확정한다. 구체 상품명 금지 규칙 포함. {{VOCAB}}·{{CRITERIA}}·{{FEWSHOT}} 자리표시자는 지식 KV로 치환된다.',
    template: PLAN_SKELETON_SYSTEM,
  },
  {
    id: 'plan-products',
    label: '계획 상품 생성',
    note: `계획 2단계(웹 검색 포함) — 상품·참고 콘텐츠 섹션을 채우고(섹션당 상품 4~6개·콘텐츠 4~6개 목표, v18) 상품마다 매칭 평가(skin·concern·preference 1~5 + 근거)를 매긴다. 매칭율(%)은 검증 게이트가 가중 합산으로 계산한다(@ddak/pipeline guards/match.ts). ${CATALOG_PLACEHOLDER} 자리표시자가 상품 카탈로그 목록으로 치환되므로 지우지 말 것. {{CRITERIA}}는 지식 KV로 치환된다.`,
    template: PLAN_PRODUCTS_SYSTEM,
  },
  {
    id: 'judge',
    label: '자동 채점 (judge · 계획)',
    note: '실험 탭 계획 실행 결과를 루브릭 4차원(근거 충실·맞춤성·단계 구성·실행 가능성)으로 심사하는 판정자 프롬프트. 사람 채점과 별도 저장되며(source 축), 생성 파이프라인 단계가 아니다.',
    template: JUDGE_SYSTEM,
  },
  {
    id: 'judge-survey',
    label: '자동 채점 (judge · 설문)',
    note: '실험 탭 설문 단계 실행(config.stage=survey) 결과를 루브릭 4차원(질문 절제·의도 적합·답하기 쉬움·말투)으로 심사하는 판정자 프롬프트. 계획 judge와 눈금은 같고 루브릭만 다르다.',
    template: JUDGE_SURVEY_SYSTEM,
  },
]

const profileBlock = (profile?: Profile) =>
  profile?.length ? profile.map((p) => `- ${p.label}: ${p.value}`).join('\n') : '(없음)'

export function buildIntentRequest(intent: string): string {
  return `사용자 발화: ${intent}

이 발화를 의도 구조로 정규화해 주세요.`
}

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
      // 사진 답은 표식뿐이다(원본은 기기에 남는다) — 무엇이 제출됐는지 말로 풀어 준다
      if (q?.kind === 'photo') return `- ${q.question}: 사용자가 얼굴 사진을 올렸습니다 (화면이 이 사진에 룩을 올려 보여줍니다)`
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
    if (s.kind === 'look') return `${i + 1}. [가상 메이크업] ${s.title}`
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

/* ── 자동 채점 요청 — 케이스 입력(비교 기준) + 생성 결과 전문 + 검증 게이트 드롭 로그.
   prevPlanBlock(요약)과 달리 안내 본문·상품 상세까지 싣는다 — 심사는 전문을 봐야 한다. */

export type JudgeInput = {
  intent: string
  profile?: Profile
  survey: SurveyPageWire
  answers: Answer[]
  page: PlanPageWire
  dropLog: { code: string; message: string }[]
}

function judgePageBlock(page: PlanPageWire): string {
  const lines = page.sections.map((s, i) => {
    if (s.kind === 'guide') return `${i + 1}. [안내] ${s.title}\n   ${s.body}`
    if (s.kind === 'products') {
      const items = s.products
        .map((p) => `   - ${p.brand} ${p.name} · ${p.price.toLocaleString('ko-KR')}원 · ${p.mall ?? '지마켓'}`)
        .join('\n')
      return `${i + 1}. [상품] ${s.title} — ${s.reason}\n${items || '   (상품 없음)'}`
    }
    if (s.kind === 'contents') {
      const items = s.items.map((c) => `   - [${c.type}] ${c.title} (${c.source})`).join('\n')
      return `${i + 1}. [콘텐츠] ${s.title} — ${s.reason}\n${items}`
    }
    if (s.kind === 'look') {
      const points = (s.points ?? []).map((pt) => `   - ${pt}`).join('\n')
      return `${i + 1}. [가상 메이크업] ${s.title} (${s.tone}) — ${s.desc}\n${points}`
    }
    return `${i + 1}. [순서] ${s.title}\n${s.steps.map((step) => `   - ${step}`).join('\n')}`
  })
  return `생성된 계획 페이지 (심사 대상):
- 제목: ${page.headline}
- 요약: ${page.summary}
${lines.join('\n')}`
}

/** 설문 단계 judge 요청 — 케이스 입력(비교 기준) + 실행이 생성한 설문 전문 */
export type JudgeSurveyInput = {
  intent: string
  profile?: Profile
  survey: SurveyPageWire
}

/** 와이어 선택지("제목|부제") → 심사관이 읽는 "제목(부제)" */
function formatOption(option: string): string {
  const { label, desc } = optionParts(option)
  return desc ? `${label}(${desc})` : label
}
export function buildJudgeSurveyRequest(input: JudgeSurveyInput): string {
  const questions = input.survey.questions
    .map(
      (q, i) =>
        `${i + 1}. ${q.question}${q.multi ? ' (복수 선택)' : ''}\n   선택지: ${q.options.map(formatOption).join(' / ')}`,
    )
    .join('\n')
  return `사용자 의도: ${input.intent}

사용자 프로필:
${profileBlock(input.profile)}

생성된 설문 페이지 (심사 대상):
- 머리 문구: ${input.survey.intro}
${questions}

이 설문 페이지를 루브릭 4개 차원으로 채점해 주세요.`
}

export function buildJudgeRequest(input: JudgeInput): string {
  const drops = input.dropLog.length
    ? `\n\n검증 게이트 드롭 로그 (생성 중 탈락한 항목 — grounding 판단 재료):\n${input.dropLog
        .map((d) => `- [${d.code}] ${d.message}`)
        .join('\n')}`
    : ''
  return `${planContext(input.intent, input.survey, input.answers, input.profile)}

${judgePageBlock(input.page)}${drops}

이 계획 페이지를 루브릭 4개 차원으로 채점해 주세요.`
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
