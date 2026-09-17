import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TREND_LEVEL_OPTIONS } from '../lib/trendKeywords.js'

const GROUPS = [
  { label: '마이크로트렌드', title: '마이크로', icon: '✧', note: '작고 빠른 반짝임', tone: 'rose' },
  { label: '패드(1Y)', title: '패드', icon: '♡', note: '1년 안팎의 유행', tone: 'lilac' },
  { label: '트렌드(1Y~5Y)', title: '트렌드', icon: '✿', note: '1~5년 이어지는 흐름', tone: 'pink' },
  { label: '메가트렌드(10Y~)', title: '메가트렌드', icon: '❋', note: '10년 이상, 오래오래', tone: 'purple' },
]
const PAGE_SIZE = 6
const addedTime = (row) => Number(row.createdAt) || (/^add-\d+$/.test(row.key) ? Number(row.key.slice(4)) : 0)
const dateLabel = (row) => addedTime(row)
  ? new Date(addedTime(row)).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
  : '추가한 키워드'

function BubbleLane({ group, rows, selectedKey, freshKeys, onSelect, motion }) {
  const [page, setPage] = useState(0)
  const signature = rows.map((row) => row.key).join('|')
  useEffect(() => { setPage(0) }, [signature])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  return <section className={`sb-trend-lane sb-trend-tone--${group.tone}`} aria-label={group.label}>
    <header><h3><i aria-hidden="true">{group.icon}</i>{group.title}</h3><span>{rows.length}</span><p>{group.note}</p></header>
    <div className="sb-trend-lane__bubbles">
      {rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row, index) => <button
        key={row.key} type="button" title={row.word}
        className={`sb-trend-bubble${selectedKey === row.key ? ' is-selected' : ''}${freshKeys.has(row.key) ? ' is-fresh' : ''}`}
        style={{ '--bubble-delay': `${index * 75}ms`, '--float-delay': `${index * -0.7}s` }}
        aria-label={`${row.word} 자세히 보기`} aria-pressed={selectedKey === row.key}
        onClick={() => onSelect(row.key)}
      ><span className={motion ? 'sb-trend-bubble__float' : ''}><b>{row.word}</b>{freshKeys.has(row.key) && <em>새로 추가</em>}</span></button>)}
      {rows.length === 0 && <p className="sb-trend-lane__empty">아직 키워드가 없어요</p>}
    </div>
    <footer>
      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" aria-label={`${group.label} 이전 키워드`} disabled={current === 0} onClick={() => setPage(current - 1)}>←</button>
      <span>{rows.length ? `${current + 1} / ${pages}` : '0 / 0'}</span>
      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" aria-label={`${group.label} 다음 키워드`} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>→</button>
    </footer>
  </section>
}

export default function TrendDashboard({ rows, onAdd, onEdit }) {
  const [query, setQuery] = useState('')
  const [onlyAdded, setOnlyAdded] = useState(false)
  const [motion, setMotion] = useState(true)
  const [selectedKey, setSelectedKey] = useState(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ word: '', level: '', desc: '' })
  const [freshKeys, setFreshKeys] = useState(() => new Set())
  const [announcement, setAnnouncement] = useState('')
  const addButton = useRef(null)
  const words = useMemo(() => rows.filter((row) => row.word.trim()), [rows])
  const knownKeys = useRef(new Set(words.map((row) => row.key)))
  useEffect(() => {
    const added = words.filter((row) => !knownKeys.current.has(row.key))
    knownKeys.current = new Set(words.map((row) => row.key))
    if (!added.length) return
    setFreshKeys((prev) => new Set([...prev, ...added.map((row) => row.key)]))
    setSelectedKey(added[0].key)
    setAnnouncement(`${added.map((row) => row.word).join(', ')} · 새 키워드 ${added.length}개가 추가됐어요.`)
  }, [words])
  useEffect(() => {
    if (!freshKeys.size) return
    const timer = setTimeout(() => { setFreshKeys(new Set()); setAnnouncement('') }, 12000)
    return () => clearTimeout(timer)
  }, [freshKeys])

  const filtered = words.filter((row) => (!onlyAdded || row.src === 'added') &&
    [row.word, row.desc, row.brands, row.author, ...row.related].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const recent = words.filter((row) => row.src === 'added').sort((a, b) => addedTime(b) - addedTime(a))
  const selected = words.find((row) => row.key === selectedKey)
  const unclassified = filtered.filter((row) => !row.levels.length)
  const closeAdd = () => { setAdding(false); addButton.current?.focus() }
  const submit = (event) => {
    event.preventDefault()
    if (!onAdd(draft)) return
    setDraft({ word: '', level: '', desc: '' })
    setQuery('')
    setOnlyAdded(false)
    closeAdd()
  }

  return <div className={`sb-trend-dashboard${motion ? '' : ' is-still'}`}>
    <div className="sb-trend-stats">
      <div><i aria-hidden="true">◌</i><span>모아둔 키워드</span><strong>{words.length}<small>개</small></strong></div>
      <div><i aria-hidden="true">♡</i><span>이 기기에서 추가</span><strong>{recent.length}<small>개</small></strong></div>
      <div><i aria-hidden="true">✿</i><span>분류 완료</span><strong>{words.filter((row) => row.levels.length).length}<small>개</small></strong></div>
      <div><i aria-hidden="true">✧</i><span>아직 미분류</span><strong>{words.filter((row) => !row.levels.length).length}<small>개</small></strong></div>
    </div>

    <div className="sb-trend-toolbar">
      <div className="sb-trend-toolbar__intro"><span className="sb-trend-flower" aria-hidden="true">✿</span><div><h2>트렌드가 피어나는 중</h2><p>궁금한 키워드를 콕 눌러보세요.</p></div></div>
      <button ref={addButton} type="button" className="sb-btn sb-btn--primary" aria-expanded={adding} aria-controls="trend-quick-add" onClick={() => setAdding(!adding)}>＋ 키워드 추가</button>
    </div>
    {adding && <form id="trend-quick-add" className="sb-trend-add" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') closeAdd() }}>
      <label>키워드<input autoFocus required maxLength={100} value={draft.word} onChange={(event) => setDraft({ ...draft, word: event.target.value })} placeholder="새로 발견한 키워드" /></label>
      <label>유행 구분<select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value })}><option value="">미분류 · 나중에 선택</option>{TREND_LEVEL_OPTIONS.map((level) => <option key={level}>{level}</option>)}</select></label>
      <label className="sb-trend-add__desc">한 줄 설명<input value={draft.desc} onChange={(event) => setDraft({ ...draft, desc: event.target.value })} placeholder="어떤 트렌드인가요? (선택)" /></label>
      <div><button type="button" className="sb-btn sb-btn--ghost" onClick={closeAdd}>취소</button><button type="submit" className="sb-btn sb-btn--primary" disabled={!draft.word.trim()}>추가하기</button></div>
    </form>}

    <div className="sb-trend-layout">
      <section className="sb-trend-map" aria-label="트렌드 버블 지도">
        <div className="sb-trend-map__tools">
          <input type="search" aria-label="대시보드 키워드 검색" placeholder="키워드·설명·브랜드 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
          <label><input type="checkbox" checked={onlyAdded} onChange={(event) => setOnlyAdded(event.target.checked)} /> 내가 추가한 것만</label>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" aria-pressed={!motion} onClick={() => setMotion(!motion)}>{motion ? '움직임 멈추기' : '움직임 켜기'}</button>
        </div>
        <div className="sb-trend-map__status" role="status"><i aria-hidden="true" />{announcement || '새 키워드를 담으면, 여기에 톡!' }<span>{filtered.length}개의 발견</span></div>
        <div className="sb-trend-map__scroll" tabIndex={0} role="region" aria-label="유행 구분별 버블, 좁은 화면에서 좌우 스크롤">
          <div className="sb-trend-map__plot">
            <div className="sb-trend-sparkles" aria-hidden="true"><span>✧</span><span>♡</span><span>✧</span><span>·</span><span>✧</span></div>
            <svg className="sb-trend-curve" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">
              <path className="sb-trend-curve__area" d="M0 340 C140 340 200 250 300 160 S460 36 530 70 S710 225 790 276 S930 332 1000 328 L1000 420 L0 420 Z" />
              <path className="sb-trend-curve__line" d="M0 340 C140 340 200 250 300 160 S460 36 530 70 S710 225 790 276 S930 332 1000 328" />
            </svg>
            <div className="sb-trend-map__lanes">{GROUPS.map((group) => <BubbleLane key={group.label} group={group} rows={filtered.filter((row) => row.levels.includes(group.label))} selectedKey={selectedKey} freshKeys={freshKeys} onSelect={setSelectedKey} motion={motion} />)}</div>
          </div>
        </div>
        <div className="sb-trend-map__axis"><span>짧게 스치는 유행</span><span>유행의 지속 기간 →</span><span>오래 이어지는 흐름</span></div>
        <p className="sb-trend-map__note">유행 구분을 모아놓은 지도예요 · 검색량 그래프 아님 · 여러 구분은 중복 표시</p>
        {filtered.length === 0 && <div className="sb-trend-empty"><p>조건에 맞는 키워드가 없어요.</p><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => { setQuery(''); setOnlyAdded(false) }}>전체 키워드 보기</button></div>}
        <section className="sb-trend-unclassified"><header><h3><i aria-hidden="true">♡</i> 분류를 기다리는 키워드 <span>{unclassified.length}</span></h3><p>어울리는 자리를 찾아주세요.</p></header><div>{unclassified.map((row) => <button type="button" key={row.key} title={row.word} className={`sb-trend-loose${freshKeys.has(row.key) ? ' is-fresh' : ''}`} aria-pressed={selectedKey === row.key} onClick={() => setSelectedKey(row.key)}>{row.word}{freshKeys.has(row.key) && <em>새로 추가</em>}</button>)}{!unclassified.length && <span className="sb-admin__muted">미분류 키워드가 없어요.</span>}</div></section>
      </section>

      <aside className="sb-trend-sidebar">
        <section className={`sb-trend-detail${selected ? ' is-open' : ''}`} aria-label="선택한 키워드 상세">
          {selected && <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny sb-trend-detail__close" aria-label="키워드 상세 닫기" onClick={() => setSelectedKey(null)}>닫기 ×</button>}
          <span className="sb-trend-detail__label">키워드 들여다보기</span>
          {selected ? <><h2>{selected.word}</h2><div>{(selected.levels.length ? selected.levels : ['미분류']).map((level) => <span className="sb-admin-trend-level" key={level}>{level}</span>)}</div><p>{selected.desc || '아직 설명이 없어요. 사전 편집에서 이야기를 더해주세요.'}</p><dl><dt>관련 우선순위</dt><dd>{selected.related.join(' → ') || '미지정'}</dd><dt>대표 상품·브랜드</dt><dd>{selected.brands || '미등록'}</dd><dt>입력자</dt><dd>{selected.author || '미등록'}</dd></dl><button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => onEdit(selected)}>이 키워드 편집 →</button></> : <div className="sb-trend-detail__empty"><div className="sb-trend-mascot" aria-hidden="true"><span>✿</span><b>·ᴗ·</b><i>♡</i></div><h2>어떤 키워드가 궁금해요?</h2><p>버블을 누르면<br />작은 이야기가 펼쳐져요.</p></div>}
        </section>
        <section className="sb-trend-recent"><header><h3>새로 담긴 키워드</h3><span>{recent.length}</span></header><p>이 기기에서 추가한 순서대로</p>{recent.length ? <ul>{recent.slice(0, 8).map((row) => <li key={row.key}><button type="button" onClick={() => setSelectedKey(row.key)}><i aria-hidden="true" /><span><b>{row.word}</b><small>{row.levels[0] || '미분류'}</small></span><time>{dateLabel(row)}</time></button></li>)}</ul> : <div className="sb-trend-recent__empty">새 키워드를 발견했나요?<br />위의 ‘키워드 추가’로 첫 버블을 띄워보세요.</div>}{recent.length > 8 && <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" onClick={() => { setOnlyAdded(true); setQuery('') }}>추가한 {recent.length}개 모두 보기 →</button>}</section>
        <p className="sb-trend-storage-note">추가·편집은 이 브라우저에 자동 저장돼요. 다른 기기에 공유하려면 사전 편집에서 JSON을 복사해 주세요.</p>
      </aside>
    </div>
  </div>
}
