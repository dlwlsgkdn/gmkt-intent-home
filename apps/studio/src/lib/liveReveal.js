/* 라이브 부분 스트리밍의 문자 단위 공개(reveal) — BFF stream-parse는 ~120ms 스로틀로
   자란 컴포넌트를 통째로 재전송하므로 그대로 그리면 텍스트가 덩어리로 뚝뚝 붙는다.
   화면에는 도착분(target)을 향해 틱마다 따라잡는 사본(displayed)을 그려 타자기처럼
   자라는 인상을 만든다. LivePlayer의 틱커가 advanceReveal을 반복 호출한다.

   공개 방식은 "문서 순서 프런티어": LLM이 실제로 위에서부터 순차로 쓰듯, 틱마다
   문자 예산을 문서 순서(머리말 → 첫 컴포넌트 → …)로 소진한다. 앞 필드가 다 찍히기
   전에는 뒤 필드가 자라지 않아 여러 컴포넌트가 동시에 타이핑되는 인상이 없고,
   아직 한 글자도 못 받은 새 원소는 빈 껍데기로 그리지 않고 프런티어가 닿을 때
   등장시킨다(마운트 페이드인과 자연스럽게 맞물린다).

   예산은 틱당 글자 수 상한이 있어 큰 덩어리도 일정한 타자 속도로 풀리고,
   밀린 양(gap)에 비례해 완만히 가속해 스트림에 뒤처지지 않는다.

   안전 규칙:
   - 텍스트 허용 목록 키만 자른다 — id·kind·url·imageUrl 같은 기계 필드가 잘리면
     React 키·섹션 분기·이미지 로드가 깨진다
   - products 배열은 통짜 복사 — 상품 섹션은 완성·그라운딩 통과분만 오고,
     url/imageUrl을 중간까지 공개하면 그 자체가 깨진 값이다
   - target이 displayed의 프리픽스가 아니면 즉시 스냅(예산 무료) — stream-parse
     복구가 미완성 원소를 교정한 경우라 한 글자씩 고치는 연출은 오히려 이상하다 */

const TEXT_KEYS = new Set(['intro', 'question', 'headline', 'summary', 'title', 'body', 'reason'])
const TEXT_LIST_KEYS = new Set(['options', 'steps'])
const VERBATIM_KEYS = new Set(['products'])

/* 상위 페이지 객체의 키 소진 순서 — LivePlayer가 target을 {questions, ...head} 순으로
   조립하므로 삽입 순서만 믿으면 인트로보다 질문이 먼저 타이핑된다. 렌더가 위에 두는
   머리말 키를 앞세운다 (안정 정렬 — 나머지 키는 삽입 순서 유지) */
const KEY_ORDER = { intro: 0, headline: 0, summary: 1 }

export const REVEAL_TICK_MS = 30
/* 틱당 문자 예산: 기본 2자(≈66자/s — 타자 체감), 밀린 양/50 만큼 가속, 최대 24자
   (≈800자/s — result 직전 몰아치기용). 30ms 틱 기준 */
const BASE_CHARS_PER_TICK = 2
const MAX_CHARS_PER_TICK = 24
const CATCH_UP_DIVISOR = 50

function orderedEntries(obj) {
  return Object.entries(obj).sort((a, b) => (KEY_ORDER[a[0]] ?? 10) - (KEY_ORDER[b[0]] ?? 10))
}

/* 남은 공개 글자 수 — 예산 산정용. walk와 같은 구조를 돌되 상태를 만들지 않는다 */
function measure(prev, target, key) {
  if (typeof target === 'string') {
    if (!TEXT_KEYS.has(key)) return 0
    const shown = typeof prev === 'string' ? prev : ''
    return target.startsWith(shown) ? target.length - shown.length : 0 // 비프리픽스 = 스냅 예정, 예산 0
  }
  if (Array.isArray(target)) {
    const prevArr = Array.isArray(prev) ? prev : []
    if (TEXT_LIST_KEYS.has(key)) {
      return target.reduce((sum, s, i) => {
        if (typeof s !== 'string') return sum
        const shown = typeof prevArr[i] === 'string' ? prevArr[i] : ''
        return sum + (s.startsWith(shown) ? s.length - shown.length : 0)
      }, 0)
    }
    let sum = 0
    target.forEach((el, i) => { sum += measure(prevArr[i], el, key) })
    return sum
  }
  if (target && typeof target === 'object') {
    const prevObj = prev && typeof prev === 'object' ? prev : {}
    let sum = 0
    for (const [k, v] of Object.entries(target)) {
      if (!VERBATIM_KEYS.has(k)) sum += measure(prevObj[k], v, k)
    }
    return sum
  }
  return 0
}

function advanceString(shown, target, ctx) {
  const base = typeof shown === 'string' ? shown : '' // 첫 도착은 빈 문자열에서 타이핑 시작
  const prev = target.startsWith(base) ? base : target
  if (prev === target) return target
  if (ctx.budget <= 0) {
    ctx.pending = true
    return prev // 프런티어가 아직 안 닿음 — 이번 틱은 제자리
  }
  const step = Math.min(target.length - prev.length, ctx.budget)
  ctx.budget -= step
  if (prev.length + step < target.length) ctx.pending = true
  return target.slice(0, prev.length + step)
}

function walk(prev, target, key, ctx) {
  if (typeof target === 'string') {
    return TEXT_KEYS.has(key) ? advanceString(prev, target, ctx) : target
  }
  if (Array.isArray(target)) {
    const prevArr = Array.isArray(prev) ? prev : []
    if (TEXT_LIST_KEYS.has(key)) {
      return target.map((s, i) => (typeof s === 'string' ? advanceString(prevArr[i], s, ctx) : s))
    }
    // 구조 배열(questions/sections) — 서버가 건너뛴 인덱스의 빈 슬롯을 보존한다
    const out = new Array(target.length)
    target.forEach((el, i) => {
      const prevEl = prevArr[i]
      // 아직 화면에 없던 새 원소는 프런티어(남은 예산)가 닿았을 때만 등장 —
      // 빈 껍데기가 미리 깔리는 것을 막고, 등장 = 마운트라 페이드인도 이때 재생된다.
      // 공개할 텍스트가 없는 원소(즉시 완성형)는 바로 포함한다
      if (prevEl === undefined && ctx.budget <= 0 && measure(undefined, el, key) > 0) {
        ctx.pending = true
        return
      }
      out[i] = walk(prevEl, el, key, ctx)
    })
    return out
  }
  if (target && typeof target === 'object') {
    const prevObj = prev && typeof prev === 'object' ? prev : {}
    const out = {}
    for (const [k, v] of orderedEntries(target)) {
      out[k] = VERBATIM_KEYS.has(k) ? v : walk(prevObj[k], v, k, ctx)
    }
    return out
  }
  return target
}

/* displayed를 target 쪽으로 한 틱 전진시킨 값과, 아직 덜 따라잡았는지(pending)를 돌려준다.
   pending=false면 틱커는 다음 target 도착까지 setState를 멈춰도 된다 */
export function advanceReveal(displayed, target) {
  const gap = measure(displayed, target, '')
  const ctx = {
    pending: false,
    budget: Math.max(BASE_CHARS_PER_TICK, Math.min(MAX_CHARS_PER_TICK, Math.ceil(gap / CATCH_UP_DIVISOR))),
  }
  const value = walk(displayed, target, '', ctx)
  return { value, pending: ctx.pending }
}
