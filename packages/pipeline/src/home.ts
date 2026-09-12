import type { HomeThreadDigest, HomeWeather, PopularSearchEntry, Profile } from '@ddak/schema'

/*
 * 홈 첫 화면 재료 — 인기 검색어 후보 표(시드)와 순위 규칙, 날씨 코드 라벨, 시간대, 그리고 LLM 이 막혔을 때의
 * 휴리스틱 인사말·추천 검색어. 전부 순수 함수다 — BFF(search 컨트롤러)가 소비하고, FE 는 같은 규칙을
 * apps/studio/src/lib/homePersonalize.js 에 거울로 둔다(FE 는 워크스페이스 패키지를 import 하지 않는다).
 * 규칙을 바꾸면 두 곳을 같이 맞출 것.
 */

/* ── 인기 검색어 후보 표 (시드) ──
   "전체 사용자 인기 검색어"의 기본 표. core 설정 KV `search-popular` 가 비어 있으면 이 값으로 답하고 같은 값을 KV 에
   한 번 시딩한다(그 뒤로는 KV 가 원천 — 검색 제출이 후보 표의 검색어와 일치하면 count 가 오른다). 후보는 뷰티 카테고리
   안의 짧은 키워드형(칩에 `#키워드` 로 서는 문구)이고, count 는 가상의 최근 검색 횟수다 */
export const POPULAR_SEARCH_SEED: PopularSearchEntry[] = [
  { keyword: '환절기 수분크림', count: 1840 },
  { keyword: '가을 무드 립', count: 1620 },
  { keyword: '톤업 선크림', count: 1510 },
  { keyword: '모공 프라이머', count: 1320 },
  { keyword: '쿠션 파운데이션', count: 1270 },
  { keyword: '레티놀 세럼', count: 1140 },
  { keyword: '클렌징 오일', count: 990 },
  { keyword: '헤어 에센스', count: 930 },
  { keyword: '비건 립밤', count: 870 },
  { keyword: '트러블 패치', count: 760 },
  { keyword: '데일리 향수', count: 700 },
  { keyword: '속눈썹 영양제', count: 610 },
]

/** 검색어 정규화 — 대소문자·공백·해시·언더스코어 차이를 무시하고 같은 후보로 본다 */
export function normalizeSearchKeyword(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[\s_]+/g, '')
    .trim()
}

/** KV 에 저장된 값 → 후보 표. 형식이 어긋나면 null (호출자가 시드로 대신한다) */
export function parsePopularSearches(value: unknown): PopularSearchEntry[] | null {
  if (!Array.isArray(value)) return null
  const out: PopularSearchEntry[] = []
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const keyword = String((row as { keyword?: unknown }).keyword ?? '').trim()
    const count = Number((row as { count?: unknown }).count)
    if (!keyword || !Number.isFinite(count) || count < 0) continue
    out.push({ keyword, count: Math.floor(count) })
  }
  return out.length ? out : null
}

/** 인기순 내림차순 상위 n — 같은 count 면 키워드 가나다순, 정규화 기준 중복은 첫 항목만 */
export function rankPopularSearches(list: PopularSearchEntry[], limit = 3): PopularSearchEntry[] {
  const seen = new Set<string>()
  return [...list]
    .filter((row) => row && row.keyword && Number.isFinite(row.count))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword, 'ko'))
    .filter((row) => {
      const key = normalizeSearchKeyword(row.keyword)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, Math.max(0, limit))
}

/** 검색 제출 반영 — 후보 표에 있는 검색어와 일치할 때만 count+1 한 새 표를 돌려준다. 일치가 없으면 null
 * (임의 검색어를 표에 넣지 않는다 — 모두에게 노출되는 칩이라 후보는 운영자가 정한 표 안에서만 움직인다) */
export function bumpPopularSearch(list: PopularSearchEntry[], query: string): PopularSearchEntry[] | null {
  const key = normalizeSearchKeyword(query)
  if (!key) return null
  let hit = false
  const next = list.map((row) => {
    if (hit || normalizeSearchKeyword(row.keyword) !== key) return row
    hit = true
    return { ...row, count: row.count + 1 }
  })
  return hit ? next : null
}

/* ── 날씨 — Open-Meteo WMO weather_code → 한국어 한 단어 ── */
export function weatherLabelOf(code: number): string {
  if (code === 0) return '맑음'
  if (code === 1) return '대체로 맑음'
  if (code === 2) return '구름 조금'
  if (code === 3) return '흐림'
  if (code === 45 || code === 48) return '안개'
  if (code >= 51 && code <= 57) return '이슬비'
  if (code >= 61 && code <= 67) return '비'
  if (code >= 71 && code <= 77) return '눈'
  if (code >= 80 && code <= 82) return '소나기'
  if (code === 85 || code === 86) return '소낙눈'
  if (code >= 95) return '뇌우'
  return '흐림'
}

/** 날씨를 인사말에 녹일 한 조각 — 수치를 읽지 않고 체감 표현으로 */
export function weatherMoodOf(weather: HomeWeather | null | undefined): string {
  if (!weather) return ''
  const wet = /비|소나기|이슬비|뇌우/.test(weather.label)
  const snow = /눈/.test(weather.label)
  if (snow) return '눈 오는'
  if (wet) return '비 오는'
  if (weather.tempC >= 28) return '더운'
  if (weather.tempC <= 5) return '쌀쌀한'
  if (weather.humidity != null && weather.humidity <= 35) return '건조한'
  if (/맑음/.test(weather.label)) return '맑은'
  if (/흐림|안개/.test(weather.label)) return '흐린'
  return ''
}

/* ── 시간대 ── */
export type TimeBucket = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'
export function timeBucketOf(hour: number): TimeBucket {
  if (hour < 6) return 'dawn'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}
export const TIME_BUCKET_LABEL: Record<TimeBucket, string> = {
  dawn: '이른 새벽',
  morning: '아침',
  noon: '점심 무렵',
  afternoon: '오후',
  evening: '저녁',
  night: '밤',
}

export type HomePersonalizeInput = {
  name?: string
  profile?: Profile
  now: { iso: string; hour: number; weekday: number }
  weather?: HomeWeather | null
  threads?: HomeThreadDigest[]
  recentSearches?: string[]
}

const skinOf = (profile?: Profile) => profile?.find((it) => /피부/.test(it.label))?.value?.trim() || ''
const toneOf = (profile?: Profile) => profile?.find((it) => /컬러|톤/.test(it.label))?.value?.trim() || ''
const quote = (text: string) => `「${String(text).trim().slice(0, 28)}」`

/** LLM 없이 만드는 인사말 — 이름 · 시간대(+날씨) · 가장 최근 쓰레드 이어가기 제안 (없으면 프로필 제안) */
export function heuristicHomeGreeting(input: HomePersonalizeInput): string {
  const head = input.name ? `${input.name}님, ` : ''
  const mood = weatherMoodOf(input.weather)
  const when = `${mood ? `${mood} ` : ''}${TIME_BUCKET_LABEL[timeBucketOf(input.now.hour)]}`
  const latest = (input.threads || [])[0]
  let tail: string
  if (latest) {
    const cartCount = latest.cart?.length || 0
    if (latest.status === 'completed') tail = `지난 ${quote(latest.title)} 계획은 잘 쓰고 계세요? 오늘은 새 고민을 적어 보세요.`
    else if (latest.stage === 'plan') tail = `${quote(latest.title)} 계획${cartCount ? `에 담은 ${cartCount}개 상품` : ''}, 다음 단계로 이어가 볼까요?`
    else tail = `${quote(latest.title)} 설문을 이어서 답해 볼까요?`
  } else {
    const skin = skinOf(input.profile)
    const tone = toneOf(input.profile)
    tail = skin
      ? `${skin} 피부${tone ? `·${tone}` : ''}에 맞는 오늘의 루틴을 찾아볼까요?`
      : '오늘의 뷰티 고민을 검색창에 적어 보세요.'
  }
  return `${head}${when}이에요. ${tail}`
}

/** LLM 없이 만드는 개인화 추천 검색어 — 최근 쓰레드 제목(라이브 검색어·시나리오 제목) 최대 2개 + 프로필 템플릿으로 3개 채움 */
export function heuristicHomeSuggestions(input: HomePersonalizeInput): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (text: string) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim()
    const key = normalizeSearchKeyword(t)
    if (!t || t.length > 24 || seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  for (const thread of (input.threads || []).slice(0, 5)) {
    if (out.length >= 2) break
    push(thread.title)
  }
  const skin = skinOf(input.profile)
  const month = Number((/^\d{4}-(\d{2})/.exec(input.now.iso) || [])[1]) || new Date().getMonth() + 1
  const season = month >= 3 && month <= 5 ? '봄' : month >= 6 && month <= 8 ? '여름' : month >= 9 && month <= 11 ? '가을' : '겨울'
  const mood = weatherMoodOf(input.weather)
  if (mood === '건조한' || (input.weather && input.weather.humidity != null && input.weather.humidity <= 40)) push(`${skin ? `${skin} 피부 ` : ''}건조할 때 수분 루틴`)
  if (mood === '비 오는') push('습한 날 안 무너지는 베이스')
  push(`${skin ? `${skin} 피부 ` : ''}${season} 데일리 베이스`)
  push(`${season} 립 컬러 추천`)
  push('환절기 피부 진정 루틴')
  return out.slice(0, 3)
}
