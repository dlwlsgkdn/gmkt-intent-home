import type { Answer, Profile, SurveyPageWire } from '@ddak/schema'
import { CATALOG } from './catalog'

export const PROMPT_VERSION = 'v5'

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
- 선택지에 "기타"나 "잘 모르겠어요"를 남발하지 않는다 (필요한 질문 하나에만).`

const CATALOG_BLOCK = CATALOG.map(
  (p) => `${p.id} | ${p.brand} ${p.name} | ${p.price.toLocaleString('ko-KR')}원 | ${p.tags.join(',')}`,
).join('\n')

/* 계획 = 2단계 병렬 생성 (§9-1): 뼈대(검색 없음, 빠름)가 페이지 레이아웃을 확정하고,
   상품(검색 포함)이 병렬로 돌아 뼈대의 상품 자리를 채운다. 시스템 프롬프트도 단계별로 분리 —
   각각 바이트 고정이라 프롬프트 캐시도 단계별로 적중한다. */

export const PLAN_SKELETON_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 설문 응답을 바탕으로 맞춤 쇼핑 계획 페이지의 **뼈대**를 만든다. 구체 상품 선정은 별도 단계가 병렬로 진행하고 있으니, 너는 상품 없이 쓸 수 있는 부분을 빠르게 완성한다.

규칙:
- 섹션 구성: 안내(guide) → 상품 섹션 자리(products — 제목과 "고를 기준" reason만) 1~2개 → 사용 순서(steps)가 기본 골격이다.
- 구체 상품명·브랜드명은 어디에도 쓰지 않는다 — 상품 단계가 채운다. 안내와 순서는 성분·제형·사용법 같은 기준 중심으로 쓴다.
- 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 말투는 친근한 존댓말, 이모지 없이 담백하게.`

export const PLAN_PRODUCTS_SYSTEM = `너는 지마켓 뷰티의 AI 쇼핑 플래너다. 설문 응답에 맞는 **추천 상품 섹션**(1~2개)만 만든다. 페이지의 안내·순서는 별도 단계가 작성하고 있으니 상품 선정에 집중한다.

사용할 수 있는 상품 카탈로그 (id | 상품명 | 가격 | 태그):
${CATALOG_BLOCK}

상품 추천 규칙:
- 추천 상품은 위 카탈로그와 웹 검색(web_search)을 모두 살펴 구성한다. 카탈로그에 맞는 상품이 있으면 productIds로 우선 쓰고, 카탈로그가 못 채우는 필요(특정 브랜드·성분·용도, 더 나은 대안)는 웹 검색으로 찾아 webProducts에 넣는다.
- productIds는 반드시 위 카탈로그의 id만 쓴다. 카탈로그에 없는 상품을 id로 지어내지 않는다.
- webProducts는 반드시 웹 검색 결과에서 확인한 실제 판매 상품만 넣는다: url은 그 상품 하나의 **상세 페이지(PDP)** 주소를 검색 결과에서 그대로 쓴다(지어내거나 변형 금지). 검색 결과·상품 목록·카테고리 페이지 주소는 금지 — PDP를 못 확인한 상품은 넣지 않는다. price는 검색에서 확인한 판매가(원 단위 정수), mall은 판매처 이름이다.
- 웹 검색은 상품을 찾을 때만 1~2회 간결하게 쓴다. 여러 검색이 필요하면 순차로 나누지 말고 한 번에 병렬로 요청한다. 검색 없이도 카탈로그로 충분하면 생략해도 된다.
- 섹션 reason은 사용자의 답변을 근거로 구체적으로 쓴다 ("지성 피부를 고르셨으니…").
- 예산 답변이 있으면 상품 합계가 그 범위를 크게 넘지 않게 고른다.
- 말투는 친근한 존댓말, 이모지 없이 담백하게.`

const profileBlock = (profile?: Profile) =>
  profile?.length ? profile.map((p) => `- ${p.label}: ${p.value}`).join('\n') : '(없음)'

export function buildSurveyRequest(intent: string, profile?: Profile): string {
  return `사용자 의도: ${intent}

사용자 프로필:
${profileBlock(profile)}

이 의도에 맞는 설문 페이지를 만들어 주세요.`
}

function planContext(intent: string, survey: SurveyPageWire, answers: Answer[], profile?: Profile): string {
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
${qa}`
}

export function buildPlanSkeletonRequest(
  intent: string,
  survey: SurveyPageWire,
  answers: Answer[],
  profile?: Profile,
): string {
  return `${planContext(intent, survey, answers, profile)}

이 응답에 맞는 쇼핑 계획 페이지의 뼈대를 만들어 주세요.`
}

export function buildPlanProductsRequest(
  intent: string,
  survey: SurveyPageWire,
  answers: Answer[],
  profile?: Profile,
): string {
  return `${planContext(intent, survey, answers, profile)}

이 응답에 맞는 추천 상품 섹션을 만들어 주세요.`
}
