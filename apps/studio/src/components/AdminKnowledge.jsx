import React, { useEffect, useMemo, useState } from 'react'
import { fetchAdminPipeline, putAdminKnowledge } from '../lib/adminApi.js'
import {
  TREND_KEYWORDS,
  TREND_LEVEL_DEFS,
  TREND_LEVEL_OPTIONS,
  TREND_RELATED_OPTIONS,
} from '../lib/trendKeywords.js'

/*
 * 운영 지식 — 트렌드 키워드 사전 한 벌 (담당자 엑셀 이관본, lib/trendKeywords.js).
 * 시트처럼 바로 편집한다: 행 추가·키워드/설명/상품/입력자 인라인 입력, 구분·관련은 칩 팝오버.
 * 관련 배열 순서는 추천 연결 우선순위라 화면 번호와 위·아래 이동으로 그대로 관리한다.
 * 편집은 코드 원본 위 오버레이(패치·추가·삭제)로 이 기기(localStorage)에 저장된다 —
 * 전 기기 공통 반영은 JSON 내보내기 → 코드(trendKeywords.js) 반영으로.
 * 구 서브탭(키워드 사전·태그 사전·정답지)은 2026-08 정리 — 키워드 사전은 프로필·키워드
 * 편집기(ExploreEditor)가, 태그 사전은 상품 태깅 스튜디오가 계속 담당한다.
 */

const OVERLAY_KEY = 'ddak-trend-dict-overlay-v1'
const EMPTY_OVERLAY = { patches: {}, added: [], removed: [] }

const loadOverlay = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(OVERLAY_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      return {
        patches: saved.patches && typeof saved.patches === 'object' ? saved.patches : {},
        added: Array.isArray(saved.added) ? saved.added : [],
        removed: Array.isArray(saved.removed) ? saved.removed : [],
      }
    }
  } catch { /* 깨진 초안은 무시하고 원본으로 시작 */ }
  return EMPTY_OVERLAY
}

const saveOverlay = (overlay) => {
  try { localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay)) } catch { /* 저장 실패가 편집을 막지 않는다 */ }
}

export default function AdminKnowledge({ api }) {
  const [trendLevel, setTrendLevel] = useState('all')
  const [trendQuery, setTrendQuery] = useState('')
  const [overlay, setOverlay] = useState(loadOverlay)
  const [pop, setPop] = useState(null) // { key, field: 'levels' | 'related' } — 열린 칩 팝오버

  const commitOverlay = (next) => {
    setOverlay(next)
    saveOverlay(next)
  }

  /* 코드 원본 + 오버레이 병합 — key는 원본 행 인덱스(base-i)라 키워드를 고쳐도 안정적이다 */
  const allRows = useMemo(() => {
    const base = TREND_KEYWORDS.map((entry, index) => {
      const key = `base-${index}`
      return { key, src: 'base', ...entry, ...(overlay.patches[key] || {}) }
    }).filter((row) => !overlay.removed.includes(row.key))
    return [...overlay.added].reverse().map((row) => ({ ...row, src: 'added' })).concat(base)
  }, [overlay])

  const trendRows = useMemo(() => {
    const query = trendQuery.trim().toLowerCase()
    return allRows.filter((entry) => {
      if (trendLevel === 'none' && entry.levels.length > 0) return false
      if (trendLevel !== 'all' && trendLevel !== 'none' && !entry.levels.includes(trendLevel)) return false
      if (!query) return true
      return [entry.word, entry.desc, entry.brands || '', entry.author || '', entry.related.join(' ')].join(' ').toLowerCase().includes(query)
    })
  }, [allRows, trendLevel, trendQuery])

  const patchRow = (row, patch) => {
    if (row.src === 'added') {
      commitOverlay({
        ...overlay,
        added: overlay.added.map((item) => (item.key === row.key ? { ...item, ...patch } : item)),
      })
    } else {
      commitOverlay({
        ...overlay,
        patches: { ...overlay.patches, [row.key]: { ...(overlay.patches[row.key] || {}), ...patch } },
      })
    }
  }

  /* 칩 토글 — 켜면 목록 끝에 붙는다(시트의 "연관도 높은 순서" 수동 지정과 같은 문법) */
  const toggleChip = (row, field, value) => {
    const current = row[field]
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    patchRow(row, { [field]: next })
  }

  const moveRelated = (row, index, direction) => {
    const target = index + direction
    if (target < 0 || target >= row.related.length) return
    const next = [...row.related]
    ;[next[index], next[target]] = [next[target], next[index]]
    patchRow(row, { related: next })
  }

  const addRow = () => {
    const row = { key: `add-${Date.now()}`, no: null, author: '', word: '', levels: [], related: [], desc: '', brands: '' }
    commitOverlay({ ...overlay, added: [...overlay.added, row] })
    setTrendLevel('all')
    setTrendQuery('')
    setPop({ key: row.key, field: 'levels' })
    api.showToast('표 맨 위에 새 항목을 만들었어요. 각 칸을 바로 입력하세요.')
  }

  const removeRow = (row) => {
    if (row.src === 'added') {
      commitOverlay({ ...overlay, added: overlay.added.filter((item) => item.key !== row.key) })
    } else {
      commitOverlay({ ...overlay, removed: [...overlay.removed, row.key] })
    }
  }

  const revertRow = (row) => {
    const patches = { ...overlay.patches }
    delete patches[row.key]
    commitOverlay({ ...overlay, patches })
  }

  const draftCount = Object.keys(overlay.patches).length + overlay.added.length + overlay.removed.length

  const exportDraft = async () => {
    const rows = allRows.map(({ key, src, ...entry }) => entry)
    try {
      await navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
      api.showToast(`사전 ${rows.length}행 JSON을 복사했어요. 코드(trendKeywords.js) 반영을 요청하세요.`)
    } catch {
      api.showToast('클립보드 복사에 실패했어요.')
    }
  }

  /* 파이프라인 연동 — 생성이 실제로 읽는 트렌드 키워드는 core KV(knowledge-trend-keywords).
     여기서 사전의 필터 결과를 그 KV로 실어 원장 trendKeywords(설문·계획 가변부)에 반영한다 */
  const [pipeValue, setPipeValue] = useState(undefined) // undefined=로딩, null=연결 실패, string=현재 KV 원문
  const [pipeBusy, setPipeBusy] = useState(false)
  useEffect(() => {
    let alive = true
    fetchAdminPipeline()
      .then((wire) => {
        if (!alive) return
        const entry = (wire.knowledge || []).find((row) => row.id === 'trend-keywords')
        setPipeValue(String(entry?.value ?? ''))
      })
      .catch(() => { if (alive) setPipeValue(null) })
    return () => { alive = false }
  }, [])
  const loadedTrendWords = typeof pipeValue === 'string'
    ? pipeValue.split('\n').map((line) => line.trim()).filter(Boolean)
    : []
  const saveTrendToPipeline = async (value) => {
    setPipeBusy(true)
    try {
      const wire = await putAdminKnowledge('trend-keywords', value)
      const entry = (wire.knowledge || []).find((row) => row.id === 'trend-keywords')
      setPipeValue(String(entry?.value ?? ''))
      api.showToast(value == null ? '파이프라인 트렌드 키워드를 비웠어요.' : '트렌드 키워드를 파이프라인에 실었어요. 새 생성부터 반영됩니다.')
    } catch (e) {
      api.showToast(e.message || '파이프라인에 싣지 못했어요.')
    } finally {
      setPipeBusy(false)
    }
  }

  const chipCell = (row, field, options, emptyLabel) => (
    <div className="sb-admin-trend-cellwrap">
      <button
        type="button"
        className="sb-admin-trend-cellbtn"
        onClick={() => setPop(pop && pop.key === row.key && pop.field === field ? null : { key: row.key, field })}
        aria-label={`${row.word || '새 키워드'} ${field === 'levels' ? '구분' : '관련'} 편집`}
      >
        {row[field].length > 0
          ? row[field].map((value, index) => (
              <span key={value} className="sb-admin-trend-level">
                {field === 'related' && <b className="sb-admin-trend-rank">{index + 1}</b>}{value}
              </span>
            ))
          : <span className="sb-admin-trend-cellbtn__empty">{emptyLabel}</span>}
        <i aria-hidden="true">▾</i>
      </button>
      {pop && pop.key === row.key && pop.field === field && (
        <div className="sb-admin-trend-pop" role="group">
          {field === 'related' ? (
            <>
              <p className="sb-admin-trend-pop__note">위에 있을수록 추천 연결 우선순위가 높습니다.</p>
              {row.related.map((option, index) => (
                <div className="sb-admin-trend-priority" key={option}>
                  <button type="button" className="is-on" onClick={() => toggleChip(row, field, option)}>
                    <b>{index + 1}</b><span>{option}</span><em>제외</em>
                  </button>
                  <span>
                    <button type="button" disabled={index === 0} onClick={() => moveRelated(row, index, -1)} aria-label={`${option} 우선순위 올리기`}>↑</button>
                    <button type="button" disabled={index === row.related.length - 1} onClick={() => moveRelated(row, index, 1)} aria-label={`${option} 우선순위 내리기`}>↓</button>
                  </span>
                </div>
              ))}
              {options.filter((option) => !row.related.includes(option)).map((option) => (
                <button type="button" key={option} onClick={() => toggleChip(row, field, option)}>
                  {option}<b aria-hidden="true">＋</b>
                </button>
              ))}
            </>
          ) : options.map((option) => (
              <button
                type="button"
                key={option}
                className={row[field].includes(option) ? 'is-on' : ''}
                onClick={() => toggleChip(row, field, option)}
              >
                {option}{row[field].includes(option) && <b aria-hidden="true">✓</b>}
              </button>
            ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="sb-admin-knowledge">
      <header className="sb-admin-pagehead">
        <div><p className="sb-admin-pagehead__eyebrow">추천 품질의 기준 데이터</p><h1>트렌드 사전</h1><p>담당자 수집 뷰티 트렌드 키워드 — 시트처럼 바로 추가·태깅하고, 필터 결과를 생성 파이프라인에 싣습니다.</p></div>
        <span className="sb-admin-health is-lab"><i /> {draftCount > 0 ? `이 기기 편집 초안 ${draftCount}건` : '코드 이관본 · 전 기기 공통'}</span>
      </header>

      <section className="sb-admin-card">
        <details className="sb-admin-trend-defs">
          <summary>트렌드 등급 정의</summary>
          <ul>
            {TREND_LEVEL_DEFS.map((def) => (
              <li key={def.label}><b>{def.label}</b><span>{def.note}</span></li>
            ))}
          </ul>
        </details>
        <p className="sb-admin-trend-priority-guide"><b>관련 항목은 순서가 중요해요.</b> 1순위부터 왼쪽에 표시되며, 항목을 열어 ↑ ↓ 버튼으로 순서를 바꿀 수 있습니다.</p>
        <div className="sb-admin-callout">
          <span>i</span>
          {pipeValue === undefined && <p>생성 파이프라인의 현재 트렌드 키워드를 확인하는 중…</p>}
          {pipeValue === null && <p><b>파이프라인에 연결되지 않았어요.</b> 사전 열람·편집은 가능하지만, 키워드 싣기는 BFF 연결 후 가능합니다.</p>}
          {typeof pipeValue === 'string' && (
            <p>
              <b>지금 생성에 실린 키워드 {loadedTrendWords.length}개.</b>{' '}
              {loadedTrendWords.length > 0 ? `${loadedTrendWords.slice(0, 6).join(', ')}${loadedTrendWords.length > 6 ? ' 외' : ''} — ` : ''}
              아래 필터 결과를 실으면 원장을 거쳐 설문·계획 생성에 반영됩니다(새 생성부터).
            </p>
          )}
          <span className="sb-admin-trend-pipe-actions">
            {typeof pipeValue === 'string' && loadedTrendWords.length > 0 && (
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" disabled={pipeBusy} onClick={() => saveTrendToPipeline(null)}>비우기</button>
            )}
            <button
              type="button"
              className="sb-btn sb-btn--primary sb-btn--tiny"
              disabled={pipeBusy || typeof pipeValue !== 'string' || trendRows.length === 0}
              onClick={() => saveTrendToPipeline(trendRows.map((entry) => entry.word.trim()).filter(Boolean).join('\n'))}
            >
              {pipeBusy ? '싣는 중…' : `필터 결과 ${trendRows.length}개 싣기`}
            </button>
          </span>
        </div>
        <div className="sb-admin-trend-tools">
          <div className="sb-admin-subtabs" role="group" aria-label="트렌드 등급 필터">
            {[['all', `전체 ${allRows.length}`]]
              .concat(TREND_LEVEL_OPTIONS.map((level) => [level, `${level} ${allRows.filter((entry) => entry.levels.includes(level)).length}`]))
              .concat([['none', `미분류 ${allRows.filter((entry) => entry.levels.length === 0).length}`]])
              .map(([value, label]) => (
                <button key={value} type="button" className={trendLevel === value ? 'is-on' : ''} onClick={() => setTrendLevel(value)}>{label}</button>
              ))}
          </div>
          <span className="sb-admin-trend-tools__right">
            <input
              type="search"
              placeholder="키워드·상품·설명·입력자 검색"
              value={trendQuery}
              onChange={(event) => setTrendQuery(event.target.value)}
              aria-label="트렌드 키워드 검색"
            />
            {draftCount > 0 && (
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={exportDraft}>JSON 복사</button>
            )}
            <button type="button" className="sb-btn sb-btn--primary sb-btn--small" onClick={addRow}>+ 항목 추가</button>
          </span>
        </div>
        <div className="sb-table sb-admin-table sb-admin-trend-table"><div className="sb-table__scroll"><table>
          <thead><tr><th>키워드·상품</th><th>유행 구분</th><th>관련 우선순위</th><th>설명</th><th>대표 상품·브랜드</th><th>입력자</th><th /></tr></thead>
          <tbody>
            {trendRows.map((row) => {
              const patched = row.src === 'base' && !!overlay.patches[row.key]
              return (
                <tr key={row.key} className={row.src === 'added' ? 'sb-admin-trend-row--added' : undefined}>
                  <td>
                    <input
                      className="sb-admin-trend-input sb-admin-trend-input--word"
                      value={row.word}
                      placeholder="키워드 또는 상품명"
                      onChange={(event) => patchRow(row, { word: event.target.value })}
                      aria-label="키워드"
                    />
                  </td>
                  <td>{chipCell(row, 'levels', TREND_LEVEL_OPTIONS, '구분 선택')}</td>
                  <td>{chipCell(row, 'related', TREND_RELATED_OPTIONS, '관련 선택')}</td>
                  <td className="sb-admin-trend-table__desc">
                    <textarea
                      className="sb-admin-trend-input sb-admin-trend-input--desc"
                      value={row.desc}
                      placeholder="고객·생성에 설명할 정의"
                      onChange={(event) => patchRow(row, { desc: event.target.value })}
                      aria-label={`${row.word || '새 키워드'} 설명`}
                    />
                  </td>
                  <td>
                    <input
                      className="sb-admin-trend-input"
                      value={row.brands || ''}
                      placeholder="상품명·브랜드"
                      onChange={(event) => patchRow(row, { brands: event.target.value })}
                      aria-label={`${row.word || '새 키워드'} 대표 브랜드`}
                    />
                  </td>
                  <td>
                    <input
                      className="sb-admin-trend-input sb-admin-trend-input--author"
                      value={row.author || ''}
                      placeholder="입력자"
                      onChange={(event) => patchRow(row, { author: event.target.value })}
                      aria-label={`${row.word || '새 항목'} 입력자`}
                    />
                  </td>
                  <td className="sb-admin-trend-rowops">
                    {patched && <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => revertRow(row)}>되돌리기</button>}
                    <button type="button" className="sb-btn sb-btn--danger sb-btn--tiny" onClick={() => removeRow(row)}>삭제</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>{trendRows.length === 0 && <p className="sb-table__empty">조건에 맞는 키워드가 없어요.</p>}</div></div>
      </section>

      {pop && <div className="sb-admin-trend-pop-backdrop" onClick={() => setPop(null)} aria-hidden="true" />}
    </div>
  )
}
