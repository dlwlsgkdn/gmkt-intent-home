/* 서버 영속화 클라이언트 — /api/state (Vercel Functions + Neon Postgres).
   localStorage는 즉시 캐시로 그대로 두고, 변경분을 디바운스로 서버에 미러링한다.
   충돌 정책: 문서(키) 단위 last-write-wins. */

/* 실행 환경 데이터 프로필:
   - 'local' → localStorage만 사용 (서버 하이드레이션·미러링 전부 끔)
   - 'prod'  → localStorage + Neon DB 미러링
   기본값: vite 개발 서버(npm run dev)는 local, 빌드 산출물(배포)은 prod.
   오버라이드: VITE_DATA_PROFILE=prod npm run dev (로컬에서 운영 DB에 붙어 확인할 때) */
const OVERRIDE = import.meta.env.VITE_DATA_PROFILE
export const DATA_PROFILE =
  OVERRIDE === 'local' || OVERRIDE === 'prod'
    ? OVERRIDE
    : import.meta.env.DEV ? 'local' : 'prod'
export const REMOTE_ENABLED = DATA_PROFILE === 'prod'

console.info(
  `[remote] 데이터 프로필: ${DATA_PROFILE} — ` +
  (REMOTE_ENABLED ? 'localStorage + Neon DB 미러링' : 'localStorage 전용 (서버 동기화 없음)')
)

/* Vercel 배포·로컬 개발(vite 프록시)은 같은 오리진, GitHub Pages 등은 Vercel API로 교차 호출 */
const SAME_ORIGIN =
  typeof location !== 'undefined' &&
  (/(^|\.)vercel\.app$/.test(location.hostname) ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
const API = (SAME_ORIGIN ? '' : 'https://ddak-scenario-studio.vercel.app') + '/api/state'
const DEBOUNCE_MS = 300

export async function fetchRemoteState() {
  const res = await fetch(API, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${API} → ${res.status}`)
  return res.json()
}

const timers = {}
const pending = {} // key → 아직 전송 안 된 최신 값 (flush 대상)

function send(key, data, { keepalive = false } = {}) {
  return fetch(API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, data }),
    keepalive,
  }).then((res) => {
    if (!res.ok) throw new Error(`PUT ${API} → ${res.status}`)
  })
}

/* 편집 즉시 미러링 — 타이핑 같은 연속 변경만 짧게(300ms) 모아 마지막 것을 전송 */
export function saveRemoteState(key, data) {
  if (!REMOTE_ENABLED) return
  pending[key] = data
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => {
    delete pending[key]
    send(key, data).catch((e) => {
      console.warn('[remote] 서버 저장 실패 (localStorage에는 저장됨):', e)
    })
  }, DEBOUNCE_MS)
}

/* 디바운스 대기 중인 변경을 지금 즉시 전송 — 탭 이탈/숨김 시 유실 방지 */
export function flushRemoteState() {
  if (!REMOTE_ENABLED) return
  for (const key of Object.keys(pending)) {
    clearTimeout(timers[key])
    const data = pending[key]
    delete pending[key]
    // keepalive: 페이지가 닫혀도 전송 유지 (본문 64KB 초과 등으로 거부되면 일반 전송 재시도)
    send(key, data, { keepalive: true }).catch(() => {
      send(key, data).catch((e) => {
        console.warn('[remote] 이탈 직전 저장 실패 (localStorage에는 저장됨):', e)
      })
    })
  }
}

if (REMOTE_ENABLED && typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushRemoteState)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushRemoteState()
  })
}
