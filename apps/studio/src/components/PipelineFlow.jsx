import React, { useMemo } from 'react'

/*
 * 생성 파이프라인 흐름 다이어그램 (운영 콘솔 "파이프라인" 탭 히어로 — PipelineStudio가 배선).
 * PIPELINE_STAGES 와이어(전략 문서 0~7)를 실제 실행 토폴로지로 **위→아래 세로**로 그린다:
 *   0 ↓ 1 ↓ 2 ↓ 3 ↓ ⏸ 답변 대기 ↓ ( 5a ∥ 4·5b ) ↓ 6 ↓ 7
 * 병렬 블록만 좌우 두 레인으로 갈라지고, 분기·합류 버스는 가로선이다.
 * 노드 클릭 = 단계 레이어 모달(설명·최근 실행·시스템 프롬프트 열람·수정 — PipelineStudio 소유).
 * 플레이그라운드 실행(running) 동안 그 경로의 연결선에 대시가 흐르고 실행 중인 LLM 노드가
 * 맥동한다. 결과가 도착하면 노드에 ✓ 지연·검증 통과/드롭 요약이 남는다. 표현 전용.
 *
 * **지식 유입 표시**(feedByStage — lib/pipelineKnowledge.js가 계산): 지식이 실리는 노드는 왼쪽
 * 가장자리에 유입 점 줄을 달고(지식 카드가 다이어그램 왼쪽에 있으므로 방향이 그대로 읽힌다),
 * 점 하나가 지식 하나다 — 값이 있으면 채워지고 비어 있으면 테두리만. 지식 카드의 행에
 * 손을 얹으면(activeKnowledge) 그 지식이 실리는 노드만 강조되고, 노드에 손을 얹으면
 * (onHoverStage) 반대로 지식 카드의 해당 행이 강조된다.
 */

export const KIND_LABEL = { llm: 'LLM', deterministic: '결정적', 'interrupt-boundary': '대기 지점' }

/** 노드 폭에 맞춘 짧은 표시 라벨 (레이어 모달은 와이어의 전체 라벨) — 지식 행의 단계 칩도 이 라벨을 쓴다 */
export const SHORT_LABEL = {
  objective: '목적어 입력',
  intent: '의도 정규화',
  ledger: '제약 원장',
  survey: '변동 설문',
  candidates: '근거 수집',
  'plan-skeleton': '계획 뼈대',
  'plan-products': '상품·콘텐츠',
  verify: '검증 게이트',
  record: '쓰레드 기록',
}

/** dry-run 종류별 흐름 경로 — links: 대시가 흐르는 연결선(gate=답변 대기 점선), path: 함께 켜지는 통과 노드 */
const RUN_PATHS = {
  survey: { links: ['l01', 'l12', 'l23'], path: ['objective', 'intent', 'ledger'] },
  'plan-skeleton': { links: ['gate', 'lt-in'], path: ['survey', 'ledger'] },
  'plan-products': { links: ['gate', 'lb-in', 'l45'], path: ['survey', 'ledger', 'candidates', 'verify'] },
}

/** LLM 실행 메타 한 줄 (모델 · 지연 · 토큰 · 검색) — 플레이그라운드 결과 머리에도 쓴다 */
export function metaLine(meta) {
  if (!meta) return null
  const parts = []
  if (meta.model) parts.push(meta.model)
  if (meta.latencyMs != null) parts.push(`${(meta.latencyMs / 1000).toFixed(1)}s`)
  if (meta.usage?.inputTokens != null) parts.push(`in ${meta.usage.inputTokens.toLocaleString('ko-KR')}`)
  if (meta.usage?.outputTokens != null) parts.push(`out ${meta.usage.outputTokens.toLocaleString('ko-KR')}`)
  if (meta.usage?.webSearchRequests) parts.push(`검색 ${meta.usage.webSearchRequests}회`)
  return parts.join(' · ')
}

export default function PipelineFlow({
  stages, // AdminPipelineWire.stages — 전략 문서 0~7 카탈로그
  running, // 실행 중 dry-run stageId | null
  flowLive, // 전체 플로우 실행 중 { nodes: [단계 id], links: [연결선 id] } | null — 그래프 실시간 반영
  results, // { [stageId]: { meta?, custom?, pass?, drops?, summary?, prompt? } } — 플레이그라운드 결과 요약
  selectedId,
  onSelect, // 노드 클릭 → 단계 레이어 모달 열기 (PipelineStudio)
  feedByStage, // Map<단계id, 지식id[]> — 이 단계에 실리는 지식 (pipelineKnowledge.knowledgeRouting)
  knowledgeById, // Map<지식id, AdminKnowledgeEntry> — 유입 점의 라벨·값 유무
  activeKnowledge, // 지식 카드에서 손을 얹은 지식 id | null — 소비 노드를 강조
  onHoverStage, // 노드 hover → 지식 카드 역강조 (id | null)
}) {
  const byId = useMemo(() => new Map((stages || []).map((stage) => [stage.id, stage])), [stages])
  const run = running ? RUN_PATHS[running] : null

  /** 노드 왼쪽 유입 점 줄 — 점 하나 = 지식 하나 (채움 = 값 있음) */
  const feed = (id) => {
    const fed = feedByStage?.get(id)
    if (!fed?.length) return null
    const entries = fed.map((kid) => knowledgeById?.get(kid)).filter(Boolean)
    if (!entries.length) return null
    const hit = activeKnowledge ? fed.includes(activeKnowledge) : false
    const title =
      '실리는 지식 — ' + entries.map((e) => `${e.label}${e.value ? '' : ' (비어 있음)'}`).join(', ')
    return (
      <span className={'sb-flow__feed' + (hit ? ' is-on' : '')} title={title}>
        {entries.map((entry) => (
          <i
            key={entry.id}
            className={
              'sb-flow__feed-dot' +
              (entry.value ? '' : ' is-empty') +
              (activeKnowledge === entry.id ? ' is-on' : '')
            }
          />
        ))}
      </span>
    )
  }

  const node = (id) => {
    const stage = byId.get(id)
    if (!stage) return null
    const result = results?.[id]
    const done = Boolean(result)
    const isLive = running === id || Boolean(flowLive?.nodes?.includes(id))
    const onPath = Boolean(run?.path.includes(id))
    const sub = isLive
      ? stage.kind === 'llm'
        ? '생성 중…'
        : '흐르는 중…'
      : onPath && stage.kind !== 'llm'
        ? '흐르는 중…'
        : result?.meta?.latencyMs != null
          ? `✓ ${(result.meta.latencyMs / 1000).toFixed(1)}s`
          : result?.pass != null
            ? `통과 ${result.pass} · 드롭 ${result.drops}`
            : result?.summary
              ? `✓ ${result.summary}`
              : stage.status === 'planned'
                ? '예정 · 5b 병행'
                : stage.kind === 'llm'
                  ? `LLM${stage.effort ? ' · ' + stage.effort : ''}`
                  : KIND_LABEL[stage.kind] || stage.kind
    const cls = ['sb-flow__node']
    if (stage.kind === 'llm') cls.push('sb-flow__node--llm')
    if (stage.status === 'planned') cls.push('sb-flow__node--planned')
    if (isLive) cls.push('is-live')
    else if (onPath && running) cls.push('is-path')
    if (selectedId === id) cls.push('is-on')
    if (activeKnowledge && feedByStage?.get(id)?.includes(activeKnowledge)) cls.push('is-fed')
    return (
      <button
        key={id}
        type="button"
        className={cls.join(' ')}
        title={stage.note}
        aria-haspopup="dialog"
        aria-pressed={selectedId === id}
        onClick={() => onSelect(id)}
        onMouseEnter={() => onHoverStage?.(id)}
        onMouseLeave={() => onHoverStage?.(null)}
        onFocus={() => onHoverStage?.(id)}
        onBlur={() => onHoverStage?.(null)}
      >
        {feed(id)}
        {(stage.promptCustom || result?.custom) && <i className="sb-flow__flag" title="프롬프트 재정의 사용 중" />}
        <span className="sb-flow__no">{stage.no}</span>
        <span className="sb-flow__text">
          <span className="sb-flow__label">{SHORT_LABEL[id] || stage.label}</span>
          <span className={'sb-flow__sub' + (done && !isLive ? ' sb-flow__sub--ok' : '')}>{sub}</span>
        </span>
      </button>
    )
  }

  const link = (id, extra) => (
    <i
      key={id}
      aria-hidden="true"
      className={
        'sb-flow__link' +
        (extra ? ` ${extra}` : '') +
        (run?.links.includes(id) || flowLive?.links?.includes(id) ? ' is-live' : '')
      }
    />
  )

  return (
    <>
      <div className="sb-flow-wrap">
        <div className="sb-flow">
          {node('objective')}
          {link('l01')}
          {node('intent')}
          {link('l12')}
          {node('ledger')}
          {link('l23')}
          {node('survey')}
          <span
            className={
              'sb-flow__gate' +
              (run?.links.includes('gate') || flowLive?.nodes?.includes('gate') || flowLive?.links?.includes('gate')
                ? ' is-live'
                : '')
            }
            title="설문 완료 후 답변을 기다리는 interrupt 지점"
          >
            <span className="sb-flow__gate-label">⏸ 답변 대기</span>
          </span>
          {/* 5 병렬 — 왼쪽: 뼈대(조기 확정 스트리밍), 오른쪽: 근거 수집(예정) + 상품·콘텐츠(웹 검색 병행) */}
          <div className="sb-flow__par">
            <div className="sb-flow__lane">
              {link('lt-in', 'sb-flow__link--stub')}
              {node('plan-skeleton')}
              {link('lt-out', 'sb-flow__link--grow')}
            </div>
            <div className="sb-flow__lane">
              {link('lb-in', 'sb-flow__link--stub')}
              {node('candidates')}
              {link('l45')}
              {node('plan-products')}
              {link('lb-out', 'sb-flow__link--stub')}
            </div>
          </div>
          {link('l56')}
          {node('verify')}
          {link('l67')}
          {node('record')}
        </div>
      </div>
      <div className="sb-flow-legend">
        <span><i className="sb-flow-legend__sw sb-flow-legend__sw--llm" /> LLM 생성</span>
        <span><i className="sb-flow-legend__sw" /> 결정적</span>
        <span><i className="sb-flow-legend__sw sb-flow-legend__sw--planned" /> 예정</span>
        <span><i className="sb-flow-legend__sw sb-flow-legend__sw--live" /> 실행 흐름</span>
        <span><i className="sb-flow-legend__sw sb-flow-legend__sw--feed" /> 지식 유입 (점 = 지식 1개, 빈 점 = 값 없음)</span>
      </div>
      <p className="sb-flow-hint">
        단계를 누르면 설명·실리는 지식·시스템 프롬프트가 레이어로 열려요. 왼쪽 지식 카드의 행에 손을 얹으면 그 지식이 실리는
        단계가, 단계에 손을 얹으면 거기 실리는 지식이 서로 밝아져요. 플레이그라운드 실행도 이 흐름 위에 그대로 비쳐요.
      </p>
    </>
  )
}
