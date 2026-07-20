import React, { useEffect, useMemo, useRef, useState } from 'react'
import { STAGES, DEVICE_PRESETS, sortByPosition, uid, visibleProfileItems } from '../lib/store.js'
import { renderItem } from '../lib/registry.jsx'
import { BgBlobs, FloatingBar, StudioFab, ViewerDeviceControl } from './Frame.jsx'
import ThreadPanel from './ThreadPanel.jsx'

/* resume = { threadId, stage } — 쓰레드 히스토리의 "쓰레드 이동": 기존 쓰레드를 이어간다 */
export default function Player({ api, scenario, resume }) {
  // 이어보기면 그 쓰레드의 마지막 단계·담은 상품·완료 상태를 복원한다
  const resumeThread = resume ? (api.threads || []).find((t) => t.id === resume.threadId) : null
  const [stageIdx, setStageIdx] = useState(() => {
    if (!resume) return 0
    const i = STAGES.findIndex((s) => s.key === resume.stage)
    return i >= 0 ? i : 0
  })
  const [query, setQuery] = useState(scenario.query || '')
  const [answers, setAnswers] = useState({})
  const [cart, setCart] = useState(() => (resumeThread ? [...(resumeThread.cart || [])] : []))
  const [excludedProfile, setExcludedProfile] = useState([]) // 이번 회차에서 뺀 프로필 항목
  const [keyword, setKeyword] = useState(null) // 점선 밑줄 키워드 클릭 → 설명 모달
  const [completed, setCompleted] = useState(() => (resumeThread ? resumeThread.status === 'completed' : false))
  const [threadOrigin, setThreadOrigin] = useState(null) // 쓰레드 히스토리 패널 (null=닫힘)

  const stage = STAGES[stageIdx]

  /* 단계별 스크롤 기억 (세션 메모리, 저장 안 함):
     처음 여는 단계는 맨 위에서, 다시 돌아온 단계는 떠날 때 위치에서 열린다 */
  const scrollMemRef = useRef({})
  const goStage = (idx) => {
    if (idx === stageIdx) return
    scrollMemRef.current[stage.key] = window.scrollY
    setStageIdx(idx)
  }
  useEffect(() => {
    const saved = scrollMemRef.current[STAGES[stageIdx].key]
    const y = saved != null ? saved : 0
    window.scrollTo(0, y)
    if (y > 0) {
      // 이미지 로딩 등으로 페이지가 잠깐 짧을 때 클램프되는 것 보정
      const t = setTimeout(() => window.scrollTo(0, y), 150)
      return () => clearTimeout(t)
    }
  }, [stageIdx])
  /* 숨김 처리된 컴포넌트는 실행에서 제외 */
  const items = useMemo(
    () => sortByPosition(scenario.stages[stage.key] || []).filter((it) => !it.hidden),
    [scenario, stage.key]
  )

  /* 처음부터 다시 체험 */
  const restart = () => {
    scrollMemRef.current = {}
    setStageIdx(0)
    setAnswers({})
    setExcludedProfile([])
    setCart([])
    setCompleted(false)
    setQuery(scenario.query || '')
    window.scrollTo(0, 0)
    api.showToast('처음부터 다시 시작해요.')
  }

  /* 쓰레드 기록 — 설문 진입(마운트) 시 생성되고, 단계 이동/담기/완료 때마다 갱신.
     이어보기(resume)면 새로 만들지 않고 같은 id로 이어서 기록한다 */
  const threadIdRef = useRef(resume ? resume.threadId : uid())
  const startedAtRef = useRef((resumeThread && resumeThread.startedAt) || new Date().toISOString())
  useEffect(() => {
    api.recordThread({
      id: threadIdRef.current,
      scenarioId: scenario.id,
      title: scenario.title,
      chip: scenario.chip,
      color: scenario.color,
      stage: stage.key,
      stageLabel: stage.label,
      cart,
      status: completed ? 'completed' : 'ongoing',
      startedAt: startedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx, cart, completed])
  /* 실행 화면은 전역 뷰어 기기 폭의 모바일 프레임으로 고정 (좌상단 컨트롤로 조절) */
  const viewer = DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS.find((d) => d.key === 'iphone-15') || DEVICE_PRESETS[0]

  const next = () => goStage(Math.min(STAGES.length - 1, stageIdx + 1))
  const prev = () => goStage(Math.max(0, stageIdx - 1))

  /* 프로필(고정 설문 정보): 설문 단계의 프로필 요약 패널 컴포넌트가 숨긴 항목 제외 */
  const profileItems = visibleProfileItems(api.profile, scenario)
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
      setCompleted(true)
      api.showToast('시나리오 체험 완료! 홈으로 돌아갑니다. 🎉')
      setTimeout(api.goHome, 900)
    },
    /* 키워드 설명 모달 */
    showKeyword: (word) => {
      const hit = (api.keywords || []).find((k) => k.word === word)
      setKeyword({ word, desc: hit?.desc, points: hit?.points })
    },
    /* 외부 콘텐츠(영상/게시글) 클릭 목업 */
    openExternal: (label) => {
      api.showToast(`${label}(으)로 이동하는 목업이에요.`)
    },
    /* 프로필 요약 패널 / 설문 요약 패널 컴포넌트용 */
    excludedProfile,
    toggleProfileItem,
    summary: {
      profile: includedProfile,
      questions: questions.map((q) => ({ q: q.props.question, a: answerText(q) })),
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
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={(origin) => setThreadOrigin((v) => (v ? null : origin || 'right'))}
      />
      <StudioFab label="이 시나리오 편집" onClick={() => api.openBuilder(scenario.id)} />
      <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />

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
              onClick={() => goStage(i)}
            >
              <span className="sb-player-stepper__dot">{i + 1}</span>
              <span className="sb-player-stepper__label">{s.label}</span>
            </button>
          </React.Fragment>
        ))}
      </nav>

      <section className="sb-player min-h-screen relative z-10">
        <div className="sb-phone sb-phone--player" style={{ width: viewer.w }}>
        <div className="sb-player__head">
          <div className="sb-player__head-row">
            <p className="sb-eyebrow">#{scenario.chip} 칩으로 진입 · 탐색 완료</p>
            <button type="button" className="sb-player-restart" onClick={restart} title="응답을 초기화하고 처음부터">
              ↺ 처음부터
            </button>
          </div>
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
            <div
              key={it.id}
              className="sb-player__item"
              style={{ maxWidth: it.w, height: it.h || undefined, overflow: it.h ? 'hidden' : undefined }}
            >
              {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile })}
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
        </div>
      </section>

      {/* 쇼핑 쓰레드 히스토리 패널 — 햄버거 버튼 위치에서 등장 */}
      <ThreadPanel api={api} open={!!threadOrigin} origin={threadOrigin || 'right'} onClose={() => setThreadOrigin(null)} />

      {/* 키워드 설명 모달 (원본 keyword-detail 스타일 재사용) */}
      {keyword && (
        <div className="keyword-detail-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="keyword-detail-modal__backdrop"
            aria-label="키워드 설명 닫기"
            onClick={() => setKeyword(null)}
          />
          <article className="keyword-detail-card">
            <div className="keyword-detail-card__head">
              <span>Keyword</span>
              <button type="button" className="keyword-detail-card__close" aria-label="닫기" onClick={() => setKeyword(null)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <h3>{keyword.word}</h3>
            <p>{keyword.desc || '아직 설명이 등록되지 않은 키워드예요. 탐색 페이지 편집기의 "키워드 사전"에서 추가할 수 있어요.'}</p>
            {keyword.points ? (
              <ul>
                {String(keyword.points).split(',').map((pt, i) => (
                  <li key={i}>{pt.trim()}</li>
                ))}
              </ul>
            ) : null}
          </article>
        </div>
      )}
    </>
  )
}
