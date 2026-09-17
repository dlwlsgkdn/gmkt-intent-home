import { Injectable, Logger } from '@nestjs/common'
import type { Answer, CatalogContentRow, CatalogProductRow, PlanPageWire, Profile, SurveyPageWire } from '@ddak/schema'
import {
  candidateContentOf,
  candidateProductOf,
  catalogTermsOf,
  gmarketThumb,
  harvestRowsOf,
  seedProductRowsOf,
  staticCandidates,
  type CatalogCandidates,
  type CatalogTerms,
  type ConstraintLedger,
} from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'
import { LlmService } from '../llm/llm.service'

/*
 * 내재화 카탈로그 배관 (2026-09-17, v29) — 계획 생성의 상품·콘텐츠 원천을 「웹 검색만」에서 「내부 DB 절반 + 웹 검색 절반」으로.
 *  - candidatesFor: 의도·답변·프로필 → 검색어(@ddak/pipeline catalogTermsOf) → core 검색 → 5b·5c 가변부 후보 표 + 검증 게이트 후보 목록.
 *    core 미연결·표 없음(마이그레이션 전)·조회 실패면 데모 카탈로그 14종으로 대신한다(옛 {{CATALOG}} 와 같은 상품) — 계획을 막지 않는다.
 *  - harvest: 7단계 기록 직후 최종 페이지의 상품·콘텐츠를 DB 에 올린다(bump upsert). 계획이 만들어질수록 표가 자란다.
 *  - verifyProducts: 지마켓은 썸네일(gdimg)·그 밖의 몰은 상품 주소에 HEAD 로 리스팅 생사를 안다(404 = 내려감 → dead). 올리브영·쿠팡은
 *    Node 에서 닿지 못해 건너뛴다(상품 번호 형식으로 verified). 운영 콘솔 점검 버튼이 부른다.
 *  - 몰 범위: 지마켓뿐 아니라 올리브영·쿠팡(상품 번호 형식)·그 밖의 몰(썸네일을 받아 온 것)도 verified 로 후보가 된다 (2026-09-17).
 *  - 시딩 재료(2026-09-17 결정): ① 올리브영 사내 Mongo 내보내기(JSON 가져오기 importRows) ② 지난 쓰레드의 계획(수확 — admin harvest 백필)
 *    ③ 시딩 실행 시 실제 웹 검색 배치(seedBySearch — 제품 유형마다 LLM+web_search). 스냅샷·데모 카탈로그 시딩은 뗐다.
 * 응답 시간: 검색은 core 왕복 2회(상품·콘텐츠 병렬)로 수백 ms — 5b 웹 검색(수십 초)에 비하면 없는 셈이고 검색 횟수를 줄여 전체를 앞당긴다.
 */
export const PRODUCT_CANDIDATE_LIMIT = 24
export const CONTENT_CANDIDATE_LIMIT = 12
/** 웹 검색 예산 축소 기준(후보 개수)은 llm.service RICH_* 가 갖는다 */
const VERIFY_TIMEOUT_MS = 2500
/** 시딩 웹 검색 배치의 동시 LLM 호출 수 — 잡 회차(4단위)를 한 라운드로 돌린다. 호출 하나는 SEED_CALL_TIMEOUT_MS 를 넘기면 실패로
 * 끊어 회차가 서버리스 300초 한도 안에 끝나게 한다(끊긴 단위는 재시도 회차로) — 2026-09-17 운영에서 8단위·3병렬이 한도를 넘겼다 */
const SEED_CONCURRENCY = 4
const SEED_CALL_TIMEOUT_MS = 220_000
const VERIFY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/** 약속에 시간 상한 — 넘기면 거부(원 호출은 버려진다; SDK 가 알아서 끝낸다) */
const withTimeout = <T,>(p: Promise<T>, ms: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })

export type CatalogCandidatesResult = CatalogCandidates & {
  terms: CatalogTerms
  /** db = core 검색 결과, static = 데모 카탈로그 대체(조회 실패·빈 표), none = 후보 없음 */
  source: 'db' | 'static' | 'none'
}

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name)
  /** 조회 실패 뒤 잠깐 core 를 두드리지 않는다 (마이그레이션 전 404·500 이 계획마다 반복되지 않게) */
  private disabledUntil = 0

  constructor(
    private readonly core: CoreClientService,
    private readonly llm: LlmService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.CORE_URL) && Date.now() >= this.disabledUntil
  }

  async candidatesFor(input: {
    intent: string
    survey?: SurveyPageWire | null
    answers?: Answer[] | null
    profile?: Profile | null
    ledger?: ConstraintLedger | null
  }): Promise<CatalogCandidatesResult> {
    const terms = catalogTermsOf(input)
    if (!terms.terms.length) return { ...staticCandidates(), terms, source: 'static' }
    if (!this.enabled) return { ...staticCandidates(), terms, source: 'static' }
    try {
      const query = { terms: terms.terms, typeTerms: terms.typeTerms }
      const [products, contents] = await Promise.all([
        this.core.searchCatalogProducts({ ...query, limit: PRODUCT_CANDIDATE_LIMIT }),
        this.core.searchCatalogContents({ ...query, limit: CONTENT_CANDIDATE_LIMIT }).catch((e) => {
          this.logger.warn(`내부 콘텐츠 후보 조회 실패 — 없이 진행: ${(e as Error).message}`)
          return { items: [] as (CatalogContentRow & { score: number })[], total: 0 }
        }),
      ])
      if (!products.items.length && products.total === 0) {
        // 표가 비어 있다(시딩 전) — 데모 카탈로그로 대신
        return { ...staticCandidates(), contents: contents.items.map(candidateContentOf), terms, source: 'static' }
      }
      return {
        products: products.items.map(candidateProductOf),
        contents: contents.items.map(candidateContentOf),
        terms,
        source: products.items.length || contents.items.length ? 'db' : 'none',
      }
    } catch (e) {
      this.logger.warn(`내부 카탈로그 조회 실패 — 데모 카탈로그로 대신: ${(e as Error).message}`)
      this.disabledUntil = Date.now() + 30_000
      return { ...staticCandidates(), terms, source: 'static' }
    }
  }

  /** 최종 계획 페이지 → DB 수확. 실패는 로그만 (기록·응답을 막지 않는다). 반환은 올린 행 수 */
  async harvest(page: PlanPageWire, terms: string[]): Promise<{ products: number; contents: number }> {
    if (!this.enabled) return { products: 0, contents: 0 }
    const rows = harvestRowsOf(page, terms)
    const out = { products: 0, contents: 0 }
    try {
      if (rows.products.length) out.products = (await this.core.upsertCatalogProducts({ items: rows.products, bump: true })).upserted
      if (rows.contents.length) out.contents = (await this.core.upsertCatalogContents({ items: rows.contents, bump: true })).upserted
      if (out.products || out.contents) this.logger.log(`카탈로그 수확 — 상품 ${out.products} · 콘텐츠 ${out.contents}`)
    } catch (e) {
      this.logger.warn(`카탈로그 수확 실패: ${(e as Error).message}`)
    }
    return out
  }

  /** 시딩 웹 검색 배치 — 제품 유형마다 LLM+web_search 1회(동시 3개)로 판매 상품을 모아 행으로 upsert. 유형 하나의 실패는 건너뛰고
   * failed 에 남긴다(운영 콘솔이 다시 돌린다). bump 없음 = 새 값 그대로(이미 수확된 행의 recommendCount 는 건드리지 않는다) */
  async seedBySearch(
    queries: { keyword: string; query?: string }[],
    dense = false,
  ): Promise<{ keywords: number; failed: string[]; products: number; verified: number; webSearchRequests: number }> {
    const out = { keywords: queries.length, failed: [] as string[], products: 0, verified: 0, webSearchRequests: 0 }
    const rows: CatalogProductRow[] = []
    const now = new Date().toISOString()
    const queue = [...queries]
    const worker = async () => {
      for (let q = queue.shift(); q !== undefined; q = queue.shift()) {
        const label = q.query && q.query !== q.keyword ? q.query : q.keyword
        try {
          const { content, meta } = await withTimeout(
            this.llm.collectCatalogProducts(q.keyword, { query: q.query, dense }),
            SEED_CALL_TIMEOUT_MS,
            `카탈로그 수집(${label}) ${SEED_CALL_TIMEOUT_MS / 1000}초 초과`,
          )
          out.webSearchRequests += meta.usage?.webSearchRequests ?? 0
          rows.push(...seedProductRowsOf(q.keyword, content.products, now))
        } catch (e) {
          this.logger.warn(`카탈로그 수집 실패(${label}): ${(e as Error).message}`)
          out.failed.push(label)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(SEED_CONCURRENCY, queries.length) }, worker))
    // 같은 상품이 여러 유형에 걸리면 태그·카테고리를 합쳐 한 행으로
    const merged = new Map<string, CatalogProductRow>()
    for (const row of rows) {
      const prev = merged.get(row.id)
      if (prev) prev.tags = [...new Set([...prev.tags, ...row.tags])].slice(0, 30)
      else merged.set(row.id, row)
    }
    const items = [...merged.values()]
    if (items.length) {
      for (let i = 0; i < items.length; i += 500) await this.core.upsertCatalogProducts({ items: items.slice(i, i + 500) })
      this.disabledUntil = 0
    }
    out.products = items.length
    out.verified = items.filter((r) => r.verified).length
    this.logger.log(`카탈로그 시딩(웹 검색) — 검색 단위 ${queries.length} · 상품 ${out.products}(검증 ${out.verified}) · 검색 ${out.webSearchRequests}회`)
    return out
  }

  /** 운영자 가져오기 — 올리브영 사내 Mongo 내보내기 JSON 등. bump 없음 = 값 그대로 */
  async importRows(products: CatalogProductRow[] = [], contents: CatalogContentRow[] = []) {
    const out = { products: 0, contents: 0 }
    if (products.length) out.products = (await this.core.upsertCatalogProducts({ items: products })).upserted
    if (contents.length) out.contents = (await this.core.upsertCatalogContents({ items: contents })).upserted
    this.disabledUntil = 0
    return out
  }

  /** 상품 행 점검 — 몰별로 닿을 수 있는 주소에 HEAD 를 보내 리스팅 생사를 본다 (404·410 = dead, 200 = verified 승격).
   *  - 지마켓: 썸네일(gdimg) — 상품 번호로 결정되고 항상 열린다
   *  - 올리브영·쿠팡: Node 에서는 봇 도전(403)이라 닿지 못한다 → 건너뜀 (상품 번호 형식으로 이미 verified, 운영자 표시로만 내린다)
   *  - 그 밖의 몰: 상품 주소 자체에 HEAD (모바일 UA)
   * mall='*' 면 전 몰을 오래 안 본 순으로 N개 */
  async verifyProducts(mall = '*', limit = 50): Promise<{ checked: number; alive: number; dead: number; skipped: number }> {
    const { items } = await this.core.catalogVerifyList(mall, limit)
    const out = { checked: 0, alive: 0, dead: 0, skipped: 0 }
    const targetOf = (row: CatalogProductRow): string | null => {
      if (row.mall === '지마켓') return row.mallProductId ? gmarketThumb(row.mallProductId) : null
      if (row.mall === '올리브영' || row.mall === '쿠팡') return null
      return row.url
    }
    await Promise.all(
      items.map(async (row) => {
        const target = targetOf(row)
        if (!target) {
          out.skipped += 1
          return
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
        try {
          const res = await fetch(target, { method: 'HEAD', signal: controller.signal, redirect: 'follow', headers: { 'user-agent': VERIFY_UA } })
          out.checked += 1
          if (res.status === 404 || res.status === 410) {
            out.dead += 1
            await this.core.patchCatalogProduct(row.id, { status: 'dead' })
          } else if (res.ok) {
            out.alive += 1
            if (!row.verified) await this.core.patchCatalogProduct(row.id, { verified: true })
          } else out.skipped += 1
        } catch {
          out.skipped += 1
        } finally {
          clearTimeout(timer)
        }
      }),
    )
    return out
  }
}
