import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  assistAdminPrompt,
  decideAdminPromptTrial,
  dryRunStage,
  fetchAdminPrompts,
  putAdminPrompt,
  saveAdminPromptTrial,
} from '../lib/adminApi.js'

const TESTABLE_PROMPTS = [
  { id: 'survey', label: '설문 질문', note: '질문 수·선택지·말투를 시험해요.' },
  { id: 'plan-skeleton', label: '계획 구성', note: '제목·요약·단계 순서를 시험해요.' },
  { id: 'plan-products', label: '상품 추천', note: '상품·콘텐츠 구성과 추천 이유를 시험해요.' },
]

const SECTION_LABEL = {
  guide: '단계 안내',
  look: '연출 제안',
  steps: '체크리스트',
  products: '상품 추천',
  contents: '참고 콘텐츠',
}

const sampleIntent = '여름에 무너지지 않는 쿠션 찾아줘'

const autoAnswers = (survey) =>
  (survey?.questions || [])
    .map((question) => ({ questionId: question.id, choices: question.options?.slice(0, 1) || [] }))
    .filter((answer) => answer.choices.length > 0)

const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

const comparableQuestion = (question) => question ? {
  question: question.question || '',
  options: question.options || [],
} : null

const comparableSection = (section) => section ? {
  kind: section.kind || '',
  title: section.title || '',
  body: section.body || section.desc || section.reason || '',
  points: section.points || section.steps || [],
  products: [...(section.webProducts || []), ...(section.products || [])].map((product) => ({
    id: product.id || '',
    brand: product.brand || '',
    name: product.name || '',
    price: product.price ?? null,
  })),
  items: (section.items || []).map((item) => ({ title: item.title || '', source: item.source || '', url: item.url || '' })),
  productIds: section.productIds || [],
} : null

const planSections = (selectedId, output) =>
  selectedId === 'plan-skeleton' ? output?.skeleton?.sections || [] : output?.sections || []

function changedBlockCount(selectedId, baseline, trial) {
  if (selectedId === 'survey') {
    const before = baseline?.survey
    const after = trial?.survey
    const questionCount = Math.max(before?.questions?.length || 0, after?.questions?.length || 0)
    let count = sameValue(before?.intro || '', after?.intro || '') ? 0 : 1
    for (let index = 0; index < questionCount; index += 1) {
      if (!sameValue(comparableQuestion(before?.questions?.[index]), comparableQuestion(after?.questions?.[index]))) count += 1
    }
    return count
  }
  const beforeSections = planSections(selectedId, baseline)
  const afterSections = planSections(selectedId, trial)
  let count = 0
  if (selectedId === 'plan-skeleton' && !sameValue(
    { headline: baseline?.skeleton?.headline || '', summary: baseline?.skeleton?.summary || '' },
    { headline: trial?.skeleton?.headline || '', summary: trial?.skeleton?.summary || '' },
  )) count += 1
  const sectionCount = Math.max(beforeSections.length, afterSections.length)
  for (let index = 0; index < sectionCount; index += 1) {
    if (!sameValue(comparableSection(beforeSections[index]), comparableSection(afterSections[index]))) count += 1
  }
  return count
}

const unique = (items) => [...new Set(items.filter(Boolean))]

const productNames = (output) => unique(
  planSections('plan-products', output)
    .filter((section) => section.kind === 'products')
    .flatMap((section) => [...(section.webProducts || []), ...(section.products || [])])
    .map((product) => product.name || product.id),
)

const contentNames = (output) => unique(
  planSections('plan-products', output)
    .filter((section) => section.kind === 'contents')
    .flatMap((section) => section.items || [])
    .map((item) => item.title),
)

const shortList = (items) => {
  const shown = items.slice(0, 2).join(', ')
  return items.length > 2 ? `${shown} 외 ${items.length - 2}개` : shown
}

function DiffOverview({ selectedId, baseline, trial, diffCount, proposal, instruction }) {
  let metrics = []
  let changes = []
  const command = instruction?.trim() || '입력한 수정 요청이 없습니다.'
  const benefit = proposal?.summary
    ? `${proposal.summary} 결과가 요청한 기준에 더 가까워질 수 있어요.`
    : '요청한 기준에 더 가까운 결과가 나올 수 있어요.'
  const checks = [...(proposal?.warnings || [])]

  if (selectedId === 'survey') {
    const beforeCount = baseline?.survey?.questions?.length || 0
    const afterCount = trial?.survey?.questions?.length || 0
    metrics = [{ label: '설문 질문', before: beforeCount, after: afterCount, unit: '개' }]
    changes = [diffCount ? `질문과 선택지 ${diffCount}곳이 달라졌어요.` : '질문과 선택지가 똑같아요.']
  } else if (selectedId === 'plan-skeleton') {
    const beforeCount = planSections(selectedId, baseline).length
    const afterCount = planSections(selectedId, trial).length
    metrics = [{ label: '계획 구성', before: beforeCount, after: afterCount, unit: '단계' }]
    changes = [diffCount ? `제목·요약·단계 ${diffCount}곳이 달라졌어요.` : '계획 구성이 똑같아요.']
  } else {
    const beforeProducts = productNames(baseline)
    const afterProducts = productNames(trial)
    const beforeContents = contentNames(baseline)
    const afterContents = contentNames(trial)
    const addedProducts = afterProducts.filter((name) => !beforeProducts.includes(name))
    const removedProducts = beforeProducts.filter((name) => !afterProducts.includes(name))
    const addedContents = afterContents.filter((name) => !beforeContents.includes(name))
    const removedContents = beforeContents.filter((name) => !afterContents.includes(name))
    metrics = [
      { label: '추천 상품', before: beforeProducts.length, after: afterProducts.length, unit: '개' },
      { label: '참고 콘텐츠', before: beforeContents.length, after: afterContents.length, unit: '개' },
    ]
    if (addedProducts.length) changes.push(`새로 추천: ${shortList(addedProducts)}`)
    if (removedProducts.length) changes.push(`빠진 추천: ${shortList(removedProducts)}`)
    if (addedContents.length) changes.push(`새 콘텐츠: ${shortList(addedContents)}`)
    if (removedContents.length) changes.push(`빠진 콘텐츠: ${shortList(removedContents)}`)
    if (!changes.length) changes.push(diffCount ? '상품 이름은 같고 추천 이유나 설명이 달라졌어요.' : '상품과 콘텐츠가 똑같아요.')

    if (afterContents.length === 0) {
      const contentDrops = (trial?.dropLog || []).filter((drop) => String(drop.message || '').includes('콘텐츠'))
      checks.unshift(contentDrops.length
        ? `참고 콘텐츠 후보 ${contentDrops.length}개가 링크·안전 검사를 통과하지 못해 빠졌어요.`
        : '확인 가능한 게시글·영상을 찾지 못해 참고 콘텐츠가 만들어지지 않았어요. 현재 콘텐츠는 선택 항목(0~1개)이에요.')
    }
  }

  checks.push('AI 결과는 실행할 때마다 조금 달라요. 한 번 더 시험해 같은 방향으로 바뀌는지 확인해 주세요.')

  return (
    <section className="sb-prompt-trial__overview" aria-label="기존 버전과 수정 버전 차이 요약">
      <header>
        <div><span>한눈에 보는 변화</span><b>{diffCount > 0 ? `${diffCount}곳이 달라졌어요` : '달라진 곳이 없어요'}</b></div>
        <div className="sb-prompt-trial__overview-legend"><span><i className="is-before" />변경 전</span><span><i className="is-after" />변경 후</span></div>
      </header>
      <div className="sb-prompt-trial__metrics">
        {metrics.map((metric) => (
          <div key={metric.label}><span>{metric.label}</span><em>{metric.before}{metric.unit}</em><i>→</i><b>{metric.after}{metric.unit}</b></div>
        ))}
      </div>
      <div className="sb-prompt-trial__insights">
        <article className="is-command"><i>1</i><div><b>왜 바뀌었나요?</b><small>내가 입력한 명령</small><p>“{command}”</p></div></article>
        <span className="sb-prompt-trial__insight-arrow">→</span>
        <article className="is-change"><i>2</i><div><b>무엇이 바뀌었나요?</b>{changes.map((text) => <p key={text}>{text}</p>)}</div></article>
        <span className="sb-prompt-trial__insight-arrow">→</span>
        <article className="is-better"><i>3</i><div><b>무엇이 좋아지나요?</b><p>{benefit}</p></div></article>
        <span className="sb-prompt-trial__insight-arrow">→</span>
        <article className="is-check"><i>4</i><div><b>한계는 무엇인가요?</b>{checks.slice(0, 3).map((text) => <p key={text}>{text}</p>)}</div></article>
      </div>
    </section>
  )
}

function DiffBadge({ side }) {
  return <small className={`sb-prompt-trial__diff-badge is-${side}`}>{side === 'before' ? '변경 전' : '변경 후'}</small>
}

function SurveyResult({ survey, answers = [], compareSurvey = null, diffSide = null }) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.choices]))
  const introChanged = diffSide && !sameValue(survey?.intro || '', compareSurvey?.intro || '')
  return (
    <div className="sb-prompt-trial__survey">
      {survey?.intro && <p className={introChanged ? `is-diff is-${diffSide}` : ''}>{introChanged && <DiffBadge side={diffSide} />}{survey.intro}</p>}
      <ol>
        {(survey?.questions || []).map((question, index) => {
          const changed = diffSide && !sameValue(comparableQuestion(question), comparableQuestion(compareSurvey?.questions?.[index]))
          return (
            <li key={question.id} className={changed ? `is-diff is-${diffSide}` : ''}>
              <span>{index + 1}</span>
              <div>
                {changed && <DiffBadge side={diffSide} />}
                <b>{question.question}</b>
                <div>
                  {(question.options || []).map((option) => (
                    <em key={option} className={answerMap.get(question.id)?.includes(option) ? 'is-picked' : ''}>{option}</em>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function PlanSection({ section, compareSection = null, diffSide = null }) {
  const products = [...(section.webProducts || []), ...(section.products || [])]
  const changed = diffSide && !sameValue(comparableSection(section), comparableSection(compareSection))
  return (
    <article className={`sb-prompt-trial__section${changed ? ` is-diff is-${diffSide}` : ''}`}>
      <div className="sb-prompt-trial__section-meta"><span>{SECTION_LABEL[section.kind] || section.kind}</span>{changed && <DiffBadge side={diffSide} />}</div>
      <h4>{section.title || '제목 없음'}</h4>
      {(section.body || section.desc || section.reason) && <p>{section.body || section.desc || section.reason}</p>}
      {(section.points || section.steps || []).length > 0 && (
        <ul>{(section.points || section.steps).map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
      )}
      {products.length > 0 && (
        <ul className="sb-prompt-trial__products">
          {products.map((product, index) => (
            <li key={product.id || product.url || `${product.name}-${index}`}>
              <b>{product.brand ? `${product.brand} ` : ''}{product.name || product.id}</b>
              {product.price != null && <small>{Number(product.price).toLocaleString('ko-KR')}원</small>}
            </li>
          ))}
        </ul>
      )}
      {(section.items || []).length > 0 && (
        <ul className="sb-prompt-trial__products">
          {section.items.map((item, index) => <li key={item.url || `${item.title}-${index}`}><b>{item.title}</b><small>{item.source}</small></li>)}
        </ul>
      )}
      {(section.productIds || []).length > 0 && products.length === 0 && (
        <p className="sb-admin__muted">카탈로그 상품 · {section.productIds.join(', ')}</p>
      )}
    </article>
  )
}

function TrialOutput({ selectedId, output, compareOutput, diffSide }) {
  if (!output) return null
  if (selectedId === 'survey') return <SurveyResult survey={output.survey} compareSurvey={compareOutput?.survey} diffSide={diffSide} />
  const sections = planSections(selectedId, output)
  const compareSections = planSections(selectedId, compareOutput)
  const headingChanged = selectedId === 'plan-skeleton' && !sameValue(
    { headline: output.skeleton?.headline || '', summary: output.skeleton?.summary || '' },
    { headline: compareOutput?.skeleton?.headline || '', summary: compareOutput?.skeleton?.summary || '' },
  )
  return (
    <div className="sb-prompt-trial__plan">
      {selectedId === 'plan-skeleton' && (
        <header className={headingChanged ? `is-diff is-${diffSide}` : ''}>{headingChanged && <DiffBadge side={diffSide} />}<h3>{output.skeleton?.headline}</h3><p>{output.skeleton?.summary}</p></header>
      )}
      {sections.map((section, index) => <PlanSection key={`${section.kind}-${section.title}-${index}`} section={section} compareSection={compareSections[index]} diffSide={diffSide} />)}
      {sections.length === 0 && <p className="sb-admin__muted">검증을 통과해 표시할 결과가 없어요. 지시를 조금 바꿔 다시 시험해보세요.</p>}
    </div>
  )
}

export default function AdminPromptTrial({ wire, seed, onApplied, api }) {
  const prompts = wire?.prompts || []
  const firstId = TESTABLE_PROMPTS.find((item) => prompts.some((prompt) => prompt.id === item.id))?.id || 'survey'
  const [selectedId, setSelectedId] = useState(seed?.promptId || firstId)
  const [instruction, setInstruction] = useState('')
  const [proposal, setProposal] = useState(null)
  const [intent, setIntent] = useState(sampleIntent)
  const [result, setResult] = useState(null)
  const [status, setStatus] = useState(null)
  const [making, setMaking] = useState(false)
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState(null)
  const [applied, setApplied] = useState(false)
  const [overallScore, setOverallScore] = useState(null)
  const [overallComment, setOverallComment] = useState('')
  const [savedThread, setSavedThread] = useState(null)
  const [savingThread, setSavingThread] = useState(false)
  const promptWorkRef = useRef({})

  const selected = useMemo(() => prompts.find((prompt) => prompt.id === selectedId) || null, [prompts, selectedId])
  const selectedMeta = TESTABLE_PROMPTS.find((item) => item.id === selectedId)
  const currentText = selected ? selected.configured ?? selected.defaultText : ''
  const diffCount = useMemo(
    () => result ? changedBlockCount(selectedId, result.baseline, result.trial) : 0,
    [result, selectedId],
  )

  useEffect(() => {
    if (!seed?.promptId || !seed.text || !prompts.some((prompt) => prompt.id === seed.promptId)) return
    setSelectedId(seed.promptId)
    setProposal({ proposedText: seed.text, summary: seed.summary || '직접 수정한 시험안', warnings: [] })
    setInstruction(seed.summary || '')
    setResult(null)
    setApplied(false)
    setOverallScore(null)
    setOverallComment('')
    setSavedThread(null)
    setError(null)
  }, [seed])

  const choosePrompt = (id) => {
    if (id === selectedId || making || running || applying) return
    promptWorkRef.current[selectedId] = {
      instruction,
      proposal,
      intent,
      result,
      applied,
      error,
      overallScore,
      overallComment,
      savedThread,
    }
    const saved = promptWorkRef.current[id]
    setSelectedId(id)
    setInstruction(saved?.instruction ?? '')
    setProposal(saved?.proposal ?? null)
    setIntent(saved?.intent ?? sampleIntent)
    setResult(saved?.result ?? null)
    setApplied(saved?.applied ?? false)
    setOverallScore(saved?.overallScore ?? null)
    setOverallComment(saved?.overallComment ?? '')
    setSavedThread(saved?.savedThread ?? null)
    setError(saved?.error ?? null)
    setStatus(null)
  }

  const makeProposal = async () => {
    if (!selected || !instruction.trim() || making) return
    setMaking(true)
    setError(null)
    setResult(null)
    setApplied(false)
    setOverallScore(null)
    setOverallComment('')
    setSavedThread(null)
    try {
      const next = await assistAdminPrompt(selected.id, instruction.trim(), proposal?.proposedText || currentText)
      setProposal(next)
    } catch (e) {
      setError(e.message || '시험안을 만들지 못했어요.')
    } finally {
      setMaking(false)
    }
  }

  const runTrial = async () => {
    if (!selected || !proposal?.proposedText || !intent.trim() || running) return
    setRunning(true)
    setError(null)
    setResult(null)
    setApplied(false)
    setOverallScore(null)
    setOverallComment('')
    setSavedThread(null)
    setStatus('시험 준비 중…')
    try {
      if (selected.id === 'survey') {
        setStatus('현재 결과와 시험안 결과를 함께 만들고 있어요…')
        const [baseline, trial] = await Promise.all([
          dryRunStage({ stageId: 'survey', intent: intent.trim() }),
          dryRunStage(
            { stageId: 'survey', intent: intent.trim(), promptOverride: proposal.proposedText },
            { onStatus: setStatus },
          ),
        ])
        setResult({ baseline, trial })
      } else {
        setStatus('같은 고객 문장으로 설문과 임시 답변을 준비하고 있어요…')
        const surveyOutput = await dryRunStage({ stageId: 'survey', intent: intent.trim() })
        const answers = autoAnswers(surveyOutput.survey)
        if (!answers.length) throw new Error('계획 시험에 사용할 설문 답변을 만들지 못했어요.')
        const input = {
          stageId: selected.id,
          intent: intent.trim(),
          survey: surveyOutput.survey,
          answers,
        }
        setStatus('같은 조건으로 현재 결과와 시험안 결과를 비교하고 있어요…')
        const [baseline, trial] = await Promise.all([
          dryRunStage(input),
          dryRunStage({ ...input, promptOverride: proposal.proposedText }, { onStatus: setStatus }),
        ])
        setResult({ survey: surveyOutput.survey, answers, baseline, trial })
      }
      setStatus(null)
    } catch (e) {
      setError(e.message || '시험 실행에 실패했어요.')
      setStatus(null)
    } finally {
      setRunning(false)
    }
  }

  const apply = async () => {
    if (!selected || !proposal?.proposedText || !result || applying) return
    setApplying(true)
    setError(null)
    try {
      let next
      if (savedThread) {
        const updated = await decideAdminPromptTrial(savedThread.id, 'applied')
        setSavedThread(updated)
        next = await fetchAdminPrompts()
      } else {
        next = await putAdminPrompt(selected.id, proposal.proposedText, proposal.summary || instruction.trim())
      }
      onApplied(next)
      setApplied(true)
      api.showToast('시험한 지시서를 적용했어요. 새로 만드는 결과부터 사용됩니다.')
    } catch (e) {
      setError(e.message || '지시서를 적용하지 못했어요.')
    } finally {
      setApplying(false)
    }
  }

  const saveTrialThread = async () => {
    if (!selected || !proposal || !result || overallScore == null || savingThread || savedThread) return
    setSavingThread(true)
    setError(null)
    try {
      const thread = await saveAdminPromptTrial({
        promptId: selected.id,
        promptLabel: selectedMeta?.label || selected.id,
        instruction: instruction.trim(),
        summary: proposal.summary || instruction.trim().slice(0, 200),
        warnings: proposal.warnings || [],
        baseText: currentText,
        proposedText: proposal.proposedText,
        intent: intent.trim(),
        baseline: result.baseline,
        trial: result.trial,
        evaluation: { score: overallScore, comment: overallComment.trim() },
      })
      setSavedThread(thread)
      api.showToast('전체 평가와 시험 결과를 쓰레드로 저장했어요.')
    } catch (e) {
      setError(e.message || '시험 쓰레드를 저장하지 못했어요.')
    } finally {
      setSavingThread(false)
    }
  }

  if (!wire) return <div className="sb-admin-card"><p className="sb-admin__muted">지시서를 불러오는 중…</p></div>

  return (
    <div className="sb-prompt-trial">
      <section className="sb-prompt-trial__intro">
        <span>안전한 시험 공간</span>
        <div><h2>마음에 들 때만 실제로 적용하세요</h2><p>시험안 만들기와 결과 확인까지는 고객에게 아무 영향도 주지 않습니다.</p></div>
        <ol><li><i>1</i> 바꿀 항목 선택</li><li><i>2</i> 저장 없이 시험</li><li><i>3</i> 결과 확인 후 적용</li></ol>
      </section>

      <div className="sb-prompt-trial__layout">
        <div className="sb-prompt-trial__controls">
          <section className="sb-admin-card sb-prompt-trial__step">
            <header><i>1</i><div><h2>무엇을 바꿀까요?</h2><p>시험할 결과 한 가지만 고르세요.</p></div></header>
            <div className="sb-prompt-trial__choices">
              {TESTABLE_PROMPTS.filter((item) => prompts.some((prompt) => prompt.id === item.id)).map((item) => {
                const prompt = prompts.find((entry) => entry.id === item.id)
                return (
                  <button key={item.id} type="button" className={selectedId === item.id ? 'is-on' : ''} disabled={making || running || applying} onClick={() => choosePrompt(item.id)}>
                    <b>{item.label}</b><small>{item.note}</small><em>{prompt?.configured ? '현재 수정본 사용 중' : '현재 기본값 사용 중'}</em>
                  </button>
                )
              })}
            </div>
            <p className="sb-prompt-trial__scope">의도 해석과 자동 검사는 개발자용 전문가 보기에서 계속 관리합니다.</p>
          </section>

          <section className="sb-admin-card sb-prompt-trial__step">
            <header><i>2</i><div><h2>원하는 결과를 말해주세요</h2><p>{selectedMeta?.note}</p></div></header>
            <textarea
              value={instruction}
              rows={3}
              maxLength={2000}
              placeholder={selectedId === 'survey' ? '예: 질문은 최대 3개만 만들고 문장을 짧게 써줘' : selectedId === 'plan-skeleton' ? '예: 추천 이유는 3문장 이내로 쓰고 단계는 간결하게 구성해줘' : '예: 가격과 피부 타입에 맞는 상품을 우선 추천해줘'}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <button type="button" className="sb-btn sb-btn--ai" disabled={making || instruction.trim().length < 2} onClick={makeProposal}>
              {making ? '시험안 프롬프트 만드는 중…' : '⇄ 시험안 프롬프트 만들기'}
            </button>
            {proposal && (
              <div className="sb-prompt-trial__proposal">
                <span>저장되지 않은 시험안</span><b>{proposal.summary}</b>
                {proposal.warnings?.length > 0 && <ul>{proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                <details><summary>수정된 지시서 원문 보기</summary><pre>{proposal.proposedText}</pre></details>
              </div>
            )}
          </section>

          <section className="sb-admin-card sb-prompt-trial__step">
            <header><i>3</i><div><h2>같은 조건으로 비교할게요</h2><p>현재 결과와 시험안 결과를 한 번에 만들며 고객 기록에는 남지 않습니다.</p></div></header>
            <label>처음 입력한 문장 다시 입력<input value={intent} maxLength={500} placeholder="예: 소개팅 메이크업 해줘" onChange={(event) => setIntent(event.target.value)} /></label>
            <small className="sb-prompt-trial__auto">실제 서비스 검색창에 입력했던 자연어 문장을 그대로 적어주세요.</small>
            <button type="button" className="sb-btn sb-btn--ai" disabled={!proposal || !intent.trim() || running} onClick={runTrial}>
              {running ? status || '시험 중…' : '⇄ 이 문장으로 비교 실행'}
            </button>
            <small className="sb-prompt-trial__auto">비교를 위해 같은 AI 단계를 두 번 실행합니다. 생성 결과는 실행할 때마다 조금 달라질 수 있어요.</small>
            {selectedId !== 'survey' && <small className="sb-prompt-trial__auto">계획 시험은 같은 문장으로 설문을 준비하고 첫 번째 선택지를 임시 답변으로 사용해요.</small>}
          </section>
          {error && <p className="sb-admin-gate__error">{error}</p>}
        </div>

        <section className={`sb-admin-card sb-prompt-trial__result${result ? ' has-result' : ''}`}>
          <header><div><span>비교 결과</span><h2>{result ? `${selectedMeta?.label} 결과를 나란히 확인하세요` : '아직 실제 설정은 바뀌지 않았어요'}</h2></div>{result && <em>두 결과 모두 저장 안 됨</em>}</header>
          {!result && <div className="sb-prompt-trial__empty"><i>✓</i><p>시험안을 실행하면 현재 운영 결과와<br />바꾼 결과가 나란히 나타납니다.</p></div>}
          {result?.survey && (
            <details className="sb-prompt-trial__input"><summary>시험에 사용한 설문과 임시 답변</summary><SurveyResult survey={result.survey} answers={result.answers} /></details>
          )}
          {result && <DiffOverview selectedId={selectedId} baseline={result.baseline} trial={result.trial} diffCount={diffCount} proposal={proposal} instruction={instruction} />}
          {result && (
            <div className="sb-prompt-trial__compare">
              <section>
                <header><span>기존 버전</span><b>현재 지시서로 만든 결과</b></header>
                <TrialOutput selectedId={selectedId} output={result.baseline} compareOutput={result.trial} diffSide="before" />
              </section>
              <section className="is-trial">
                <header><span>수정 버전</span><b>수정한 지시서로 만든 결과</b></header>
                <TrialOutput selectedId={selectedId} output={result.trial} compareOutput={result.baseline} diffSide="after" />
              </section>
            </div>
          )}
          {result && (
            <section className="sb-prompt-trial__overall">
              <header><div><span>전체 평가</span><h3>이 수정 버전, 전체적으로 어떤가요?</h3><p>평가와 메모를 남겨 쓰레드로 저장하면 나중에 다시 열어 적용 여부를 결정할 수 있어요.</p></div>{savedThread && <em>쓰레드 저장 완료</em>}</header>
              <div className="sb-prompt-trial__overall-body">
                <div className="sb-prompt-trial__stars" role="group" aria-label="수정 버전 전체 점수">
                  {[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" className={overallScore >= score ? 'is-on' : ''} disabled={Boolean(savedThread)} aria-label={`${score}점`} onClick={() => setOverallScore(score)}>★</button>)}
                  <b>{overallScore == null ? '점수를 골라주세요' : `${overallScore}점`}</b>
                </div>
                <textarea value={overallComment} maxLength={2000} disabled={Boolean(savedThread)} placeholder="예: 상품 중복은 줄었지만 참고 콘텐츠가 없어서 한 번 더 시험 필요" onChange={(event) => setOverallComment(event.target.value)} />
                {savedThread ? (
                  <button type="button" className="sb-btn sb-btn--ghost" onClick={() => api.openAdminThread(savedThread.id)}>저장된 시험 쓰레드 열기</button>
                ) : (
                  <button type="button" className="sb-btn sb-btn--primary" disabled={overallScore == null || savingThread} onClick={saveTrialThread}>{savingThread ? '저장 중…' : '평가와 시험 결과를 쓰레드로 저장'}</button>
                )}
              </div>
            </section>
          )}
          {result && (
            <footer>
              <p>{applied ? <><b>적용 완료</b> 새로 만드는 전체 결과부터 사용됩니다.</> : <>결과가 마음에 들 때만 적용하세요.</>}</p>
              {!applied && <button type="button" className="sb-btn sb-btn--primary" disabled={applying} onClick={apply}>{applying ? '적용 중…' : '이 시험안을 전체 신규 생성에 적용'}</button>}
            </footer>
          )}
        </section>
      </div>
    </div>
  )
}
