#!/usr/bin/env node
/* 내재화 카탈로그 대량 시딩 드라이버 (2026-09-17) — 서버 시딩 잡(BFF `/api/admin/catalog/seed-job`, 상태는 core KV)을 시작하거나 이어받아
   `step` 을 반복 호출해 8단위씩 전진시킨다. 상태·진행·회차 기록·결과는 전부 서버에 있어 **운영 콘솔 「내재화 카탈로그」 카드가 실시간으로
   같은 것을 본다** — 이 스크립트는 탭을 열어 두지 않아도 되는 박자기일 뿐이다. 중단(Ctrl+C)해도 잡은 서버에 남고, 다시 실행하면 이어 돈다.

   사용법:
     node scripts/seed-search.mjs --bff https://ddak-bff.vercel.app --token $BFF_SERVICE_TOKEN                # 유형만(42 단위) 새 잡 시작·돌리기
     node scripts/seed-search.mjs --bff … --token … --facets skin,concern                                   # 유형 × 조건 (462 단위)
     node scripts/seed-search.mjs --bff … --token … --facets skin,concern,price,mall --dense                # 672 단위, 단위당 12~16개
     node scripts/seed-search.mjs --bff … --token … --types 쿠션,선크림,토너 --facets mall                    # 일부 유형만
     node scripts/seed-search.mjs --bff … --token … --resume                                                # 진행 중인 잡을 이어 돌린다 (옵션 무시)
     node scripts/seed-search.mjs --bff … --token … --status                                                # 진행만 출력
     node scripts/seed-search.mjs --facets skin,concern --dry-run                                           # 검색 단위·예상 비용만 (서버 안 부름)

   --facets  skin(피부 타입 4)·concern(고민 6)·price(가격대 2)·mall(몰 3) 중 골라 쉼표로. 비우면 유형만
   --types   제품 유형 일부만 (@ddak/pipeline CATALOG_SEED_KEYWORDS 의 정식 이름)
   --dense   검색 4회·16개까지 (단위당 약 $0.18, 기본 $0.14)
   --tick    정기 실행용 — 진행 중(running) 잡이 있으면 이어 돌리고 없으면 0 으로 조용히 끝난다 (GitHub Actions schedule)
   --resume  진행 중·일시정지 잡을 이어 돌린다. 없이 실행했는데 진행 중 잡이 있으면 묻지 않고 그 잡을 이어 돈다(진행을 날리지 않게) — 새로
             시작하려면 --reset
   --reset   진행 중 잡을 버리고 새로 시작
   BFF 는 Vercel 서버리스라 한 회차(8단위)가 300초 안에 끝나야 한다 — 서버가 회차마다 잠금(270초)을 걸어 콘솔 탭과 이 스크립트가 같은 잡을
   동시에 밀지 않는다(busy 면 15초 쉬고 다시). 비용 근사: 검색 1회 $0.01, Opus 입력 $5/MTok·출력 $25/MTok. */
import { CATALOG_SEED_COST_PER_QUERY_USD, CATALOG_SEED_FACETS, catalogSeedQueries } from '@ddak/pipeline'

function parseArgs(argv) {
  const out = { bff: '', token: process.env.BFF_SERVICE_TOKEN || '', facets: [], types: [], dense: false, resume: false, tick: false, reset: false, status: false, dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--bff') out.bff = argv[++i]
    else if (a === '--token') out.token = argv[++i]
    else if (a === '--facets') out.facets = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--types') out.types = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--dense') out.dense = true
    else if (a === '--resume') out.resume = true
    else if (a === '--tick') out.tick = true
    else if (a === '--reset') out.reset = true
    else if (a === '--status') out.status = true
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const bad = args.facets.filter((f) => !CATALOG_SEED_FACETS[f])
if (bad.length) {
  console.error(`모르는 조건 축: ${bad.join(', ')} — 가능: ${Object.keys(CATALOG_SEED_FACETS).join(', ')}`)
  process.exit(1)
}
const perQuery = args.dense ? CATALOG_SEED_COST_PER_QUERY_USD.dense : CATALOG_SEED_COST_PER_QUERY_USD.normal
if (args.dryRun) {
  const queries = catalogSeedQueries({ types: args.types, facets: args.facets })
  console.log(`검색 단위 ${queries.length}개 (유형 ${new Set(queries.map((q) => q.keyword)).size} × 조건 ${args.facets.join('+') || '없음'}) · 예상 비용 약 $${(queries.length * perQuery).toFixed(0)}${args.dense ? ' · dense' : ''}`)
  for (const q of queries.slice(0, 30)) console.log(`  ${q.keyword} ← ${q.query}`)
  if (queries.length > 30) console.log(`  … 외 ${queries.length - 30}개`)
  process.exit(0)
}
if (!args.bff) {
  console.error('--bff <BFF 주소> 가 필요합니다 (예: https://ddak-bff.vercel.app)')
  process.exit(1)
}
const base = args.bff.replace(/\/$/, '')
const headers = { 'content-type': 'application/json', ...(args.token ? { authorization: `Bearer ${args.token}` } : {}) }
const api = async (method, path, body) => {
  const res = await fetch(`${base}/api/admin/catalog${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${path}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const doneOf = (job) => job.cursor + job.retryCursor
const totalOf = (job) => job.total + job.retry.length
const line = (job) => {
  const done = doneOf(job)
  const total = totalOf(job)
  const pct = total ? Math.round((done / total) * 100) : 0
  return `${job.status} · ${done}/${total} (${pct}%) · 상품 ${job.products}(검증 ${job.verified}) · 검색 ${job.webSearchRequests}회 · 실패 ${job.failed.length}${job.retry.length ? ` · 재시도 대기 ${job.retry.length - job.retryCursor}` : ''}`
}

let { job } = await api('GET', '/seed-job')
if (args.status) {
  console.log(job ? line(job) : '시딩 잡 없음')
  process.exit(0)
}
if (job && (job.status === 'running' || (job.status === 'paused' && !args.tick)) && !args.reset) {
  console.log(`진행 중인 잡을 이어 돌립니다 — ${line(job)} (새로 시작하려면 --reset)`)
  if (job.status === 'paused') {
    job = (await api('POST', '/seed-job/resume')).job
    console.log('일시정지 잡을 재개했어요')
  }
} else if (args.tick) {
  // 정기 틱(GitHub Actions schedule) — 돌릴 잡이 없으면 조용히 끝난다 (running 이면 위 분기에서 이어 돈다)
  console.log(job ? `틱 — 잡 상태 ${job.status}, 돌릴 것 없음` : '틱 — 시딩 잡 없음')
  process.exit(0)
} else if (!args.resume) {
  const queries = catalogSeedQueries({ types: args.types, facets: args.facets })
  console.log(`새 잡 — 검색 단위 ${queries.length}개 (조건 ${args.facets.join('+') || '없음'}${args.dense ? ' · dense' : ''}) · 예상 비용 약 $${(queries.length * perQuery).toFixed(0)}`)
  job = (await api('POST', '/seed-job', { facets: args.facets, types: args.types, dense: args.dense, reset: args.reset })).job
} else {
  console.log('이어 돌릴 잡이 없어요 (--resume 을 빼고 새로 시작하세요)')
  process.exit(1)
}

let stopping = false
process.on('SIGINT', () => {
  stopping = true
  console.log('\n중단 요청 — 지금 회차가 끝나면 멈춥니다 (잡은 서버에 남아 다시 실행하면 이어 돌아요)')
})
const startedAt = Date.now()
while (!stopping) {
  let res
  try {
    res = await api('POST', '/seed-job/step')
  } catch (e) {
    console.error(`  회차 요청 실패 — ${e.message} (15초 뒤 재시도)`)
    await sleep(15_000)
    continue
  }
  job = res.job
  if (!job) {
    console.log('잡이 사라졌어요 (다른 곳에서 지움)')
    break
  }
  if (res.busy) {
    console.log(`  다른 드라이버가 돌리는 중 — ${line(job)} (15초 대기)`)
    await sleep(15_000)
    continue
  }
  const last = job.history[0]
  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  if (last) console.log(`  ${last.pass === 'retry' ? '[재시도] ' : ''}${last.queries.join(' · ')} → 상품 ${last.products}(검증 ${last.verified}) 검색 ${last.webSearchRequests}회${last.failed.length ? ` 실패 ${last.failed.join(',')}` : ''} · ${line(job)} · ${elapsed}s`)
  if (job.lastError) console.error(`  마지막 오류: ${job.lastError}`)
  if (job.status !== 'running') break
}
console.log(job ? `✔ ${line(job)} — 운영 콘솔 「내재화 카탈로그」 카드에서 같은 진행·회차 기록을 볼 수 있어요` : '끝')
