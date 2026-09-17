#!/usr/bin/env node
/*
 * 검색 결과 페이지(SRP) 목업의 재료 스냅샷 — 지마켓 모바일 검색(공개 페이지)의 __NEXT_DATA__ 에서 뷰티 카테고리
 * (화장품/향수 100000005 · 바디/헤어 100000071) 상품만 골라 `src/data/srpSnapshot.json` 에 굳힌다. 화면은 이 파일만 읽고 런타임 fetch 는 없다
 * (브라우저는 CORS 로 못 부르고, 목업은 같은 검색어에 같은 화면이 나와야 한다).
 *
 *   node scripts/snapshot-srp.mjs            # 전체 어휘 갱신 (약 40개 검색어 × 2쪽, 1~2분)
 *   node scripts/snapshot-srp.mjs 쿠션 선크림  # 일부만 갱신 (나머지 검색어는 기존 파일 값 유지)
 *
 * 항목은 카드에 필요한 것만 짧은 키로 남긴다 — no(상품 번호: 썸네일 gdimg.gmarket.co.kr/{no}/still/280 · 상세 m.gmarket.co.kr/vi/product/{no}
 * 둘 다 이 번호로 결정된다), name, brand, price, before(할인 전), dc(할인율 %), star, reviews, buys(구매 수), ship('free' | 배송비 숫자),
 * smile(스마일·스타배송), today(오늘출발), official('공식' | '홈쇼핑'), emblem('빅세일' 등 프로모션 엠블럼), ad, soldOut, isNew, related(옵션 묶음).
 * 검색어당 상한 24개(41개 어휘 × 약 5KB — SRP 청크에만 실린다). 실제 결과는 6할이 CPC 광고(trafficType=ad)라 그대로 담으면 광고 목록이
 * 되므로 **일반 상품을 우선 담고 광고는 앞쪽 3개까지만** ad 표식으로 남긴다(노출 순서는 유지 — 화면이 자리를 정한다).
 * 사내망(TLS 검사 프록시)에서는 `NODE_EXTRA_CA_CERTS=<시스템 키체인 번들.pem>` 이 필요하다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../src/data/srpSnapshot.json')
const BEAUTY_LCODES = new Set(['100000005', '100000071']) // 화장품/향수 · 바디/헤어 (샴푸·바디워시·핸드크림은 뒤쪽 카테고리)
const PER_KEYWORD = 24
const MAX_ADS = 3
const PAGES = 2
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/* lib/searchCatalog.js SEARCH_VOCAB 와 같은 어휘 — 검색어 → 이 표의 키로 해석한다(srpMock.js). 새 어휘를 더하면 여기도 같이 */
/* 검색어 → 실제로 던질 질의 (같으면 생략). 「토너」는 프린터 토너가 첫 두 쪽을 덮어 뷰티 상품이 2개뿐이라 질의만 바꾼다 */
const FETCH_QUERY = { '토너': '스킨 토너' }
const KEYWORDS = [
  '쿠션', '파운데이션', '컨실러', '파우더', '프라이머', '픽서', '선크림', '선스틱', '토너', '토너패드', '세럼', '앰플', '에센스',
  '크림', '수분크림', '로션', '미스트', '마스크팩', '클렌징 폼', '클렌징 오일', '클렌저', '립스틱', '틴트', '립밤', '립글로스',
  '아이섀도', '아이라이너', '마스카라', '아이브로우', '블러셔', '하이라이터', '컨투어', '바디워시', '바디로션', '샴푸',
  '트리트먼트', '헤어 오일', '향수', '핸드크림', '메이크업 베이스', '톤업크림',
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const text = (o) => (o && typeof o === 'object' ? String(o.text ?? '') : String(o ?? ''))

/* 화면에 쓰지 않는 추적 필드는 버리고 카드 재료만 */
function compact(row) {
  const c = row.commonItemInfo || {}
  const item = c.item || {}
  const price = c.price || {}
  const score = c.score || {}
  const shipText = (c.deliveryTags || []).map((d) => text(d.text)).find(Boolean) || (c.tags || []).map(text).find(Boolean) || ''
  const lmo = (c.lmoTagList || []).flatMap((l) => (l.content || []).map(text)).join(' ')
  const official = c.sellerOfficialTag?.title || ''
  const out = {
    no: String(row.itemNo || ''),
    name: text(item).trim(),
    brand: text(c.brand).trim(),
    price: num(price.binPrice || text(price.price)),
  }
  const before = num(text(price.beforePrice))
  if (before > out.price) out.before = before
  const dc = num(text(price.dcRate))
  if (dc) out.dc = dc
  const star = Number(score.avgStarScore)
  if (star > 0) out.star = star
  const reviews = num(text(score.feedbackCount))
  if (reviews) out.reviews = reviews
  const buys = num(text(score.payCount))
  if (buys) out.buys = buys
  out.ship = /무료/.test(shipText) ? 'free' : num(shipText) || 'free'
  if (row.modelName === 'ItemCardSmile' || /스마일배송|스타배송/.test(lmo) || row.smileImageTag) out.smile = true
  if (/오늘출발/.test(lmo)) out.today = true
  if (official && official !== '스마일배송') out.official = official
  if (c.promotionEmblem?.altText) out.emblem = String(c.promotionEmblem.altText)
  if (row.atsClickUrl) out.ad = true
  if (row.isSoldOut) out.soldOut = true
  if (row.isNewItem) out.isNew = true
  if (c.relatedGroupNo && c.relatedGroupNo !== '0') out.related = true
  return out
}

/* 카드 행(itemNo + commonItemInfo)을 깊이 상관없이 모은다 — 일반·스마일·홈쇼핑·광고 묶음(itemCardList) 전부 */
function collectRows(node, out, isAd = false) {
  if (Array.isArray(node)) {
    for (const v of node) collectRows(v, out, isAd)
    return
  }
  if (!node || typeof node !== 'object') return
  if (node.itemNo && node.commonItemInfo) {
    out.push(isAd ? { ...node, atsClickUrl: node.atsClickUrl || 'ad' } : node)
    return
  }
  const ad = isAd || node.title?.description === '광고'
  for (const v of Object.values(node)) collectRows(v, out, ad)
}

async function fetchPage(keyword, page) {
  const q = FETCH_QUERY[keyword] || keyword
  const url = `https://m.gmarket.co.kr/n/search?keyword=${encodeURIComponent(q)}${page > 1 ? `&p=${page}` : ''}`
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow' })
  if (!res.ok) throw new Error(`${keyword} p${page}: HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error(`${keyword} p${page}: __NEXT_DATA__ 없음`)
  const json = m[1]
  const data = JSON.parse(json)
  const regions = data?.props?.pageProps?.initialStates?.curatorData?.regionsData || {}
  const rows = []
  collectRows(regions.content, rows)
  const total = Number((json.match(/"itemCount":(\d+)/) || [])[1]) || 0
  return { rows, total }
}

async function snapshotKeyword(keyword) {
  const seen = new Set()
  const all = [] // 노출 순서대로 (광고 포함)
  let total = 0
  for (let p = 1; p <= PAGES; p++) {
    const { rows, total: t } = await fetchPage(keyword, p)
    total = total || t
    for (const row of rows) {
      if (!BEAUTY_LCODES.has(row.category?.lCode)) continue
      const it = compact(row)
      if (!it.no || !it.name || !it.price || seen.has(it.no)) continue
      seen.add(it.no)
      all.push(it)
    }
    if (all.filter((it) => !it.ad).length >= PER_KEYWORD) break
    await sleep(300)
  }
  // 일반 상품 우선, 광고는 앞쪽 MAX_ADS 개까지 — 뽑은 뒤 노출 순서로 되돌린다
  const ads = all.filter((it) => it.ad).slice(0, MAX_ADS)
  const organic = all.filter((it) => !it.ad).slice(0, PER_KEYWORD - ads.length)
  const picked = new Set([...organic, ...ads])
  return { total, items: all.filter((it) => picked.has(it)) }
}

async function main() {
  const only = process.argv.slice(2).filter(Boolean)
  let prev = { keywords: {} }
  try {
    prev = JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    /* 첫 실행 */
  }
  const keywords = { ...(prev.keywords || {}) }
  const targets = only.length ? only : KEYWORDS
  for (const kw of targets) {
    try {
      const snap = await snapshotKeyword(kw)
      keywords[kw] = snap
      console.log(`${kw}: ${snap.items.length}개 (전체 ${snap.total.toLocaleString('ko-KR')})`)
    } catch (e) {
      console.error(`${kw}: 실패 — ${e.message}${keywords[kw] ? ' (기존 값 유지)' : ''}`)
    }
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString().slice(0, 10), source: 'm.gmarket.co.kr/n/search', keywords }, null, 0) + '\n')
  const kb = Math.round(readFileSync(OUT).length / 1024)
  console.log(`→ ${OUT} (${Object.keys(keywords).length}개 검색어, ${kb}KB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
