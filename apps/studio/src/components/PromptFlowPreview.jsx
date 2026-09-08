import React, { useEffect, useMemo, useRef, useState } from 'react'
import { renderItem } from '../lib/registry.jsx'
import { livePlanItems, liveSurveyItems } from '../lib/livePage.js'
import { previewAnswers } from '../lib/promptPreview.js'
import { comparePreviewItems } from '../lib/promptFlow.js'

const noop = () => {}
const openUrl = (url) => {
  try { const parsed = new URL(url); if (['https:', 'http:'].includes(parsed.protocol)) window.open(parsed.href, '_blank', 'noopener,noreferrer') } catch { /* No valid link. */ }
}
export default function PromptFlowPreview({ result, answers, onAnswer, intent, busy, status, onPrepare, onRun, ready, hasProposal }) {
  const [stage, setStage] = useState('survey')
  const panes = useRef({})
  const [active, setActive] = useState({ baseline: 0, trial: 0 })
  const summaries = useMemo(() => Object.fromEntries(['baseline', 'trial'].map((side) => [side, { profile: result?.profile || [], questions: (result?.[side]?.survey?.questions || []).map((question) => ({ q: question.question, a: previewAnswers({ questions: [question] }, answers[side])[0]?.choices.join(', ') || '건너뜀' })) }])), [result, answers])
  const itemsBySide = useMemo(() => Object.fromEntries(['baseline', 'trial'].map((side) => {
    const output = result?.[side]
    return [side, stage === 'plan' && output?.plan ? livePlanItems(output.plan, { query: intent }) : output?.survey ? liveSurveyItems(output.survey) : []]
  })), [result, stage, intent])
  const changes = useMemo(() => hasProposal && result ? comparePreviewItems(itemsBySide.baseline, itemsBySide.trial, summaries) : { baseline: {}, trial: {} }, [itemsBySide, hasProposal, result, summaries])
  useEffect(() => { setActive({ baseline: 0, trial: 0 }) }, [changes])
  const followScroll = (side) => {
    const pane = panes.current[side]
    const nodes = [...pane.querySelectorAll('[data-preview-change]')]
    if (!nodes.length) return
    const top = pane.getBoundingClientRect().top
    const next = nodes.reduce((best, node, index) => Math.abs(node.getBoundingClientRect().top - top) < Math.abs(nodes[best].getBoundingClientRect().top - top) ? index : best, 0)
    setActive((previous) => previous[side] === next ? previous : { ...previous, [side]: next })
  }
  const nextChange = (side) => {
    const nodes = [...panes.current[side].querySelectorAll('[data-preview-change]')]
    if (!nodes.length) return
    const index = (active[side] + 1) % nodes.length
    const pane = panes.current[side]
    pane.scrollTo({ top: pane.scrollTop + nodes[index].getBoundingClientRect().top - pane.getBoundingClientRect().top - 8, behavior: 'smooth' })
    setActive((previous) => ({ ...previous, [side]: index }))
  }
  useEffect(() => { setStage(result?.phase === 'plan' ? 'plan' : 'survey') }, [result?.phase])
  return <>{['baseline', 'trial'].map((side) => {
    const before = side === 'baseline'
    const output = result?.[side]
    const survey = output?.survey
    const paneAnswers = answers[side]
    const profile = { name: '시험 고객', items: result?.profile || [] }
    const items = itemsBySide[side].map((item) => item.type === 'surveyQuestion' ? { ...item, props: { ...item.props, locked: busy } } : item)
    const changeCount = Object.keys(changes[side]).length
    const player = {
      query: intent, setQuery: noop, submitQuery: noop, answers: paneAnswers,
      setAnswer: (id, value) => { if (!busy) onAnswer(side, id, value) },
      cart: [], addToCart: noop, complete: noop, showKeyword: noop,
      openExternal: (_label, url) => openUrl(url), openProduct: ({ url }) => openUrl(url),
      excludedProfile: [], toggleProfileItem: noop,
      summary: summaries[side],
    }
    return <aside key={side} className={`sb-scenario-preview sb-scenario-preview--${before ? 'before' : 'after'}`} aria-label={before ? '변경 전 고객 화면' : '변경 후 고객 화면'}>
      <div className="sb-scenario-preview__head"><div><span>{before ? '변경 전' : hasProposal ? '변경 후' : '시험용'}</span><h2>{before ? '지금은 이렇게 나와요' : hasProposal ? '이렇게 바뀌어요' : '직접 눌러보세요'}</h2></div><b className={before ? 'is-before' : ''}>{before ? '현재' : '미리보기'}</b></div>
      <p className="sb-scenario-preview__note">{before ? '원래 질문에 답해보세요. 같은 질문의 답은 옆에도 채워져요.' : '달라진 질문에도 답해보세요. 마지막 추천까지 비교할 수 있어요.'}</p>
      <nav className="sb-scenario-preview__steps" aria-label={`${before ? '변경 전' : '변경 후'} 화면 단계`}>
        {[['survey', '설문'], ['plan', '추천']].map(([value, label]) => <button type="button" key={value} className={stage === value ? 'is-on' : ''} aria-current={stage === value ? 'step' : undefined} disabled={busy || !survey || (value === 'plan' && !output?.plan)} onClick={() => setStage(value)}>{label}</button>)}
      </nav>
      {result && hasProposal && <div className="sb-flow-diff-nav"><span>{changeCount ? '달라진 곳 ' + Math.min(active[side] + 1, changeCount) + ' / ' + changeCount : '이 화면은 같아요'}</span>{changeCount > 0 && <button type="button" className="sb-btn sb-btn--ghost sb-btn--tiny" onClick={() => nextChange(side)}>다음 변경 ↓</button>}<small>두 결과가 다른 곳을 표시해요. 오류 표시가 아니에요.</small></div>}
      <div className="sb-scenario-preview__viewport" ref={(node) => { panes.current[side] = node }} onScroll={() => followScroll(side)}><div className="sb-phone sb-phone--player sb-scenario-preview__phone">
        {!survey ? <div className="sb-scenario-preview__mirror-empty"><i aria-hidden="true">◐</i><p>바꾸고 싶은 점을 적고<br />고객 화면을 열어보세요.</p><button type="button" className="sb-btn sb-btn--ai" disabled={busy || !intent.trim()} onClick={onPrepare}>⇄ 고객 화면 열기</button></div> : <div className="sb-player__stack">{items.filter((item) => !item.parentId && item.type !== 'screenHeader').map((item) => <div key={item.id} className={"sb-player__item" + (changes[side][item.id] ? " sb-flow-diff" : "")} data-preview-change={changes[side][item.id] ? item.id : undefined}>{changes[side][item.id] && <div className="sb-flow-diff__badge"><span aria-hidden="true">↳ </span>{changes[side][item.id].label}</div>}{item.type === 'surveyPhoto' ? <p className="sb-admin__muted">사진 질문은 이번 시험에서 건너뛸게요.</p> : renderItem(item, { mode: 'player', player, profile, allItems: items, previewChanges: changes[side] })}</div>)}</div>}
      </div></div>
      <div className="sb-scenario-preview__foot">
        {busy && <p role="status">{status || '화면을 만들고 있어요…'}</p>}
        {survey && stage === 'survey' && <button type="button" className="sb-btn sb-btn--ai" disabled={busy || !ready} onClick={onRun}>⇄ 마지막 추천까지 비교하기</button>}
        <small>시험 화면이에요. 적용 버튼을 누르기 전까지 실제 설정은 바뀌지 않아요.</small>
      </div>
    </aside>
  })}</>
}
