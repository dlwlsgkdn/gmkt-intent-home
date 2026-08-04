import { fetchRemoteIndex, saveRemoteStateNow } from '../../lib/remote.js'
import {
  accountKey,
  isEmptyScenarioContent,
  parseAccountKey,
  scenarioKey,
  splitAccount,
  threadsKey,
  versionsKey,
} from '../../lib/accountRows.js'

/*
 * 업로드 — 미저장 감지(accountDirty)와 전송 코어(pushCore).
 *
 * 전송은 행 단위 게이트를 지킨다: 이 세션에서 서버와 맞춘 행(loaded)과 서버에 없는 새 행만
 * 보낸다 — 아직 안 받은 행을 낡은 로컬로 덮는 사고를 구조적으로 막는다. 삭제도 명시적이다.
 * 예외는 시딩 가드·전체 복원 세션(localAuthorityRef — 로컬이 전체 의도라 전 행 전송+정리).
 */
export function createPushOps(ctx) {
  const {
    stateRef, showToast, shellJson, setLastSyncAt,
    rowsRef, metaBaselineRef, keywordsBaselineRef, serverIndexRef,
    localAuthorityRef, removedAccountsRef, homeSyncedRef,
    conflictHoldRef, failNotifiedRef,
  } = ctx

  /* ── 미저장 변경 감지 (행 단위) ──
     기준선 있는 행: 내용(참조/JSON) 비교. 기준선 없는 행: 서버에도 없으면 새 행(미저장),
     서버에 있으면 아직 안 받은 행 — 판정 불가라 조용히 둔다(전송도 안 하므로 안전) */
  const accountDirty = (account) => {
    const bodyEntry = rowsRef.current.get(accountKey(account.id))
    if (bodyEntry ? bodyEntry.base !== shellJson(account) : !serverIndexRef.current.has(accountKey(account.id))) return true
    const threadsEntry = rowsRef.current.get(threadsKey(account.id))
    if (threadsEntry ? threadsEntry.base !== account.threads
      : (!serverIndexRef.current.has(threadsKey(account.id)) && (account.threads || []).length > 0)) return true
    for (const scenario of account.scenarios || []) {
      const contentEntry = rowsRef.current.get(scenarioKey(account.id, scenario.id))
      if (contentEntry
        ? (contentEntry.base.stages !== scenario.stages || contentEntry.base.planCases !== scenario.planCases)
        : (!serverIndexRef.current.has(scenarioKey(account.id, scenario.id))
          && !isEmptyScenarioContent(scenario))) return true
      const versionsEntry = rowsRef.current.get(versionsKey(account.id, scenario.id))
      if (versionsEntry ? versionsEntry.base !== scenario.versions
        : (!serverIndexRef.current.has(versionsKey(account.id, scenario.id)) && (scenario.versions || []).length > 0)) return true
    }
    return false
  }

  /* 업로드 코어 — 수동/자동이 공유하고 충돌 처리만 다르다: 수동은 confirm으로 덮어쓰기를
     확인받고, 자동은 덮지 않고 멈춘다(미저장으로 남아 수동 저장이 해소). null = 전송 안 함 */
  const pushCore = async (auto) => {
    const { accounts, keywords } = stateRef.current
    /* 충돌 확인: 하이드레이션 이후 다른 창/기기가 서버를 먼저 바꿨는가.
       기본 시나리오 행(starter*)은 비교에서 뺀다 — 지정·해제가 기준선 기계 밖에서
       즉시 쓰는 last-write-wins 행이라, 계정 저장의 충돌로 잡히면 안 된다 */
    const isStarterRow = (key) => key === 'starters-meta' || key.startsWith('starter:')
    const index = await fetchRemoteIndex()
    const now = new Map(index.map((row) => [row.key, row.updatedAt]))
    const baseline = serverIndexRef.current
    const conflicted = [...new Set([...now.keys(), ...baseline.keys()])]
      .some((key) => !isStarterRow(key) && now.get(key) !== baseline.get(key))
    if (conflicted) {
      if (auto) {
        conflictHoldRef.current = true
        showToast('다른 창이나 기기에서 서버가 먼저 바뀌어 자동 저장을 멈췄어요. 새로고침으로 서버 상태를 확인하거나, 스튜디오의 "서버에 저장"으로 이 화면 내용을 올릴 수 있어요.')
        return null
      }
      if (!window.confirm(
        '다른 창이나 기기에서 서버가 먼저 바뀌었어요.\n'
        + '지금 이 화면의 내용으로 서버를 덮어쓸까요?\n\n'
        + '(취소하고 새로고침하면 서버 상태를 다시 불러와요)'
      )) return null
    }

    /* 행 단위 게이트: 이 세션에서 서버와 맞춘 행(loaded)·서버에 없는 새 행·로컬 권위 세션만
       전송한다 — 아직 안 받은 행을 낡은 로컬로 덮지 않는다 */
    const serverKeys = new Set(now.keys())
    const pushable = (key) => localAuthorityRef.current
      || rowsRef.current.get(key)?.loaded
      || !serverKeys.has(key)

    const writes = [] // [key, data, 기준선 갱신 콜백]
    const touchedAccounts = new Set()
    for (const account of accounts) {
      const before = writes.length
      const { shellBody, contentBySid, versionsBySid, threads } = splitAccount(account)
      const bodyKey = accountKey(account.id)
      if (pushable(bodyKey)) {
        const entry = rowsRef.current.get(bodyKey)
        const json = shellJson(account)
        if (!entry || entry.base !== json || !serverKeys.has(bodyKey)) {
          writes.push([bodyKey, shellBody, () => rowsRef.current.set(bodyKey, { loaded: true, base: json })])
        }
      }
      const threadKey = threadsKey(account.id)
      if (pushable(threadKey)) {
        const entry = rowsRef.current.get(threadKey)
        const dirty = entry ? entry.base !== account.threads : threads.length > 0
        if (dirty || (threads.length > 0 && !serverKeys.has(threadKey))) {
          const after = () => rowsRef.current.set(threadKey, { loaded: true, base: account.threads })
          if (threads.length > 0) writes.push([threadKey, threads, after])
          else if (serverKeys.has(threadKey)) writes.push([threadKey, null, after])
        }
      }
      for (const scenario of account.scenarios || []) {
        const contentKey = scenarioKey(account.id, scenario.id)
        if (pushable(contentKey)) {
          const entry = rowsRef.current.get(contentKey)
          const dirty = entry
            ? (entry.base.stages !== scenario.stages || entry.base.planCases !== scenario.planCases)
            : true
          /* 기준선 없는 새 행이 빈 스켈레톤이면 올리지 않는다 — 셸만 받은 시나리오
             (콘텐츠 행이 아직 서버에 안 올라온 것)를 빈 값으로 확정시키지 않게.
             내용이 생기면 그때 새 행으로 전송된다 */
          const emptyNewRow = !entry && !serverKeys.has(contentKey) && isEmptyScenarioContent(scenario)
          if (!emptyNewRow && (dirty || !serverKeys.has(contentKey))) {
            writes.push([contentKey, contentBySid[scenario.id], () =>
              rowsRef.current.set(contentKey, { loaded: true, base: { stages: scenario.stages, planCases: scenario.planCases } })])
          }
        }
        const versionKey = versionsKey(account.id, scenario.id)
        if (pushable(versionKey)) {
          const entry = rowsRef.current.get(versionKey)
          const has = (scenario.versions || []).length > 0
          const dirty = entry ? entry.base !== scenario.versions : has
          const after = () => rowsRef.current.set(versionKey, { loaded: true, base: scenario.versions })
          if (dirty && has) writes.push([versionKey, versionsBySid[scenario.id], after])
          else if (dirty && serverKeys.has(versionKey)) writes.push([versionKey, null, after])
          else if (!dirty && has && !serverKeys.has(versionKey)) writes.push([versionKey, versionsBySid[scenario.id], after])
        }
      }
      if (writes.length > before) touchedAccounts.add(account.id)
    }

    /* 삭제: 이 세션에서 지운 계정의 모든 행 + (셸을 맞춘 계정의) 사라진 시나리오 행.
       존재만 알고 아직 안 받은 계정의 행은 건드리지 않는다 — 다른 기기가 만든 계정 보호 */
    const localIds = new Set(accounts.map((account) => account.id))
    const deletes = [...serverKeys].filter((key) => {
      const parsed = parseAccountKey(key)
      if (!parsed) return false
      if (!localIds.has(parsed.accountId)) {
        return localAuthorityRef.current || removedAccountsRef.current.has(parsed.accountId)
      }
      if (parsed.kind === 'scenario' || parsed.kind === 'versions') {
        if (!localAuthorityRef.current && !rowsRef.current.get(accountKey(parsed.accountId))?.loaded) return false
        const account = accounts.find((candidate) => candidate.id === parsed.accountId)
        return !(account.scenarios || []).some((scenario) => scenario.id === parsed.scenarioId)
      }
      return false
    })
    const removedIds = new Set(deletes
      .map((key) => parseAccountKey(key).accountId)
      .filter((id) => !localIds.has(id)))

    /* 메타(순서)는 전 계정 셸을 맞춘 뒤에만 — 아직 안 받은 계정을 순서에서 빠뜨리지 않게.
       활성 프로필 id는 기기별 상태라 싣지 않는다 */
    const orderIds = accounts.map((account) => account.id)
    const orderJson = JSON.stringify(orderIds)
    const metaPushed = (homeSyncedRef.current || localAuthorityRef.current)
      && (metaBaselineRef.current !== orderJson || !serverKeys.has('accounts-meta'))
    const keywordsJson = JSON.stringify(keywords)
    const keywordsPushed = keywordsBaselineRef.current !== keywordsJson

    await Promise.all([
      ...writes.map(([key, data]) => saveRemoteStateNow(key, data)),
      ...deletes.map((key) => saveRemoteStateNow(key, null)),
    ])
    if (metaPushed) await saveRemoteStateNow('accounts-meta', { order: orderIds })
    if (keywordsPushed) await saveRemoteStateNow('keywords', keywords)
    if (now.has('accounts')) await saveRemoteStateNow('accounts', null) // 구 통짜 블롭 청소

    /* 기준선 갱신 — 방금 쓴 행들의 updatedAt을 다시 받아 다음 충돌 비교의 기준으로 */
    for (const [, , after] of writes) after()
    for (const key of deletes) rowsRef.current.delete(key)
    for (const id of removedIds) removedAccountsRef.current.delete(id)
    if (metaPushed) metaBaselineRef.current = orderJson
    keywordsBaselineRef.current = keywordsJson
    const freshIndex = await fetchRemoteIndex()
    serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
    setLastSyncAt(new Date().toISOString())
    conflictHoldRef.current = false
    failNotifiedRef.current = false
    return { changed: touchedAccounts.size, removed: removedIds.size, keywordsPushed }
  }

  return { accountDirty, pushCore }
}
