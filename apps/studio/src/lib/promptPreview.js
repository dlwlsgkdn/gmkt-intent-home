import { mergePlanSections } from '../../../../packages/pipeline/src/guards/merge.ts'
import { PHOTO_ANSWER } from './livePage.js'

export function previewAnswers(survey, answers) {
  return (survey?.questions || []).map((q) => {
    const raw = answers[q.id]
    const choices = (Array.isArray(raw) ? raw : [raw]).filter((v) => v != null && String(v).trim() !== '')
    return { questionId: q.id, choices: q.kind === 'photo' && choices.length ? [PHOTO_ANSWER] : choices }
  }).filter((answer) => answer.choices.length > 0)
}

export function previewPlan(skeleton, products) {
  return {
    headline: skeleton?.skeleton?.headline || '',
    summary: skeleton?.skeleton?.summary || '',
    sections: mergePlanSections(skeleton?.skeleton?.sections || [], products?.sections || []),
  }
}
