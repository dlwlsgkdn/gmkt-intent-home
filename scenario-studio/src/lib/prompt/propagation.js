import {
  componentEvaluationStructureForCase,
  evaluationLeaderboard,
  normalizeCaseEvaluation,
  normalizeComponentEvaluation,
} from '../evaluation.js'
import { parseJsonAnswer } from './jsonAnswer.js'

/*
 * 평가 피드백의 전체 전파.
 *
 * 평가 탭의 존재 이유가 여기서 완성된다: 사람이 73개 케이스를 다 볼 수 없으니
 * 라운드당 3개(CASE A/B/C)씩 로테이션으로 평가하고, 거기서 나온 피드백을
 * "패턴"으로 삼아 나머지 케이스들의 같은 자리에서 같은 문제를 찾아 고치게 한다.
 *
 * 씨앗(seed) = 평가한 케이스의 피드백 + 그 컴포넌트의 현재 필드 값(모범 예시 —
 * 사람이 이미 고쳐 둔 상태라면 그 자체가 정답 예시가 된다). 로테이션으로 라운드가
 * 쌓이면 씨앗도 누적되며, 리더보드(평균 별점 내림차순) 순서로 정렬되고 상위 N개
 * 케이스로 제한할 수 있다(caseLimit).
 * 대상(target) = 평가 흔적이 있는 케이스 전부를 제외한 나머지 — 씨앗 제한과
 * 무관하게, 사람 손을 탄 케이스를 배치 수정이 덮지 않는다.
 *
 * 안전 모델은 문구 다듬기(revision.js)와 동일하다: 요청에 실어 보낸
 * caseId·itemId·fieldKey 목록이 곧 허용 목록이고, before가 현재 값과 다르면
 * 차단된다. 구조 변경은 이 경로가 아니라 "페이지 재구성 → 조합 케이스 교체"가 맡는다.
 */

export const PROPAGATION_BATCH_SIZE = 12 // 배치당 대상 케이스 수

export const PROPAGATION_RESPONSE_SCHEMA = {
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
        required: ['caseId', 'itemId', 'fieldKey', 'before', 'after', 'reason'],
        properties: {
          caseId: { type: 'string' },
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

/* 평가한 케이스에서 씨앗 수집 — 리더보드(평균 별점 내림차순) 순서.
   caseLimit을 주면 상위 N개 케이스의 피드백만 씨앗이 된다.
   evaluatedCaseIds는 제한과 무관하게 평가 흔적이 있는 케이스 전부(대상 제외용). */
export function collectPropagationSeeds(planCases = [], { caseLimit = null } = {}) {
  const board = evaluationLeaderboard(planCases)
  const seedBoard = caseLimit ? board.slice(0, caseLimit) : board
  const componentSeeds = []
  const caseNotes = []
  seedBoard.forEach((entry) => {
    const planCase = entry.planCase
    const evaluation = normalizeCaseEvaluation(planCase.evaluation)
    if (evaluation.review.feedback.trim()) {
      caseNotes.push({
        slot: entry.slot,
        rank: entry.rank,
        caseName: planCase.name,
        feedback: evaluation.review.feedback.trim(),
      })
    }
    componentEvaluationStructureForCase(planCase).forEach((section) => {
      section.components.forEach((component) => {
        const review = normalizeComponentEvaluation(evaluation.components[component.itemId])
        if (!review.feedback.trim()) return
        componentSeeds.push({
          id: `${planCase.id}:${component.itemId}`,
          slot: entry.slot,
          rank: entry.rank,
          caseAverage: entry.average,
          caseName: planCase.name,
          type: component.type,
          score: review.score,
          // 반영 완료(✓)면 현재 값이 검증된 모범 예시, 미해결이면 아직 문제가 남은 값
          resolved: review.resolved,
          feedback: review.feedback.trim(),
          exemplar: Object.fromEntries(
            (component.editableFields || []).map((field) => [field.fieldKey, field.value])
          ),
        })
      })
    })
  })
  return {
    componentSeeds,
    caseNotes,
    evaluatedCaseIds: board.map((entry) => entry.caseId),
    leaderboard: board,
  }
}

/* 전파 대상: 평가 흔적이 있는 케이스 전부를 제외한 나머지에서, 씨앗과 같은 타입
   컴포넌트의 편집 가능 필드. 컴포넌트 씨앗이 없고 케이스 코멘트만 있으면 모든
   평가 대상 타입을 포함한다. */
export function propagationTargets(planCases, seeds) {
  const seedTypes = new Set(seeds.componentSeeds.map((seed) => seed.type))
  const evaluatedCaseIds = new Set(seeds.evaluatedCaseIds)
  return planCases
    .filter((planCase) => !evaluatedCaseIds.has(planCase.id))
    .map((planCase) => ({
      caseId: planCase.id,
      name: planCase.name,
      components: componentEvaluationStructureForCase(planCase)
        .flatMap((section) => section.components)
        .filter((component) => (seedTypes.size > 0 ? seedTypes.has(component.type) : true))
        .map((component) => ({
          itemId: component.itemId,
          type: component.type,
          fields: Object.fromEntries(
            (component.editableFields || []).map((field) => [field.fieldKey, field.value])
          ),
        }))
        .filter((component) => Object.keys(component.fields).length > 0),
    }))
    .filter((target) => target.components.length > 0)
}

export const chunkTargets = (targets, size = PROPAGATION_BATCH_SIZE) => {
  const batches = []
  for (let index = 0; index < targets.length; index += size) batches.push(targets.slice(index, index + size))
  return batches
}

export function buildPropagationRequest({ scenario, seeds, targets }) {
  return {
    schemaVersion: 1,
    scenario: { title: scenario?.title || '', query: scenario?.query || scenario?.title || '' },
    rules: {
      allowStructuralChanges: false,
      allowUnknownFields: false,
      onlyListedFields: true,
    },
    seeds: {
      caseNotes: seeds.caseNotes.map((note) => ({
        fromCase: note.slot ? `CASE ${note.slot} · ${note.caseName}` : `리더보드 ${note.rank}위 · ${note.caseName}`,
        feedback: note.feedback,
      })),
      components: seeds.componentSeeds.map((seed) => ({
        fromCase: seed.slot ? `CASE ${seed.slot} · ${seed.caseName}` : `리더보드 ${seed.rank}위 · ${seed.caseName}`,
        caseAverageScore: seed.caseAverage,
        type: seed.type,
        feedback: seed.feedback,
        exemplarTrusted: seed.resolved,
        exemplar: seed.exemplar,
      })),
    },
    targets,
  }
}

export function buildPropagationPrompt(request) {
  return [
    '당신은 쇼핑 시나리오 콘텐츠 에디터입니다.',
    '사람이 케이스들을 평가해 남긴 피드백(seeds)이 있습니다. 씨앗은 평균 별점 리더보드 순으로 정렬되어 있습니다.',
    '같은 문제가 나머지 케이스(targets)의 같은 자리에도 존재합니다 — 케이스들은 한 시나리오의 조합 변형이기 때문입니다.',
    '피드백의 의도를 각 대상 케이스의 문맥(케이스 이름 = 설문 답변 조합)에 맞게 적용해 수정안을 만드세요.',
    '',
    '규칙:',
    '1. targets[].components[].fields에 나열된 caseId/itemId/fieldKey 조합만 수정합니다.',
    '2. seeds.components[].exemplar는 평가한 케이스의 현재 값입니다. exemplarTrusted가 true면 피드백이 반영된 모범 예시이니',
    '   문체·구조·정보 밀도를 이 수준으로 맞추고, false면 아직 문제가 남은 값이니 피드백의 의도를 우선합니다.',
    '   어느 쪽이든 예시를 그대로 복사하지 않고, 각 케이스의 조합 특성이 드러나게 표현은 달리합니다.',
    '3. seeds.caseNotes는 케이스 전체에 대한 피드백입니다. 문구로 반영할 수 있는 내용만 적용하고 구조 요청은 무시합니다.',
    '   씨앗끼리 상충하면 먼저 나오는(리더보드 상위) 씨앗을 우선합니다.',
    '4. before에는 fields의 값을 정확히 복사하고, after에는 해당 필드의 전체 교체 문구를 씁니다.',
    '5. 같은 문제가 없는 필드는 건드리지 않습니다. 수정이 필요 없으면 revisions에 넣지 않습니다.',
    '6. 상품 사실(가격·효능·링크)을 추측하거나 새로 만들지 않습니다.',
    '7. 모든 문구는 한국어 존댓말로 씁니다.',
    '8. 설명 없이 아래 스키마의 JSON 하나만 출력합니다.',
    '',
    '출력 스키마:',
    JSON.stringify(PROPAGATION_RESPONSE_SCHEMA, null, 2),
    '',
    '피드백과 대상 데이터:',
    JSON.stringify(request, null, 2),
  ].join('\n')
}

/* ── 응답 검증 — 배치 요청의 필드 목록이 곧 허용 목록 ── */
export function validatePropagationResponse(raw, request) {
  let payload
  try {
    payload = parseJsonAnswer(raw)
  } catch (error) {
    return { revisions: [], errors: [`JSON 해석 실패: ${error.message}`], warnings: [], summary: '' }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.revisions)) {
    return { revisions: [], errors: ['응답에서 revisions 배열을 찾을 수 없습니다.'], warnings: [], summary: '' }
  }

  const allowlist = new Map()
  const caseNames = {}
  ;(request.targets || []).forEach((target) => {
    caseNames[target.caseId] = target.name
    target.components.forEach((component) => {
      Object.entries(component.fields).forEach(([fieldKey, value]) => {
        allowlist.set([target.caseId, component.itemId, fieldKey].join(':'), {
          caseId: target.caseId,
          caseName: target.name,
          itemId: component.itemId,
          itemType: component.type,
          fieldKey,
          before: String(value ?? ''),
        })
      })
    })
  })

  const seen = new Set()
  const revisions = []
  const errors = []
  const warnings = []
  payload.revisions.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? raw : {}
    const key = [String(row.caseId || ''), String(row.itemId || ''), String(row.fieldKey || '')].join(':')
    const allowed = allowlist.get(key)
    if (!allowed) {
      errors.push(`${index + 1}번 수정안은 허용되지 않은 케이스/컴포넌트/필드입니다.`)
      return
    }
    if (seen.has(key)) {
      errors.push(`${index + 1}번 수정안은 같은 필드를 중복 수정합니다.`)
      return
    }
    if (typeof row.after !== 'string') {
      errors.push(`${index + 1}번 수정안의 after는 문자열이어야 합니다.`)
      return
    }
    if (String(row.before ?? '') !== allowed.before) {
      errors.push(`${index + 1}번 수정안의 before가 현재 값과 다릅니다. (${allowed.caseName})`)
      return
    }
    if (row.after === allowed.before) {
      warnings.push(`${index + 1}번 수정안은 현재 값과 같아 제외했습니다.`)
      return
    }
    seen.add(key)
    revisions.push({ ...allowed, after: row.after, reason: String(row.reason || '') })
  })

  return { revisions, errors, warnings, summary: String(payload.summary || '') }
}
