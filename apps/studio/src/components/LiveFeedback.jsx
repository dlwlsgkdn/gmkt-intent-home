import React from 'react'
import StarRating from './builder/evaluation/StarRating.jsx'

/*
 * 라이브 생성 체험의 피드백(평가) — 스튜디오 평가 스튜디오와 같은 문법(별점 0~5 +
 * 코멘트, null=미평가·0점 구분 배지)을 플레이어 폭에 맞는 인라인 카드로 재사용한다.
 * 대상은 LLM 산출 컴포넌트뿐이다: 설문 = 인트로·질문, 계획 = 요약·섹션.
 * 클라이언트 소유 패널(profilePanel·surveySummary)과 한 줄 헤드라인(planTitle)은
 * 페이지 전체 평가가 대신 받는다. 상품 섹션의 추천 이유(-reason)는 바로 아래
 * 상품 섹션 말풍선에 합쳐 받는다 — 말풍선 수를 늘리지 않기 위해서다.
 */

const PLAN_SECTION_ID = /^live-plan-s\d+$/

export function isLiveFeedbackTarget(item) {
  return (
    item.type === 'surveyQuestion' ||
    item.id === 'live-survey-intro' ||
    item.id === 'live-plan-summary' ||
    PLAN_SECTION_ID.test(item.id)
  )
}

export function liveFeedbackLabel(item) {
  if (item.type === 'surveyQuestion') return item.props.question || '질문'
  if (item.id === 'live-survey-intro') return '인트로'
  if (item.id === 'live-plan-summary') return '요약'
  return item.props.title || '섹션'
}

/* ── 상태 헬퍼 — LivePlayer의 단계별 피드백 상태 { review, components } ──────── */

export const emptyStageFeedback = () => ({ review: { score: null, feedback: '' }, components: {} })

/* 이어보기 응답의 wire(components 배열) → 로컬 상태(components 맵) */
export function stageFeedbackFromWire(wire) {
  if (!wire) return emptyStageFeedback()
  return {
    review: { score: wire.review?.score ?? null, feedback: wire.review?.feedback || '' },
    components: Object.fromEntries(
      (wire.components || []).map((c) => [c.id, { score: c.score ?? null, feedback: c.feedback || '' }])
    ),
  }
}

/* 내용 시그니처 — "보내지 않은 평가" 판정. 라벨·빈 항목·순서에 흔들리지 않게 정규화한다 */
export function stageFeedbackSignature(st) {
  return JSON.stringify({
    review: [st.review.score ?? null, (st.review.feedback || '').trim()],
    components: Object.entries(st.components)
      .map(([id, v]) => [id, v.score ?? null, (v.feedback || '').trim()])
      .filter(([, score, text]) => score != null || text)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  })
}

/* 전송 payload(ThreadStageFeedback) 조립 — 라벨은 현재 렌더된 아이템에서 뽑아 함께 저장한다 */
export function buildLiveFeedbackPayload(stage, st, items) {
  const components = items
    .filter(isLiveFeedbackTarget)
    .map((it) => {
      const v = st.components[it.id] || {}
      return { id: it.id, label: liveFeedbackLabel(it), score: v.score ?? null, feedback: (v.feedback || '').trim() }
    })
    .filter((c) => c.score != null || c.feedback)
  return {
    stage,
    review: { score: st.review.score ?? null, feedback: (st.review.feedback || '').trim() },
    components,
  }
}

export function hasLiveFeedbackContent(payload) {
  return payload.review.score != null || payload.review.feedback !== '' || payload.components.length > 0
}

/* 말풍선 하나 — value = { score, feedback }, onChange(patch)로 부분 갱신.
   평가 스튜디오의 .sb-bubble 문법을 그대로 쓴다: 레일 안 절대 배치 + 페이지로 뻗는
   점선 연결선(::before), 좁은 화면에선 일반 흐름(evaluation.css 미디어 규칙 공유).
   위치(top)는 LivePlayer의 layoutFbBubbles가 앵커의 실제 렌더 높이로 잡아 준다. */
export default function LiveFeedbackBubble({
  bubbleRef,
  label,
  value,
  onChange,
  overall = false,
  active = false,
  onActivate,
  foot = null,
}) {
  const score = value ? value.score : null
  const feedback = (value && value.feedback) || ''
  return (
    <div
      ref={bubbleRef}
      className={'sb-bubble sb-live-bubble' + (overall ? ' sb-bubble--case' : '') + (active ? ' is-active' : '')}
      onClick={onActivate}
    >
      <div className="sb-bubble__head">
        <span className="sb-bubble__label">{overall ? '💬 페이지 전체' : `💬 ${label}`}</span>
        <StarRating value={score == null ? null : score} label={label} onChange={(s) => onChange({ score: s })} />
      </div>
      <textarea
        rows={2}
        value={feedback}
        placeholder={overall ? '페이지 전체 피드백 — 예: 질문이 너무 많아요, 순서를 바꿔주세요' : '피드백 — 오류·누락·더 좋은 대안'}
        onChange={(event) => onChange({ feedback: event.target.value })}
        onClick={(event) => event.stopPropagation()}
      />
      {foot}
    </div>
  )
}
