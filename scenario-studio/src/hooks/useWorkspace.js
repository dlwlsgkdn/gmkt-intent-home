import { useEffect, useRef, useState } from 'react'
import {
  createAccount,
  createDataBackup,
  isStarterScenario,
  loadAccounts,
  loadKeywords,
  loadViewerDevice,
  parseDataBackup,
  saveAccounts,
  saveKeywords,
  saveViewerDevice,
} from '../lib/store.js'
import { installStarterCopy } from '../lib/scenarioOps.js'
import { useRemoteSync } from './remote/useRemoteSync.js'

/*
 * 워크스페이스 상태 — 계정(프로필+탐색+시나리오+쓰레드)과 공통 설정, 그리고 그 저장.
 *
 * 저장 경로가 두 개다: localStorage(항상 자동 — 여기) + 서버(운영 프로필만 — 서버
 * 동기화의 흐름·가드·행 체계는 전부 hooks/remote/useRemoteSync.js와 그 하위 모듈에
 * 있다). 이 훅은 상태의 원본과 계정 관리·전체 백업을 갖고, 서버 쪽에는 상태 접근
 * 수단(stateRef·세터)만 내어 준다.
 */
export function useWorkspace({ showToast, onReset }) {
  const [init] = useState(loadAccounts)
  const [accounts, setAccounts] = useState(init.accounts)
  const [activeAccountId, setActiveAccountId] = useState(init.activeId)
  const [keywords, setKeywords] = useState(loadKeywords)
  const [viewerDevice, setViewerDevice] = useState(loadViewerDevice)

  const active = accounts.find((account) => account.id === activeAccountId) || accounts[0]

  /* 최신 상태 스냅샷 — 타이머·비동기 코드는 렌더 클로저 대신 이 ref로 읽는다 */
  const stateRef = useRef(null)
  stateRef.current = { accounts, activeAccountId, keywords, viewerDevice }

  /* 활성 계정의 일부 필드만 갱신 — 값 또는 함수 업데이터 모두 지원.
     업데이터가 같은 참조를 돌려주면 계정 객체도 그대로 둔다 — 참조가 곧
     "서버에 저장할 변경 있음" 신호라서, 무변경 쓰기가 미저장 배지를 켜면 안 된다 */
  const patchActive = (key, value) =>
    setAccounts((prev) => prev.map((account) => {
      if (account.id !== activeAccountId) return account
      const next = typeof value === 'function' ? value(account[key]) : value
      return next === account[key] ? account : { ...account, [key]: next }
    }))

  /* ── 서버 동기화 (하이드레이션·필요 시점 로드·업로드) ── */
  const sync = useRemoteSync({
    init, accounts, activeAccount: active, keywords,
    stateRef, setAccounts, setActiveAccountId, setKeywords, showToast,
  })

  /* ── 저장 (localStorage 자동 — 서버는 수동 저장·자동 트랜잭션 싱크로만) ── */
  useEffect(() => {
    saveAccounts(accounts, activeAccountId)
  }, [accounts, activeAccountId])

  useEffect(() => {
    saveKeywords(keywords)
  }, [keywords])

  useEffect(() => { saveViewerDevice(viewerDevice) }, [viewerDevice])

  /* ── 프로필(계정) 관리 ── */
  const switchAccount = (id) => {
    const account = accounts.find((candidate) => candidate.id === id)
    if (!account || id === activeAccountId) return
    setActiveAccountId(id)
    onReset()
    /* 전환은 쓰기 트랜잭션이 아니다 — 계정 데이터가 안 바뀌므로 자동 싱크하지 않는다.
       대신 그 계정의 콘텐츠·쓰레드를 백그라운드로 서버와 맞춘다 */
    sync.ensureAccountSynced(id).catch(() => {})
    showToast(`"${account.profile.name}" 프로필로 전환했어요.`)
  }

  /* 기본(starter) 표식이 있는 시나리오 수집 — 새 프로필 생성 시 복사 설치 대상.
     활성 계정 우선이고 같은 id는 한 번만 센다 (구 팩 시나리오는 여러 계정이 같은 id를 공유) */
  const collectStarterScenarios = () => {
    const { accounts, activeAccountId } = stateRef.current
    const active = accounts.find((account) => account.id === activeAccountId)
    const ordered = active ? [active, ...accounts.filter((account) => account !== active)] : accounts
    const seen = new Set()
    const found = []
    for (const account of ordered) {
      for (const scenario of account.scenarios || []) {
        if (!isStarterScenario(scenario) || seen.has(scenario.id)) continue
        seen.add(scenario.id)
        found.push({ accountId: account.id, scenarioId: scenario.id })
      }
    }
    return found
  }

  const addAccount = async (name) => {
    const label = String(name || '').trim() || `사용자 ${accounts.length + 1}`
    const account = createAccount()
    account.profile = { ...account.profile, name: label }
    account.explore = { ...account.explore, greeting: `${label}님, 오늘은 어떤 쇼핑을 도와드릴까요?` }
    /* 기본 시나리오 설치 — 콘텐츠(stages·planCases)가 지연 로드라 원본 행을 먼저 맞춘 뒤 복사한다 */
    const starters = collectStarterScenarios()
    if (starters.length > 0) {
      await Promise.allSettled(starters.map(({ accountId, scenarioId }) =>
        sync.ensureScenarioRowSynced(accountId, scenarioId)))
      await new Promise((resolve) => setTimeout(resolve, 0)) // 채택 setState 커밋 대기
      const { accounts: fresh } = stateRef.current
      account.scenarios = starters
        .map(({ accountId, scenarioId }) => fresh.find((candidate) => candidate.id === accountId)
          ?.scenarios.find((scenario) => scenario.id === scenarioId))
        .filter(Boolean)
        .map(installStarterCopy)
    }
    setAccounts((prev) => [...prev, account])
    setActiveAccountId(account.id)
    onReset()
    sync.requestAutoSync()
    showToast(account.scenarios.length > 0
      ? `"${label}" 프로필을 만들었어요. 기본 시나리오 ${account.scenarios.length}개를 설치했어요.`
      : `"${label}" 프로필을 만들었어요. 탐색 페이지와 시나리오가 새로 시작돼요.`)
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
    sync.markAccountRemoved(id) // 명시적 삭제 — 서버의 이 계정 행 전부가 정리 대상
    sync.requestAutoSync()
  }

  /* ── 전체 데이터 백업/복원 ── */
  /* 내보내기 전 서버의 모든 행을 마저 받는다 — 지연 로드 때문에 메모리가 부분일 수 있다 */
  const exportDataBackup = async () => {
    await sync.ensureAllSynced()
    await new Promise((resolve) => setTimeout(resolve, 0)) // 채택 setState 커밋 대기
    const { accounts, activeAccountId, keywords, viewerDevice } = stateRef.current
    return createDataBackup({ accounts, activeAccountId, keywords, viewerDevice })
  }

  const importDataBackup = (payload) => {
    try {
      const restored = parseDataBackup(payload)
      setAccounts(restored.accounts)
      setActiveAccountId(restored.activeId)
      setKeywords(restored.keywords)
      setViewerDevice(restored.viewerDevice)
      onReset()
      /* 전체 교체 — 이후 로컬이 전체 의도다: 전 행 전송 + 서버에만 있는 행 정리 */
      sync.claimLocalAuthority()
      sync.requestAutoSync()
      showToast(`전체 데이터를 복원했어요. (프로필 ${restored.accounts.length}개)`)
      return true
    } catch (error) {
      showToast(`전체 복원 실패: ${error.message || '백업 파일을 확인해주세요.'}`)
      return false
    }
  }

  /* 내보내기 직전 최신 시나리오 목록 — ensure 후 렌더 클로저가 낡을 수 있어 ref에서 읽는다 */
  const getFreshActiveScenarios = () => {
    const { accounts, activeAccountId } = stateRef.current
    const account = accounts.find((candidate) => candidate.id === activeAccountId) || accounts[0]
    return account ? account.scenarios : []
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
    /* 필요 시점 로드 — App.jsx가 플레이(칩 클릭)·빌더 진입·복제·내보내기 전에 부른다 */
    ensureScenarioSynced: sync.ensureScenarioSynced,
    ensureStudioSynced: sync.ensureStudioSynced,
    ensureActiveSynced: sync.ensureActiveSynced,
    getFreshActiveScenarios,
    /* 스튜디오 밖 단발 트랜잭션의 즉시 서버 싱크 요청 — App.jsx의 시나리오·쓰레드 CRUD가 부른다 */
    requestAutoSync: sync.requestAutoSync,
    /* 서버 수동 저장 — 빌더 상단바 SyncButton과 홈 프로필 드롭다운 상태 행이 읽는 상태 한 벌 */
    remoteSync: sync.remoteSync,
  }
}
