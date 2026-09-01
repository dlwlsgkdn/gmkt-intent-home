import React, { useEffect, useMemo, useState } from 'react'
import { assistAdminPrompt, dryRunStage, putAdminPrompt } from '../lib/adminApi.js'

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

function SurveyResult({ survey, answers = [] }) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.choices]))
  return (
    <div className="sb-prompt-trial__survey">
      {survey?.intro && <p>{survey.intro}</p>}
      <ol>
        {(survey?.questions || []).map((question, index) => (
          <li key={question.id}>
            <span>{index + 1}</span>
            <div>
              <b>{question.question}</b>
              <div>
                {(question.options || []).map((option) => (
                  <em key={option} className={answerMap.get(question.id)?.includes(option) ? 'is-picked' : ''}>{option}</em>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PlanSection({ section }) {
  const products = [...(section.webProducts || []), ...(section.products || [])]
  return (
    <article className="sb-prompt-trial__section">
      <span>{SECTION_LABEL[section.kind] || section.kind}</span>
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

function TrialOutput({ selectedId, output }) {
  if (!output) return null
  if (selectedId === 'survey') return <SurveyResult survey={output.survey} />
  const sections = selectedId === 'plan-skeleton' ? output.skeleton?.sections || [] : output.sections || []
  return (
    <div className="sb-prompt-trial__plan">
      {selectedId === 'plan-skeleton' && (
        <header><h3>{output.skeleton?.headline}</h3><p>{output.skeleton?.summary}</p></header>
      )}
      {sections.map((section, index) => <PlanSection key={`${section.kind}-${section.title}-${index}`} section={section} />)}
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

  const selected = useMemo(() => prompts.find((prompt) => prompt.id === selectedId) || null, [prompts, selectedId])
  const selectedMeta = TESTABLE_PROMPTS.find((item) => item.id === selectedId)
  const currentText = selected ? selected.configured ?? selected.defaultText : ''

  useEffect(() => {
    if (!seed?.promptId || !seed.text || !prompts.some((prompt) => prompt.id === seed.promptId)) return
    setSelectedId(seed.promptId)
    setProposal({ proposedText: seed.text, summary: seed.summary || '직접 수정한 시험안', warnings: [] })
    setInstruction(seed.summary || '')
    setResult(null)
    setApplied(false)
    setError(null)
  }, [seed])

  const choosePrompt = (id) => {
    setSelectedId(id)
    setInstruction('')
    setProposal(null)
    setResult(null)
    setApplied(false)
    setError(null)
  }

  const makeProposal = async () => {
    if (!selected || !instruction.trim() || making) return
    setMaking(true)
    setError(null)
    setResult(null)
    setApplied(false)
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
      const next = await putAdminPrompt(selected.id, proposal.proposedText, proposal.summary || instruction.trim())
      onApplied(next)
      setApplied(true)
      api.showToast('시험한 지시서를 적용했어요. 새로 만드는 결과부터 사용됩니다.')
    } catch (e) {
      setError(e.message || '지시서를 적용하지 못했어요.')
    } finally {
      setApplying(false)
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
                  <button key={item.id} type="button" className={selectedId === item.id ? 'is-on' : ''} onClick={() => choosePrompt(item.id)}>
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
            <label>시험할 고객 요청<input value={intent} maxLength={500} onChange={(event) => setIntent(event.target.value)} /></label>
            <button type="button" className="sb-btn sb-btn--ai" disabled={!proposal || !intent.trim() || running} onClick={runTrial}>
              {running ? status || '시험 중…' : '⇄ 저장 없이 시험 실행'}
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
          {result && (
            <div className="sb-prompt-trial__compare">
              <section>
                <header><span>현재 운영</span><b>지금 고객이 받는 결과</b></header>
                <TrialOutput selectedId={selectedId} output={result.baseline} />
              </section>
              <section className="is-trial">
                <header><span>시험안</span><b>바꾸면 받게 될 결과</b></header>
                <TrialOutput selectedId={selectedId} output={result.trial} />
              </section>
            </div>
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
