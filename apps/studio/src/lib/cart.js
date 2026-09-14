/*
 * 담은 상품(cart) 항목 — 체험 1회(쓰레드)에 담긴 상품 목록의 형태와 읽기 규칙.
 *
 * 옛 기록은 상품 이름 문자열 배열이고, 새 기록은 상품 카드의 재료를 함께 실은 객체다
 *   { name, brand, price, mall, imageUrl, emoji, gradient, external, url, step }
 * (step = 카드가 붙어 있던 계획 단계 제목 — 쇼핑 쓰레드 상세 시트가 파트별로 묶는 키).
 * 두 형태가 같은 배열에 섞여 있어도 되므로 읽는 쪽은 언제나 cartEntry()/cartEntries()를 거친다.
 * 워크스페이스 쓰레드 기록(account:<id>:threads 행)과 라이브 cartAdd 이벤트 payload 가 같은 형태를 싣는다.
 */
import { livePlanSectionId } from './livePage.js'

export function cartEntry(entry) {
  if (entry && typeof entry === 'object') return entry
  return { name: String(entry || '') }
}

export const cartEntries = (cart) => (Array.isArray(cart) ? cart : []).map(cartEntry)

/* 상품 카드의 "담음" 판정 — 이름 기준 (같은 상품이 두 단계에 나와도 한 번만 담긴다) */
export const cartHas = (cart, name) => cartEntries(cart).some((entry) => entry.name === name)

/* "27,900" · "27900원" → 27900, 숫자가 없으면 null */
export function parsePrice(text) {
  const digits = String(text ?? '').replace(/[^0-9]/g, '')
  return digits ? Number(digits) : null
}

export const formatWon = (amount) => `${Number(amount).toLocaleString('ko-KR')}원`

/* 합계 — 가격이 하나도 없으면 null (옛 이름-만 기록) */
export function cartTotal(cart) {
  let sum = 0
  let any = false
  for (const entry of cartEntries(cart)) {
    const value = parsePrice(entry.price)
    if (value != null) {
      sum += value
      any = true
    }
  }
  return any ? sum : null
}

/* 단계 제목의 리치텍스트 마크업({{서식|텍스트}}·[[키워드]])을 걷어낸 표시용 문자열 — 담은 상품 시트의 파트 제목·묶음 키.
   기록에는 저자가 적은 원문(마크업 포함)이 그대로 남으므로 읽는 쪽이 같은 규칙으로 걷어내야 옛 기록과 단계 목록이 한 묶음이 된다 */
export function plainStepTitle(text) {
  return String(text || '')
    .replace(/\{\{[^|{}]*\|([^{}]*?)\}\}/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/* 상품 카드가 속한 계획 단계 제목 — 카드(컨테이너 자식이면 그 컨테이너)보다 앞에 있는 가장 가까운
   planStep. 계획 페이지는 "단계 안내 → 그 단계의 상품 트랙" 순서라 이 규칙이 곧 소속이다 */
export function stepInfoOfItem(items, itemId) {
  const list = Array.isArray(items) ? items : []
  const item = list.find((it) => it.id === itemId)
  if (!item) return { step: '', stepBadge: '' }
  const topId = item.parentId || item.id
  const top = list.filter((it) => !it.parentId)
  const index = top.findIndex((it) => it.id === topId)
  for (let i = index - 1; i >= 0; i--) {
    if (top[i].type === 'planStep') {
      return {
        step: String(top[i].props?.title || '').trim(),
        stepBadge: String(top[i].props?.badge || '').trim(), // "중요" 같은 단계 배지 — 상세 시트 파트 머리에 같이 선다
      }
    }
  }
  return { step: '', stepBadge: '' }
}
export const stepOfItem = (items, itemId) => stepInfoOfItem(items, itemId).step

/* 상품 카드 props → 담기 항목 (카드가 아는 재료만 — 목업 이모지·배경도 챙겨 썸네일을 그대로 재현한다) */
export function cartEntryFromProduct(p, extra = {}) {
  const entry = { name: String(p.name || '').trim() }
  for (const key of ['brand', 'price', 'mall', 'imageUrl', 'emoji', 'gradient', 'url']) {
    if (p[key]) entry[key] = String(p[key])
  }
  if (p.external) entry.external = true
  return { ...entry, ...extra }
}

/* 단계별 묶음 — 처음 나온 순서대로, 단계 없는 항목은 마지막 '담은 상품' 묶음. 항목마다 원 배열 인덱스(index)를
   달아 두어 상세 시트의 「빼기」가 같은 이름의 다른 항목을 잘못 지우지 않게 한다 */
export function groupCartByStep(cart) {
  const groups = []
  const byStep = new Map()
  cartEntries(cart).forEach((entry, index) => {
    const key = String(entry.step || '')
    if (!byStep.has(key)) {
      const group = { step: key, stepBadge: String(entry.stepBadge || ''), entries: [] }
      byStep.set(key, group)
      groups.push(group)
    }
    byStep.get(key).entries.push({ ...entry, index })
  })
  return groups.sort((a, b) => (a.step === '' ? 1 : 0) - (b.step === '' ? 1 : 0))
}

/* ── 옛 이름-만 기록 보정 ──
   이름으로 상품 카드 재료를 찾는 표를 만들어 빈 필드(썸네일·가격·몰·단계)를 채운다. 시나리오 쓰레드는 그 시나리오의
   상품 카드 아이템에서, 라이브 쓰레드는 서버에 남은 계획 페이지(와이어)에서 표를 만든다 */
const normName = (text) => String(text || '').trim().replace(/\s+/g, ' ')

/* 계획 단계 목록 항목 — 담은 상품 시트의 파트 재료 { id, title, badge, products, addable, soldOut, pending? }:
   id = 그 단계 아이템의 id(시나리오는 planStep 아이템 id, 라이브는 guide 섹션의 투영 id) — 시트의 파트를 누르면 체험 화면이
   이 id 의 래퍼(data-item-id)로 앵커 스크롤한다(2026-09), products = 그 단계에 실제로 실린 상품 카드 수, addable = 그중
   카드가 「담기」를 주는 상품 수(담을 것이 있는지), soldOut = 담을 수 없는(품절) 수, pending = 라이브 조기 확정 뒤 그 단계의
   상품·콘텐츠 자리에 아직 검색 결과가 안 옴. 시트는 이것으로 「상품을 추가해 보세요」(담을 것이 있음)·「찾는 중」·「추천 상품 없음」·
   「품절 상품 n개 · 담을 수 없어요」를 가른다 — 상품이 전부 검증 게이트에 걸려 빠진 계획에서도 고를 상품이 있는 것처럼 보이던 것(2026-09) */
const stepEntry = (id, title, badge) => ({ id, title, badge, products: 0, addable: 0, soldOut: 0 })

/* 단계에 실린 상품 한 개를 센다 — 카드가 「담기」를 주는 상품만 addable (registry planComponents productCard 와 같은 규칙:
   품절(soldOut)만 버튼이 비활성이다. 외부몰 상품도 2026-09-14부터 담긴다 — 쓰레드의 담은 상품은 지마켓 장바구니가 아니라 픽 목록) */
const countProduct = (entry, { soldOut = false }) => {
  entry.products += 1
  if (soldOut) entry.soldOut += 1
  else entry.addable += 1
}

export function productLookupFromItems(items) {
  const map = new Map()
  map.steps = [] // 계획 단계 목록(순서대로) — 담은 상품 시트의 파트(빈 파트 행 포함) 재료
  const list = Array.isArray(items) ? items : []
  /* 소속은 stepInfoOfItem 과 같은 규칙 — 최상위 순서에서 카드(컨테이너 자식이면 그 컨테이너)보다 앞의 가장 가까운
     planStep. 자식은 배열 어디에 있어도 되므로 배열 순서가 아니라 최상위 순서로 센다 */
  const top = list.filter((it) => !it.parentId)
  const ownerAt = [] // 최상위 인덱스 → 그 자리가 속한 단계 항목 (앞에 단계가 없으면 null)
  let current = null
  top.forEach((it, i) => {
    if (it.type === 'planStep') {
      const title = String(it.props?.title || '').trim()
      current = title ? stepEntry(it.id, title, String(it.props?.badge || '').trim()) : null
      if (current) map.steps.push(current)
    }
    ownerAt[i] = current
  })
  const topIndex = new Map(top.map((it, i) => [it.id, i]))
  for (const it of list) {
    if (it.type !== 'productCard' || !it.props?.name) continue
    const at = topIndex.get(it.parentId || it.id)
    const owner = at == null ? null : ownerAt[at]
    // 숨긴 카드(또는 숨긴 컨테이너의 자식)는 실행 화면에 없으니 담을 수 있는 상품으로 세지 않는다
    if (owner && !it.hidden && !top[at].hidden) countProduct(owner, { soldOut: !!it.props.soldOut })
    const key = normName(it.props.name)
    if (!map.has(key)) map.set(key, { ...cartEntryFromProduct(it.props), step: owner?.title || '', stepBadge: owner?.badge || '' })
  }
  return map
}

/* 라이브 와이어 계획 페이지 — livePage 의 productCard 투영과 같은 규칙(가격 천 단위, 썸네일 없으면 🧴 목업, mall 있음 = 외부몰,
   가격 미확인(priceUnknown·0원)은 가격을 비운다 — 0원으로 담기거나 합계에 들어가지 않게).
   opts.pendingSlots — 뼈대 조기 확정 뒤 아직 검색 결과가 안 온 자리 인덱스(LivePlayer 상태). 그 자리(null 섹션)가 속한 단계는
   pending 표식을 받아 시트가 「찾는 중」으로 그린다 */
export function productLookupFromPlanPage(page, opts = {}) {
  const pendingSlots = opts.pendingSlots || []
  const map = new Map()
  map.steps = [] // 라이브 계획의 단계(guide) 목록 — 시트의 빈 파트 행 재료 (라이브 단계엔 배지가 없다)
  const sections = page?.sections || []
  let current = null
  /* forEach 가 아니라 인덱스 순회 — 조기 확정 뒤 안 온 자리는 null 이라 forEach 는 건너뛰고, 그러면 어느 단계가 대기 중인지 모른다 */
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]
    if (!section) {
      if (current && pendingSlots.includes(i)) current.pending = true
      continue
    }
    if (section.kind === 'guide') {
      const title = String(section.title || '').trim()
      current = title ? stepEntry(livePlanSectionId(i), title, '') : null
      if (current) map.steps.push(current)
      continue
    }
    if (section.kind !== 'products') continue
    for (const product of section.products || []) {
      if (!product?.name) continue
      if (current) countProduct(current, {}) // 라이브 상품은 품절 상태가 없다 — 전부 담을 수 있다
      const key = normName(product.name)
      if (map.has(key)) continue
      const entry = { name: String(product.name).trim(), step: current?.title || '' }
      if (product.brand) entry.brand = String(product.brand)
      if (!product.priceUnknown && Number(product.price) > 0) entry.price = Number(product.price).toLocaleString('ko-KR')
      if (product.mall) { entry.mall = String(product.mall); entry.external = true }
      if (product.url) entry.url = String(product.url)
      if (product.imageUrl) entry.imageUrl = String(product.imageUrl)
      else entry.emoji = '🧴'
      map.set(key, entry)
    }
  }
  return map
}

/* 표에서 찾은 재료로 빈 필드를 채운다. 바뀐 게 없으면 원래 배열을 그대로 돌려준다(무변경 참조 유지 — 기록 갱신을 안 일으킨다) */
export function enrichCartEntries(cart, lookup) {
  if (!lookup || lookup.size === 0 || !Array.isArray(cart) || cart.length === 0) return cart
  let changed = false
  const next = cartEntries(cart).map((entry) => {
    const found = lookup.get(normName(entry.name))
    if (!found) return entry
    const patch = {}
    for (const key of ['brand', 'price', 'mall', 'imageUrl', 'emoji', 'gradient', 'url', 'step', 'stepBadge']) {
      if (!entry[key] && found[key]) patch[key] = found[key]
    }
    if (found.external && entry.external == null) patch.external = true
    if (Object.keys(patch).length === 0) return entry
    changed = true
    return { ...entry, ...patch }
  })
  return changed ? next : cart
}

/* 썸네일 재료(이미지도 이모지도)가 없는 항목이 하나라도 있으면 보정 대상 */
export const cartNeedsEnrich = (cart) => cartEntries(cart).some((entry) => !entry.imageUrl && !entry.emoji)
