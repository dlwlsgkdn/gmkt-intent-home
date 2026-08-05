/* 라이브 부분 스트리밍의 문자 단위 공개(reveal) — BFF stream-parse는 ~120ms 스로틀로
   자란 컴포넌트를 통째로 재전송하므로 그대로 그리면 텍스트가 덩어리로 뚝뚝 붙는다.
   화면에는 도착분(target)을 향해 틱마다 문자 단위로 따라잡는 사본(displayed)을 그려
   타자기처럼 자라는 인상을 만든다. LivePlayer의 틱커가 advanceReveal을 반복 호출한다.

   안전 규칙:
   - 텍스트 허용 목록 키만 자른다 — id·kind·url·imageUrl 같은 기계 필드가 잘리면
     React 키·섹션 분기·이미지 로드가 깨진다
   - products 배열은 통짜 복사 — 상품 섹션은 완성·그라운딩 통과분만 오고,
     url/imageUrl을 중간까지 공개하면 그 자체가 깨진 값이다
   - target이 displayed의 프리픽스가 아니면 즉시 스냅 — stream-parse 복구가
     미완성 원소를 교정한 경우라 어긋난 문장을 한 글자씩 고치는 연출은 오히려 이상하다 */

const TEXT_KEYS = new Set(['intro', 'question', 'headline', 'summary', 'title', 'body', 'reason'])
const TEXT_LIST_KEYS = new Set(['options', 'steps'])
const VERBATIM_KEYS = new Set(['products'])

/* 틱마다 남은 글자의 18%씩 — 덩어리 도착 직후엔 성큼 따라잡고 꼬리는 한 글자씩 찍힌다.
   ≈4틱마다 격차가 절반이라 result 확정 시점의 스냅 폭도 작게 유지된다 */
const CATCH_UP_RATE = 0.18
export const REVEAL_TICK_MS = 30

function advanceString(shown, target, ctx) {
  const base = typeof shown === 'string' ? shown : '' // 첫 도착은 빈 문자열에서 타이핑 시작
  const prev = target.startsWith(base) ? base : target
  if (prev === target) return target
  ctx.pending = true
  const step = Math.max(1, Math.round((target.length - prev.length) * CATCH_UP_RATE))
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
    target.forEach((el, i) => { out[i] = walk(prevArr[i], el, key, ctx) })
    return out
  }
  if (target && typeof target === 'object') {
    const prevObj = prev && typeof prev === 'object' ? prev : {}
    const out = {}
    for (const [k, v] of Object.entries(target)) {
      out[k] = VERBATIM_KEYS.has(k) ? v : walk(prevObj[k], v, k, ctx)
    }
    return out
  }
  return target
}

/* displayed를 target 쪽으로 한 틱 전진시킨 값과, 아직 덜 따라잡았는지(pending)를 돌려준다.
   pending=false면 틱커는 다음 target 도착까지 setState를 멈춰도 된다 */
export function advanceReveal(displayed, target) {
  const ctx = { pending: false }
  const value = walk(displayed, target, '', ctx)
  return { value, pending: ctx.pending }
}
