import React, { useEffect, useMemo, useState } from 'react'
import { loadScenarios, saveScenarios, createScenario, uid, loadExplore, saveExplore, loadProfile, saveProfile, loadKeywords, saveKeywords, loadViewerDevice, saveViewerDevice, loadThreads, saveThreads } from './lib/store.js'
import { readShareFromHash, clearShareHash } from './lib/share.js'
import HomeView from './components/HomeView.jsx'
import Builder from './components/Builder.jsx'
import Player from './components/Player.jsx'
import ExploreEditor from './components/ExploreEditor.jsx'

export default function App() {
  const [scenarios, setScenarios] = useState(loadScenarios)
  const [explore, setExplore] = useState(loadExplore)
  const [profile, setProfile] = useState(loadProfile)
  const [keywords, setKeywords] = useState(loadKeywords)
  const [viewerDevice, setViewerDevice] = useState(loadViewerDevice)
  const [threads, setThreads] = useState(loadThreads)
  // 공유 링크(#s=...)로 들어온 경우: 저장하지 않고 바로 체험
  const [shared, setShared] = useState(readShareFromHash)
  // route: {name:'home'} | {name:'builder', id} | {name:'player', id} | {name:'explore-editor'}
  const [route, setRoute] = useState({ name: 'home' })
  const [toast, setToast] = useState(null)

  useEffect(() => {
    saveScenarios(scenarios)
  }, [scenarios])

  useEffect(() => {
    saveExplore(explore)
  }, [explore])

  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  useEffect(() => {
    saveKeywords(keywords)
  }, [keywords])

  useEffect(() => {
    saveViewerDevice(viewerDevice)
  }, [viewerDevice])

  useEffect(() => {
    saveThreads(threads)
  }, [threads])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const updateScenario = (id, updater) => {
    setScenarios((prev) =>
      prev.map((s) => (s.id === id ? { ...updater(s), updatedAt: new Date().toISOString() } : s))
    )
  }

  const removeScenario = (id) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id))
    if (route.id === id) setRoute({ name: 'home' })
  }

  /* 템플릿을 넘기면 해당 구성으로, 없거나 blank면 빈 시나리오로 생성 */
  const newScenario = (tpl) => {
    const s = createScenario(
      tpl && tpl.key && tpl.key !== 'blank'
        ? { title: tpl.name, chip: tpl.chip, stages: tpl.build() }
        : {}
    )
    setScenarios((prev) => [...prev, s])
    setRoute({ name: 'builder', id: s.id })
  }

  /* 홈 칩 드래그 순서 변경: dragId를 targetId 위치로 이동 */
  const reorderScenario = (dragId, targetId) => {
    if (dragId === targetId) return
    setScenarios((prev) => {
      const from = prev.findIndex((s) => s.id === dragId)
      const to = prev.findIndex((s) => s.id === targetId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  /* 시나리오 복제 — 아이템 id까지 새로 발급해 완전한 사본을 만든다 */
  const copyScenario = (id) => {
    const src = scenarios.find((s) => s.id === id)
    if (!src) return
    const stages = {}
    Object.keys(src.stages).forEach((k) => {
      stages[k] = (src.stages[k] || []).map((it) => ({ ...it, id: uid(), props: { ...it.props } }))
    })
    const copy = {
      ...src,
      id: uid(),
      title: `${src.title} 복사본`,
      chip: src.chip ? `${src.chip}_복사` : '복사본',
      status: 'draft',
      stages,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setScenarios((prev) => [...prev, copy])
    setToast(`"${copy.title}" 을(를) 만들었어요. (작성 중 상태)`)
  }

  const importScenarios = (arr) => {
    if (!Array.isArray(arr)) {
      setToast('가져오기 실패: 시나리오 배열(JSON)이 아니에요.')
      return
    }
    const cleaned = arr
      .filter((s) => s && typeof s === 'object' && s.stages)
      .map((s) => ({
        ...createScenario(),
        ...s,
        id: uid(),
        updatedAt: new Date().toISOString(),
      }))
    if (cleaned.length === 0) {
      setToast('가져올 수 있는 시나리오가 없어요.')
      return
    }
    setScenarios((prev) => [...prev, ...cleaned])
    setToast(`시나리오 ${cleaned.length}개를 가져왔어요.`)
  }

  const current = useMemo(
    () => scenarios.find((s) => s.id === route.id) || null,
    [scenarios, route.id]
  )

  /* 쓰레드 upsert — 같은 id가 있으면 갱신, 없으면 맨 앞에 추가 (최신순 유지) */
  const recordThread = (entry) => {
    setThreads((prev) => {
      const rest = prev.filter((t) => t.id !== entry.id)
      const existing = prev.find((t) => t.id === entry.id)
      return [{ ...existing, ...entry, updatedAt: new Date().toISOString() }, ...rest]
    })
  }

  const api = {
    scenarios,
    setScenarios,
    updateScenario,
    removeScenario,
    newScenario,
    copyScenario,
    reorderScenario,
    importScenarios,
    goHome: () => setRoute({ name: 'home' }),
    openBuilder: (id) => setRoute({ name: 'builder', id }),
    playScenario: (id) => setRoute({ name: 'player', id }),
    openExploreEditor: () => setRoute((prev) => ({ name: 'explore-editor', back: prev })),
    closeExploreEditor: () => setRoute((prev) => prev.back || { name: 'home' }),
    explore,
    updateExplore: setExplore,
    profile,
    updateProfile: setProfile,
    keywords,
    updateKeywords: setKeywords,
    viewerDevice,
    setViewerDevice,
    threads,
    recordThread,
    removeThread: (id) => setThreads((prev) => prev.filter((t) => t.id !== id)),
    clearThreads: () => setThreads([]),
    showToast: (msg) => setToast(msg),
  }

  /* 공유 링크 모드: 임시 시나리오를 바로 실행. '편집' 버튼은 내 스튜디오로 가져오기 */
  if (shared) {
    const exitShared = () => {
      setShared(null)
      clearShareHash()
    }
    const adoptShared = () => {
      const s = { ...createScenario(), ...shared, id: uid(), status: 'draft' }
      setScenarios((prev) => [...prev, s])
      exitShared()
      setRoute({ name: 'builder', id: s.id })
      setToast('공유받은 시나리오를 내 스튜디오로 가져왔어요.')
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
      {route.name === 'player' && current && <Player api={api} scenario={current} />}
      {route.name !== 'home' && route.name !== 'explore-editor' && !current && <HomeView api={api} />}

      {toast && <div className="sb-toast">{toast}</div>}
    </>
  )
}
