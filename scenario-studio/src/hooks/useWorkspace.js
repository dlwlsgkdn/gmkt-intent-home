import { useEffect, useState } from 'react'
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
import { REMOTE_ENABLED, fetchRemoteState, saveRemoteState } from '../lib/remote.js'
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

  /* ── 서버 하이드레이션 (최초 1회) ── */
  useEffect(() => {
    if (!REMOTE_ENABLED) return undefined // local 프로필: localStorage만 사용
    const hasUserData = (list) => list.length > 1 || list.some((account) =>
      (account.scenarios || []).some((scenario) => !isDefaultScenario(scenario))
      || (account.threads || []).length > 0
    )
    let cancelled = false
    fetchRemoteState()
      .then((state) => {
        if (cancelled) return
        let remote = state.accounts && normalizeAccountsState(state.accounts.data)
        // 시딩 가드: 서버가 기본 데이터뿐이고 로컬에 실제 작업이 있으면 로컬을 지킨다
        if (remote && !hasUserData(remote.accounts) && hasUserData(init.accounts)) remote = null
        if (remote) {
          const withPack = installDateMakeupPack(remote)
          setAccounts(withPack.accounts)
          setActiveAccountId((prev) => (
            withPack.accounts.some((account) => account.id === prev) ? prev : withPack.activeId
          ))
        }
        if (state.keywords && Array.isArray(state.keywords.data)) {
          const isDefaultDict = (list) => JSON.stringify(list) === JSON.stringify(DEFAULT_KEYWORDS)
          setKeywords((prev) => (
            isDefaultDict(state.keywords.data) && !isDefaultDict(prev) ? prev : state.keywords.data
          ))
        }
        setRemoteReady(true)
      })
      .catch((error) => {
        if (!cancelled) console.warn('[remote] 서버 상태 불러오기 실패 — 이번 세션은 로컬 저장만 사용:', error)
      })
    return () => { cancelled = true }
  }, [])

  /* ── 저장 ── */
  useEffect(() => {
    saveAccounts(accounts, activeAccountId)
    if (remoteReady) saveRemoteState('accounts', { accounts, activeId: activeAccountId })
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
