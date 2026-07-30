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
  fetchRemoteKeys,
  fetchRemoteState,
  saveRemoteStateNow,
} from '../lib/remote.js'
import {
  accountKey,
  accountSlimChanged,
  assembleAccount,
  isFatAccountRow,
  parseAccountKey,
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
 * 서버 동기화는 "자동 다운로드 + 두 갈래 업로드"다. 접속 시 서버 상태로 하이드레이션하고,
 * 업로드는 두 경로로 일어난다:
 *   · 수동 — "서버에 저장" 버튼(빌더 상단바 SyncButton, 홈은 프로필 드롭다운의 상태 행).
 *     빌더의 연속 편집이 대상.
 *   · 자동(트랜잭션 싱크) — 스튜디오 밖의 단발 쓰기 트랜잭션(프로필 생성·삭제, 시나리오
 *     생성·복제·가져오기·삭제·칩 순서, 쓰레드 기록·삭제, 전체 복원)은 requestAutoSync()로
 *     짧은 디바운스 뒤 바로 올린다. 프로필 전환은 쓰기가 아니라서 제외.
 * 예전의 "모든 변경 자동 미러링"은 여러 창이 디바운스 타이밍에 서로를 덮고 실패(413 등)가
 * console.warn으로만 남아 제거했다. 자동 트랜잭션 싱크는 그 함정을 피한다: 다른 창의
 * 선행 변경(충돌)을 만나면 덮지 않고 멈춰 수동 저장(확인 창)으로 넘기고, 실패는 토스트로
 * 그 자리에서 알린다.
 *
 * 하이드레이션은 활성 계정 우선 2단계다 (첫 접속 체감 속도의 핵심):
 *   · 1단계 — 메타·키워드·활성 계정 본문만 배치 한 번으로 받아 홈을 먼저 채운다.
 *   · 2단계 — 나머지 계정·쓰레드·버전 행을 백그라운드로 받고, 전부 모이면 기준선을 잡고
 *     remoteReady를 켠다. 업로드는 그 뒤에만 연다 — 부분 상태로 저장하면 고아 정리가
 *     아직 안 받은 행을 지운다. 하이드레이션 사이에 사용자가 손댄 계정은 서버 값으로
 *     덮지 않는다(미저장으로 남아 다음 업로드가 올린다).
 *
 * 하이드레이션 가드 (빠지면 "다른 기기에서 열었더니 작업이 사라졌다"가 된다):
 *   · 가져오기에 실패하면 이번 세션은 서버 저장을 막는다. 오래된 로컬로 서버를 덮지 않는다.
 *   · 빈 브라우저가 먼저 접속해 기본 데이터로 서버를 시드해 둔 경우, 사용자 데이터를 가진
 *     로컬이 그 기본값에 덮이지 않게 로컬을 유지한다(미저장 상태로 표시되어 손으로 올린다).
 * 업로드 가드: 저장 직전 행 목록(updatedAt)을 다시 받아, 하이드레이션 이후 다른 창/기기가
 * 서버를 먼저 바꿨으면 덮어쓸지 확인받는다 — 낡은 창의 통째 역행을 막는 최소 장치.
 *
 * 저장 단위는 계정을 쪼갠 행이다 (분해·조립은 lib/accountRows.js):
 * 'account:<id>'(본문) + 'account:<id>:threads' + 'account:<id>:versions:<sid>'(발행 버전
 * 스냅샷 — 페이로드 주범) + 'accounts-meta'(순서) + 'keywords'. 활성 프로필 id는 기기별
 * UI 상태라 동기화하지 않는다(로컬 저장만). 업로드는 참조 비교로 바뀐 행만 보낸다 —
 * 쓰레드 기록이 시나리오 본문을, 발행이 쓰레드를 다시 실어 나르지 않는다.
 * 통짜 'accounts' 블롭과 통짜 계정 행(버전·쓰레드 인라인)은 구 형식 — 하이드레이션이
 * 최초 1회 분리 행으로 이관한다(부속 행 먼저, 본문 행 마지막이 이관 완료 표식).
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
  const [autoSyncTick, setAutoSyncTick] = useState(0) // 자동 싱크 요청 카운터 — 아래 효과가 디바운스 후 업로드

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
     subBaselineRef: id → { threads(배열 참조), versions(시나리오 id → 스냅샷 배열 참조) } —
       계정이 바뀌었을 때 "어느 행이 바뀌었나"를 가르는 부속 행 기준선. 쓰레드 기록만으로
       무거운 본문 행을 다시 올리지 않기 위한 것.
     metaBaselineRef: 서버와 맞춘 계정 순서의 JSON 문자열 (null = 못 맞춤 → 다음 저장에 포함).
     keywordsBaselineRef: 서버와 맞춘 키워드의 JSON 문자열 (null = 서버와 못 맞춤).
     serverIndexRef: 하이드레이션/저장 시점의 서버 행 목록(key → updatedAt) —
       저장 직전 다시 받아 비교하면 "그 사이 다른 창이 먼저 썼는가"를 알 수 있다 */
  const lastSyncedRef = useRef(new Map())
  const subBaselineRef = useRef(new Map())
  const metaBaselineRef = useRef(null)
  const keywordsBaselineRef = useRef(null)
  const serverIndexRef = useRef(new Map())

  /* ── 서버 하이드레이션 (최초 1회 — 활성 계정 우선 2단계) ── */
  useEffect(() => {
    if (!REMOTE_ENABLED) return undefined // local 프로필: localStorage만 사용
    const hasUserData = (list) => list.length > 1 || list.some((account) =>
      (account.scenarios || []).some((scenario) => !isDefaultScenario(scenario))
      || (account.threads || []).length > 0
    )
    let cancelled = false

    /* 하이드레이션 시작 시점의 계정 스냅샷 — "그 사이 사용자가 손댔는가"의 판정 기준.
       손댄 계정(참조가 다름)은 서버 값으로 덮지 않는다 */
    const initialById = new Map(init.accounts.map((account) => [account.id, account]))

    const adoptKeywords = (remoteKeywords) => {
      if (!Array.isArray(remoteKeywords)) return
      const isDefaultDict = (list) => JSON.stringify(list) === JSON.stringify(DEFAULT_KEYWORDS)
      setKeywords((prev) => {
        const keepLocal = isDefaultDict(remoteKeywords) && !isDefaultDict(prev)
        keywordsBaselineRef.current = keepLocal ? null : JSON.stringify(remoteKeywords)
        return keepLocal ? prev : remoteKeywords
      })
    }

    /* 채택한 서버 계정들을 상태에 병합 — 손댄 계정은 유지하고(미저장으로 남는다),
       서버에 없는 손댄/새 계정도 지우지 않고 뒤에 붙인다 */
    const mergeAdopted = (adopted, phaseARef) => {
      setAccounts((prev) => {
        const serverIds = new Set(adopted.accounts.map((account) => account.id))
        const next = adopted.accounts.map((server) => {
          const current = prev.find((account) => account.id === server.id)
          if (!current) return server
          const untouched = current === initialById.get(server.id) || current === phaseARef
          return untouched ? server : current
        })
        for (const current of prev) {
          if (serverIds.has(current.id)) continue
          if (current !== initialById.get(current.id)) next.push(current)
        }
        return next
      })
      setActiveAccountId((prev) => {
        if (adopted.accounts.some((account) => account.id === prev)) return prev
        const current = stateRef.current?.accounts.find((account) => account.id === prev)
        if (current && current !== initialById.get(prev)) return prev // 하이드레이션 중 만든 계정이 활성
        return adopted.activeId
      })
    }

    /* 서버와 같은 상태가 된 시점의 기준선 — 계정 본문(참조)·부속 행(쓰레드/버전 참조)·순서 */
    const setBaselines = (adopted) => {
      lastSyncedRef.current = new Map(adopted.accounts.map((account) => [account.id, account]))
      subBaselineRef.current = new Map(adopted.accounts.map((account) => [account.id, {
        threads: account.threads,
        versions: new Map((account.scenarios || []).map((scenario) => [scenario.id, scenario.versions])),
      }]))
      metaBaselineRef.current = JSON.stringify(adopted.accounts.map((account) => account.id))
    }

    /* 통짜 계정(버전·쓰레드 인라인)을 분리 행으로 이관 — 서버가 가진 데이터의 형식 변환이라
       자동으로 해도 안전하다(사용자 데이터는 안 바뀐다). 순서가 안전장치: 부속 행 전부 →
       본문 행 마지막(본문이 곧 이관 완료 표식). 중간에 끊기면 본문이 통짜인 채 남아
       다음 접속이 다시 이 경로로 들어와 재시도한다 */
    const migrateAccountRows = async (account, serverKeys) => {
      const { slim, threads, versionsBySid } = splitAccount(account)
      /* 반쯤 쓰다 만 이전 이관의 잔여 부속 행 청소 — 지금 내용이 없는 sid·빈 쓰레드 */
      const staleVersionKeys = [...serverKeys].filter((key) => {
        const parsed = parseAccountKey(key)
        return parsed && parsed.kind === 'versions' && parsed.accountId === account.id
          && !(parsed.scenarioId in versionsBySid)
      })
      await Promise.all([
        ...Object.entries(versionsBySid).map(([sid, list]) => saveRemoteStateNow(versionsKey(account.id, sid), list)),
        ...staleVersionKeys.map((key) => saveRemoteStateNow(key, null)),
        threads.length > 0
          ? saveRemoteStateNow(threadsKey(account.id), threads)
          : serverKeys.has(threadsKey(account.id))
            ? saveRemoteStateNow(threadsKey(account.id), null)
            : Promise.resolve(),
      ])
      await saveRemoteStateNow(accountKey(account.id), slim)
    }

    async function hydrate() {
      const index = await fetchRemoteIndex()
      const keys = new Set(index.map((row) => row.key))
      const split = keys.has('accounts-meta') // 계정 행 형식으로 이미 이전됐는가

      let adopted = null      // 최종 채택한 서버 상태 — null이면 로컬 유지(전부 미저장)
      let wroteServer = false // 이번 하이드레이션에서 서버에 썼는가 → 충돌 기준선 index 재조회 필요

      if (!split) {
        /* ── 구 통짜 블롭 경로 (최초 1회) — 전체 덤프 후 분리 행으로 이관 ── */
        const state = await fetchRemoteState()
        if (cancelled) return
        const blob = state.accounts ? state.accounts.data : null
        adoptKeywords(state.keywords ? state.keywords.data : null)
        /* 활성 id는 서버 값을 쓰지 않는다(기기별 상태) — 로컬 활성이 목록에 없으면 첫 계정 */
        let remote = blob && normalizeAccountsState({ accounts: blob.accounts, activeId: init.activeId })
        // 시딩 가드: 서버가 기본 데이터뿐이고 로컬에 실제 작업이 있으면 로컬을 지킨다
        if (remote && !hasUserData(remote.accounts) && hasUserData(init.accounts)) remote = null
        if (remote) {
          adopted = installDateMakeupPack(remote)
          mergeAdopted(adopted, null)
          wroteServer = true
          try {
            await Promise.all(adopted.accounts.map((account) => migrateAccountRows(account, keys)))
            await saveRemoteStateNow('accounts-meta', { order: adopted.accounts.map((account) => account.id) })
            if (keys.has('accounts')) await saveRemoteStateNow('accounts', null)
          } catch (error) {
            console.warn('[remote] 계정 행 마이그레이션 실패 — 다음 서버 저장이 다시 시도해요:', error)
          }
        }
      } else {
        const slimIds = index
          .map((row) => parseAccountKey(row.key))
          .filter((parsed) => parsed && parsed.kind === 'slim')
          .map((parsed) => parsed.accountId)

        if (slimIds.length === 0) {
          if (keys.has('keywords')) {
            const row = await fetchRemoteKey('keywords')
            if (cancelled) return
            adoptKeywords(row && row.data)
          }
        } else {
          /* ── 1단계 (빠른 페인트): 메타·키워드·활성 후보 계정 본문만 배치 한 번 ── */
          let primaryId = slimIds.length === 1
            ? slimIds[0]
            : slimIds.includes(init.activeId) ? init.activeId : null
          const firstKeys = ['accounts-meta']
          if (keys.has('keywords')) firstKeys.push('keywords')
          if (primaryId) {
            firstKeys.push(accountKey(primaryId))
            /* 시딩 가드는 서버 계정이 하나일 때만 성립 — 판정에 그 계정 쓰레드도 필요하다 */
            if (slimIds.length === 1 && keys.has(threadsKey(primaryId))) firstKeys.push(threadsKey(primaryId))
          }
          const fetched = await fetchRemoteKeys(firstKeys)
          if (cancelled) return
          if (!primaryId) {
            /* 로컬 활성이 서버에 없는 새 기기 — 메타 순서의 첫 계정을 우선 대상으로 */
            const metaOrder = fetched['accounts-meta']?.data?.order
            primaryId = (Array.isArray(metaOrder) && metaOrder.find((id) => slimIds.includes(id))) || slimIds[0]
            Object.assign(fetched, await fetchRemoteKeys([accountKey(primaryId)]))
            if (cancelled) return
          }
          adoptKeywords(fetched.keywords ? fetched.keywords.data : null)

          /* 시딩 가드 — 서버 계정이 둘 이상이면 그 자체로 사용자 데이터라 판정 불필요 */
          const primaryData = fetched[accountKey(primaryId)]?.data
          let keepLocal = false
          if (slimIds.length === 1 && primaryData) {
            const serverThreads = isFatAccountRow(primaryData)
              ? primaryData.threads
              : fetched[threadsKey(primaryId)]?.data
            const probe = normalizeAccountsState({
              accounts: [assembleAccount(primaryData, serverThreads, {})],
              activeId: init.activeId,
            })
            keepLocal = !!probe && !hasUserData(probe.accounts) && hasUserData(init.accounts)
          }

          if (!keepLocal) {
            /* 1단계 채택: 활성 계정을 서버 본문으로 먼저 그린다. 쓰레드·버전 행은 아직이라
               같은 id의 로컬 값(없으면 빈 값)을 임시로 붙이고, 2단계가 서버 값으로 확정한다 */
            let phaseARef = null
            if (primaryData && primaryData.id) {
              const local = initialById.get(primaryId)
              const preview = isFatAccountRow(primaryData)
                ? primaryData
                : assembleAccount(primaryData, local?.threads, local ? splitAccount(local).versionsBySid : {})
              const normalized = normalizeAccountsState({ accounts: [preview], activeId: primaryId })
              if (normalized) {
                const adoptedPrimary = installDateMakeupPack(normalized).accounts[0]
                setAccounts((prev) => {
                  const current = prev.find((account) => account.id === adoptedPrimary.id)
                  if (!current) return [...prev, adoptedPrimary]
                  if (current !== initialById.get(adoptedPrimary.id)) return prev // 그 사이 손댐 — 덮지 않는다
                  return prev.map((account) => (account.id === adoptedPrimary.id ? adoptedPrimary : account))
                })
                setActiveAccountId((prev) => {
                  if (slimIds.includes(prev)) return prev
                  const current = stateRef.current?.accounts.find((account) => account.id === prev)
                  if (current && current !== initialById.get(prev)) return prev // 하이드레이션 중 만든 계정이 활성
                  return adoptedPrimary.id
                })
                phaseARef = adoptedPrimary
              }
            }

            /* ── 2단계 (백그라운드): 나머지 계정 본문·쓰레드·버전 행 전부 ── */
            const remaining = index
              .map((row) => row.key)
              .filter((key) => parseAccountKey(key) && !(key in fetched))
            const rows = await Promise.all(remaining.map((key) => fetchRemoteKey(key)))
            if (cancelled) return
            remaining.forEach((key, i) => { fetched[key] = rows[i] })

            /* 조립: 본문 + 부속 행 → 계정 전체. 통짜 행은 그대로 쓰고 이관 대상에 올린다 */
            const threadRows = new Map()
            const versionRows = new Map() // accountId → { sid: versions[] }
            for (const key of Object.keys(fetched)) {
              const parsed = parseAccountKey(key)
              if (!parsed || !fetched[key]) continue
              if (parsed.kind === 'threads') threadRows.set(parsed.accountId, fetched[key].data)
              if (parsed.kind === 'versions') {
                if (!versionRows.has(parsed.accountId)) versionRows.set(parsed.accountId, {})
                versionRows.get(parsed.accountId)[parsed.scenarioId] = fetched[key].data
              }
            }
            const byId = {}
            const fatIds = []
            for (const id of slimIds) {
              const data = fetched[accountKey(id)]?.data
              if (!data || !data.id) continue
              if (isFatAccountRow(data)) fatIds.push(id)
              byId[id] = isFatAccountRow(data)
                ? data
                : assembleAccount(data, threadRows.get(id), versionRows.get(id) || {})
            }
            // 메타 순서를 따르되, 메타에 없는 행도 뒤에 붙인다 (부분 실패가 계정을 잃지 않게)
            const meta = fetched['accounts-meta']?.data || {}
            const order = Array.isArray(meta.order) ? meta.order.filter((id) => byId[id]) : []
            const restIds = Object.keys(byId).filter((id) => !order.includes(id))
            const list = [...order, ...restIds].map((id) => byId[id])
            const remote = list.length > 0
              ? normalizeAccountsState({ accounts: list, activeId: init.activeId })
              : null
            if (remote) {
              adopted = installDateMakeupPack(remote)
              mergeAdopted(adopted, phaseARef)
              if (fatIds.length > 0) {
                /* 구 통짜 계정 행 → 분리 행 이관 */
                wroteServer = true
                try {
                  await Promise.all(adopted.accounts
                    .filter((account) => fatIds.includes(account.id))
                    .map((account) => migrateAccountRows(account, keys)))
                } catch (error) {
                  console.warn('[remote] 계정 행 분리 이관 실패 — 다음 접속에서 다시 시도해요:', error)
                }
              }
            }
          }
        }
      }
      if (cancelled) return

      // 서버 상태를 채택했을 때만 기준선을 잡는다 — 로컬을 지킨 경우엔 전부 미저장으로 남아야 한다
      if (adopted) setBaselines(adopted)

      /* 충돌 감지 기준선 — 하이드레이션 중 서버에 썼을 때만 다시 받는다 (왕복 1회 절약) */
      if (wroteServer) {
        const freshIndex = await fetchRemoteIndex()
        if (cancelled) return
        serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
      } else {
        serverIndexRef.current = new Map(index.map((row) => [row.key, row.updatedAt]))
      }
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

  /* ── 서버 업로드 ──
     최신 상태 스냅샷 — 자동 싱크는 setState 커밋 뒤 타이머에서 실행되므로 ref로 읽는다 */
  const stateRef = useRef(null)
  stateRef.current = { accounts, activeAccountId, keywords }

  const busyRef = useRef(false)         // 수동·자동 공용 전송 중 가드
  const autoQueuedRef = useRef(false)   // 전송 중·하이드레이션 전에 들어온 자동 싱크 요청
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

    /* 바뀐 계정의 바뀐 행만 전송 — 본문/쓰레드/버전을 부속 기준선(참조)으로 가른다.
       쓰레드 기록만으로 무거운 본문 행을, 발행만으로 쓰레드 행을 다시 올리지 않는다 */
    const serverKeys = new Set(now.keys())
    const changed = accounts.filter((account) => lastSyncedRef.current.get(account.id) !== account)
    const writes = []
    for (const account of changed) {
      const prevAccount = lastSyncedRef.current.get(account.id)
      const sub = subBaselineRef.current.get(account.id)
      const { slim, threads, versionsBySid } = splitAccount(account)
      if (!prevAccount || accountSlimChanged(account, prevAccount)) writes.push([accountKey(account.id), slim])
      if (!sub || sub.threads !== account.threads) {
        if (threads.length > 0) writes.push([threadsKey(account.id), threads])
        else if (serverKeys.has(threadsKey(account.id))) writes.push([threadsKey(account.id), null])
      }
      for (const scenario of account.scenarios || []) {
        if (sub && sub.versions.get(scenario.id) === scenario.versions) continue
        const key = versionsKey(account.id, scenario.id)
        if (scenario.id in versionsBySid) writes.push([key, versionsBySid[scenario.id]])
        else if (serverKeys.has(key)) writes.push([key, null])
      }
    }

    /* 고아 행 정리: 로컬에 없는 계정의 모든 행 + 삭제된 시나리오의 버전 행 */
    const localById = new Map(accounts.map((account) => [account.id, account]))
    const orphanKeys = index
      .map((row) => row.key)
      .filter((key) => {
        const parsed = parseAccountKey(key)
        if (!parsed) return false
        const owner = localById.get(parsed.accountId)
        if (!owner) return true
        if (parsed.kind === 'versions') {
          return !(owner.scenarios || []).some((scenario) => scenario.id === parsed.scenarioId)
        }
        return false
      })
    const removed = orphanKeys.filter((key) => parseAccountKey(key).kind === 'slim').length

    /* 메타는 순서가 바뀌었거나 행이 아예 없을 때만(마이그레이션 미완 안전망).
       활성 프로필 id는 기기별 상태라 서버에 싣지 않는다 */
    const orderIds = accounts.map((account) => account.id)
    const orderJson = JSON.stringify(orderIds)
    const metaPushed = metaBaselineRef.current !== orderJson || !serverKeys.has('accounts-meta')
    const keywordsJson = JSON.stringify(keywords)
    const keywordsPushed = keywordsBaselineRef.current !== keywordsJson

    await Promise.all([
      ...writes.map(([key, data]) => saveRemoteStateNow(key, data)),
      ...orphanKeys.map((key) => saveRemoteStateNow(key, null)),
    ])
    if (metaPushed) await saveRemoteStateNow('accounts-meta', { order: orderIds })
    if (keywordsPushed) await saveRemoteStateNow('keywords', keywords)
    if (now.has('accounts')) await saveRemoteStateNow('accounts', null) // 구 통짜 블롭 청소

    /* 기준선 갱신 — 방금 쓴 행들의 updatedAt을 다시 받아 다음 충돌 비교의 기준으로 */
    lastSyncedRef.current = new Map(accounts.map((account) => [account.id, account]))
    subBaselineRef.current = new Map(accounts.map((account) => [account.id, {
      threads: account.threads,
      versions: new Map((account.scenarios || []).map((scenario) => [scenario.id, scenario.versions])),
    }]))
    metaBaselineRef.current = orderJson
    keywordsBaselineRef.current = keywordsJson
    const freshIndex = await fetchRemoteIndex()
    serverIndexRef.current = new Map(freshIndex.map((row) => [row.key, row.updatedAt]))
    setLastSyncAt(new Date().toISOString())
    conflictHoldRef.current = false
    failNotifiedRef.current = false
    return { changed: changed.length, removed, keywordsPushed }
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
    if (!remoteReady) {
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
    if (!remoteReady) {
      autoQueuedRef.current = true // 하이드레이션이 끝나면(remoteReady) 이 효과가 다시 돌아 이어서 올린다
      return undefined
    }
    autoQueuedRef.current = false // 이번 실행이 큐에 쌓인 요청까지 커버한다
    const timer = setTimeout(runAutoPush, AUTO_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncTick, remoteReady])

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
       활성 프로필 id는 기기별 상태라 서버에 아예 싣지 않는다(로컬 저장만) */
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
    requestAutoSync() // 서버의 계정 행도 바로 정리(고아 행 삭제)
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
      requestAutoSync()
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
    /* 스튜디오 밖 단발 트랜잭션의 즉시 서버 싱크 요청 — App.jsx의 시나리오·쓰레드 CRUD가 부른다 */
    requestAutoSync,
    /* 서버 수동 저장 — 빌더 상단바 SyncButton과 홈 프로필 드롭다운 상태 행이 읽는 상태 한 벌 */
    remoteSync: {
      enabled: REMOTE_ENABLED,
      ready: remoteReady,
      failed: remoteFailed,
      /* 접속 직후 서버 상태(프로필·시나리오)를 불러오는 중 — 홈 프로필 컨트롤·SyncButton이 표시 */
      hydrating: REMOTE_ENABLED && !remoteReady && !remoteFailed,
      busy: pushBusy,
      dirty: remoteDirty,
      dirtyCount: changedAccountIds.length + removedAccountIds.length + (keywordsDirty ? 1 : 0),
      lastSyncAt,
      push: pushToServer,
    },
  }
}
