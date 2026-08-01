import { normalizeScenario, uid } from './store.js'
import { remapCaseEvaluation } from './evaluation.js'

/*
 * 시나리오를 통째로 복사해 오는 순수 연산 — 복제·가져오기·공유 링크 채택이 공유한다.
 *
 * 핵심은 id 재발급이다. 아이템 id는 세 곳에서 참조된다:
 *   · 컨테이너 자식의 parentId
 *   · 계획 케이스 조건의 questionId (설문 질문을 가리킨다)
 *   · 평가 기록의 컴포넌트별 키
 * 한 군데라도 옛 id를 남기면 사본이 원본과 얽히거나 조건이 조용히 안 맞는다.
 */

/* 사본을 "내 것"으로 만드는 공통 표시 — 새 id를 받고 구 기본 팩 소속을 뗀다.
   (발행 상태·버전 이력을 지울지는 경로마다 다르므로 여기서 정하지 않는다) */
const asFreshCopy = (patch) => ({
  id: uid(),
  sourcePackId: undefined,
  isDefaultScenario: false,
  updatedAt: new Date().toISOString(),
  ...patch,
})

/* 내 스튜디오에서 새로 시작하는 사본 — 발행 이력을 끊고 작성 중으로 되돌린다 */
const asUnpublished = { status: 'draft', versions: [], versionAt: undefined }

/* id 재발급 사본의 공통 코어 — 문서 상단의 세 참조처(parentId·questionId·평가 키)를 함께 다시 매단다 */
function cloneScenarioWith(source, patch) {
  const idMap = {}
  const allItems = [
    source.stages.survey || [],
    ...(source.planCases || []).map((planCase) => planCase.items || []),
  ].flat()
  allItems.forEach((item) => { idMap[item.id] = uid() })

  const cloneItems = (list) => list.map((item) => ({
    ...item,
    id: idMap[item.id],
    parentId: item.parentId ? idMap[item.parentId] : undefined,
    props: JSON.parse(JSON.stringify(item.props || {})),
    style: item.style ? { ...item.style } : undefined,
  }))

  return normalizeScenario({
    ...source,
    ...asFreshCopy(patch),
    stages: { ...source.stages, survey: cloneItems(source.stages.survey || []), plan: [] },
    planCases: (source.planCases || []).map((planCase) => ({
      ...planCase,
      id: uid(),
      conditions: (planCase.conditions || []).map((condition) => ({
        ...condition,
        id: uid(),
        questionId: idMap[condition.questionId] || condition.questionId,
        values: [...(condition.values || [])],
      })),
      items: cloneItems(planCase.items || []),
      evaluation: remapCaseEvaluation(planCase.evaluation, idMap),
    })),
  })
}

export function duplicateScenario(source) {
  return cloneScenarioWith(source, {
    ...asUnpublished,
    title: `${source.title} 복사본`,
    chip: source.chip ? `${source.chip}_복사` : '복사본',
    createdAt: new Date().toISOString(),
  })
}

/* 기본 시나리오 라이브러리에 올리는 스냅샷 — 지정 시점 모습의 불변 사본. 라이브러리
   항목 id를 시나리오 id로 고정해(같은 원본 재지정 = 같은 행 덮어쓰기) 서버 행 정리를
   단순하게 유지한다. 원본과의 동기화는 없다 — 이후 원본 편집은 반영되지 않는다 */
export function starterSnapshot(source, id) {
  return cloneScenarioWith(source, {
    id,
    versions: [],
    versionAt: undefined,
    createdAt: new Date().toISOString(),
  })
}

/* 기본 시나리오 스냅샷을 새 프로필에 설치하는 사본 — 이름·칩·발행 상태를 그대로 두어
   설치 직후 홈에 칩이 뜬다. id는 다시 재발급된다(프로필마다 독립 사본) */
export function installStarterCopy(source) {
  return cloneScenarioWith(source, {
    versions: [],
    versionAt: undefined,
    createdAt: new Date().toISOString(),
  })
}

/* 외부 JSON 배열 → 등록 가능한 시나리오 목록. stages가 없는 항목은 조용히 버린다.
   발행 상태는 파일에 적힌 그대로 둔다 — 발행된 시나리오를 내보냈다 다시 들여오면
   홈 칩도 함께 돌아오는 게 사용자가 기대하는 동작이다. */
export function scenariosFromImport(list) {
  if (!Array.isArray(list)) return null
  return list
    .filter((entry) => entry && typeof entry === 'object' && entry.stages)
    .map((entry) => normalizeScenario({ ...entry, ...asFreshCopy({}) }))
}

/* 공유 링크로 받은 시나리오를 내 스튜디오 소유로 채택 */
export function adoptSharedScenario(shared) {
  return normalizeScenario({ ...shared, ...asFreshCopy(asUnpublished) })
}
