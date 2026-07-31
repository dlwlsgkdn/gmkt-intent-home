import { REMOTE_ENABLED, fetchRemoteKey } from '../../lib/remote.js'
import {
  accountKey,
  parseAccountKey,
  scenarioKey,
  threadsKey,
  versionsKey,
} from '../../lib/accountRows.js'

/*
 * 필요 시점 로드 — 부트가 안 받은 행을 화면이 필요로 하는 순간 서버에서 받아 채택한다.
 *   · 칩 클릭(플레이) 전   ensureScenarioSynced
 *   · 스튜디오(빌더) 진입 전 ensureStudioSynced (버전 스냅샷은 여기서만)
 *   · 프로필 전환·내보내기 전 ensureAccountSynced / ensureActiveSynced / ensureAllSynced
 */
export function createOnDemandSync(ctx, adoption) {
  const {
    stateRef, rowsRef, serverIndexRef, localAuthorityRef,
    inFlightRef, bootDeferredRef, setSyncingAccountIds,
  } = ctx
  const { adoptBodyRow, adoptScenarioRow, adoptVersionsRow, adoptThreadsRow } = adoption

  /* 행 하나를 서버에서 받아 채택한다. 이미 맞춘 행·서버에 없는 행·로컬 권위 세션은 즉시 통과,
     중복 요청은 같은 Promise를 공유한다 */
  const syncRow = (key) => {
    if (!REMOTE_ENABLED || localAuthorityRef.current) return Promise.resolve()
    if (rowsRef.current.get(key)?.loaded) return Promise.resolve()
    if (!serverIndexRef.current.has(key)) return Promise.resolve()
    if (inFlightRef.current.has(key)) return inFlightRef.current.get(key)
    const parsed = parseAccountKey(key)
    if (!parsed) return Promise.resolve()
    const run = fetchRemoteKey(key)
      .then((row) => {
        const data = row ? row.data : null
        if (data === null) return
        if (parsed.kind === 'slim') adoptBodyRow(data)
        else if (parsed.kind === 'scenario') adoptScenarioRow(parsed.accountId, parsed.scenarioId, data)
        else if (parsed.kind === 'versions') adoptVersionsRow(parsed.accountId, parsed.scenarioId, data)
        else if (parsed.kind === 'threads') adoptThreadsRow(parsed.accountId, data)
      })
      .finally(() => inFlightRef.current.delete(key))
    inFlightRef.current.set(key, run)
    return run
  }

  /* 시나리오의 소유 계정 — 활성 계정 우선. 기본 시나리오는 번들 팩의 고정 id라 여러
     프로필이 같은 시나리오 id를 공유한다 — 목록 순서로 찾으면 다른 계정을 짚어서,
     활성 계정의 행은 로드돼 있는데도 남의 행을 받으러 가는 헛로드가 생긴다 */
  const findOwner = (scenarioId) => {
    const { accounts, activeAccountId } = stateRef.current
    const activeAccount = accounts.find((account) => account.id === activeAccountId) || accounts[0]
    if (activeAccount && (activeAccount.scenarios || []).some((s) => s.id === scenarioId)) return activeAccount
    return accounts.find((account) => (account.scenarios || []).some((s) => s.id === scenarioId))
  }

  /* 칩 클릭(플레이) 전: 시나리오 콘텐츠를 서버와 맞춘다 */
  const ensureScenarioSynced = async (scenarioId) => {
    await bootDeferredRef.current.promise
    const owner = findOwner(scenarioId)
    if (owner) await syncRow(scenarioKey(owner.id, scenarioId))
  }

  /* 소유 계정을 아는 쪽이 부르는 콘텐츠 로드 — 새 프로필 생성이 기본(starter) 시나리오를
     복사하기 전에 쓴다. 구 팩 시나리오는 여러 계정이 같은 id를 공유하므로 findOwner 대신
     정확한 계정 행을 짚는다 */
  const ensureScenarioRowSynced = async (accountId, scenarioId) => {
    await bootDeferredRef.current.promise
    await syncRow(scenarioKey(accountId, scenarioId))
  }

  /* 스튜디오(빌더) 진입 전: 콘텐츠 + 버전 스냅샷 — 버전은 여기서만 로드한다 */
  const ensureStudioSynced = async (scenarioId) => {
    await bootDeferredRef.current.promise
    const owner = findOwner(scenarioId)
    if (!owner) return
    await Promise.all([
      syncRow(scenarioKey(owner.id, scenarioId)),
      syncRow(versionsKey(owner.id, scenarioId)),
    ])
  }

  /* 프로필 전환·목록 내보내기 전: 계정 하나의 셸+콘텐츠+쓰레드 (버전 제외).
     받을 행이 실제로 있을 때만 syncingAccountIds에 올린다 — 그 계정이 활성인 동안
     "동기화 중" 배지(remoteSync.hydrating)가 켜지고, 이미 다 받은 계정은 배지 없이 즉시 통과 */
  const accountContentKeys = (id) => [...serverIndexRef.current.keys()].filter((key) => {
    const parsed = parseAccountKey(key)
    return parsed && parsed.accountId === id && (parsed.kind === 'scenario' || parsed.kind === 'threads')
  })
  const ensureAccountSynced = async (id) => {
    await bootDeferredRef.current.promise
    const needsFetch = (key) => !localAuthorityRef.current
      && serverIndexRef.current.has(key)
      && !rowsRef.current.get(key)?.loaded
    if (![accountKey(id), ...accountContentKeys(id)].some(needsFetch)) return
    setSyncingAccountIds((prev) => new Set(prev).add(id))
    try {
      await syncRow(accountKey(id))
      await Promise.all(accountContentKeys(id).map(syncRow))
    } finally {
      setSyncingAccountIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const ensureActiveSynced = async () => {
    await bootDeferredRef.current.promise
    const { accounts, activeAccountId } = stateRef.current
    const account = accounts.find((candidate) => candidate.id === activeAccountId) || accounts[0]
    if (account) await ensureAccountSynced(account.id)
  }

  /* 전체 백업 전: 서버의 모든 행 (본문 먼저 — 콘텐츠 채택이 셸을 전제로 한다) */
  const ensureAllSynced = async () => {
    await bootDeferredRef.current.promise
    const all = [...serverIndexRef.current.keys()]
    await Promise.all(all.filter((key) => parseAccountKey(key)?.kind === 'slim').map(syncRow))
    await Promise.all(all.filter((key) => {
      const parsed = parseAccountKey(key)
      return parsed && parsed.kind !== 'slim'
    }).map(syncRow))
  }

  return {
    syncRow,
    ensureScenarioSynced,
    ensureScenarioRowSynced,
    ensureStudioSynced,
    ensureAccountSynced,
    ensureActiveSynced,
    ensureAllSynced,
  }
}
