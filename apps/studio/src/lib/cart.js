/*
 * 담은 상품(cart) 항목 — 체험 1회(쓰레드)에 담긴 상품 목록의 형태와 읽기 규칙.
 *
 * 옛 기록은 상품 이름 문자열 배열이고, 새 기록은 상품 카드의 재료를 함께 실은 객체다
 *   { name, brand, price, mall, imageUrl, emoji, gradient, external, url, step }
 * (step = 카드가 붙어 있던 계획 단계 제목 — 쇼핑 쓰레드 상세 시트가 파트별로 묶는 키).
 * 두 형태가 같은 배열에 섞여 있어도 되므로 읽는 쪽은 언제나 cartEntry()/cartEntries()를 거친다.
 * 워크스페이스 쓰레드 기록(account:<id>:threads 행)과 라이브 cartAdd 이벤트 payload 가 같은 형태를 싣는다.
 */
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

export function productLookupFromItems(items) {
  const map = new Map()
  let step = ''
  let stepBadge = ''
  for (const it of Array.isArray(items) ? items : []) {
    if (it.type === 'planStep' && !it.parentId) {
      step = String(it.props?.title || '').trim()
      stepBadge = String(it.props?.badge || '').trim()
      continue
    }
    if (it.type !== 'productCard' || !it.props?.name) continue
    const key = normName(it.props.name)
    if (!map.has(key)) map.set(key, { ...cartEntryFromProduct(it.props), step, stepBadge })
  }
  return map
}

/* 라이브 와이어 계획 페이지 — livePage 의 productCard 투영과 같은 규칙(가격 천 단위, 썸네일 없으면 🧴 목업, mall 있음 = 외부몰) */
export function productLookupFromPlanPage(page) {
  const map = new Map()
  let step = ''
  for (const section of page?.sections || []) {
    if (!section) continue
    if (section.kind === 'guide') {
      step = String(section.title || '').trim()
      continue
    }
    if (section.kind !== 'products') continue
    for (const product of section.products || []) {
      if (!product?.name) continue
      const key = normName(product.name)
      if (map.has(key)) continue
      const entry = { name: String(product.name).trim(), step }
      if (product.brand) entry.brand = String(product.brand)
      if (product.price != null && product.price !== '') entry.price = Number(product.price || 0).toLocaleString('ko-KR')
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
