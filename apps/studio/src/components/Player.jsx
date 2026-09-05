import React, { useEffect, useMemo, useRef, useState } from 'react'
import { stepInfoOfItem } from '../lib/cart.js'
import { STAGES, DEVICE_PRESETS, resolvePlanCase, uid, visibleProfileItems } from '../lib/store.js'
import { isQuestionType, renderItem } from '../lib/registry.jsx'
import BottomSheet from './ui/BottomSheet.jsx'
import { BgBlobs, FloatingBar, StudioFab, ViewerDeviceControl } from './Frame.jsx'
import ThreadPanel from './ThreadPanel.jsx'
import ProductDetailPanel from './ProductDetailPanel.jsx'

function defaultAnswersFor(scenario) {
  return Object.fromEntries(
    (scenario.stages.survey || [])
      .filter((item) => item.type === 'surveyQuestion' && item.props.defaultAnswer)
      .map((item) => [
        item.id,
        item.props.multi
          ? String(item.props.defaultAnswer).split(',').map((answer) => answer.trim()).filter(Boolean)
          : item.props.defaultAnswer,
      ])
  )
}

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
  const [answers, setAnswers] = useState(() =>
    resumeThread?.answers ? { ...resumeThread.answers } : defaultAnswersFor(scenario)
  )
  const [cart, setCart] = useState(() => (resumeThread ? [...(resumeThread.cart || [])] : []))
  const [excludedProfile, setExcludedProfile] = useState(() =>
    resumeThread ? [...(resumeThread.excludedProfile || [])] : []
  ) // 이번 회차에서 뺀 프로필 항목
  const [keyword, setKeyword] = useState(null) // 점선 밑줄 키워드 클릭 → 설명 모달
  const [productDetail, setProductDetail] = useState(null) // 상품 상세보기 사이드 패널 (null=닫힘)
  const [completed, setCompleted] = useState(() => (resumeThread ? resumeThread.status === 'completed' : false))
  const [threadOrigin, setThreadOrigin] = useState(null) // 쓰레드 히스토리 패널 (null=닫힘)
  const [qStep, setQStep] = useState(0) // 설문은 질문 하나씩 — 지금 보여줄 질문 인덱스

  const stage = STAGES[stageIdx]

  /* 단계별 스크롤 기억 (세션 메모리, 저장 안 함):
     처음 여는 단계는 맨 위에서, 다시 돌아온 단계는 떠날 때 위치에서 열린다 */
  const scrollMemRef = useRef({})
  const goStage = (idx) => {
    if (idx === stageIdx) return
    scrollMemRef.current[stage.key] = window.scrollY
    setStageIdx(idx)
    setQStep(0)
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
  /* 설문 답 조합으로 위에서부터 첫 번째 일치 계획 케이스를 선택한다.
     일치 항목이 없으면 isFallback 기본 계획 케이스가 선택된다. */
  const matchedPlanCase = useMemo(
    () => resolvePlanCase(scenario, answers),
    [scenario, answers]
  )

  /* 숨김·컨테이너 자식 제외한 최상위만 배열 순서대로 스택 렌더 (자식은 컨테이너가 렌더) */
  const stageItems = stage.key === 'plan'
    ? (matchedPlanCase?.items || [])
    : (scenario.stages[stage.key] || [])
  const items = useMemo(
    () => stageItems.filter((it) => !it.hidden && !it.parentId),
    [stageItems]
  )
  /* 설문은 질문을 한 화면에 하나씩 보여준다 — 질문이 아닌 항목(헤더·프로필 패널 등)은
     매 화면에 그대로 남고, 질문형만 qStep 인덱스의 하나로 걸러진다 */
  const stepQuestions = useMemo(() => items.filter((it) => isQuestionType(it.type)), [items])
  const step = stepQuestions.length ? Math.min(qStep, stepQuestions.length - 1) : 0
  const visibleItems = useMemo(() => {
    if (stage.key !== 'survey' || stepQuestions.length === 0) return items
    const current = stepQuestions[step]
    return items.filter((it) => !isQuestionType(it.type) || it.id === current.id)
  }, [items, stepQuestions, step, stage.key])
  /* 화면 꽉 채우기(질문 fillScreen, 기본 켜짐) — 보이는 질문이 남은 높이를 다 먹고 「다음」이 화면 맨 아래에
     붙는다(Figma BottomBar). 화면 헤더가 있으면 하단 내비(이전 질문·홈으로)는 헤더의 뒤로·홈이 같은 일을
     하므로 숨긴다 — 바닥에 붙은 버튼 밑에 또 버튼 줄이 깔리지 않게 */
  const fillActive = stage.key === 'survey' && stepQuestions.length > 0 && stepQuestions[step].props?.fillScreen !== false
  const navHidden = fillActive && visibleItems.some((it) => it.type === 'screenHeader')

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
      planCaseId: matchedPlanCase?.id,
      planCaseName: matchedPlanCase?.name,
      answers,
      excludedProfile,
      cart,
      status: completed ? 'completed' : 'ongoing',
      startedAt: startedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageIdx, answers, excludedProfile, cart, completed, matchedPlanCase?.id])
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

  const questions = (scenario.stages.survey || []).filter((it) => isQuestionType(it.type))
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
    /* 화면 헤더의 홈·뒤로 — 뒤로는 질문 → 단계 → 홈 순으로 한 칸씩 물러난다 */
    goHome: api.goHome,
    goBack: () => {
      if (stage.key === 'survey' && step > 0) setQStep(step - 1)
      else if (stageIdx > 0) prev()
      else api.goHome()
    },
    /* 질문 컴포넌트의 "다음" — 마지막 질문이면 다음 단계(계획)로 넘어간다 */
    nextQuestion: () => {
      if (step < stepQuestions.length - 1) {
        setQStep(step + 1)
      } else {
        next()
      }
    },
    cart, // 상품 카드가 "담기 / ✓담음"을 가르는 기준
    addToCart: (name, meta = {}) => {
      /* 카드 재료 + 소속 단계(카드 자리로 계산)까지 한 항목으로 — 쇼핑 쓰레드 패널의 썸네일·파트별 시트 재료 */
      const { itemId, ...rest } = meta
      const entry = { ...rest, name, ...stepInfoOfItem(stageItems, itemId) }
      setCart((prev) => [...prev, entry])
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
    /* 외부 콘텐츠(영상/게시글)는 http(s) URL만 새 탭으로 연다. */
    openExternal: (label, rawUrl) => {
      try {
        const url = new URL(String(rawUrl || '').trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
        window.open(url.href, '_blank', 'noopener,noreferrer')
        api.showToast(`${label}을(를) 새 탭에서 열었어요.`)
      } catch {
        api.showToast(`${label}의 링크 URL을 먼저 입력해주세요.`)
      }
    },
    /* 상품 상세보기 — 외부몰 페이지를 사이드 패널 iframe으로 (http(s) URL만) */
    openProduct: ({ name, mall, url: rawUrl }) => {
      try {
        const url = new URL(String(rawUrl || '').trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
        setProductDetail({ name, mall, url: url.href })
      } catch {
        api.showToast('상품 페이지 URL을 먼저 입력해주세요. (인스펙터의 "상품 페이지 URL")')
      }
    },
    /* 프로필 요약 패널 / 설문 요약 패널 컴포넌트용 */
    excludedProfile,
    toggleProfileItem,
    summary: {
      profile: includedProfile,
      questions: questions.map((q) => ({ q: q.props.question, a: answerText(q) })),
    },
  }

  return (
    <>
      <BgBlobs />
      <FloatingBar onList={(origin) => setThreadOrigin((v) => (v ? null : origin || 'right'))} />
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
              <span className="sb-player-stepper__label">
                {s.key === 'plan' && matchedPlanCase ? matchedPlanCase.name : s.label}
              </span>
            </button>
          </React.Fragment>
        ))}
      </nav>

      <section className={'sb-player min-h-screen relative z-10' + (fillActive ? ' sb-player--fill' : '')}>
        <div className="sb-phone sb-phone--player" style={{ width: viewer.w }}>
        <div className="sb-player__stack">
          {visibleItems.length === 0 && (
            <div className="sb-player__empty">
              이 단계에 배치된 컴포넌트가 없어요.<br />
              <button type="button" onClick={() => api.openBuilder(scenario.id)}>스튜디오에서 편집하기</button>
            </div>
          )}
          {visibleItems.map((it) => (
            <div key={it.id} className="sb-player__item">
              {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile, allItems: stageItems })}
            </div>
          ))}
        </div>

        {/* 하단 내비 — 설문에서는 질문 단위로 넘어가고, 마지막 질문에서만 다음 단계로 */}
        {!navHidden && (
        <div className="clean-survey-nav sb-player__nav">
          {stage.key === 'survey' && step > 0 ? (
            <button
              type="button"
              className="clean-survey-nav-btn clean-survey-nav-btn--ghost"
              onClick={() => setQStep(step - 1)}
            >
              이전 질문
            </button>
          ) : stageIdx > 0 ? (
            <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={prev}>
              이전 단계
            </button>
          ) : (
            <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={api.goHome}>
              홈으로
            </button>
          )}
          {/* 설문에서 앞으로 가는 버튼은 질문 컴포넌트 안에 있다 (진행 표시·질문·항목과 한 벌).
             질문이 하나도 없는 설문만 여기서 다음 단계로 넘어갈 길을 열어 준다 */}
          {stage.key === 'survey' && stepQuestions.length > 0 ? null : stageIdx < STAGES.length - 1 ? (
            <button type="button" className="clean-plan-submit" onClick={next}>
              맞춤 계획 확인하기
            </button>
          ) : (
            <button type="button" className="clean-plan-submit" onClick={playerApi.complete}>
              시나리오 완료
            </button>
          )}
        </div>
        )}

        </div>
      </section>

      {/* 쇼핑 쓰레드 히스토리 패널 — 햄버거 버튼 위치에서 등장 */}
      <ThreadPanel api={api} open={!!threadOrigin} origin={threadOrigin || 'right'} onClose={() => setThreadOrigin(null)} />

      {/* 상품 상세보기 사이드 패널 — 외부몰 페이지 iframe (모바일은 전체화면) */}
      <ProductDetailPanel product={productDetail} onClose={() => setProductDetail(null)} />

      {/* 키워드 설명 — 설문 날짜/사진 시트와 같은 바텀 시트 문법 */}
      {keyword && (
        <BottomSheet title={keyword.word} onClose={() => setKeyword(null)}>
          <div className="sb-keyword-sheet">
            <p>{keyword.desc || '아직 설명이 등록되지 않은 키워드예요. 탐색 페이지 편집기의 "키워드 사전"에서 추가할 수 있어요.'}</p>
            {keyword.points ? (
              <ul>
                {String(keyword.points).split(',').map((pt, i) => (
                  <li key={i}>{pt.trim()}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
