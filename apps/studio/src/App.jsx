import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import TaggingStudio from './components/TaggingStudio.jsx'

/*
 * 앱 셸 — 라우팅과 토스트를 갖고, 화면들이 쓰는 api 객체를 조립한다.
 *
 * 워크스페이스 상태와 저장은 useWorkspace가, 시나리오 복사·가져오기 규칙은
 * lib/scenarioOps가 담당한다. 여기서는 "무엇을 보여줄지"만 결정한다.
 *
 * 페이지형 화면은 해시 URL이 원천이다 — #builder/<sid>(시나리오 스튜디오),
 * #explore-editor(프로필·키워드 사전), #tagging(상품 태깅 검토), #ops[/<탭>](운영 콘솔 —
 * 쓰레드·평가/파이프라인/실험 탭까지 해시로 딥링크, 구 #admin 주소도 계속 받는다).
 * 진입은 location.hash 푸시(히스토리 엔트리 생성), 적용은 hashchange 핸들러 한 곳 —
 * 그래서 브라우저 앞/뒤로가기·새로고침·주소 직접 입력이 전부 동작한다.
 * player/live는 체험 1회의 일시 상태라 해시 없이 route 상태로만 산다 (공유는 #s= 별도).
 */

/** 해시 → 페이지 라우트 (모르는 해시·#s= 공유 링크는 null = 홈/공유 모드 처리) */
function routeFromHash(hash) {
  const opsStudio = hash.match(/^#ops\/studio(?:\/(.+))?$/)
  if (opsStudio) return { name: 'admin', tab: 'studio', id: opsStudio[1] ? decodeURIComponent(opsStudio[1]) : null }
  const ops = hash.match(/^#ops(?:\/(dashboard|threads|tagging|knowledge|pipeline|prompts|experiment))?$/)
  if (ops) return { name: 'admin', tab: ops[1] || 'dashboard' }
  if (hash === '#admin') return { name: 'admin', tab: 'dashboard' } // 구 주소 호환
  if (hash === '#tagging') return { name: 'tagging' }
  if (hash === '#explore-editor') return { name: 'explore-editor' }
  const builder = hash.match(/^#builder\/(.+)$/)
  if (builder) return { name: 'builder', id: decodeURIComponent(builder[1]) }
  return null
}

export default function App() {
  // route: {name:'home'} | {name:'builder', id} | {name:'player', id, resume}
  //      | {name:'live', query?, resumeThreadId?, runId} | {name:'explore-editor'}
  //      | {name:'tagging'} | {name:'admin', tab}
  // 초기값: 데이터 게이트가 없는 해시는 즉시 반영, #builder/*는 하이드레이션 뒤 초기 효과가 연다
  const [route, setRoute] = useState(() => {
    if (typeof location === 'undefined') return { name: 'home' }
    const fromHash = routeFromHash(location.hash)
    const needsStudioData = fromHash && (
      fromHash.name === 'builder'
      || (fromHash.name === 'admin' && fromHash.tab === 'studio' && fromHash.id)
    )
    return fromHash && !needsStudioData ? fromHash : { name: 'home' }
  })
  const [toast, setToast] = useState(null)
  const showToast = (message) => setToast(message)
  /* 홈 복귀 — 해시를 지운 새 히스토리 엔트리를 만들어 뒤로가기로 이전 페이지에 돌아갈 수 있다 */
  const goHome = () => {
    if (typeof location !== 'undefined' && location.hash) {
      history.pushState(null, '', location.pathname + location.search)
    }
    setRoute({ name: 'home' })
  }

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

  /* 해시 적용 지점 (단일) — 주소 직접 입력·앞/뒤로가기·해시 푸시 전부 여기로 모인다.
     빌더는 콘텐츠+버전 스냅샷을 맞춘 뒤 열고, 없는 시나리오면 홈으로 되돌린다 */
  const routeRef = useRef(route)
  routeRef.current = route
  const applyHashRef = useRef(() => {})
  applyHashRef.current = () => {
    if (readShareFromHash()) return // 공유 링크(#s=)는 별도 모드가 받는다
    const next = routeFromHash(location.hash)
    if (!next) {
      if (routeRef.current.name !== 'home') setRoute({ name: 'home' })
      return
    }
    const isAdminStudioEditor = next.name === 'admin' && next.tab === 'studio' && next.id
    if (next.name !== 'builder' && !isAdminStudioEditor) {
      setRoute(next)
      return
    }
    if (routeRef.current.name === next.name && routeRef.current.id === next.id) return
    openSynced(workspace.ensureStudioSynced(next.id), () => {
      if (workspace.getFreshActiveScenarios().some((scenario) => scenario.id === next.id)) {
        setRoute(isAdminStudioEditor ? { name: 'admin', tab: 'studio', id: next.id } : { name: 'builder', id: next.id })
      } else {
        showToast('이 계정에 없는 시나리오예요.')
        if (isAdminStudioEditor) {
          history.replaceState(null, '', location.pathname + location.search + '#ops/studio')
          setRoute({ name: 'admin', tab: 'studio' })
        } else {
          history.replaceState(null, '', location.pathname + location.search)
          setRoute({ name: 'home' })
        }
      }
    })
  }
  useEffect(() => {
    const onHash = () => applyHashRef.current()
    window.addEventListener('hashchange', onHash)
    // 초기 진입: #builder/* 등 데이터 게이트가 필요한 해시를 마운트 후 1회 적용
    applyHashRef.current()
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

  /* 페이지 진입 — 해시 엔트리를 푸시하고 라우트를 연다. pushState는 hashchange를 발화하지
     않으므로(같은 해시 재적용·상태 레이스 방지) 적용은 여기서 직접, URL 주도 진입만 핸들러 몫 */
  const pushRoute = (hash, next) => {
    if (typeof location !== 'undefined' && location.hash !== hash) {
      history.pushState(null, '', location.pathname + location.search + hash)
    }
    setRoute(next)
  }

  const registerScenario = (scenario, destination = 'builder') => {
    setScenarios((prev) => [...prev, scenario])
    if (destination === 'admin') {
      pushRoute(`#ops/studio/${encodeURIComponent(scenario.id)}`, { name: 'admin', tab: 'studio', id: scenario.id })
    } else {
      pushRoute(`#builder/${encodeURIComponent(scenario.id)}`, { name: 'builder', id: scenario.id })
    }
    requestAutoSync()
    return scenario
  }

  /* 템플릿을 넘기면 해당 구성으로, 없거나 blank면 빈 시나리오로 생성 */
  const newScenario = (template) => registerScenario(createScenario(
    template && template.key && template.key !== 'blank'
      ? { title: template.name, chip: template.chip, stages: template.build() }
      : {}
  ))

  /* 운영 센터 안에서 만든 시나리오는 독립 빌더 화면으로 빠지지 않고
     #ops/studio/<id>에 머물러 같은 어드민 셸 안에서 바로 편집한다. */
  const newAdminScenario = (template) => registerScenario(createScenario(
    template && template.key && template.key !== 'blank'
      ? { title: template.name, chip: template.chip, stages: template.build() }
      : {}
  ), 'admin')

  /* AI가 만든 시나리오 초안(설문 + 골든 계획 케이스)을 그대로 등록하고 빌더로 이동 */
  const newScenarioFrom = (partial) => registerScenario(createScenario(partial))
  const newAdminScenarioFrom = (partial) => registerScenario(createScenario(partial), 'admin')

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
    newAdminScenario,
    newAdminScenarioFrom,
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
    openBuilder: (id) =>
      openSynced(workspace.ensureStudioSynced(id), () =>
        pushRoute(`#builder/${encodeURIComponent(id)}`, { name: 'builder', id })),
    /* resume = { threadId, stage } — 기존 쓰레드를 이어서 해당 단계부터.
       칩 클릭 체험은 시나리오 콘텐츠(stages·planCases)를 맞춘 뒤 시작한다 */
    playScenario: (id, resume) => openSynced(workspace.ensureScenarioSynced(id), () => setRoute({ name: 'player', id, resume })),
    /* 라이브 생성 체험(BFF) — 자유 검색 진입. runId로 리마운트해 "새로 생성"이 새 쓰레드를 만든다 */
    playLive: (query) => setRoute({ name: 'live', query, runId: Date.now() }),
    resumeLive: (threadId) => setRoute({ name: 'live', resumeThreadId: threadId, runId: Date.now() }),
    /* 페이지형 화면 진입·이탈 — 전부 해시 히스토리 엔트리라 브라우저 앞/뒤로가기가 동작한다 */
    openAdmin: () => pushRoute('#ops', { name: 'admin', tab: 'dashboard' }),
    /* 운영 콘솔 탭 전환도 해시 엔트리 — 새로고침·앞뒤로가기가 탭을 유지한다 */
    setAdminTab: (tab) => pushRoute(tab === 'dashboard' ? '#ops' : `#ops/${tab}`, { name: 'admin', tab }),
    openAdminBuilder: (id) =>
      openSynced(workspace.ensureStudioSynced(id), () =>
        pushRoute(`#ops/studio/${encodeURIComponent(id)}`, { name: 'admin', tab: 'studio', id })),
    exitAdmin: goHome,
    openExploreEditor: () => pushRoute('#explore-editor', { name: 'explore-editor' }),
    closeExploreEditor: goHome,
    /* 상품 태깅 검토 스튜디오 — 라이브 생성 카탈로그 태그 검토 (진입은 홈 드로어 도구 행) */
    openTaggingStudio: () => pushRoute('#tagging', { name: 'tagging' }),
    closeTaggingStudio: goHome,
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
      pushRoute(`#builder/${encodeURIComponent(scenario.id)}`, { name: 'builder', id: scenario.id })
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
      {route.name === 'admin' && <AdminView api={api} tab={route.tab || 'dashboard'} studioScenarioId={route.id} />}
      {route.name === 'tagging' && <TaggingStudio api={api} />}
      {route.name !== 'home' && route.name !== 'explore-editor' && route.name !== 'live' && route.name !== 'admin' && route.name !== 'tagging' && !current && <HomeView api={api} />}

      {toast && <div className="sb-toast">{toast}</div>}
    </>
  )
}
