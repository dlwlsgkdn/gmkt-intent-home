import React, { useMemo, useState } from 'react'
import {
  AREAS,
  CONDITIONS,
  CONCERNS,
  CATEGORIES,
  RESULTS,
  SKIN_TYPES,
  TAGGING_SEED,
} from '../lib/taggingCatalog.js'
import { TREND_KEYWORDS, TREND_LEVEL_DEFS, TREND_LEVEL_OPTIONS } from '../lib/trendKeywords.js'

const ANSWER_KEY = 'ddak-admin-answer-sheet-v1'

const loadAnswers = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(ANSWER_KEY) || 'null')
    if (Array.isArray(saved)) return saved
  } catch { /* 기기 초안이 깨졌으면 빈 목록으로 시작 */ }
  return []
}

const saveAnswers = (rows) => {
  try { localStorage.setItem(ANSWER_KEY, JSON.stringify(rows)) } catch { /* 초안 저장 실패는 화면 편집을 막지 않음 */ }
}

const TAXONOMY = [
  ['대분류', CATEGORIES],
  ['부위', AREAS],
  ['피부 타입', SKIN_TYPES],
  ['고민', CONCERNS],
  ['결과', RESULTS],
  ['사용 조건', CONDITIONS],
]

export default function AdminKnowledge({ api }) {
  const [view, setView] = useState('keywords')
  const [answers, setAnswers] = useState(loadAnswers)
  const [answerDraft, setAnswerDraft] = useState({ keyword: '', product: '', reason: '' })
  const [trendLevel, setTrendLevel] = useState('all')
  const [trendQuery, setTrendQuery] = useState('')
  const keywords = api.keywords || []

  const trendRows = useMemo(() => {
    const query = trendQuery.trim().toLowerCase()
    return TREND_KEYWORDS.filter((entry) => {
      if (trendLevel === 'none' && entry.levels.length > 0) return false
      if (trendLevel !== 'all' && trendLevel !== 'none' && !entry.levels.includes(trendLevel)) return false
      if (!query) return true
      return [entry.word, entry.desc, entry.brands || '', entry.related.join(' ')].join(' ').toLowerCase().includes(query)
    })
  }, [trendLevel, trendQuery])

  const tagUsage = useMemo(() => {
    const counts = {}
    for (const product of TAGGING_SEED) {
      for (const field of Object.values(product.fields)) {
        for (const value of field.selected) counts[value] = (counts[value] || 0) + 1
      }
    }
    return counts
  }, [])

  const patchKeyword = (index, patch) => {
    api.updateKeywords(keywords.map((item, current) => current === index ? { ...item, ...patch } : item))
  }
  const addKeyword = () => api.updateKeywords([...keywords, { word: '', desc: '', points: '' }])
  const removeKeyword = (index) => api.updateKeywords(keywords.filter((_, current) => current !== index))

  const commitAnswers = (next) => {
    setAnswers(next)
    saveAnswers(next)
  }
  const addAnswer = () => {
    if (!answerDraft.keyword.trim() || !answerDraft.product.trim()) {
      api.showToast('키워드와 대표상품을 입력해주세요.')
      return
    }
    commitAnswers([...answers, { id: `answer-${Date.now()}`, ...answerDraft, active: true }])
    setAnswerDraft({ keyword: '', product: '', reason: '' })
    api.showToast('정답지 초안에 추가했어요.')
  }

  return (
    <div className="sb-admin-knowledge">
      <header className="sb-admin-pagehead">
        <div><p className="sb-admin-pagehead__eyebrow">추천 품질의 기준 데이터</p><h1>운영 지식</h1><p>고객에게 설명할 말, 상품을 찾는 기준, 대표 답안을 한곳에서 관리합니다.</p></div>
        <span className="sb-admin-health is-lab"><i /> 변경 즉시 로컬 반영</span>
      </header>

      <div className="sb-admin-subtabs" role="tablist" aria-label="운영 지식 종류">
        {[
          ['keywords', `키워드 사전 ${keywords.length}`],
          ['trends', `트렌드 사전 ${TREND_KEYWORDS.length}`],
          ['taxonomy', `태그 사전 ${TAXONOMY.reduce((sum, [, values]) => sum + values.length, 0)}`],
          ['answers', `정답지 ${answers.length}`],
        ].map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? 'is-on' : ''} onClick={() => setView(value)}>{label}</button>
        ))}
      </div>

      {view === 'keywords' && (
        <section className="sb-admin-card">
          <div className="sb-admin-sectionhead">
            <div><h2>고객용 키워드 사전</h2><p>콘텐츠의 <code>[[키워드]]</code>를 누르면 아래 설명과 사용 포인트가 보여요.</p></div>
            <button type="button" className="sb-btn sb-btn--primary sb-btn--small" onClick={addKeyword}>키워드 추가</button>
          </div>
          <div className="sb-table sb-admin-table sb-admin-knowledge-table"><div className="sb-table__scroll"><table>
            <thead><tr><th>키워드</th><th>고객에게 보일 설명</th><th>사용 포인트</th><th /></tr></thead>
            <tbody>{keywords.map((keyword, index) => (
              <tr key={`${index}-${keyword.word}`}>
                <td><input value={keyword.word} onChange={(event) => patchKeyword(index, { word: event.target.value })} aria-label={`${index + 1}번째 키워드`} /></td>
                <td><textarea value={keyword.desc} onChange={(event) => patchKeyword(index, { desc: event.target.value })} aria-label={`${keyword.word || index + 1} 설명`} /></td>
                <td><textarea value={keyword.points} onChange={(event) => patchKeyword(index, { points: event.target.value })} aria-label={`${keyword.word || index + 1} 사용 포인트`} /></td>
                <td><button type="button" className="sb-btn sb-btn--danger sb-btn--tiny" onClick={() => removeKeyword(index)}>삭제</button></td>
              </tr>
            ))}</tbody>
          </table></div></div>
        </section>
      )}

      {view === 'trends' && (
        <section className="sb-admin-card">
          <div className="sb-admin-sectionhead">
            <div><h2>뷰티 트렌드 키워드 사전</h2><p>담당자 수집 트렌드 키워드 이관본 — 관련 태그는 연관도 높은 순서입니다.</p></div>
          </div>
          <details className="sb-admin-trend-defs">
            <summary>트렌드 등급 정의</summary>
            <ul>
              {TREND_LEVEL_DEFS.map((def) => (
                <li key={def.label}><b>{def.label}</b><span>{def.note}</span></li>
              ))}
            </ul>
          </details>
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
      )}

      {view === 'taxonomy' && (
        <div className="sb-admin-taxonomy-grid">
          {TAXONOMY.map(([label, values]) => (
            <section key={label} className="sb-admin-card sb-admin-taxonomy">
              <div className="sb-admin-sectionhead"><div><h2>{label}</h2><p>{values.length}개 닫힌 값 · 숫자는 카탈로그 사용 상품 수</p></div></div>
              <div className="sb-admin-taxonomy__chips">
                {values.map((value) => <span key={value}>{value}<b>{tagUsage[value] || 0}</b></span>)}
              </div>
            </section>
          ))}
          <section className="sb-admin-card sb-admin-taxonomy-note">
            <b>태그 값은 이곳에서 직접 지우지 않습니다.</b>
            <p>닫힌 목록을 바꾸면 기존 상품과 추천 조건이 함께 영향을 받아요. 상품 태깅에서 근거를 먼저 검토하고 코드 반영용 JSON을 내보내세요.</p>
            <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => api.setAdminTab('tagging')}>상품 태깅으로 이동</button>
          </section>
        </div>
      )}

      {view === 'answers' && (
        <section className="sb-admin-card">
          <div className="sb-admin-sectionhead"><div><h2>키워드별 대표 답안</h2><p>추천 품질을 비교할 때 사용할 대표상품과 이유의 초안입니다. 이 기기에 저장됩니다.</p></div></div>
          <div className="sb-table sb-admin-table"><div className="sb-table__scroll"><table>
            <thead><tr><th>키워드</th><th>브랜드 · 대표상품</th><th>추천 이유</th><th>상태</th><th /></tr></thead>
            <tbody>
              {answers.map((row) => (
                <tr key={row.id} className={!row.active ? 'sb-admin-row--archived' : undefined}>
                  <td><b>{row.keyword}</b></td><td>{row.product}</td><td>{row.reason || '—'}</td>
                  <td><button type="button" className={`sb-admin-status ${row.active ? 'sb-admin-status--done' : 'sb-admin-status--archived'}`} onClick={() => commitAnswers(answers.map((item) => item.id === row.id ? { ...item, active: !item.active } : item))}>{row.active ? '사용 중' : '중지'}</button></td>
                  <td><button type="button" className="sb-btn sb-btn--danger sb-btn--tiny" onClick={() => commitAnswers(answers.filter((item) => item.id !== row.id))}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>{answers.length === 0 && <p className="sb-table__empty">아직 대표 답안이 없어요. 첫 기준을 추가해보세요.</p>}</div></div>
          <div className="sb-admin-answer-add">
            <input placeholder="키워드" value={answerDraft.keyword} onChange={(event) => setAnswerDraft({ ...answerDraft, keyword: event.target.value })} />
            <input placeholder="브랜드 · 대표상품" value={answerDraft.product} onChange={(event) => setAnswerDraft({ ...answerDraft, product: event.target.value })} />
            <input placeholder="추천 이유" value={answerDraft.reason} onChange={(event) => setAnswerDraft({ ...answerDraft, reason: event.target.value })} />
            <button type="button" className="sb-btn sb-btn--primary sb-btn--small" onClick={addAnswer}>추가</button>
          </div>
        </section>
      )}
    </div>
  )
}
