import React, { useRef, useState } from 'react'
import { BgBlobs, FloatingBar, StudioFab } from './Frame.jsx'
import ExploreFrame from './ExploreFrame.jsx'
import { TEMPLATES } from '../lib/templates.js'
import { hexToRgba } from '../lib/store.js'

export default function HomeView({ api }) {
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draggingChipId, setDraggingChipId] = useState(null)
  const importInputRef = useRef(null)
  const chipDragRef = useRef(null) // { id, startX, startY, moved }
  const published = api.scenarios.filter((s) => s.status === 'published')

  /* 칩 드래그로 순서 변경 — 6px 이상 움직이면 드래그, 아니면 클릭(실행) */
  const onChipPointerDown = (e, id) => {
    if (e.button !== 0) return
    chipDragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false }
    const move = (ev) => {
      const st = chipDragRef.current
      if (!st) return
      if (!st.moved && Math.abs(ev.clientX - st.startX) + Math.abs(ev.clientY - st.startY) > 6) {
        st.moved = true
        setDraggingChipId(st.id)
      }
      if (st.moved) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)
        const target = el && el.closest && el.closest('[data-chip-id]')
        const targetId = target && target.getAttribute('data-chip-id')
        if (targetId && targetId !== st.id) api.reorderScenario(st.id, targetId)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const st = chipDragRef.current
      chipDragRef.current = null
      setDraggingChipId(null)
      if (st && !st.moved) api.playScenario(st.id)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const exportScenarios = () => {
    if (api.scenarios.length === 0) {
      api.showToast('내보낼 시나리오가 없어요.')
      return
    }
    const blob = new Blob([JSON.stringify(api.scenarios, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ddak-scenarios.json'
    a.click()
    URL.revokeObjectURL(url)
    api.showToast(`시나리오 ${api.scenarios.length}개를 JSON으로 내보냈어요.`)
  }

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        api.importScenarios(JSON.parse(reader.result))
      } catch (err) {
        api.showToast('가져오기 실패: JSON 형식을 확인해주세요.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const submit = () => {
    const q = query.trim()
    if (!q) return
    // 공백/언더스코어 차이를 무시하고 매칭한다 ("나이트 루틴" ↔ "나이트_루틴")
    const norm = (str) => String(str || '').toLowerCase().replace(/[\s_]+/g, '')
    const nq = norm(q)
    const hit = published.find((s) => {
      const fields = [s.title, s.chip, s.query].map(norm).filter(Boolean)
      return fields.some((f) => f.includes(nq) || nq.includes(f))
    })
    if (hit) {
      api.playScenario(hit.id)
    } else {
      api.showToast('일치하는 시나리오가 없어요. 스튜디오에서 새로 만들어보세요!')
    }
  }

  return (
    <>
      <BgBlobs />
      <FloatingBar
        active="home"
        onHome={() => setDrawerOpen(false)}
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={() => setDrawerOpen((v) => !v)}
      />
      <StudioFab onClick={() => setDrawerOpen(true)} />

      <section className="clean-home min-h-screen relative z-10">
        <ExploreFrame
          config={api.explore}
          searchValue={query}
          onSearchChange={setQuery}
          onSubmit={submit}
          chips={published.map((s) => {
            const c = s.color || '#5f7465'
            return (
              <button
                key={s.id}
                type="button"
                data-chip-id={s.id}
                className={'suggestion-tag sb-chip-scenario' + (draggingChipId === s.id ? ' sb-chip-scenario--dragging' : '')}
                title={s.title + ' (드래그로 순서 변경)'}
                style={{ color: c, borderColor: hexToRgba(c, 0.45), background: hexToRgba(c, 0.08) }}
                onPointerDown={(e) => onChipPointerDown(e, s.id)}
              >
                <span className="sb-chip-scenario__spark">✦</span>#{s.chip}
              </button>
            )
          })}
        />
      </section>

      {/* 시나리오 관리 드로어 */}
      {drawerOpen && (
        <>
          <div className="sb-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="sb-drawer">
            <div className="sb-drawer__head">
              <div>
                <p className="sb-eyebrow">Scenario Studio</p>
                <h3>내 시나리오</h3>
              </div>
              <button type="button" className="sb-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="닫기">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <button type="button" className="sb-explore-btn" onClick={api.openExploreEditor}>
              <span className="sb-explore-btn__icon">🧭</span>
              <span className="sb-explore-btn__text">
                <strong>탐색 페이지 편집</strong>
                <small>모든 시나리오가 공유하는 공통 홈 화면</small>
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5l7 7-7 7" /></svg>
            </button>

            <p className="sb-panel-label">새로 만들기</p>
            <div className="sb-template-grid">
              {TEMPLATES.map((t) => (
                <button key={t.key} type="button" className="sb-template-card" onClick={() => api.newScenario(t)}>
                  <span className="sb-template-card__icon">{t.icon}</span>
                  <strong>{t.name}</strong>
                  <small>{t.desc}</small>
                </button>
              ))}
            </div>

            <div className="sb-drawer__tools">
              <button type="button" onClick={exportScenarios}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>
                내보내기
              </button>
              <button type="button" onClick={() => importInputRef.current && importInputRef.current.click()}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" /></svg>
                가져오기
              </button>
              <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
            </div>

            <div className="sb-drawer__list">
              {api.scenarios.length === 0 && (
                <div className="sb-drawer__empty">
                  아직 만든 시나리오가 없어요.<br />
                  <span>새 시나리오를 만들어 설문→계획 흐름을 구성해보세요.</span>
                </div>
              )}
              {api.scenarios.map((s) => (
                <div key={s.id} className="sb-scenario-row">
                  <div className="sb-scenario-row__info">
                    <span className={'sb-status ' + (s.status === 'published' ? 'sb-status--live' : '')}>
                      {s.status === 'published' ? '발행됨' : '작성 중'}
                    </span>
                    <p className="sb-scenario-row__title">{s.title}</p>
                    <p className="sb-scenario-row__chip" style={{ color: s.color || '#5f7465' }}>#{s.chip}</p>
                  </div>
                  <div className="sb-scenario-row__actions">
                    <button type="button" onClick={() => api.playScenario(s.id)}>시험</button>
                    <button type="button" onClick={() => api.openBuilder(s.id)}>편집</button>
                    <button type="button" onClick={() => api.copyScenario(s.id)}>복제</button>
                    <button
                      type="button"
                      className="sb-danger"
                      onClick={() => {
                        if (window.confirm(`"${s.title}" 시나리오를 삭제할까요?`)) api.removeScenario(s.id)
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  )
}
