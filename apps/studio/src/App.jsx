import React, { useEffect, useMemo, useState } from 'react'
import { createScenario, normalizeScenario } from './lib/store.js'
import { readShareFromHash, clearShareHash } from './lib/share.js'
import { adoptSharedScenario, duplicateScenario, scenariosFromImport } from './lib/scenarioOps.js'
import { useWorkspace } from './hooks/useWorkspace.js'
import HomeView from './components/HomeView.jsx'
import Builder from './components/Builder.jsx'
import Player from './components/Player.jsx'
import LivePlayer from './components/LivePlayer.jsx'
import ExploreEditor from './components/ExploreEditor.jsx'
import AdminView from './components/AdminView.jsx'

/*
 * 앱 셸 — 라우팅과 토스트를 갖고, 화면들이 쓰는 api 객체를 조립한다.
 *
 * 워크스페이스 상태와 저장은 useWorkspace가, 시나리오 복사·가져오기 규칙은
 * lib/scenarioOps가 담당한다. 여기서는 "무엇을 보여줄지"만 결정한다.
 */
export default function App() {
  // route: {name:'home'} | {name:'builder', id} | {name:'player', id, resume}
  //      | {name:'live', query?, resumeThreadId?, runId} | {name:'explore-editor', back}
  //      | {name:'admin'} — #admin 해시로만 진입 (유저 진입점에 링크 없음)
  const [route, setRoute] = useState(() =>
    typeof location !== 'undefined' && location.hash === '#admin' ? { name: 'admin' } : { name: 'home' }
  )
  const [toast, setToast] = useState(null)
  const showToast = (message) => setToast(message)
  const goHome = () => setRoute({ name: 'home' })

  const workspace = useWorkspace({ showToast, onReset: goHome })
  const { scenarios, setScenarios, requestAutoSync } = workspace

  /* 지연 로드 게이트: 시나리오 콘텐츠(칩 클릭)·버전(빌더)은 필요 시점에 서버와 맞추고 연다.
     보통 홈 백그라운드 로드가 이미 끝나 즉시 통과한다 — 오래 걸릴 때만 안내 토스트 */
  const openSynced = (ensurePromise, go) => {
    let done = false
    const slowTimer = setTimeout(() => {
      if (!done) showToast('서버에서 최신 내용을 불러오는 중이에요…')
    }, 300)
    ensurePromise
      .catch(() => showToast('서버에서 불러오지 못해 이 기기에 저장된 내용으로 열어요.'))
      .finally(() => {
        done = true
        clearTimeout(slowTimer)
        go()
      })
  }

  /* 공유 링크(#s=...)로 들어온 경우: 저장하지 않고 바로 체험 */
  const [shared, setShared] = useState(() => {
    const value = readShareFromHash()
    return value ? normalizeScenario(value) : null
  })

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  /* 관리 페이지 — 주소창에 #admin을 치면 (새로고침 없이도) 진입한다 */
  useEffect(() => {
    const onHash = () => {
      if (location.hash === '#admin') setRoute({ name: 'admin' })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /* ── 시나리오 ── */
  /* 업데이터가 같은 참조를 돌려주면 updatedAt 도장도 찍지 않는다 — 빌더 진입 시
     재측정 커밋 같은 무변경 쓰기가 "서버 미저장" 상태를 만들지 않게 */
  const updateScenario = (id, updater) => {
    setScenarios((prev) => {
      let changed = false
      const next = prev.map((scenario) => {
        if (scenario.id !== id) return scenario
        const out = updater(scenario)
        if (out === scenario) return scenario
        changed = true
        return { ...out, updatedAt: new Date().toISOString() }
      })
      return changed ? next : prev
    })
  }

  /* 홈·드로어의 시나리오/쓰레드 CRUD는 단발 트랜잭션이라 requestAutoSync로 서버에도 바로
     싱크한다 — 빌더 안 연속 편집(updateScenario)만 수동 "서버에 저장"이 담당 */
  const removeScenario = (id) => {
    setScenarios((prev) => prev.filter((scenario) => scenario.id !== id))
    if (route.id === id) goHome()
    requestAutoSync()
  }

  /* 이 시나리오가 기본 시나리오의 원천인가 — 저장 필드 없이 라이브러리 메타에서 파생.
     라이브러리에서 항목을 내리면 배지도 자연히 사라진다 */
  const isStarterSource = (scenario) => workspace.starterEntries.some((entry) =>
    entry.sourceAccountId === workspace.activeAccountId && entry.sourceScenarioId === scenario.id)

  const registerScenario = (scenario) => {
    setScenarios((prev) => [...prev, scenario])
    setRoute({ name: 'builder', id: scenario.id })
    requestAutoSync()
    return scenario
  }

  /* 템플릿을 넘기면 해당 구성으로, 없거나 blank면 빈 시나리오로 생성 */
  const newScenario = (template) => registerScenario(createScenario(
    template && template.key && template.key !== 'blank'
      ? { title: template.name, chip: template.chip, stages: template.build() }
      : {}
  ))

  /* AI가 만든 시나리오 초안(설문 + 골든 계획 케이스)을 그대로 등록하고 빌더로 이동 */
  const newScenarioFrom = (partial) => registerScenario(createScenario(partial))

  /* 홈 칩 드래그 순서 변경: dragId를 targetId 위치로 이동 */
  const reorderScenario = (dragId, targetId) => {
    if (dragId === targetId) return
    setScenarios((prev) => {
      const from = prev.findIndex((scenario) => scenario.id === dragId)
      const to = prev.findIndex((scenario) => scenario.id === targetId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    requestAutoSync() // 드래그 중 연속 호출은 디바운스가 한 번으로 모은다
  }

  const copyScenario = (id) => {
    if (!scenarios.some((scenario) => scenario.id === id)) return
    /* 복제는 콘텐츠(stages·planCases)를 통째로 복사하므로 서버 최신을 먼저 맞춘다 */
    workspace.ensureScenarioSynced(id).catch(() => {}).then(() => {
      const source = workspace.getFreshActiveScenarios().find((scenario) => scenario.id === id)
      if (!source) return
      const copy = duplicateScenario(source)
      setScenarios((prev) => [...prev, copy])
      requestAutoSync()
      showToast(`"${copy.title}" 을(를) 만들었어요. (작성 중 상태)`)
    })
  }

  const importScenarios = (list) => {
    const cleaned = scenariosFromImport(list)
    if (!cleaned) {
      showToast('가져오기 실패: 시나리오 배열(JSON)이 아니에요.')
      return
    }
    if (cleaned.length === 0) {
      showToast('가져올 수 있는 시나리오가 없어요.')
      return
    }
    setScenarios((prev) => [...prev, ...cleaned])
    requestAutoSync()
    showToast(`시나리오 ${cleaned.length}개를 가져왔어요.`)
  }

  const current = useMemo(
    () => scenarios.find((scenario) => scenario.id === route.id) || null,
    [scenarios, route.id]
  )

  /* 쓰레드 upsert — 같은 id가 있으면 갱신, 없으면 맨 앞에 추가 (최신순, 최근 30개 유지) */
  const recordThread = (entry) => {
    workspace.setThreads((prev) => {
      const rest = prev.filter((thread) => thread.id !== entry.id)
      const existing = prev.find((thread) => thread.id === entry.id)
      return [{ ...existing, ...entry, updatedAt: new Date().toISOString() }, ...rest].slice(0, 30)
    })
    requestAutoSync() // 체험 중 단계 이동마다 불리지만 디바운스가 한 번으로 모은다
  }

  const api = {
    scenarios,
    setScenarios,
    updateScenario,
    removeScenario,
    newScenario,
    newScenarioFrom,
    copyScenario,
    reorderScenario,
    importScenarios,
    /* 기본 시나리오 라이브러리 — 지정은 시나리오 행에서, 목록·해제는 드로어의 전역 섹션에서 */
    starterEntries: workspace.starterEntries,
    isStarterSource,
    markStarterScenario: workspace.markStarterScenario,
    removeStarterEntry: workspace.removeStarterEntry,
    exportDataBackup: workspace.exportDataBackup, // async — 서버 전체 행을 맞춘 뒤 만든다
    importDataBackup: workspace.importDataBackup,
    ensureActiveSynced: workspace.ensureActiveSynced,
    getFreshActiveScenarios: workspace.getFreshActiveScenarios,
    remoteSync: workspace.remoteSync,
    goHome,
    /* 빌더는 콘텐츠+버전 스냅샷을 맞춘 뒤 연다 — 버전은 스튜디오 진입 시에만 로드 */
    openBuilder: (id) => openSynced(workspace.ensureStudioSynced(id), () => setRoute({ name: 'builder', id })),
    /* resume = { threadId, stage } — 기존 쓰레드를 이어서 해당 단계부터.
       칩 클릭 체험은 시나리오 콘텐츠(stages·planCases)를 맞춘 뒤 시작한다 */
    playScenario: (id, resume) => openSynced(workspace.ensureScenarioSynced(id), () => setRoute({ name: 'player', id, resume })),
    /* 라이브 생성 체험(BFF) — 자유 검색 진입. runId로 리마운트해 "새로 생성"이 새 쓰레드를 만든다 */
    playLive: (query) => setRoute({ name: 'live', query, runId: Date.now() }),
    resumeLive: (threadId) => setRoute({ name: 'live', resumeThreadId: threadId, runId: Date.now() }),
    /* 관리 페이지 이탈 — #admin 해시를 지워야 새로고침이 홈으로 돌아온다 */
    exitAdmin: () => {
      if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search)
      goHome()
    },
    openExploreEditor: () => setRoute((prev) => ({ name: 'explore-editor', back: prev })),
    closeExploreEditor: () => setRoute((prev) => prev.back || { name: 'home' }),
    explore: workspace.explore,
    updateExplore: workspace.setExplore,
    profile: workspace.profile,
    updateProfile: workspace.setProfile,
    keywords: workspace.keywords,
    updateKeywords: workspace.setKeywords,
    viewerDevice: workspace.viewerDevice,
    setViewerDevice: workspace.setViewerDevice,
    accounts: workspace.accounts,
    activeAccountId: workspace.activeAccountId,
    switchAccount: workspace.switchAccount,
    addAccount: workspace.addAccount,
    removeAccount: workspace.removeAccount,
    threads: workspace.threads,
    recordThread,
    removeThread: (id) => {
      workspace.setThreads((prev) => prev.filter((thread) => thread.id !== id))
      requestAutoSync()
    },
    clearThreads: () => {
      workspace.setThreads([])
      requestAutoSync()
    },
    showToast,
  }

  /* 공유 링크 모드: 임시 시나리오를 바로 실행. '편집'은 내 스튜디오로 가져오기 */
  if (shared) {
    const exitShared = () => {
      setShared(null)
      clearShareHash()
    }
    const adoptShared = () => {
      const scenario = adoptSharedScenario(shared)
      setScenarios((prev) => [...prev, scenario])
      exitShared()
      setRoute({ name: 'builder', id: scenario.id })
      requestAutoSync()
      showToast('공유받은 시나리오를 내 스튜디오로 가져왔어요.')
    }
    return (
      <>
        <Player api={{ ...api, goHome: exitShared, openBuilder: adoptShared }} scenario={shared} />
        {toast && <div className="sb-toast">{toast}</div>}
      </>
    )
  }

  return (
    <>
      {route.name === 'home' && <HomeView api={api} />}
      {route.name === 'explore-editor' && <ExploreEditor api={api} />}
      {route.name === 'builder' && current && <Builder api={api} scenario={current} />}
      {route.name === 'player' && current && (
        /* key: 같은 시나리오를 다른 쓰레드로 이어볼 때 단계·담기 상태가 새로 초기화되도록 리마운트 */
        <Player
          key={`${current.id}:${route.resume ? route.resume.threadId : 'new'}`}
          api={api}
          scenario={current}
          resume={route.resume}
        />
      )}
      {route.name === 'live' && (
        /* key: 같은 검색어라도 runId마다 새 쓰레드로 다시 생성한다 */
        <LivePlayer key={route.runId} api={api} query={route.query} resumeThreadId={route.resumeThreadId} />
      )}
      {route.name === 'admin' && <AdminView api={api} />}
      {route.name !== 'home' && route.name !== 'explore-editor' && route.name !== 'live' && route.name !== 'admin' && !current && <HomeView api={api} />}

      {toast && <div className="sb-toast">{toast}</div>}
    </>
  )
}
