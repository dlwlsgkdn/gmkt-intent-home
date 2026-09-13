import { useEffect, useMemo, useState } from 'react'
import { fetchPopularSearches, personalizeHome } from '../lib/liveApi.js'
import { loadRecentSearches } from '../lib/store.js'
import {
  POPULAR_SEARCH_SEED,
  heuristicHomeGreeting,
  heuristicHomeSuggestions,
  heuristicHomeThreadIndex,
  homeSignature,
  nowInfo,
  rankPopularSearches,
  readHomeCache,
  threadDigests,
  writeHomeCache,
} from '../lib/homePersonalize.js'

/*
 * 홈 첫 화면 개인화 — 인사말 + 개인화 추천 검색어(보라 칩) + 인기 검색어(파랑 칩).
 *
 *  - 인사말·보라 칩: BFF `POST /api/search/home`(LLM 1회 — 이름·프로필·현지 시각·날씨·최근 쓰레드 요약·최근 검색어). 인사말은 **상태 인사**
 *    (검색어 제안 없음)이고 최근 쓰레드를 가리키는 「」 부분은 threadIndex → 쓰레드 id 로 옮겨 홈이 탭 대상(이어보기)으로 만든다. 홈은
 *    기본 인사말(탐색 아이템 문구)과 휴리스틱 칩을 먼저 그리고, 결과가 오면 크로스페이드로 바꾼다. 7초 안에 안 오면
 *    같은 재료의 휴리스틱(lib/homePersonalize)으로 바꾸고, 늦게 온 결과는 화면을 또 흔들지 않고 캐시에만 남긴다.
 *    결과는 세션 캐시(프로필·쓰레드 상태·날짜·시 단위 키) — 홈 복귀마다 LLM 을 다시 부르지 않고 인사말이 흔들리지 않는다.
 *    서버 하이드레이션(remoteSync.hydrating) 중에는 부르지 않고, 시그니처 변화는 500ms 모아 마지막 값으로 한 번만 부른다.
 *    위치는 브라우저가 **이미 허용한** 권한이 있을 때만 싣는다(권한 팝업을 띄우지 않는다 — 없으면 서울 날씨).
 *  - 파랑 칩: BFF `GET /api/search/popular`(core KV 후보 표 인기순 상위 3) — 모듈 캐시 5분, 실패면 같은 시드 표.
 */
const LLM_WAIT_MS = 7000
const SETTLE_MS = 500 // 시그니처가 연달아 바뀔 때(체험 직후 기록 갱신 등) 마지막 값으로 한 번만 부른다
const POPULAR_CACHE_MS = 5 * 60_000
let popularMem = null // { at, items, source }

async function grantedLocation() {
  try {
    if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions || !navigator.permissions.query) return null
    const status = await navigator.permissions.query({ name: 'geolocation' })
    if (status.state !== 'granted') return null
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1200)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer)
          resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        },
        () => {
          clearTimeout(timer)
          resolve(null)
        },
        { maximumAge: 600000, timeout: 1000 },
      )
    })
  } catch {
    return null
  }
}

const cleanList = (list, limit) =>
  (Array.isArray(list) ? list : []).map((s) => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, limit)

export function useHomePersonalize(api) {
  const accountId = api.activeAccountId || 'default'
  const name = String((api.profile && api.profile.name) || '').trim()
  const profile = useMemo(
    () => ((api.profile && api.profile.items) || [])
      .filter((it) => it && it.label && String(it.label).trim())
      .map((it) => ({ label: String(it.label), value: String(it.value || '') })),
    [api.profile],
  )
  const digests = useMemo(() => threadDigests(api.threads), [api.threads])
  const threadIds = useMemo(() => (Array.isArray(api.threads) ? api.threads : []).slice(0, 10).map((t) => t.id), [api.threads])
  const signature = homeSignature({ accountId, name, profile, threads: digests, now: nowInfo() })
  /* 서버 하이드레이션 중(prod 프로필 첫 접속·프로필 전환)에는 프로필 이름·쓰레드가 순차로 채워지며 시그니처가 연달아 바뀐다 —
     그때마다 LLM 을 부르면 3~4회 낭비에 인사말도 흔들린다. 끝난 뒤 최종 상태로 한 번만 부른다(그동안은 기본 인사말·휴리스틱 칩) */
  const hydrating = !!(api.remoteSync && api.remoteSync.hydrating)

  const [personal, setPersonal] = useState(() => {
    const cached = readHomeCache(signature)
    const input = { name, profile, now: nowInfo(), threads: digests }
    return cached
      ? { ...cached, ready: true, signature }
      : { greeting: null, suggestions: heuristicHomeSuggestions(input), weather: null, source: null, ready: false, signature }
  })

  useEffect(() => {
    const cached = readHomeCache(signature)
    if (cached) {
      setPersonal({ ...cached, ready: true, signature })
      return undefined
    }
    let alive = true
    let settled = false
    const now = nowInfo()
    const recentSearches = loadRecentSearches(accountId).map((r) => r.q).filter(Boolean).slice(0, 10)
    const input = { name, profile, now, threads: digests, recentSearches }
    setPersonal({ greeting: null, suggestions: heuristicHomeSuggestions(input), weather: null, source: null, ready: false, signature })
    if (hydrating) return undefined
    const settle = (result) => {
      if (!alive || settled) return
      settled = true
      setPersonal({ ...result, ready: true, signature })
    }
    const fallback = (weather = null) => ({
      greeting: heuristicHomeGreeting({ ...input, weather }),
      threadIndex: heuristicHomeThreadIndex(input),
      suggestions: heuristicHomeSuggestions({ ...input, weather }),
      weather,
      source: 'fallback',
    })
    let waitTimer = null
    const settleTimer = setTimeout(() => {
      waitTimer = setTimeout(() => settle(fallback()), LLM_WAIT_MS)
      ;(async () => {
        const location = await grantedLocation()
        try {
          const res = await personalizeHome({
            ...(name ? { name } : {}),
            profile,
            now,
            ...(location ? { location } : {}),
            threads: digests,
            recentSearches,
          })
          const weather = res && res.weather ? res.weather : null
          const idx = res && Number.isInteger(res.threadIndex) && res.threadIndex >= 1 && res.threadIndex <= digests.length ? res.threadIndex : null
          const result = {
            greeting: String((res && res.greeting) || '').trim(),
            threadIndex: idx,
            suggestions: cleanList(res && res.suggestions, 3),
            weather,
            source: (res && res.source) || 'llm',
          }
          if (!result.greeting) throw new Error('empty greeting')
          if (!result.suggestions.length) result.suggestions = heuristicHomeSuggestions({ ...input, weather })
          writeHomeCache(signature, result) // 늦게 와서 화면에 못 실려도 다음 방문은 이 결과로 즉시
          clearTimeout(waitTimer)
          settle(result)
        } catch {
          clearTimeout(waitTimer)
          settle(fallback())
        }
      })()
    }, SETTLE_MS)
    return () => {
      alive = false
      clearTimeout(settleTimer)
      if (waitTimer) clearTimeout(waitTimer)
    }
    // profile·digests 는 signature 에 녹아 있다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, hydrating])

  const [popular, setPopular] = useState(() =>
    popularMem && Date.now() - popularMem.at < POPULAR_CACHE_MS
      ? { items: popularMem.items, source: popularMem.source, ready: true }
      : { items: rankPopularSearches(POPULAR_SEARCH_SEED, 3), source: 'seed', ready: false },
  )
  useEffect(() => {
    if (popularMem && Date.now() - popularMem.at < POPULAR_CACHE_MS) {
      setPopular({ items: popularMem.items, source: popularMem.source, ready: true })
      return undefined
    }
    let alive = true
    fetchPopularSearches(3)
      .then((res) => {
        const items = rankPopularSearches(res && res.items, 3)
        if (!items.length) throw new Error('empty popular list')
        popularMem = { at: Date.now(), items, source: (res && res.source) || 'kv' }
        if (alive) setPopular({ items, source: popularMem.source, ready: true })
      })
      .catch(() => {
        if (alive) setPopular((prev) => ({ ...prev, source: 'seed', ready: true }))
      })
    return () => {
      alive = false
    }
  }, [])

  /* 인사말이 가리키는 쓰레드 — 응답의 번호를 지금 기록의 id 로 옮긴다(시그니처에 쓰레드 순서가 녹아 있어 캐시 결과도 같은 순서) */
  const threadId = Number.isInteger(personal.threadIndex) && personal.threadIndex >= 1 ? threadIds[personal.threadIndex - 1] || null : null
  return {
    greeting: { text: personal.greeting, threadId, ready: personal.ready, source: personal.source },
    /* basis — 보라 칩의 근거: 쓰레드가 있으면 '내 쓰레드에서 이어서', 없으면 프로필·계절만으로 만든 것 */
    personal: { items: personal.suggestions, ready: personal.ready, source: personal.source, basis: digests.length ? 'threads' : 'profile' },
    popular,
    weather: personal.weather,
  }
}
