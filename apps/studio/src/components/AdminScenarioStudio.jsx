import React, { useMemo, useRef, useState } from 'react'
import { TEMPLATES } from '../lib/templates.js'
import { classifyImportPayload, createScenariosExport } from '../lib/store.js'
import { scenariosFromImport } from '../lib/scenarioOps.js'
import { downloadJson, readFileText } from '../lib/jsonFile.js'
import ScenarioGenerationDialog from './builder/ScenarioGenerationDialog.jsx'
import StarterPanel from './StarterPanel.jsx'

export default function AdminScenarioStudio({ api, onEdit, onOpenProfileEditor, onOpenTagging, onOpenDashboard }) {
  const [query, setQuery] = useState('')
  const [scenarioGenOpen, setScenarioGenOpen] = useState(false)
  const [starterPanelOpen, setStarterPanelOpen] = useState(false)
  const [jsonDialog, setJsonDialog] = useState(null)
  const importInputRef = useRef(null)
  const needle = query.trim().toLowerCase().replace(/[\s_·/]+/g, '')
  const scenarios = useMemo(() => api.scenarios.filter((scenario) => {
    if (!needle) return true
    return [scenario.title, scenario.chip, ...Object.values(scenario.sourceAnswers || {})]
      .some((value) => String(value || '').toLowerCase().replace(/[\s_·/]+/g, '').includes(needle))
  }), [api.scenarios, needle])
  const publishedCount = api.scenarios.filter((scenario) => scenario.status === 'published').length
  const today = () => new Date().toISOString().slice(0, 10)

  const addProfile = async () => {
    const name = window.prompt('새 프로필 이름을 입력하세요', '')
    if (name == null) return
    onEdit(null)
    await api.addAccount(name, { keepRoute: true })
  }

  const removeActiveProfile = () => {
    if (api.accounts.length <= 1) {
      api.showToast('마지막 프로필은 삭제할 수 없어요.')
      return
    }
    if (!window.confirm(`“${api.profile?.name || '현재'}” 프로필과 그 시나리오·탐색 페이지를 삭제할까요?`)) return
    onEdit(null)
    api.removeAccount(api.activeAccountId, { keepRoute: true })
  }

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

  const handleJsonFile = (event) => {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    readFileText(file).then((text) => {
      try {
        const detected = classifyImportPayload(JSON.parse(text))
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
      } catch {
        api.showToast('가져오기 실패: JSON 형식을 확인해주세요.')
      }
    }, () => api.showToast('가져오기 실패: 파일을 읽을 수 없어요.'))
    event.target.value = ''
  }

  const confirmAddScenarios = () => {
    api.importScenarios(jsonDialog.list)
    setJsonDialog(null)
  }

  const confirmRestore = () => {
    const ok = api.importDataBackup(jsonDialog.payload, { keepRoute: true })
    setJsonDialog(null)
    if (ok) onEdit(null)
  }

  return (
    <section className="sb-admin-studio">
      <header className="sb-admin-pagehead sb-admin-studio__head">
        <div>
          <p className="sb-admin-pagehead__eyebrow">콘텐츠 제작</p>
          <h1>시나리오 스튜디오</h1>
          <p className="sb-admin__muted">탐색 → 설문 → 계획 → 평가 화면을 만들고 시험한 뒤 발행해요.</p>
        </div>
        <button type="button" className="sb-btn sb-btn--ai" onClick={() => setScenarioGenOpen(true)}>
          ⇄ AI 프롬프트로 초안 만들기
        </button>
      </header>

      <section className="sb-admin-card sb-admin-studio__accounts" aria-labelledby="sb-admin-studio-account-title">
        <div className="sb-admin-card__head">
          <div>
            <h2 id="sb-admin-studio-account-title">프로필별 작업 공간</h2>
            <p>유진·둥둥이처럼 프로필마다 시나리오가 따로 있어요. 이름을 누르면 해당 목록으로 바뀝니다.</p>
          </div>
          <span className="sb-admin-studio__account-count">전체 {api.accounts.length}명</span>
        </div>
        <div className="sb-admin-studio__account-tabs">
          {api.accounts.map((account) => {
            const active = account.id === api.activeAccountId
            return (
              <button
                key={account.id}
                type="button"
                className={active ? 'is-on' : ''}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  onEdit(null)
                  api.switchAccount(account.id, { keepRoute: true })
                }}
              >
                <span>{String(account.profile?.name || '사용자').slice(0, 1)}</span>
                <b>{account.profile?.name || '이름 없음'}</b>
                <small>시나리오 {account.scenarios?.length || 0}개</small>
              </button>
            )
          })}
        </div>
        <div className="sb-admin-studio__account-actions">
          <button type="button" className="sb-btn sb-btn--small" onClick={addProfile}>+ 프로필 추가</button>
          <button type="button" className="sb-btn sb-btn--small" onClick={onOpenProfileEditor}>현재 프로필·키워드 편집</button>
          <button
            type="button"
            className="sb-btn sb-btn--danger sb-btn--small"
            disabled={api.accounts.length <= 1}
            onClick={removeActiveProfile}
          >
            현재 프로필 삭제
          </button>
        </div>
      </section>

      <div className="sb-admin-studio__summary" aria-label="시나리오 현황">
        <div><b>{api.scenarios.length}</b><span>전체 시나리오</span></div>
        <div><b>{publishedCount}</b><span>발행됨</span></div>
        <div><b>{api.scenarios.length - publishedCount}</b><span>작성 중</span></div>
      </div>

      <section className="sb-admin-card sb-admin-studio__templates">
        <div className="sb-admin-card__head">
          <div><h2>새 시나리오</h2><p>템플릿을 고르면 바로 어드민 안 편집기로 들어갑니다.</p></div>
        </div>
        <div className="sb-admin-studio__template-grid">
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => {
                const scenario = api.newAdminScenario(template)
                onEdit(scenario.id)
              }}
            >
              <span>{template.icon}</span>
              <b>{template.name}</b>
              <small>{template.desc}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="sb-admin-card sb-admin-studio__list-card">
        <div className="sb-admin-card__head sb-admin-studio__list-head">
          <div><h2>시나리오 목록</h2><p>편집을 누르면 운영 센터 안에서 전체 스튜디오가 열립니다.</p></div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="제목·칩으로 검색"
            aria-label="시나리오 검색"
          />
        </div>

        <div className="sb-admin-studio__list">
          {api.scenarios.length === 0 && (
            <div className="sb-admin-studio__empty">아직 시나리오가 없어요. 위 템플릿으로 첫 시나리오를 만들어보세요.</div>
          )}
          {api.scenarios.length > 0 && scenarios.length === 0 && (
            <div className="sb-admin-studio__empty">검색 결과가 없어요.</div>
          )}
          {scenarios.map((scenario) => (
            <article key={scenario.id} className="sb-admin-studio__row">
              <div className="sb-admin-studio__row-main">
                <span className={'sb-status ' + (scenario.status === 'published' ? 'sb-status--live' : '')}>
                  {scenario.status === 'published' ? '발행됨' : '작성 중'}
                </span>
                {api.isStarterSource(scenario) && (
                  <span className="sb-status sb-status--default" title="이 시나리오로 기본 시나리오를 만들었어요.">기본 원천</span>
                )}
                <div>
                  <h3>{scenario.title || '제목 없는 시나리오'}</h3>
                  <p style={{ color: scenario.color || 'var(--sb-accent)' }}>#{scenario.chip || '칩_없음'}</p>
                </div>
              </div>
              <div className="sb-admin-studio__row-actions">
                <button
                  type="button"
                  className="sb-btn sb-btn--primary sb-btn--small"
                  onClick={() => api.openAdminBuilder(scenario.id, onEdit)}
                >
                  편집
                </button>
                <button type="button" className="sb-btn sb-btn--small" onClick={() => api.playScenario(scenario.id)}>시험</button>
                <button type="button" className="sb-btn sb-btn--small" onClick={() => api.copyScenario(scenario.id)}>복제</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--small"
                  title={api.isStarterSource(scenario)
                    ? '지금 내용으로 기본 시나리오를 다시 만들어요.'
                    : '지금 내용을 복사해 기본 시나리오에 올려요.'}
                  onClick={() => api.markStarterScenario(scenario.id)}
                >
                  {api.isStarterSource(scenario) ? '기본 갱신' : '기본 지정'}
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--danger sb-btn--small"
                  onClick={() => {
                    if (window.confirm(`“${scenario.title}” 시나리오를 삭제할까요?`)) api.removeScenario(scenario.id)
                  }}
                >
                  삭제
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="sb-admin-card sb-admin-studio__tools">
        <div className="sb-admin-card__head">
          <div><h2>스튜디오 관리 도구</h2><p>기존 스튜디오에 있던 관리 기능을 같은 데이터로 사용합니다.</p></div>
        </div>
        <div className="sb-admin-studio__tool-grid">
          <button type="button" onClick={onOpenProfileEditor}>
            <span>🪪</span><b>프로필 · 키워드 사전</b><small>고정 설문 정보와 밑줄 키워드 설명</small>
          </button>
          <button type="button" onClick={() => setStarterPanelOpen(true)}>
            <span>⭐</span><b>기본 시나리오</b><small>모든 프로필 공통 · {api.starterEntries.length}개</small>
          </button>
          <button type="button" onClick={onOpenTagging}>
            <span>🏷️</span><b>상품 태깅 검토</b><small>AI 상품 선택 근거 검수</small>
          </button>
          <button type="button" onClick={onOpenDashboard}>
            <span>🧵</span><b>운영 대시보드</b><small>고객 여정·파이프라인·실험 관리</small>
          </button>
          <button type="button" onClick={() => setJsonDialog({ mode: 'export' })}>
            <span>↓</span><b>JSON 내보내기</b><small>시나리오 목록 또는 전체 백업</small>
          </button>
          <button type="button" onClick={() => importInputRef.current && importInputRef.current.click()}>
            <span>↑</span><b>JSON 가져오기</b><small>목록 추가 또는 전체 복원</small>
          </button>
          <input ref={importInputRef} type="file" accept=".json,application/json" hidden onChange={handleJsonFile} />
        </div>
      </section>

      {starterPanelOpen && (
        <StarterPanel
          entries={api.starterEntries}
          onRemove={api.removeStarterEntry}
          onClose={() => setStarterPanelOpen(false)}
        />
      )}

      {scenarioGenOpen && (
        <ScenarioGenerationDialog
          profile={api.profile}
          onCreate={(partial) => {
            const scenario = api.newAdminScenarioFrom(partial)
            onEdit(scenario.id)
          }}
          onImport={(list) => {
            api.importScenarios(list)
            api.showToast('시나리오를 가져왔어요. 목록에서 편집을 눌러주세요.')
          }}
          onClose={() => setScenarioGenOpen(false)}
          onToast={api.showToast}
        />
      )}

      {jsonDialog && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setJsonDialog(null)
          }}
        >
          <section className="sb-llm-dialog sb-json-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-admin-json-title">
            <div className="sb-json-dialog__body">
              <div className="sb-json-dialog__head">
                <h2 id="sb-admin-json-title" className="sb-json-dialog__title">
                  {jsonDialog.mode === 'export' ? 'JSON 내보내기' : jsonDialog.mode === 'add' ? '시나리오 가져오기' : '전체 복원'}
                </h2>
                <button type="button" className="sb-icon-btn" onClick={() => setJsonDialog(null)} aria-label="닫기">×</button>
              </div>

              {jsonDialog.mode === 'export' && (
                <div className="sb-json-dialog__options">
                  <button type="button" className="sb-json-option" onClick={exportScenarioList}>
                    <strong>시나리오 목록</strong>
                    <small>현재 프로필의 시나리오 {api.scenarios.length}개를 다른 프로필·브라우저에 추가할 수 있어요.</small>
                  </button>
                  <button type="button" className="sb-json-option" onClick={exportWorkspaceBackup}>
                    <strong>전체 백업</strong>
                    <small>프로필 {api.accounts.length}개 전체 + 탐색 화면·쓰레드·키워드·기기 설정을 저장해요.</small>
                  </button>
                </div>
              )}

              {jsonDialog.mode === 'add' && (
                <>
                  <p className="sb-json-dialog__note">
                    「{jsonDialog.fileName}」에서 시나리오 {jsonDialog.count}개를 찾았어요.
                    “{api.profile?.name || '사용자'}” 프로필에 추가할까요? 기존 시나리오는 그대로 둡니다.
                  </p>
                  <div className="sb-json-dialog__actions">
                    <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setJsonDialog(null)}>취소</button>
                    <button type="button" className="sb-btn sb-btn--primary" onClick={confirmAddScenarios}>{jsonDialog.count}개 추가</button>
                  </div>
                </>
              )}

              {jsonDialog.mode === 'restore' && (
                <>
                  <p className="sb-json-dialog__note">
                    「{jsonDialog.fileName}」은 전체 백업 파일이에요{jsonDialog.meta ? ` (${jsonDialog.meta})` : ''}.
                  </p>
                  <p className="sb-json-dialog__note sb-json-dialog__note--danger">
                    복원하면 현재의 모든 프로필·탐색·시나리오·쓰레드·키워드·기기 설정이 이 파일 내용으로 교체돼요.
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
    </section>
  )
}
