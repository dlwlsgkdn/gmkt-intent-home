import React, { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCatalogContents, fetchCatalogProducts, patchCatalogContent, patchCatalogProduct } from '../lib/adminApi.js'

/*
 * 카탈로그 둘러보기 (데이터 시딩 메뉴, 2026-09-18) — 시딩된 상품·콘텐츠 행을 간략 표로 보고(무한 스크롤), 행을 누르면 모든 컬럼을 상세로 본다.
 * 원천은 BFF GET /api/admin/catalog/{products,contents} (core 둘러보기 — updated_at 내림차순 키셋 커서, 필터는 서버). 검색(추천 후보)과 달리
 * 미검증·내려감(dead) 행도 보인다. 상세 다이얼로그의 「검증됨으로」·「내려감 표시」는 PATCH 로 행을 표시한다 — 추천 후보 검색이 verified·active 만 보므로 곧 노출 제어다.
 */
const PAGE = 40
const SOURCE_LABEL = { search: '웹 검색', thread: '쓰레드 수확', manual: '가져오기' }
const STATUS_LABEL = { active: '노출', dead: '내려감' }

const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const fmtPrice = (v) => (v > 0 ? `${Number(v).toLocaleString('ko-KR')}원` : '미확인')
const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}
const isPlainValue = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)

/** 값 하나를 상세 셀로 — 주소는 링크, 배열은 칩, 객체는 JSON */
function Cell({ k, v }) {
  if (v === null || v === undefined || v === '') return <dd className="is-empty">—</dd>
  if (Array.isArray(v)) {
    if (!v.length) return <dd className="is-empty">—</dd>
    if (v.every(isPlainValue)) {
      return (
        <dd>
          <span className="sb-catdetail__tags">{v.map((t, i) => <span key={`${t}-${i}`} className="sb-catbrowse__pill">{String(t)}</span>)}</span>
        </dd>
      )
    }
    return <dd><pre>{JSON.stringify(v, null, 2)}</pre></dd>
  }
  if (typeof v === 'object') return <dd><pre>{JSON.stringify(v, null, 2)}</pre></dd>
  if (typeof v === 'boolean') return <dd>{v ? '예' : '아니오'}</dd>
  if (typeof v === 'string' && /^https?:\/\//.test(v)) {
    return <dd><a href={v} target="_blank" rel="noreferrer">{v}</a></dd>
  }
  if (/At$/.test(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))) return <dd>{fmtDateTime(v)} <code>{v}</code></dd>
  if (k === 'price') return <dd>{fmtPrice(v)}</dd>
  if (k === 'source') return <dd>{SOURCE_LABEL[v] || v}</dd>
  if (k === 'status') return <dd>{STATUS_LABEL[v] || v}</dd>
  if (k === 'id' || k === 'mallProductId') return <dd><code>{String(v)}</code></dd>
  return <dd>{String(v)}</dd>
}

/* 상세에서 먼저 보이는 컬럼 순서 — 나머지(새 컬럼 포함)는 뒤에 이름순으로 붙여 전부 보인다 */
const PRODUCT_ORDER = ['id', 'mall', 'mallProductId', 'name', 'brand', 'price', 'url', 'imageUrl', 'category', 'tags', 'source', 'verified', 'status', 'recommendCount', 'lastSeenAt', 'createdAt', 'updatedAt', 'meta']
const CONTENT_ORDER = ['id', 'type', 'source', 'title', 'url', 'imageUrl', 'snippet', 'duration', 'year', 'tags', 'verified', 'status', 'recommendCount', 'lastSeenAt', 'createdAt', 'updatedAt', 'meta']
const orderedKeys = (row, order) => [...order.filter((k) => k in row), ...Object.keys(row).filter((k) => !order.includes(k)).sort()]

const VerifiedPill = ({ row }) =>
  row.status === 'dead' ? <span className="sb-catbrowse__pill is-dead">내려감</span> : row.verified ? <span className="sb-catbrowse__pill is-ok">검증</span> : <span className="sb-catbrowse__pill is-warn">미검증</span>

export default function AdminCatalogBrowse({ available, malls = [], onLog }) {
  const [kind, setKind] = useState('products')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [mall, setMall] = useState('')
  const [type, setType] = useState('')
  const [source, setSource] = useState('')
  const [verified, setVerified] = useState('')
  const [status, setStatus] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [patching, setPatching] = useState(false)
  const seqRef = useRef(0)
  const scrollRef = useRef(null)
  const sentinelRef = useRef(null)
  const cursorRef = useRef(null)
  const loadingRef = useRef(false)

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  const params = useCallback(
    (next) => ({
      q: qDebounced || undefined,
      mall: kind === 'products' && mall ? mall : undefined,
      type: kind === 'contents' && type ? type : undefined,
      source: kind === 'products' && source ? source : undefined,
      verified: verified || undefined,
      status: status || undefined,
      cursor: next || undefined,
      limit: PAGE,
    }),
    [kind, qDebounced, mall, type, source, verified, status],
  )

  /* 페이지 하나 — reset 이면 첫 페이지(필터 변경), 아니면 cursorRef 다음 페이지. 순번 가드로 늦게 온 옛 응답을 버린다 */
  const load = useCallback(
    async (reset) => {
      if (!available) return
      if (!reset && (loadingRef.current || !cursorRef.current)) return
      const seq = ++seqRef.current
      loadingRef.current = true
      setLoading(true)
      setError('')
      try {
        const fetcher = kind === 'products' ? fetchCatalogProducts : fetchCatalogContents
        const page = await fetcher(params(reset ? null : cursorRef.current))
        if (seq !== seqRef.current) return
        cursorRef.current = page.nextCursor
        setCursor(page.nextCursor)
        setTotal(page.total)
        setItems((prev) => (reset ? page.items : [...prev, ...page.items.filter((r) => !prev.some((p) => p.id === r.id))]))
      } catch (e) {
        if (seq !== seqRef.current) return
        setError(e?.message || '카탈로그 행을 읽지 못했어요.')
      } finally {
        if (seq === seqRef.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [available, kind, params],
  )

  /* 필터가 바뀌면 처음부터 */
  useEffect(() => {
    cursorRef.current = null
    setItems([])
    setCursor(null)
    setTotal(null)
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    load(true)
  }, [load])

  /* 무한 스크롤 — 스크롤 상자 안 센티널이 보이면 다음 페이지 */
  useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root || !cursor) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) load(false)
      },
      { root, rootMargin: '160px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, load])

  /* 상세 다이얼로그 Esc */
  useEffect(() => {
    if (!selected) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const patch = async (body, label) => {
    if (!selected) return
    setPatching(true)
    try {
      const patcher = kind === 'products' ? patchCatalogProduct : patchCatalogContent
      const updated = await patcher(selected.id, body)
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setSelected(updated)
      onLog?.(`${kind === 'products' ? '상품' : '콘텐츠'} ${updated.id} — ${label}.`)
    } catch (e) {
      onLog?.(`${label} 실패 — ${e?.message || e}`, true)
    } finally {
      setPatching(false)
    }
  }

  const switchKind = (next) => {
    if (next === kind) return
    setKind(next)
    setSelected(null)
  }
  const isProducts = kind === 'products'
  const noun = isProducts ? '상품' : '콘텐츠'
  const titleOf = (row) => (isProducts ? row.name : row.title)

  return (
    <section className="sb-admin-card sb-seeding__card sb-catbrowse" aria-label="카탈로그 둘러보기">
      <div className="sb-catbrowse__head">
        <h2>둘러보기</h2>
        <div className="sb-seg sb-catbrowse__seg" role="tablist" aria-label="상품·콘텐츠">
          <button type="button" role="tab" aria-selected={isProducts} className={`sb-seg__btn${isProducts ? ' sb-seg__btn--active' : ''}`} onClick={() => switchKind('products')}>상품</button>
          <button type="button" role="tab" aria-selected={!isProducts} className={`sb-seg__btn${!isProducts ? ' sb-seg__btn--active' : ''}`} onClick={() => switchKind('contents')}>콘텐츠</button>
        </div>
      </div>
      <p>표에 쌓인 {noun} 행을 최근 갱신 순으로 봅니다. 아래로 내리면 이어서 불러오고, 행을 누르면 모든 컬럼이 보여요. 미검증·내려감 행도 여기서는 보입니다(추천 후보는 검증·노출 행만).</p>
      <div className="sb-catbrowse__filters">
        <input type="search" placeholder={isProducts ? '이름·브랜드·태그 검색' : '제목·출처·태그 검색'} value={q} onChange={(e) => setQ(e.target.value)} disabled={!available} />
        {isProducts ? (
          <>
            <select value={mall} onChange={(e) => setMall(e.target.value)} disabled={!available} aria-label="몰">
              <option value="">몰 전체</option>
              {malls.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} disabled={!available} aria-label="출처">
              <option value="">출처 전체</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </>
        ) : (
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={!available} aria-label="종류">
            <option value="">종류 전체</option>
            <option value="video">영상</option>
            <option value="article">게시글</option>
          </select>
        )}
        <select value={verified} onChange={(e) => setVerified(e.target.value)} disabled={!available} aria-label="검증">
          <option value="">검증 전체</option>
          <option value="true">검증됨</option>
          <option value="false">미검증</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!available} aria-label="상태">
          <option value="">상태 전체</option>
          <option value="active">노출</option>
          <option value="dead">내려감</option>
                  </select>
        <span>{total === null ? (loading ? '세는 중…' : '') : `${total.toLocaleString('ko-KR')}개 중 ${items.length.toLocaleString('ko-KR')}개 표시`}</span>
        <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" disabled={!available || loading} onClick={() => load(true)}>새로고침</button>
      </div>
      {error && <p className="sb-catalog-note is-warn">{error}</p>}
      <div className="sb-catbrowse__scroll" ref={scrollRef}>
        <table>
          <thead>
            {isProducts ? (
              <tr><th aria-label="썸네일" /><th>상품</th><th>브랜드</th><th>가격</th><th>몰</th><th>출처</th><th>검증</th><th>노출</th><th>갱신</th></tr>
            ) : (
              <tr><th aria-label="썸네일" /><th>제목</th><th>종류</th><th>출처</th><th>연도</th><th>검증</th><th>노출</th><th>갱신</th></tr>
            )}
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id} className={row.status === 'dead' ? 'is-dead' : ''} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(row) }}>
                <td>{row.imageUrl ? <img className="sb-catbrowse__thumb" src={row.imageUrl} alt="" loading="lazy" /> : <span className="sb-catbrowse__thumb--empty" />}</td>
                <td className="sb-catbrowse__name" title={titleOf(row)}>{titleOf(row) || <em>(이름 없음)</em>}</td>
                {isProducts ? (
                  <>
                    <td>{row.brand || '—'}</td>
                    <td>{fmtPrice(row.price)}</td>
                    <td>{row.mall || '—'}</td>
                    <td>{SOURCE_LABEL[row.source] || row.source || '—'}</td>
                  </>
                ) : (
                  <>
                    <td>{row.type === 'video' ? '영상' : '게시글'}</td>
                    <td title={row.url}>{row.source || hostOf(row.url) || '—'}</td>
                    <td>{row.year || row.meta?.year || '—'}</td>
                  </>
                )}
                <td><VerifiedPill row={row} /></td>
                <td>{row.recommendCount ?? 0}회</td>
                <td>{fmtDateTime(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !items.length && !error && <p className="sb-catbrowse__foot">{available ? `조건에 맞는 ${noun}이 없어요.` : '카탈로그 표가 아직 없어요.'}</p>}
        {loading && <p className="sb-catbrowse__foot">불러오는 중…</p>}
        {!loading && items.length > 0 && !cursor && <p className="sb-catbrowse__foot">끝까지 봤어요.</p>}
        <div ref={sentinelRef} className="sb-catbrowse__sentinel" />
      </div>

      {selected && (
        <div className="sb-llm-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null) }}>
          <section className="sb-llm-dialog sb-admin-dialog sb-catdetail" role="dialog" aria-modal="true" aria-label={`${noun} 상세`}>
            <div className="sb-admin-dialog__head">
              <h2>{noun} 상세</h2>
              <div className="sb-admin-dialog__actions">
                <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => setSelected(null)}>닫기</button>
              </div>
            </div>
            <div className="sb-catdetail__body">
              <div className="sb-catdetail__hero">
                {selected.imageUrl ? <img src={selected.imageUrl} alt="" /> : null}
                <div>
                  <h3>{titleOf(selected) || '(이름 없음)'}</h3>
                  <p>
                    {isProducts ? [selected.brand, selected.mall, fmtPrice(selected.price)].filter(Boolean).join(' · ') : [selected.type === 'video' ? '영상' : '게시글', selected.source || hostOf(selected.url)].filter(Boolean).join(' · ')}
                    {' · '}<VerifiedPill row={selected} />
                  </p>
                  {selected.url && <a href={selected.url} target="_blank" rel="noreferrer">새 탭에서 열기 ↗</a>}
                </div>
              </div>
              <dl className="sb-catdetail__kv">
                {orderedKeys(selected, isProducts ? PRODUCT_ORDER : CONTENT_ORDER).map((k) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <Cell k={k} v={selected[k]} />
                  </React.Fragment>
                ))}
              </dl>
              <div className="sb-catdetail__actions">
                <button type="button" className="sb-btn sb-btn--small" disabled={patching} onClick={() => patch({ verified: !selected.verified }, selected.verified ? '미검증으로 바꿈' : '검증됨으로 바꿈')}>
                  {selected.verified ? '미검증으로' : '검증됨으로'}
                </button>
                <button type="button" className={`sb-btn sb-btn--small${selected.status === 'dead' ? '' : ' sb-btn--danger'}`} disabled={patching} onClick={() => patch({ status: selected.status === 'dead' ? 'active' : 'dead' }, selected.status === 'dead' ? '다시 노출' : '내려감 표시')}>
                  {selected.status === 'dead' ? '다시 노출' : '내려감 표시'}
                </button>
                <span className="sb-catbrowse__foot">검증됨·노출 행만 추천 후보로 나갑니다.</span>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
