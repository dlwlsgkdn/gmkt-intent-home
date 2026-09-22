// 성분 비교표·주의 성분(v26)이 심사관 요청·피드백 재생성 요청의 직전 계획 요약에 제 종류로 실리는지 (prompts.ts judgePageBlock·prevPlanBlock).
// 예전엔 알 수 없는 kind 가 [순서] 분기로 떨어져 s.steps.map 에서 죽거나 [안내] 로 잘못 적혔다.
// 실행: npm run test --workspace=@ddak/pipeline
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJudgeRequest, buildPlanSkeletonRequest, PLAN_SKELETON_SYSTEM, SURVEY_SYSTEM } from '../dist/prompts.js'

const survey = { intro: '면도 뒤 자극을 줄여 볼게요.', questions: [{ id: 'q1', question: '지금 쓰는 제품은?', options: ['올인원 워시|한 번에', '쉐이빙 폼|거품'], multi: false }] }
const answers = [{ questionId: 'q1', choices: ['올인원 워시'] }]
const page = {
  headline: '면도 자극 케어',
  summary: '요약',
  sections: [
    { kind: 'guide', title: '자극 원인 짚기', subtitle: '성분부터', body: '본문' },
    {
      kind: 'compare',
      title: '기존 워시와 추천 기준을 성분으로 비교했어요',
      alt: { badge: '기존 제품', name: '일반 올인원 워시' },
      pick: { badge: '추천 기준', name: '약산성 저자극 쉐이빙 젤', short: '쉐이빙 젤' },
      rows: [{ ingredient: 'SLS/SLES', alt: '있음', pick: '없음', risk: '높음' }],
    },
    { kind: 'caution', title: '주의해서 볼 성분', items: [{ name: '인공향료 (Fragrance)', note: '자극이 될 수 있어요.' }] },
    { kind: 'steps', title: '사용 순서', steps: ['미온수', '젤'] },
  ],
}

test('judge 요청 — 비교표는 [성분 비교] 행 목록으로, 주의 성분은 [주의 성분] 항목으로 실리고 steps 는 그대로', () => {
  const user = buildJudgeRequest({ intent: '면도 자극', survey, answers, page, dropLog: [] })
  assert.ok(user.includes('2. [성분 비교] 기존 워시와 추천 기준을 성분으로 비교했어요 — 일반 올인원 워시 vs 약산성 저자극 쉐이빙 젤'))
  assert.ok(user.includes('   - SLS/SLES: 일반 올인원 워시 있음 · 쉐이빙 젤 없음 · 위험도 높음'))
  assert.ok(user.includes('3. [주의 성분] 주의해서 볼 성분\n   - 인공향료 (Fragrance): 자극이 될 수 있어요.'))
  assert.ok(user.includes('4. [순서] 사용 순서\n   - 미온수'))
})

test('피드백 재생성 요청 — 직전 계획 요약에 [성분 비교]·[주의 성분] 줄', () => {
  const revision = { feedback: { review: { score: 3, feedback: '표가 좋아요' }, components: [] }, prevPlan: page }
  const user = buildPlanSkeletonRequest('면도 자극', survey, answers, undefined, revision)
  assert.ok(user.includes('2. [성분 비교] 기존 워시와 추천 기준을 성분으로 비교했어요'))
  assert.ok(user.includes('3. [주의 성분] 주의해서 볼 성분'))
  assert.ok(!user.includes('3. [안내] 주의해서 볼 성분'))
})

test('시스템 프롬프트 — 뼈대에 compare·caution 규칙, 설문에 사용 중 제품 질문 규칙이 있고 모의 서버 판별 마커는 그대로', () => {
  assert.ok(PLAN_SKELETON_SYSTEM.includes('성분 비교표(compare)') && PLAN_SKELETON_SYSTEM.includes('주의 성분(caution)'))
  assert.ok(PLAN_SKELETON_SYSTEM.includes('뼈대') && !PLAN_SKELETON_SYSTEM.includes('productIds') && !PLAN_SKELETON_SYSTEM.includes('참고 콘텐츠 수집'))
  assert.ok(SURVEY_SYSTEM.includes('지금 쓰는 제품 유형') && !SURVEY_SYSTEM.includes('뼈대'))
})
