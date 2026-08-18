import React, { useEffect, useMemo, useState } from 'react'
import { fetchAdminPipeline, putAdminKnowledge } from '../lib/adminApi.js'
import { TREND_KEYWORDS, TREND_LEVEL_DEFS, TREND_LEVEL_OPTIONS } from '../lib/trendKeywords.js'

/*
 * 운영 지식 — 트렌드 키워드 사전 한 벌 (담당자 엑셀 이관본, lib/trendKeywords.js).
 * 구 서브탭(키워드 사전·태그 사전·정답지)은 2026-08 정리 — 키워드 사전은 프로필·키워드
 * 편집기(ExploreEditor)가, 태그 사전은 상품 태깅 스튜디오가 계속 담당한다.
 */
export default function AdminKnowledge({ api }) {
  const [trendLevel, setTrendLevel] = useState('all')
  const [trendQuery, setTrendQuery] = useState('')

  const trendRows = useMemo(() => {
    const query = trendQuery.trim().toLowerCase()
    return TREND_KEYWORDS.filter((entry) => {
      if (trendLevel === 'none' && entry.levels.length > 0) return false
      if (trendLevel !== 'all' && trendLevel !== 'none' && !entry.levels.includes(trendLevel)) return false
      if (!query) return true
      return [entry.word, entry.desc, entry.brands || '', entry.related.join(' ')].join(' ').toLowerCase().includes(query)
    })
  }, [trendLevel, trendQuery])

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

  return (
    <div className="sb-admin-knowledge">
      <header className="sb-admin-pagehead">
        <div><p className="sb-admin-pagehead__eyebrow">추천 품질의 기준 데이터</p><h1>트렌드 사전</h1><p>담당자 수집 뷰티 트렌드 키워드 {TREND_KEYWORDS.length}종 — 관련 태그는 연관도 높은 순서입니다.</p></div>
        <span className="sb-admin-health is-lab"><i /> 코드 이관본 · 전 기기 공통</span>
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
        <div className="sb-admin-callout">
          <span>i</span>
          {pipeValue === undefined && <p>생성 파이프라인의 현재 트렌드 키워드를 확인하는 중…</p>}
          {pipeValue === null && <p><b>파이프라인에 연결되지 않았어요.</b> 아래 사전은 볼 수 있지만, 키워드 싣기는 BFF 연결 후 가능합니다.</p>}
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
              onClick={() => saveTrendToPipeline(trendRows.map((entry) => entry.word).join('\n'))}
            >
              {pipeBusy ? '싣는 중…' : `필터 결과 ${trendRows.length}개 싣기`}
            </button>
          </span>
        </div>
        <div className="sb-admin-trend-tools">
          <div className="sb-admin-subtabs" role="group" aria-label="트렌드 등급 필터">
            {[['all', `전체 ${TREND_KEYWORDS.length}`]]
              .concat(TREND_LEVEL_OPTIONS.map((level) => [level, `${level} ${TREND_KEYWORDS.filter((entry) => entry.levels.includes(level)).length}`]))
              .concat([['none', `미분류 ${TREND_KEYWORDS.filter((entry) => entry.levels.length === 0).length}`]])
              .map(([value, label]) => (
                <button key={value} type="button" className={trendLevel === value ? 'is-on' : ''} onClick={() => setTrendLevel(value)}>{label}</button>
              ))}
          </div>
          <input
            type="search"
            placeholder="키워드·설명·브랜드 검색"
            value={trendQuery}
            onChange={(event) => setTrendQuery(event.target.value)}
            aria-label="트렌드 키워드 검색"
          />
        </div>
        <div className="sb-table sb-admin-table sb-admin-trend-table"><div className="sb-table__scroll"><table>
          <thead><tr><th>키워드</th><th>구분</th><th>관련</th><th>설명</th><th>대표 브랜드·제품</th><th>입력자</th></tr></thead>
          <tbody>
            {trendRows.map((entry) => (
              <tr key={`${entry.author}-${entry.word}`}>
                <td><b>{entry.word}</b></td>
                <td>{entry.levels.length > 0 ? entry.levels.map((level) => <span key={level} className="sb-admin-trend-level">{level}</span>) : <span className="sb-admin__muted">—</span>}</td>
                <td>{entry.related.length > 0 ? entry.related.join(' · ') : <span className="sb-admin__muted">—</span>}</td>
                <td className="sb-admin-trend-table__desc">{entry.desc}</td>
                <td>{entry.brands || <span className="sb-admin__muted">—</span>}</td>
                <td className="sb-admin__muted">{entry.author}</td>
              </tr>
            ))}
          </tbody>
        </table>{trendRows.length === 0 && <p className="sb-table__empty">조건에 맞는 키워드가 없어요.</p>}</div></div>
      </section>
    </div>
  )
}
