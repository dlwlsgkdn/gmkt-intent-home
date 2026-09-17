import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { CatalogSeedJob, type CatalogSeedJobBatch, type StartCatalogSeedJobBody } from '@ddak/schema'
import { catalogSeedQueries, type CatalogSeedQuery } from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'
import { CatalogService } from './catalog.service'

/*
 * 시딩 잡 (2026-09-17) — 대량 웹 검색 시딩의 상태 기계. 상태는 core 설정 KV `catalog-seed-job` 한 칸(JSON)에 있고, 처리는 드라이버
 * (운영 콘솔 탭·배치 스크립트)가 `step()` 을 반복 호출해 8단위씩 전진시킨다:
 *   본 회차: cursor 0 → total (검색 단위 = catalogSeedQueries(facets, types) 의 결정적 순서)
 *   재시도 회차: 본 회차에서 실패한 단위(retry)를 한 번 더 → 그래도 실패하면 failed
 *   둘 다 끝나면 status=done. 일시정지(paused)면 step 이 처리하지 않는다.
 * 드라이버 둘이 같은 잡을 동시에 밀지 않게 lockUntil(처리 시간 상한 270초 — 서버리스 300초 안)을 걸고, 잠금 중이면 busy 로 물러난다.
 * 회차 기록(history)은 최근 40개만 — KV 한 칸이 커지지 않게. 검색 단위 목록은 저장하지 않고 facets·types 에서 다시 만든다.
 */
export const CATALOG_SEED_JOB_KEY = 'catalog-seed-job'
const BATCH = 8
const LOCK_MS = 270_000
const HISTORY_LIMIT = 40

@Injectable()
export class CatalogSeedJobService {
  private readonly logger = new Logger(CatalogSeedJobService.name)

  constructor(
    private readonly core: CoreClientService,
    private readonly catalog: CatalogService,
  ) {}

  async get(): Promise<CatalogSeedJob | null> {
    const setting = await this.core.getSetting(CATALOG_SEED_JOB_KEY)
    if (!setting) return null
    const parsed = CatalogSeedJob.safeParse(setting.value)
    return parsed.success ? parsed.data : null
  }

  private async save(job: CatalogSeedJob): Promise<CatalogSeedJob> {
    job.updatedAt = new Date().toISOString()
    await this.core.putSetting(CATALOG_SEED_JOB_KEY, job)
    return job
  }

  private queriesOf(job: CatalogSeedJob): CatalogSeedQuery[] {
    return catalogSeedQueries({ facets: job.facets, types: job.types })
  }

  /** 새 잡 — 진행 중·일시정지 잡이 있으면 reset 없이는 409 (실수로 진행을 날리지 않게) */
  async start(body: StartCatalogSeedJobBody): Promise<CatalogSeedJob> {
    const existing = await this.get()
    if (existing && existing.status !== 'done' && !body.reset) {
      throw new ConflictException('진행 중인 시딩 잡이 있어요 — 이어 돌리거나 reset 으로 새로 시작하세요')
    }
    const facets = body.facets ?? []
    const types = body.types ?? []
    const total = catalogSeedQueries({ facets, types }).length
    const now = new Date().toISOString()
    const job: CatalogSeedJob = {
      id: `seed-${Date.now().toString(36)}`,
      status: 'running',
      facets,
      types,
      dense: body.dense ?? false,
      total,
      cursor: 0,
      retry: [],
      retryCursor: 0,
      failed: [],
      products: 0,
      verified: 0,
      webSearchRequests: 0,
      lockUntil: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      history: [],
      lastError: null,
    }
    this.logger.log(`시딩 잡 시작 ${job.id} — 검색 단위 ${total} (조건 ${facets.join('+') || '없음'}${job.dense ? ' · dense' : ''})`)
    return this.save(job)
  }

  async setStatus(status: 'running' | 'paused'): Promise<CatalogSeedJob> {
    const job = await this.get()
    if (!job) throw new NotFoundException('시딩 잡이 없어요')
    if (job.status === 'done') throw new ConflictException('끝난 잡이에요 — 새로 시작하세요')
    job.status = status
    return this.save(job)
  }

  async clear(): Promise<{ ok: true }> {
    await this.core.deleteSetting(CATALOG_SEED_JOB_KEY)
    return { ok: true }
  }

  /** 한 회차(≤8단위) 전진. running 이 아니거나 잠금 중이면 처리 없이 현재 상태를 돌려준다 */
  async step(): Promise<{ job: CatalogSeedJob | null; busy: boolean }> {
    const job = await this.get()
    if (!job || job.status !== 'running') return { job, busy: false }
    if (job.lockUntil && new Date(job.lockUntil).getTime() > Date.now()) return { job, busy: true }

    const queries = this.queriesOf(job)
    let batch: CatalogSeedQuery[]
    let pass: CatalogSeedJobBatch['pass']
    if (job.cursor < queries.length) {
      batch = queries.slice(job.cursor, job.cursor + BATCH)
      pass = 'main'
    } else if (job.retryCursor < job.retry.length) {
      const byQuery = new Map(queries.map((q) => [q.query, q]))
      batch = job.retry
        .slice(job.retryCursor, job.retryCursor + BATCH)
        .map((q) => byQuery.get(q))
        .filter((q): q is CatalogSeedQuery => Boolean(q))
      pass = 'retry'
    } else {
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
      job.lockUntil = null
      this.logger.log(`시딩 잡 완료 ${job.id} — 상품 ${job.products}(검증 ${job.verified}) · 실패 ${job.failed.length}`)
      return { job: await this.save(job), busy: false }
    }

    job.lockUntil = new Date(Date.now() + LOCK_MS).toISOString()
    await this.save(job)
    try {
      const r = await this.catalog.seedBySearch(batch.map((q) => ({ keyword: q.keyword, query: q.query })), job.dense)
      const failedSet = new Set(r.failed)
      if (pass === 'main') {
        job.cursor += batch.length
        job.retry.push(...batch.map((q) => q.query).filter((q) => failedSet.has(q)))
      } else {
        job.retryCursor += batch.length
        job.failed.push(...batch.map((q) => q.query).filter((q) => failedSet.has(q)))
      }
      job.products += r.products
      job.verified += r.verified
      job.webSearchRequests += r.webSearchRequests
      job.history = [
        { at: new Date().toISOString(), queries: batch.map((q) => q.query), products: r.products, verified: r.verified, webSearchRequests: r.webSearchRequests, failed: r.failed, pass },
        ...job.history,
      ].slice(0, HISTORY_LIMIT)
      job.lastError = null
    } catch (e) {
      // 회차 통째 실패(core 불통 등) — 위치는 그대로 두고 오류만 남긴다. 다음 step 이 같은 회차를 다시 민다
      job.lastError = (e as Error).message
      this.logger.warn(`시딩 잡 회차 실패 ${job.id}: ${job.lastError}`)
    }
    job.lockUntil = null
    // 이번 회차로 본·재시도 회차가 모두 끝났으면 바로 done 으로 (드라이버가 한 번 더 부르지 않아도 되게)
    if (job.cursor >= queries.length && job.retryCursor >= job.retry.length && !job.lastError) {
      job.status = 'done'
      job.finishedAt = new Date().toISOString()
      this.logger.log(`시딩 잡 완료 ${job.id} — 상품 ${job.products}(검증 ${job.verified}) · 실패 ${job.failed.length}`)
    }
    return { job: await this.save(job), busy: false }
  }
}
