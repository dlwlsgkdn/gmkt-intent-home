import { Injectable, Logger } from '@nestjs/common'
import { CoreClientService } from '../core-client.service'

/*
 * 생성 엔진 플래그 (DESIGN-PIPELINE-LANGGRAPH.md 페이즈 2) — legacy | langgraph 병행 배치.
 * 기본값 legacy(안전 롤아웃), 전환 판정(페이즈 5) 후 기본값을 바꾼다.
 * - core 설정 KV `engine` — 관리 조작은 core internal API로 (스튜디오 UI는 페이즈 4)
 * - 요청 헤더 x-ddak-engine — 테스트·비교용 요청 단위 오버라이드 (유효값만 인정)
 * 30s 캐시는 llm-model 설정과 같은 규칙 — 변경이 새 생성에 반영되는 최대 지연.
 */

export const ENGINE_SETTING_KEY = 'engine'
export type EngineId = 'legacy' | 'langgraph'
const CACHE_MS = 30_000

const isEngineId = (v: unknown): v is EngineId => v === 'legacy' || v === 'langgraph'

@Injectable()
export class EngineFlagService {
  private readonly logger = new Logger(EngineFlagService.name)
  private cache: { value: EngineId; at: number } | null = null

  constructor(private readonly core: CoreClientService) {}

  async resolve(override?: string): Promise<EngineId> {
    if (isEngineId(override)) return override
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    let value: EngineId = 'legacy'
    try {
      const setting = await this.core.getSetting(ENGINE_SETTING_KEY)
      if (isEngineId(setting?.value)) value = setting.value
      else if (setting?.value != null) this.logger.warn(`engine 설정값이 유효하지 않아 legacy 사용: ${String(setting.value)}`)
    } catch (e) {
      this.logger.warn(`engine 설정 조회 실패 — legacy 사용: ${(e as Error).message}`)
    }
    this.cache = { value, at: Date.now() }
    return value
  }
}
