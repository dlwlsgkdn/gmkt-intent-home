import { Injectable, Logger } from '@nestjs/common'
import type { HomeWeather } from '@ddak/schema'
import { weatherLabelOf } from '@ddak/pipeline'

/*
 * 현재 날씨 — 홈 인사말 재료. Open-Meteo(키 없음, https://api.open-meteo.com) 의 current 블록을 1.5초 안에 받고,
 * 좌표(0.1도 반올림)별 10분 캐시. 위치는 FE 가 이미 허용된 권한이 있을 때만 보내고, 없으면 서울(시청) 기준이다.
 * 실패는 언제나 null — 인사말은 날씨 없이도 만들어지므로 조회 실패가 응답을 막지 않는다(실패도 1분 캐시).
 * WEATHER_API_URL 로 엔드포인트를 바꾸거나(e2e 모의) 빈 문자열로 끌 수 있다.
 */
const DEFAULT_URL = 'https://api.open-meteo.com/v1/forecast'
const SEOUL = { lat: 37.5665, lon: 126.978 }
const CACHE_MS = 10 * 60_000
const FAIL_CACHE_MS = 60_000
const TIMEOUT_MS = 1500

type OpenMeteoCurrent = { temperature_2m?: number; relative_humidity_2m?: number; weather_code?: number }

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name)
  private readonly cache = new Map<string, { value: HomeWeather | null; at: number; ttl: number }>()

  async current(location?: { lat: number; lon: number }): Promise<HomeWeather | null> {
    const base = process.env.WEATHER_API_URL === undefined ? DEFAULT_URL : process.env.WEATHER_API_URL
    if (!base) return null
    const lat = location?.lat ?? SEOUL.lat
    const lon = location?.lon ?? SEOUL.lon
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < cached.ttl) return cached.value
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const qs = new URLSearchParams({
        latitude: lat.toFixed(3),
        longitude: lon.toFixed(3),
        current: 'temperature_2m,relative_humidity_2m,weather_code',
        timezone: 'auto',
      })
      const res = await fetch(`${base}?${qs.toString()}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { current?: OpenMeteoCurrent }
      const cur = data.current
      if (!cur || typeof cur.temperature_2m !== 'number') throw new Error('current 블록 없음')
      const code = typeof cur.weather_code === 'number' ? cur.weather_code : 3
      const value: HomeWeather = { tempC: cur.temperature_2m, code, label: weatherLabelOf(code) }
      if (typeof cur.relative_humidity_2m === 'number') value.humidity = cur.relative_humidity_2m
      this.cache.set(key, { value, at: Date.now(), ttl: CACHE_MS })
      return value
    } catch (e) {
      this.logger.warn(`날씨 조회 실패(${key}) — 날씨 없이 진행: ${(e as Error).message}`)
      this.cache.set(key, { value: null, at: Date.now(), ttl: FAIL_CACHE_MS })
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
