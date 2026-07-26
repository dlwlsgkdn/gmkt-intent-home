/*
 * 평가 피드백 → 수정안 왕복.
 *
 * 평가 탭에 적힌 피드백을 구조화한 요청으로 만들고(buildLlmRevisionRequest),
 * 그 요청을 담은 프롬프트를 사용자가 쓰던 AI에 붙여넣게 한다.
 * 돌아온 JSON은 요청에 들어 있던 허용 목록(caseId·itemId·fieldKey)과 대조해
 * 허용되지 않은 필드·구조 변경·before 불일치를 전부 걸러낸 뒤에야 적용 후보가 된다.
 */
import {
  componentEvaluationStructureForCase,
  evaluationCasesFor,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
} from '../evaluation.js'
import { parseJsonAnswer } from './jsonAnswer.js'

export const LLM_REVISION_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'revisions'],
  properties: {
    summary: { type: 'string' },
    revisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caseId', 'criterionKey', 'itemId', 'fieldKey', 'before', 'after', 'reason'],
        properties: {
          caseId: { type: 'string' },
          criterionKey: { type: 'string' },
          itemId: { type: 'string' },
          fieldKey: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
}

const targetByCriterionKey = (planCase) => {
  const entries = componentEvaluationStructureForCase(planCase).flatMap((section) =>
    section.components.map((component) => [
      component.reviewKey,
      {
        ...component,
        step: section.step,
        targetKey: component.type,
        targetLabel: component.type,
      },
    ])
  )
  return Object.fromEntries(entries)
}

export function buildLlmRevisionRequest(planCases = [], options = {}) {
  const includeResolved = !!options.includeResolved
  const cases = evaluationCasesFor(planCases).map((planCase) => {
    const evaluation = normalizeCaseEvaluation(planCase.evaluation)
    const targetMap = targetByCriterionKey(planCase)
    const criteria = Object.entries(targetMap)
      .map(([criterionKey, target]) => {
        const review = normalizeComponentEvaluation(evaluation.components[target.itemId])
        if (!review.feedback.trim()) return null
        if (!includeResolved && review.resolved) return null
        return {
          criterionKey,
          step: target.step,
          targetKey: target.targetKey,
          targetLabel: target.targetLabel,
          score: review.score,
          feedback: review.feedback.trim(),
          currentPreview: target.preview,
          allowedEdits: (target.editableFields || []).map((field) => ({
            itemId: field.itemId,
            itemType: field.itemType,
            fieldKey: field.fieldKey,
            fieldLabel: field.fieldLabel,
            value: String(field.value ?? ''),
          })),
        }
      })
      .filter(Boolean)

    return {
      caseId: planCase.id,
      slot: evaluation.selection.slot,
      caseName: planCase.name,
      // 케이스 전체 코멘트 — 문구에 반영할 맥락으로만 쓰고, 구조 요청은 이 경로에서 처리하지 않는다
      caseNote: evaluation.review.feedback.trim(),
      criteria,
    }
  }).filter((planCase) => planCase.criteria.length > 0 || planCase.caseNote)

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: includeResolved ? 'all-feedback' : 'unresolved-feedback',
    rules: {
      allowStructuralChanges: false,
      allowUnknownFields: false,
      allowPriceOrUrlChanges: false,
      requireHumanReviewBeforeApply: true,
    },
    feedbackCount: cases.reduce((sum, planCase) => sum + planCase.criteria.length, 0),
    cases,
  }
}

export function buildLlmRevisionPrompt(request) {
  return [
    '당신은 쇼핑 시나리오 콘텐츠 에디터입니다.',
    '아래 평가 피드백을 반영한 최소 수정안을 만드세요.',
    '',
    '규칙:',
    '1. criteria[].allowedEdits에 있는 caseId/itemId/fieldKey 조합만 수정합니다.',
    '2. 컴포넌트 추가·삭제·순서·조건·가격·URL은 변경하지 않습니다.',
    '3. before에는 allowedEdits.value를 정확히 복사하고, after에는 해당 필드의 전체 교체 문구를 씁니다.',
    '4. 피드백 하나에 여러 필드 수정이 필요하면 revisions를 여러 개 만듭니다.',
    '5. 상품 관련 사실을 추측하거나 새 효능·가격·링크를 만들지 않습니다.',
    '6. 수정할 필요가 없는 피드백은 revisions에 넣지 않습니다.',
    '6-1. cases[].caseNote는 케이스 전체에 대한 참고 맥락입니다. 문구·톤에 반영할 수 있는 내용만 활용하고,',
    '     컴포넌트 추가·삭제 같은 구조 요청이 섞여 있으면 그 부분은 무시합니다(다른 도구가 처리합니다).',
    '7. 설명이나 Markdown 없이 아래 스키마의 JSON 하나만 출력합니다.',
    '',
    '출력 스키마:',
    JSON.stringify(LLM_REVISION_RESPONSE_SCHEMA, null, 2),
    '',
    '평가 피드백 데이터:',
    JSON.stringify(request, null, 2),
  ].join('\n')
}

const responsePayload = (raw) => {
  const payload = parseJsonAnswer(raw)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('응답이 JSON 객체가 아닙니다.')
  }
  if (!Array.isArray(payload.revisions)) {
    throw new Error('응답에서 revisions 배열을 찾을 수 없습니다.')
  }
  return payload
}

const allowlistForRequest = (request) => {
  const allowlist = new Map()
  ;(request.cases || []).forEach((planCase) => {
    ;(planCase.criteria || []).forEach((criterion) => {
      ;(criterion.allowedEdits || []).forEach((field) => {
        const key = [planCase.caseId, criterion.criterionKey, field.itemId, field.fieldKey].join(':')
        allowlist.set(key, {
          caseId: planCase.caseId,
          criterionKey: criterion.criterionKey,
          itemId: field.itemId,
          itemType: field.itemType,
          fieldKey: field.fieldKey,
          fieldLabel: field.fieldLabel,
          before: String(field.value ?? ''),
        })
      })
    })
  })
  return allowlist
}

export function validateLlmRevisionResponse(raw, request) {
  let payload
  try {
    payload = responsePayload(raw)
  } catch (error) {
    return {
      summary: '',
      revisions: [],
      errors: [`JSON 해석 실패: ${error.message}`],
      warnings: [],
    }
  }

  if (!Array.isArray(payload.revisions)) {
    return {
      summary: '',
      revisions: [],
      errors: ['revisions가 배열이 아닙니다.'],
      warnings: [],
    }
  }

  const allowlist = allowlistForRequest(request)
  const seen = new Set()
  const revisions = []
  const errors = []
  const warnings = []

  payload.revisions.forEach((rawRevision, index) => {
    const row = rawRevision && typeof rawRevision === 'object' ? rawRevision : {}
    const caseId = String(row.caseId || '')
    const criterionKey = String(row.criterionKey || '')
    const itemId = String(row.itemId || '')
    const fieldKey = String(row.fieldKey || '')
    const lookupKey = [caseId, criterionKey, itemId, fieldKey].join(':')
    const allowed = allowlist.get(lookupKey)
    if (!allowed) {
      errors.push(`${index + 1}번 수정안은 허용되지 않은 컴포넌트 또는 필드입니다.`)
      return
    }
    if (seen.has(lookupKey)) {
      errors.push(`${index + 1}번 수정안은 같은 필드를 중복 수정합니다.`)
      return
    }
    if (typeof row.after !== 'string') {
      errors.push(`${index + 1}번 수정안의 after는 문자열이어야 합니다.`)
      return
    }
    if (String(row.before ?? '') !== allowed.before) {
      errors.push(`${index + 1}번 수정안의 before가 현재 값과 다릅니다.`)
      return
    }
    if (row.after === allowed.before) {
      warnings.push(`${index + 1}번 수정안은 현재 값과 같아 제외했습니다.`)
      return
    }
    seen.add(lookupKey)
    revisions.push({
      ...allowed,
      after: row.after,
      reason: String(row.reason || ''),
    })
  })

  return {
    summary: String(payload.summary || ''),
    revisions,
    errors,
    warnings,
  }
}

export function applyLlmRevisionsToPlanCases(planCases = [], revisions = []) {
  let applied = 0
  const revisionsByCase = new Map()
  revisions.forEach((revision) => {
    const list = revisionsByCase.get(revision.caseId) || []
    list.push(revision)
    revisionsByCase.set(revision.caseId, list)
  })

  const nextPlanCases = planCases.map((planCase) => {
    const caseRevisions = revisionsByCase.get(planCase.id) || []
    if (caseRevisions.length === 0) return planCase
    const revisionsByItem = new Map()
    caseRevisions.forEach((revision) => {
      const list = revisionsByItem.get(revision.itemId) || []
      list.push(revision)
      revisionsByItem.set(revision.itemId, list)
    })
    return {
      ...planCase,
      items: (planCase.items || []).map((item) => {
        const itemRevisions = revisionsByItem.get(item.id) || []
        if (itemRevisions.length === 0) return item
        const props = { ...(item.props || {}) }
        let changed = false
        itemRevisions.forEach((revision) => {
          if (String(props[revision.fieldKey] ?? '') !== revision.before) return
          props[revision.fieldKey] = revision.after
          applied++
          changed = true
        })
        return changed ? { ...item, props } : item
      }),
    }
  })

  return {
    planCases: nextPlanCases,
    applied,
    skipped: Math.max(0, revisions.length - applied),
  }
}
