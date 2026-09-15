import { Injectable, Logger } from '@nestjs/common'
import type { PopularSearchEntry } from '@ddak/schema'
import { POPULAR_SEARCH_SEED, bumpPopularSearch, parsePopularSearches, rankPopularSearches } from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'

/*
 * 인기 검색어(홈 파랑 칩) — "전체 사용자 기준" 후보 표. 원천은 core 설정 KV `search-popular`(JSON `[{keyword,count}]`):
 * 표가 아직 없으면 @ddak/pipeline 시드로 답하면서 같은 값을 KV 에 한 번 시딩하고(그 뒤로는 KV 가 원천 — 운영자가 core
 * 설정으로 후보·순서를 손볼 수 있다), 검색 제출(`POST /api/search/route`)이 후보 표의 검색어와 일치하면 count 가 1 오른다
 * (임의 검색어는 표에 넣지 않는다 — 모두에게 노출되는 칩이라 후보는 표 안에서만 움직인다). 조회는 30초 캐시,
 * core 미연결이면 시드로 답한다(5초 뒤 재시도). 순위 규칙(내림차순·동률 가나다·정규화 중복 제거)은 rankPopularSearches.
 */
export const POPULAR_SEARCH_KEY = 'search-popular'
const CACHE_MS = 30_000
const FAIL_CACHE_MS = 5_000

type Loaded = { list: PopularSearchEntry[]; source: 'kv' | 'seed' }

@Injectable()
export class PopularSearchesService {
  private readonly logger = new Logger(PopularSearchesService.name)
  private cache: { loaded: Loaded; at: number; ttl: number } | null = null
  private seeding: Promise<void> | null = null

  constructor(private readonly core: CoreClientService) {}

  async list(limit = 3): Promise<{ items: PopularSearchEntry[]; source: 'kv' | 'seed' }> {
    const loaded = await this.load()
    return { items: rankPopularSearches(loaded.list, limit), source: loaded.source }
  }

  /** 검색 제출 반영 (fire-and-forget) — 후보 표에 있는 검색어만 +1. 캐시도 같이 올려 다음 조회에 바로 보인다 */
  bump(query: string) {
    this.load()
      .then(async (loaded) => {
        const next = bumpPopularSearch(loaded.list, query)
        if (!next) return
        this.cache = { loaded: { list: next, source: loaded.source }, at: Date.now(), ttl: CACHE_MS }
        await this.core.putSetting(POPULAR_SEARCH_KEY, next)
      })
      .catch((e) => this.logger.warn(`인기 검색어 반영 실패(${query}): ${(e as Error).message}`))
  }

  private async load(): Promise<Loaded> {
    if (this.cache && Date.now() - this.cache.at < this.cache.ttl) return this.cache.loaded
    try {
      const setting = await this.core.getSetting(POPULAR_SEARCH_KEY)
      const parsed = parsePopularSearches(setting?.value)
      if (parsed) {
        const loaded: Loaded = { list: parsed, source: 'kv' }
        this.cache = { loaded, at: Date.now(), ttl: CACHE_MS }
        return loaded
      }
      // 표가 아직 없다(또는 형식이 깨졌다) — 시드로 답하고 같은 값을 KV 에 한 번 시딩한다
      this.seed()
      const loaded: Loaded = { list: POPULAR_SEARCH_SEED, source: 'seed' }
      this.cache = { loaded, at: Date.now(), ttl: CACHE_MS }
      return loaded
    } catch (e) {
      this.logger.warn(`인기 검색어 표 조회 실패 — 시드로 대신: ${(e as Error).message}`)
      const loaded: Loaded = { list: POPULAR_SEARCH_SEED, source: 'seed' }
      this.cache = { loaded, at: Date.now(), ttl: FAIL_CACHE_MS }
      return loaded
    }
  }

  private seed() {
    if (this.seeding) return
    this.seeding = this.core
      .putSetting(POPULAR_SEARCH_KEY, POPULAR_SEARCH_SEED)
      .then(() => {
        this.cache = { loaded: { list: POPULAR_SEARCH_SEED, source: 'kv' }, at: Date.now(), ttl: CACHE_MS }
      })
      .catch((e) => this.logger.warn(`인기 검색어 표 시딩 실패: ${(e as Error).message}`))
      .finally(() => {
        this.seeding = null
      })
  }
}
