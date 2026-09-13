import { Injectable, Logger } from '@nestjs/common'
import type { ContentsSectionGen, ProductsSectionGen } from '@ddak/pipeline'

/*
 * 썸네일 보강 — 검색 단계가 확인하지 못한 imageUrl 을 페이지의 og:image 로 채운다 (2026-09 분석: 웹 상품 썸네일 0%,
 * 콘텐츠 썸네일 0%). 항목당 1.5초·전체 3초 예산 안에서 병렬로 한 번만 시도하고, 실패는 조용히 둔다 — FE 가 이모지 목업·
 * 유튜브 자동 썸네일·매체명 자리 카드로 받는다. 결과는 인메모리 캐시(10분).
 *  - 콘텐츠: 티스토리·워드프레스·다음 블로그처럼 서버가 og:image 를 렌더하는 곳은 그림이 붙는다. 유튜브는 FE 가 이미 자동 썸네일을
 *    만들고, 틱톡은 FE 가 oEmbed 로 받는다 — 여기서는 건너뛴다.
 *  - 상품: PDP 주소(urlKind=pdp)만. 올리브영은 클라이언트 렌더라 og:image 가 기본 그림(img_oy_default)이고 쿠팡은 403 이라
 *    건너뛴다 — 지마켓 item 페이지 같은 곳만 실효가 있다. 몰 검색 링크(urlKind=search)는 그림이 없으니 시도하지 않는다.
 * ENRICH_FETCH=0 이면 전부 건너뛴다 (오프라인 e2e).
 */
const ITEM_TIMEOUT_MS = 1500
const TOTAL_BUDGET_MS = 3000
const CACHE_MS = 10 * 60_000
const MAX_HTML = 300_000
const SKIP_HOSTS = [/(^|\.)youtube\.com$/, /(^|\.)youtu\.be$/, /(^|\.)tiktok\.com$/, /(^|\.)oliveyoung\.co\.kr$/, /(^|\.)coupang\.com$/, /(^|\.)instagram\.com$/]
const DEFAULT_IMAGE = /default|placeholder|logo|favicon|blank|noimage|no-image/i
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36 ddak-bff/enrich'

@Injectable()
export class EnrichService {
  private readonly logger = new Logger(EnrichService.name)
  private readonly cache = new Map<string, { value: string | null; at: number }>()
  readonly enabled = process.env.ENRICH_FETCH !== '0'

  private hostOf(url: string): string | null {
    try {
      const u = new URL(url)
      if (!['http:', 'https:'].includes(u.protocol)) return null
      return u.hostname.toLowerCase()
    } catch {
      return null
    }
  }

  /** 페이지의 og:image (절대 URL) — 없거나 기본 그림이면 null. 캐시 10분 */
  async ogImage(url: string): Promise<string | null> {
    if (!this.enabled) return null
    const host = this.hostOf(url)
    if (!host || SKIP_HOSTS.some((re) => re.test(host))) return null
    const cached = this.cache.get(url)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ITEM_TIMEOUT_MS)
    let value: string | null = null
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html' } })
      if (res.ok && /text\/html/.test(res.headers.get('content-type') || '')) {
        const html = (await res.text()).slice(0, MAX_HTML)
        const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i)
        if (m) {
          let image = m[1].trim()
          if (image.startsWith('//')) image = `https:${image}`
          else if (image.startsWith('/')) image = new URL(image, res.url || url).toString()
          if (/^https?:\/\//.test(image) && !DEFAULT_IMAGE.test(image)) value = image
        }
      }
    } catch {
      /* 타임아웃·차단 — 그림 없이 진행 */
    } finally {
      clearTimeout(timer)
    }
    this.cache.set(url, { value, at: Date.now() })
    return value
  }

  /** 예산 안에서 병렬 보강 — 끝나지 않은 항목은 그대로 둔다 */
  private async withBudget(tasks: (() => Promise<void>)[]) {
    if (!this.enabled || !tasks.length) return
    const all = Promise.allSettled(tasks.map((task) => task()))
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, TOTAL_BUDGET_MS))])
  }

  /** 콘텐츠 항목의 빈 imageUrl 을 og:image 로 (섹션 원본을 제자리에서 고친다 — 검증 게이트가 이어서 http(s) 검증한다) */
  async enrichContents(sections: ContentsSectionGen[]): Promise<number> {
    let filled = 0
    await this.withBudget(
      sections.flatMap((section) =>
        section.items
          .filter((item) => !item.imageUrl)
          .map((item) => async () => {
            const image = await this.ogImage(item.url)
            if (image) {
              item.imageUrl = image
              filled += 1
            }
          }),
      ),
    )
    if (filled) this.logger.log(`콘텐츠 썸네일 보강 ${filled}건`)
    return filled
  }

  /** 웹 상품(PDP 주소)의 빈 imageUrl 을 og:image 로 */
  async enrichProducts(sections: ProductsSectionGen[]): Promise<number> {
    let filled = 0
    await this.withBudget(
      sections.flatMap((section) =>
        section.webProducts
          .filter((product) => !product.imageUrl && product.urlKind !== 'search')
          .map((product) => async () => {
            const image = await this.ogImage(product.url)
            if (image) {
              product.imageUrl = image
              filled += 1
            }
          }),
      ),
    )
    if (filled) this.logger.log(`상품 썸네일 보강 ${filled}건`)
    return filled
  }
}
