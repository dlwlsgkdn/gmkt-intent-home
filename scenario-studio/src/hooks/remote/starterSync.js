import { REMOTE_ENABLED, fetchRemoteKey, saveRemoteStateNow } from '../../lib/remote.js'
import { normalizeScenario } from '../../lib/store.js'

export const starterKey = (id) => `starter:${id}`

/*
 * 기본 시나리오 라이브러리의 서버 미러링 — 계정 행의 기준선·충돌 기계에 태우지 않는다.
 *
 * 항목은 지정 시점의 불변 스냅샷이고 쓰기는 지정·해제 두 단발 트랜잭션뿐이라,
 * last-write-wins 즉시 쓰기로 충분하다 (push.js의 충돌 비교도 starter 행을 무시한다).
 * 행 배치: 'starters-meta'(목록 메타 — 부트 한 왕복에 실려 옴) + 'starter:<id>'(스냅샷
 * 본문 — 새 프로필 생성 직전 ensure가 필요한 것만 받는다).
 * 쓰기 순서는 본문 먼저 → 메타 마지막(메타가 완료 표식 — 끊겨도 목록에 유령이 안 남는다).
 */
export function createStarterSync(ctx) {
  const { stateRef, setStarters, bootDeferredRef, showToast } = ctx

  /* 이 세션에서 라이브러리를 손댔는가 — 손댄 뒤에는 부트 채택이 로컬을 덮지 않는다
     (다음 지정·해제가 메타 전체를 다시 쓰므로 서버는 곧 따라온다) */
  const touchedRef = { current: false }

  /* 부트 행 채택 — 서버 목록을 그대로 받고, 사라진 항목의 스냅샷 캐시는 정리한다 */
  const adoptStartersMeta = (data) => {
    if (!Array.isArray(data) || touchedRef.current) return
    setStarters((prev) => {
      const entries = data.filter((entry) => entry && typeof entry === 'object' && entry.id)
      const contents = {}
      for (const entry of entries) {
        if (prev.contents[entry.id]) contents[entry.id] = prev.contents[entry.id]
      }
      return { entries, contents }
    })
  }

  /* 지정·교체 업로드 — nextEntries는 호출부가 계산한 갱신 후 목록(렌더 커밋을 기다리지 않는다) */
  const pushStarter = async (entry, snapshot, nextEntries) => {
    touchedRef.current = true
    if (!REMOTE_ENABLED) return
    try {
      await bootDeferredRef.current.promise
      await saveRemoteStateNow(starterKey(entry.id), snapshot)
      await saveRemoteStateNow('starters-meta', nextEntries)
    } catch (error) {
      console.warn('[remote] 기본 시나리오 업로드 실패:', error)
      showToast('기본 시나리오를 서버에 올리지 못했어요. 네트워크 확인 후 다시 지정해주세요.')
    }
  }

  /* 해제 업로드 — 메타 먼저(목록에서 즉시 사라짐), 본문 행은 뒤에 지운다 */
  const removeStarter = async (entryId, nextEntries) => {
    touchedRef.current = true
    if (!REMOTE_ENABLED) return
    try {
      await bootDeferredRef.current.promise
      await saveRemoteStateNow('starters-meta', nextEntries)
      await saveRemoteStateNow(starterKey(entryId), null)
    } catch (error) {
      console.warn('[remote] 기본 시나리오 해제 반영 실패:', error)
      showToast('기본 시나리오 해제를 서버에 반영하지 못했어요. 네트워크 확인 후 다시 시도해주세요.')
    }
  }

  /* 설치 직전 스냅샷 확보 — 로컬 캐시에 없는 항목만 서버에서 받는다.
     못 받은 항목은 결과에서 빠진다(호출부가 개수 차이로 안내) */
  const ensureStarterContents = async (entries) => {
    await bootDeferredRef.current.promise
    const current = stateRef.current.starters.contents
    const missing = entries.filter((entry) => !current[entry.id])
    if (missing.length === 0 || !REMOTE_ENABLED) return current
    const fetched = {}
    await Promise.all(missing.map(async (entry) => {
      try {
        const row = await fetchRemoteKey(starterKey(entry.id))
        if (row && row.data) fetched[entry.id] = normalizeScenario(row.data)
      } catch (error) {
        console.warn('[remote] 기본 시나리오 스냅샷 로드 실패:', starterKey(entry.id), error)
      }
    }))
    if (Object.keys(fetched).length > 0) {
      setStarters((prev) => ({ ...prev, contents: { ...prev.contents, ...fetched } }))
    }
    return { ...current, ...fetched }
  }

  return { adoptStartersMeta, pushStarter, removeStarter, ensureStarterContents }
}
