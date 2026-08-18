import { useEffect, useRef, useState } from 'react'
import {
  createAccount,
  createDataBackup,
  loadAccounts,
  loadKeywords,
  loadStarters,
  loadViewerDevice,
  parseDataBackup,
  saveAccounts,
  saveKeywords,
  saveStarters,
  saveViewerDevice,
  uid,
} from '../lib/store.js'
import { installStarterCopy, starterSnapshot } from '../lib/scenarioOps.js'
import { isEmptyScenarioContent } from '../lib/accountRows.js'
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
  /* 기본 시나리오 라이브러리 — 워크스페이스 전역. entries = 목록 메타, contents = 스냅샷 캐시 */
  const [starters, setStarters] = useState(loadStarters)

  const active = accounts.find((account) => account.id === activeAccountId) || accounts[0]

  /* 최신 상태 스냅샷 — 타이머·비동기 코드는 렌더 클로저 대신 이 ref로 읽는다 */
  const stateRef = useRef(null)
  stateRef.current = { accounts, activeAccountId, keywords, viewerDevice, starters }

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
    stateRef, setAccounts, setActiveAccountId, setKeywords, setStarters, showToast,
  })

  /* ── 저장 (localStorage 자동 — 서버는 수동 저장·자동 트랜잭션 싱크로만) ── */
  useEffect(() => {
    saveAccounts(accounts, activeAccountId)
  }, [accounts, activeAccountId])

  useEffect(() => { saveStarters(starters) }, [starters])

  useEffect(() => {
    saveKeywords(keywords)
  }, [keywords])

  useEffect(() => { saveViewerDevice(viewerDevice) }, [viewerDevice])

  /* ── 프로필(계정) 관리 ── */
  const switchAccount = (id, options = {}) => {
    const account = accounts.find((candidate) => candidate.id === id)
    if (!account || id === activeAccountId) return
    setActiveAccountId(id)
    /* 홈 프로필 전환은 열린 체험·편집 상태를 닫지만, 운영 센터의 프로필 탭은
       같은 #ops/studio 화면 안에서 목록만 바꿔야 하므로 현재 화면을 유지한다. */
    if (!options.keepRoute) onReset()
    /* 전환은 쓰기 트랜잭션이 아니다 — 계정 데이터가 안 바뀌므로 자동 싱크하지 않는다.
       대신 그 계정의 콘텐츠·쓰레드를 백그라운드로 서버와 맞춘다 */
    sync.ensureAccountSynced(id).catch(() => {})
    showToast(`"${account.profile.name}" 프로필로 전환했어요.`)
  }

  /* ── 기본 시나리오 라이브러리 ──
     지정 = 지정 시점 스냅샷을 라이브러리에 복사(원본과 동기화 없음 — 이후 원본 편집은
     반영되지 않고, 다시 지정하면 항목을 교체한다). 원본 소멸과 무관하게 목록이 유지된다 */
  const markStarterScenario = async (scenarioId) => {
    /* 프로필 전환 직후엔 활성 계정 콘텐츠가 로드 전일 수 있다 — 스냅샷이 빈 채 찍히지 않게 */
    await sync.ensureScenarioSynced(scenarioId).catch(() => {})
    const { accounts, activeAccountId, starters } = stateRef.current
    const account = accounts.find((candidate) => candidate.id === activeAccountId) || accounts[0]
    const scenario = account?.scenarios.find((candidate) => candidate.id === scenarioId)
    if (!scenario) return
    /* 콘텐츠가 빈 시나리오는 스냅샷을 뜨지 않는다 — 서버 콘텐츠 행이 유실·미로드된
       시나리오를 지정하면 빈 스냅샷이 라이브러리를 덮는 사고가 있었다 (2026-08-04) */
    if (isEmptyScenarioContent(scenario)) {
      showToast(`"${scenario.title}"의 내용이 비어 있어 기본 시나리오로 올리지 않았어요. 시나리오를 열어 내용을 확인한 뒤 다시 지정해주세요.`)
      return
    }
    const existing = starters.entries.find((entry) =>
      entry.sourceAccountId === account.id && entry.sourceScenarioId === scenarioId)
    const id = existing ? existing.id : uid()
    const snapshot = starterSnapshot(scenario, id)
    const entry = {
      id,
      title: scenario.title,
      chip: scenario.chip,
      color: scenario.color,
      sourceAccountId: account.id,
      sourceAccountName: account.profile.name,
      sourceScenarioId: scenarioId,
      at: new Date().toISOString(),
    }
    const entries = existing
      ? starters.entries.map((current) => (current.id === id ? entry : current))
      : [...starters.entries, entry]
    setStarters((prev) => ({ entries, contents: { ...prev.contents, [id]: snapshot } }))
    sync.starterSync.pushStarter(entry, snapshot, entries)
    showToast(existing
      ? `"${scenario.title}" 기본 시나리오를 지금 내용으로 교체했어요.`
      : `"${scenario.title}"을(를) 기본 시나리오에 올렸어요. 새 프로필을 만들 때 가져올 수 있어요.`)
  }

  const removeStarterEntry = (entryId) => {
    const { starters } = stateRef.current
    const entry = starters.entries.find((current) => current.id === entryId)
    if (!entry) return
    const entries = starters.entries.filter((current) => current.id !== entryId)
    setStarters((prev) => {
      const contents = { ...prev.contents }
      delete contents[entryId]
      return { entries, contents }
    })
    sync.starterSync.removeStarter(entryId, entries)
    showToast(`"${entry.title}"을(를) 기본 시나리오에서 내렸어요.`)
  }

  const addAccount = async (name) => {
    const label = String(name || '').trim() || `사용자 ${accounts.length + 1}`
    const account = createAccount()
    account.profile = { ...account.profile, name: label }
    account.explore = { ...account.explore, greeting: `${label}님, 오늘은 어떤 쇼핑을 도와드릴까요?` }
    /* 기본 시나리오 설치 — 확인을 받고, 스냅샷 본문이 로컬에 없으면 서버에서 받아 온다 */
    const entries = stateRef.current.starters.entries
    let missing = 0
    if (entries.length > 0
      && window.confirm(`"${label}" 프로필에 기본 시나리오 ${entries.length}개를 가져올까요?\n(취소하면 빈 프로필로 시작해요)`)) {
      const contents = await sync.starterSync.ensureStarterContents(entries)
      account.scenarios = entries
        .map((entry) => contents[entry.id])
        .filter(Boolean)
        .map(installStarterCopy)
      missing = entries.length - account.scenarios.length
    }
    setAccounts((prev) => [...prev, account])
    setActiveAccountId(account.id)
    onReset()
    sync.requestAutoSync()
    showToast(account.scenarios.length > 0
      ? `"${label}" 프로필을 만들었어요. 기본 시나리오 ${account.scenarios.length}개를 가져왔어요.${missing > 0 ? ` (${missing}개는 서버에서 불러오지 못했어요)` : ''}`
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
    /* 기본 시나리오 라이브러리 — 드로어의 지정 버튼·전역 목록 섹션이 쓴다 */
    starterEntries: starters.entries,
    markStarterScenario,
    removeStarterEntry,
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
