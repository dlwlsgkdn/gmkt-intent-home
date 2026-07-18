import React, { useEffect, useMemo, useState } from 'react'
import { loadScenarios, saveScenarios, createScenario } from './lib/store.js'
import HomeView from './components/HomeView.jsx'
import Builder from './components/Builder.jsx'
import Player from './components/Player.jsx'

export default function App() {
  const [scenarios, setScenarios] = useState(loadScenarios)
  // route: {name:'home'} | {name:'builder', id} | {name:'player', id}
  const [route, setRoute] = useState({ name: 'home' })
  const [toast, setToast] = useState(null)

  useEffect(() => {
    saveScenarios(scenarios)
  }, [scenarios])

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

  const newScenario = () => {
    const s = createScenario()
    setScenarios((prev) => [...prev, s])
    setRoute({ name: 'builder', id: s.id })
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
    goHome: () => setRoute({ name: 'home' }),
    openBuilder: (id) => setRoute({ name: 'builder', id }),
    playScenario: (id) => setRoute({ name: 'player', id }),
    showToast: (msg) => setToast(msg),
  }

  return (
    <>
      {route.name === 'home' && <HomeView api={api} />}
      {route.name === 'builder' && current && <Builder api={api} scenario={current} />}
      {route.name === 'player' && current && <Player api={api} scenario={current} />}
      {route.name !== 'home' && !current && <HomeView api={api} />}

      {toast && <div className="sb-toast">{toast}</div>}
    </>
  )
}
