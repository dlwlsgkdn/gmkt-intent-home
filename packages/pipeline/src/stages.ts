import type { PromptDefId } from './prompts'
import type { LlmEffort } from './llm-port'

/*
 * 파이프라인 단계 카탈로그 — 전략 문서의 8단계(0~7) 이름·번호를 코드의 1급 시민으로 굳힌다
 * (합의 1: "용어는 이 문서의 여덟 단계 이름으로 부른다"). 그래프(engine)와 파이프라인
 * 스튜디오(#admin)가 이 카탈로그를 읽어 노드를 조립·렌더하므로, 새 단계는 여기 등록이 시작점이다.
 * status='planned'인 단계는 스튜디오에 예정으로 표시되고 그래프에는 아직 없다.
 */

export type PipelineStageId =
  | 'objective' // 0 목적어 입력
  | 'intent' // 1 의도 정규화
  | 'ledger' // 2 제약 원장 조립
  | 'survey' // 3 변동 설문 생성
  | 'candidates' // 4 근거 수집
  | 'plan-skeleton' // 5a 계획 구성 — 뼈대
  | 'plan-products' // 5b 계획 구성 — 상품·콘텐츠 (현재 4단계 웹 검색을 병행 수행)
  | 'verify' // 6 검증 게이트
  | 'record' // 7 쓰레드 기록

export type PipelineStageDef = {
  id: PipelineStageId
  /** 전략 문서 단계 번호 — 5는 병렬 두 노드라 '5a'/'5b'로 표기 */
  no: string
  label: string
  kind: 'llm' | 'deterministic' | 'interrupt-boundary'
  /** LLM 단계의 시스템 프롬프트 카탈로그 id (PROMPT_DEFS) */
  promptId?: PromptDefId
  /** LLM 단계의 기본 생성 강도 */
  effort?: LlmEffort
  status: 'active' | 'planned'
  note: string
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  {
    id: 'objective',
    no: '0',
    label: '목적어 입력',
    kind: 'deterministic',
    status: 'planned',
    note: '한 줄 발화가 유일한 씨앗. 범위 밖·막연한 발화는 LLM 호출 전에 되돌린다 (규칙 기반 가드부터).',
  },
  {
    id: 'intent',
    no: '1',
    label: '의도 정규화',
    kind: 'llm',
    status: 'planned',
    note: '발화 → 7개 의도 템플릿 + 목적·시점·대상. 템플릿 정의는 KV, 경량 모델/low effort 호출.',
  },
  {
    id: 'ledger',
    no: '2',
    label: '제약 원장 조립',
    kind: 'deterministic',
    status: 'active',
    note: '프로필+답변+직전 쓰레드 피드백+트렌드 키워드(KV) → ConstraintLedger. 가변부 주입·6단계 역대조가 같은 값을 보고, plan 스텝 payload에 스냅샷이 남는다.',
  },
  {
    id: 'survey',
    no: '3',
    label: '변동 설문 생성',
    kind: 'llm',
    promptId: 'survey',
    effort: 'low',
    status: 'active',
    note: '설문 페이지 생성 (현행 3~5문항 — 0~3문항+원장 스킵은 페이즈 6). 완료 후 답변 대기 interrupt.',
  },
  {
    id: 'candidates',
    no: '4',
    label: '근거 수집',
    kind: 'deterministic',
    status: 'planned',
    note: '원장 필터로 후보 20~50개 확보. 현재는 5b의 web_search 서버 도구가 병행 수행 — 자체 검색 교체는 페이즈 7.',
  },
  {
    id: 'plan-skeleton',
    no: '5a',
    label: '계획 구성 — 뼈대',
    kind: 'llm',
    promptId: 'plan-skeleton',
    effort: 'medium',
    status: 'active',
    note: '검색 없이 제목·단계 안내·순서 + 상품/콘텐츠 자리. 5b와 병렬, 뼈대 조기 확정 스트리밍.',
  },
  {
    id: 'plan-products',
    no: '5b',
    label: '계획 구성 — 상품·콘텐츠',
    kind: 'llm',
    promptId: 'plan-products',
    effort: 'high',
    status: 'active',
    note: '웹 검색 병행으로 상품 섹션 + 참고 콘텐츠 섹션. 5a의 자리를 채운다.',
  },
  {
    id: 'verify',
    no: '6',
    label: '검증 게이트',
    kind: 'deterministic',
    status: 'active',
    note: '그라운딩(카탈로그 대조·URL/PDP) + 블록리스트 정확 매칭(KV guard-blocklist) + 의학 단정 차단 + 원장 역대조(예산·기피). 드롭 사유는 plan 스텝 payload.dropLog로 기록.',
  },
  {
    id: 'record',
    no: '7',
    label: '쓰레드 기록',
    kind: 'deterministic',
    status: 'active',
    note: '스텝 append(멱등 seq) + llmMeta(promptVersion 각인). 화면에 흘러간 조각과 저장 결과 일치가 불변식.',
  },
]

export const STAGE_BY_ID = new Map(PIPELINE_STAGES.map((s) => [s.id, s]))
