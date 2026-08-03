/*
 * 평가 계층 배럴 — 실제 구현은 lib/evaluation/ 네 모듈:
 *   model.js     점수·피드백 레코드의 정규화, id 재발급, plainEvaluationText
 *   recommend.js 대표 케이스 추천 (자동 점수 + MMR 다양화 + 미평가 로테이션)
 *   structure.js 케이스 → 평가 단위(컴포넌트 인스턴스) 변환, AI 왕복 허용 필드 산출
 *   stats.js     선정 CASE 진행률 집계와 케이스 리더보드
 */
export {
  EVALUATION_CASE_SLOTS,
  EVALUATION_SCHEMA_VERSION,
  caseHasEvaluationInput,
  liveComponentEntries,
  nextEvaluationRound,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
  plainEvaluationText,
  remapCaseEvaluation,
} from './evaluation/model.js'
export { recommendRotationCaseIds } from './evaluation/recommend.js'
export { componentEvaluationStructureForCase } from './evaluation/structure.js'
export {
  evaluationCasesFor,
  evaluationLeaderboard,
  structuredComponentEvaluationStats,
} from './evaluation/stats.js'
