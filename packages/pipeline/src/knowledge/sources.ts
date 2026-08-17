/*
 * 지식 소스 카탈로그 — 팀 수집 데이터 5종이 파이프라인에 들어오는 자리 (전략 문서 p.13,
 * DESIGN-PIPELINE-LANGGRAPH.md §3). 데이터 DB화 전이므로 v0 구현은 core 설정 KV
 * (관리 페이지 수동 편집)이고, 쓰레드 피드백만 실데이터(core 스텝)다.
 * DB/RAG가 준비되면 이 카탈로그의 게터 구현만 교체한다 — 주입 위치·형식은 불변.
 */

export type KnowledgeSourceId =
  | 'trend-keywords' // 트렌드 키워드 — 검색어 결합·원장 주입
  | 'survey-rules' // 서비스 설문조사 → 증류된 규칙 문장 ("첫 질문은 성분 축 먼저")
  | 'consumer-vocab' // 트렌드 인터뷰 → 소비자 어휘 사전
  | 'selection-criteria' // 트렌드 인터뷰 → 선택 기준 브리프
  | 'fewshot' // 시나리오 피드백 → 모범 예시 쌍 (스튜디오 상위 케이스 내보내기)
  | 'thread-feedback' // 쓰레드 피드백 — 유일한 실데이터 (core 스텝에서 압축 조회)

export type KnowledgeSourceDef = {
  id: KnowledgeSourceId
  label: string
  /** 어디에 실리나 — system: 캐시되는 시스템 자리표시자, user: 요청별 가변부 압축 */
  injection: 'system' | 'user'
  /** system 주입 시 프롬프트 템플릿의 자리표시자 (renderSystemTemplate 확장 대상) */
  placeholder?: string
  /** kv: core 설정 KV 수동 편집 (knowledgeSettingKey), core: 실데이터 파생 */
  backing: 'kv' | 'core'
  note: string
}

/** v0 KV 저장 키 — llm-model·llm-prompt-* 와 같은 core 설정 KV 문법 */
export const knowledgeSettingKey = (id: KnowledgeSourceId) => `knowledge-${id}`

export const KNOWLEDGE_SOURCES: KnowledgeSourceDef[] = [
  {
    id: 'trend-keywords',
    label: '트렌드 키워드',
    injection: 'user',
    backing: 'kv',
    note: '지금 뜨는 키워드 (줄바꿈 구분) — 원장 trendKeywords로 주입, 검색어 결합에 쓴다. 빠르게 변하므로 가변부.',
  },
  {
    id: 'survey-rules',
    label: '서비스 설문조사 규칙',
    injection: 'system',
    placeholder: '{{RULES}}',
    backing: 'kv',
    note: '설문 통계를 증류한 규칙 문장 — 설문 생성 시스템 프롬프트에 실린다. 느리게 변하므로 캐시 흡수.',
  },
  {
    id: 'consumer-vocab',
    label: '소비자 어휘 사전',
    injection: 'system',
    placeholder: '{{VOCAB}}',
    backing: 'kv',
    note: '트렌드 인터뷰에서 뽑은 소비자 표현 사전 — 사용자가 쓰는 말을 생성물도 그대로 쓴다 (전략 문서 1단계).',
  },
  {
    id: 'selection-criteria',
    label: '선택 기준 브리프',
    injection: 'system',
    placeholder: '{{CRITERIA}}',
    backing: 'kv',
    note: '트렌드 인터뷰 요약 브리프 — 계획 구성(5단계)의 선택 기준 지식.',
  },
  {
    id: 'fewshot',
    label: '모범 예시 (시나리오 피드백)',
    injection: 'system',
    placeholder: '{{FEWSHOT}}',
    backing: 'kv',
    note: '평가 스튜디오 상위 케이스를 예시 쌍으로 내보낸 JSON — 계획 페이지 few-shot.',
  },
  {
    id: 'thread-feedback',
    label: '쓰레드 피드백',
    injection: 'user',
    backing: 'core',
    note: '유일한 실데이터 — deviceId 단위 최근 평가를 한 줄로 압축해 원장 recentFeedback으로. 조회 배관은 BFF(페이즈 3).',
  },
]

export const KNOWLEDGE_BY_ID = new Map(KNOWLEDGE_SOURCES.map((s) => [s.id, s]))

/* ── 운영자가 추가하는 지식 소스 (관리 페이지 파이프라인 탭) ────────────────────
 * 위 카탈로그는 코드가 소유한 붙박이 5종이고, 그 밖의 지식은 운영자가 화면에서 만든다.
 * 목록은 core 설정 KV 한 칸(knowledge-custom)에 JSON 배열로, 값은 붙박이와 같은
 * `knowledge-<id>` 키에 원문으로 저장된다 — 조회·캐시·주입 경로가 붙박이와 한 벌이다.
 * 주입은 언제나 시스템 자리표시자다: 어느 단계에 실릴지는 그 단계 프롬프트에 토큰이
 * 들어 있는지로 정해진다 (원장·검증 게이트 주입은 코드 배선이라 화면에서 만들 수 없다). */

export const CUSTOM_KNOWLEDGE_SETTING_KEY = 'knowledge-custom'

export type CustomKnowledgeSource = {
  /** 설정 키에 쓰는 id — 언제나 `custom-` 접두 (붙박이 id와 섞이지 않는다) */
  id: string
  label: string
  /** 시스템 자리표시자 토큰 — `{{NAME}}` */
  placeholder: string
  /** 치환 시 값 위에 붙는 제목 줄 — 모델에게 이 지식이 무엇인지 알려 준다 */
  heading: string
  note: string
}

/** 코드가 소유한 자리표시자 — 추가 지식이 이 토큰을 뺏을 수 없다 */
export const RESERVED_PLACEHOLDERS = ['{{CATALOG}}', '{{VOCAB}}', '{{RULES}}', '{{CRITERIA}}', '{{FEWSHOT}}']

/** 입력을 `{{NAME}}` 꼴로 정규화 — 규칙에 못 맞추면 null (호출부가 400) */
export function normalizePlaceholderToken(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^\{+/, '')
    .replace(/\}+$/, '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(name)) return null
  return `{{${name}}}`
}

/** 토큰 → 설정 키 id (`{{MY_THING}}` → `custom-my-thing`) */
export const customKnowledgeId = (placeholder: string) =>
  `custom-${placeholder.replace(/[{}]/g, '').toLowerCase().replace(/_/g, '-')}`

/** 추가 지식의 값 저장 키 — 붙박이(knowledgeSettingKey)와 같은 `knowledge-<id>` 문법 */
export const customKnowledgeSettingKey = (id: string) => `knowledge-${id}`

/** 설정 KV 원문 → 추가 지식 목록. 깨진 값은 조용히 버린다 (지식 없이도 파이프라인은 돈다) */
export function parseCustomSources(raw: string | null): CustomKnowledgeSource[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: CustomKnowledgeSource[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const placeholder = typeof r.placeholder === 'string' ? normalizePlaceholderToken(r.placeholder) : null
    if (!placeholder || RESERVED_PLACEHOLDERS.includes(placeholder)) continue
    const id = typeof r.id === 'string' && r.id.startsWith('custom-') ? r.id : customKnowledgeId(placeholder)
    if (out.some((s) => s.id === id || s.placeholder === placeholder)) continue
    out.push({
      id,
      placeholder,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : placeholder,
      heading: typeof r.heading === 'string' && r.heading.trim() ? r.heading.trim() : `${r.label ?? placeholder}:`,
      note: typeof r.note === 'string' ? r.note : '',
    })
  }
  return out
}

export const serializeCustomSources = (list: CustomKnowledgeSource[]) => JSON.stringify(list)

/** KV 게터 주입형 조회 — 구현체(BFF core 클라이언트·테스트 목·추후 DB)가 게터만 제공한다 */
export type KnowledgeGetter = (key: string) => Promise<string | null>

export async function readKnowledge(
  id: KnowledgeSourceId,
  get: KnowledgeGetter,
): Promise<string | null> {
  const def = KNOWLEDGE_BY_ID.get(id)
  if (!def || def.backing !== 'kv') return null
  const raw = await get(knowledgeSettingKey(id))
  return raw?.trim() ? raw : null
}
