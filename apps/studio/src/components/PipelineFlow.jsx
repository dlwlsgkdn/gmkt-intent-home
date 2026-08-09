import React, { useMemo } from 'react'

/*
 * 생성 파이프라인 흐름 다이어그램 (운영 콘솔 "파이프라인" 탭 히어로 — PipelineStudio가 배선).
 * PIPELINE_STAGES 와이어(전략 문서 0~7)를 실제 실행 토폴로지로 그린다:
 *   0 → 1 → 2 → 3 → ⏸ 답변 대기 → ( 5a ∥ 4·5b ) → 6 → 7
 * 노드 클릭 = 아래 상세 스트립(설명·effort·프롬프트 열람 진입), 플레이그라운드 실행(running)
 * 동안 그 경로의 연결선에 대시가 흐르고 실행 중인 LLM 노드가 맥동한다. 결과가 도착하면
 * 노드에 ✓ 지연·검증 통과/드롭 요약이 남는다. 표현 전용 — 상태는 전부 PipelineStudio 소유.
 */

const KIND_LABEL = { llm: 'LLM', deterministic: '결정적', 'interrupt-boundary': '대기 지점' }

/** 노드 폭에 맞춘 짧은 표시 라벨 (상세 스트립은 와이어의 전체 라벨) */
const SHORT_LABEL = {
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
  results, // { [stageId]: { meta?, custom?, pass?, drops? } } — 플레이그라운드 결과 요약
  selectedId,
  onSelect,
  promptEntryOf, // promptId → AdminPromptEntry (프롬프트 열람 진입)
  onOpenPrompt,
}) {
  const byId = useMemo(() => new Map((stages || []).map((stage) => [stage.id, stage])), [stages])
  const run = running ? RUN_PATHS[running] : null

  const node = (id) => {
    const stage = byId.get(id)
    if (!stage) return null
    const result = results?.[id]
    const done = Boolean(result)
    const isLive = running === id
    const onPath = Boolean(run?.path.includes(id))
    const sub = isLive
      ? '생성 중…'
      : onPath && stage.kind !== 'llm'
        ? '흐르는 중…'
        : result?.meta?.latencyMs != null
          ? `✓ ${(result.meta.latencyMs / 1000).toFixed(1)}s`
          : result?.pass != null
            ? `통과 ${result.pass} · 드롭 ${result.drops}`
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
    return (
      <button
        key={id}
        type="button"
        className={cls.join(' ')}
        title={stage.note}
        aria-pressed={selectedId === id}
        onClick={() => onSelect(selectedId === id ? null : id)}
      >
        {(stage.promptCustom || result?.custom) && <i className="sb-flow__flag" title="프롬프트 재정의 사용 중" />}
        <span className="sb-flow__no">{stage.no}</span>
        <span className="sb-flow__label">{SHORT_LABEL[id] || stage.label}</span>
        <span className={'sb-flow__sub' + (done && !isLive ? ' sb-flow__sub--ok' : '')}>{sub}</span>
      </button>
    )
  }

  const link = (id, extra) => (
    <i
      key={id}
      aria-hidden="true"
      className={'sb-flow__link' + (extra ? ` ${extra}` : '') + (run?.links.includes(id) ? ' is-live' : '')}
    />
  )

  const selected = selectedId ? byId.get(selectedId) : null
  const selectedResult = selected ? results?.[selected.id] : null
  const selectedPrompt = selected?.promptId ? promptEntryOf?.(selected.promptId) : null

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
            className={'sb-flow__gate' + (run?.links.includes('gate') ? ' is-live' : '')}
            title="설문 완료 후 답변을 기다리는 interrupt 지점"
          >
            <span className="sb-flow__gate-label">⏸ 답변 대기</span>
          </span>
          {/* 5 병렬 — 위: 뼈대(조기 확정 스트리밍), 아래: 근거 수집(예정) + 상품·콘텐츠(웹 검색 병행) */}
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
      </div>
      {selected ? (
        <div className="sb-flow-detail">
          <div className="sb-flow-detail__head">
            <span className="sb-pipe-stage__no">{selected.no}</span>
            <b>{selected.label}</b>
            <span className="sb-admin-prompt-chip">{KIND_LABEL[selected.kind] || selected.kind}</span>
            {selected.effort && <span className="sb-admin-prompt-chip">effort {selected.effort}</span>}
            {selected.status === 'planned' && <span className="sb-admin-prompt-chip">예정</span>}
            {(selected.promptCustom || selectedResult?.custom) && (
              <span className="sb-admin-prompt-chip sb-admin-prompt-chip--custom">프롬프트 재정의</span>
            )}
            {selectedPrompt && (
              <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => onOpenPrompt(selectedPrompt)}>
                프롬프트 열람·수정
              </button>
            )}
          </div>
          <p className="sb-pipe-stage__note">{selected.note}</p>
          {selectedResult?.meta && <p className="sb-admin__muted">최근 실행: {metaLine(selectedResult.meta)}</p>}
          {selectedResult?.pass != null && (
            <p className="sb-admin__muted">최근 게이트: 섹션 {selectedResult.pass}개 통과 · {selectedResult.drops}건 드롭</p>
          )}
        </div>
      ) : (
        <p className="sb-flow-hint">단계를 누르면 설명과 프롬프트가 열려요. 플레이그라운드 실행이 이 흐름 위에서 그대로 보여요.</p>
      )}
    </>
  )
}
