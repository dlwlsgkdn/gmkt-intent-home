import React, { useEffect, useMemo, useState } from 'react'
import { fetchAdminChanges, fetchAdminPrompts, putAdminPrompt } from '../lib/adminApi.js'

const AREA = {
  prompt: { label: 'AI 지시서', icon: '⌘' },
  model: { label: '모델', icon: '◉' },
  engine: { label: '생성 엔진', icon: '⌁' },
  knowledge: { label: '트렌드 사전', icon: '◇' },
  scenario: { label: '시나리오 발행', icon: '▣' },
}

const formatAt = (at) => {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

const valueLabel = (value) => {
  if (value === null) return '기본값 또는 비어 있음'
  const first = value.split('\n').find((line) => line.trim())?.trim() || ''
  return value.includes('\n') || value.length > 90
    ? `${first.slice(0, 90)}${first.length > 90 ? '…' : ''} · ${value.length.toLocaleString('ko-KR')}자`
    : value
}

export default function AdminChangeLog({ api, onOpenScenario }) {
  const [wire, setWire] = useState(null)
  const [prompts, setPrompts] = useState([])
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [changes, promptWire] = await Promise.all([fetchAdminChanges(), fetchAdminPrompts()])
      setWire(changes)
      setPrompts(promptWire.prompts || [])
    } catch (e) {
      setError(e.message || '변경 로그를 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const currentPromptValues = useMemo(
    () => new Map(prompts.map((prompt) => [prompt.id, prompt.configured])),
    [prompts],
  )
  const allItems = useMemo(() => {
    const published = (api.scenarios || []).flatMap((scenario) =>
      (scenario.versions || []).map((version, index) => {
        const surveyCount = (version.stages?.survey || []).length
        const planCount = (version.planCases || []).length
        return {
          id: `scenario-${scenario.id}-${version.at || index}`,
          at: version.at,
          area: 'scenario',
          action: 'update',
          targetId: scenario.id,
          targetLabel: scenario.title || '제목 없는 시나리오',
          summary: `발행 v${index + 1} · 설문 ${surveyCount}개 · 계획 ${planCount}케이스`,
          before: null,
          after: `발행 스냅샷 · 설문 ${surveyCount}개 · 계획 ${planCount}케이스`,
          restorable: false,
        }
      }),
    )
    return [...(wire?.items || []), ...published]
      .filter((item) => item.at)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [wire, api.scenarios])
  const items = useMemo(
    () => allItems.filter((item) => filter === 'all' || item.area === filter),
    [allItems, filter],
  )
  const currentRevisionIds = useMemo(() => {
    const ids = new Set()
    const found = new Set()
    for (const item of allItems) {
      if (item.area !== 'prompt' || found.has(item.targetId)) continue
      if (currentPromptValues.get(item.targetId) === item.after) {
        ids.add(item.id)
        found.add(item.targetId)
      }
    }
    return ids
  }, [allItems, currentPromptValues])
  const todayCount = useMemo(() => {
    const today = new Date().toDateString()
    return allItems.filter((item) => new Date(item.at).toDateString() === today).length
  }, [allItems])

  const restore = async (item) => {
    if (item.area !== 'prompt' || !item.restorable) return
    if (!window.confirm(`“${item.targetLabel}”을 이 버전으로 복구할까요?\n복구 작업도 새 로그로 남습니다.`)) return
    setLoading(true)
    try {
      await putAdminPrompt(item.targetId, item.after, `“${item.summary}” 버전으로 복구`)
      setSelected(null)
      api.showToast('선택한 지시서 버전으로 복구했어요. 복구 기록도 남겼습니다.')
      await load()
    } catch (e) {
      api.showToast(e.message || '이 버전으로 복구하지 못했어요.')
      setLoading(false)
    }
  }

  return (
    <div className="sb-admin-changes-page">
      <header className="sb-admin-pagehead">
        <div>
          <p className="sb-admin-pagehead__eyebrow">내가 무엇을 바꿨는지 기억하는 곳</p>
          <h1>변경 로그</h1>
          <p>운영 설정 변경과 시나리오 발행을 한곳에 모읍니다. AI 지시서는 이전 원문을 보고 바로 복구할 수 있어요.</p>
        </div>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" disabled={loading} onClick={load}>
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </header>

      <section className="sb-admin-change-summary" aria-label="변경 기록 요약">
        <div><span>전체 기록</span><b>{allItems.length}</b><small>설정 최근 100개 + 발행 버전</small></div>
        <div><span>오늘 바꾼 것</span><b>{todayCount}</b><small>자동 기록</small></div>
        <div><span>복구 가능한 버전</span><b>{allItems.filter((item) => item.restorable).length}</b><small>AI 지시서</small></div>
      </section>

      <div className="sb-admin-change-toolbar">
        <div className="sb-admin-fb-seg" role="group" aria-label="변경 영역 필터">
          {[
            ['all', '전체'],
            ['prompt', 'AI 지시서'],
            ['model', '모델'],
            ['engine', '생성 엔진'],
            ['knowledge', '트렌드 사전'],
            ['scenario', '시나리오 발행'],
          ].map(([value, label]) => (
            <button key={value} type="button" className={'sb-admin-fb-seg__btn' + (filter === value ? ' is-on' : '')} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        {wire?.truncated && <span className="sb-admin__muted">오래된 기록 일부는 숨겨졌어요.</span>}
      </div>

      {error && <div className="sb-admin-card"><p className="sb-admin-gate__error">{error}</p><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={load}>다시 시도</button></div>}
      {!wire && !error && <div className="sb-admin-card"><p className="sb-admin__muted">변경 기록을 불러오는 중…</p></div>}
      {wire && (
        <ol className="sb-admin-change-list">
          {items.map((item) => {
            const area = AREA[item.area] || AREA.prompt
            const isCurrent = currentRevisionIds.has(item.id)
            return (
              <li key={item.id} className={`is-${item.area}`}>
                <span className="sb-admin-change-list__icon" aria-hidden="true">{area.icon}</span>
                <div className="sb-admin-change-list__copy">
                  <div><span>{area.label}</span>{isCurrent && <em>현재 사용 중</em>}</div>
                  <h2>{item.targetLabel}</h2>
                  <p>{item.summary}</p>
                  <small>{formatAt(item.at)}</small>
                </div>
                <div className="sb-admin-change-list__value">
                  <span>{item.after === null ? '기본값' : '변경 후'}</span>
                  <p>{valueLabel(item.after)}</p>
                </div>
                <div className="sb-admin-change-list__actions">
                  <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => setSelected(item)}>내용 보기</button>
                  {item.restorable && !isCurrent && (
                    <button type="button" className="sb-btn sb-btn--primary sb-btn--tiny" disabled={loading} onClick={() => restore(item)}>이 버전 복구</button>
                  )}
                  {item.area === 'scenario' && (
                    <button type="button" className="sb-btn sb-btn--primary sb-btn--tiny" onClick={() => onOpenScenario?.(item.targetId)}>시나리오 열기</button>
                  )}
                </div>
              </li>
            )
          })}
          {items.length === 0 && <li className="sb-admin-change-list__empty">이 영역의 변경 기록이 아직 없어요.</li>}
        </ol>
      )}

      {selected && (
        <div className="sb-llm-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null) }}>
          <section className="sb-llm-dialog sb-admin-dialog sb-admin-change-dialog" role="dialog" aria-modal="true" aria-label="변경 내용">
            <div className="sb-admin-dialog__head">
              <div><h2>{selected.targetLabel}</h2><p className="sb-admin__muted">{selected.summary} · {formatAt(selected.at)}</p></div>
              <button type="button" className="sb-icon-btn" aria-label="닫기" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="sb-admin-change-dialog__body">
              {selected.before !== null && (
                <details>
                  <summary>바꾸기 전 내용</summary>
                  <pre>{selected.before}</pre>
                </details>
              )}
              <section>
                <b>{selected.after === null ? '이 버전은 기본값을 사용합니다' : '이 버전에 저장된 내용'}</b>
                {selected.after !== null && <pre>{selected.after}</pre>}
              </section>
            </div>
            <div className="sb-json-dialog__actions">
              <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setSelected(null)}>닫기</button>
              {selected.restorable && currentPromptValues.get(selected.targetId) !== selected.after && (
                <button type="button" className="sb-btn sb-btn--primary" disabled={loading} onClick={() => restore(selected)}>이 버전으로 복구</button>
              )}
              {selected.area === 'scenario' && (
                <button type="button" className="sb-btn sb-btn--primary" onClick={() => onOpenScenario?.(selected.targetId)}>시나리오 열기</button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
