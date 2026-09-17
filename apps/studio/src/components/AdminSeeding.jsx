import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearSeedJob,
  fetchAdminCatalog,
  fetchSeedJob,
  harvestAdminCatalog,
  importAdminCatalog,
  migrateAdminCatalog,
  pauseSeedJob,
  resumeSeedJob,
  startSeedJob,
  stepSeedJob,
  verifyAdminCatalog,
} from '../lib/adminApi.js'
import {
  CATALOG_SEED_COST_PER_QUERY_USD,
  CATALOG_SEED_FACETS,
  CATALOG_SEED_KEYWORDS,
  catalogSeedQueries,
} from '../../../../packages/pipeline/src/catalog-candidates.ts'

/*
 * 데이터 시딩 (#ops/seeding, 서비스 품질 그룹 — 2026-09-17) — 내재화 카탈로그(추천 상품·참고 콘텐츠의 내부 표)를 채우고 돌보는 전용 메뉴.
 * 계획 생성은 이 표 절반 + 웹 검색 절반으로 상품·콘텐츠를 고른다(API.md §1-4). 페이지는 네 덩어리다:
 *  ① 현황 타일 — 상품·콘텐츠 개수, 검증·dead, 몰별·출처별, 마지막 갱신 (BFF GET /api/admin/catalog)
 *  ② 웹 검색 시딩 잡 — 검색 단위(제품 유형 42 × 고른 조건 축)를 서버 잡(core KV `catalog-seed-job`)으로 시작하고, 이 탭이 드라이버가 되어
 *     step 을 반복 호출해 4단위씩(한 라운드) 전진시킨다(단위마다 LLM+web_search 1회 — 비용 발생, 시작 전 확인). 상태·진행·회차 기록·결과는 서버에 있어
 *     다른 탭이나 배치 스크립트(apps/bff/scripts/seed-search.mjs)가 돌려도 여기서 같은 것을 본다(드라이버가 없으면 10초마다 조회).
 *  ③ 그 밖의 재료 — 지난 쓰레드 계획 수확(백필, 실주행은 7단계가 자동), 올리브영 사내 Mongo 내보내기·다른 몰 행 JSON 가져오기
 *  ④ 점검 — 상품 링크 점검(지마켓 썸네일·그 밖 몰 상품 주소 HEAD → dead/verified, 올리브영·쿠팡은 확인 불가라 건너뜀) + 이 화면의 작업 로그
 * 스튜디오 SRP 스냅샷·데모 카탈로그는 시딩 재료가 아니다. core 표가 없으면(마이그레이션 0005 전) 안내만 보인다.
 */
const CHUNK = 500
const SEED_BATCH = 4 // 서버 회차 = 4단위 한 라운드(약 2~3분)
const POLL_MS = 10_000
const BUSY_WAIT_MS = 15_000
const LOG_LIMIT = 30

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '')
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const elapsedOf = (from, to) => {
  if (!from) return ''
  const sec = Math.max(0, Math.round((new Date(to || Date.now()) - new Date(from)) / 1000))
  return sec >= 3600 ? `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분` : sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`
}
const n = (v) => Number(v || 0).toLocaleString('ko-KR')

export default function AdminSeeding({ api }) {
  const [wire, setWire] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [logs, setLogs] = useState([]) // 이 화면의 작업 로그 [{ at, text, fail }]
  const [facets, setFacets] = useState([])
  const [dense, setDense] = useState(false)
  const [harvestLimit, setHarvestLimit] = useState(100)
  const [verifyLimit, setVerifyLimit] = useState(50)
  const [verifyMall, setVerifyMall] = useState('*')
  const [job, setJob] = useState(null)
  const [driving, setDriving] = useState(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const drivingRef = useRef(false)

  const pushLog = useCallback((text, fail = false) => {
    setLogs((prev) => [{ at: new Date().toISOString(), text, fail }, ...prev].slice(0, LOG_LIMIT))
  }, [])
  const toggleFacet = (key) => setFacets((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  const reload = useCallback(async () => {
    try {
      setWire(await fetchAdminCatalog())
      setError('')
    } catch (e) {
      setError(e?.message || '카탈로그 현황을 읽지 못했어요.')
    }
  }, [])
  const reloadJob = useCallback(async () => {
    try {
      const { job: next } = await fetchSeedJob()
      setJob(next)
      return next
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    reload()
    reloadJob()
  }, [reload, reloadJob])

  /* 드라이버가 아닐 때 — 잡이 돌고 있으면(다른 탭·스크립트) 주기적으로 진행을 본다 */
  useEffect(() => {
    if (driving || !job || job.status !== 'running') return undefined
    const timer = setInterval(() => {
      reloadJob()
      reload()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [driving, job, reloadJob, reload])

  /* 드라이버 루프 — step 을 연달아 부른다. busy(다른 드라이버 잠금)면 잠깐 쉬고, done·paused·오류면 멈춘다.
     탭을 닫으면 멈추지만 상태는 서버에 남아 「이 탭에서 돌리기」나 스크립트로 이어진다 */
  const drive = useCallback(async () => {
    if (drivingRef.current) return
    drivingRef.current = true
    setDriving(true)
    pushLog('이 탭이 시딩 잡을 돌리기 시작했어요.')
    try {
      for (;;) {
        let res
        try {
          res = await stepSeedJob()
        } catch (e) {
          pushLog(`회차 요청 실패 — ${e?.message || e} (15초 뒤 다시 시도)`, true)
          await new Promise((r) => setTimeout(r, BUSY_WAIT_MS))
          if (!drivingRef.current) break
          continue
        }
        setJob(res.job)
        if (!res.job || res.job.status !== 'running') {
          if (res.job?.status === 'done') pushLog(`시딩 잡 완료 — 상품 ${n(res.job.products)}개(검증 ${n(res.job.verified)}) · 실패 ${res.job.failed.length}단위.`)
          break
        }
        if (res.busy) await new Promise((r) => setTimeout(r, BUSY_WAIT_MS))
        else reload()
        if (!drivingRef.current) break
      }
    } finally {
      drivingRef.current = false
      setDriving(false)
      reload()
    }
  }, [reload, pushLog])
  useEffect(() => () => { drivingRef.current = false }, [])

  const run = async (label, fn) => {
    setBusy(label)
    try {
      const message = await fn()
      if (message) pushLog(message)
      await reload()
    } catch (e) {
      pushLog(`${label} 실패 — ${e?.message || e}`, true)
    } finally {
      setBusy('')
    }
  }

  const queries = catalogSeedQueries({ facets })
  const perQuery = dense ? CATALOG_SEED_COST_PER_QUERY_USD.dense : CATALOG_SEED_COST_PER_QUERY_USD.normal
  const facetLabel = facets.length ? facets.map((f) => CATALOG_SEED_FACETS[f].label).join('·') : '없음'

  const startJob = () =>
    run('시딩 시작', async () => {
      if (job && job.status !== 'done') {
        if (!window.confirm('진행 중인 시딩 잡이 있어요. 버리고 새로 시작할까요? (이어 돌리려면 「이 탭에서 돌리기」)')) return ''
      }
      if (
        !window.confirm(
          `검색 단위 ${queries.length}개(유형 ${CATALOG_SEED_KEYWORDS.length} × 조건 ${facetLabel}${dense ? ' · 촘촘히' : ''})를 웹 검색으로 시딩합니다.\n단위마다 웹 검색 ${dense ? '4' : '2~3'}회 — 약 ${Math.ceil((queries.length / SEED_BATCH) * 2.5)}분, LLM·검색 비용 약 $${(queries.length * perQuery).toFixed(0)}. 시작 뒤 이 탭이 돌립니다(탭을 닫아도 진행은 서버에 남아요).`,
        )
      )
        return ''
      const { job: started } = await startSeedJob({ facets, dense, reset: true })
      setJob(started)
      drive()
      return `시딩 잡 시작 — 검색 단위 ${started.total}개 (조건 ${facetLabel}${dense ? ' · 촘촘히' : ''}).`
    })

  const harvest = () =>
    run('수확', async () => {
      const r = await harvestAdminCatalog(Math.min(Math.max(Number(harvestLimit) || 100, 1), 500))
      return `쓰레드 수확 — ${r.threads}개 중 계획 ${r.plans}건에서 상품 ${r.products} · 콘텐츠 ${r.contents}개를 올렸어요.`
    })

  const verify = () =>
    run('점검', async () => {
      const limit = Math.min(Math.max(Number(verifyLimit) || 50, 1), 200)
      const r = await verifyAdminCatalog(limit, verifyMall)
      return `상품 링크 점검(${verifyMall === '*' ? '전체' : verifyMall} ${limit}개) — 살아 있음 ${r.alive} · 내려감(dead) ${r.dead} · 건너뜀 ${r.skipped}${verifyMall === '*' ? ' (올리브영·쿠팡은 확인 불가라 건너뜀)' : ''}.`
    })

  /* JSON 파일 가져오기 — 올리브영(사내 Mongo export: tagging-api scripts/export-catalog.mjs)·다른 몰의 행 파일.
     `{ products: [...], contents: [...] }` 또는 상품 행 배열. 500개씩 나눠 올린다 */
  const importFile = (file) =>
    run('가져오기', async () => {
      const parsed = JSON.parse(await file.text())
      const products = Array.isArray(parsed) ? parsed : parsed.products ?? []
      const contents = Array.isArray(parsed) ? [] : parsed.contents ?? []
      if (!products.length && !contents.length) return '파일에 products/contents 행이 없어요.'
      let sentP = 0
      let sentC = 0
      for (let i = 0; i < products.length; i += CHUNK) {
        sentP += (await importAdminCatalog({ products: products.slice(i, i + CHUNK) })).products
      }
      for (let i = 0; i < contents.length; i += CHUNK) {
        sentC += (await importAdminCatalog({ contents: contents.slice(i, i + CHUNK) })).contents
      }
      const malls = [...new Set(products.map((p) => p.mall).filter(Boolean))].join('·')
      return `${file.name} — 상품 ${sentP}${malls ? ` (${malls})` : ''} · 콘텐츠 ${sentC}개를 올렸어요.`
    })

  const stats = wire?.stats
  const available = Boolean(wire?.available)
  const jobDone = job ? job.cursor + job.retryCursor : 0
  const jobTotal = job ? job.total + job.retry.length : 0
  const jobPct = jobTotal ? Math.min(100, Math.round((jobDone / jobTotal) * 100)) : 0
  const otherDriving = job?.lockUntil && new Date(job.lockUntil) > new Date()
  const jobStatusLabel = !job ? '' : job.status === 'done' ? '완료' : job.status === 'paused' ? '일시정지' : driving ? '이 탭이 돌리는 중' : otherDriving ? '다른 드라이버가 돌리는 중' : '대기 — 돌리는 곳이 없어요'
  const remaining = job ? jobTotal - jobDone : 0
  const eta = job && job.status === 'running' && remaining ? `약 ${Math.ceil((remaining / SEED_BATCH) * 2.5)}분 남음` : ''
  const jobCost = job ? job.webSearchRequests * 0.01 + (job.cursor + job.retryCursor) * (job.dense ? 0.14 : 0.11) : 0
  const history = job?.history || []
  const visibleHistory = showAllHistory ? history : history.slice(0, 10)
  const mallOptions = ['*', ...new Set((stats?.products.byMall || []).map((m) => m.mall))]

  return (
    <div className="sb-seeding">
      <header className="sb-admin-pagehead">
        <div>
          <p className="sb-admin-pagehead__eyebrow">내재화 카탈로그</p>
          <h1>데이터 시딩</h1>
          <p>추천에 쓸 상품·참고 콘텐츠를 우리 DB에 쌓습니다. 계획 생성은 이 표 절반 + 웹 검색 절반으로 고르니, 표가 찰수록 응답이 빨라지고 상세 페이지 주소가 정확해집니다.</p>
        </div>
        <span className={`sb-admin-health${available ? '' : ' is-lab'}`}><i /> {error ? '카탈로그 연결 안 됨' : available ? `카탈로그 연결됨${stats?.updatedAt ? ` · 갱신 ${fmtDateTime(stats.updatedAt)}` : ''}` : '카탈로그 표 없음'}</span>
      </header>

      {error && <p className="sb-catalog-note is-warn">{error}</p>}
      {wire && !available && (
        <section className="sb-admin-card sb-seeding__card">
          <h2>카탈로그 표가 아직 없어요</h2>
          <p>{wire.note || 'core 마이그레이션(0005_catalog_internalize)을 적용하면 이 페이지가 살아납니다.'}</p>
          <div className="sb-seeding__row">
            <button
              type="button"
              className="sb-btn sb-btn--primary sb-btn--small"
              disabled={Boolean(busy)}
              onClick={() => run('표 만들기', async () => {
                const r = await migrateAdminCatalog()
                setWire(r.catalog)
                return r.created ? '카탈로그 표를 만들었어요 (마이그레이션 0005 적용, drizzle 이력 기록).' : '카탈로그 표가 이미 있었어요 — 현황을 다시 읽었어요.'
              })}
            >
              {busy === '표 만들기' ? '만드는 중…' : '여기서 표 만들기'}
            </button>
            <span>core 가 자기 DB 연결로 표 2개·인덱스·pg_trgm 확장을 만들고 drizzle 이력에 남깁니다. 터미널에서 하려면:</span>
          </div>
          <code className="sb-seeding__code">npm run db:migrate --workspace=apps/core</code>
        </section>
      )}

      {stats && available && (
        <div className="sb-catalog-stats">
          <div className="sb-catalog-stat">
            <b>{n(stats.products.total)}</b>
            <span>상품 · 검증 {n(stats.products.verified)}{stats.products.dead ? ` · 내려감 ${n(stats.products.dead)}` : ''}</span>
            <small>{(stats.products.byMall || []).slice(0, 5).map((m) => `${m.mall} ${n(m.count)}`).join(' · ') || '몰별 없음'}</small>
          </div>
          <div className="sb-catalog-stat">
            <b>{n(stats.contents.total)}</b>
            <span>참고 콘텐츠 · 검증 {n(stats.contents.verified)}</span>
            <small>{(stats.contents.byType || []).map((t) => `${t.type === 'video' ? '영상' : '게시글'} ${n(t.count)}`).join(' · ') || '아직 없음'}</small>
          </div>
          <div className="sb-catalog-stat">
            <b>{(stats.products.bySource || []).length}</b>
            <span>상품 출처</span>
            <small>{(stats.products.bySource || []).map((s) => `${{ search: '웹 검색', thread: '쓰레드 수확', manual: '가져오기' }[s.source] || s.source} ${n(s.count)}`).join(' · ') || '아직 없음'}</small>
          </div>
          <div className="sb-catalog-stat">
            <b>{job ? `${jobPct}%` : '—'}</b>
            <span>웹 검색 시딩 잡{job ? ` · ${jobStatusLabel}` : ''}</span>
            <small>{job ? `${n(jobDone)}/${n(jobTotal)} 단위 · 상품 ${n(job.products)}` : '아직 돌린 적 없음'}</small>
          </div>
        </div>
      )}

      <div className="sb-seeding__grid">
        <div className="sb-seeding__col">
          <section className="sb-admin-card sb-seeding__card" aria-label="웹 검색 시딩 잡">
            <h2>✦ 웹 검색으로 시딩</h2>
            <p>제품 유형 {CATALOG_SEED_KEYWORDS.length}개마다(조건을 고르면 유형 × 조건마다) AI가 실제 웹 검색으로 판매 상품 8~12개를 모아 저장합니다. 지마켓·올리브영·쿠팡은 상품 번호로 주소가 확인된 것만, 검색 결과 페이지 주소는 버립니다.</p>
            <div className="sb-catalog-seedopts">
              <span className="sb-catalog-seedopts__label">조건</span>
              {Object.entries(CATALOG_SEED_FACETS).map(([key, def]) => (
                <label key={key} className={`sb-catalog-chip${facets.includes(key) ? ' is-on' : ''}`} title={def.values.join(' · ')}>
                  <input type="checkbox" checked={facets.includes(key)} disabled={Boolean(busy) || driving} onChange={() => toggleFacet(key)} />
                  {def.label} ×{def.values.length}
                </label>
              ))}
              <label className={`sb-catalog-chip${dense ? ' is-on' : ''}`}>
                <input type="checkbox" checked={dense} disabled={Boolean(busy) || driving} onChange={() => setDense((v) => !v)} />
                촘촘히 (검색 4회·16개)
              </label>
            </div>
            <div className="sb-seeding__row">
              <span>검색 단위 <b>{n(queries.length)}</b>개 · 예상 비용 약 <b>${(queries.length * perQuery).toFixed(0)}</b> · 약 {Math.ceil((queries.length / SEED_BATCH) * 2.5)}분</span>
              <button type="button" className="sb-btn sb-btn--ai sb-btn--small" disabled={!available || Boolean(busy) || driving} onClick={startJob}>
                ✦ 시딩 잡 시작
              </button>
            </div>

            {job && (
              <div className="sb-seedjob" aria-live="polite">
                <div className="sb-seedjob__head">
                  <span>
                    <b>{jobStatusLabel}</b> · 조건 {job.facets.length ? job.facets.map((f) => CATALOG_SEED_FACETS[f]?.label || f).join('·') : '없음'}{job.dense ? ' · 촘촘히' : ''}{job.types?.length ? ` · 유형 ${job.types.length}개` : ''}
                  </span>
                  <span>
                    {job.status === 'done' ? `${fmtDateTime(job.startedAt)} → ${fmtTime(job.finishedAt)} (${elapsedOf(job.startedAt, job.finishedAt)})` : `${fmtDateTime(job.startedAt)} 시작 · ${elapsedOf(job.startedAt)} 경과${eta ? ` · ${eta}` : ''}`}
                  </span>
                </div>
                <div className={`sb-seedjob__bar${job.status === 'running' ? ' is-running' : ''}`}><i style={{ width: `${jobPct}%` }} /></div>
                <div className="sb-seedjob__stats">
                  <span>진행 <b>{n(jobDone)}/{n(jobTotal)}</b> 단위 ({jobPct}%){job.retry.length ? ` · 재시도 ${job.retry.length - job.retryCursor}개 남음` : ''}</span>
                  <span>상품 <b>{n(job.products)}</b> (검증 {n(job.verified)})</span>
                  <span>웹 검색 <b>{n(job.webSearchRequests)}</b>회 · 비용 약 ${jobCost.toFixed(0)}</span>
                  {job.failed.length > 0 && <span>실패 <b>{job.failed.length}</b> 단위</span>}
                </div>
                {job.lastError && <p className="sb-seedjob__error">마지막 오류: {job.lastError} — 다음 회차에서 같은 단위를 다시 시도해요.</p>}
                <div className="sb-seedjob__actions">
                  {job.status === 'running' && !driving && (
                    <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={drive}>✦ 이 탭에서 돌리기</button>
                  )}
                  {job.status === 'running' && (
                    <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => run('일시정지', async () => { drivingRef.current = false; setJob((await pauseSeedJob()).job); return '시딩 잡을 일시정지했어요 — 지금 도는 회차는 끝까지 처리되고 멈춰요.' })}>일시정지</button>
                  )}
                  {job.status === 'paused' && (
                    <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={() => run('재개', async () => { setJob((await resumeSeedJob()).job); drive(); return '시딩 잡을 재개했어요.' })}>✦ 재개 (이 탭에서)</button>
                  )}
                  {job.status === 'done' && (
                    <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => run('정리', async () => { await clearSeedJob(); setJob(null); return '시딩 잡 기록을 지웠어요 (카탈로그 행은 그대로).' })}>기록 지우기</button>
                  )}
                  <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => { reloadJob(); reload() }}>새로고침</button>
                </div>
                {history.length > 0 && (
                  <>
                    <ul className={`sb-seedjob__history${showAllHistory ? ' is-full' : ''}`}>
                      {visibleHistory.map((h) => (
                        <li key={h.at} className={h.failed.length ? 'is-fail' : ''}>
                          {fmtTime(h.at)} {h.pass === 'retry' ? '[재시도] ' : ''}<b>{h.queries.join(' · ')}</b> → 상품 {h.products}(검증 {h.verified}) · 검색 {h.webSearchRequests}회{h.failed.length ? ` · 실패 ${h.failed.join(', ')}` : ''}
                        </li>
                      ))}
                    </ul>
                    {history.length > 10 && (
                      <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => setShowAllHistory((v) => !v)}>
                        {showAllHistory ? '최근 10회차만' : `이전 회차 ${history.length - 10}개 더 보기`}
                      </button>
                    )}
                  </>
                )}
                {job.status === 'done' && job.failed.length > 0 && (
                  <p className="sb-catalog-note is-warn">재시도까지 실패한 단위: {job.failed.join(', ')} — 새 잡을 그 유형만으로 돌리거나 그대로 두어도 돼요.</p>
                )}
              </div>
            )}

            <p className="sb-catalog-seedopts__hint">탭을 열어 두기 어려우면 같은 잡을 터미널에서 돌릴 수 있어요 — 진행은 어디서 돌려도 이 화면에 보입니다.</p>
            <code className="sb-seeding__code">npm run seed:search --workspace=apps/bff -- --bff &lt;BFF 주소&gt; --token &lt;BFF_SERVICE_TOKEN&gt; --facets skin,concern</code>
          </section>
        </div>

        <div className="sb-seeding__col">
          <section className="sb-admin-card sb-seeding__card" aria-label="쓰레드에서 수확">
            <h2>쓰레드에서 수확</h2>
            <p>지난 계획(plan 스텝)에서 검증 게이트를 통과한 상품·참고 콘텐츠를 표에 올립니다. 실주행은 계획이 기록될 때마다 자동으로 하니, 이 버튼은 지난 기록을 소급하는 백필입니다. 참고 콘텐츠는 이 길로만 쌓입니다.</p>
            <div className="sb-seeding__row">
              <label>최근 쓰레드 <input type="number" min="1" max="500" value={harvestLimit} onChange={(e) => setHarvestLimit(e.target.value)} disabled={Boolean(busy)} />개</label>
              <button type="button" className="sb-btn sb-btn--small" disabled={!available || Boolean(busy)} onClick={harvest}>{busy === '수확' ? '수확 중…' : '수확'}</button>
            </div>
          </section>

          <section className="sb-admin-card sb-seeding__card" aria-label="JSON 가져오기">
            <h2>JSON 가져오기</h2>
            <p>올리브영은 사내 Mongo(태깅 스튜디오와 같은 상품 문서)를 내보낸 파일로 한 번에 채웁니다. 다른 몰도 같은 행 형식이면 됩니다. 500개씩 나눠 올리고 같은 id는 덮어씁니다.</p>
            <ol className="sb-seeding__steps">
              <li>사내망에서 내보내기: <code className="sb-seeding__code">npm run export:catalog --workspace=apps/tagging-api -- --out oy.json</code></li>
              <li>그 파일을 여기서 올리거나, DB 에 직접: <code className="sb-seeding__code">npm run seed:catalog --workspace=apps/core -- --file oy.json</code></li>
            </ol>
            <div className="sb-seeding__row">
              <label className={`sb-btn sb-btn--ghost sb-btn--small${!available || busy ? ' is-disabled' : ''}`}>
                {busy === '가져오기' ? '가져오는 중…' : '파일 선택해서 올리기'}
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  disabled={!available || Boolean(busy)}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) importFile(file)
                  }}
                />
              </label>
              <span>형식: <code>{'{ products: [...], contents: [...] }'}</code> 또는 상품 행 배열</span>
            </div>
          </section>

          <section className="sb-admin-card sb-seeding__card" aria-label="상품 링크 점검">
            <h2>상품 링크 점검</h2>
            <p>오래 안 본 상품부터 상세 페이지가 살아 있는지 봅니다. 지마켓은 썸네일 주소, 그 밖의 몰은 상품 주소에 HEAD를 보내 404면 내려감(dead)으로 표시해 추천에서 빠지고, 200이면 검증됨으로 올립니다. 올리브영·쿠팡은 서버에서 닿지 못해 건너뜁니다.</p>
            <div className="sb-seeding__row">
              <label>몰 <select value={verifyMall} onChange={(e) => setVerifyMall(e.target.value)} disabled={Boolean(busy)}>
                {mallOptions.map((m) => <option key={m} value={m}>{m === '*' ? '전체' : m}</option>)}
              </select></label>
              <label><input type="number" min="1" max="200" value={verifyLimit} onChange={(e) => setVerifyLimit(e.target.value)} disabled={Boolean(busy)} />개</label>
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" disabled={!available || Boolean(busy)} onClick={verify}>{busy === '점검' ? '점검 중…' : '점검'}</button>
            </div>
          </section>

          <section className="sb-admin-card sb-seeding__card" aria-label="작업 로그">
            <h2>이 화면의 작업 로그</h2>
            {logs.length === 0 ? <p>아직 한 일이 없어요.</p> : (
              <ul className="sb-seeding__log">
                {logs.map((l) => <li key={l.at + l.text} className={l.fail ? 'is-fail' : ''}><time>{fmtTime(l.at)}</time>{l.text}</li>)}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
