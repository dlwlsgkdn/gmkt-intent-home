import React, { useMemo, useState } from 'react'
import { STAGES, DEVICE_PRESETS, sortByPosition } from '../lib/store.js'
import { renderItem } from '../lib/registry.jsx'
import { BgBlobs, FloatingBar, StudioFab } from './Frame.jsx'

export default function Player({ api, scenario }) {
  const [stageIdx, setStageIdx] = useState(0)
  const [query, setQuery] = useState(scenario.query || '')
  const [answers, setAnswers] = useState({})
  const [cart, setCart] = useState([])
  const [excludedProfile, setExcludedProfile] = useState([]) // 이번 회차에서 뺀 프로필 항목

  const stage = STAGES[stageIdx]
  const items = useMemo(
    () => sortByPosition(scenario.stages[stage.key] || []),
    [scenario, stage.key]
  )
  /* 시나리오가 모바일 기기 폭으로 설계됐다면 플레이어도 그 폭으로 보여준다 */
  const device = DEVICE_PRESETS.find((d) => d.key === (scenario.device || 'desktop'))
  const deviceStyle = device && device.w < 760 ? { maxWidth: device.w } : undefined

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

  /* 이 시나리오와 연관된 고정 설문 정보 (프로필, 빈 라벨 항목 제외) */
  const allProfileItems = (api.profile?.items || []).filter((it) => it.label && it.label.trim())
  const activeKeys = scenario.profileKeys ?? allProfileItems.map((it) => it.label)
  const profileItems = allProfileItems.filter((it) => activeKeys.includes(it.label))
  const includedProfile = profileItems.filter((it) => !excludedProfile.includes(it.label))

  const toggleProfileItem = (label) => {
    setExcludedProfile((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    )
  }

  const questions = (scenario.stages.survey || []).filter((it) => it.type === 'surveyQuestion')
  const answerText = (it) => {
    const a = answers[it.id]
    if (a == null || (Array.isArray(a) && a.length === 0)) return '아무거나'
    return Array.isArray(a) ? a.join(', ') : a
  }

  return (
    <>
      <BgBlobs />
      <FloatingBar
        onHome={api.goHome}
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={api.goHome}
      />
      <StudioFab label="이 시나리오 편집" onClick={() => api.openBuilder(scenario.id)} />

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
          <p className="sb-eyebrow">#{scenario.chip} 칩으로 진입 · 탐색 완료</p>
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

        {/* 설문 단계: 이미 알고 있는 사용자 프로필 요약 패널 */}
        {stage.key === 'survey' && profileItems.length > 0 && (
          <div className="sb-player__panels" style={deviceStyle}>
            <div className="sb-profile-panel">
              <div className="sb-profile-panel__head">
                <span className="sb-profile-panel__avatar" aria-hidden="true">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" /></svg>
                </span>
                <strong>{api.profile?.name || '사용자'}님에 대해 이미 알고 있어요</strong>
                <small>이번엔 빼고 싶은 항목을 눌러주세요</small>
              </div>
              <div className="sb-profile-panel__chips">
                {profileItems.map((it) => {
                  const off = excludedProfile.includes(it.label)
                  return (
                    <button
                      key={it.label}
                      type="button"
                      className={'sb-info-chip' + (off ? ' sb-info-chip--off' : '')}
                      onClick={() => toggleProfileItem(it.label)}
                      title={off ? '다시 포함하기' : '이번 설문에서 빼기'}
                    >
                      <span className="sb-info-chip__label">{it.label}:</span>
                      <strong>{it.value}</strong>
                      {!off && (
                        <span className="sb-info-chip__check" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* 계획 단계: 설문에서 고른 항목 요약 패널 */}
        {stage.key === 'plan' && (includedProfile.length > 0 || questions.length > 0) && (
          <div className="sb-player__panels" style={deviceStyle}>
            <div className="sb-summary-panel">
              <p className="sb-summary-panel__title">설문 요약</p>
              <div className="sb-summary-panel__chips">
                {includedProfile.map((it) => (
                  <span key={it.label} className="sb-info-chip sb-info-chip--static">
                    <span className="sb-info-chip__label">{it.label}:</span>
                    <strong>{it.value}</strong>
                  </span>
                ))}
                {questions.map((q) => (
                  <span key={q.id} className="sb-info-chip sb-info-chip--static">
                    <span className="sb-info-chip__label">{q.props.question}:</span>
                    <strong>{answerText(q)}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="sb-player__stack" style={deviceStyle}>
          {items.length === 0 && (
            <div className="sb-player__empty">
              이 단계에 배치된 컴포넌트가 없어요.<br />
              <button type="button" onClick={() => api.openBuilder(scenario.id)}>스튜디오에서 편집하기</button>
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              className="sb-player__item"
              style={{ maxWidth: it.w, height: it.h || undefined, overflow: it.h ? 'hidden' : undefined }}
            >
              {renderItem(it, { mode: 'player', player: playerApi })}
            </div>
          ))}
        </div>

        <div className="clean-survey-nav sb-player__nav" style={deviceStyle}>
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
              맞춤 브리프 확인하기
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
