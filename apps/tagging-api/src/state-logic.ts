/* 워크스페이스 상태 API의 순수 로직 — DB 없이 테스트할 수 있는 부분만 여기 둔다.
   원본은 api/state.js (Vercel 함수, Neon Postgres). 이 파일은 그 계약을 그대로
   옮기되 IO 를 걷어내 저장소(사내 Mongo) 없이도 규칙을 검증할 수 있게 했다. */

/* 키 화이트리스트 — api/state.js 의 정규식 그대로. 절대 바꾸지 말 것. */
export const KEY_PATTERN =
  /^(accounts|keywords|accounts-meta|starters-meta|starter:[A-Za-z0-9_-]{1,64}|account:[A-Za-z0-9_-]{1,64}(?::threads|:(?:versions|scenario):[A-Za-z0-9_-]{1,64})?)$/
export const BODY_KEY_PATTERN = /^account:[A-Za-z0-9_-]{1,64}$/
const BOOT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/* ?keys=a,b,c 파싱 — 쉼표 구분, 공백 트림, 빈 항목 제거. 1~32개 · 전부 유효해야 통과. */
export function parseKeysParam(raw: unknown): { ok: true; list: string[] } | { ok: false } {
  const list = String(raw ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (list.length === 0 || list.length > 32 || list.some((k) => !isValidKey(k))) return { ok: false }
  return { ok: true, list }
}

/* boot 요청 id 검증 — 통과하면 그대로, 아니면 null (메타 폴백 경로로). */
export function normalizeBootId(boot: unknown): string | null {
  return typeof boot === 'string' && BOOT_ID_PATTERN.test(boot) ? boot : null
}

/* boot 1차 조회 대상 — 셸 메타 3종 + (있는 경우만) 요청 계정 본문.
   haveKeys 는 전체 인덱스에서 실재가 확인된 키 집합(존재하지 않는 키를 괜히 조회하지 않으려고). */
export function bootWantedKeys(bootId: string | null, haveKeys: Set<string> | string[]): string[] {
  const have = haveKeys instanceof Set ? haveKeys : new Set(haveKeys)
  const wanted = ['accounts-meta', 'keywords', 'starters-meta']
  if (bootId && have.has(`account:${bootId}`)) wanted.push(`account:${bootId}`)
  return wanted
}

/* boot 폴백: 1차 조회 결과에 계정 본문(account:<id> 형태)이 하나도 없으면
   accounts-meta.order 순서의 첫 계정 → 그것도 없으면 전체 인덱스의 아무 본문 행이나 하나
   추가로 채운다. 이미 본문이 있으면 null (폴백 불필요). */
export function pickBootFallbackKey(
  rows: { key: string }[],
  allKeys: string[],
  accountsMetaData: unknown,
): string | null {
  if (rows.some((r) => BODY_KEY_PATTERN.test(r.key))) return null
  const have = new Set(allKeys)
  const order =
    accountsMetaData && typeof accountsMetaData === 'object' && Array.isArray((accountsMetaData as any).order)
      ? ((accountsMetaData as any).order as unknown[])
      : []
  const fromOrder = order.map((id) => `account:${id}`).find((k) => have.has(k))
  if (fromOrder) return fromOrder
  return allKeys.find((k) => BODY_KEY_PATTERN.test(k)) ?? null
}
