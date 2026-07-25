import React, { useRef, useState } from 'react'
import { BgBlobs, FloatingBar, StudioFab, ViewerDeviceControl, ProfileControl } from './Frame.jsx'
import ExploreFrame from './ExploreFrame.jsx'
import ThreadPanel from './ThreadPanel.jsx'
import { TEMPLATES } from '../lib/templates.js'
import { hexToRgba, DEVICE_PRESETS, sortByPosition } from '../lib/store.js'
import { renderItem } from '../lib/registry.jsx'
import { isLikelyAnthropicKey, loadLlmApiKey, saveLlmApiKey } from '../lib/llmClient.js'

export default function HomeView({ api }) {
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [llmApiKey, setLlmApiKey] = useState(loadLlmApiKey)
  const [llmKeyVisible, setLlmKeyVisible] = useState(false)

  const updateLlmApiKey = (value) => {
    setLlmApiKey(value)
    saveLlmApiKey(value) // localStorage에만 저장 — 자동 생성 등 LLM 기능이 공유
  }
  const [threadOrigin, setThreadOrigin] = useState(null) // null=닫힘 | 'left'|'center'|'right'
  const [draggingChipId, setDraggingChipId] = useState(null)
  const [scenarioFilter, setScenarioFilter] = useState('')
  const importInputRef = useRef(null)
  const backupImportInputRef = useRef(null)
  const chipDragRef = useRef(null) // { id, startX, startY, moved }
  const published = api.scenarios.filter((s) => s.status === 'published')
  const filteredScenarios = api.scenarios.filter((scenario) => {
    const needle = scenarioFilter.trim().toLowerCase().replace(/[\s_·/]+/g, '')
    if (!needle) return true
    return [scenario.title, scenario.chip, ...Object.values(scenario.sourceAnswers || {})]
      .some((value) => String(value || '').toLowerCase().replace(/[\s_·/]+/g, '').includes(needle))
  })

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

  const downloadJson = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportDataBackup = () => {
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(api.exportDataBackup(), `ddak-studio-backup-${date}.json`)
    api.showToast(`전체 데이터를 백업했어요. (프로필 ${api.accounts.length}개)`)
  }

  const handleBackupImportFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result)
        if (!window.confirm('현재 브라우저의 모든 프로필·탐색·시나리오·쓰레드와 공통 설정을 백업 파일로 교체할까요?')) return
        if (api.importDataBackup(payload)) setDrawerOpen(false)
      } catch (err) {
        api.showToast('전체 복원 실패: JSON 형식을 확인해주세요.')
      }
    }
    reader.onerror = () => api.showToast('전체 복원 실패: 파일을 읽을 수 없어요.')
    reader.readAsText(file)
    e.target.value = ''
  }

  /* 발행 칩 목록 — 탐색 아이템의 "발행 칩 목록" 컴포넌트 자리에 렌더된다 */
  const chips = published.map((s) => {
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
  })

  /* 탐색 아이템(캔버스 배치) — 숨김·컨테이너 자식 제외한 최상위만, 위→아래 순서로 스택 */
  const allExploreItems = api.explore.items || []
  const exploreItems = sortByPosition(allExploreItems).filter((it) => !it.hidden && !it.parentId)

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

  /* 탐색 아이템에 공급하는 실행 컨텍스트 — 검색/칩/키워드만 실제 동작, 나머지는 목업 */
  const homePlayer = {
    query,
    setQuery,
    submitQuery: submit,
    answers: {},
    setAnswer: () => {},
    addToCart: () => {},
    complete: () => {},
    openExternal: (label) => api.showToast(`${label}(으)로 이동하는 목업이에요.`),
    showKeyword: (word) => {
      const hit = (api.keywords || []).find((k) => k.word === word)
      api.showToast(hit && hit.desc ? `${word} — ${hit.desc}` : `"${word}" 설명은 키워드 사전에서 채울 수 있어요.`)
    },
    excludedProfile: [],
    toggleProfileItem: () => {},
    summary: { profile: [], questions: [] },
  }

  return (
    <>
      <BgBlobs />
      <FloatingBar
        active="home"
        onHome={() => { setDrawerOpen(false); setThreadOrigin(null) }}
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={(origin) => setThreadOrigin((v) => (v ? null : origin || 'right'))}
      />
      <StudioFab onClick={() => setDrawerOpen(true)} />
      <div className="sb-topleft">
        <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />
        <ProfileControl api={api} />
      </div>

      <section className="clean-home min-h-screen relative z-10">
        <div
          className="sb-phone"
          style={{ width: (DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS[0]).w }}
        >
        {exploreItems.length > 0 ? (
          /* 탐색 페이지 = 캔버스 아이템 스택 (빌더 탐색 탭에서 자유 배치·편집) */
          <div className="sb-player__stack sb-home-stack">
            {exploreItems.map((it) => (
              <div
                key={it.id}
                className="sb-player__item"
                style={{ maxWidth: it.w, height: it.h || undefined, overflow: it.h ? 'hidden' : undefined }}
              >
                {renderItem(it, { mode: 'player', player: homePlayer, profile: api.profile, chips, allItems: allExploreItems })}
              </div>
            ))}
          </div>
        ) : (
          /* 안전망: 아이템이 없으면 구버전 설정 기반 렌더 */
          <ExploreFrame
            config={api.explore}
            searchValue={query}
            onSearchChange={setQuery}
            onSubmit={submit}
            chips={chips}
          />
        )}
        </div>
      </section>

      {/* 쇼핑 쓰레드 히스토리 패널 — 햄버거 버튼 위치에서 등장 */}
      <ThreadPanel api={api} open={!!threadOrigin} origin={threadOrigin || 'right'} onClose={() => setThreadOrigin(null)} />

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
              <span className="sb-explore-btn__icon">🪪</span>
              <span className="sb-explore-btn__text">
                <strong>프로필 · 키워드 사전</strong>
                <small>고정 설문 정보와 밑줄 키워드 설명 (탐색 페이지는 빌더의 "탐색" 탭)</small>
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

            <p className="sb-panel-label sb-panel-label--count">
              <span>현재 프로필의 시나리오</span>
              <b>{api.scenarios.length}개</b>
            </p>
            {api.scenarios.length > 0 && (
              <input
                type="search"
                className="sb-scenario-filter"
                placeholder="제목·칩·답변으로 검색"
                value={scenarioFilter}
                onChange={(event) => setScenarioFilter(event.target.value)}
              />
            )}
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

            <p className="sb-panel-label">전체 데이터 백업</p>
            <p className="sb-drawer__backup-hint">모든 프로필·탐색 화면·시나리오·쓰레드·키워드·기기 설정을 포함합니다.</p>
            <div className="sb-drawer__tools sb-drawer__tools--backup">
              <button type="button" onClick={exportDataBackup}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>
                전체 백업
              </button>
              <button type="button" onClick={() => backupImportInputRef.current && backupImportInputRef.current.click()}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" /></svg>
                전체 복원
              </button>
              <input ref={backupImportInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleBackupImportFile} />
            </div>

            <p className="sb-panel-label">LLM 연결</p>
            <p className="sb-drawer__backup-hint">
              계획 케이스 자동 생성 등 LLM 기능에 쓸 내 Anthropic API 키.
              이 브라우저(localStorage)에만 저장되고 Anthropic API로 직접 전송됩니다.
            </p>
            <div className="sb-llm-key">
              <input
                type={llmKeyVisible ? 'text' : 'password'}
                value={llmApiKey}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Anthropic API 키"
                onChange={(event) => updateLlmApiKey(event.target.value)}
              />
              <button
                type="button"
                onClick={() => setLlmKeyVisible((visible) => !visible)}
                aria-label={llmKeyVisible ? 'API 키 가리기' : 'API 키 보기'}
              >
                {llmKeyVisible ? '가리기' : '보기'}
              </button>
            </div>
            <p
              className={
                'sb-llm-key__state'
                + (llmApiKey.trim()
                  ? (isLikelyAnthropicKey(llmApiKey) ? ' sb-llm-key__state--ok' : ' sb-llm-key__state--warn')
                  : '')
              }
            >
              {llmApiKey.trim()
                ? (isLikelyAnthropicKey(llmApiKey)
                  ? '✓ 키 저장됨 — 빌더의 "✦ 자동 생성"에서 바로 사용됩니다.'
                  : 'Anthropic API 키는 보통 sk-ant-로 시작해요. 키를 다시 확인해주세요.')
                : '키가 없으면 서버 프록시(운영자 키) 또는 수동 모드로 동작합니다. 비우면 저장된 키도 삭제됩니다.'}
            </p>

            <div className="sb-drawer__list">
              {api.scenarios.length === 0 && (
                <div className="sb-drawer__empty">
                  아직 만든 시나리오가 없어요.<br />
                  <span>새 시나리오를 만들어 설문→계획 흐름을 구성해보세요.</span>
                </div>
              )}
              {api.scenarios.length > 0 && filteredScenarios.length === 0 && (
                <div className="sb-drawer__empty">
                  검색 결과가 없어요.<br />
                  <span>예: 모공부각, 뽀송, 야외</span>
                </div>
              )}
              {filteredScenarios.map((s) => (
                <div key={s.id} className="sb-scenario-row">
                  <div className="sb-scenario-row__info">
                    <span className={'sb-status ' + (s.status === 'published' ? 'sb-status--live' : '')}>
                      {s.status === 'published' ? '발행됨' : '작성 중'}
                    </span>
                    {api.isDefaultScenario(s) && <span className="sb-status sb-status--default">기본</span>}
                    <p className="sb-scenario-row__title">{s.title}</p>
                    <p className="sb-scenario-row__chip" style={{ color: s.color || '#5f7465' }}>#{s.chip}</p>
                  </div>
                  <div className="sb-scenario-row__actions">
                    <button type="button" onClick={() => api.playScenario(s.id)}>시험</button>
                    <button type="button" onClick={() => api.openBuilder(s.id)}>편집</button>
                    <button type="button" onClick={() => api.copyScenario(s.id)}>복제</button>
                    {api.isDefaultScenario(s) ? (
                      <button type="button" className="sb-default-lock" disabled title="기본 시나리오는 삭제할 수 없어요.">
                        🔒 기본
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="sb-danger"
                        onClick={() => {
                          if (window.confirm(`"${s.title}" 시나리오를 삭제할까요?`)) api.removeScenario(s.id)
                        }}
                      >
                        삭제
                      </button>
                    )}
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
