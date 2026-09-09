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

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b))

// Reserve exact matches before pairing edits, so inserted rows cannot steal an unchanged neighbour.
export function compareRows(before, after, { value = (row) => row, key = () => '', kind = () => '' } = {}) {
  const used = new Set()
  const matches = after.map(() => -1)
  for (const test of [(a, b) => equal(value(a), value(b)), (a, b) => key(a) && key(a) === key(b), (a, b) => kind(a) === kind(b)]) {
    after.forEach((row, index) => {
      if (matches[index] >= 0) return
      const found = before.findIndex((candidate, i) => !used.has(i) && kind(candidate) === kind(row) && test(candidate, row))
      if (found >= 0) { used.add(found); matches[index] = found }
    })
  }
  const afterMarks = after.map((row, index) => {
    const oldIndex = matches[index]
    if (oldIndex < 0) return { label: '새로 생겼어요', type: 'added', oldIndex }
    if (!equal(value(before[oldIndex]), value(row))) return { label: '이 부분이 바뀌었어요', type: 'changed', oldIndex }
    const moved = matches.some((other, j) => other >= 0 && ((j < index && other > oldIndex) || (j > index && other < oldIndex)))
    return moved ? { label: '순서가 바뀌었어요', type: 'moved', oldIndex } : null
  })
  const beforeMarks = before.map((row, index) => {
    const newIndex = matches.indexOf(index)
    if (newIndex < 0) return { label: '수정 후에는 빠졌어요', type: 'removed' }
    return afterMarks[newIndex] ? { ...afterMarks[newIndex], label: afterMarks[newIndex].type === 'moved' ? '순서가 바뀌었어요' : '이전 내용이에요' } : null
  })
  return { before: beforeMarks, after: afterMarks, matches }
}

export function comparePreviewItems(beforeItems, afterItems, summaries = {}) {
  const roots = (items) => items.filter((item) => !item.parentId && item.type !== 'screenHeader')
  const before = roots(beforeItems), after = roots(afterItems)
  const content = (item, items, summary) => {
    const { locked, ...props } = item.props || {}
    return { type: item.type, props, summary: item.type === 'surveySummary' ? summary : undefined, children: items.filter((child) => child.parentId === item.id).map((child) => content(child, items, summary)) }
  }
  const taggedBefore = before.map((item) => ({ ...item, content: content(item, beforeItems, summaries.baseline) }))
  const taggedAfter = after.map((item) => ({ ...item, content: content(item, afterItems, summaries.trial) }))
  const diff = compareRows(taggedBefore, taggedAfter, { value: (item) => item.content, kind: (item) => item.type, key: (item) => item.props?.question || item.props?.title })
  const maps = { baseline: {}, trial: {} }
  before.forEach((item, index) => { if (diff.before[index]) maps.baseline[item.id] = { ...diff.before[index] } })
  after.forEach((item, index) => {
    if (diff.after[index]) maps.trial[item.id] = { ...diff.after[index] }
    if (item.type !== 'surveyQuestion') return
    const old = before[diff.matches[index]]
    const options = (row) => String(row?.props?.options || '').split('\n').filter(Boolean)
    const optionDiff = compareRows(options(old), options(item), { key: (text) => text.split('|')[0] })
    if (maps.trial[item.id]) maps.trial[item.id].options = optionDiff.after
    if (old && maps.baseline[old.id]) maps.baseline[old.id].options = optionDiff.before
  })
  return maps
}

// Mirror progress, not pixels: the two generated pages can have different heights.
export function createPreviewScrollSync(getPane) {
  const expected = {}
  return {
    takeControl(side) { delete expected[side] },
    reset() {
      for (const side of ['baseline', 'trial']) {
        const pane = getPane(side)
        if (pane) { pane.scrollTop = 0; expected[side] = 0 }
      }
    },
    onScroll(side) {
      const pane = getPane(side)
      if (!pane) return
      const mirrored = expected[side]
      delete expected[side]
      if (mirrored != null && Math.abs(pane.scrollTop - mirrored) <= 1) return
      const other = side === 'baseline' ? 'trial' : 'baseline'
      const target = getPane(other)
      if (!target) return
      const range = Math.max(0, pane.scrollHeight - pane.clientHeight)
      const progress = range ? Math.max(0, Math.min(1, pane.scrollTop / range)) : 0
      const next = progress * Math.max(0, target.scrollHeight - target.clientHeight)
      if (Math.abs(target.scrollTop - next) <= 1) return
      target.scrollTop = next
      expected[other] = target.scrollTop
    },
  }
}
