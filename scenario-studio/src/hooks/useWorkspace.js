import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_KEYWORDS,
  createAccount,
  createDataBackup,
  loadAccounts,
  loadKeywords,
  loadViewerDevice,
  normalizeAccountsState,
  normalizeScenario,
  parseDataBackup,
  saveAccounts,
  saveKeywords,
  saveViewerDevice,
} from '../lib/store.js'
import {
  REMOTE_ENABLED,
  fetchRemoteBoot,
  fetchRemoteIndex,
  fetchRemoteKey,
  fetchRemoteState,
  saveRemoteStateNow,
} from '../lib/remote.js'
import {
  accountKey,
  assembleAccount,
  isContentBodyRow,
  isFatAccountRow,
  parseAccountKey,
  scenarioKey,
  splitAccount,
  threadsKey,
  versionsKey,
} from '../lib/accountRows.js'
import { installDateMakeupPack, installDateMakeupScenario, isDefaultScenario } from '../lib/dateMakeupPack.js'

/* 자동 트랜잭션 싱크의 디바운스 — 연속 요청(플레이 중 쓰레드 갱신, 칩 드래그)을 한 번으로 모은다 */
const AUTO_SYNC_DELAY_MS = 1200

/*
 * 워크스페이스 상태 — 계정(프로필+탐색+시나리오+쓰레드)과 공통 설정, 그리고 그 저장.
 *
 * 저장 경로가 두 개다: localStorage(항상 자동) + 서버(운영 프로필만).
 *
 * 서버 동기화는 "화면 필요 단위의 행"으로 나눠 진행한다 (행 분해는 lib/accountRows.js):
 *   · 부트(1왕복, ?boot) — 행 목록+메타+키워드+활성 계정 셸 본문. 홈 첫 페인트가 여기서 끝난다.
 *   · 홈 백그라운드 — 나머지 계정 셸 + 활성 계정의 시나리오 콘텐츠·쓰레드 (칩 클릭 체험 대비).
 *   · 필요 시점 로드 — 버전 스냅샷은 스튜디오(빌더) 진입 시(ensureStudioSynced), 다른 계정
 *     콘텐츠는 프로필 전환 시(ensureAccountSynced), 칩 클릭은 ensureScenarioSynced가 보장.
 * 하이드레이션 사이에 사용자가 손댄 데이터는 서버 값으로 덮지 않는다(미저장으로 남는다).
 * 쓰레드만 예외로 서버 목록과 id 합집합으로 병합한다 — 체험 기록은 추가형 로그라서.
 *
 * 업로드는 두 갈래다: 수동("서버에 저장" 버튼 — 빌더 연속 편집)과 자동 트랜잭션 싱크
 * (스튜디오 밖 단발 쓰기 — 프로필·시나리오 생성/삭제, 쓰레드 기록, 가져오기 등).
 * 전송은 행 단위 게이트를 지킨다: **이 세션에서 서버와 맞춘 행(loaded)과 서버에 없는 새 행만
 * 보낸다** — 아직 안 받은 행을 낡은 로컬로 덮는 사고를 구조적으로 막는다. 삭제도 명시적이다:
 * 이 세션에서 지운 계정(removedAccountsRef)과, 셸을 맞춘 계정의 사라진 시나리오 행만 지운다.
 * 예외: 시딩 가드로 로컬을 지킨 세션과 전체 복원 직후(localAuthorityRef)는 로컬이 곧 전체
 * 의도라 전 행을 보내고 서버에만 있는 행을 정리한다.
 *
 * 하이드레이션 가드 (빠지면 "다른 기기에서 열었더니 작업이 사라졌다"가 된다):
 *   · 부트 실패 시 이번 세션은 서버 저장을 막는다. 오래된 로컬로 서버를 덮지 않는다.
 *   · 빈 브라우저가 기본 데이터로 서버를 시드해 둔 경우, 사용자 데이터를 가진 로컬을 지킨다.
 * 업로드 가드: 저장 직전 행 목록(updatedAt)을 다시 받아 다른 창의 선행 변경을 확인받는다.
 *
 * 활성 프로필 id는 기기별 UI 상태라 동기화하지 않는다(accounts-meta는 순서만).
 * 구형(통짜 블롭 → 1차 통짜 행 → 2차 콘텐츠 본문)은 하이드레이션이 만나는 대로 새 행
 * 체계로 이관한다 (부속 행 먼저 → 본문 행 마지막이 이관 완료 표식, 끊겨도 재시도).
 */
export function useWorkspace({ showToast, onReset }) {
  const [init] = useState(() => installDateMakeupPack(loadAccounts()))
  const [accounts, setAccounts] = useState(init.accounts)
  const [activeAccountId, setActiveAccountId] = useState(init.activeId)
  const [keywords, setKeywords] = useState(loadKeywords)
  const [viewerDevice, setViewerDevice] = useState(loadViewerDevice)
  const [bootReady, setBootReady] = useState(false)   // 부트(셸 채택+충돌 기준선) 완료 — 업로드 허용 시점
  const [homeSynced, setHomeSynced] = useState(false) // 홈 필요분(전 계정 셸+활성 콘텐츠·쓰레드)까지 완료 — 배지 기준
  const [remoteFailed, setRemoteFailed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [autoSyncTick, setAutoSyncTick] = useState(0) // 자동 싱크 요청 카운터 — 아래 효과가 디바운스 후 업로드

  const active = accounts.find((account) => account.id === activeAccountId) || accounts[0]

  /* 최신 상태 스냅샷 — 타이머·비동기 채택 코드는 렌더 클로저 대신 이 ref로 읽는다 */
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

  /* ── 행 기준선: rowKey → { loaded, base } ──
     loaded=true: 이 세션에서 서버와 맞춘 행. base = 그 시점의 내용(참조 또는 셸 JSON).
     loaded=false: 아직 서버 값을 안 받은 행. base = 채택 시점의 로컬 대체 내용 — "그 사이
       손댔는가" 판정용. 이런 행은 전송하지 않는다(안 받은 서버 값을 덮지 않기 위해).
     행 종류별 base: 본문=셸 JSON 문자열 · scenario={stages,planCases} 참조 · versions=배열 참조
     · threads=배열 참조 */
  const rowsRef = useRef(new Map())
  const metaBaselineRef = useRef(null)     // 서버와 맞춘 계정 순서 JSON (null = 못 맞춤)
  const keywordsBaselineRef = useRef(null) // 서버와 맞춘 키워드 JSON (null = 못 맞춤)
  const serverIndexRef = useRef(new Map()) // 서버 행 목록(key → updatedAt) — 충돌 감지 + 행 존재 판정
  const localAuthorityRef = useRef(false)  // 시딩 가드로 로컬을 지킴/전체 복원 — 로컬이 전체 의도
  const removedAccountsRef = useRef(new Set()) // 이 세션에서 사용자가 지운 계정 id — 명시적 삭제 대상
  const initialByIdRef = useRef(new Map(init.accounts.map((account) => [account.id, account])))
  const adoptionRef = useRef(new Map())    // accountId → 마지막 채택 본문 객체 (untouched 판정)
  const legacyQueueRef = useRef(new Map()) // accountId → { account, fat } — 구형 본문 이관 대기열
  const shellJsonCacheRef = useRef(new WeakMap())
  const homeSyncedRef = useRef(false)
  homeSyncedRef.current = homeSynced

  /* 부트 완료 대기 — ensure*가 부트 전에 불리면 기다린다 (실패·local 프로필이면 즉시 통과) */
  const bootDeferredRef = useRef(null)
  if (!bootDeferredRef.current) {
    let resolve
    const promise = new Promise((r) => { resolve = r })
    bootDeferredRef.current = { promise, resolve }
  }

  const shellJson = (account) => {
    const cached = shellJsonCacheRef.current.get(account)
    if (cached) return cached
    const json = JSON.stringify(splitAccount(account).shellBody)
    shellJsonCacheRef.current.set(account, json)
    return json
  }

  const setRow = (key, entry) => {
    const existing = rowsRef.current.get(key)
    if (!existing || !existing.loaded || entry.loaded) rowsRef.current.set(key, entry)
  }

  /* ── 서버 행 채택 (행 종류별) ──
     공통 규칙: 기준선은 항상 서버 값으로 잡고(loaded), 메모리는 손대지 않은 경우에만 서버
     값으로 바꾼다 — 손댄 데이터는 미저장으로 남아 다음 업로드가 올린다. */

  const adoptKeywords = (remoteKeywords) => {
    if (!Array.isArray(remoteKeywords)) return
    const isDefaultDict = (list) => JSON.stringify(list) === JSON.stringify(DEFAULT_KEYWORDS)
    setKeywords((prev) => {
      const keepLocal = isDefaultDict(remoteKeywords) && !isDefaultDict(prev)
      keywordsBaselineRef.current = keepLocal ? null : JSON.stringify(remoteKeywords)
      return keepLocal ? prev : remoteKeywords
    })
  }

  /* 본문(셸) 행 채택 — 계정을 상태에 병합하고 행 기준선을 잡는다. 새 셸 형식이면 콘텐츠·버전·
     쓰레드는 같은 id의 로컬 값을 임시로 붙인다(해당 행이 로드될 때 서버 값으로 확정).
     구형 본문(콘텐츠 인라인)은 인라인 값이 곧 서버 콘텐츠라 그 행들도 로드된 것으로 처리하고
     새 행 체계로의 이관 대기열에 올린다 */
  const adoptBodyRow = (data) => {
    if (!data || typeof data !== 'object' || !data.id) return null
    const id = data.id
    const fat = isFatAccountRow(data)
    const legacy = fat || isContentBodyRow(data)
    const local = stateRef.current.accounts.find((account) => account.id === id)
      || initialByIdRef.current.get(id) || null
    const assembled = assembleAccount(data, { localAccount: local })
    const normalized = normalizeAccountsState({ accounts: [assembled], activeId: id })
    if (!normalized) return null
    const adopted = installDateMakeupPack(normalized).accounts[0]

    setAccounts((prev) => {
      const current = prev.find((account) => account.id === id)
      if (!current) return [...prev, adopted]
      const untouched = current === initialByIdRef.current.get(id) || current === adoptionRef.current.get(id)
      return untouched ? prev.map((account) => (account.id === id ? adopted : account)) : prev
    })
    adoptionRef.current.set(id, adopted)

    rowsRef.current.set(accountKey(id), { loaded: true, base: shellJson(adopted) })
    for (const scenario of adopted.scenarios || []) {
      setRow(scenarioKey(id, scenario.id), { loaded: legacy, base: { stages: scenario.stages, planCases: scenario.planCases } })
      setRow(versionsKey(id, scenario.id), { loaded: fat, base: scenario.versions })
    }
    setRow(threadsKey(id), { loaded: fat, base: adopted.threads })
    if (legacy) legacyQueueRef.current.set(id, { account: adopted, fat })
    return adopted
  }

  const adoptScenarioRow = (accountId, scenarioId, data) => {
    if (!data || typeof data !== 'object') return
    const key = scenarioKey(accountId, scenarioId)
    const account = stateRef.current.accounts.find((candidate) => candidate.id === accountId)
    const scenario = account?.scenarios.find((candidate) => candidate.id === scenarioId)
    if (!scenario) return // 셸에 없는 시나리오의 잔여 행 — 채택하지 않는다 (고아 정리가 지운다)
    const merged = normalizeScenario({ ...scenario, stages: data.stages, planCases: data.planCases })
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      let changed = false
      const scenarios = candidate.scenarios.map((current) => {
        if (current.id !== scenarioId) return current
        const untouched = !entry
          || (entry.base && entry.base.stages === current.stages && entry.base.planCases === current.planCases)
        if (!untouched) return current // 그 사이 손댐 — 메모리 유지, 기준선만 서버 값(미저장으로 남는다)
        changed = true
        return merged
      })
      return changed ? { ...candidate, scenarios } : candidate
    }))
    rowsRef.current.set(key, { loaded: true, base: { stages: merged.stages, planCases: merged.planCases } })
  }

  const adoptVersionsRow = (accountId, scenarioId, data) => {
    const server = Array.isArray(data) ? data : []
    const key = versionsKey(accountId, scenarioId)
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      let changed = false
      const scenarios = candidate.scenarios.map((current) => {
        if (current.id !== scenarioId) return current
        const untouched = !entry || entry.base === current.versions
        if (!untouched) return current
        changed = true
        return { ...current, versions: server }
      })
      return changed ? { ...candidate, scenarios } : candidate
    }))
    rowsRef.current.set(key, { loaded: true, base: server })
  }

  const adoptThreadsRow = (accountId, data) => {
    const server = Array.isArray(data) ? data : []
    const key = threadsKey(accountId)
    const entry = rowsRef.current.get(key)
    setAccounts((prev) => prev.map((candidate) => {
      if (candidate.id !== accountId) return candidate
      const untouched = !entry || entry.base === candidate.threads
      if (untouched) return { ...candidate, threads: server }
      /* 로드 전에 기록된 쓰레드 보존 — 서버 목록과 id 합집합 (로컬 신규가 앞) */
      const serverIds = new Set(server.map((thread) => thread && thread.id))
      const merged = [...candidate.threads.filter((thread) => thread && !serverIds.has(thread.id)), ...server]
      return { ...candidate, threads: merged.slice(0, 30) }
    }))
    rowsRef.current.set(key, { loaded: true, base: server })
  }

  /* ── 필요 시점 로드 ──
     행 하나를 서버에서 받아 채택한다. 이미 맞춘 행·서버에 없는 행·로컬 권위 세션은 즉시 통과,
     중복 요청은 같은 Promise를 공유한다 */
  const inFlightRef = useRef(new Map())
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

  const findOwner = (scenarioId) =>
    stateRef.current.accounts.find((account) => (account.scenarios || []).some((s) => s.id === scenarioId))

  /* 칩 클릭(플레이) 전: 시나리오 콘텐츠를 서버와 맞춘다 */
  const ensureScenarioSynced = async (scenarioId) => {
    await bootDeferredRef.current.promise
    const owner = findOwner(scenarioId)
    if (owner) await syncRow(scenarioKey(owner.id, scenarioId))
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

  /* 프로필 전환·목록 내보내기 전: 계정 하나의 셸+콘텐츠+쓰레드 (버전 제외) */
  const ensureAccountSynced = async (id) => {
    await bootDeferredRef.current.promise
    await syncRow(accountKey(id))
    const keys = [...serverIndexRef.current.keys()].filter((key) => {
      const parsed = parseAccountKey(key)
      return parsed && parsed.accountId === id && (parsed.kind === 'scenario' || parsed.kind === 'threads')
    })
    await Promise.all(keys.map(syncRow))
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

  /* ── 미저장 변경 감지 (렌더마다 — 행 단위) ──
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
        : !serverIndexRef.current.has(scenarioKey(account.id, scenario.id))) return true
      const versionsEntry = rowsRef.current.get(versionsKey(account.id, scenario.id))
      if (versionsEntry ? versionsEntry.base !== scenario.versions
        : (!serverIndexRef.current.has(versionsKey(account.id, scenario.id)) && (scenario.versions || []).length > 0)) return true
    }
    return false
  }
  const changedAccountIds = accounts.filter(accountDirty).map((account) => account.id)
  const removedAccountIds = [...removedAccountsRef.current]
    .filter((id) => serverIndexRef.current.has(accountKey(id)))
  const keywordsDirty = keywordsBaselineRef.current !== JSON.stringify(keywords)
  const remoteDirty = changedAccountIds.length > 0 || removedAccountIds.length > 0 || keywordsDirty

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

  /* 구 통짜 블롭 경로 전용: 전체 데이터를 한 번에 채택하고 전 행을 로드 상태로 */
  const adoptFullAccounts = (adopted) => {
    setAccounts((prev) => {
      const serverIds = new Set(adopted.accounts.map((account) => account.id))
      const next = adopted.accounts.map((server) => {
        const current = prev.find((account) => account.id === server.id)
        if (!current) return server
        const untouched = current === initialByIdRef.current.get(server.id)
        return untouched ? server : current
      })
      for (const current of prev) {
        if (serverIds.has(current.id)) continue
        if (current !== initialByIdRef.current.get(current.id)) next.push(current)
      }
      return next
    })
    setActiveAccountId((prev) => {
      if (adopted.accounts.some((account) => account.id === prev)) return prev
      const current = stateRef.current.accounts.find((account) => account.id === prev)
      if (current && current !== initialByIdRef.current.get(prev)) return prev
      return adopted.activeId
    })
    for (const account of adopted.accounts) {
      adoptionRef.current.set(account.id, account)
      rowsRef.current.set(accountKey(account.id), { loaded: true, base: shellJson(account) })
      for (const scenario of account.scenarios || []) {
        rowsRef.current.set(scenarioKey(account.id, scenario.id), { loaded: true, base: { stages: scenario.stages, planCases: scenario.planCases } })
        rowsRef.current.set(versionsKey(account.id, scenario.id), { loaded: true, base: scenario.versions })
      }
      rowsRef.current.set(threadsKey(account.id), { loaded: true, base: account.threads })
    }
    metaBaselineRef.current = JSON.stringify(adopted.accounts.map((account) => account.id))
  }

  /* ── 서버 하이드레이션 (최초 1회 — 부트 1왕복 + 백그라운드) ── */
  useEffect(() => {
    if (!REMOTE_ENABLED) {
      bootDeferredRef.current.resolve()
      return undefined // local 프로필: localStorage만 사용
    }
    const hasUserData = (list) => list.length > 1 || list.some((account) =>
      (account.scenarios || []).some((scenario) => !isDefaultScenario(scenario))
      || (account.threads || []).length > 0
    )
    let cancelled = false

    async function hydrate() {
      const boot = await fetchRemoteBoot(init.activeId)
      if (cancelled) return
      const index = Array.isArray(boot.index) ? boot.index : []
      const keys = new Set(index.map((row) => row.key))
      const bootRows = boot.rows || {}
      const split = keys.has('accounts-meta')
      let wroteServer = false

      if (!split) {
        /* ── 구 통짜 블롭 경로 (최초 1회) — 전체 덤프 후 새 행 체계로 이관 ── */
        const state = await fetchRemoteState()
        if (cancelled) return
        adoptKeywords(state.keywords ? state.keywords.data : null)
        const blob = state.accounts ? state.accounts.data : null
        /* 활성 id는 서버 값을 쓰지 않는다(기기별 상태) — 로컬 활성이 목록에 없으면 첫 계정 */
        let remote = blob && normalizeAccountsState({ accounts: blob.accounts, activeId: init.activeId })
        if (remote && !hasUserData(remote.accounts) && hasUserData(init.accounts)) {
          remote = null
          localAuthorityRef.current = true // 시딩 가드 — 수동 저장이 전체 업로드로 해소
        }
        if (remote) {
          const adopted = installDateMakeupPack(remote)
          adoptFullAccounts(adopted)
          wroteServer = true
          try {
            await Promise.all(adopted.accounts.map((account) => migrateLegacyBody({ account, fat: true }, keys)))
            await saveRemoteStateNow('accounts-meta', { order: adopted.accounts.map((account) => account.id) })
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
              if (cancelled) return
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
              if (current && current !== initialByIdRef.current.get(prev)) return prev // 하이드레이션 중 만든 계정
              return bootAccount.id
            })
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
          if (cancelled) return
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
      if (cancelled) return

      /* 충돌 감지 기준선 — 하이드레이션 중 서버에 썼을 때만 다시 받는다 (왕복 절약) */
      if (wroteServer) {
        const freshIndex = await fetchRemoteIndex()
        if (cancelled) return
        serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
      }
      setBootReady(true)
      bootDeferredRef.current.resolve()
      setHomeSynced(true)
      /* 로드 중에 쌓인 미저장(쓰레드 기록 등)이 있으면 바로 반영 — 채택 setState가 커밋된
         다음 판정한다 (바로 읽으면 지난 렌더의 상태와 새 기준선이 어긋나 헛트리거된다) */
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled) return
      if (stateRef.current.accounts.some(accountDirty)) requestAutoSync()
    }

    hydrate().catch((error) => {
      if (!cancelled) {
        setRemoteFailed(true)
        bootDeferredRef.current.resolve()
        console.warn('[remote] 서버 상태 불러오기 실패 — 이번 세션은 서버 저장이 막혀요 (로컬 저장은 계속):', error)
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── 서버 업로드 ── */
  const busyRef = useRef(false)         // 수동·자동 공용 전송 중 가드
  const autoQueuedRef = useRef(false)   // 전송 중·부트 전에 들어온 자동 싱크 요청
  const conflictHoldRef = useRef(false) // 자동 싱크가 충돌을 만나 멈춘 상태 — 수동 저장 성공이 해제
  const failNotifiedRef = useRef(false) // 자동 싱크 실패 토스트는 다음 성공 전까지 한 번만

  /* 업로드 코어 — 수동/자동이 공유하고 충돌 처리만 다르다: 수동은 confirm으로 덮어쓰기를
     확인받고, 자동은 덮지 않고 멈춘다(미저장으로 남아 수동 저장이 해소). null = 전송 안 함 */
  const pushCore = async (auto) => {
    const { accounts, keywords } = stateRef.current
    /* 충돌 확인: 하이드레이션 이후 다른 창/기기가 서버를 먼저 바꿨는가 */
    const index = await fetchRemoteIndex()
    const now = new Map(index.map((row) => [row.key, row.updatedAt]))
    const baseline = serverIndexRef.current
    const conflicted = [...new Set([...now.keys(), ...baseline.keys()])]
      .some((key) => now.get(key) !== baseline.get(key))
    if (conflicted) {
      if (auto) {
        conflictHoldRef.current = true
        showToast('다른 창이나 기기에서 서버가 먼저 바뀌어 자동 저장을 멈췄어요. "서버에 저장" 버튼으로 확인 후 저장해주세요.')
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
          if (dirty || !serverKeys.has(contentKey)) {
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

  /* 전송이 끝난 뒤 대기 중 자동 싱크 요청이 있으면 이어서 처리 */
  const flushQueuedAutoSync = () => {
    if (autoQueuedRef.current) {
      autoQueuedRef.current = false
      setAutoSyncTick((n) => n + 1)
    }
  }

  /* ── 서버에 저장 (수동 업로드) ── */
  const pushToServer = async () => {
    if (!REMOTE_ENABLED || busyRef.current) return
    if (!bootReady) {
      showToast(remoteFailed
        ? '서버 상태를 불러오지 못해 저장할 수 없어요. 새로고침 후 다시 시도해주세요.'
        : '서버 상태를 불러오는 중이에요. 잠시 후 다시 시도해주세요.')
      return
    }
    busyRef.current = true
    setPushBusy(true)
    try {
      const result = await pushCore(false)
      if (result) {
        const parts = []
        if (result.changed > 0) parts.push(`계정 ${result.changed}개`)
        if (result.removed > 0) parts.push(`삭제 ${result.removed}개`)
        if (result.keywordsPushed) parts.push('키워드')
        showToast(`서버에 저장했어요.${parts.length > 0 ? ` (${parts.join(' · ')})` : ''}`)
      }
    } catch (error) {
      console.warn('[remote] 서버 저장 실패:', error)
      showToast('서버 저장에 실패했어요. 네트워크를 확인하고 다시 시도해주세요.')
    } finally {
      busyRef.current = false
      setPushBusy(false)
      flushQueuedAutoSync()
    }
  }

  /* ── 자동 싱크 (스튜디오 밖 트랜잭션 즉시 업로드) ──
     프로필·시나리오 생성/삭제, 쓰레드 기록, 가져오기 같은 단발 트랜잭션이 requestAutoSync()를
     부른다. 짧은 디바운스로 연속 요청을 한 번으로 모으고, 성공은 조용히(버튼 상태만 갱신),
     실패·충돌은 토스트로 알린다. 빌더의 연속 편집은 이 경로를 타지 않는다 — 수동 저장이 담당 */
  const requestAutoSync = () => {
    if (REMOTE_ENABLED) setAutoSyncTick((n) => n + 1)
  }

  const runAutoPush = async () => {
    if (busyRef.current) {
      autoQueuedRef.current = true // 진행 중 전송이 끝나면 flushQueuedAutoSync가 이어받는다
      return
    }
    if (conflictHoldRef.current) return // 충돌 해소(수동 저장) 전까지 자동 저장은 쉰다
    busyRef.current = true
    setPushBusy(true)
    try {
      await pushCore(true)
    } catch (error) {
      console.warn('[remote] 자동 서버 저장 실패 — 변경은 미저장으로 남아 있어요:', error)
      if (!failNotifiedRef.current) {
        failNotifiedRef.current = true
        showToast('서버 자동 저장에 실패했어요. 변경 내용은 "서버에 저장" 버튼으로 다시 올릴 수 있어요.')
      }
    } finally {
      busyRef.current = false
      setPushBusy(false)
      flushQueuedAutoSync()
    }
  }

  useEffect(() => {
    if (autoSyncTick === 0 || !REMOTE_ENABLED) return undefined
    if (!bootReady) {
      autoQueuedRef.current = true // 부트가 끝나면(bootReady) 이 효과가 다시 돌아 이어서 올린다
      return undefined
    }
    autoQueuedRef.current = false // 이번 실행이 큐에 쌓인 요청까지 커버한다
    const timer = setTimeout(runAutoPush, AUTO_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncTick, bootReady])

  /* 미저장 변경이 있는 채로 탭을 닫으면 한 번 경고 — 자동 미러링이 없어진 자리의 최소 안전망 */
  const remoteDirtyRef = useRef(false)
  remoteDirtyRef.current = REMOTE_ENABLED && bootReady && remoteDirty
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
    ensureAccountSynced(id).catch(() => {})
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
    requestAutoSync()
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
    removedAccountsRef.current.add(id) // 명시적 삭제 — 서버의 이 계정 행 전부가 정리 대상
    requestAutoSync()
  }

  /* ── 전체 데이터 백업/복원 ── */
  /* 내보내기 전 서버의 모든 행을 마저 받는다 — 지연 로드 때문에 메모리가 부분일 수 있다 */
  const exportDataBackup = async () => {
    await ensureAllSynced()
    await new Promise((resolve) => setTimeout(resolve, 0)) // 채택 setState 커밋 대기
    const { accounts, activeAccountId, keywords, viewerDevice } = stateRef.current
    return createDataBackup({ accounts, activeAccountId, keywords, viewerDevice })
  }

  const importDataBackup = (payload) => {
    try {
      const restored = parseDataBackup(payload)
      const installed = installDateMakeupPack({ accounts: restored.accounts, activeId: restored.activeId })
      setAccounts(installed.accounts)
      setActiveAccountId(installed.activeId)
      setKeywords(restored.keywords)
      setViewerDevice(restored.viewerDevice)
      onReset()
      /* 전체 교체 — 이후 로컬이 전체 의도다: 전 행 전송 + 서버에만 있는 행 정리 */
      localAuthorityRef.current = true
      requestAutoSync()
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
    ensureScenarioSynced,
    ensureStudioSynced,
    ensureActiveSynced,
    getFreshActiveScenarios,
    /* 스튜디오 밖 단발 트랜잭션의 즉시 서버 싱크 요청 — App.jsx의 시나리오·쓰레드 CRUD가 부른다 */
    requestAutoSync,
    /* 서버 수동 저장 — 빌더 상단바 SyncButton과 홈 프로필 드롭다운 상태 행이 읽는 상태 한 벌 */
    remoteSync: {
      enabled: REMOTE_ENABLED,
      ready: bootReady,
      failed: remoteFailed,
      /* 홈 필요분(셸+활성 콘텐츠·쓰레드)을 불러오는 중 — 홈 프로필 컨트롤·SyncButton이 표시 */
      hydrating: REMOTE_ENABLED && !homeSynced && !remoteFailed,
      busy: pushBusy,
      dirty: remoteDirty,
      dirtyCount: changedAccountIds.length + removedAccountIds.length + (keywordsDirty ? 1 : 0),
      lastSyncAt,
      push: pushToServer,
    },
  }
}
