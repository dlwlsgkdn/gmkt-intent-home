import React, { useMemo, useState } from 'react'
import { STAGES, sortByPosition } from '../lib/store.js'
import { renderItem } from '../lib/registry.jsx'
import { BgBlobs, FloatingBar } from './Frame.jsx'

export default function Player({ api, scenario }) {
  const [stageIdx, setStageIdx] = useState(0)
  const [query, setQuery] = useState(scenario.query || '')
  const [answers, setAnswers] = useState({})
  const [cart, setCart] = useState([])

  const stage = STAGES[stageIdx]
  const items = useMemo(
    () => sortByPosition(scenario.stages[stage.key] || []),
    [scenario, stage.key]
  )

  const next = () => setStageIdx((i) => Math.min(STAGES.length - 1, i + 1))
  const prev = () => setStageIdx((i) => Math.max(0, i - 1))

  const playerApi = {
    query,
    setQuery,
    submitQuery: () => next(),
    answers,
    setAnswer: (itemId, value) => setAnswers((prev) => ({ ...prev, [itemId]: value })),
    addToCart: (name) => {
      setCart((prev) => [...prev, name])
      api.showToast(`"${name}" 을(를) 쓰레드에 담았어요.`)
    },
    complete: () => {
      api.showToast('시나리오 체험 완료! 홈으로 돌아갑니다. 🎉')
      setTimeout(api.goHome, 900)
    },
  }

  const answeredCount = (scenario.stages.survey || []).filter(
    (it) => it.type === 'surveyQuestion' && answers[it.id] != null && String(answers[it.id]).length > 0
  ).length
  const questionCount = (scenario.stages.survey || []).filter((it) => it.type === 'surveyQuestion').length

  return (
    <>
      <BgBlobs />
      <FloatingBar
        onHome={api.goHome}
        onStudio={() => api.openBuilder(scenario.id)}
        onList={api.goHome}
      />

      {/* 단계 스테퍼 */}
      <nav className="sb-player-stepper" aria-label="시나리오 단계">
        {STAGES.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span className="sb-player-stepper__line" aria-hidden="true" />}
            <button
              type="button"
              className={
                'sb-player-stepper__step' +
                (i === stageIdx ? ' sb-player-stepper__step--active' : '') +
                (i < stageIdx ? ' sb-player-stepper__step--done' : '')
              }
              onClick={() => setStageIdx(i)}
            >
              <span className="sb-player-stepper__dot">{i + 1}</span>
              <span className="sb-player-stepper__label">{s.label}</span>
            </button>
          </React.Fragment>
        ))}
      </nav>

      <section className="sb-player min-h-screen relative z-10">
        <div className="sb-player__head">
          <p className="sb-eyebrow">Scenario Preview · #{scenario.chip}</p>
          <h2>{scenario.title}</h2>
          {stage.key === 'survey' && questionCount > 0 && (
            <div className="clean-survey-progress sb-player__progress" aria-label="설문 진행률">
              <div className="clean-survey-progress__meta">
                <span>{answeredCount} / {questionCount}</span>
              </div>
              <div className="clean-survey-progress__track">
                <div
                  className="clean-survey-progress__fill"
                  style={{ width: `${questionCount ? (answeredCount / questionCount) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="sb-player__stack">
          {items.length === 0 && (
            <div className="sb-player__empty">
              이 단계에 배치된 컴포넌트가 없어요.<br />
              <button type="button" onClick={() => api.openBuilder(scenario.id)}>스튜디오에서 편집하기</button>
            </div>
          )}
          {items.map((it) => (
            <div key={it.id} className="sb-player__item" style={{ maxWidth: it.w }}>
              {renderItem(it, { mode: 'player', player: playerApi })}
            </div>
          ))}
        </div>

        <div className="clean-survey-nav sb-player__nav">
          {stageIdx > 0 ? (
            <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={prev}>
              이전 단계
            </button>
          ) : (
            <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={api.goHome}>
              홈으로
            </button>
          )}
          {stageIdx < STAGES.length - 1 ? (
            <button type="button" className="clean-plan-submit" onClick={next}>
              {stage.key === 'explore' ? '설문으로 이동' : '맞춤 브리프 확인하기'}
            </button>
          ) : (
            <button type="button" className="clean-plan-submit" onClick={playerApi.complete}>
              시나리오 완료
            </button>
          )}
        </div>

        {cart.length > 0 && (
          <p className="sb-player__cart">🧺 담은 상품 {cart.length}개</p>
        )}
      </section>
    </>
  )
}
