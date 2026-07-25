/* 시나리오 공유 링크 — URL 해시에 base64url(JSON)로 담는다 (서버 불필요) */

export function encodeShare(scenario) {
  // 평가 메모는 제작자 내부 정보다. 실행용 공유 링크에는 포함하지 않는다.
  const planCases = (scenario.planCases || []).map(({ evaluation, ...planCase }) => planCase)
  const payload = { v: 1, scenario: { ...scenario, versions: [], planCases } }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeShare(str) {
  try {
    const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes))
    const s = payload && payload.scenario
    return s && s.stages ? s : null
  } catch (e) {
    return null
  }
}

export function buildShareUrl(scenario) {
  return `${location.origin}${location.pathname}#s=${encodeShare(scenario)}`
}

export function readShareFromHash() {
  const m = location.hash.match(/^#s=(.+)$/)
  return m ? decodeShare(m[1]) : null
}

export function clearShareHash() {
  history.replaceState(null, '', location.pathname + location.search)
}
