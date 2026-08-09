import { Injectable, Logger } from '@nestjs/common'
import { ThreadStageFeedback } from '@ddak/schema'
import {
  GUARD_BLOCKLIST_SETTING_KEY,
  knowledgeSettingKey,
  type SystemKnowledge,
} from '@ddak/pipeline'
import { CoreClientService } from '../core-client.service'

/*
 * 지식 소스 조회 (DESIGN-PIPELINE-LANGGRAPH.md §3, 전략 문서 p.13) — 팀 데이터 DB화 전의
 * v0 배관. KV 4종(어휘·규칙·기준·예시)은 시스템 자리표시자로, 트렌드 키워드·블록리스트는
 * 원장/가드로, 쓰레드 피드백(유일한 실데이터)은 core 피드백 스텝에서 사용자 단위로 압축한다.
 * KV 캐시는 30s(모델·프롬프트 설정과 같은 규칙) — 관리 편집이 새 생성에 반영되는 최대 지연.
 * DB/RAG가 준비되면 이 서비스의 조회 구현만 교체한다 — 주입 위치·형식 불변.
 */

const CACHE_MS = 30_000
/** 사용자 피드백 압축 상한 — 가변부는 짧게 (전략 문서 p.3) */
const FEEDBACK_LINES = 3
const FEEDBACK_SCAN_LIMIT = 100

const splitList = (raw: string | null): string[] =>
  raw
    ? raw
        .split(/\r?\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)
  private readonly cache = new Map<string, { value: string | null; at: number }>()

  constructor(private readonly core: CoreClientService) {}

  /** 설정 KV 캐시 조회 — 없는 키·문자열 아님·조회 실패는 null (지식 없이도 파이프라인은 돈다) */
  private async kv(key: string): Promise<string | null> {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
    let value: string | null = null
    try {
      const setting = await this.core.getSetting(key)
      if (typeof setting?.value === 'string' && setting.value.trim()) value = setting.value
    } catch (e) {
      this.logger.warn(`지식 설정 조회 실패(${key}) — 없이 진행: ${(e as Error).message}`)
    }
    this.cache.set(key, { value, at: Date.now() })
    return value
  }

  /** 관리 페이지가 지식 KV를 바꾼 직후 캐시를 비워 즉시 반영한다 (같은 인스턴스 한정) */
  invalidate() {
    this.cache.clear()
  }

  /** 시스템 자리표시자 4종 — resolveSystem(렌더)에서 소비 */
  async systemKnowledge(): Promise<SystemKnowledge> {
    const [vocab, rules, criteria, fewshot] = await Promise.all([
      this.kv(knowledgeSettingKey('consumer-vocab')),
      this.kv(knowledgeSettingKey('survey-rules')),
      this.kv(knowledgeSettingKey('selection-criteria')),
      this.kv(knowledgeSettingKey('fewshot')),
    ])
    return { vocab, rules, criteria, fewshot }
  }

  /** 지금 뜨는 키워드 — 원장 trendKeywords로 (줄바꿈·쉼표 구분) */
  async trendKeywords(): Promise<string[]> {
    return splitList(await this.kv(knowledgeSettingKey('trend-keywords')))
  }

  /** 상품 블록리스트 — 검증 게이트 정확 매칭용 (줄바꿈·쉼표 구분) */
  async blocklist(): Promise<string[]> {
    return splitList(await this.kv(GUARD_BLOCKLIST_SETTING_KEY))
  }

  /** 이 사용자의 직전 쓰레드 피드백 한 줄 압축 — 현재 쓰레드는 제외(그건 revision이 싣는다).
   * core 피드백 스텝(최신순)에서 같은 (쓰레드, 단계)의 최신 제출만 취해 최대 3줄 */
  async recentFeedbackFor(userId: string, excludeThreadId: string): Promise<string[]> {
    try {
      const wire = await this.core.listFeedbackSteps(FEEDBACK_SCAN_LIMIT)
      const seen = new Set<string>()
      const lines: string[] = []
      for (const row of wire.items) {
        if (row.thread.userId !== userId || row.thread.id === excludeThreadId) continue
        const payload = row.step.payload as { type?: string; data?: unknown } | null
        if (payload?.type !== 'feedback') continue
        const parsed = ThreadStageFeedback.safeParse(payload.data)
        if (!parsed.success) continue
        const key = `${row.thread.id}:${parsed.data.stage}`
        if (seen.has(key)) continue
        seen.add(key)
        const line = compressFeedback(parsed.data)
        if (line) lines.push(line)
        if (lines.length >= FEEDBACK_LINES) break
      }
      return lines
    } catch (e) {
      this.logger.warn(`피드백 스텝 조회 실패 — 최근 메모 없이 진행: ${(e as Error).message}`)
      return []
    }
  }
}

/** 피드백 제출 1건 → 한 줄 메모 ("계획 ★2 — 향이 강한 제품은 빼 주세요") — 쓸 내용 없으면 null */
function compressFeedback(fb: ThreadStageFeedback): string | null {
  const stage = fb.stage === 'survey' ? '설문' : '계획'
  const comment = (fb.review.feedback || fb.components.find((c) => c.feedback)?.feedback || '').trim()
  const score = fb.review.score ?? fb.components.find((c) => c.score != null)?.score ?? null
  if (score == null && !comment) return null
  const star = score != null ? `★${score}` : ''
  const text = comment ? ` — ${comment.slice(0, 60)}` : ''
  return `${stage} ${star}${text}`.replace(/\s+/g, ' ').trim()
}
