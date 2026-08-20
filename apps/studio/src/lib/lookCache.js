/*
 * 정밀 렌더 보관 — IndexedDB.
 *
 * 왜 localStorage가 아닌가: 렌더 결과는 한 장에 수백 KB~수 MB인데 localStorage는 오리진
 * 통틀어 ~5MB라, 워크스페이스 데이터가 차 있는 브라우저에서는 저장이 조용히 실패해
 * 재접속마다 유료 렌더를 다시 돌리는 사고가 났다. IndexedDB는 수백 MB급이라 **원본 화질
 * 그대로** 보관한다 (720px 축소 불필요 — 재접속 화질도 첫 렌더와 같다).
 *
 * 키 = threadId (스노우플레이크 — 문자열 정렬이 곧 시간순), 값 = { tone, image, at }.
 * 모든 실패는 null/무시로 삼킨다 — 보관은 편의이고 체험을 막지 않는다 (프라이빗 모드 등).
 */

const DB_NAME = 'ddak-live'
const STORE = 'look-renders'
const KEEP = 12

let dbPromise = null
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 미지원'))
        return
      }
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch(() => null)
  }
  return dbPromise
}

/** 트랜잭션 한 번 — fn이 돌려준 IDBRequest의 result를 완료 시점에 반환한다 */
async function withStore(mode, fn) {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    let request = null
    try {
      const tx = db.transaction(STORE, mode)
      request = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request ? request.result : null)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/* 구 localStorage 캐시(ddak-live-look-v1) → IndexedDB 1회 이관. 첫 조회 전에 한 번만 —
   축소본이라도 있으면 재렌더 한 번을 아끼고, 다음 렌더가 원본 화질로 덮는다 */
let migrated = null
function migrateLegacy() {
  if (!migrated) {
    migrated = (async () => {
      try {
        const raw = localStorage.getItem('ddak-live-look-v1')
        if (!raw) return
        const store = JSON.parse(raw) || {}
        for (const [threadId, v] of Object.entries(store)) {
          if (v && v.image) await saveLookRender(threadId, v.tone, v.image)
        }
        localStorage.removeItem('ddak-live-look-v1')
      } catch {
        /* 이관 실패 — 다음 렌더가 새로 채운다 */
      }
    })()
  }
  return migrated
}

/** 보관된 렌더 조회 — { tone, image } 또는 null */
export async function loadLookRender(threadId) {
  if (!threadId) return null
  await migrateLegacy()
  const row = await withStore('readonly', (s) => s.get(threadId))
  return row && row.image ? row : null
}

/** 렌더 저장 + 오래된 것 정리 (최근 KEEP개만) */
export async function saveLookRender(threadId, tone, image) {
  if (!threadId || !image) return
  await withStore('readwrite', (s) => s.put({ tone, image, at: Date.now() }, threadId))
  const keys = await withStore('readonly', (s) => s.getAllKeys())
  if (Array.isArray(keys) && keys.length > KEEP) {
    const stale = [...keys].sort().slice(0, keys.length - KEEP)
    await withStore('readwrite', (s) => {
      stale.forEach((k) => s.delete(k))
      return null
    })
  }
}
