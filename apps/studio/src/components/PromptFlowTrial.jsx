import React, { useEffect, useRef, useState } from 'react'
import { applyPromptFlow, assistPromptFlow, decideAdminPromptTrial, dryRunStage, fetchAdminPrompts, saveAdminPromptTrial } from '../lib/adminApi.js'
import { FLOW_PARTS, flowLabel, flowSnapshot, flowText, matchingAnswers, surveyReady } from '../lib/promptFlow.js'
import { previewAnswers, previewPlan } from '../lib/promptPreview.js'
import PromptFlowPreview from './PromptFlowPreview.jsx'
import PromptFlowReview from './PromptFlowReview.jsx'
import { TrialOutput } from './AdminPromptTrialOutput.jsx'

const EXAMPLES = [
  ['실전 팁으로', '교과서적인 조언 말고, 바로 따라 할 수 있는 실전 팁을 알려줘. 막히는 상황을 먼저 파악하고, 하는 방법과 실패했을 때 고치는 요령까지 설명해줘. 상품도 그 방법에 필요한 것으로 연결해줘.'],
  ['쉽게 설명하기', '처음 해보는 사람도 이해하게 어려운 말은 풀어서 설명하고, 무엇부터 하면 되는지 알려줘. 질문과 선택지도 쉽게 써줘.'],
  ['꼭 필요한 것만', '이미 가진 제품으로 할 수 있는 방법부터 알려줘. 필요한 것만 물어보고, 꼭 사야 하는 상품과 없어도 되는 상품을 구분해줘.'],
]
export default function PromptFlowTrial({ wire, seed, onApplied, api }) {
  const [instruction, setInstruction] = useState('')
  const [refining, setRefining] = useState(false)
  const [refinement, setRefinement] = useState('')
  const refinementField = useRef(null)
  const [focus, setFocus] = useState([])
  const [proposal, setProposal] = useState(null)
  const [intent, setIntent] = useState('여름에 무너지지 않는 쿠션 찾아줘')
  const [result, setResult] = useState(null)
  const [answers, setAnswers] = useState({ baseline: {}, trial: {} })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(false)
  const [score, setScore] = useState(null)
  const [comment, setComment] = useState('')
  const [savedThread, setSavedThread] = useState(null)
  const clearEvaluation = () => { setScore(null); setComment(''); setSavedThread(null); setApplied(false) }
  const clearTrial = () => { setResult(null); setAnswers({ baseline: {}, trial: {} }); clearEvaluation(); setError(null) }
  useEffect(() => {
    if (!seed?.text || !wire) return
    const prompts = flowSnapshot(wire)
    const original = prompts.find((prompt) => prompt.id === seed.promptId)
    if (!original) return
    setInstruction(seed.summary || '직접 고친 내용을 전체 흐름에서 확인해줘')
    setFocus([seed.promptId])
    setProposal({ prompts, changes: [{ id: seed.promptId, baseText: original.text, proposedText: seed.text, reason: seed.summary || '직접 고친 내용이에요.' }], summary: seed.summary || '직접 고친 지시서를 시험해요.', warnings: [] })
    clearTrial()
  }, [seed])
  const changeRequest = (text) => { setRefining(false); setRefinement(''); setInstruction(text); setProposal(null); clearTrial() }
  const toggleFocus = (id) => {
    setRefining(false); setRefinement('')
    setFocus((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id])
    setProposal(null); clearTrial()
  }
  const changeIntent = (text) => { setIntent(text); clearTrial() }
  const makeProposal = async () => {
    if (busy || instruction.trim().length < 2) return
    setBusy(true); clearTrial(); setProposal(null)
    setStatus('요청을 읽고, 함께 바꿔야 할 부분을 찾고 있어요…')
    try {
      const prompts = flowSnapshot(await fetchAdminPrompts())
      const next = await assistPromptFlow({ instruction: instruction.trim(), focus, prompts })
      setProposal({ ...next, prompts, refinements: [] }); setRefining(false); setRefinement('')
    } catch (e) { setError(e.message || '수정안을 만들지 못했어요. 다시 시도해 주세요.') }
    finally { setBusy(false); setStatus('') }
  }
  useEffect(() => {
    if (refining) { refinementField.current?.focus(); refinementField.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
  }, [refining])
  const refineProposal = async () => {
    if (busy || !proposal || refinement.trim().length < 2 || (proposal.refinements?.length || 0) >= 10) return
    setBusy(true); setError(null); setStatus('방금 만든 내용에 추가 요청을 반영하고 있어요…')
    try {
      const refinements = [...(proposal.refinements || []), refinement.trim()]
      const next = await assistPromptFlow({ instruction: instruction.trim(), focus, prompts: proposal.prompts, previousChanges: proposal.changes, refinements })
      setProposal({ ...next, prompts: proposal.prompts, refinements })
      clearTrial(); setRefining(false); setRefinement('')
    } catch (e) { setError(e.message || '다시 고치지 못했어요. 이전 수정안과 추가 요청은 그대로 두었어요.') }
    finally { setBusy(false); setStatus('') }
  }
  const prepare = async () => {
    if (busy || !intent.trim()) return
    setBusy(true); clearTrial(); setStatus('변경 전과 후의 설문을 준비하고 있어요…')
    try {
      const profile = (api.profile?.items || []).filter((item) => item.label?.trim()).map((item) => ({ label: item.label, value: String(item.value || '') }))
      const snapshot = proposal || { prompts: flowSnapshot(await fetchAdminPrompts()), changes: [] }
      const input = { stageId: 'survey', intent: intent.trim(), profile }
      const baseline = await dryRunStage({ ...input, promptOverride: flowText(snapshot, 'survey', 'baseline') })
      const trial = snapshot.changes.some((change) => change.id === 'survey')
        ? await dryRunStage({ ...input, promptOverride: flowText(snapshot, 'survey', 'trial') }) : baseline
      setResult({ baseline, trial, profile, intent: input.intent, snapshot, phase: 'survey' })
    } catch (e) { setError(e.message || '설문을 불러오지 못했어요. 다시 눌러주세요.') }
    finally { setBusy(false); setStatus('') }
  }
  const changeAnswer = (side, id, value) => {
    if (busy) return
    const other = side === 'trial' ? 'baseline' : 'trial'
    setAnswers((previous) => ({ ...previous, [side]: { ...previous[side], [id]: value }, [other]: { ...previous[other], ...matchingAnswers(result[side].survey, result[other].survey, { [id]: value }) } }))
    setResult((previous) => previous ? { ...previous, phase: 'survey', baseline: { ...previous.baseline, plan: null }, trial: { ...previous.trial, plan: null } } : previous)
    clearEvaluation()
  }
  const ready = result && ['baseline', 'trial'].every((side) => surveyReady(result[side].survey, answers[side]))
  const runPlans = async () => {
    if (busy || !result || !ready) return
    setBusy(true); setError(null); clearEvaluation()
    setStatus('각 설문의 답변으로 계획과 상품을 끝까지 비교하고 있어요…')
    try {
      const planFor = async (side) => {
        const body = { intent: result.intent, profile: result.profile, survey: result[side].survey, answers: previewAnswers(result[side].survey, answers[side]) }
        const outputs = await Promise.allSettled(['plan-skeleton', 'plan-products'].map((stageId) => dryRunStage({ ...body, stageId, promptOverride: flowText(result.snapshot, stageId, side) })))
        const failure = outputs.find((output) => output.status === 'rejected')
        if (failure) throw failure.reason
        const [skeleton, products] = outputs.map((output) => output.value)
        return { ...result[side], skeleton: skeleton.skeleton, sections: products.sections, plan: previewPlan(skeleton, products), answers: body.answers }
      }
      const outputs = await Promise.allSettled(['baseline', 'trial'].map(planFor))
      const failure = outputs.find((output) => output.status === 'rejected')
      if (failure) throw failure.reason
      const [baseline, trial] = outputs.map((output) => output.value)
      setResult({ ...result, baseline, trial, phase: 'plan' })
    } catch (e) { setError(e.message || '추천을 만들지 못했어요. 답변은 그대로 두었으니 다시 눌러주세요.') }
    finally { setBusy(false); setStatus('') }
  }
  const canApply = !refining && proposal?.changes.length > 0 && result?.phase === 'plan' && result.snapshot === proposal
  const apply = async () => {
    if (busy || !canApply || applied) return
    setBusy(true); setError(null); setStatus('확인한 수정안을 적용하고 있어요…')
    try {
      let next
      if (savedThread) {
        setSavedThread(await decideAdminPromptTrial(savedThread.id, 'applied'))
        next = await fetchAdminPrompts()
      } else next = await applyPromptFlow({ changes: proposal.changes, prompts: proposal.prompts, summary: proposal.summary })
      onApplied(next); setApplied(true)
      api.showToast('함께 시험한 수정안을 적용했어요. 새로 만드는 결과부터 반영돼요.')
    } catch (e) { setError(e.message || '적용하지 못했어요. 다시 시도해 주세요.') }
    finally { setBusy(false); setStatus('') }
  }
  const save = async () => {
    if (!canApply || score == null || busy || savedThread || applied) return
    setBusy(true); setError(null)
    try {
      const first = proposal.changes[0]
      setSavedThread(await saveAdminPromptTrial({
        promptId: first.id, promptLabel: '전체 흐름', instruction: instruction.trim(),
        summary: proposal.summary, warnings: proposal.warnings, baseText: first.baseText, proposedText: first.proposedText,
        changes: proposal.changes, prompts: proposal.prompts, focus, review: proposal.review, refinements: proposal.refinements,
        intent: result.intent, baseline: result.baseline, trial: result.trial,
        evaluation: { score, comment: comment.trim() },
      }))
      api.showToast('평가와 수정안을 저장했어요. 나중에 이어서 결정할 수 있어요.')
    } catch (e) { setError(e.message || '저장하지 못했어요.') }
    finally { setBusy(false) }
  }
  if (!wire) return <div className="sb-admin-card">지시서를 불러오고 있어요…</div>
  return <div className="sb-prompt-workbench sb-prompt-flow">
    <div className="sb-prompt-trial">
      <section className="sb-prompt-trial__intro">
        <span>마음껏 시험해 보세요</span>
        <div><h2>바꾸고 싶은 점만 말해주세요</h2><p>어디를 고칠지 몰라도 괜찮아요. AI가 설문부터 추천까지 함께 살펴볼게요.</p></div>
        <p>원하는 점 말하기 → 옆 화면에서 확인하기 → 마음에 들면 적용하기</p>
      </section>
      <section className="sb-admin-card sb-prompt-trial__step sb-prompt-flow__request">
        <header><div><h2><label htmlFor="prompt-flow-request">어떻게 바뀌면 좋겠어요?</label></h2><p>친구에게 부탁하듯 편하게 적어주세요. 여러 가지를 한 번에 말해도 돼요.</p></div></header>
        <textarea id="prompt-flow-request" value={instruction} rows={5} maxLength={2000} disabled={busy} onChange={(event) => changeRequest(event.target.value)} placeholder="예: 뻔한 조언 말고 진짜 써먹을 팁을 알려줘. 어떻게 하는지 쉽게 설명하고, 필요한 상품도 같이 골라줘." />
        <div className="sb-prompt-flow__examples"><span>막막하면 예시를 눌러보세요</span>{EXAMPLES.map(([label, text]) => <button type="button" className="sb-btn sb-btn--ghost sb-btn--small" key={label} disabled={busy} onClick={() => changeRequest(text)}>{label}</button>)}</div>
        <fieldset className="sb-prompt-flow__focus" disabled={busy}>
          <legend>특히 이 부분을 바꾸고 싶어요 <span>선택사항</span></legend>
          <p id="prompt-flow-focus-help">안 골라도 괜찮아요. 여러 개 골라도 돼요.</p>
          <div className="sb-prompt-trial__choices" aria-describedby="prompt-flow-focus-help">{FLOW_PARTS.map((part) => <button type="button" key={part.id} aria-pressed={focus.includes(part.id)} className={focus.includes(part.id) ? 'is-on' : ''} onClick={() => toggleFocus(part.id)}><b>{focus.includes(part.id) ? '✓ ' : ''}{part.label}</b><small>{part.note}</small></button>)}</div>
          <small>{focus.length ? '고른 부분을 더 신경 쓰고, 연결된 부분도 함께 살펴볼게요.' : '지금은 전체 흐름을 보고 필요한 부분을 찾아요.'}</small>
        </fieldset>
        <button type="button" className="sb-btn sb-btn--ai" disabled={busy || instruction.trim().length < 2} onClick={makeProposal}>⇄ 요청으로 수정안 프롬프트 만들기</button>
        <small>여기서는 시험안만 만들어요. 직접 적용하기 전에는 고객 화면이 바뀌지 않아요.</small>
      </section>
      {proposal && <section className="sb-admin-card sb-prompt-trial__step sb-prompt-flow__proposal">
        <header><div><h2>이렇게 바꿔볼게요</h2><p>{proposal.summary}</p></div></header>
        {proposal.changes.map((change) => <div className="sb-prompt-flow__change" key={change.id}><b>{flowLabel(change.id)}</b><p>{change.reason}</p></div>)}
        <PromptFlowReview review={proposal.review} warnings={proposal.warnings} />
        {proposal.changes.length > 0 && <details><summary>자세한 지시서 펼쳐보기 · 궁금할 때만 보세요</summary>{proposal.changes.map((change) => <div key={change.id}><b>{flowLabel(change.id)}</b><pre>{change.proposedText}</pre></div>)}</details>}
        {!applied && <div className="sb-flow-refine">
          {!refining ? <button type="button" className="sb-btn sb-btn--ghost" disabled={busy} onClick={() => setRefining(true)}>마음에 안 들어요, 다시 수정할래요</button> : <>
            <label htmlFor="prompt-flow-refinement">어떤 점을 더 바꾸고 싶어요?</label>
            <p>방금 만든 내용에서 이어서 고칠게요. 마음에 드는 점과 바꾸고 싶은 점을 함께 말해줘도 좋아요.</p>
            <textarea ref={refinementField} id="prompt-flow-refinement" rows={3} value={refinement} maxLength={2000} disabled={busy} onChange={(event) => setRefinement(event.target.value)} placeholder="예: 순서는 좋아요. 설명은 더 짧게 하고, 실패했을 때 고치는 방법을 넣어줘요." />
            {(proposal.refinements?.length || 0) >= 10 ? <p>열 번 함께 고쳤어요. 더 바꾸려면 위쪽에 원하는 내용을 정리해 새 요청으로 시작해 주세요.</p> : null}
            <div><button type="button" className="sb-btn sb-btn--ghost" disabled={busy} onClick={() => setRefining(false)}>지금 수정안 유지하기</button><button type="button" className="sb-btn sb-btn--ai" disabled={busy || refinement.trim().length < 2 || (proposal.refinements?.length || 0) >= 10} onClick={refineProposal}>⇄ 추가 요청으로 프롬프트 다시 고치기</button></div>
            <small>다시 고친 뒤에는 화면도 새로 확인해 주세요. 확인 전에는 적용하지 않아요.</small>
          </>}
        </div>}
      </section>}
      <section className="sb-admin-card sb-prompt-trial__step">
        <header><div><h2>옆 화면에서 직접 확인해 보세요</h2><p>고객이 할 법한 말을 적고, 설문에 답하면 마지막 추천까지 볼 수 있어요.</p></div></header>
        <label>고객이 입력할 말<input value={intent} disabled={busy} maxLength={500} onChange={(event) => changeIntent(event.target.value)} placeholder="예: 소개팅 메이크업 도와줘" /></label>
        <button type="button" className="sb-btn sb-btn--ai" disabled={busy || !intent.trim()} onClick={prepare}>⇄ {result ? '설문부터 다시 확인하기' : '고객 화면 열어보기'}</button>
        {result && <><p>같은 질문은 한쪽에서 답하면 함께 채워져요. 달라진 질문은 각 화면에서 골라주세요.</p><button type="button" className="sb-btn sb-btn--ai" disabled={busy || !ready} onClick={runPlans}>⇄ 이 답변으로 마지막 추천까지 비교하기</button>{!ready && <small>양쪽 화면의 질문에 답하면 추천을 볼 수 있어요. 사진은 건너뛰어도 돼요.</small>}</>}
        <small>같은 고객 문장과 프로필로 비교해요. AI 답변은 실행할 때마다 조금 달라질 수 있어요.</small>
      </section>
      {status && <p role="status" className="sb-prompt-flow__status">{status}</p>}
      {error && <p role="alert" className="sb-admin-gate__error">{error}</p>}
      {result && <details className="sb-admin-card sb-prompt-flow__details"><summary>변경 전과 후의 내용 자세히 비교하기</summary>
        {FLOW_PARTS.filter((part) => part.id === 'survey' || result.phase === 'plan').map((part) => <section key={part.id}><h3>{part.label}</h3><div className="sb-prompt-trial__compare">{['baseline', 'trial'].map((side) => <section key={side}><header>{side === 'baseline' ? '변경 전' : '변경 후'}</header><TrialOutput selectedId={part.id} output={result[side]} compareOutput={result[side === 'baseline' ? 'trial' : 'baseline']} diffSide={side === 'baseline' ? 'before' : 'after'} /></section>)}</div></section>)}
      </details>}
      {canApply && <section className="sb-admin-card sb-prompt-trial__step">
        <header><div><h2>{applied ? '적용했어요!' : '원하던 모습에 가까워졌나요?'}</h2><p>{applied ? '새로 만드는 결과부터 이 수정안을 사용해요.' : '마음에 들면 함께 바꾼 내용을 한 번에 적용하세요.'}</p></div></header>
        {!applied && <><button type="button" className="sb-btn sb-btn--primary" disabled={busy} onClick={apply}>마음에 들어요, 이대로 적용하기</button><button type="button" className="sb-btn sb-btn--ghost" disabled={busy} onClick={() => setRefining(true)}>마음에 안 들어요, 다시 수정할래요</button></>}
        {!applied && <details><summary>평가를 남기고 나중에 결정할래요</summary><div className="sb-prompt-trial__stars" role="group" aria-label="수정안 점수">{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} className={score >= value ? 'is-on' : ''} aria-pressed={score === value} aria-label={`${value}점`} disabled={busy || Boolean(savedThread)} onClick={() => setScore(value)}>★</button>)}</div><textarea aria-label="수정안 평가 메모" value={comment} maxLength={2000} disabled={busy || Boolean(savedThread)} onChange={(event) => setComment(event.target.value)} placeholder="어떤 점이 좋았나요? 더 바꾸고 싶은 점도 적어주세요." />{savedThread ? <button type="button" className="sb-btn sb-btn--ghost" onClick={() => api.openAdminThread(savedThread.id)}>저장한 시험 열기</button> : <button type="button" className="sb-btn sb-btn--ghost" disabled={score == null || busy} onClick={save}>평가와 시험 저장하기</button>}</details>}
      </section>}
    </div>
    <PromptFlowPreview result={result} answers={answers} onAnswer={changeAnswer} intent={intent} busy={busy} status={status} onPrepare={prepare} onRun={runPlans} ready={ready} hasProposal={Boolean(proposal?.changes.length)} />
  </div>
}
