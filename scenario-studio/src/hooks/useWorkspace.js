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
  saveRemoteStateNow,
} from '../lib/remote.js'
import { installDateMakeupPack, installDateMakeupScenario, isDefaultScenario } from '../lib/dateMakeupPack.js'

/*
 * 워크스페이스 상태 — 계정(프로필+탐색+시나리오+쓰레드)과 공통 설정, 그리고 그 저장.
 *
 * 저장 경로가 두 개다: localStorage(항상 자동) + 서버(운영 프로필만, **수동 저장**).
 *
 * 서버 동기화는 "자동 다운로드 + 수동 업로드"다. 접속 시 서버 상태로 하이드레이션하고,
 * 업로드는 사용자가 "서버에 저장" 버튼(홈 드로어·빌더 상단바)을 누를 때만 일어난다.
 * 자동 미러링을 없앤 이유: 여러 창/사용자가 디바운스 타이밍에 서로를 덮었고,
 * 실패(413 등)가 console.warn으로만 남아 "저장된 줄 알았는데 아니었다"가 생겼다.
 * 수동 저장은 실패를 토스트로 그 자리에서 보여주고, 전송 시점을 사용자가 안다.
 *
 * 하이드레이션 가드 (빠지면 "다른 기기에서 열었더니 작업이 사라졌다"가 된다):
 *   · 가져오기에 실패하면 이번 세션은 서버 저장을 막는다. 오래된 로컬로 서버를 덮지 않는다.
 *   · 빈 브라우저가 먼저 접속해 기본 데이터로 서버를 시드해 둔 경우, 사용자 데이터를 가진
 *     로컬이 그 기본값에 덮이지 않게 로컬을 유지한다(미저장 상태로 표시되어 손으로 올린다).
 * 업로드 가드: 저장 직전 행 목록(updatedAt)을 다시 받아, 하이드레이션 이후 다른 창/기기가
 * 서버를 먼저 바꿨으면 덮어쓸지 확인받는다 — 낡은 창의 통째 역행을 막는 최소 장치.
 *
 * 저장 단위는 계정 행이다: 'account:<id>' + 'accounts-meta'(순서·활성 id) + 'keywords'.
 * 통짜 'accounts' 블롭은 Vercel 함수 본문 한도(4.5MB)에 닿아 프로필 추가처럼 페이로드가
 * 커지는 저장이 조용히 거부됐던(413) 구 형식 — 바뀐 계정 행만 보내면 크기가 계정 하나로
 * 묶인다. 구 블롭은 최초 1회 행으로 마이그레이션하고 삭제한다.
 */
export function useWorkspace({ showToast, onReset }) {
  const [init] = useState(() => installDateMakeupPack(loadAccounts()))
  const [accounts, setAccounts] = useState(init.accounts)
  const [activeAccountId, setActiveAccountId] = useState(init.activeId)
  const [keywords, setKeywords] = useState(loadKeywords)
  const [viewerDevice, setViewerDevice] = useState(loadViewerDevice)
  const [remoteReady, setRemoteReady] = useState(false)
  const [remoteFailed, setRemoteFailed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)

  const active = accounts.find((account) => account.id === activeAccountId) || accounts[0]

  /* 활성 계정의 일부 필드만 갱신 — 값 또는 함수 업데이터 모두 지원.
     업데이터가 같은 참조를 돌려주면 계정 객체도 그대로 둔다 — 계정 참조가 곧
     "서버에 저장할 변경 있음" 신호라서, 무변경 쓰기가 미저장 배지를 켜면 안 된다 */
  const patchActive = (key, value) =>
    setAccounts((prev) => prev.map((account) => {
      if (account.id !== activeAccountId) return account
      const next = typeof value === 'function' ? value(account[key]) : value
      return next === account[key] ? account : { ...account, [key]: next }
    }))

  /* 서버 기준선 — 미저장 변경 감지의 근거.
     lastSyncedRef: id → 마지막으로 서버와 맞춘 계정 객체 참조. patchActive가 바뀐 계정만
       새 객체로 만들므로 참조 비교가 곧 변경 감지다. 비어 있으면 전 계정이 미저장이다.
     keywordsBaselineRef: 서버와 맞춘 키워드의 JSON 문자열 (null = 서버와 못 맞춤).
     serverIndexRef: 하이드레이션/저장 시점의 서버 행 목록(key → updatedAt) —
       저장 직전 다시 받아 비교하면 "그 사이 다른 창이 먼저 썼는가"를 알 수 있다 */
  const lastSyncedRef = useRef(new Map())
  const keywordsBaselineRef = useRef(null)
  const serverIndexRef = useRef(new Map())

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
        setKeywords((prev) => {
          const keepLocal = isDefaultDict(remoteKeywords) && !isDefaultDict(prev)
          keywordsBaselineRef.current = keepLocal ? null : JSON.stringify(remoteKeywords)
          return keepLocal ? prev : remoteKeywords
        })
      }

      if (!split && adopted) {
        /* 구 통짜 블롭 → 계정 행 마이그레이션 — 서버가 가진 데이터의 형식 변환이라 자동으로
           해도 안전하다(사용자 데이터는 안 바뀐다). 순서가 안전장치: 행 전부 → 메타 → 블롭 삭제.
           중간에 끊기면 메타가 없어 다음 로드가 다시 이 경로로 들어와 재시도한다 */
        try {
          await Promise.all(adopted.accounts.map((account) => saveRemoteStateNow(`account:${account.id}`, account)))
          await saveRemoteStateNow('accounts-meta', {
            order: adopted.accounts.map((account) => account.id),
            activeId: adopted.activeId,
          })
          if (keys.has('accounts')) await saveRemoteStateNow('accounts', null)
          lastSyncedRef.current = new Map(adopted.accounts.map((account) => [account.id, account]))
        } catch (error) {
          console.warn('[remote] 계정 행 마이그레이션 실패 — 다음 서버 저장이 다시 시도해요:', error)
        }
      } else if (split && adopted) {
        // 서버 상태를 채택했을 때만 기준선을 잡는다 — 로컬을 지킨 경우엔 전부 미저장으로 남아야 한다
        lastSyncedRef.current = new Map(adopted.accounts.map((account) => [account.id, account]))
      }

      // 충돌 감지 기준선 — 마이그레이션 쓰기까지 반영된 최신 행 목록으로 잡는다
      const freshIndex = await fetchRemoteIndex()
      if (cancelled) return
      serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
      setRemoteReady(true)
    }

    hydrate().catch((error) => {
      if (!cancelled) {
        setRemoteFailed(true)
        console.warn('[remote] 서버 상태 불러오기 실패 — 이번 세션은 서버 저장이 막혀요 (로컬 저장은 계속):', error)
      }
    })
    return () => { cancelled = true }
  }, [])

  /* ── 미저장 변경 감지 (렌더마다 계산 — 기준선은 ref, 트리거는 상태 변경 자체) ── */
  const changedAccountIds = accounts
    .filter((account) => lastSyncedRef.current.get(account.id) !== account)
    .map((account) => account.id)
  const removedAccountIds = [...lastSyncedRef.current.keys()]
    .filter((id) => !accounts.some((account) => account.id === id))
  const keywordsDirty = keywordsBaselineRef.current !== JSON.stringify(keywords)
  const remoteDirty = changedAccountIds.length > 0 || removedAccountIds.length > 0 || keywordsDirty

  /* ── 서버에 저장 (수동 업로드) ── */
  const pushToServer = async () => {
    if (!REMOTE_ENABLED || pushBusy) return
    if (!remoteReady) {
      showToast(remoteFailed
        ? '서버 상태를 불러오지 못해 저장할 수 없어요. 새로고침 후 다시 시도해주세요.'
        : '서버 상태를 불러오는 중이에요. 잠시 후 다시 시도해주세요.')
      return
    }
    setPushBusy(true)
    try {
      /* 충돌 확인: 하이드레이션 이후 다른 창/기기가 서버를 먼저 바꿨는가 */
      const index = await fetchRemoteIndex()
      const now = new Map(index.map((row) => [row.key, row.updatedAt]))
      const baseline = serverIndexRef.current
      const conflicted = [...new Set([...now.keys(), ...baseline.keys()])]
        .some((key) => now.get(key) !== baseline.get(key))
      if (conflicted && !window.confirm(
        '다른 창이나 기기에서 서버가 먼저 바뀌었어요.\n'
        + '지금 이 화면의 내용으로 서버를 덮어쓸까요?\n\n'
        + '(취소하고 새로고침하면 서버 상태를 다시 불러와요)'
      )) return

      /* 바뀐 계정 행만 전송 + 서버에만 남은 계정 행 삭제 + 메타/키워드 */
      const changed = accounts.filter((account) => lastSyncedRef.current.get(account.id) !== account)
      await Promise.all(changed.map((account) => saveRemoteStateNow(`account:${account.id}`, account)))
      const localIds = new Set(accounts.map((account) => account.id))
      const orphanKeys = index
        .map((row) => row.key)
        .filter((key) => key.startsWith('account:') && !localIds.has(key.slice('account:'.length)))
      await Promise.all(orphanKeys.map((key) => saveRemoteStateNow(key, null)))
      await saveRemoteStateNow('accounts-meta', {
        order: accounts.map((account) => account.id),
        activeId: activeAccountId,
      })
      const keywordsJson = JSON.stringify(keywords)
      if (keywordsBaselineRef.current !== keywordsJson) await saveRemoteStateNow('keywords', keywords)
      if (now.has('accounts')) await saveRemoteStateNow('accounts', null) // 구 통짜 블롭 청소

      /* 기준선 갱신 — 방금 쓴 행들의 updatedAt을 다시 받아 다음 충돌 비교의 기준으로 */
      lastSyncedRef.current = new Map(accounts.map((account) => [account.id, account]))
      keywordsBaselineRef.current = keywordsJson
      const freshIndex = await fetchRemoteIndex()
      serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
      setLastSyncAt(new Date().toISOString())
      const parts = []
      if (changed.length > 0) parts.push(`계정 ${changed.length}개`)
      if (orphanKeys.length > 0) parts.push(`삭제 ${orphanKeys.length}개`)
      if (keywordsDirty) parts.push('키워드')
      showToast(`서버에 저장했어요.${parts.length > 0 ? ` (${parts.join(' · ')})` : ''}`)
    } catch (error) {
      console.warn('[remote] 서버 저장 실패:', error)
      showToast('서버 저장에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.')
    } finally {
      setPushBusy(false)
    }
  }

  /* 미저장 변경이 있는 채로 탭을 닫으면 한 번 경고 — 자동 미러링이 없어진 자리의 최소 안전망 */
  const remoteDirtyRef = useRef(false)
  remoteDirtyRef.current = REMOTE_ENABLED && remoteReady && remoteDirty
  useEffect(() => {
    if (!REMOTE_ENABLED) return undefined
    const warn = (event) => {
      if (!remoteDirtyRef.current) return
      event.preventDefault()
      event.returnValue = '' // 브라우저 기본 "변경사항이 저장되지 않을 수 있습니다" 다이얼로그
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  /* ── 저장 (localStorage 자동 — 서버는 pushToServer로만) ── */
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
    /* 서버 수동 저장 — 버튼(홈 드로어·빌더 상단바)이 읽는 상태 한 벌 */
    remoteSync: {
      enabled: REMOTE_ENABLED,
      ready: remoteReady,
      failed: remoteFailed,
      busy: pushBusy,
      dirty: remoteDirty,
      dirtyCount: changedAccountIds.length + removedAccountIds.length + (keywordsDirty ? 1 : 0),
      lastSyncAt,
      push: pushToServer,
    },
  }
}
