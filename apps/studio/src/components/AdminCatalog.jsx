import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearSeedJob,
  fetchAdminCatalog,
  fetchSeedJob,
  harvestAdminCatalog,
  importAdminCatalog,
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
 * 내재화 카탈로그 카드 (v29, 2026-09-17) — 계획 생성이 「웹 검색만」이 아니라 「내부 DB 절반 + 웹 검색 절반」으로 상품·콘텐츠를
 * 고르게 하는 표의 운영 자리. 현황(개수·몰별·출처별·검증·dead)과 시딩 재료 세 가지 + 점검:
 *  - 웹 검색 시딩 잡: 검색 단위(제품 유형 42 × 고른 조건 축)를 서버 잡(core KV `catalog-seed-job`)으로 시작하고, 「이 탭에서 돌리기」가
 *    `step` 을 반복 호출해 8단위씩 전진시킨다(단위마다 LLM+web_search 1회 — 비용 발생). 상태는 서버에 있으니 다른 탭·배치 스크립트
 *    (apps/bff/scripts/seed-search.mjs)가 돌려도 이 카드가 같은 진행·회차 기록·결과를 본다(돌리는 드라이버가 없으면 10초마다 조회).
 *  - 쓰레드에서 수확: 지난 계획(plan 스텝)의 검증 통과 상품·콘텐츠를 백필한다 — 실주행은 7단계 기록이 자동으로 한다.
 *  - JSON 가져오기: 올리브영 사내 Mongo 내보내기(tagging-api export:catalog)·다른 몰의 행 파일.
 *  - 상품 링크 점검: 지마켓은 썸네일·그 밖의 몰은 상품 주소 HEAD 로 리스팅이 내려간 상품을 dead 로 표시한다 (올리브영·쿠팡은 확인 불가라 건너뜀).
 * 스튜디오 SRP 스냅샷·데모 카탈로그는 시딩 재료가 아니다(2026-09-17 결정). core 표가 없으면(마이그레이션 0005 전) available=false 안내만 보인다.
 */
const CHUNK = 500
const SEED_BATCH = 8
const POLL_MS = 10_000
const BUSY_WAIT_MS = 15_000

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '')
const elapsedOf = (from, to) => {
  if (!from) return ''
  const sec = Math.max(0, Math.round((new Date(to || Date.now()) - new Date(from)) / 1000))
  return sec >= 3600 ? `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분` : sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`
}

export default function AdminCatalog() {
  const [wire, setWire] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [log, setLog] = useState('')
  const [facets, setFacets] = useState([]) // 시딩 조건 축 (skin·concern·price·mall)
  const [dense, setDense] = useState(false)
  const [job, setJob] = useState(null)
  const [driving, setDriving] = useState(false) // 이 탭이 step 을 돌리는 드라이버인가
  const drivingRef = useRef(false)
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

  /* 드라이버 루프 — step 을 연달아 부른다. busy(다른 드라이버 잠금)면 잠깐 쉬고, done·paused·오류면 멈춘다. 탭을 닫으면 멈추지만
     상태는 서버에 남아 다시 「이 탭에서 돌리기」나 스크립트로 이어진다 */
  const drive = useCallback(async () => {
    if (drivingRef.current) return
    drivingRef.current = true
    setDriving(true)
    try {
      for (;;) {
        let res
        try {
          res = await stepSeedJob()
        } catch (e) {
          setLog(`전진 실패 — ${e?.message || e} (잠시 뒤 다시 시도)`)
          await new Promise((r) => setTimeout(r, BUSY_WAIT_MS))
          if (!drivingRef.current) break
          continue
        }
        setJob(res.job)
        if (!res.job || res.job.status !== 'running') break
        if (res.busy) await new Promise((r) => setTimeout(r, BUSY_WAIT_MS))
        if (!drivingRef.current) break
      }
    } finally {
      drivingRef.current = false
      setDriving(false)
      reload()
    }
  }, [reload])
  useEffect(() => () => { drivingRef.current = false }, [])

  const run = async (label, fn) => {
    setBusy(label)
    setLog('')
    try {
      const message = await fn()
      if (message) setLog(message)
      await reload()
    } catch (e) {
      setLog(`${label} 실패 — ${e?.message || e}`)
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
          `검색 단위 ${queries.length}개(유형 ${CATALOG_SEED_KEYWORDS.length} × 조건 ${facetLabel}${dense ? ' · 촘촘히' : ''})를 웹 검색으로 시딩합니다.\n단위마다 웹 검색 ${dense ? '4' : '2~3'}회 — 약 ${Math.ceil(queries.length / SEED_BATCH)}분, LLM·검색 비용 약 $${(queries.length * perQuery).toFixed(0)}. 시작 뒤 이 탭이 돌립니다(탭을 닫아도 진행은 서버에 남아요).`,
        )
      )
        return ''
      const { job: started } = await startSeedJob({ facets, dense, reset: true })
      setJob(started)
      drive()
      return `시딩 잡 시작 — 검색 단위 ${started.total}개. 이 탭이 돌리는 중이에요.`
    })

  const harvest = () =>
    run('수확', async () => {
      const r = await harvestAdminCatalog(100)
      return `쓰레드 ${r.threads}개 중 계획 ${r.plans}건에서 상품 ${r.products} · 콘텐츠 ${r.contents}개를 올렸어요.`
    })

  const verify = () =>
    run('점검', async () => {
      const r = await verifyAdminCatalog(50)
      return `상품 ${r.checked}개 점검 — 살아 있음 ${r.alive} · 내려감(dead) ${r.dead} · 건너뜀 ${r.skipped}(올리브영·쿠팡은 확인 불가라 건너뜀).`
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
        setLog(`가져오는 중… 상품 ${sentP}/${products.length}`)
      }
      for (let i = 0; i < contents.length; i += CHUNK) {
        sentC += (await importAdminCatalog({ contents: contents.slice(i, i + CHUNK) })).contents
        setLog(`가져오는 중… 콘텐츠 ${sentC}/${contents.length}`)
      }
      const malls = [...new Set(products.map((p) => p.mall).filter(Boolean))].join('·')
      return `${file.name} — 상품 ${sentP}${malls ? ` (${malls})` : ''} · 콘텐츠 ${sentC}개를 올렸어요.`
    })

  const stats = wire?.stats
  const available = Boolean(wire?.available)
  const malls = (stats?.products.byMall || []).slice(0, 4).map((m) => `${m.mall} ${m.count}`).join(' · ')
  const sources = (stats?.products.bySource || []).map((s) => `${s.source} ${s.count}`).join(' · ')
  const types = (stats?.contents.byType || []).map((t) => `${t.type === 'video' ? '영상' : '게시글'} ${t.count}`).join(' · ')
  const jobActive = job && job.status !== 'done'
  const jobDone = job?.total ? job.cursor + job.retryCursor : 0
  const jobTotal = job ? job.total + job.retry.length : 0
  const jobPct = jobTotal ? Math.min(100, Math.round((jobDone / jobTotal) * 100)) : 0
  const jobStatusLabel = !job ? '' : job.status === 'done' ? '완료' : job.status === 'paused' ? '일시정지' : driving ? '이 탭이 돌리는 중' : job.lockUntil && new Date(job.lockUntil) > new Date() ? '다른 드라이버가 돌리는 중' : '대기 — 드라이버 없음'
  const remaining = job ? jobTotal - jobDone : 0
  const eta = job && job.status === 'running' && remaining ? `약 ${Math.ceil(remaining / SEED_BATCH)}분 남음` : ''

  return (
    <section className="sb-admin-card sb-catalog-card" aria-label="내재화 카탈로그">
      <div className="sb-catalog-card__head">
        <div>
          <h2>내재화 카탈로그</h2>
          <p>추천 상품·참고 콘텐츠의 내부 표 — 계획 생성이 이 표 절반 + 웹 검색 절반으로 고릅니다. 재료는 셋: 제품 유형별 웹 검색 시딩 잡(✦, 실제 검색·비용 발생), 지난 쓰레드의 계획 수확(실주행은 자동), 올리브영 사내 Mongo 내보내기(tagging-api export:catalog) JSON 가져오기.</p>
        </div>
        <div className="sb-catalog-actions">
          <button type="button" className="sb-btn sb-btn--ai sb-btn--small" disabled={!available || Boolean(busy) || driving} onClick={startJob}>
            ✦ 웹 검색 시딩 시작
          </button>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" disabled={!available || Boolean(busy)} onClick={harvest}>
            {busy === '수확' ? '수확 중…' : '쓰레드에서 수확'}
          </button>
          <label className={`sb-btn sb-btn--ghost sb-btn--small${!available || busy ? ' is-disabled' : ''}`}>
            {busy === '가져오기' ? '가져오는 중…' : 'JSON 가져오기'}
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
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" disabled={!available || Boolean(busy)} onClick={verify}>
            {busy === '점검' ? '점검 중…' : '상품 링크 점검'}
          </button>
        </div>
      </div>
      {error && <p className="sb-catalog-note is-warn">{error}</p>}
      {wire && !available && <p className="sb-catalog-note is-warn">{wire.note || '카탈로그 표가 아직 없어요 — core 마이그레이션(0005_catalog_internalize)을 적용해 주세요.'}</p>}
      {stats && available && (
        <div className="sb-catalog-stats">
          <div className="sb-catalog-stat">
            <b>{stats.products.total.toLocaleString('ko-KR')}</b>
            <span>상품 · 검증 {stats.products.verified.toLocaleString('ko-KR')}{stats.products.dead ? ` · 내려감 ${stats.products.dead}` : ''}</span>
            {malls && <small>{malls}</small>}
          </div>
          <div className="sb-catalog-stat">
            <b>{stats.contents.total.toLocaleString('ko-KR')}</b>
            <span>참고 콘텐츠 · 검증 {stats.contents.verified.toLocaleString('ko-KR')}</span>
            {types && <small>{types}</small>}
          </div>
          <div className="sb-catalog-stat">
            <b>{sources ? stats.products.bySource.length : 0}</b>
            <span>상품 출처 종류</span>
            {sources && <small>{sources}</small>}
          </div>
          <div className="sb-catalog-stat">
            <b>{stats.updatedAt ? new Date(stats.updatedAt).toLocaleDateString('ko-KR') : '—'}</b>
            <span>마지막 갱신</span>
            <small>{stats.updatedAt ? fmtTime(stats.updatedAt) : '아직 없음'}</small>
          </div>
        </div>
      )}
      {available && (
        <div className="sb-catalog-seedopts">
          <span className="sb-catalog-seedopts__label">시딩 조건</span>
          {Object.entries(CATALOG_SEED_FACETS).map(([key, def]) => (
            <label key={key} className={`sb-catalog-chip${facets.includes(key) ? ' is-on' : ''}`}>
              <input type="checkbox" checked={facets.includes(key)} disabled={Boolean(busy) || driving} onChange={() => toggleFacet(key)} />
              {def.label} ×{def.values.length}
            </label>
          ))}
          <label className={`sb-catalog-chip${dense ? ' is-on' : ''}`}>
            <input type="checkbox" checked={dense} disabled={Boolean(busy) || driving} onChange={() => setDense((v) => !v)} />
            촘촘히 (검색 4회·16개)
          </label>
          <span className="sb-catalog-seedopts__est">
            검색 단위 {queries.length}개 · 예상 약 ${(queries.length * perQuery).toFixed(0)} · 약 {Math.ceil(queries.length / SEED_BATCH)}분
          </span>
          <span className="sb-catalog-seedopts__hint">탭을 열어 두기 어려우면 같은 잡을 터미널에서 돌릴 수 있어요: <code>npm run seed:search --workspace=apps/bff -- --bff &lt;BFF 주소&gt; --token &lt;토큰&gt; --facets skin,concern</code> — 진행은 어디서 돌려도 여기서 보입니다.</span>
        </div>
      )}
      {job && (
        <div className="sb-seedjob" aria-live="polite">
          <div className="sb-seedjob__head">
            <span>
              <b>웹 검색 시딩 잡</b> · {jobStatusLabel} · 조건 {job.facets.length ? job.facets.map((f) => CATALOG_SEED_FACETS[f]?.label || f).join('·') : '없음'}{job.dense ? ' · 촘촘히' : ''}
              {job.types?.length ? ` · 유형 ${job.types.length}개` : ''}
            </span>
            <span>
              {job.status === 'done' ? `시작 ${fmtTime(job.startedAt)} → 완료 ${fmtTime(job.finishedAt)} (${elapsedOf(job.startedAt, job.finishedAt)})` : `시작 ${fmtTime(job.startedAt)} · ${elapsedOf(job.startedAt)} 경과${eta ? ` · ${eta}` : ''}`}
            </span>
          </div>
          <div className={`sb-seedjob__bar${job.status === 'running' ? ' is-running' : ''}`}><i style={{ width: `${jobPct}%` }} /></div>
          <div className="sb-seedjob__stats">
            <span>진행 <b>{jobDone}/{jobTotal}</b> 단위 ({jobPct}%){job.retry.length ? ` · 재시도 대기 ${job.retry.length - job.retryCursor}` : ''}</span>
            <span>상품 <b>{job.products.toLocaleString('ko-KR')}</b> (검증 {job.verified.toLocaleString('ko-KR')})</span>
            <span>웹 검색 <b>{job.webSearchRequests}</b>회 · 비용 약 ${(job.webSearchRequests * 0.01 + (job.cursor + job.retryCursor) * (job.dense ? 0.14 : 0.11)).toFixed(0)}</span>
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
              <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={() => run('재개', async () => { setJob((await resumeSeedJob()).job); drive(); return '' })}>✦ 재개 (이 탭에서)</button>
            )}
            {job.status === 'done' && (
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => run('정리', async () => { await clearSeedJob(); setJob(null); return '시딩 잡 기록을 지웠어요 (카탈로그 행은 그대로).' })}>기록 지우기</button>
            )}
            <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => { reloadJob(); reload() }}>새로고침</button>
          </div>
          {job.history.length > 0 && (
            <ul className="sb-seedjob__history">
              {job.history.slice(0, 12).map((h) => (
                <li key={h.at} className={h.failed.length ? 'is-fail' : ''}>
                  {fmtTime(h.at)} {h.pass === 'retry' ? '[재시도] ' : ''}<b>{h.queries.join(' · ')}</b> → 상품 {h.products}(검증 {h.verified}) · 검색 {h.webSearchRequests}회{h.failed.length ? ` · 실패 ${h.failed.join(', ')}` : ''}
                </li>
              ))}
              {job.history.length > 12 && <li>… 이전 {job.history.length - 12}회차</li>}
            </ul>
          )}
          {job.status === 'done' && job.failed.length > 0 && (
            <p className="sb-catalog-note is-warn">재시도까지 실패한 단위: {job.failed.join(', ')} — 새 잡을 그 유형만으로 돌리거나 그대로 두어도 돼요.</p>
          )}
        </div>
      )}
      {log && <p className="sb-catalog-log">{log}</p>}
    </section>
  )
}
