import React, { useEffect, useMemo, useState } from 'react'
import { createScenario, normalizeScenario } from './lib/store.js'
import { readShareFromHash, clearShareHash } from './lib/share.js'
import { adoptSharedScenario, duplicateScenario, scenariosFromImport } from './lib/scenarioOps.js'
import { isDefaultScenario } from './lib/dateMakeupPack.js'
import { useWorkspace } from './hooks/useWorkspace.js'
import HomeView from './components/HomeView.jsx'
import Builder from './components/Builder.jsx'
import Player from './components/Player.jsx'
import ExploreEditor from './components/ExploreEditor.jsx'

/*
 * 앱 셸 — 라우팅과 토스트를 갖고, 화면들이 쓰는 api 객체를 조립한다.
 *
 * 워크스페이스 상태와 저장은 useWorkspace가, 시나리오 복사·가져오기 규칙은
 * lib/scenarioOps가 담당한다. 여기서는 "무엇을 보여줄지"만 결정한다.
 */
export default function App() {
  // route: {name:'home'} | {name:'builder', id} | {name:'player', id, resume} | {name:'explore-editor', back}
  const [route, setRoute] = useState({ name: 'home' })
  const [toast, setToast] = useState(null)
  const showToast = (message) => setToast(message)
  const goHome = () => setRoute({ name: 'home' })

  const workspace = useWorkspace({ showToast, onReset: goHome })
  const { scenarios, setScenarios } = workspace

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

  const removeScenario = (id) => {
    if (isDefaultScenario(scenarios.find((scenario) => scenario.id === id))) {
      showToast('기본 시나리오는 삭제할 수 없어요.')
      return
    }
    setScenarios((prev) => prev.filter((scenario) => scenario.id !== id))
    if (route.id === id) goHome()
  }

  const registerScenario = (scenario) => {
    setScenarios((prev) => [...prev, scenario])
    setRoute({ name: 'builder', id: scenario.id })
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
  }

  const copyScenario = (id) => {
    const source = scenarios.find((scenario) => scenario.id === id)
    if (!source) return
    const copy = duplicateScenario(source)
    setScenarios((prev) => [...prev, copy])
    showToast(`"${copy.title}" 을(를) 만들었어요. (작성 중 상태)`)
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
    isDefaultScenario,
    exportDataBackup: workspace.exportDataBackup,
    importDataBackup: workspace.importDataBackup,
    remoteSync: workspace.remoteSync,
    goHome,
    openBuilder: (id) => setRoute({ name: 'builder', id }),
    /* resume = { threadId, stage } — 기존 쓰레드를 이어서 해당 단계부터 */
    playScenario: (id, resume) => setRoute({ name: 'player', id, resume }),
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
    removeThread: (id) => workspace.setThreads((prev) => prev.filter((thread) => thread.id !== id)),
    clearThreads: () => workspace.setThreads([]),
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
      {route.name !== 'home' && route.name !== 'explore-editor' && !current && <HomeView api={api} />}

      {toast && <div className="sb-toast">{toast}</div>}
    </>
  )
}
