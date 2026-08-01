/* 서버 영속화 클라이언트 — /api/state (Vercel Functions + Neon Postgres).
   localStorage는 즉시 캐시(자동). 서버 업로드는 useWorkspace가 두 경로로 수행한다:
   수동("서버에 저장" 버튼 — 빌더의 연속 편집)과 자동 트랜잭션 싱크(스튜디오 밖 단발
   작업 — 프로필·시나리오 생성, 쓰레드 기록, 가져오기 등). 충돌 정책: 문서(키) 단위
   last-write-wins + 저장 직전 행 목록(updatedAt) 비교로 다른 창의 선행 변경을
   확인받는다(수동은 confirm, 자동은 덮지 않고 멈춰 수동 저장으로 유도).

   키 체계는 화면 필요 단위의 행이다 (분해·조립 규칙은 lib/accountRows.js):
   'account:<id>'(셸 본문 — 홈 첫 화면용) + 'account:<id>:scenario:<sid>'(콘텐츠) +
   'account:<id>:versions:<sid>'(빌더 전용) + 'account:<id>:threads' +
   'accounts-meta'(계정 순서 — 활성 id는 기기별 상태라 동기화하지 않는다) + 'keywords'.
   통짜 'accounts' 블롭·구형 계정 행은 useWorkspace가 최초 1회 새 행 체계로 이관한다. */

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

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  return res.json()
}

/* 전체 덤프 — 구 통짜 형식 하이드레이션과 마이그레이션 판단에 쓰인다 */
export function fetchRemoteState() {
  return getJson(API)
}

/* 어떤 행이 있는지 목록만 — 본문이 커도 응답이 가볍다 */
export function fetchRemoteIndex() {
  return getJson(`${API}?index=1`)
}

/* 키 하나만 — 행 단위로 나눠 받으면 응답이 Vercel 본문 한도(4.5MB)를 넘지 않는다 */
export async function fetchRemoteKey(key) {
  const out = await getJson(`${API}?key=${encodeURIComponent(key)}`)
  return out[key] || null
}

/* 여러 키를 한 번에 → { <key>: {data, updatedAt} }. 무거운 행을 여럿 묶으면 응답이
   본문 한도에 닿을 수 있으니 가벼운 조합에만 쓸 것 (백그라운드는 fetchRemoteKey 병렬) */
export async function fetchRemoteKeys(keys) {
  if (!keys || keys.length === 0) return {}
  return getJson(`${API}?keys=${keys.map(encodeURIComponent).join(',')}`)
}

/* 부트 한 방 → { index, rows } — 행 목록 + 메타 + 키워드 + 계정 셸 본문 하나(요청 id가
   서버에 있으면 그 계정, 없으면 서버가 메타 순서의 첫 계정을 골라 담는다).
   홈 첫 페인트가 이 한 왕복으로 끝난다 */
export function fetchRemoteBoot(accountId) {
  return getJson(`${API}?boot=${accountId ? encodeURIComponent(accountId) : ''}`)
}

/* 즉시 전송 upsert. data: null 은 삭제 요청이다 (계정 삭제 → 행 삭제) */
export function saveRemoteStateNow(key, data) {
  if (!REMOTE_ENABLED) return Promise.resolve()
  return fetch(API, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, data }),
  }).then((res) => {
    if (!res.ok) throw new Error(`PUT ${API} → ${res.status}`)
  })
}
