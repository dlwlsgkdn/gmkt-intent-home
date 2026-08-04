import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DEVICE_PRESETS, STAGES } from '../lib/store.js'
import { renderItem } from '../lib/registry.jsx'
import { fetchLiveThread, recordLiveEvent, sendLiveFeedback, startLiveThread, streamLivePlan, streamLiveSurvey } from '../lib/liveApi.js'
import { livePlanItems, liveSurveyItems } from '../lib/livePage.js'
import { BgBlobs, FloatingBar, ViewerDeviceControl } from './Frame.jsx'
import ThreadPanel from './ThreadPanel.jsx'
import ProductDetailPanel from './ProductDetailPanel.jsx'
import LiveFeedbackBubble, {
  buildLiveFeedbackPayload,
  emptyStageFeedback,
  hasLiveFeedbackContent,
  isLiveFeedbackTarget,
  liveFeedbackLabel,
  stageFeedbackFromWire,
  stageFeedbackSignature,
} from './LiveFeedback.jsx'

/*
 * 라이브 생성 체험 — 스튜디오 시나리오가 아니라 BFF(LLM)가 설문·계획을 실시간 생성한다.
 * 구분 원칙: 진입은 홈 자유 검색(칩 = 시나리오 체험), 화면에는 ✦ 배지가 상시,
 * 로딩은 SSE status + 스켈레톤(시나리오 체험엔 없는 생성 대기), 실패는 정직한 안내
 * (가짜 콘텐츠 금지 — 발행 칩 폴백은 자동 강등이 아니라 사용자 클릭으로).
 * 렌더 계층은 Player와 동일: 와이어 페이지를 livePage.js로 아이템에 투영해 레지스트리 재사용.
 */

/* 답변 맵 → 와이어 형식. 계획 스냅샷 키(planKey)와 생성 요청 본문이 반드시 같은 코드로
   만들어져야 한다 — 서버가 돌려준 answers 원문으로 키를 만들면 직렬화 차이 때문에
   무변경 답변이 "바뀜"으로 오판돼 이어보기 후 단계 이동만 해도 계획을 다시 생성한다 */
function wireFromAnswers(questions, answersMap) {
  return questions
    .map((q) => {
      const a = answersMap[q.id]
      const choices = Array.isArray(a) ? a.filter(Boolean) : a != null && String(a).length > 0 ? [a] : []
      return { questionId: q.id, choices }
    })
    .filter((entry) => entry.choices.length > 0)
}

/* 생성 대기 스켈레톤 — 라이브 전용 연출. 시나리오 체험과 "다르게 느껴지는" 것이 목적이다 */
function LiveSkeleton({ message }) {
  return (
    <div className="sb-live-loading" role="status" aria-live="polite">
      <p className="sb-live-status">
        <span className="sb-live-status__spark" aria-hidden="true">✦</span>
        {message || '생성하고 있어요…'}
      </p>
      <div className="sb-live-skel sb-live-skel--title" />
      <div className="sb-live-skel" />
      <div className="sb-live-skel sb-live-skel--tall" />
      <div className="sb-live-skel" />
    </div>
  )
}

/* 부분 스트리밍 꼬리 — 도착한 컴포넌트 아래에서 나머지 생성이 진행 중임을 보여준다.
   몇 개가 더 올지는 모르므로 개수 흉내 없이 진행 표시 한 블록만 정직하게 둔다 */
function LiveTail({ message }) {
  return (
    <div className="sb-live-tail" role="status" aria-live="polite">
      <div className="sb-live-skel sb-live-skel--tall" />
      <p className="sb-live-status">
        <span className="sb-live-status__spark" aria-hidden="true">✦</span>
        {message || '이어서 생성하고 있어요…'}
      </p>
    </div>
  )
}

/* 실패 안내 — retryable이면 다시 시도, 발행 시나리오가 있으면 강등 제안(사용자 선택) */
function LiveError({ error, onRetry, fallbacks, onPlayScenario }) {
  return (
    <div className="sb-live-error">
      <p className="sb-live-error__title">생성하지 못했어요</p>
      <p className="sb-live-error__msg">{error.message}</p>
      {error.retryable && (
        <button type="button" className="sb-btn sb-btn--primary" onClick={onRetry}>다시 시도</button>
      )}
      {fallbacks.length > 0 && (
        <div className="sb-live-error__fallback">
          <p>대신 스튜디오에서 만든 시나리오로 체험해볼 수 있어요.</p>
          <div className="sb-live-error__chips">
            {fallbacks.map((s) => (
              <button key={s.id} type="button" className="suggestion-tag sb-chip-scenario" onClick={() => onPlayScenario(s.id)}>
                #{s.chip}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LivePlayer({ api, query, resumeThreadId }) {
  const [threadId, setThreadId] = useState(resumeThreadId || null)
  const [liveQuery, setLiveQuery] = useState(query || '')
  const [surveyPage, setSurveyPage] = useState(null)
  const [planPage, setPlanPage] = useState(null)
  const [planKey, setPlanKey] = useState(null) // 계획을 만든 시점의 답변 스냅샷 (변경 감지)
  const [stageKey, setStageKey] = useState('survey')
  const [loading, setLoading] = useState(null) // null | { step: 'start'|'survey'|'plan', message }
  // 생성 중 부분 페이지 (컴포넌트 단위 스트리밍) — 설문 { intro?, questions[] } | 계획 { headline?, summary?, sections[] }.
  // 미리보기 전용: 확정은 언제나 result(전체 페이지)이고, 도착 즉시 이 상태는 버린다
  const [partial, setPartial] = useState(null)
  const [error, setError] = useState(null) // null | { step, code, message, retryable }
  const [answers, setAnswers] = useState({})
  const [excludedProfile, setExcludedProfile] = useState([])
  const [cart, setCart] = useState([])
  const [completed, setCompleted] = useState(false)
  const [keyword, setKeyword] = useState(null)
  const [productDetail, setProductDetail] = useState(null) // 상품 상세보기 사이드 패널 (null=닫힘)
  const [threadOrigin, setThreadOrigin] = useState(null)
  const [reselecting, setReselecting] = useState(false) // "설문 다시 선택" 확인 후 잠금 해제 상태 — 새 계획 생성 시 다시 잠김
  const [reselectConfirm, setReselectConfirm] = useState(false) // 재선택 확인 다이얼로그
  /* 피드백(평가) — 단계별 { review, components }. 서버에는 action 스텝(type='feedback')으로
     남고("피드백 저장" 1회 = 제출 1회), 이어보기는 단계별 최신 제출을 복원한다 */
  const [fbMode, setFbMode] = useState(false)
  const [feedback, setFeedback] = useState({ survey: emptyStageFeedback(), plan: emptyStageFeedback() })
  const [fbSending, setFbSending] = useState(false)
  const fbSavedRef = useRef({ survey: null, plan: null }) // 마지막 저장(또는 복원) 시그니처 — 미전송 감지
  /* 이어보기면 워크스페이스 기록의 시작 시각을 보존한다 (Player와 같은 규칙) */
  const startedAtRef = useRef(
    (resumeThreadId && (api.threads || []).find((t) => t.id === resumeThreadId)?.startedAt) || new Date().toISOString()
  )
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  const profileItems = ((api.profile && api.profile.items) || []).filter((it) => it.label && it.label.trim())
  const includedProfile = profileItems.filter((it) => !excludedProfile.includes(it.label))
  const profileWire = () => includedProfile.map((it) => ({ label: it.label, value: String(it.value || '') }))

  const questions = (surveyPage && surveyPage.questions) || []
  const answersWire = () => wireFromAnswers(questions, answers)

  const generateSurvey = (id) => {
    setError(null)
    setPartial(null)
    setLoading({ step: 'survey', message: '질문을 구성하고 있어요…' })
    streamLiveSurvey(id, { profile: profileWire() }, {
      onStatus: (message) => { if (!cancelledRef.current) setLoading((prev) => ({ ...(prev || { step: 'survey' }), message })) },
      /* 부분 스트리밍 — 자라는 질문이 같은 index로 반복 도착한다 (토큰 단위 미리보기 → 완성본) */
      onHead: (head) => {
        if (!cancelledRef.current) setPartial((prev) => ({ questions: [], ...(prev || {}), ...head }))
      },
      onQuestion: (question, index) => {
        if (cancelledRef.current) return
        setPartial((prev) => {
          const next = { ...(prev || {}), questions: [...((prev && prev.questions) || [])] }
          next.questions[index] = question // 서버가 건너뛴 index는 빈 슬롯 — 투영 전에 걸러낸다
          return next
        })
      },
      onResult: (page) => {
        if (cancelledRef.current) return
        setSurveyPage(page)
        setPartial(null)
        setLoading(null)
        setStageKey('survey')
      },
      onError: (e) => {
        if (cancelledRef.current) return
        setPartial(null)
        setLoading(null)
        setError({ step: 'survey', code: e.code, message: e.message, retryable: e.retryable })
      },
    })
  }

  const generatePlan = () => {
    const wire = answersWire()
    if (wire.length === 0) {
      api.showToast('질문에 하나 이상 답해주세요.')
      return
    }
    setError(null)
    setPartial(null)
    setLoading({ step: 'plan', message: '카탈로그와 웹을 살펴 계획을 세우고 있어요…' })
    window.scrollTo(0, 0) // 스트리밍이 위에서부터 채워지므로 시작 시점에 올려 둔다
    streamLivePlan(threadId, { answers: wire, profile: profileWire() }, {
      onStatus: (message) => { if (!cancelledRef.current) setLoading((prev) => ({ ...(prev || { step: 'plan' }), message })) },
      /* 부분 스트리밍 — 머리(제목·요약)부터, 섹션은 자라는 채로 같은 index에 반복 도착한다 */
      onHead: (patch) => {
        if (!cancelledRef.current) setPartial((prev) => ({ sections: [], ...(prev || {}), ...patch }))
      },
      onSection: (section, index) => {
        if (cancelledRef.current) return
        setPartial((prev) => {
          const next = { ...(prev || {}), sections: [...((prev && prev.sections) || [])] }
          next.sections[index] = section // 서버가 드롭한 index는 빈 슬롯 — 투영 전에 걸러낸다
          return next
        })
      },
      onResult: (page) => {
        if (cancelledRef.current) return
        setPlanPage(page)
        setPlanKey(JSON.stringify(wire))
        setReselecting(false) // 새 계획이 만들어졌으니 설문을 다시 잠근다
        // 계획이 새로 만들어지면 이전 계획의 컴포넌트 평가는 대상이 사라진 것 — 로컬만 비운다
        // (서버의 이전 제출은 로그로 남고, 다음 저장이 최신 유효본이 된다)
        setFeedback((prev) => ({ ...prev, plan: emptyStageFeedback() }))
        fbSavedRef.current.plan = null
        setPartial(null)
        setLoading(null)
        setStageKey('plan')
        window.scrollTo(0, 0)
      },
      onError: (e) => {
        if (cancelledRef.current) return
        setPartial(null)
        setLoading(null)
        setError({ step: 'plan', code: e.code, message: e.message, retryable: e.retryable })
      },
    })
  }

  /* 마운트 1회: 새 검색이면 쓰레드 시작 → 설문 생성, 이어보기면 서버 기록 복원.
     "새로 생성"은 api.playLive의 runId 리마운트가 재실행을 만든다 */
  useEffect(() => {
    const run = async () => {
      if (resumeThreadId) {
        setLoading({ step: 'start', message: '이어볼 내용을 불러오고 있어요…' })
        try {
          const t = await fetchLiveThread(resumeThreadId)
          if (cancelledRef.current) return
          const restoredQuery = (t.source && t.source.query) || t.title || ''
          if (restoredQuery) setLiveQuery(restoredQuery)
          if (t.survey) setSurveyPage(t.survey)
          if (Array.isArray(t.answers) && t.survey) {
            const map = {}
            for (const entry of t.answers) {
              const q = t.survey.questions.find((question) => question.id === entry.questionId)
              map[entry.questionId] = q && q.multi ? entry.choices : entry.choices[0]
            }
            setAnswers(map)
            /* 키는 서버 원문이 아니라 로컬 재구성과 같은 경로로 — 위 wireFromAnswers 주석 참고 */
            if (t.plan) setPlanKey(JSON.stringify(wireFromAnswers(t.survey.questions, map)))
          }
          if (t.plan) setPlanPage(t.plan)
          if (t.feedback) {
            const restored = {
              survey: stageFeedbackFromWire(t.feedback.survey),
              plan: stageFeedbackFromWire(t.feedback.plan),
            }
            setFeedback(restored)
            fbSavedRef.current = {
              survey: t.feedback.survey ? stageFeedbackSignature(restored.survey) : null,
              plan: t.feedback.plan ? stageFeedbackSignature(restored.plan) : null,
            }
          }
          setCompleted(t.status === 'done')
          setLoading(null)
          setStageKey(t.plan ? 'plan' : 'survey')
          if (!t.survey) generateSurvey(resumeThreadId)
        } catch (e) {
          if (cancelledRef.current) return
          setLoading(null)
          setError({ step: 'start', code: e.code || 'internal', message: e.message, retryable: e.retryable !== false })
        }
        return
      }
      setLoading({ step: 'start', message: '쓰레드를 시작하고 있어요…' })
      try {
        const { threadId: id } = await startLiveThread({ query: liveQuery, title: liveQuery, profile: profileWire() })
        if (cancelledRef.current) return
        setThreadId(id)
        generateSurvey(id)
      } catch (e) {
        if (cancelledRef.current) return
        setLoading(null)
        setError({ step: 'start', code: e.code || 'internal', message: e.message, retryable: e.retryable !== false })
      }
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 워크스페이스 쓰레드 기록 — Player와 같은 upsert 흐름, live 마커로 구분한다.
     threadId(스노우플레이크)가 나온 뒤부터 단계 이동/답변/담기/완료마다 갱신 */
  useEffect(() => {
    if (!threadId) return
    api.recordThread({
      id: threadId,
      live: true,
      scenarioId: null,
      title: liveQuery || 'AI 실시간 생성',
      chip: 'AI',
      color: null,
      query: liveQuery,
      stage: stageKey,
      stageLabel: stageKey === 'plan' ? '계획' : '설문',
      answers,
      excludedProfile,
      cart,
      status: completed ? 'completed' : 'ongoing',
      startedAt: startedAtRef.current,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, stageKey, answers, excludedProfile, cart, completed])

  const answerText = (q) => {
    const a = answers[q.id]
    if (a == null || (Array.isArray(a) && a.length === 0)) return '아무거나'
    return Array.isArray(a) ? a.join(', ') : a
  }

  const toggleProfileItem = (label) => {
    setExcludedProfile((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  }

  const playerApi = {
    query: liveQuery,
    setQuery: setLiveQuery,
    submitQuery: () => {},
    answers,
    setAnswer: (itemId, value) => setAnswers((prev) => ({ ...prev, [itemId]: value })),
    addToCart: (name) => {
      setCart((prev) => [...prev, name])
      api.showToast(`"${name}" 을(를) 쓰레드에 담았어요.`)
      if (threadId) recordLiveEvent(threadId, 'cartAdd', { name })
    },
    complete: () => {
      setCompleted(true)
      if (threadId) recordLiveEvent(threadId, 'complete')
      api.showToast('AI 생성 체험 완료! 홈으로 돌아갑니다. 🎉')
      setTimeout(api.goHome, 900)
    },
    showKeyword: (word) => {
      const hit = (api.keywords || []).find((k) => k.word === word)
      setKeyword({ word, desc: hit?.desc, points: hit?.points })
    },
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
    /* 상품 상세보기 — 카탈로그에 URL이 있으면 사이드 패널 iframe, 없으면 정직한 안내 */
    openProduct: ({ name, mall, url: rawUrl }) => {
      try {
        const url = new URL(String(rawUrl || '').trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
        setProductDetail({ name, mall, url: url.href })
        if (threadId) recordLiveEvent(threadId, 'productOpen', { name })
      } catch {
        api.showToast('이 상품은 연결된 상세 페이지가 아직 없어요.')
      }
    },
    excludedProfile,
    toggleProfileItem,
    summary: {
      profile: includedProfile,
      questions: questions.map((q) => ({ q: q.question, a: answerText(q) })),
    },
  }

  /* 계획이 만들어진 설문은 잠근다 — 재선택은 확인 다이얼로그를 거쳐서만 */
  const surveyLocked = !!planPage && !reselecting
  const surveyItems = useMemo(
    () =>
      surveyPage
        ? liveSurveyItems(surveyPage).map((it) =>
            it.type === 'surveyQuestion' ? { ...it, props: { ...it.props, locked: surveyLocked } } : it
          )
        : [],
    [surveyPage, surveyLocked]
  )
  const planItems = useMemo(() => (planPage ? livePlanItems(planPage) : []), [planPage])
  const allItems = stageKey === 'plan' ? planItems : surveyItems
  const items = allItems.filter((it) => !it.parentId)

  /* 생성 중 부분 페이지 투영 — 최종과 같은 livePage 투영을 그대로 쓴다 (아이템 id가 인덱스
     기반이라 result 확정 때 React가 기존 컴포넌트를 재사용한다). 서버가 검증 실패·드롭으로
     건너뛴 인덱스는 빈 슬롯이므로 걸러낸다.
     선(先)렌더: 클라이언트가 이미 아는 컴포넌트는 partial 도착 전(검색·사고 구간)에도 그린다 —
     계획은 설문 요약 패널(답변·프로필은 FE 소유), 설문은 프로필 패널. LLM 산출물인
     제목/인트로는 도착 전엔 감춰서 빈 껍데기·기본 문구가 잠깐 보이는 일을 막는다 */
  const partialAllItems = useMemo(() => {
    if (!loading) return []
    if (loading.step === 'plan') {
      const headline = (partial && partial.headline) || ''
      const items = livePlanItems({
        headline,
        summary: (partial && partial.summary) || '',
        // 희소 배열 그대로 — 2단계 생성에서 상품 섹션이 뼈대 섹션 "사이"(자리 인덱스)로
        // 나중에 끼어든다. forEach는 빈 슬롯을 건너뛰고 인덱스를 보존하므로 id도 안정적이다
        sections: (partial && partial.sections) || [],
      })
      return headline ? items : items.filter((it) => it.id !== 'live-plan-title')
    }
    if (loading.step === 'survey') {
      const intro = (partial && partial.intro) || ''
      const items = liveSurveyItems({
        intro,
        questions: ((partial && partial.questions) || []).filter(Boolean),
      })
      return intro ? items : items.filter((it) => it.id !== 'live-survey-intro')
    }
    return [] // step 'start'(쓰레드 시작·이어보기 로드)는 그릴 재료가 없다 — 전체 스켈레톤
  }, [loading, partial])
  const partialItems = partialAllItems.filter((it) => !it.parentId)

  /* 스테퍼 표시는 생성 중엔 생성 대상 단계를 따른다 (계획 스트리밍 중엔 계획 강조) */
  const displayStageKey = loading ? (loading.step === 'plan' ? 'plan' : 'survey') : stageKey
  const stageIdx = STAGES.findIndex((s) => s.key === displayStageKey)
  const viewer = DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS[0]
  const answeredCount = questions.filter((q) => answers[q.id] != null && String(answers[q.id]).length > 0).length
  const planStale = planPage && planKey !== JSON.stringify(answersWire())

  /* 피드백(평가) — 현재 단계의 상태와 미전송 여부. 저장은 명시적 버튼 한 번 = 제출 한 번 */
  const stageFb = feedback[stageKey] || emptyStageFeedback()
  const patchStageFb = (updater) =>
    setFeedback((prev) => ({ ...prev, [stageKey]: updater(prev[stageKey] || emptyStageFeedback()) }))
  const setComponentFb = (id, patch) =>
    patchStageFb((st) => ({
      ...st,
      components: { ...st.components, [id]: { ...(st.components[id] || { score: null, feedback: '' }), ...patch } },
    }))
  const setReviewFb = (patch) => patchStageFb((st) => ({ ...st, review: { ...st.review, ...patch } }))
  const fbPayload = buildLiveFeedbackPayload(stageKey, stageFb, allItems)
  const fbHasContent = hasLiveFeedbackContent(fbPayload)
  const fbDirty =
    stageFeedbackSignature(stageFb) !== (fbSavedRef.current[stageKey] ?? stageFeedbackSignature(emptyStageFeedback()))
  const fbAvailable = !loading && !error && (stageKey === 'plan' ? !!planPage : !!surveyPage)

  const submitFeedback = async () => {
    if (!threadId || fbSending) return
    if (!fbHasContent) {
      api.showToast('별점을 남기거나 코멘트를 적어주세요.')
      return
    }
    setFbSending(true)
    try {
      await sendLiveFeedback(threadId, fbPayload)
      if (cancelledRef.current) return
      fbSavedRef.current[stageKey] = stageFeedbackSignature(stageFb)
      api.showToast('피드백을 남겼어요. 소중한 평가 고마워요! 🙏')
    } catch (e) {
      if (cancelledRef.current) return
      api.showToast(`피드백 저장에 실패했어요 — ${e.message}`)
    } finally {
      if (!cancelledRef.current) setFbSending(false)
    }
  }

  /* 설문 → 계획: 이미 만든 계획이 있으면 다시 생성하지 않고 그대로 연다.
     답이 바뀐 상태의 재생성은 명시적 요청(설문 하단 확인 버튼·계획 화면 안내 바)으로만 —
     스테퍼 이동(regenerate 없음)은 어떤 경우에도 LLM을 다시 부르지 않는다 */
  const goPlan = (opts = {}) => {
    if (planPage && !(planStale && opts.regenerate)) {
      setStageKey('plan')
      window.scrollTo(0, 0)
      return
    }
    generatePlan()
  }

  const goStage = (idx) => {
    const target = STAGES[idx]
    if (!target || target.key === stageKey || loading) return
    if (target.key === 'plan') goPlan()
    else {
      setStageKey('survey')
      window.scrollTo(0, 0)
    }
  }

  const retry = () => {
    if (!error) return
    if (error.step === 'start') api.playLive(liveQuery)
    else if (error.step === 'survey') generateSurvey(threadId)
    else generatePlan()
  }

  const fallbacks = api.scenarios.filter((s) => s.status === 'published').slice(0, 3)

  return (
    <>
      <BgBlobs />
      <FloatingBar
        onHome={api.goHome}
        onMy={() => api.showToast('마이 페이지는 프로토타입에서 준비 중이에요.')}
        onList={(origin) => setThreadOrigin((v) => (v ? null : origin || 'right'))}
      />
      <ViewerDeviceControl deviceKey={api.viewerDevice} onChange={api.setViewerDevice} />

      {/* 단계 스테퍼 — 시나리오 플레이어와 같은 골격 */}
      <nav className="sb-player-stepper" aria-label="라이브 생성 단계">
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

      <section className="sb-player sb-player--live min-h-screen relative z-10">
        <div className="sb-phone sb-phone--player" style={{ width: viewer.w }}>
          <div className="sb-player__head">
            <div className="sb-player__head-row">
              {/* 상시 모드 배지 — 이 체험이 실시간 생성임을 저니 내내 보여준다 */}
              <p className="sb-eyebrow sb-live-eyebrow">
                <span className="sb-live-eyebrow__spark" aria-hidden="true">✦</span>
                AI 실시간 생성{loading ? ' · 생성 중' : ''}
              </p>
              <div className="sb-player__head-actions">
                <button
                  type="button"
                  className={'sb-player-restart sb-live-fb-toggle' + (fbMode ? ' is-on' : '')}
                  title="생성된 페이지에 별점과 코멘트를 남겨요 — 저장하면 쓰레드 기록에 함께 남아요"
                  disabled={!fbAvailable}
                  onClick={() => setFbMode((v) => !v)}
                >
                  💬 평가{fbMode ? ' 닫기' : ''}
                </button>
                <button
                  type="button"
                  className="sb-player-restart"
                  title="같은 검색어로 새 쓰레드를 시작해 처음부터 다시 생성해요"
                  disabled={!liveQuery || !!loading}
                  onClick={() => api.playLive(liveQuery)}
                >
                  ↺ 새로 생성
                </button>
              </div>
            </div>
            <h2>{liveQuery || 'AI 실시간 생성 체험'}</h2>
            {stageKey === 'survey' && questions.length > 0 && !loading && !error && (
              <div className="clean-survey-progress sb-player__progress" aria-label="설문 진행률">
                <div className="clean-survey-progress__meta">
                  <span>{answeredCount} / {questions.length}</span>
                </div>
                <div className="clean-survey-progress__track">
                  <div
                    className="clean-survey-progress__fill"
                    style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {error ? (
            <LiveError error={error} onRetry={retry} fallbacks={fallbacks} onPlayScenario={api.playScenario} />
          ) : loading ? (
            partialItems.length === 0 ? (
              <LiveSkeleton message={loading.message} />
            ) : (
              /* 컴포넌트 단위 스트리밍 — 도착한 컴포넌트부터 실제 렌더, 아래엔 진행 꼬리 */
              <>
                <div className="sb-player__stack">
                  {partialItems.map((it) => (
                    <div key={it.id} className="sb-player__item">
                      {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile, allItems: partialAllItems })}
                    </div>
                  ))}
                </div>
                <LiveTail message={loading.message} />
              </>
            )
          ) : (
            <>
              {stageKey === 'plan' && planStale && (
                <div className="sb-live-stale">
                  <span>설문 답변이 바뀌었어요. 이 계획은 이전 답변 기준이에요.</span>
                  <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={generatePlan}>
                    ✦ 계획 다시 생성
                  </button>
                </div>
              )}
              {stageKey === 'survey' && surveyLocked && (
                <div className="sb-live-stale">
                  <span>계획을 만든 설문이라 답변이 잠겨 있어요.</span>
                  <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={() => setReselectConfirm(true)}>
                    설문 다시 선택
                  </button>
                </div>
              )}
              <div className="sb-player__stack">
                {items.map((it) => (
                  <div key={it.id} className="sb-player__item">
                    {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile, allItems })}
                    {fbMode && isLiveFeedbackTarget(it) && (
                      <LiveFeedbackBubble
                        label={liveFeedbackLabel(it)}
                        value={stageFb.components[it.id]}
                        onChange={(patch) => setComponentFb(it.id, patch)}
                      />
                    )}
                  </div>
                ))}
              </div>
              {fbMode && (
                <div className="sb-live-fb-panel">
                  <LiveFeedbackBubble overall label="페이지 전체" value={stageFb.review} onChange={setReviewFb} />
                  <div className="sb-live-fb-panel__actions">
                    <span className="sb-live-fb-panel__hint">
                      {!fbHasContent
                        ? '컴포넌트마다 별점·코멘트를 남길 수 있어요'
                        : fbDirty
                          ? '아직 저장하지 않은 평가가 있어요'
                          : '평가가 쓰레드 기록에 저장됐어요'}
                    </span>
                    <button
                      type="button"
                      className="sb-btn sb-btn--primary sb-btn--small"
                      disabled={fbSending || !fbDirty}
                      onClick={submitFeedback}
                    >
                      {fbSending ? '저장 중…' : '피드백 저장'}
                    </button>
                  </div>
                </div>
              )}
              <div className="clean-survey-nav sb-player__nav">
                {stageKey === 'plan' ? (
                  <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={() => goStage(0)}>
                    이전 단계
                  </button>
                ) : (
                  <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={api.goHome}>
                    홈으로
                  </button>
                )}
                {stageKey === 'plan' ? (
                  <button type="button" className="clean-plan-submit" onClick={playerApi.complete}>
                    체험 완료
                  </button>
                ) : (
                  <button
                    type="button"
                    className="clean-plan-submit"
                    onClick={() => goPlan({ regenerate: true })}
                    disabled={!surveyPage}
                  >
                    {planPage && planStale ? '✦ 바뀐 답변으로 계획 다시 생성' : '맞춤 계획 확인하기'}
                  </button>
                )}
              </div>
            </>
          )}

          {cart.length > 0 && !loading && <p className="sb-player__cart">🧺 담은 상품 {cart.length}개</p>}
        </div>
      </section>

      <ThreadPanel api={api} open={!!threadOrigin} origin={threadOrigin || 'right'} onClose={() => setThreadOrigin(null)} />

      {/* 상품 상세보기 사이드 패널 — 외부몰 페이지 iframe (모바일은 전체화면) */}
      <ProductDetailPanel product={productDetail} onClose={() => setProductDetail(null)} />

      {/* 설문 재선택 확인 — 잠금 해제는 이 다이얼로그를 거쳐서만 */}
      {reselectConfirm && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReselectConfirm(false)
          }}
        >
          <section className="sb-llm-dialog sb-json-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-live-reselect-title">
            <div className="sb-json-dialog__body">
              <div className="sb-json-dialog__head">
                <h2 id="sb-live-reselect-title" className="sb-json-dialog__title">설문을 다시 선택할까요?</h2>
                <button type="button" className="sb-icon-btn" onClick={() => setReselectConfirm(false)} aria-label="닫기">×</button>
              </div>
              <p className="sb-json-dialog__note">
                잠금을 풀고 답변을 바꿀 수 있어요. 지금 계획은 그대로 유지되고,
                바뀐 답변으로 새 계획을 만들려면 "✦ 계획 다시 생성"을 눌러야 해요.
              </p>
              <div className="sb-live-reselect__actions">
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setReselectConfirm(false)}>취소</button>
                <button
                  type="button"
                  className="sb-btn sb-btn--primary"
                  onClick={() => {
                    setReselecting(true)
                    setReselectConfirm(false)
                  }}
                >
                  다시 선택하기
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* 키워드 설명 모달 (Player와 동일한 원본 스타일) */}
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
