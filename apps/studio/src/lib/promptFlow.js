export const FLOW_PARTS = [
  { id: 'survey', label: '설문 질문', note: '무엇을 물어볼지' },
  { id: 'plan-skeleton', label: '계획 구성', note: '어떻게 알려줄지' },
  { id: 'plan-products', label: '상품 추천', note: '무엇을 추천할지' },
]
export const flowLabel = (id) => FLOW_PARTS.find((part) => part.id === id)?.label || id
export const flowSnapshot = (wire) => FLOW_PARTS.map(({ id }) => {
  const prompt = wire?.prompts.find((entry) => entry.id === id)
  return { id, text: prompt?.configured ?? prompt?.defaultText ?? '' }
})
export const flowText = (proposal, id, side) =>
  (side === 'trial' && proposal?.changes.find((change) => change.id === id)?.proposedText)
  || proposal?.prompts.find((prompt) => prompt.id === id)?.text

// Generated question ids are positional: q1 must not transfer to an unrelated q1.
export function matchingAnswers(fromSurvey, toSurvey, answers) {
  const result = {}
  for (const question of toSurvey?.questions || []) {
    const source = fromSurvey?.questions.find((candidate) => candidate.kind === question.kind
      && candidate.question === question.question && JSON.stringify(candidate.options) === JSON.stringify(question.options))
    if (source && Object.hasOwn(answers, source.id)) result[question.id] = answers[source.id]
  }
  return result
}
export function surveyReady(survey, answers) {
  return Boolean(survey) && survey.questions.every((question) => {
    if (question.kind === 'photo') return true
    const raw = answers[question.id]
    return (Array.isArray(raw) ? raw : [raw]).some((value) => value != null && String(value).trim() !== '')
  })
}
