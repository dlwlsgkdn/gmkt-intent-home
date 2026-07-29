import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_KEYWORDS,
  createAccount,
  createDataBackup,
  loadAccounts,
  loadKeywords,
  loadViewerDevice,
  normalizeAccountsState,
  parseDataBackup,
  saveAccounts,
  saveKeywords,
  saveViewerDevice,
} from '../lib/store.js'
import {
  REMOTE_ENABLED,
  fetchRemoteIndex,
  fetchRemoteKey,
  fetchRemoteState,
  saveRemoteState,
  saveRemoteStateNow,
} from '../lib/remote.js'
import { installDateMakeupPack, installDateMakeupScenario, isDefaultScenario } from '../lib/dateMakeupPack.js'

/*
 * 워크스페이스 상태 — 계정(프로필+탐색+시나리오+쓰레드)과 공통 설정, 그리고 그 저장.
 *
 * 저장 경로가 두 개라 까다롭다: localStorage(항상) + 서버 미러링(운영 프로필만).
 * 서버를 쓸 때 지켜야 할 것들:
 *   · 가져오기에 실패하면 이번 세션은 미러링을 끈다. 오래된 로컬로 서버를 덮지 않는다.
 *   · 빈 브라우저가 먼저 접속해 기본 데이터로 서버를 시드해 둔 경우, 사용자 데이터를 가진
 *     로컬이 그 기본값에 덮이지 않게 로컬을 유지한다(그리고 그 로컬이 서버로 올라간다).
 * 이 두 가드가 빠지면 "다른 기기에서 열었더니 작업이 사라졌다"가 된다.
 *
 * 미러링 단위는 계정 행이다: 'account:<id>' + 'accounts-meta'(순서·활성 id).
 * 통짜 'accounts' 블롭은 Vercel 함수 본문 한도(4.5MB)에 닿아 프로필 추가처럼
 * 페이로드가 커지는 저장이 조용히 거부됐다(413) — 바뀐 계정 행만 전송하면 한 번에
 * 실리는 크기가 계정 하나로 묶인다. 구 블롭은 하이드레이션에서 최초 1회 행으로
 * 마이그레이션하고 삭제한다(행 → 메타 → 블롭 삭제 순서라 중간에 끊겨도 재시도된다).
 */
export function useWorkspace({ showToast, onReset }) {
  const [init] = useState(() => installDateMakeupPack(loadAccounts()))
  const [accounts, setAccounts] = useState(init.accounts)
  const [activeAccountId, setActiveAccountId] = useState(init.activeId)
  const [keywords, setKeywords] = useState(loadKeywords)
  const [viewerDevice, setViewerDevice] = useState(loadViewerDevice)
  const [remoteReady, setRemoteReady] = useState(false)

  const active = accounts.find((account) => account.id === activeAccountId) || accounts[0]

  /* 활성 계정의 일부 필드만 갱신 — 값 또는 함수 업데이터 모두 지원 */
  const patchActive = (key, value) =>
    setAccounts((prev) => prev.map((account) => (
      account.id === activeAccountId
        ? { ...account, [key]: typeof value === 'function' ? value(account[key]) : value }
        : account
    )))

  /* 계정 행 미러링 기준선: id → 마지막으로 서버에 보낸 계정 객체 참조.
     patchActive가 바뀐 계정만 새 객체로 만들므로 참조 비교가 곧 변경 감지다.
     비어 있으면(서버 채택 안 함/마이그레이션 전) 다음 저장에서 전 계정이 올라간다 */
  const lastSyncedRef = useRef(new Map())

  /* ── 서버 하이드레이션 (최초 1회) ── */
  useEffect(() => {
    if (!REMOTE_ENABLED) return undefined // local 프로필: localStorage만 사용
    const hasUserData = (list) => list.length > 1 || list.some((account) =>
      (account.scenarios || []).some((scenario) => !isDefaultScenario(scenario))
      || (account.threads || []).length > 0
    )
    let cancelled = false

    async function hydrate() {
      const index = await fetchRemoteIndex()
      const keys = new Set(index.map((row) => row.key))
      const split = keys.has('accounts-meta') // 계정 행 형식으로 이미 이전됐는가

      let remoteAccounts = null
      let remoteKeywords = null
      if (split) {
        const accountKeys = [...keys].filter((key) => key.startsWith('account:'))
        const fetchKeys = ['accounts-meta', ...accountKeys, ...(keys.has('keywords') ? ['keywords'] : [])]
        const rows = await Promise.all(fetchKeys.map((key) => fetchRemoteKey(key)))
        const byKey = {}
        fetchKeys.forEach((key, i) => { byKey[key] = rows[i] })
        const meta = byKey['accounts-meta']?.data || {}
        const byId = {}
        accountKeys.forEach((key) => {
          const account = byKey[key]?.data
          if (account && account.id) byId[account.id] = account
        })
        // 메타 순서를 따르되, 메타에 없는 행도 뒤에 붙인다 (부분 실패가 계정을 잃지 않게)
        const order = Array.isArray(meta.order) ? meta.order.filter((id) => byId[id]) : []
        const rest = Object.keys(byId).filter((id) => !order.includes(id))
        const list = [...order, ...rest].map((id) => byId[id])
        if (list.length > 0) remoteAccounts = { accounts: list, activeId: meta.activeId }
        remoteKeywords = byKey.keywords?.data
      } else {
        const state = await fetchRemoteState()
        remoteAccounts = state.accounts ? state.accounts.data : null
        remoteKeywords = state.keywords ? state.keywords.data : null
      }
      if (cancelled) return

      let remote = remoteAccounts && normalizeAccountsState(remoteAccounts)
      // 시딩 가드: 서버가 기본 데이터뿐이고 로컬에 실제 작업이 있으면 로컬을 지킨다
      if (remote && !hasUserData(remote.accounts) && hasUserData(init.accounts)) remote = null
      let adopted = null
      if (remote) {
        adopted = installDateMakeupPack(remote)
        setAccounts(adopted.accounts)
        setActiveAccountId((prev) => (
          adopted.accounts.some((account) => account.id === prev) ? prev : adopted.activeId
        ))
      }
      if (Array.isArray(remoteKeywords)) {
        const isDefaultDict = (list) => JSON.stringify(list) === JSON.stringify(DEFAULT_KEYWORDS)
        setKeywords((prev) => (
          isDefaultDict(remoteKeywords) && !isDefaultDict(prev) ? prev : remoteKeywords
        ))
      }

      const finalAccounts = adopted ? adopted.accounts : init.accounts
      if (!split) {
        /* 구 통짜 블롭 → 계정 행 마이그레이션. 순서가 안전장치다: 행 전부 → 메타 → 블롭 삭제.
           중간에 끊기면 메타가 없어 다음 로드가 다시 이 경로로 들어와 재시도한다 */
        try {
          await Promise.all(finalAccounts.map((account) => saveRemoteStateNow(`account:${account.id}`, account)))
          await saveRemoteStateNow('accounts-meta', {
            order: finalAccounts.map((account) => account.id),
            activeId: adopted ? adopted.activeId : init.activeId,
          })
          if (keys.has('accounts')) await saveRemoteStateNow('accounts', null)
          lastSyncedRef.current = new Map(finalAccounts.map((account) => [account.id, account]))
        } catch (error) {
          console.warn('[remote] 계정 행 마이그레이션 실패 — 일반 미러링이 이어서 재시도해요:', error)
        }
      } else {
        // 서버 상태를 채택했을 때만 기준선을 잡는다 — 로컬을 지킨 경우엔 로컬 전체가 올라가야 한다
        if (adopted) lastSyncedRef.current = new Map(adopted.accounts.map((account) => [account.id, account]))
        // 구버전 클라이언트가 통짜 블롭을 되살려 놨으면 청소 (전체 덤프가 응답 한도를 넘지 않게)
        if (keys.has('accounts')) saveRemoteStateNow('accounts', null).catch(() => {})
      }
      if (!cancelled) setRemoteReady(true)
    }

    hydrate().catch((error) => {
      if (!cancelled) console.warn('[remote] 서버 상태 불러오기 실패 — 이번 세션은 로컬 저장만 사용:', error)
    })
    return () => { cancelled = true }
  }, [])

  /* ── 저장 ── */
  useEffect(() => {
    saveAccounts(accounts, activeAccountId)
    if (!remoteReady) return
    // 바뀐 계정 행만 미러링 — 참조가 다르면 바뀐 것이다 (patchActive/추가/가져오기 전부 새 객체)
    const alive = new Set()
    accounts.forEach((account) => {
      alive.add(account.id)
      if (lastSyncedRef.current.get(account.id) !== account) {
        saveRemoteState(`account:${account.id}`, account)
        lastSyncedRef.current.set(account.id, account)
      }
    })
    for (const id of [...lastSyncedRef.current.keys()]) {
      if (!alive.has(id)) {
        saveRemoteState(`account:${id}`, null) // 삭제된 계정은 행도 삭제
        lastSyncedRef.current.delete(id)
      }
    }
    saveRemoteState('accounts-meta', { order: accounts.map((account) => account.id), activeId: activeAccountId })
  }, [accounts, activeAccountId, remoteReady])

  useEffect(() => {
    saveKeywords(keywords)
    if (remoteReady) saveRemoteState('keywords', keywords)
  }, [keywords, remoteReady])

  useEffect(() => { saveViewerDevice(viewerDevice) }, [viewerDevice])

  /* ── 프로필(계정) 관리 ── */
  const switchAccount = (id) => {
    const account = accounts.find((candidate) => candidate.id === id)
    if (!account || id === activeAccountId) return
    setActiveAccountId(id)
    onReset()
    showToast(`"${account.profile.name}" 프로필로 전환했어요.`)
  }

  const addAccount = (name) => {
    const label = String(name || '').trim() || `사용자 ${accounts.length + 1}`
    let account = createAccount()
    account.profile = { ...account.profile, name: label }
    account.explore = { ...account.explore, greeting: `${label}님, 오늘은 어떤 쇼핑을 도와드릴까요?` }
    account = installDateMakeupScenario(account)
    setAccounts((prev) => [...prev, account])
    setActiveAccountId(account.id)
    onReset()
    showToast(`"${label}" 프로필을 만들었어요. 탐색 페이지와 시나리오가 새로 시작돼요.`)
  }

  const removeAccount = (id) => {
    if (accounts.length <= 1) {
      showToast('마지막 프로필은 삭제할 수 없어요.')
      return
    }
    const rest = accounts.filter((account) => account.id !== id)
    setAccounts(rest)
    if (id === activeAccountId) {
      setActiveAccountId(rest[0].id)
      onReset()
    }
  }

  /* ── 전체 데이터 백업/복원 ── */
  const exportDataBackup = () => createDataBackup({ accounts, activeAccountId, keywords, viewerDevice })

  const importDataBackup = (payload) => {
    try {
      const restored = parseDataBackup(payload)
      const installed = installDateMakeupPack({ accounts: restored.accounts, activeId: restored.activeId })
      setAccounts(installed.accounts)
      setActiveAccountId(installed.activeId)
      setKeywords(restored.keywords)
      setViewerDevice(restored.viewerDevice)
      onReset()
      showToast(`전체 데이터를 복원했어요. (프로필 ${restored.accounts.length}개)`)
      return true
    } catch (error) {
      showToast(`전체 복원 실패: ${error.message || '백업 파일을 확인해주세요.'}`)
      return false
    }
  }

  return {
    accounts,
    activeAccountId,
    active,
    scenarios: active.scenarios,
    explore: active.explore,
    profile: active.profile,
    threads: active.threads,
    setScenarios: (value) => patchActive('scenarios', value),
    setExplore: (value) => patchActive('explore', value),
    setProfile: (value) => patchActive('profile', value),
    setThreads: (value) => patchActive('threads', value),
    keywords,
    setKeywords,
    viewerDevice,
    setViewerDevice,
    switchAccount,
    addAccount,
    removeAccount,
    exportDataBackup,
    importDataBackup,
  }
}
