import React, { useEffect, useMemo, useState } from 'react'
import { loadScenarios, saveScenarios, createScenario, uid, loadExplore, saveExplore, loadProfile, saveProfile } from './lib/store.js'
import HomeView from './components/HomeView.jsx'
import Builder from './components/Builder.jsx'
import Player from './components/Player.jsx'
import ExploreEditor from './components/ExploreEditor.jsx'

export default function App() {
  const [scenarios, setScenarios] = useState(loadScenarios)
  const [explore, setExplore] = useState(loadExplore)
  const [profile, setProfile] = useState(loadProfile)
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

  const api = {
    scenarios,
    setScenarios,
    updateScenario,
    removeScenario,
    newScenario,
    copyScenario,
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
    showToast: (msg) => setToast(msg),
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
