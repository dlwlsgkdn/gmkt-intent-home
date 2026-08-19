import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DEVICE_PRESETS, STAGES } from '../lib/store.js'
import { isQuestionType, renderItem } from '../lib/registry.jsx'
import BottomSheet from './ui/BottomSheet.jsx'
import { fetchLiveThread, recordLiveEvent, renderLiveLook, sendLiveFeedback, startLiveThread, streamLivePlan, streamLiveSurvey } from '../lib/liveApi.js'
import { PHOTO_ANSWER, isPhotoValue, livePlanItems, liveSurveyItems } from '../lib/livePage.js'
import { composeMakeup, toPhotoDataUrl } from '../lib/makeupComposite.js'
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
/* 설문은 질문을 한 화면에 하나씩 — 비질문 항목(헤더·프로필 패널)은 매 화면에 남는다.
   확정 렌더와 생성 중 미리보기가 반드시 같은 규칙을 써야 한다: 미리보기만 도착한 질문을
   전부 쌓으면 2번 질문이 1번 밑에 그려지다가 확정되는 순간 사라진다 */
function pageQuestions(list, cursor) {
  const questions = list.filter((it) => isQuestionType(it.type))
  if (questions.length === 0) return list
  const current = questions[Math.min(cursor, questions.length - 1)]
  return list.filter((it) => !isQuestionType(it.type) || it.id === current.id)
}

function wireFromAnswers(questions, answersMap) {
  return questions
    .map((q) => {
      const a = answersMap[q.id]
      // 사진 답은 표식만 보낸다 — 원본(데이터 URL)은 기기에 남는다 (livePage PHOTO_ANSWER 주석)
      if (q.kind === 'photo') return { questionId: q.id, choices: a ? [PHOTO_ANSWER] : [] }
      const choices = Array.isArray(a) ? a.filter(Boolean) : a != null && String(a).length > 0 ? [a] : []
      return { questionId: q.id, choices }
    })
    .filter((entry) => entry.choices.length > 0)
}

/* 올린 얼굴 사진의 기기 보관 — 서버로 보내지 않는 값이라, 이어보기로 돌아왔을 때 계획의
   가상 메이크업 결과를 다시 그리려면 여기 남은 것이 유일한 재료다. 쓰레드별로 최근 몇 건만
   두고(한 건 수십 KB), 저장 실패(용량 초과 등)는 체험을 막지 않는다 — 보관은 편의다 */
const PHOTO_STORE_KEY = 'ddak-live-photos-v1'
const PHOTO_STORE_LIMIT = 5

function readPhotoStore() {
  try {
    return JSON.parse(localStorage.getItem(PHOTO_STORE_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function savePhotoStore(threadId, photos) {
  if (!threadId) return
  try {
    const store = readPhotoStore()
    if (Object.keys(photos).length === 0) delete store[threadId]
    else store[threadId] = photos
    // 오래된 쓰레드부터 버린다 — id가 스노우플레이크라 문자열 정렬 = 시간순
    const keys = Object.keys(store).sort()
    for (const stale of keys.slice(0, Math.max(0, keys.length - PHOTO_STORE_LIMIT))) delete store[stale]
    localStorage.setItem(PHOTO_STORE_KEY, JSON.stringify(store))
  } catch {
    /* 용량 초과 등 — 보관 실패는 조용히 넘어간다 */
  }
}

/** 사진 질문의 답 중 실제 이미지만 추린다 (표식·빈 값 제외) */
function photoAnswersOf(questions, answersMap) {
  const photos = {}
  for (const q of questions) {
    if (q.kind === 'photo' && isPhotoValue(answersMap[q.id])) photos[q.id] = answersMap[q.id]
  }
  return photos
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

/* 검색 결과가 아직 안 채운 자리(상품·콘텐츠) — 뼈대 조기 확정 뒤 페이지 안에서 자리만
   로딩 카드로 남는다. 몇 개가 올지 모르니 카드 흉내 두 장 + 진행 문구만 정직하게 */
function LivePendingSlot({ message }) {
  return (
    <div className="sb-live-slot" role="status" aria-live="polite">
      <p className="sb-live-status">
        <span className="sb-live-status__spark" aria-hidden="true">✦</span>
        {message || '추천 상품과 콘텐츠를 찾고 있어요…'}
      </p>
      <div className="sb-live-slot__cards" aria-hidden="true">
        <div className="sb-live-skel sb-live-skel--card" />
        <div className="sb-live-skel sb-live-skel--card" />
      </div>
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
  const [qStep, setQStep] = useState(0) // 설문은 질문 하나씩 — 지금 보여줄 질문 인덱스
  const [planPage, setPlanPage] = useState(null)
  const [planKey, setPlanKey] = useState(null) // 계획을 만든 시점의 답변 스냅샷 (변경 감지)
  const [stageKey, setStageKey] = useState('survey')
  const [loading, setLoading] = useState(null) // null | { step: 'start'|'survey'|'plan', message }
  // 생성 중 부분 페이지 (컴포넌트 단위 스트리밍) — 설문 { intro?, questions[] } | 계획 { headline?, summary?, sections[] }.
  // 미리보기 전용: 확정은 언제나 result(전체 페이지)이고, 도착 즉시 이 상태는 버린다
  const [partial, setPartial] = useState(null)
  /* 계획 조기 확정(skeleton 이벤트) 뒤 아직 검색 결과가 안 채운 자리 인덱스 — 비어 있지
     않으면 페이지는 확정 렌더지만 상품·콘텐츠가 비동기로 들어오는 중이다 */
  const [pendingSlots, setPendingSlots] = useState([])
  /* 메이크업이 올라간 AFTER 이미지 — 얼굴 랜드마크 합성은 모델 로드가 걸려 늦게 온다.
     그동안 화면은 tone 프리셋으로 이미 그려져 있고, 도착하면 조용히 갈아끼운다 */
  const [lookAfter, setLookAfter] = useState(null)
  /* 정밀 렌더(외부 이미지 편집 모델) — 'idle' | 'confirm'(확인 다이얼로그) | 'loading' | 'done'.
     기기 합성과 달리 사진이 서버로 나가므로 확인을 거쳐 사용자가 누를 때만 실행한다 */
  const [lookRender, setLookRender] = useState('idle')
  const preciseRef = useRef(false) // 정밀 렌더가 적용된 뒤에는 늦게 끝난 기기 합성이 덮지 않게
  const [pendingMessage, setPendingMessage] = useState(null) // 자리 로딩 카드에 띄울 진행 문구 (검색 status)
  const planRunRef = useRef(0) // 계획 생성 실행 토큰 — 조기 확정 뒤 겹칠 수 있는 옛 스트림 이벤트를 무시한다
  const skeletonDoneRef = useRef(false) // 이번 계획 생성에서 skeleton(조기 확정)을 받았는지
  const lateIdsRef = useRef(new Set()) // 조기 확정 뒤 늦게 채워진 섹션 아이템 id — 등장 페이드인용
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
  const [fbActiveId, setFbActiveId] = useState(null) // 선택된 말풍선 — '__overall__' | 아이템 id
  const [fbMeta, setFbMeta] = useState(null) // 워크스페이스 쓰레드 기록용 마커 { at, survey?: {score}, plan?: {score} }
  const fbSavedRef = useRef({ survey: null, plan: null }) // 마지막 저장(또는 복원) 시그니처 — 미전송 감지
  const phoneRef = useRef(null)
  const fbRailRef = useRef(null)
  const fbAnchorRefs = useRef({}) // 최상위 아이템 id → 페이지의 래퍼 엘리먼트
  const fbBubbleRefs = useRef({}) // 말풍선 id → 엘리먼트
  /* 이어보기면 워크스페이스 기록의 시작 시각을 보존한다 (Player와 같은 규칙) */
  const startedAtRef = useRef(
    (resumeThreadId && (api.threads || []).find((t) => t.id === resumeThreadId)?.startedAt) || new Date().toISOString()
  )
  const cancelledRef = useRef(false)
  useEffect(() => () => { cancelledRef.current = true }, [])

  /* 스트리밍 표시는 도착 즉시 렌더다 — 별도 타이핑 페이싱(구 liveReveal 틱커) 없이 SSE
     도착분(~120ms 스로틀 덩어리)을 그대로 partial에 쓴다. 부드러움은 kText revealFade의
     글자 단위 마운트 페이드(sb-live-ch, 260ms)가 담당한다: 덩어리로 도착해도 새 글자들이
     겹치며 떠올라 끊김 없이 이어져 보이고, 화면이 실제 토큰 속도보다 늦는 일이 없다.
     (모션 최소화 사용자는 base.css 전역 규칙이 페이드를 걷어낸다) */
  const pushPartial = (updater) => setPartial((prev) => updater(prev))

  const profileItems = ((api.profile && api.profile.items) || []).filter((it) => it.label && it.label.trim())
  const includedProfile = profileItems.filter((it) => !excludedProfile.includes(it.label))
  const profileWire = () => includedProfile.map((it) => ({ label: it.label, value: String(it.value || '') }))

  const questions = (surveyPage && surveyPage.questions) || []
  const answersWire = () => wireFromAnswers(questions, answers)
  /* 계획의 가상 메이크업 결과가 쓰는 사진 — 설문에서 고른 첫 사진 답 (기기 안에서만 오간다) */
  const livePhotos = photoAnswersOf(questions, answers)
  const livePhoto = Object.values(livePhotos)[0] || ''
  /* 워크스페이스 쓰레드 기록에는 사진 원본을 남기지 않는다 — 기록은 localStorage에 저장되고
     서버로도 동기화되는 값이라, 와이어와 같은 표식으로 바꿔 싣는다 */
  const answersForRecord = () => {
    const out = { ...answers }
    for (const q of questions) if (q.kind === 'photo' && out[q.id] != null) out[q.id] = PHOTO_ANSWER
    return out
  }

  const generateSurvey = (id) => {
    setError(null)
    setPartial(null)
    setLoading({ step: 'survey', message: '질문을 구성하고 있어요…' })
    setQStep(0) // 새 설문 생성 = 첫 질문부터
    streamLiveSurvey(id, { profile: profileWire() }, {
      onStatus: (message) => { if (!cancelledRef.current) setLoading((prev) => ({ ...(prev || { step: 'survey' }), message })) },
      /* 부분 스트리밍 — 자라는 질문이 같은 index로 반복 도착한다 (토큰 단위 미리보기 → 완성본).
         partial엔 직접 쓰지 않고 reveal target에만 — 화면 반영은 문자 공개 틱커가 맡는다 */
      onHead: (head) => {
        if (!cancelledRef.current) pushPartial((prev) => ({ questions: [], ...(prev || {}), ...head }))
      },
      onQuestion: (question, index) => {
        if (cancelledRef.current) return
        pushPartial((prev) => {
          const next = { ...(prev || {}), questions: [...((prev && prev.questions) || [])] }
          next.questions[index] = question // 서버가 건너뛴 index는 빈 슬롯 — 투영 전에 걸러낸다
          return next
        })
      },
      onResult: (page) => {
        if (cancelledRef.current) return
        setSurveyPage(page)
        setQStep(0)
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

  /* opts.feedback(ThreadStageFeedback, stage='plan')이 있으면 피드백 반영 재생성 —
     BFF가 직전 계획·피드백을 프롬프트에 실어 지적된 상품을 웹 검색 대안으로 교체한다.
     흐름: 뼈대 스트리밍(partial) → skeleton 이벤트에서 **조기 확정**(페이지 확정 렌더 +
     자리는 로딩 카드) → section 이벤트가 상품·콘텐츠를 비동기로 채움 → result(권위)로 마감 */
  const generatePlan = (opts = {}) => {
    if (pendingSlots.length > 0) {
      // 직전 계획의 검색 스트림이 아직 여는 중 — 서버 저장 경합을 피하려 마감까지 기다린다
      api.showToast('아직 추천 상품·콘텐츠를 채우는 중이에요. 잠시 후 다시 시도해주세요.')
      return
    }
    const wire = answersWire()
    if (wire.length === 0) {
      api.showToast('질문에 하나 이상 답해주세요.')
      return
    }
    const run = ++planRunRef.current
    const active = () => !cancelledRef.current && planRunRef.current === run
    skeletonDoneRef.current = false
    lateIdsRef.current = new Set()
    setPendingSlots([])
    setPendingMessage(null)
    setError(null)
    setPartial(null)
    setLoading({
      step: 'plan',
      message: opts.feedback ? '피드백을 반영해 계획을 다시 세우고 있어요…' : '카탈로그와 웹을 살펴 계획을 세우고 있어요…',
    })
    window.scrollTo(0, 0) // 스트리밍이 위에서부터 채워지므로 시작 시점에 올려 둔다
    streamLivePlan(threadId, {
      answers: wire,
      profile: profileWire(),
      ...(opts.feedback ? { feedback: opts.feedback } : {}),
    }, {
      onStatus: (message) => {
        if (!active()) return
        // 조기 확정 뒤의 status(검색 진행 등)는 로딩 화면이 아니라 자리 로딩 카드 문구로
        if (skeletonDoneRef.current) setPendingMessage(message)
        else setLoading((prev) => ({ ...(prev || { step: 'plan' }), message }))
      },
      /* 부분 스트리밍 — 머리(제목·요약)부터, 섹션은 자라는 채로 같은 index에 반복 도착한다.
         partial엔 직접 쓰지 않고 reveal target에만 — 화면 반영은 문자 공개 틱커가 맡는다 */
      onHead: (patch) => {
        if (active() && !skeletonDoneRef.current) pushPartial((prev) => ({ sections: [], ...(prev || {}), ...patch }))
      },
      /* 뼈대 조기 확정 — 텍스트는 전부 왔다: 계획을 확정 렌더로 전환하고(잠금·planKey·평가
         초기화 포함), 상품·콘텐츠 자리(pending)는 로딩 카드로 남겨 비동기로 채운다 */
      onSkeleton: (page, pending) => {
        if (!active()) return
        skeletonDoneRef.current = true
        setPlanPage(page) // sections의 자리 인덱스는 null — livePlanItems가 pending 카드로 그린다
        setPendingSlots(pending)
        setPlanKey(JSON.stringify(wire))
        setReselecting(false) // 새 계획이 만들어졌으니 설문을 다시 잠근다
        // 계획이 새로 만들어지면 이전 계획의 컴포넌트 평가는 대상이 사라진 것 — 로컬만 비운다
        setFeedback((prev) => ({ ...prev, plan: emptyStageFeedback() }))
        fbSavedRef.current.plan = null
        setPartial(null)
        setLoading(null)
        setStageKey('plan')
        window.scrollTo(0, 0)
      },
      onSection: (section, index, final = true) => {
        if (!active()) return
        if (skeletonDoneRef.current) {
          // 조기 확정 뒤 도착한 상품·콘텐츠 — 확정 페이지의 자리를 직접 채운다 (등장 페이드인).
          // 항목 단위 증분(final=false)은 같은 index로 반복 도착하며 섹션을 그대로 덮어쓴다
          lateIdsRef.current.add(`live-plan-s${index}`)
          lateIdsRef.current.add(`live-plan-s${index}-reason`)
          setPlanPage((prev) => {
            if (!prev) return prev
            const sections = [...(prev.sections || [])]
            sections[index] = section
            return { ...prev, sections }
          })
          // pending은 재생성 게이트(저장 경합 방지) — 자라는 중에는 유지하고 최종본에서만 푼다.
          // 로딩 카드는 섹션이 채워지는 즉시 사라진다 (livePlanItems가 null 자리에만 그린다)
          if (final) setPendingSlots((prev) => prev.filter((i) => i !== index))
          return
        }
        pushPartial((prev) => {
          const next = { ...(prev || {}), sections: [...((prev && prev.sections) || [])] }
          next.sections[index] = section // 서버가 드롭한 index는 빈 슬롯 — 투영 전에 걸러낸다
          return next
        })
      },
      onResult: (page) => {
        if (!active()) return
        if (skeletonDoneRef.current) {
          // 조기 확정 흐름의 마감 — 최종본(권위)으로 갈아끼우고 남은 자리를 정리한다
          // (검색 단계가 못 채운 자리는 최종본에서 빠진다 — 빈 섹션을 보여주지 않는 서버 규칙)
          setPlanPage(page)
          setPendingSlots([])
          setPendingMessage(null)
          return
        }
        // 구버전 BFF(skeleton 이벤트 없음) — 기존 확정 흐름 그대로
        setPlanPage(page)
        setPlanKey(JSON.stringify(wire))
        setReselecting(false)
        setFeedback((prev) => ({ ...prev, plan: emptyStageFeedback() }))
        fbSavedRef.current.plan = null
        setPartial(null)
        setLoading(null)
        setStageKey('plan')
        window.scrollTo(0, 0)
      },
      onError: (e) => {
        if (!active()) return
        if (skeletonDoneRef.current) {
          // 계획(텍스트)은 이미 확정 — 검색 스트림만 끊긴 것. 페이지를 지우지 않고 정직하게 알린다
          setPendingSlots([])
          setPendingMessage(null)
          api.showToast(`추천 상품·콘텐츠를 마저 받지 못했어요 — ${e.message}`)
          return
        }
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
          if (t.survey) { setSurveyPage(t.survey); setQStep(0) }
          if (Array.isArray(t.answers) && t.survey) {
            const map = {}
            for (const entry of t.answers) {
              const q = t.survey.questions.find((question) => question.id === entry.questionId)
              map[entry.questionId] = q && q.multi ? entry.choices : entry.choices[0]
            }
            /* 사진 답은 서버에 표식만 있다 — 기기에 남겨 둔 원본으로 되돌려 놓아야
               설문 미리보기와 계획의 가상 메이크업 결과가 그대로 이어진다 */
            const storedPhotos = readPhotoStore()[resumeThreadId] || {}
            for (const q of t.survey.questions) {
              if (q.kind === 'photo' && storedPhotos[q.id]) map[q.id] = storedPhotos[q.id]
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
            /* 쓰레드 기록 마커도 복원 — "평가한 쓰레드" 패널 필터의 원천 */
            const meta = {}
            if (t.feedback.survey) meta.survey = { score: t.feedback.survey.review?.score ?? null }
            if (t.feedback.plan) meta.plan = { score: t.feedback.plan.review?.score ?? null }
            if (Object.keys(meta).length > 0) {
              meta.at = t.feedback.plan?.at || t.feedback.survey?.at || null
              setFbMeta(meta)
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

  /* 고른 사진을 기기에 남긴다 — 서버로 가지 않는 값이라 이어보기의 유일한 복원 재료다 */
  useEffect(() => {
    // 설문이 오기 전(이어보기 로드 중)에는 손대지 않는다 — 빈 답으로 저장하면 복원 재료를 지운다
    if (!threadId || !surveyPage) return
    savePhotoStore(threadId, photoAnswersOf(surveyPage.questions || [], answers))
  }, [threadId, surveyPage, answers])

  /* 가상 메이크업 합성 — 계획에 룩 섹션이 있고 사진이 있을 때만. 실패(모델 미로드·얼굴
     미검출)는 null 유지 = tone 프리셋 렌더 그대로다 (향상 계층이라 체험을 막지 않는다) */
  const lookTone = ((planPage && planPage.sections) || []).find((s) => s && s.kind === 'look')?.tone || ''
  useEffect(() => {
    if (!lookTone || !livePhoto) {
      setLookAfter(null)
      return undefined
    }
    let cancelled = false
    setLookAfter(null) // 룩·사진이 바뀌면 이전 합성부터 내린다 (엉뚱한 얼굴이 남지 않게)
    preciseRef.current = false
    setLookRender('idle')
    composeMakeup(livePhoto, lookTone).then((url) => {
      // 정밀 렌더가 이미 적용됐으면 덮지 않는다 (기기 합성이 늦게 끝나는 경우)
      if (!cancelled && url && !preciseRef.current) setLookAfter(url)
    })
    return () => {
      cancelled = true
    }
  }, [lookTone, livePhoto])

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
      answers: answersForRecord(),
      excludedProfile,
      cart,
      status: completed ? 'completed' : 'ongoing',
      startedAt: startedAtRef.current,
      // 평가 마커 — 키 자체를 빼서(undefined 덮어쓰기 방지) 없던 기록의 마커를 지우지 않는다
      ...(fbMeta ? { feedback: fbMeta } : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, stageKey, answers, excludedProfile, cart, completed, fbMeta])

  const answerText = (q) => {
    const a = answers[q.id]
    if (a == null || (Array.isArray(a) && a.length === 0)) return '아무거나'
    if (q.kind === 'photo') return PHOTO_ANSWER // 데이터 URL을 요약 패널에 그대로 찍지 않는다
    return Array.isArray(a) ? a.join(', ') : a
  }

  const toggleProfileItem = (label) => {
    setExcludedProfile((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  }

  /* 정밀 렌더 실행 — 확인 다이얼로그에서 "보내기"를 누른 뒤에만 온다.
     실패해도 화면은 기기 합성을 그대로 유지하고 토스트로만 알린다 (부가 기능이라 체험을 막지 않는다) */
  const runLookRender = async () => {
    const look = ((planPage && planPage.sections) || []).find((s) => s && s.kind === 'look')
    if (!threadId || !livePhoto || !look) return
    setLookRender('loading')
    try {
      // 샘플 얼굴은 상대 URL이라 그대로 못 보낸다 — 계약(data URL)에 맞춰 변환한다
      const photo = await toPhotoDataUrl(livePhoto)
      if (!photo) throw new Error('사진을 읽지 못했어요. 다시 선택해 주세요.')
      const { image } = await renderLiveLook(threadId, {
        photo,
        tone: look.tone,
        title: look.title,
        points: look.points,
      })
      if (cancelledRef.current) return
      preciseRef.current = true
      setLookAfter(image)
      setLookRender('done')
    } catch (e) {
      if (cancelledRef.current) return
      setLookRender('idle')
      api.showToast(e.message)
    }
  }

  const playerApi = {
    query: liveQuery,
    setQuery: setLiveQuery,
    submitQuery: () => {},
    answers,
    setAnswer: (itemId, value) => setAnswers((prev) => ({ ...prev, [itemId]: value })),
    cart, // 상품 카드가 "담기 / ✓담음"을 가르는 기준
    /* 가상 메이크업 정밀 렌더 — beforeAfter 카드의 버튼이 부른다. 사진을 보내는 동작이라
       바로 실행하지 않고 확인 다이얼로그부터 연다 */
    lookRenderState: lookRender,
    renderLook: livePhoto ? () => setLookRender('confirm') : undefined,
    /* 화면 헤더의 홈·뒤로 — 뒤로는 질문 → 단계 → 홈 순으로 한 칸씩 물러난다 */
    goHome: api.goHome,
    goBack: () => {
      if (stageKey === 'survey' && qIndex > 0) setQStep(qIndex - 1)
      else if (stageKey === 'plan') goStage(0)
      else api.goHome()
    },
    /* 질문 컴포넌트의 "다음" — 마지막 질문이면 계획 생성으로 넘어간다 */
    nextQuestion: () => {
      if (qIndex < stepQuestions.length - 1) {
        setQStep(qIndex + 1)
      } else if (surveyPage) {
        goPlan({ regenerate: true })
      }
    },
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
  const planItems = useMemo(
    () =>
      planPage
        ? livePlanItems(planPage, {
            pendingSlots,
            query: liveQuery,
            photo: livePhoto,
            photoAfter: lookAfter,
            photoAfterPrecise: lookRender === 'done',
          })
        : [],
    [planPage, pendingSlots, liveQuery, livePhoto, lookAfter, lookRender]
  )
  const allItems = stageKey === 'plan' ? planItems : surveyItems
  const topItems = allItems.filter((it) => !it.parentId)
  const stepQuestions = topItems.filter((it) => isQuestionType(it.type))
  const qIndex = stepQuestions.length ? Math.min(qStep, stepQuestions.length - 1) : 0
  const items = stageKey === 'survey' ? pageQuestions(topItems, qStep) : topItems

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
      // 희소 배열 그대로 — 2단계 생성에서 상품 섹션이 뼈대 섹션 "사이"(자리 인덱스)로
      // 나중에 끼어든다. 인덱스가 보존되므로 id도 안정적이다
      const sections = (partial && partial.sections) || []
      /* 도착한 마지막 인덱스보다 앞의 빈 자리 = 상품·콘텐츠가 채울 자리가 확정된 곳.
         스트리밍 중에도 그 자리에 로딩 카드를 미리 세워, 뼈대가 확정되는 순간 카드가
         아래에서 제자리로 튀어 오르지 않게 한다 (id가 같아 그대로 이어진다) */
      const pendingPreview = []
      for (let i = 0; i < sections.length; i += 1) if (!sections[i]) pendingPreview.push(i)
      const items = livePlanItems({
        headline,
        summary: (partial && partial.summary) || '',
        sections,
      }, { query: liveQuery, pendingSlots: pendingPreview, photo: livePhoto })
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
  }, [loading, partial, livePhoto])
  /* 미리보기도 확정 렌더와 같은 한 화면 = 질문 하나 규칙을 따른다. allItems는 도착한 전체를
     그대로 넘겨서 진행 표시가 "1 / 2 → 1 / 3"으로 자라는 것을 보여준다 */
  const partialTopItems = partialAllItems.filter((it) => !it.parentId)
  const partialItems =
    loading && loading.step === 'survey' ? pageQuestions(partialTopItems, qStep) : partialTopItems

  /* 스테퍼 표시는 생성 중엔 생성 대상 단계를 따른다 (계획 스트리밍 중엔 계획 강조) */
  const displayStageKey = loading ? (loading.step === 'plan' ? 'plan' : 'survey') : stageKey
  const stageIdx = STAGES.findIndex((s) => s.key === displayStageKey)
  const viewer = DEVICE_PRESETS.find((d) => d.key === api.viewerDevice) || DEVICE_PRESETS[0]
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
  /* 화면 헤더 오른쪽 액션 — 옛 상단 크롬(평가·새로 생성)이 헤더로 들어왔다.
     playerApi 리터럴은 fbMode/fbAvailable보다 앞이라 여기서 뒤늦게 매단다 */
  playerApi.headerActions = [
    {
      key: 'feedback',
      icon: '💬',
      label: '평가',
      title: '생성된 페이지에 별점과 코멘트를 남겨요 — 저장하면 쓰레드 기록에 함께 남아요',
      active: fbMode,
      disabled: !fbAvailable,
      onClick: () => setFbMode((v) => !v),
    },
    {
      key: 'regen',
      icon: '↺',
      label: '새로 생성',
      title: '같은 검색어로 새 쓰레드를 시작해 처음부터 다시 생성해요',
      disabled: !liveQuery || !!loading,
      onClick: () => api.playLive(liveQuery),
    },
  ]

  const submitFeedback = async ({ quiet = false } = {}) => {
    if (!threadId || fbSending) return false
    if (!fbHasContent) {
      api.showToast('별점을 남기거나 코멘트를 적어주세요.')
      return false
    }
    setFbSending(true)
    try {
      await sendLiveFeedback(threadId, fbPayload)
      if (cancelledRef.current) return false
      fbSavedRef.current[stageKey] = stageFeedbackSignature(stageFb)
      /* 워크스페이스 쓰레드 기록에 평가 마커 — "평가한 쓰레드" 패널 필터·배지의 원천 */
      setFbMeta((prev) => ({
        ...(prev || {}),
        [stageKey]: { score: fbPayload.review.score },
        at: new Date().toISOString(),
      }))
      if (!quiet) api.showToast('피드백을 남겼어요. 소중한 평가 고마워요! 🙏')
      return true
    } catch (e) {
      if (cancelledRef.current) return false
      api.showToast(`피드백 저장에 실패했어요 — ${e.message}`)
      return false
    } finally {
      if (!cancelledRef.current) setFbSending(false)
    }
  }

  /* 피드백 반영 재생성 — 계획 단계 전용: 미전송분이 있으면 먼저 저장(제출 로그 유지)하고,
     같은 피드백을 계획 생성 요청에 실어 보낸다. 새 계획이 오면 기존 규칙대로 로컬 계획
     평가는 비워진다(대상 소멸) — 반영된 피드백은 서버 제출 로그에 남아 있다 */
  const regenerateWithFeedback = async () => {
    if (stageKey !== 'plan' || loading) return
    if (!fbHasContent) {
      api.showToast('반영할 피드백을 먼저 남겨주세요.')
      return
    }
    const payload = fbPayload
    if (fbDirty) {
      const saved = await submitFeedback({ quiet: true })
      if (!saved) return
    }
    setFbMode(false)
    generatePlan({ feedback: payload })
  }

  /* ── 말풍선 배치 — 평가 스튜디오와 같은 문법: 앵커(페이지 아이템)의 실제 렌더 높이에
     맞추고 겹치면 아래로 밀어 쌓는다. 전체 평가 말풍선이 맨 위. 좁은 화면(1100px 이하)은
     CSS가 일반 흐름으로 전환하므로 인라인 top을 걷어낸다. rAF만 쓰면 연속 렌더에서
     계속 취소돼 한 번도 실행 안 될 수 있어 매 렌더 동기 실행 + 다음 프레임 보정 */
  const fbTargets = fbAvailable ? items.filter(isLiveFeedbackTarget) : []
  const layoutFbBubbles = () => {
    const page = phoneRef.current
    const rail = fbRailRef.current
    if (!page || !rail) return
    const order = ['__overall__', ...fbTargets.map((it) => it.id)]
    if (window.matchMedia('(max-width: 1100px)').matches) {
      order.forEach((id) => {
        const bubble = fbBubbleRefs.current[id]
        if (bubble) bubble.style.top = ''
      })
      rail.style.height = ''
      return
    }
    const pageTop = page.getBoundingClientRect().top
    let cursor = 0
    order.forEach((id) => {
      const bubble = fbBubbleRefs.current[id]
      if (!bubble) return
      const anchor = id === '__overall__' ? null : fbAnchorRefs.current[id]
      const top = Math.max(anchor ? anchor.getBoundingClientRect().top - pageTop : 0, cursor)
      bubble.style.top = `${top}px`
      cursor = top + bubble.offsetHeight + 12
    })
    rail.style.height = `${Math.max(page.offsetHeight, cursor)}px`
  }
  const fbLayoutRef = useRef(layoutFbBubbles)
  fbLayoutRef.current = layoutFbBubbles
  useEffect(() => {
    if (!fbMode) return undefined
    fbLayoutRef.current()
    const raf = requestAnimationFrame(() => fbLayoutRef.current())
    return () => cancelAnimationFrame(raf)
  })
  useEffect(() => {
    if (!fbMode) return undefined
    const page = phoneRef.current
    if (!page) return undefined
    const run = () => fbLayoutRef.current()
    const observer = new ResizeObserver(run)
    observer.observe(page)
    window.addEventListener('resize', run)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', run)
    }
  }, [fbMode, stageKey])

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
      <FloatingBar onList={(origin) => setThreadOrigin((v) => (v ? null : origin || 'right'))} />
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
        <div className={'sb-live-annotate' + (fbMode && fbAvailable ? ' is-on' : '')}>
        <div className="sb-phone sb-phone--player" ref={phoneRef} style={{ width: viewer.w }}>
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
                    /* sb-live-item-enter — 마운트 1회 페이드인. id가 안정적이라(같은 index
                       재도착 = 같은 엘리먼트) 텍스트가 자라는 재렌더에는 다시 재생되지 않는다 */
                    <div key={it.id} className={'sb-player__item sb-live-item-enter' + (it.stepSub ? ' sb-player__item--stepsub' : '')}>
                      {/* revealFade — kText가 글자를 위치 고정 span으로 그려 새 글자만 페이드인 */}
                      {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile, allItems: partialAllItems, revealFade: true })}
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
                  <button type="button" className="sb-btn sb-btn--ai sb-btn--tiny" onClick={() => generatePlan()}>
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
                {items.map((it) => {
                  /* 검색 결과가 아직 안 채운 자리 — 레지스트리 밖 타입이라 여기서 직접 그린다 */
                  if (it.type === 'livePending') {
                    return (
                      <div key={it.id} className={'sb-player__item' + (it.stepSub ? ' sb-player__item--stepsub' : '')}>
                        <LivePendingSlot message={pendingMessage} />
                      </div>
                    )
                  }
                  const fbEntry = stageFb.components[it.id]
                  const noted = !!fbEntry && (fbEntry.score != null || (fbEntry.feedback || '').trim())
                  const isAnchor = fbMode && fbAvailable && isLiveFeedbackTarget(it)
                  return (
                    <div
                      key={it.id}
                      ref={(el) => { fbAnchorRefs.current[it.id] = el }}
                      className={
                        'sb-player__item'
                        + (it.stepSub ? ' sb-player__item--stepsub' : '')
                        + (lateIdsRef.current.has(it.id) ? ' sb-live-item-enter' : '')
                        + (isAnchor
                          ? ' sb-live-annotate__anchor'
                            + (fbActiveId === it.id ? ' is-active' : '')
                            + (noted ? ' is-noted' : '')
                          : '')
                      }
                    >
                      {renderItem(it, { mode: 'player', player: playerApi, profile: api.profile, allItems })}
                    </div>
                  )
                })}
              </div>
              <div className="clean-survey-nav sb-player__nav">
                {stageKey === 'survey' && qIndex > 0 ? (
                  <button
                    type="button"
                    className="clean-survey-nav-btn clean-survey-nav-btn--ghost"
                    onClick={() => setQStep(qIndex - 1)}
                  >
                    이전 질문
                  </button>
                ) : stageKey === 'plan' ? (
                  <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={() => goStage(0)}>
                    이전 단계
                  </button>
                ) : (
                  <button type="button" className="clean-survey-nav-btn clean-survey-nav-btn--ghost" onClick={api.goHome}>
                    홈으로
                  </button>
                )}
                {/* 설문에서 앞으로 가는 버튼은 질문 컴포넌트 안에 있다 (진행 표시·질문·항목과 한 벌) */}
                {stageKey === 'survey' && stepQuestions.length > 0 ? null : stageKey === 'plan' ? (
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

        {/* 평가 말풍선 레일 — 페이지 오른쪽, 점선으로 앵커와 연결 (평가 스튜디오와 같은 문법) */}
        {fbMode && fbAvailable && (
          <div className="sb-live-annotate__rail" ref={fbRailRef} aria-label="평가 말풍선">
            <LiveFeedbackBubble
              overall
              bubbleRef={(el) => { fbBubbleRefs.current.__overall__ = el }}
              active={fbActiveId === '__overall__'}
              onActivate={() => setFbActiveId('__overall__')}
              label="페이지 전체"
              value={stageFb.review}
              onChange={setReviewFb}
              foot={
                <div className="sb-live-bubble__actions">
                  <span>
                    {!fbHasContent
                      ? '컴포넌트마다 별점·코멘트를 남길 수 있어요'
                      : fbDirty
                        ? '아직 저장하지 않은 평가가 있어요'
                        : '평가가 쓰레드 기록에 저장됐어요'}
                  </span>
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary sb-btn--tiny"
                    disabled={fbSending || !fbDirty}
                    onClick={(event) => { event.stopPropagation(); submitFeedback() }}
                  >
                    {fbSending ? '저장 중…' : '피드백 저장'}
                  </button>
                  {stageKey === 'plan' && (
                    <button
                      type="button"
                      className="sb-btn sb-btn--ai sb-btn--tiny"
                      title="피드백을 저장하고, 반영한 새 계획을 생성해요 — 지적한 상품은 웹 검색으로 다른 상품을 찾아요"
                      disabled={fbSending || !fbHasContent}
                      onClick={(event) => { event.stopPropagation(); regenerateWithFeedback() }}
                    >
                      ✦ 반영해 다시 생성
                    </button>
                  )}
                </div>
              }
            />
            {fbTargets.map((it) => (
              <LiveFeedbackBubble
                key={it.id}
                bubbleRef={(el) => { fbBubbleRefs.current[it.id] = el }}
                active={fbActiveId === it.id}
                onActivate={() => {
                  setFbActiveId(it.id)
                  fbAnchorRefs.current[it.id]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }}
                label={liveFeedbackLabel(it)}
                value={stageFb.components[it.id]}
                onChange={(patch) => setComponentFb(it.id, patch)}
              />
            ))}
          </div>
        )}
        </div>
      </section>

      <ThreadPanel api={api} open={!!threadOrigin} origin={threadOrigin || 'right'} onClose={() => setThreadOrigin(null)} />

      {/* 상품 상세보기 사이드 패널 — 외부몰 페이지 iframe (모바일은 전체화면) */}
      <ProductDetailPanel product={productDetail} onClose={() => setProductDetail(null)} />

      {/* 설문 재선택 확인 — 잠금 해제는 이 다이얼로그를 거쳐서만 */}
      {lookRender === 'confirm' && (
        <div
          className="sb-llm-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLookRender('idle')
          }}
        >
          <section className="sb-llm-dialog sb-json-dialog" role="dialog" aria-modal="true" aria-labelledby="sb-live-render-title">
            <div className="sb-json-dialog__body">
              <div className="sb-json-dialog__head">
                <h2 id="sb-live-render-title" className="sb-json-dialog__title">사진을 보내 정밀 렌더를 만들까요?</h2>
                <button type="button" className="sb-icon-btn" onClick={() => setLookRender('idle')} aria-label="닫기">×</button>
              </div>
              {/* 기본 경로와 무엇이 다른지 한 문장으로 — 이 화면이 사진이 기기를 떠나는 유일한 지점이다 */}
              <p className="sb-json-dialog__note">
                지금 보이는 미리보기는 기기 안에서 만든 거예요. 정밀 렌더는 올린 사진을 외부 이미지 편집 모델로 보내
                실제로 메이크업을 올려 줍니다. 사진은 이번 요청에만 쓰이고, 쓰레드 기록에는 룩 색조·모델·소요 시간만 남아요.
              </p>
              <div className="sb-live-reselect__actions">
                <button type="button" className="sb-btn sb-btn--ghost" onClick={() => setLookRender('idle')}>취소</button>
                <button type="button" className="sb-btn sb-btn--ai" onClick={runLookRender}>✦ 사진 보내고 만들기</button>
              </div>
            </div>
          </section>
        </div>
      )}
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

      {/* 키워드 설명 — 설문 날짜/사진 시트와 같은 바텀 시트 문법 (Player와 동일) */}
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
