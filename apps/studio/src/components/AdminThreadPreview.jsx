import React, { useMemo } from 'react'
import { renderItem } from '../lib/registry.jsx'
import { liveSurveyItems, livePlanItems } from '../lib/livePage.js'

/*
 * 관리 페이지 쓰레드 상세의 "실제 렌더링" 미리보기 — 스텝 payload에 저장된 와이어
 * 페이지(설문/계획)를 livePage 투영 + 레지스트리 player 렌더러로 사용자가 본 그대로
 * 그린다. 새 렌더 계층을 만들지 않는다는 원칙 그대로다 (LivePlayer와 같은 경로).
 * 읽기 전용: 답변·프로필 제외는 answers/explore 스텝에 기록된 값으로 고정하고,
 * 쓰기 계열 player API는 전부 no-op — 클릭해도 기록이 바뀌지 않는다.
 */

const noop = () => {}

/** 같은 stage 스텝이 여럿이면 마지막(최신)을 쓴다 — 재생성 이력이 있어도 사용자가 본 최종본 */
function lastStep(steps, stage) {
  let found = null
  for (const step of steps || []) {
    if (step.stage === stage) found = step
  }
  return found
}

export function threadPreviewPages(thread) {
  const steps = Array.isArray(thread?.steps) ? thread.steps : []
  const surveyStep = lastStep(steps, 'survey')
  const planStep = lastStep(steps, 'plan')
  return {
    survey: (surveyStep && surveyStep.payload && surveyStep.payload.page) || null,
    plan: (planStep && planStep.payload && planStep.payload.page) || null,
  }
}

export default function AdminThreadPreview({ thread, stage }) {
  const pages = useMemo(() => threadPreviewPages(thread), [thread])
  const page = pages[stage]

  const { items, playerApi, profile } = useMemo(() => {
    const steps = Array.isArray(thread?.steps) ? thread.steps : []
    const exploreStep = lastStep(steps, 'explore')
    const answersStep = lastStep(steps, 'answers')

    /* explore 스텝의 프로필 — 체험 당시 포함됐던 항목 그대로 */
    const profileItems = Array.isArray(exploreStep?.payload?.profile)
      ? exploreStep.payload.profile.filter((it) => it && it.label)
      : []

    /* answers 스텝 → 답변 맵 (이어보기 복원과 같은 규칙: multi는 배열, 단일은 첫 선택) */
    const questions = (pages.survey && pages.survey.questions) || []
    const answers = {}
    for (const entry of (answersStep && answersStep.payload && answersStep.payload.answers) || []) {
      const q = questions.find((question) => question.id === entry.questionId)
      answers[entry.questionId] = q && q.multi ? entry.choices : (entry.choices || [])[0]
    }

    const answerText = (q) => {
      const a = answers[q.id]
      if (a == null || (Array.isArray(a) && a.length === 0)) return '아무거나'
      return Array.isArray(a) ? a.join(', ') : a
    }

    const stub = {
      query: '',
      setQuery: noop,
      submitQuery: noop,
      answers,
      setAnswer: noop, // 읽기 전용 — 클릭해도 기록이 바뀌지 않는다
      addToCart: noop,
      complete: noop,
      showKeyword: noop,
      openExternal: noop,
      /* 상품 상세보기만 살린다 — 관리 화면엔 사이드 패널이 없어 새 탭으로 */
      openProduct: ({ url }) => {
        try {
          const parsed = new URL(String(url || '').trim())
          if (['http:', 'https:'].includes(parsed.protocol)) {
            window.open(parsed.href, '_blank', 'noopener,noreferrer')
          }
        } catch {
          /* URL 없는 상품 — 무시 */
        }
      },
      excludedProfile: [],
      toggleProfileItem: noop,
      summary: {
        profile: profileItems,
        questions: questions.map((q) => ({ q: q.question, a: answerText(q) })),
      },
    }

    const hasAnswers = Object.keys(answers).length > 0
    let stageItems = []
    if (stage === 'survey' && pages.survey) {
      /* 답변이 기록된 설문은 잠금 렌더 — 사용자가 고른 답만 또렷하게 (LivePlayer 이어보기와 동일) */
      stageItems = liveSurveyItems(pages.survey).map((it) =>
        it.type === 'surveyQuestion' ? { ...it, props: { ...it.props, locked: hasAnswers } } : it
      )
    } else if (stage === 'plan' && pages.plan) {
      stageItems = livePlanItems(pages.plan)
    }

    return {
      items: stageItems,
      playerApi: stub,
      profile: { name: '사용자', items: profileItems },
    }
  }, [thread, pages, stage])

  if (!page) {
    return <p className="sb-table__empty">이 쓰레드에는 {stage === 'survey' ? '설문' : '계획'} 페이지가 기록되지 않았어요.</p>
  }

  return (
    <div className="sb-admin-preview">
      <div className="sb-phone sb-phone--player sb-admin-preview__phone">
        <div className="sb-player__stack">
          {items
            .filter((it) => !it.parentId)
            .map((it) => (
              <div key={it.id} className="sb-player__item">
                {renderItem(it, { mode: 'player', player: playerApi, profile, allItems: items })}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
