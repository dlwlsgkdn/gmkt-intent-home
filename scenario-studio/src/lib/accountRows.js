/* 서버 행(row) 분해·조립 — 계정 하나를 세 종류 행으로 나눠 저장한다.
 *   account:<id>                 본문 (프로필·탐색·시나리오 — 버전 스냅샷 제외)
 *   account:<id>:threads         쓰레드 (체험 기록 — 계속 자라는 로그)
 *   account:<id>:versions:<sid>  시나리오 하나의 발행 버전 스냅샷 (스냅샷 = 시나리오 전체 사본이라 페이로드 주범)
 *
 * 나눈 이유: 첫 접속 하이드레이션이 홈 첫 화면에 필요 없는 무거운 데이터(버전 스냅샷·쓰레드)까지
 * 내려받느라 오래 걸렸다. 본문 행만으로 홈을 먼저 그리고 나머지는 백그라운드로 받는다.
 * 업로드도 바뀐 행만 보내면 된다 — 쓰레드 기록이 시나리오 본문을, 발행이 쓰레드를 다시 실어 나르지 않는다.
 *
 * 구(통짜) 계정 행은 threads 키 포함 여부로 식별한다(isFatAccountRow) — 본문 행은
 * threads·scenarios[].versions 키를 아예 갖지 않는다. useWorkspace의 하이드레이션이
 * 통짜 행을 만나면 분리 행으로 이관한다(부속 행 먼저, 본문 행 마지막 — 본문이 이관 완료 표식). */

export const accountKey = (id) => `account:${id}`
export const threadsKey = (id) => `account:${id}:threads`
export const versionsKey = (id, scenarioId) => `account:${id}:versions:${scenarioId}`

/* 'account:...' 키 해석 → { kind: 'slim'|'threads'|'versions', accountId, scenarioId? } | null
   ('accounts'·'accounts-meta'·'keywords' 등 다른 키는 null) */
export function parseAccountKey(key) {
  if (typeof key !== 'string' || !key.startsWith('account:')) return null
  const parts = key.slice('account:'.length).split(':')
  if (parts.length === 1 && parts[0]) return { kind: 'slim', accountId: parts[0] }
  if (parts.length === 2 && parts[0] && parts[1] === 'threads') return { kind: 'threads', accountId: parts[0] }
  if (parts.length === 3 && parts[0] && parts[1] === 'versions' && parts[2]) {
    return { kind: 'versions', accountId: parts[0], scenarioId: parts[2] }
  }
  return null
}

/* 행 분리 이전의 통짜 계정 행인가 — 본문 행은 threads 키를 아예 갖지 않는다 */
export const isFatAccountRow = (data) => !!data && typeof data === 'object' && 'threads' in data

/* 계정 → 서버 행 3종. versionsBySid에는 스냅샷이 실제로 있는 시나리오만 담는다 */
export function splitAccount(account) {
  const slim = { ...account }
  delete slim.threads
  slim.scenarios = (account.scenarios || []).map((scenario) => {
    const copy = { ...scenario }
    delete copy.versions
    return copy
  })
  const versionsBySid = {}
  for (const scenario of account.scenarios || []) {
    if (Array.isArray(scenario.versions) && scenario.versions.length > 0) {
      versionsBySid[scenario.id] = scenario.versions
    }
  }
  return { slim, threads: Array.isArray(account.threads) ? account.threads : [], versionsBySid }
}

/* 서버 행 3종 → 계정 하나 (normalizeAccountsState 전 단계의 원시 형태).
   slim이 통짜 행이어도 동작한다 — threads는 인자가 덮고 인라인 versions는 그대로 남는다 */
export function assembleAccount(slim, threads, versionsBySid) {
  return {
    ...slim,
    threads: Array.isArray(threads) ? threads : (isFatAccountRow(slim) ? slim.threads : []),
    scenarios: (slim.scenarios || []).map((scenario) => {
      const versions = versionsBySid && versionsBySid[scenario.id]
      return Array.isArray(versions) && versions.length > 0 ? { ...scenario, versions } : scenario
    }),
  }
}

/* 본문이 바뀌었는가 — threads를 뺀 나머지 필드의 얕은 참조 비교.
   patchActive·updateScenario가 무변경 시 같은 참조를 유지하는 사슬 위에서만 성립한다.
   versions 변경(발행)은 scenarios 배열 참조를 함께 바꾸므로 본문 전송에 포함된다(과전송 허용) */
export function accountSlimChanged(account, baseline) {
  if (!baseline) return true
  const fields = new Set([...Object.keys(account), ...Object.keys(baseline)])
  fields.delete('threads')
  for (const field of fields) {
    if (account[field] !== baseline[field]) return true
  }
  return false
}
