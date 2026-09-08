import { useEffect, useRef, useState } from 'react'
import { loadRecentSearches, saveRecentSearches } from '../lib/store.js'
import { routeSearch } from '../lib/liveApi.js'
import { heuristicRoute } from '../lib/searchCatalog.js'

/*
 * 홈 검색창의 진입 로직 — 홈과 검색 결과 페이지(SRP)가 같은 한 벌을 쓴다.
 * 검색어를 제출하면 최근 검색어에 남기고 BFF 라우터(`POST /api/search/route`)가 두 갈래를 가른다:
 *   ddak=true → 뷰티 설문→맞춤 계획 (onDdak — 홈은 발행 칩 매칭 시트를 거친다)
 *   ddak=false → 검색 결과 페이지 (#srp/<검색어>)
 * 라우터가 막히면(네트워크·LLM) 같은 규칙의 휴리스틱으로 대신 가른다 — 검색은 언제나 어디론가 가야 한다.
 * routing 은 판정 중 표시용 검색어 (한 호출에 1~3초 — 짧은 안내 알약을 띄운다)
 */
export function useSearchEntry(api, { onDdak }) {
  const accountId = api.activeAccountId || 'default'
  const [recents, setRecents] = useState(() => loadRecentSearches(accountId))
  useEffect(() => {
    setRecents(loadRecentSearches(accountId))
  }, [accountId])
  const [routing, setRouting] = useState(null)
  const busyRef = useRef(false) // 판정 중 겹친 제출(Enter 연타·행 클릭)은 한 번만

  const profile = ((api.profile && api.profile.items) || []).map((it) => ({ label: String(it.label || ''), value: String(it.value || '') }))

  const remember = (q) => {
    const next = [{ q, at: new Date().toISOString() }, ...recents.filter((r) => r.q !== q)].slice(0, 10)
    setRecents(next)
    saveRecentSearches(accountId, next)
  }
  const removeRecent = (q) => {
    const next = recents.filter((r) => r.q !== q)
    setRecents(next)
    saveRecentSearches(accountId, next)
  }

  /* 제출 — 검색 화면은 판정이 끝날 때까지 열린 채 상태를 보이고, 목적지 화면으로 바로 넘어간다(홈으로 되돌아오지 않는다) */
  const runSearch = async (raw) => {
    const q = String(raw || '').trim()
    if (!q || busyRef.current) return null
    busyRef.current = true
    remember(q)
    setRouting(q)
    let decision
    try {
      decision = await routeSearch({ query: q, profile })
    } catch (e) {
      decision = { ...heuristicRoute(q), normalized: q, source: 'fallback' }
    }
    busyRef.current = false
    setRouting(null)
    if (decision.ddak) onDdak(q, decision)
    else api.openSrp(q)
    return decision
  }

  return { recents, removeRecent, runSearch, routing, profile }
}
