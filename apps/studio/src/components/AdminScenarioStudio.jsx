import React, { useMemo, useState } from 'react'
import { TEMPLATES } from '../lib/templates.js'
import ScenarioGenerationDialog from './builder/ScenarioGenerationDialog.jsx'

export default function AdminScenarioStudio({ api, onEdit }) {
  const [query, setQuery] = useState('')
  const [scenarioGenOpen, setScenarioGenOpen] = useState(false)
  const needle = query.trim().toLowerCase().replace(/[\s_·/]+/g, '')
  const scenarios = useMemo(() => api.scenarios.filter((scenario) => {
    if (!needle) return true
    return [scenario.title, scenario.chip, ...Object.values(scenario.sourceAnswers || {})]
      .some((value) => String(value || '').toLowerCase().replace(/[\s_·/]+/g, '').includes(needle))
  }), [api.scenarios, needle])
  const publishedCount = api.scenarios.filter((scenario) => scenario.status === 'published').length

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
    </section>
  )
}
