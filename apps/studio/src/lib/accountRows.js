/* 서버 행(row) 분해·조립 — 계정 하나를 "화면이 필요로 하는 단위"의 행으로 나눠 저장한다.
 *   account:<id>                 셸 본문: 프로필·탐색·시나리오 칩 메타 — 홈 첫 화면에 필요한 전부 (수십 KB)
 *   account:<id>:scenario:<sid>  시나리오 콘텐츠 { stages, planCases } — 칩 클릭 체험·빌더에서 필요
 *   account:<id>:versions:<sid>  발행 버전 스냅샷 — 빌더(버전 복원) 전용, 스튜디오 진입 시에만 로드
 *   account:<id>:threads         쓰레드 (체험 기록 로그) — 쓰레드 패널·이어보기용
 *
 * 나눈 이유: 첫 접속 하이드레이션이 홈에 필요 없는 무거운 데이터(케이스 72개·버전 스냅샷·쓰레드)까지
 * 기다리게 했다. 셸 본문만으로 홈을 그리고, 콘텐츠는 백그라운드, 버전은 스튜디오 진입 시 로드한다.
 *
 * 구형 판별 (하이드레이션이 만나면 새 행 체계로 이관):
 *   1차(통짜 계정 행): threads 키 포함 → isFatAccountRow. 버전·쓰레드·콘텐츠 전부 인라인.
 *   2차(콘텐츠 본문): scenarios[]에 stages/planCases 키 포함 → isContentBodyRow. 버전·쓰레드만 분리된 형식.
 *   새 셸 본문은 threads도, scenarios[].stages/planCases/versions도 아예 갖지 않는다. */

export const accountKey = (id) => `account:${id}`
export const threadsKey = (id) => `account:${id}:threads`
export const versionsKey = (id, scenarioId) => `account:${id}:versions:${scenarioId}`
export const scenarioKey = (id, scenarioId) => `account:${id}:scenario:${scenarioId}`

/* 'account:...' 키 해석 → { kind: 'slim'|'scenario'|'versions'|'threads', accountId, scenarioId? } | null
   ('accounts'·'accounts-meta'·'keywords' 등 다른 키는 null) */
export function parseAccountKey(key) {
  if (typeof key !== 'string' || !key.startsWith('account:')) return null
  const parts = key.slice('account:'.length).split(':')
  if (parts.length === 1 && parts[0]) return { kind: 'slim', accountId: parts[0] }
  if (parts.length === 2 && parts[0] && parts[1] === 'threads') return { kind: 'threads', accountId: parts[0] }
  if (parts.length === 3 && parts[0] && parts[2]) {
    if (parts[1] === 'versions') return { kind: 'versions', accountId: parts[0], scenarioId: parts[2] }
    if (parts[1] === 'scenario') return { kind: 'scenario', accountId: parts[0], scenarioId: parts[2] }
  }
  return null
}

/* 1차 구형: 버전·쓰레드 인라인 통짜 행 */
export const isFatAccountRow = (data) => !!data && typeof data === 'object' && 'threads' in data

/* 2차 구형: 시나리오 콘텐츠(stages/planCases)가 본문에 인라인 */
export const isContentBodyRow = (data) =>
  !!data && typeof data === 'object' && Array.isArray(data.scenarios)
  && data.scenarios.some((s) => !!s && typeof s === 'object' && ('stages' in s || 'planCases' in s))

/* 시나리오 → 셸(칩 메타 — 홈 렌더·검색 매칭이 읽는 전부)과 콘텐츠 */
export function scenarioShell(scenario) {
  const shell = { ...scenario }
  delete shell.stages
  delete shell.planCases
  delete shell.versions
  return shell
}

export const scenarioContent = (scenario) => ({
  stages: scenario.stages && typeof scenario.stages === 'object' ? scenario.stages : {},
  planCases: Array.isArray(scenario.planCases) ? scenario.planCases : [],
})

/* 빈 스켈레톤 판정 — 스테이지에 아이템이 하나도 없고 케이스에도 내용(아이템·조건)이 없다.
   셸만 받아 assembleAccount가 빈 값으로 채운 시나리오를 push가 "서버에 없는 새 행"으로
   올려 굳히는 사고(실제 콘텐츠 행이 아직 안 올라온 시나리오를 빈 값으로 확정)를 막는 기준 */
export const isEmptyScenarioContent = (scenario) => {
  const stages = scenario?.stages && typeof scenario.stages === 'object' ? scenario.stages : {}
  if (Object.values(stages).some((items) => Array.isArray(items) && items.length > 0)) return false
  const cases = Array.isArray(scenario?.planCases) ? scenario.planCases : []
  return cases.every((c) => !(c?.items?.length) && !(c?.conditions?.length))
}

/* 계정 → 서버 행들. contentBySid는 모든 시나리오, versionsBySid는 스냅샷이 있는 시나리오만 */
export function splitAccount(account) {
  const shellBody = { ...account }
  delete shellBody.threads
  shellBody.scenarios = (account.scenarios || []).map(scenarioShell)
  const contentBySid = {}
  const versionsBySid = {}
  for (const scenario of account.scenarios || []) {
    contentBySid[scenario.id] = scenarioContent(scenario)
    if (Array.isArray(scenario.versions) && scenario.versions.length > 0) {
      versionsBySid[scenario.id] = scenario.versions
    }
  }
  return { shellBody, contentBySid, threads: Array.isArray(account.threads) ? account.threads : [], versionsBySid }
}

/* 본문 행 + 콘텐츠 소스 → 계정 하나 (normalize 전 원시 형태).
   구형 본문(콘텐츠·버전 인라인)은 인라인 값이 우선이고, 새 셸 본문은 서버 콘텐츠 행 →
   같은 id의 로컬 계정 → 빈 값 순서로 채운다 (로컬 대체분은 해당 행이 로드될 때 서버 값으로 확정) */
export function assembleAccount(body, { contentBySid = {}, threads, versionsBySid = {}, localAccount = null } = {}) {
  const localScenarios = new Map((localAccount?.scenarios || []).map((s) => [s.id, s]))
  return {
    ...body,
    threads: Array.isArray(threads) ? threads
      : isFatAccountRow(body) ? body.threads
        : Array.isArray(localAccount?.threads) ? localAccount.threads : [],
    scenarios: (body.scenarios || []).map((shell) => {
      const local = localScenarios.get(shell.id)
      const content = contentBySid[shell.id]
        || (('stages' in shell || 'planCases' in shell) ? scenarioContent(shell) : null)
        || (local ? scenarioContent(local) : null)
        || { stages: {}, planCases: [] }
      const versions = versionsBySid[shell.id]
        || (Array.isArray(shell.versions) ? shell.versions : null)
        || (Array.isArray(local?.versions) ? local.versions : null)
        || []
      return { ...shell, stages: content.stages, planCases: content.planCases, versions }
    }),
  }
}
