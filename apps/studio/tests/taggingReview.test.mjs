import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FIELD_DEFS, TAGGING_SEED, freshUnit, fieldIssues, fieldNeedsReview, unitStatusKey, validateUnit, applyTaxonomy } from '../src/lib/taggingCatalog.js'

const def = (key) => FIELD_DEFS.find((d) => d.key === key)
const sample = () => freshUnit(TAGGING_SEED[0])

test('explicitly completed, valid AI fields are locked even without a confidence score', () => {
  const unit = sample()
  delete unit.fields.area.confidence
  assert.equal(fieldNeedsReview(unit, def('area')), false)
  unit.fields.area.status = 'unreviewed'
  unit.fields.area.confidence = 100
  assert.equal(fieldNeedsReview(unit, def('area')), true)
})

test('invalid completed values remain editable and give concrete repair instructions', () => {
  const unit = sample()
  unit.fields.area.selected = ['얼굴전체', '눈가']
  assert.equal(fieldNeedsReview(unit, def('area')), true)
  assert.ok(fieldIssues(unit, def('area')).some((message) => message.includes('최대 1개')))
  assert.ok(validateUnit(unit).errs.some((message) => message.includes('‘부위’') && message.includes('최대 1개')))
  unit.fields.area.selected = ['옛날태그']
  assert.equal(fieldNeedsReview(unit, def('area')), true)
})

test('fix status cannot silently become completed when values pass validation', () => {
  const unit = sample()
  assert.equal(validateUnit(unit).errs.length, 0)
  unit.fields.result.status = 'fix'
  assert.equal(unitStatusKey(unit), 'fix')
  assert.equal(fieldNeedsReview(unit, def('result')), true)
  unit.fields.result.status = 'done'
  assert.equal(unitStatusKey(unit), 'done')
})

test('representative must belong to the selected tags; optional empty field may complete', () => {
  const unit = sample()
  unit.fields.result.rep = '선택하지 않은 태그'
  assert.equal(fieldNeedsReview(unit, def('result')), true)
  unit.fields.condition.selected = []
  unit.fields.condition.rep = null
  assert.equal(fieldNeedsReview(unit, def('condition')), false)
})

test('a changed category invalidates completed fields outside the server taxonomy scope', () => {
  const unit = sample()
  applyTaxonomy({ categories: ['스킨케어'], category_groups: { 스킨케어: 'skin' }, body_parts: ['얼굴전체', '두피전체'], body_parts_groups: { 얼굴전체: ['skin'], 두피전체: ['hair'] } })
  try {
    unit.fields.area.selected = ['두피전체']
    assert.equal(fieldNeedsReview(unit, def('area')), true)
  } finally { applyTaxonomy(null) }
})
