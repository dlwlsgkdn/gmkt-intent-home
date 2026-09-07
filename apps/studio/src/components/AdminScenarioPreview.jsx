import React, { useEffect, useMemo, useRef, useState } from 'react'
import { renderItem } from '../lib/registry.jsx'
import { livePlanItems, liveSurveyItems } from '../lib/livePage.js'
import { dryRunStage } from '../lib/adminApi.js'
import { previewAnswers, previewPlan } from '../lib/promptPreview.js'

const noop = () => {}
const openUrl = (url) => {
  try {
    const parsed = new URL(url)
    if (['https:', 'http:'].includes(parsed.protocol)) window.open(parsed.href, '_blank', 'noopener,noreferrer')
  } catch { /* 상품에 링크가 없는 경우 */ }
}

/*
 * 운영 설정을 저장하지 않는 고객 화면 — 폰 두 대를 좌우로 세운다.
 * 왼쪽(--before) = 지금 운영 지시서로 만든 화면(읽기 전용 거울), 오른쪽(--after) = 시험안 화면(조작은 여기서만).
 * 단계·질문 커서·답변은 한 벌을 공유해 두 화면이 같은 지점을 나란히 보여준다 —
 * 수정 프롬프트가 "실제로 어떻게 반영되는지"를 눈으로 비교하는 자리다.
 * LivePlayer와 같은 투영(livePage)·렌더러(registry)를 사용한다.
 */
export default function AdminScenarioPreview({ intent, onIntent, selectedId, result, input, onPrepare, onAnswer, onRun, busy, status, proposal, onBusy }) {
  const [stage, setStage] = useState('search')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [trialAnswers, setTrialAnswers] = useState({})
  const [continuedPlans, setContinuedPlans] = useState({})
  const [localBusy, setLocalBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const generation = useRef(0)
  const viewportBefore = useRef(null)
  const viewportAfter = useRef(null)

  /* 설문 자체를 시험 중이면 좌우 설문이 다르고, 계획 시험이면 설문은 같고 계획만 갈린다 */
  const isSurveyComparison = selectedId === 'survey' && Boolean(result)
  const afterSurvey = isSurveyComparison ? result.trial?.survey : input?.survey
  const beforeSurvey = isSurveyComparison ? result.baseline?.survey : input?.survey
  const answers = isSurveyComparison ? trialAnswers : input?.answers || {}
  const afterPlan = result?.preview?.trial || continuedPlans.trial
  const beforePlan = result?.preview?.baseline || continuedPlans.baseline
  const locked = busy || localBusy
  const questions = afterSurvey?.questions || []
  const current = questions[questionIndex]
  const answered = current && previewAnswers({ questions: [current] }, answers).length > 0
  const ready = questions.filter((q) => q.kind !== 'photo').every((q) => previewAnswers({ questions: [q] }, answers).length > 0)
  const stale = Boolean(input && input.intent !== intent.trim())

  useEffect(() => {
    generation.current += 1
    setContinuedPlans({})
    setTrialAnswers({})
    setQuestionIndex(0)
    setError(null)
    setStage(result?.preview ? 'plan' : input?.survey || result?.trial?.survey ? 'survey' : 'search')
  }, [result, input?.survey, selectedId])
  useEffect(() => {
    viewportBefore.current?.scrollTo({ top: 0 })
    viewportAfter.current?.scrollTo({ top: 0 })
  }, [stage, questionIndex])
  useEffect(() => () => { generation.current += 1 }, [])

  const setAnswer = (id, value) => {
    if (locked) return
    setContinuedPlans({})
    if (isSurveyComparison) setTrialAnswers((prev) => ({ ...prev, [id]: value }))
    else onAnswer(id, value)
  }

  /* 설문 시험에서 "이 답변으로 추천 보기" — 운영·시험 설문 각각의 답으로 두 계획을 같이 만든다 */
  const continuePlan = async () => {
    if (!ready || locked || stale) return
    if (selectedId !== 'survey' && proposal) { onRun(); return }
    const token = ++generation.current
    setLocalBusy(true)
    onBusy(true)
    setError(null)
    try {
      const planFor = async (survey, answerMap) => {
        const body = { intent: input?.intent || intent.trim(), profile: input?.profile || [], survey, answers: previewAnswers(survey, answerMap) }
        const [skeleton, products] = await Promise.all([
          dryRunStage({ ...body, stageId: 'plan-skeleton' }),
          dryRunStage({ ...body, stageId: 'plan-products' }),
        ])
        return previewPlan(skeleton, products)
      }
      setMessage(isSurveyComparison ? '운영·시험 두 설문의 답으로 추천을 각각 만들고 있어요…' : '고른 답변으로 계획과 상품을 만들고 있어요…')
      if (isSurveyComparison && beforeSurvey) {
        const [trial, baseline] = await Promise.all([planFor(afterSurvey, answers), planFor(beforeSurvey, answers)])
        if (token !== generation.current) return
        setContinuedPlans({ trial, baseline })
      } else {
        const page = await planFor(afterSurvey, answers)
        if (token !== generation.current) return
        setContinuedPlans({ trial: page, baseline: page })
      }
      setStage('plan')
    } catch (e) {
      if (token === generation.current) setError(e.message || '추천을 만들지 못했어요. 다시 시험해주세요.')
    } finally {
      setLocalBusy(false)
      onBusy(false)
      setMessage(null)
    }
  }

  const profile = { name: '시험 고객', items: input?.profile || [] }
  const buildItems = (survey, plan, mirrorLocked) => {
    if (stage === 'plan' && plan) return livePlanItems(plan, { query: input?.intent || intent })
    if (!survey) return []
    return liveSurveyItems(survey).map((item) => item.type === 'profilePanel'
      ? { ...item, props: { ...item.props, hint: '이번 시험에 사용하는 프로필이에요' } }
      : item.type === 'surveyQuestion' ? { ...item, props: { ...item.props, locked: mirrorLocked } } : item)
  }
  const afterItems = useMemo(
    () => buildItems(afterSurvey, afterPlan, locked),
    [stage, afterPlan, afterSurvey, input?.intent, intent, locked],
  )
  const beforeItems = useMemo(
    () => buildItems(beforeSurvey, beforePlan, true),
    [stage, beforePlan, beforeSurvey, input?.intent, intent],
  )

  const playerFor = (interactive, paneAnswers, paneSurvey) => ({
    query: intent, setQuery: interactive ? onIntent : noop, submitQuery: interactive ? onPrepare : noop,
    answers: paneAnswers, setAnswer: interactive ? setAnswer : noop,
    cart: [], addToCart: noop, complete: noop, showKeyword: noop,
    openExternal: (_label, url) => openUrl(url), openProduct: ({ url }) => openUrl(url),
    excludedProfile: [], toggleProfileItem: noop,
    summary: {
      profile: profile.items,
      questions: (paneSurvey?.questions || []).map((q) => ({ q: q.question, a: previewAnswers({ questions: [q] }, paneAnswers)[0]?.choices.join(', ') || '건너뜀' })),
    },
  })

  /* 거울(변경 전) 폰의 현재 질문 — 좌우 질문 수가 달라도 같은 커서를 따라간다 */
  const beforeQuestions = beforeSurvey?.questions || []
  const beforeCurrent = beforeQuestions[Math.min(questionIndex, Math.max(beforeQuestions.length - 1, 0))]

  const paneStack = (items, interactive, paneAnswers, paneSurvey, currentQuestion) => (
    <div className="sb-player__stack">
      {items
        .filter((item) => !item.parentId && item.type !== 'screenHeader' && (!['surveyQuestion', 'surveyPhoto'].includes(item.type) || item.id === currentQuestion?.id))
        .map((item) => (
          <div key={item.id} className="sb-player__item">
            {renderItem(item, { mode: 'player', player: playerFor(interactive, paneAnswers, paneSurvey), profile, allItems: items })}
          </div>
        ))}
    </div>
  )

  const beforeEmpty = stage === 'search'
    ? '오른쪽에서 고객 문장을 입력하면 두 화면이 함께 시작돼요.'
    : stage === 'plan' && !beforePlan
      ? '운영 버전 추천이 아직 없어요. 설문에 답하고 추천을 만들어 보세요.'
      : !beforeSurvey ? '고객 화면을 불러오면 지금 운영 중인 화면이 여기 나타나요.' : null
  const showAfterDiffBadge = Boolean(result)

  return (
    <>
      <aside className="sb-scenario-preview sb-scenario-preview--before" aria-label="지금 운영 중인 고객 화면 (변경 전)">
        <div className="sb-scenario-preview__head">
          <div><span>변경 전 · 읽기 전용</span><h2>지금 운영 화면</h2></div>
          <b className="is-before">운영</b>
        </div>
        <p className="sb-scenario-preview__note">현재 지시서가 만드는 화면이에요. 오른쪽 시험 화면과 같은 지점을 비춥니다.</p>
        <div className="sb-scenario-preview__viewport" ref={viewportBefore}>
          <div className="sb-phone sb-phone--player sb-scenario-preview__phone">
            {beforeEmpty
              ? <div className="sb-scenario-preview__mirror-empty"><i aria-hidden="true">◐</i><p>{beforeEmpty}</p></div>
              : paneStack(beforeItems, false, answers, beforeSurvey, beforeCurrent)}
          </div>
        </div>
        <div className="sb-scenario-preview__foot">
          {isSurveyComparison && stage === 'survey' && <span>{beforeQuestions.length ? `운영 설문 ${Math.min(questionIndex + 1, beforeQuestions.length)} / ${beforeQuestions.length} 질문` : '운영 설문에 질문이 없어요'}</span>}
          <small>이 화면은 보기 전용이에요. 조작은 오른쪽 시험 화면에서 해요.</small>
        </div>
      </aside>

      <aside className="sb-scenario-preview sb-scenario-preview--after" aria-label="시험안을 적용한 고객 화면 (변경 후)">
        <div className="sb-scenario-preview__head">
          <div><span>{showAfterDiffBadge ? '변경 후 · 시험안 적용' : '직접 눌러보는 고객 화면'}</span><h2>{showAfterDiffBadge ? '시험안 화면' : '자유시나리오 미리보기'}</h2></div>
          <b>{showAfterDiffBadge ? '시험안' : '시험용'}</b>
        </div>
        <p className="sb-scenario-preview__note">{showAfterDiffBadge ? '수정한 지시서가 반영된 화면이에요. 왼쪽 운영 화면과 비교해 보세요.' : '검색부터 설문·추천까지 이곳에서 확인해요.'}</p>
        <nav className="sb-scenario-preview__steps" aria-label="고객 화면 단계">
          {[['search', '검색'], ['survey', '설문'], ['plan', '추천']].map(([value, label], i) => <button type="button" key={value} aria-current={stage === value ? 'step' : undefined} className={stage === value ? 'is-on' : ''} disabled={locked || (value === 'survey' && !afterSurvey) || (value === 'plan' && !afterPlan)} onClick={() => setStage(value)}><span>{i + 1}</span>{label}</button>)}
        </nav>
        {stale && <p className="sb-scenario-preview__warning">검색 문장이 바뀌었어요. 검색 단계에서 화면을 다시 불러와 주세요.</p>}
        <div className="sb-scenario-preview__viewport" ref={viewportAfter}>
          <div className="sb-phone sb-phone--player sb-scenario-preview__phone">
            {stage === 'search' ? <div className="sb-scenario-preview__search">
              <span className="sb-scenario-preview__brand">DDAK</span><h3>어떤 도움이 필요하세요?</h3><p>고객이 처음 입력하는 문장으로 시작해요.</p>
              <label>고객 검색 문장<textarea rows={3} value={intent} maxLength={500} disabled={locked} onChange={(e) => onIntent(e.target.value)} placeholder="예: 소개팅 메이크업 해줘" /></label>
              <button type="button" className="sb-btn sb-btn--ai" disabled={locked || !intent.trim()} onClick={onPrepare}>⇄ 고객 화면 불러오기</button>
              <small>현재 지시서로 설문을 만들어요. 왼쪽에서 만든 수정안은 비교 실행할 때 사용해요.</small>
            </div> : paneStack(afterItems, true, answers, afterSurvey, current)}
          </div>
        </div>
        <div className="sb-scenario-preview__foot">
          {locked && <p role="status">{message || status || '고객 화면을 만들고 있어요…'}</p>}
          {error && <p className="sb-admin-gate__error" role="alert">{error}</p>}
          {stage === 'survey' && afterSurvey && <>
            <span>{questions.length ? `${questionIndex + 1} / ${questions.length} 질문` : '추가 질문이 없어요'}</span>
            <div className="sb-scenario-preview__actions">
              <button type="button" className="sb-btn sb-btn--ghost" disabled={locked || questionIndex === 0} onClick={() => setQuestionIndex((v) => v - 1)}>이전</button>
              {questionIndex < questions.length - 1 ? <button type="button" className="sb-btn sb-btn--primary" disabled={locked || (!answered && current?.kind !== 'photo')} onClick={() => setQuestionIndex((v) => v + 1)}>{!answered && current?.kind === 'photo' ? '사진 건너뛰기' : '다음 질문'}</button> : <button type="button" className="sb-btn sb-btn--ai" disabled={locked || !ready || stale || !previewAnswers(afterSurvey, answers).length} onClick={continuePlan}>⇄ {selectedId !== 'survey' && proposal ? '이 답변으로 비교하기' : isSurveyComparison ? '두 설문 답으로 추천 비교' : '이 답변으로 추천 보기'}</button>}
            </div>
          </>}
          {stage === 'plan' && <button type="button" className="sb-btn sb-btn--ghost" disabled={locked} onClick={() => setStage('survey')}>← 설문 답변 다시 보기</button>}
          <small>운영 지시서는 적용 버튼을 누르기 전까지 바뀌지 않아요. 구매·담기와 사진 합성은 이 미리보기에서 실행하지 않아요.</small>
        </div>
      </aside>
    </>
  )
}
