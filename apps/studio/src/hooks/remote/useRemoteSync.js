import { useEffect, useRef, useState } from 'react'
import { REMOTE_ENABLED } from '../../lib/remote.js'
import { accountKey, splitAccount } from '../../lib/accountRows.js'
import { createRowAdoption } from './rowAdoption.js'
import { createOnDemandSync } from './onDemandSync.js'
import { createPushOps } from './push.js'
import { createStarterSync } from './starterSync.js'
import { runHydration } from './hydration.js'

/* 자동 트랜잭션 싱크의 디바운스 — 연속 요청(플레이 중 쓰레드 갱신, 칩 드래그)을 한 번으로 모은다 */
const AUTO_SYNC_DELAY_MS = 1200

/*
 * 서버 동기화 훅 — 워크스페이스 상태의 서버 미러링 한 벌.
 * 행 기준선·서버 인덱스 같은 공유 ref와 동기화 상태를 갖고, 실제 규칙은 아래로 위임한다:
 *   remote/rowAdoption  — 서버 행 채택 (행 → 메모리 병합 + 기준선)
 *   remote/onDemandSync — 필요 시점 로드 (syncRow · ensure*)
 *   remote/hydration    — 접속 하이드레이션 (부트 1왕복 + 백그라운드 + 구형 이관)
 *   remote/push         — 미저장 감지(accountDirty) + 업로드 코어(pushCore)
 *
 * 업로드는 두 갈래: 수동 pushToServer("서버에 저장" — 빌더 연속 편집)와
 * requestAutoSync(스튜디오 밖 단발 트랜잭션 — 디바운스 뒤 자동 업로드).
 * 자동은 충돌(다른 창의 선행 변경) 시 덮지 않고 멈춰 수동 저장으로 유도한다.
 */
export function useRemoteSync({
  init, accounts, activeAccount, keywords,
  stateRef, setAccounts, setActiveAccountId, setKeywords, setStarters, showToast,
}) {
  const [bootReady, setBootReady] = useState(false)   // 부트(셸 채택+충돌 기준선) 완료 — 업로드 허용 시점
  const [homeSynced, setHomeSynced] = useState(false) // 홈 필요분(전 계정 셸+활성 콘텐츠·쓰레드)까지 완료 — 배지 기준
  const [syncingAccountIds, setSyncingAccountIds] = useState(() => new Set()) // 콘텐츠 받는 중인 계정 — 프로필 전환 직후 배지
  const [remoteFailed, setRemoteFailed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [autoSyncTick, setAutoSyncTick] = useState(0) // 자동 싱크 요청 카운터 — 아래 효과가 디바운스 후 업로드

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
  const inFlightRef = useRef(new Map())    // 필요 시점 로드 중복 요청 공유 (rowKey → Promise)
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

  /* ── 업로드 흐름 제어 ── */
  const busyRef = useRef(false)         // 수동·자동 공용 전송 중 가드
  const autoQueuedRef = useRef(false)   // 전송 중·부트 전에 들어온 자동 싱크 요청
  const conflictHoldRef = useRef(false) // 자동 싱크가 충돌을 만나 멈춘 상태 — 수동 저장 성공이 해제
  const failNotifiedRef = useRef(false) // 자동 싱크 실패 토스트는 다음 성공 전까지 한 번만

  const shellJson = (account) => {
    const cached = shellJsonCacheRef.current.get(account)
    if (cached) return cached
    const json = JSON.stringify(splitAccount(account).shellBody)
    shellJsonCacheRef.current.set(account, json)
    return json
  }

  /* 하위 모듈이 공유하는 문맥 — ref·세터는 렌더 간 안정적이라 그대로 넘긴다 */
  const ctx = {
    init, stateRef, showToast, shellJson,
    setAccounts, setActiveAccountId, setKeywords, setStarters,
    rowsRef, metaBaselineRef, keywordsBaselineRef, serverIndexRef,
    localAuthorityRef, removedAccountsRef, initialByIdRef, adoptionRef,
    legacyQueueRef, inFlightRef, homeSyncedRef, bootDeferredRef,
    conflictHoldRef, failNotifiedRef,
    setBootReady, setHomeSynced, setSyncingAccountIds, setLastSyncAt,
  }
  const adoption = createRowAdoption(ctx)
  const onDemand = createOnDemandSync(ctx, adoption)
  const { accountDirty, pushCore } = createPushOps(ctx)
  const starterSync = createStarterSync(ctx)

  /* ── 미저장 변경 감지 (렌더마다 — 행 단위) ── */
  const changedAccountIds = accounts.filter(accountDirty).map((account) => account.id)
  const removedAccountIds = [...removedAccountsRef.current]
    .filter((id) => serverIndexRef.current.has(accountKey(id)))
  const keywordsDirty = keywordsBaselineRef.current !== JSON.stringify(keywords)
  const remoteDirty = changedAccountIds.length > 0 || removedAccountIds.length > 0 || keywordsDirty

  /* ── 자동 싱크 요청 (스튜디오 밖 단발 트랜잭션이 부른다) ── */
  const requestAutoSync = () => {
    if (REMOTE_ENABLED) setAutoSyncTick((n) => n + 1)
  }

  /* ── 서버 하이드레이션 (최초 1회) ── */
  useEffect(() => {
    if (!REMOTE_ENABLED) {
      bootDeferredRef.current.resolve()
      return undefined // local 프로필: localStorage만 사용
    }
    const signal = { cancelled: false }
    runHydration({ ctx, adoption, starterSync, syncRow: onDemand.syncRow, accountDirty, requestAutoSync, signal })
      .catch((error) => {
        if (!signal.cancelled) {
          setRemoteFailed(true)
          bootDeferredRef.current.resolve()
          console.warn('[remote] 서버 상태 불러오기 실패 — 이번 세션은 서버 저장이 막혀요 (로컬 저장은 계속):', error)
        }
      })
    return () => { signal.cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /* ── 자동 싱크 실행 — 성공은 조용히, 실패·충돌은 토스트로 알린다.
     빌더의 연속 편집은 이 경로를 타지 않는다 — 수동 저장이 담당 */
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
        showToast('서버 자동 저장에 실패했어요. 네트워크 확인 후 다음 작업 때 자동으로 다시 저장돼요. (스튜디오의 "서버에 저장"으로 바로 올릴 수도 있어요)')
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

  return {
    /* 기본 시나리오 라이브러리 미러링 — 지정·해제 즉시 쓰기와 설치 직전 스냅샷 로드 */
    starterSync,
    /* 필요 시점 로드 — App.jsx가 플레이(칩 클릭)·빌더 진입·복제·내보내기 전에 부른다 */
    ensureScenarioSynced: onDemand.ensureScenarioSynced,
    ensureStudioSynced: onDemand.ensureStudioSynced,
    ensureAccountSynced: onDemand.ensureAccountSynced,
    ensureActiveSynced: onDemand.ensureActiveSynced,
    ensureAllSynced: onDemand.ensureAllSynced,
    /* 스튜디오 밖 단발 트랜잭션의 즉시 서버 싱크 요청 */
    requestAutoSync,
    /* 계정 삭제·전체 복원이 남기는 업로드 의도 표식 */
    markAccountRemoved: (id) => { removedAccountsRef.current.add(id) },
    claimLocalAuthority: () => { localAuthorityRef.current = true },
    /* 서버 수동 저장 — 빌더 상단바 SyncButton과 홈 프로필 드롭다운 상태 행이 읽는 상태 한 벌 */
    remoteSync: {
      enabled: REMOTE_ENABLED,
      ready: bootReady,
      failed: remoteFailed,
      /* 활성 프로필의 홈 필요분(셸+콘텐츠·쓰레드)을 불러오는 중 — 홈 프로필 컨트롤이 표시.
         첫 하이드레이션(homeSynced 전)과 프로필 전환 직후(그 계정 콘텐츠 로드 중) 둘 다 켜진다 */
      hydrating: REMOTE_ENABLED && !remoteFailed
        && (!homeSynced || (activeAccount ? syncingAccountIds.has(activeAccount.id) : false)),
      busy: pushBusy,
      dirty: remoteDirty,
      dirtyCount: changedAccountIds.length + removedAccountIds.length + (keywordsDirty ? 1 : 0),
      lastSyncAt,
      push: pushToServer,
    },
  }
}
