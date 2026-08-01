import React, { useRef, useState } from 'react'
import { BgBlobs, FloatingBar, StudioFab, ViewerDeviceControl, ProfileControl } from './Frame.jsx'
import ExploreFrame from './ExploreFrame.jsx'
import ThreadPanel from './ThreadPanel.jsx'
import { TEMPLATES } from '../lib/templates.js'
import { classifyImportPayload, createScenariosExport, hexToRgba, DEVICE_PRESETS, sortByPosition } from '../lib/store.js'
import { scenariosFromImport } from '../lib/scenarioOps.js'
import { renderItem } from '../lib/registry.jsx'
import ScenarioGenerationDialog from './builder/ScenarioGenerationDialog.jsx'

export default function HomeView({ api }) {
  const [query, setQuery] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [scenarioGenOpen, setScenarioGenOpen] = useState(false)
  const [threadOrigin, setThreadOrigin] = useState(null) // null=닫힘 | 'left'|'center'|'right'
  const [draggingChipId, setDraggingChipId] = useState(null)
  const [scenarioFilter, setScenarioFilter] = useState('')
  const importInputRef = useRef(null)
  // JSON 통합 입출력 다이얼로그: null | {mode:'export'} | {mode:'add', list, count, fileName} | {mode:'restore', payload, fileName, accountCount}
  const [jsonDialog, setJsonDialog] = useState(null)
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

  /* ── 드로어 JSON 통합 입출력 ──
     내보내기: 범위(시나리오 목록/전체 백업)를 다이얼로그에서 고른 뒤 공통 봉투로 저장.
     가져오기: 파일 형식을 자동 감지(classifyImportPayload)해 동작별 확인 다이얼로그
     (목록 추가 / 전체 교체)로 갈라진다 — 파일이 어느 버튼용인지 기억할 필요가 없다.
     빌더의 현재 시나리오 입출력은 별도 유지(현재 열린 시나리오에 덮는 컨텍스트 동작). */
  const downloadJson = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const today = () => new Date().toISOString().slice(0, 10)

  /* 내보내기는 지연 로드된 행을 서버와 마저 맞춘 뒤 만든다 — 부분 데이터 저장 방지.
     ensure 후에는 렌더 클로저(api.scenarios)가 낡을 수 있어 fresh 게터로 읽는다 */
  const exportScenarioList = async () => {
    if (api.scenarios.length === 0) {
      api.showToast('내보낼 시나리오가 없어요.')
      return
    }
    try {
      await api.ensureActiveSynced()
    } catch {
      api.showToast('서버에서 최신 내용을 불러오지 못해 이 기기에 저장된 내용으로 내보내요.')
    }
    const list = api.getFreshActiveScenarios()
    downloadJson(createScenariosExport(list), `ddak-scenarios-${today()}.json`)
    setJsonDialog(null)
    api.showToast(`시나리오 ${list.length}개를 JSON으로 내보냈어요.`)
  }

  const exportWorkspaceBackup = async () => {
    try {
      const backup = await api.exportDataBackup()
      downloadJson(backup, `ddak-studio-backup-${today()}.json`)
      setJsonDialog(null)
      api.showToast(`전체 데이터를 백업했어요. (프로필 ${api.accounts.length}개)`)
    } catch {
      api.showToast('서버에서 전체 데이터를 불러오지 못해 백업을 만들지 못했어요. 잠시 후 다시 시도해주세요.')
    }
  }

  const handleJsonFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const detected = classifyImportPayload(JSON.parse(reader.result))
        if (detected.kind === 'workspace') {
          const metaParts = []
          if (Array.isArray(detected.payload?.data?.accounts)) metaParts.push(`프로필 ${detected.payload.data.accounts.length}개`)
          if (detected.payload?.exportedAt) metaParts.push(`${String(detected.payload.exportedAt).slice(0, 10)} 내보냄`)
          setJsonDialog({ mode: 'restore', payload: detected.payload, fileName: file.name, meta: metaParts.join(' · ') })
        } else if (detected.kind === 'scenarios') {
          const cleaned = scenariosFromImport(detected.scenarios)
          if (!cleaned || cleaned.length === 0) {
            api.showToast('가져올 수 있는 시나리오가 없어요.')
            return
          }
          setJsonDialog({ mode: 'add', list: detected.scenarios, count: cleaned.length, fileName: file.name })
        } else {
          api.showToast('알아볼 수 없는 JSON이에요. DDAK에서 내보낸 파일인지 확인해주세요.')
        }
      } catch (err) {
        api.showToast('가져오기 실패: JSON 형식을 확인해주세요.')
      }
    }
    reader.onerror = () => api.showToast('가져오기 실패: 파일을 읽을 수 없어요.')
    reader.readAsText(file)
    e.target.value = ''
  }

  const confirmAddScenarios = () => {
    api.importScenarios(jsonDialog.list)
    setJsonDialog(null)
  }

  const confirmRestore = () => {
    const ok = api.importDataBackup(jsonDialog.payload)
    setJsonDialog(null)
    if (ok) setDrawerOpen(false)
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
              <h3>내 시나리오</h3>
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
            <button
              type="button"
              className="sb-template-card sb-template-card--ai"
              onClick={() => setScenarioGenOpen(true)}
            >
              <span className="sb-template-card__icon">⇄</span>
              <strong>AI로 시나리오 만들기</strong>
              <small>검색어·페르소나만 주면 <b>프롬프트</b>를 만들어 드려요 · 쓰던 AI에 붙여넣고 결과만 가져오면 완성</small>
            </button>
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
              <button type="button" onClick={() => setJsonDialog({ mode: 'export' })}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" /></svg>
                JSON 내보내기
              </button>
              <button type="button" onClick={() => importInputRef.current && importInputRef.current.click()}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M12 16V4m0 0L8 8m4-4l4 4M4 20h16" /></svg>
                JSON 가져오기
              </button>
              <input ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleJsonFile} />
            </div>

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
                    {api.isStarterSource(s) && <span className="sb-status sb-status--default" title="이 시나리오로 기본 시나리오를 만들었어요.">기본 원천</span>}
                    <p className="sb-scenario-row__title">{s.title}</p>
                    <p className="sb-scenario-row__chip" style={{ color: s.color || '#5f7465' }}>#{s.chip}</p>
                  </div>
                  <div className="sb-scenario-row__actions">
                    <button type="button" onClick={() => api.playScenario(s.id)}>시험</button>
                    <button type="button" onClick={() => api.openBuilder(s.id)}>편집</button>
                    <button type="button" onClick={() => api.copyScenario(s.id)}>복제</button>
                    <button
                      type="button"
                      title={api.isStarterSource(s)
                        ? '지금 내용으로 기본 시나리오를 다시 만들어요. (지정 후의 편집은 자동 반영되지 않아요)'
                        : '지금 내용을 복사해 기본 시나리오에 올려요. 새 프로필을 만들 때 가져올 수 있어요.'}
                      onClick={() => api.markStarterScenario(s.id)}
                    >
                      {api.isStarterSource(s) ? '기본 갱신' : '기본 지정'}
                    </button>
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

              {/* 기본 시나리오 라이브러리 — 워크스페이스 전역(모든 프로필 공통). 지정 시점
                  스냅샷이라 원본을 지워도 남고, 새 프로필 생성 때 확인 후 복사 설치된다 */}
              {api.starterEntries.length > 0 && (
                <>
                  <p className="sb-panel-label sb-panel-label--count sb-starter-label">
                    <span>기본 시나리오 (모든 프로필 공통)</span>
                    <b>{api.starterEntries.length}개</b>
                  </p>
                  {api.starterEntries.map((entry) => (
                    <div key={entry.id} className="sb-starter-row">
                      <div className="sb-starter-row__info">
                        <p className="sb-starter-row__title">{entry.title}</p>
                        <p className="sb-starter-row__meta">
                          <span style={{ color: entry.color || '#5f7465' }}>#{entry.chip}</span>
                          {' · '}{entry.sourceAccountName} 프로필에서 지정
                        </p>
                      </div>
                      <button
                        type="button"
                        className="sb-danger"
                        title="기본 시나리오 목록에서 내려요. 이미 만든 프로필에는 영향이 없어요."
                        onClick={() => {
                          if (window.confirm(`"${entry.title}"을(를) 기본 시나리오에서 내릴까요?`)) api.removeStarterEntry(entry.id)
                        }}
                      >
                        내리기
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </aside>
        </>
      )}

      {scenarioGenOpen && (
        <ScenarioGenerationDialog
          profile={api.profile}
          onCreate={(partial) => api.newScenarioFrom(partial)}
          onImport={(scenarios) => api.importScenarios(scenarios)}
          onClose={() => setScenarioGenOpen(false)}
          onToast={api.showToast}
        />
      )}

      {/* JSON 통합 입출력 — 내보내기는 범위 선택, 가져오기는 자동 감지 결과별 확인 */}
      {jsonDialog && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setJsonDialog(null)
          }}
        >
          <section className="sb-llm-dialog sb-json-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-json-title">
            <div className="sb-json-dialog__body">
              <div className="sb-json-dialog__head">
                <h2 id="sb-json-title" className="sb-json-dialog__title">
                  {jsonDialog.mode === 'export' ? 'JSON 내보내기' : jsonDialog.mode === 'add' ? '시나리오 가져오기' : '전체 복원'}
                </h2>
                <button type="button" className="sb-icon-btn" onClick={() => setJsonDialog(null)} aria-label="닫기">×</button>
              </div>

              {jsonDialog.mode === 'export' && (
                <div className="sb-json-dialog__options">
                  <button type="button" className="sb-json-option" onClick={exportScenarioList}>
                    <strong>시나리오 목록</strong>
                    <small>
                      현재 프로필의 시나리오 {api.scenarios.length}개.
                      다른 프로필·브라우저에서 "JSON 가져오기"로 추가할 수 있어요.
                    </small>
                  </button>
                  <button type="button" className="sb-json-option" onClick={exportWorkspaceBackup}>
                    <strong>전체 백업</strong>
                    <small>
                      프로필 {api.accounts.length}개 전체 + 탐색 화면·쓰레드·키워드·기기 설정.
                      복원하면 기존 데이터를 통째로 교체해요.
                    </small>
                  </button>
                </div>
              )}

              {jsonDialog.mode === 'add' && (
                <>
                  <p className="sb-json-dialog__note">
                    「{jsonDialog.fileName}」에서 시나리오 {jsonDialog.count}개를 찾았어요.
                    "{(api.profile && api.profile.name) || '사용자'}" 프로필에 추가할까요? 기존 시나리오는 그대로 둡니다.
                  </p>
                  <div className="sb-json-dialog__actions">
                    <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setJsonDialog(null)}>취소</button>
                    <button type="button" className="sb-btn sb-btn--primary" onClick={confirmAddScenarios}>
                      {jsonDialog.count}개 추가
                    </button>
                  </div>
                </>
              )}

              {jsonDialog.mode === 'restore' && (
                <>
                  <p className="sb-json-dialog__note">
                    「{jsonDialog.fileName}」은 전체 백업 파일이에요{jsonDialog.meta ? ` (${jsonDialog.meta})` : ''}.
                  </p>
                  <p className="sb-json-dialog__note sb-json-dialog__note--danger">
                    복원하면 현재 브라우저의 모든 프로필·탐색·시나리오·쓰레드·키워드·기기 설정이
                    이 파일 내용으로 교체돼요. 되돌릴 수 없어요.
                  </p>
                  <div className="sb-json-dialog__actions">
                    <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setJsonDialog(null)}>취소</button>
                    <button type="button" className="sb-btn sb-btn--danger" onClick={confirmRestore}>전체 교체</button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
