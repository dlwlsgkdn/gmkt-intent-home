import { cartEntries } from './cart.js'

/*
 * 홈 첫 화면 개인화 재료 — @ddak/pipeline `home.ts` 의 거울 (FE 는 워크스페이스 패키지를 import 하지 않는다).
 *  - POPULAR_SEARCH_SEED / rankPopularSearches: 인기 검색어(파랑 칩) 후보 표와 인기순 규칙 — BFF `GET /api/search/popular`
 *    가 막혔을 때 같은 표로 답한다
 *  - heuristicHomeGreeting / heuristicHomeSuggestions: LLM(`POST /api/search/home`) 이 막혔거나 늦을 때의 인사말·개인화 검색어(보라 칩)
 *  - threadDigests / nowInfo / homeSignature / 세션 캐시: 훅(hooks/useHomePersonalize.js)이 쓰는 입력 요약과 캐시 키
 * 규칙을 바꾸면 패키지 쪽과 같이 맞출 것.
 */

/* 인기 검색어 후보 표(시드) — BFF 가 core 설정 KV `search-popular` 를 처음 만들 때 넣는 값과 같다 */
export const POPULAR_SEARCH_SEED = [
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

export const normalizeSearchKeyword = (text) =>
  String(text || '').toLowerCase().replace(/^#/, '').replace(/[\s_]+/g, '').trim()

/* 인기순 내림차순 상위 n — 같은 count 면 가나다순, 정규화 기준 중복은 첫 항목만 */
export function rankPopularSearches(list, limit = 3) {
  const seen = new Set()
  return (Array.isArray(list) ? [...list] : [])
    .filter((row) => row && row.keyword && Number.isFinite(Number(row.count)))
    .sort((a, b) => Number(b.count) - Number(a.count) || String(a.keyword).localeCompare(String(b.keyword), 'ko'))
    .filter((row) => {
      const key = normalizeSearchKeyword(row.keyword)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, Math.max(0, limit))
}

/* ── 시간대·날씨 ── */
export function timeBucketOf(hour) {
  if (hour < 6) return 'dawn'
  if (hour < 11) return 'morning'
  if (hour < 14) return 'noon'
  if (hour < 18) return 'afternoon'
  if (hour < 22) return 'evening'
  return 'night'
}
export const TIME_BUCKET_LABEL = { dawn: '이른 새벽', morning: '아침', noon: '점심 무렵', afternoon: '오후', evening: '저녁', night: '밤' }

export function weatherMoodOf(weather) {
  if (!weather) return ''
  const label = String(weather.label || '')
  if (/눈/.test(label)) return '눈 오는'
  if (/비|소나기|이슬비|뇌우/.test(label)) return '비 오는'
  if (weather.tempC >= 28) return '더운'
  if (weather.tempC <= 5) return '쌀쌀한'
  if (weather.humidity != null && weather.humidity <= 35) return '건조한'
  if (/맑음/.test(label)) return '맑은'
  if (/흐림|안개/.test(label)) return '흐린'
  return ''
}

/* 기기 현지 시각 — 서버(UTC)가 아니라 이 값으로 시간대·날짜를 정한다. iso 는 오프셋이 붙은 현지 표기 */
export function nowInfo(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return { iso, hour: date.getHours(), weekday: date.getDay() }
}

const skinOf = (profile) => (profile || []).find((it) => /피부/.test(it.label))?.value?.trim() || ''
const toneOf = (profile) => (profile || []).find((it) => /컬러|톤/.test(it.label))?.value?.trim() || ''
const quote = (text) => `「${String(text).trim().slice(0, 28)}」`

/* LLM 없이 만드는 **상태 인사** — 이름 · 시간대(+날씨) · 가장 최근 쓰레드의 상태 한 문장(「」로 감싼 부분이 그 쓰레드 — 홈이 탭 대상으로
   만든다). 검색어·상품 제안은 넣지 않는다(그건 추천 검색어 칩 몫). 쓰레드가 없으면 프로필이 준비돼 있다는 정도로 맞이한다 */
export function heuristicHomeGreeting(input) {
  const head = input.name ? `${input.name}님, ` : ''
  const mood = weatherMoodOf(input.weather)
  const when = `${mood ? `${mood} ` : ''}${TIME_BUCKET_LABEL[timeBucketOf(input.now.hour)]}`
  const latest = (input.threads || [])[0]
  let tail
  if (latest) {
    const cartCount = (latest.cart || []).length
    if (latest.status === 'completed') tail = `지난 ${quote(latest.title)} 계획은 잘 쓰고 계세요?`
    else if (latest.stage === 'plan') tail = cartCount
      ? `${quote(latest.title)} 계획에 담아 둔 상품 ${cartCount}개가 기다리고 있어요.`
      : `${quote(latest.title)} 계획을 보던 중이었어요.`
    else tail = `답하던 ${quote(latest.title)} 설문이 남아 있어요.`
  } else {
    const skin = skinOf(input.profile)
    const tone = toneOf(input.profile)
    tail = skin ? `${skin} 피부${tone ? `·${tone}` : ''} 프로필이 준비돼 있어요.` : '오늘의 뷰티 고민을 편하게 적어 보세요.'
  }
  return `${head}${when}이에요. ${tail}`
}

/* 휴리스틱 인사말이 가리키는 쓰레드 번호 — 최근 쓰레드가 있으면 언제나 1, 없으면 null */
export function heuristicHomeThreadIndex(input) {
  return (input.threads || []).length ? 1 : null
}

/* 인사말의 「」 부분 — 탭 대상(그 쓰레드 이어보기)으로 만들 첫 번째 「…」의 위치. 없으면 null */
export function greetingThreadSpan(text) {
  const m = /「[^」]+」/.exec(String(text || ''))
  return m ? { start: m.index, end: m.index + m[0].length, text: m[0] } : null
}

/* LLM 없이 만드는 개인화 추천 검색어 — 최근 쓰레드 제목 최대 2개 + 프로필·계절 템플릿으로 3개 채움 */
export function heuristicHomeSuggestions(input) {
  const out = []
  const seen = new Set()
  const push = (text) => {
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

/* ── 워크스페이스 쓰레드 → 요약(HomeThreadDigest) ── 최신순 10개, 담은 상품 이름 최근 6개, 답변 값 8개.
   사진 답변(표식·데이터 URL)은 싣지 않는다 */
const PHOTO_MARK = '사진 제출됨'
function answerValues(answers) {
  if (!answers || typeof answers !== 'object') return []
  const out = []
  for (const value of Object.values(answers)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      const text = String(v ?? '').split('|')[0].trim()
      if (!text || text === PHOTO_MARK || text.startsWith('data:')) continue
      out.push(text.slice(0, 60))
    }
  }
  return out
}
export function threadDigests(threads) {
  return (Array.isArray(threads) ? threads : []).slice(0, 10).map((t) => {
    const digest = {
      title: (String(t.title || t.query || '').trim().slice(0, 120)) || '쇼핑 쓰레드',
      stage: t.stage === 'plan' ? 'plan' : 'survey',
      status: t.status === 'completed' ? 'completed' : 'ongoing',
      live: !!t.live,
    }
    if (t.updatedAt) digest.updatedAt = String(t.updatedAt)
    const cart = cartEntries(t.cart).map((entry) => String(entry.name || '').trim().slice(0, 80)).filter(Boolean)
    if (cart.length) digest.cart = cart.slice(-6)
    const answers = answerValues(t.answers).slice(0, 8)
    if (answers.length) digest.answers = answers
    return digest
  })
}

/* 캐시 키 — 같은 프로필·같은 쓰레드 상태·같은 날짜·같은 시(hour)면 결과를 재사용한다(뒤로가기·홈 복귀마다 LLM 을 다시 부르지 않고,
   인사말도 흔들리지 않는다). 쓰레드가 바뀌면(체험 뒤 홈 복귀) 새로 만든다 */
export function homeSignature({ accountId, name, profile, threads, now }) {
  const day = String(now.iso).slice(0, 10)
  const threadKey = (threads || []).map((t) => `${t.title}/${t.stage}/${t.status}/${(t.cart || []).length}`).join(',')
  const profileKey = (profile || []).map((it) => `${it.label}=${it.value}`).join(',')
  return `${accountId}|${name || ''}|${day}|${now.hour}|${profileKey}|${threadKey}`
}

const CACHE_KEY = 'ddak-home-personalize-v1'
const CACHE_LIMIT = 6
function readAll() {
  try {
    const list = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
export function readHomeCache(signature) {
  const hit = readAll().find((entry) => entry && entry.sig === signature)
  return hit ? hit.result : null
}
export function writeHomeCache(signature, result) {
  try {
    const rest = readAll().filter((entry) => entry && entry.sig !== signature)
    sessionStorage.setItem(CACHE_KEY, JSON.stringify([{ sig: signature, result }, ...rest].slice(0, CACHE_LIMIT)))
  } catch {
    /* 세션 저장 불가(사파리 프라이빗 등) — 캐시 없이 진행 */
  }
}
