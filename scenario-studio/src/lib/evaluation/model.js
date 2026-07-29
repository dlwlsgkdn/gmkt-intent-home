/*
 * 평가 데이터의 형태(v2) — 정규화·마이그레이션·id 재발급.
 *
 * v2 스키마: 수명이 다른 세 덩어리를 분리한다.
 *   selection  작업 상태 — "지금 평가 화면(CASE A/B/C)에서 뭘 보고 있나". 자산이 아니다
 *   review     케이스 전체 말풍선의 평가 자산 (컴포넌트에 달기 애매한 피드백의 자리)
 *   components 컴포넌트 말풍선의 평가 자산 — itemId 키
 *
 * 시각·라운드: 모든 평가 레코드는 { round, at }을 갖는다. round는 로테이션 라운드
 * (1부터, 0 = 구버전/불명), at은 그 레코드가 마지막으로 바뀐 시각. 선정 변경(selection.at)과
 * 평가 입력(review/components의 at)이 분리되어 "마지막으로 평가한 시각"이 오염되지 않는다.
 *
 * 마이그레이션: v1(평면 {selected, slot, score, feedback, updatedAt, criteria})은
 * normalizeCaseEvaluation 관문에서 v2로 변환된다. localStorage·서버 미러·백업·발행 버전·
 * AI 가져오기(전체 구성이 내는 {selected, slot}) 모두 이 관문을 지나므로 변환 지점은 하나다.
 * v1의 criteria(구 step별 평가)는 여기서 버려진다.
 *
 * 점수는 0~5 정수이되 null(미평가)과 0(사용 불가)을 구분한다. 별점 UI가 이 구분에
 * 기대므로(빈 별만으로는 못 가른다) nullableRating이 유일한 점수 해석 지점이다.
 */

export const EVALUATION_CASE_SLOTS = ['A', 'B', 'C']
export const EVALUATION_SCHEMA_VERSION = 2

const clampRating = (value) => {
  const rating = Number(value)
  return Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0
}

const nullableRating = (value) => {
  if (value == null || value === '') return null
  return clampRating(value)
}

const timestamp = (value) => (value ? String(value) : null)

const roundNumber = (value) => {
  const round = Number(value)
  return Number.isInteger(round) && round > 0 ? round : 0
}

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)

/* 컴포넌트 말풍선 레코드. v1의 updatedAt은 at으로 흡수한다 */
export function normalizeComponentEvaluation(raw = {}) {
  const value = isRecord(raw) ? raw : {}
  return {
    score: nullableRating(value.score),
    feedback: String(value.feedback || ''),
    resolved: !!value.resolved,
    round: roundNumber(value.round),
    at: timestamp(value.at ?? value.updatedAt),
  }
}

const normalizeSelection = (raw = {}) => {
  const value = isRecord(raw) ? raw : {}
  return {
    active: !!value.active,
    slot: EVALUATION_CASE_SLOTS.includes(value.slot) ? value.slot : null,
    round: roundNumber(value.round),
    at: timestamp(value.at),
  }
}

const normalizeReview = (raw = {}) => {
  const value = isRecord(raw) ? raw : {}
  return {
    score: nullableRating(value.score),
    feedback: String(value.feedback || ''),
    round: roundNumber(value.round),
    at: timestamp(value.at),
  }
}

const normalizeComponents = (raw) =>
  isRecord(raw)
    ? Object.fromEntries(
        Object.entries(raw).map(([itemId, review]) => [
          String(itemId),
          normalizeComponentEvaluation(review),
        ])
      )
    : {}

export function normalizeCaseEvaluation(raw = {}) {
  const value = isRecord(raw) ? raw : {}

  /* v2: selection/review 구조가 있으면 그대로 정규화 */
  if (value.v === EVALUATION_SCHEMA_VERSION || isRecord(value.selection) || isRecord(value.review)) {
    const selection = normalizeSelection(value.selection)
    let review = normalizeReview(value.review)
    /* v1→v2 마이그레이션이 남긴 유령 0점 청소: v1은 케이스 점수를 clampRating으로
       정규화해 미평가 케이스 전부에 score 0을 기본값으로 저장했고, 초기 마이그레이션이
       그 0을 진짜 평가로 승계했다(선정 시각과 동일한 at, round 0, 피드백 없음이 그 서명).
       이 유령 흔적은 caseHasEvaluationInput을 전 케이스 true로 만들어 로테이션·전파
       대상을 0개로 비운다 — 미평가(null)로 되돌린다 */
    if (
      review.score === 0 && review.round === 0 && !review.feedback.trim()
      && review.at && review.at === selection.at
    ) {
      review = { ...review, score: null, at: null }
    }
    return {
      v: EVALUATION_SCHEMA_VERSION,
      selection,
      review,
      components: normalizeComponents(value.components),
    }
  }

  /* v1 마이그레이션: 평면 필드를 세 덩어리로 나눈다. updatedAt은 선정/평가를 구분할 수
     없던 시절의 값이라 — 평가 입력이 실재할 때만 review.at으로 승계하고, criteria는 버린다.
     v1의 score 0은 clampRating 기본값이라 "0점 평가"가 아니다 — 피드백이 함께 있을 때만
     기록으로 취급하고, 홀로 있는 0은 미평가(null)로 승계한다 */
  const hasFeedback = String(value.feedback || '').trim()
  const v1Score = nullableRating(value.score)
  const migratedScore = v1Score === 0 && !hasFeedback ? null : v1Score
  const hasReviewInput = migratedScore != null || hasFeedback
  return {
    v: EVALUATION_SCHEMA_VERSION,
    selection: normalizeSelection({
      active: !!value.selected,
      slot: value.slot,
      round: 0,
      at: value.updatedAt,
    }),
    review: normalizeReview({
      score: migratedScore,
      feedback: value.feedback,
      round: 0,
      at: hasReviewInput ? value.updatedAt : null,
    }),
    components: normalizeComponents(value.components),
  }
}

/* 계획 케이스나 시나리오 복사 시 컴포넌트 평가가 새 item id를 따라가게 한다.
   매핑에 없는 id(=사라진 컴포넌트)의 레코드는 여기서 함께 버려진다.
   resetSelection: 사본은 선정 상태(작업 상태)를 물려받지 않는다 — 복제 경로에서 사용 */
export function remapCaseEvaluation(raw, itemIdMap, { resetSelection = false } = {}) {
  const evaluation = normalizeCaseEvaluation(raw)
  const components = {}
  Object.entries(evaluation.components).forEach(([itemId, review]) => {
    const nextId = itemIdMap[itemId]
    if (nextId) components[nextId] = { ...review }
  })
  return {
    ...evaluation,
    selection: resetSelection ? normalizeSelection() : evaluation.selection,
    components,
  }
}

/* 실제로 존재하는 아이템의 평가 레코드만 — [itemId, review] 쌍.
   아이템 삭제·페이지 재구성이 남긴 고아 레코드를 판정·집계에서 걸러내는 유일한 통로.
   (데이터는 지우지 않는다 — 같은 id가 돌아오면 평가도 되살아난다) */
export function liveComponentEntries(planCase) {
  const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
  const itemIds = new Set((planCase?.items || []).map((item) => String(item.id)))
  return Object.entries(evaluation.components).filter(([itemId]) => itemIds.has(itemId))
}

/* 케이스에 사람 평가 흔적(별점·피드백)이 있는가 — 로테이션 제외 기준이자
   전파의 씨앗/대상 경계. 고아 레코드는 세지 않는다(현재 화면에 없는 평가로
   케이스가 로테이션에서 영구 제외되는 것을 막는다) */
export function caseHasEvaluationInput(planCase) {
  const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
  if (evaluation.review.score != null || evaluation.review.feedback.trim()) return true
  return liveComponentEntries(planCase).some(
    ([, review]) => review.score != null || review.feedback.trim()
  )
}

/* 다음 로테이션 라운드 번호 — 케이스들에 찍힌 라운드의 최댓값 + 1.
   시나리오 필드가 아니라 케이스에서 유도하므로 Undo와 함께 자연스럽게 되감긴다 */
export function nextEvaluationRound(planCases = []) {
  let max = 0
  planCases.forEach((planCase) => {
    const evaluation = normalizeCaseEvaluation(planCase?.evaluation)
    max = Math.max(
      max,
      evaluation.selection.round,
      evaluation.review.round,
      ...Object.values(evaluation.components).map((review) => review.round)
    )
  })
  return max + 1
}

/* 리치텍스트 마크업({{서식|텍스트}}·[[키워드]])을 걷어낸 순수 문자열 —
   평가 미리보기와 프롬프트에 실을 텍스트는 전부 이걸 거친다. */
export function plainEvaluationText(value) {
  return String(value || '')
    .replace(/\{\{[^|{}]*\|([^{}]*?)\}\}/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
