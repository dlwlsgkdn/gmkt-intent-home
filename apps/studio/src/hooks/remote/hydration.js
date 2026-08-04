import {
  fetchRemoteBoot,
  fetchRemoteIndex,
  fetchRemoteKey,
  fetchRemoteState,
  saveRemoteStateNow,
} from '../../lib/remote.js'
import {
  accountKey,
  parseAccountKey,
  scenarioKey,
  splitAccount,
  threadsKey,
  versionsKey,
  isFatAccountRow,
} from '../../lib/accountRows.js'
import { DEFAULT_PROFILE, isDefaultScenario, normalizeAccountsState } from '../../lib/store.js'

/*
 * 서버 하이드레이션 (접속 최초 1회) — 부트 1왕복 + 백그라운드.
 *   · 부트(?boot): 행 목록+메타+키워드+활성 계정 셸 → 홈 첫 페인트, bootReady(업로드 허용)
 *   · 백그라운드: 나머지 계정 셸 + 활성 계정 콘텐츠·쓰레드 → homeSynced("동기화 중" 배지 기준)
 * 구형(통짜 블롭 → 통짜 행 → 콘텐츠 본문)은 만나는 대로 새 행 체계로 이관한다
 * (부속 행 먼저 → 본문 행 마지막이 이관 완료 표식, 끊겨도 재시도).
 *
 * 하이드레이션 가드 (빠지면 "다른 기기에서 열었더니 작업이 사라졌다"가 된다):
 *   · 부트 실패 시 이번 세션은 서버 저장을 막는다 — 훅의 catch가 remoteFailed를 세운다.
 *   · 빈 브라우저가 기본 데이터로 서버를 시드해 둔 경우, 사용자 데이터를 가진 로컬을 지킨다.
 *   · 그 외에 계정 목록은 서버(DB)가 원천이다 — 접속 시점 로컬 캐시 계정 중 서버에 없는
 *     것은 정리하고 토스트로 알린다(이 세션에서 만든 계정은 제외). 다른 기기에서 지운
 *     프로필이 옛 캐시로 부활해 서버에 다시 업로드되는 것을 막는다.
 */

const accountHasWork = (account) =>
  (account.scenarios || []).some((scenario) => !isDefaultScenario(scenario))
  || (account.threads || []).length > 0
  /* 이름을 바꾼 프로필도 사용자 작업이다 — 새 프로필(사용자 지정 이름)이 시나리오 없이
     만들어졌어도 시드 기본 계정(기본 이름)과 구분해 지키고, 활성도 뺏지 않는다 */
  || (account.profile?.name && account.profile.name !== DEFAULT_PROFILE.name)
const hasUserData = (list) => list.length > 1 || list.some(accountHasWork)

/* ── 구형 → 새 행 체계 이관 ──
   순서가 안전장치: 부속 행 전부 → 본문(셸) 행 마지막(본문이 곧 이관 완료 표식).
   중간에 끊기면 본문이 구형인 채 남아 다음 접속이 다시 이 경로로 들어와 재시도한다.
   fat(1차 통짜)만 버전·쓰레드도 함께 쓴다 — 2차 본문은 그 행들이 이미 서버에 분리돼 있다 */
const migrateLegacyBody = async ({ account, fat }, serverKeys) => {
  const { shellBody, contentBySid, threads, versionsBySid } = splitAccount(account)
  const writes = Object.entries(contentBySid)
    .map(([sid, content]) => saveRemoteStateNow(scenarioKey(account.id, sid), content))
  if (fat) {
    writes.push(...Object.entries(versionsBySid)
      .map(([sid, list]) => saveRemoteStateNow(versionsKey(account.id, sid), list)))
    if (threads.length > 0) writes.push(saveRemoteStateNow(threadsKey(account.id), threads))
    else if (serverKeys.has(threadsKey(account.id))) writes.push(saveRemoteStateNow(threadsKey(account.id), null))
  }
  /* 반쯤 쓰다 만 이전 이관의 잔여 행 청소 */
  for (const key of serverKeys) {
    const parsed = parseAccountKey(key)
    if (!parsed || parsed.accountId !== account.id) continue
    if (parsed.kind === 'scenario' && !(parsed.scenarioId in contentBySid)) writes.push(saveRemoteStateNow(key, null))
    if (fat && parsed.kind === 'versions' && !(parsed.scenarioId in versionsBySid)) writes.push(saveRemoteStateNow(key, null))
  }
  await Promise.all(writes)
  await saveRemoteStateNow(accountKey(account.id), shellBody)
}

/* signal.cancelled: 효과 클린업이 세운다 — 언마운트 후 setState·서버 쓰기를 멈춘다 */
export async function runHydration({ ctx, adoption, starterSync, syncRow, accountDirty, requestAutoSync, signal }) {
  const {
    init, stateRef, setAccounts, setActiveAccountId,
    rowsRef, metaBaselineRef, serverIndexRef, localAuthorityRef,
    initialByIdRef, legacyQueueRef, bootDeferredRef,
    setBootReady, setHomeSynced, showToast,
  } = ctx
  const { adoptKeywords, adoptBodyRow, adoptFullAccounts } = adoption

  const boot = await fetchRemoteBoot(init.activeId)
  if (signal.cancelled) return
  const index = Array.isArray(boot.index) ? boot.index : []
  const keys = new Set(index.map((row) => row.key))
  const bootRows = boot.rows || {}
  const split = keys.has('accounts-meta')
  let wroteServer = false

  /* 기본 시나리오 목록 메타 — 부트에 실려 오는 가벼운 행. 스냅샷 본문은 여기서 받지
     않는다(새 프로필 생성 직전 ensureStarterContents의 몫) */
  starterSync.adoptStartersMeta(bootRows['starters-meta'] ? bootRows['starters-meta'].data : null)

  if (!split) {
    /* ── 구 통짜 블롭 경로 (최초 1회) — 전체 덤프 후 새 행 체계로 이관 ── */
    const state = await fetchRemoteState()
    if (signal.cancelled) return
    adoptKeywords(state.keywords ? state.keywords.data : null)
    const blob = state.accounts ? state.accounts.data : null
    /* 활성 id는 서버 값을 쓰지 않는다(기기별 상태) — 로컬 활성이 목록에 없으면 첫 계정 */
    let remote = blob && normalizeAccountsState({ accounts: blob.accounts, activeId: init.activeId })
    if (remote && !hasUserData(remote.accounts) && hasUserData(init.accounts)) {
      remote = null
      localAuthorityRef.current = true // 시딩 가드 — 수동 저장이 전체 업로드로 해소
    }
    if (remote) {
      adoptFullAccounts(remote)
      wroteServer = true
      try {
        await Promise.all(remote.accounts.map((account) => migrateLegacyBody({ account, fat: true }, keys)))
        await saveRemoteStateNow('accounts-meta', { order: remote.accounts.map((account) => account.id) })
        if (keys.has('accounts')) await saveRemoteStateNow('accounts', null)
      } catch (error) {
        console.warn('[remote] 행 체계 이관 실패 — 다음 접속에서 다시 시도해요:', error)
      }
    }
    serverIndexRef.current = new Map(index.map((row) => [row.key, row.updatedAt]))
  } else {
    adoptKeywords(bootRows.keywords ? bootRows.keywords.data : null)
    const slimIds = index
      .map((row) => parseAccountKey(row.key))
      .filter((parsed) => parsed && parsed.kind === 'slim')
      .map((parsed) => parsed.accountId)
    const bodyKey = Object.keys(bootRows).find((key) => parseAccountKey(key)?.kind === 'slim')
    const bodyData = bodyKey ? bootRows[bodyKey]?.data : null

    /* 시딩 가드: 서버가 기본 데이터뿐이고 로컬에 실제 작업이 있으면 로컬을 지킨다.
       서버 계정이 둘 이상이면 그 자체로 사용자 데이터라 판정 불필요. 셸만으로 기본
       시나리오 여부는 알 수 있고, 쓰레드 유무만 필요할 때 그 행을 한 번 더 받는다 */
    let keepLocal = false
    if (slimIds.length === 1 && bodyData && hasUserData(init.accounts)) {
      const shellsHaveWork = (bodyData.scenarios || []).some((shell) => shell && !isDefaultScenario(shell))
      if (!shellsHaveWork) {
        let serverThreads = isFatAccountRow(bodyData) ? bodyData.threads : undefined
        if (serverThreads === undefined && keys.has(threadsKey(slimIds[0]))) {
          const row = await fetchRemoteKey(threadsKey(slimIds[0]))
          if (signal.cancelled) return
          serverThreads = row ? row.data : undefined
        }
        keepLocal = !(Array.isArray(serverThreads) && serverThreads.length > 0)
      }
    }

    serverIndexRef.current = new Map(index.map((row) => [row.key, row.updatedAt]))
    /* 순서 기준선은 부트의 메타로 — 안 잡으면 세션 첫 저장마다 meta를 무조건 다시 쓴다 */
    const metaOrder = bootRows['accounts-meta']?.data?.order
    if (Array.isArray(metaOrder)) metaBaselineRef.current = JSON.stringify(metaOrder)
    let bootAccount = null
    if (keepLocal) {
      localAuthorityRef.current = true
    } else if (bodyData) {
      /* 부트 계정 셸 즉시 채택 — 홈 첫 페인트 */
      bootAccount = adoptBodyRow(bodyData)
      if (bootAccount) {
        setActiveAccountId((prev) => {
          if (slimIds.includes(prev)) return prev
          const current = stateRef.current.accounts.find((account) => account.id === prev)
          /* 아래 정리 필터와 같은 기준 — 이 세션에서 만든 계정만 활성을 지킨다.
             서버에 없는 캐시 계정은 곧 정리되므로 활성도 부트 계정으로 옮긴다 */
          if (current && current !== initialByIdRef.current.get(prev)) return prev
          return bootAccount.id
        })
        /* 계정 목록은 서버가 원천 — 접속 시점 로컬 캐시 계정 중 서버에 없는 것은 정리한다
           (이 세션에서 만든 계정은 참조가 다르므로 남는다). 빈 브라우저의 시드 기본 계정
           중복 업로드와, 다른 기기에서 지운 프로필이 옛 캐시로 부활하는 것 둘 다 막는다.
           정리는 조용히 하지 않는다 — 뭘 지웠는지 토스트로 알린다 */
        const dropped = stateRef.current.accounts.filter((account) =>
          !slimIds.includes(account.id) && account === initialByIdRef.current.get(account.id))
        setAccounts((prev) => {
          const next = prev.filter((account) => slimIds.includes(account.id)
            || account !== initialByIdRef.current.get(account.id))
          return next.length === prev.length || next.length === 0 ? prev : next
        })
        if (dropped.length > 0 && dropped.length < stateRef.current.accounts.length) {
          const names = dropped.map((account) => `"${account.profile?.name || '이름 없음'}"`)
          const label = names.length <= 2 ? names.join('·') : `${names.slice(0, 2).join('·')} 외 ${names.length - 2}개`
          showToast(`서버에 없는 로컬 프로필 ${label}을(를) 정리했어요. (서버 기준 동기화)`)
        }
      }
    }
    setBootReady(true)
    bootDeferredRef.current.resolve()

    if (!keepLocal) {
      /* ── 백그라운드: 나머지 계정 셸 + 활성 계정 콘텐츠(시나리오·쓰레드) ──
         버전 스냅샷은 여기서도 받지 않는다 — 스튜디오 진입(ensureStudioSynced)의 몫 */
      const tasks = []
      for (const id of slimIds) {
        if (!bootAccount || id !== bootAccount.id) tasks.push(syncRow(accountKey(id)))
      }
      if (bootAccount) {
        for (const key of keys) {
          const parsed = parseAccountKey(key)
          if (parsed && parsed.accountId === bootAccount.id
            && (parsed.kind === 'scenario' || parsed.kind === 'threads')) tasks.push(syncRow(key))
        }
      }
      await Promise.allSettled(tasks)
      if (signal.cancelled) return
      if (legacyQueueRef.current.size > 0) {
        /* 구형 본문 → 새 행 체계 이관 */
        wroteServer = true
        const queue = [...legacyQueueRef.current.values()]
        legacyQueueRef.current.clear()
        try {
          await Promise.all(queue.map((job) => migrateLegacyBody(job, keys)))
        } catch (error) {
          console.warn('[remote] 행 체계 이관 실패 — 다음 접속에서 다시 시도해요:', error)
        }
      }
    }
  }
  if (signal.cancelled) return

  /* 충돌 감지 기준선 — 하이드레이션 중 서버에 썼을 때만 다시 받는다 (왕복 절약) */
  if (wroteServer) {
    const freshIndex = await fetchRemoteIndex()
    if (signal.cancelled) return
    serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
  }
  setBootReady(true)
  bootDeferredRef.current.resolve()
  setHomeSynced(true)
  /* 로드 중에 쌓인 미저장(쓰레드 기록 등)이 있으면 바로 반영 — 채택 setState가 커밋된
     다음 판정한다 (바로 읽으면 지난 렌더의 상태와 새 기준선이 어긋나 헛트리거된다) */
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (signal.cancelled) return
  if (stateRef.current.accounts.some(accountDirty)) requestAutoSync()
}
