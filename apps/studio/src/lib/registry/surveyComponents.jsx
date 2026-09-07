import React from 'react'
import { splitList, splitOptions } from '../store.js'
import BottomSheet from '../../components/ui/BottomSheet.jsx'
import { ScrollTrack, isInteractionView, kText, questionPosition } from './support.jsx'

/* 선택지 목록 — "직접 입력" 선택지의 활성 상태만 지역 상태로 들고 있다.
   답변 자체는 언제나 ctx.player.answers[itemId] 한 곳에 남는다(빈 문자열 = 고른 뒤 미입력). */
function SurveyOptions({ p, ctx, opts, shape, isPlayer }) {
  const optionMains = opts.map((o) => o.main)
  const answer = isPlayer ? ctx.player.answers[ctx.itemId] : undefined
  const selectedSet = new Set(
    p.multi ? (Array.isArray(answer) ? answer : []) : answer != null ? [answer] : []
  )
  const typedValues = [...selectedSet].filter((v) => v !== '' && !optionMains.includes(v))
  const [customOpen, setCustomOpen] = React.useState(false)
  const customActive = !!p.customOption && (customOpen || typedValues.length > 0)
  const customText = typedValues[0] || ''

  const isList = shape === 'list'
  const maxPerRow = isList ? 1 : Math.max(1, Math.min(6, Number(p.maxPerRow) || 4))
  const horizontalScroll = !isList && p.horizontalScroll !== false
  const optionLayoutStyle = horizontalScroll
    ? { gridAutoColumns: `calc(${100 / maxPerRow}% - ${(8 * (maxPerRow - 1)) / maxPerRow}px)` }
    : { gridTemplateColumns: `repeat(${maxPerRow}, minmax(0, 1fr))` }

  const pick = (value) => {
    if (!isPlayer || p.locked) return
    if (p.multi) {
      const next = new Set(selectedSet)
      next.has(value) ? next.delete(value) : next.add(value)
      ctx.player.setAnswer(ctx.itemId, [...next])
    } else {
      ctx.player.setAnswer(ctx.itemId, value)
    }
  }

  const optionClass = (selected) =>
    isList
      ? 'sb-survey-option sb-survey-option--list' + (selected ? ' is-selected' : '')
      : `sb-survey-option sb-survey-option--${shape} info-card border-2 border-slate-100 transition-all bg-slate-50 hover:border-gmarket-blue text-center flex flex-col items-center justify-center gap-1` +
        (selected ? ' active-card ring-4 ring-blue-100' : '')

  return (
    <>
      <ScrollTrack
        interactive={horizontalScroll && isInteractionView(ctx)}
        className={
          'sb-survey-options' +
          (horizontalScroll ? ' sb-survey-options--scroll sb-scroll-hide' : ' sb-survey-options--grid')
        }
        style={optionLayoutStyle}
      >
        {opts.map((opt, i) => {
          const selected = selectedSet.has(opt.main)
          return (
            <button
              key={i}
              type="button"
              className={optionClass(selected)}
              aria-disabled={!!p.locked}
              aria-pressed={selected}
              onClick={() => {
                setCustomOpen(false)
                pick(opt.main)
              }}
            >
              <span className={'sb-survey-option__main' + (isList ? '' : ' text-sm font-semibold text-slate-800 whitespace-nowrap')}>{kText(opt.main, ctx)}</span>
              {opt.sub ? <span className={'sb-survey-option__sub' + (isList ? '' : ' text-[11px] font-normal text-slate-400 whitespace-nowrap')}>{kText(opt.sub, ctx)}</span> : null}
              {opt.desc ? <span className="sb-survey-option__desc">{kText(opt.desc, ctx)}</span> : null}
            </button>
          )
        })}
        {/* 직접 입력 선택지 — 고르면 같은 행 안에서 입력칸이 열린다 */}
        {p.customOption ? (
          <div
            className={
              'sb-survey-option sb-survey-option--list sb-survey-option--custom' +
              (customActive ? ' is-selected' : '')
            }
            role="button"
            tabIndex={0}
            aria-pressed={customActive}
            onClick={() => {
              if (customActive) return
              setCustomOpen(true)
              if (isPlayer && !p.locked && !p.multi) ctx.player.setAnswer(ctx.itemId, '')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setCustomOpen(true)
              }
            }}
          >
            <span className="sb-survey-option__main">{kText(p.customLabel, ctx, 'customLabel')}</span>
            {customActive ? (
              <input
                className="sb-survey-option__input"
                type="text"
                autoFocus={isPlayer}
                value={customText}
                placeholder={p.customPlaceholder || '직접 입력해주세요'}
                readOnly={!isPlayer || !!p.locked}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (!isPlayer || p.locked) return
                  const text = e.target.value
                  if (p.multi) {
                    const kept = [...selectedSet].filter((v) => optionMains.includes(v))
                    ctx.player.setAnswer(ctx.itemId, text ? [...kept, text] : kept)
                  } else {
                    ctx.player.setAnswer(ctx.itemId, text)
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </ScrollTrack>
    </>
  )
}

/* 기본 샘플 얼굴 — Figma 원본(2×2 시트)에서 잘라낸 627px 사진 (public/sample-faces).
   해상도가 중요하다: 이 값이 그대로 가상 메이크업의 입력이라, 옛 77px 썸네일로는 랜드마크가
   잡을 결도, 정밀 렌더가 보존할 이목구비도 남지 않았다 */
const DEFAULT_SAMPLE_FACES = [
  './sample-faces/face-1.jpg',
  './sample-faces/face-2.jpg',
  './sample-faces/face-3.jpg',
  './sample-faces/face-4.jpg',
]

/* 옛 썸네일 경로(face-N.png)를 고해상도 파일로 올려 준다. 고른 사진은 기기 보관(라이브 사진)·
   쓰레드 기록·시나리오 props에 **경로 문자열로** 남아 있어서, 파일명을 바꾸면 그 참조가 전부
   깨진다. 읽는 시점에 올려 주면 옛 기록도 새 사진으로 살아난다.
   (옛 png 파일 자체도 안전망으로 남겨 뒀다 — 여기서 못 잡는 참조까지 깨지지 않게) */
const LEGACY_SAMPLE_FACE = /^(\.\/|\/)?sample-faces\/face-([1-4])\.png$/
export function resolveSampleFace(url) {
  const m = LEGACY_SAMPLE_FACE.exec(String(url || ''))
  return m ? `./sample-faces/face-${m[2]}.jpg` : url
}

/* 올린 사진의 최대 변 길이 — 답은 상태·기기 보관(라이브 사진)·계획 화면 합성까지 따라다니므로
   원본(수 MB 데이터 URL)을 그대로 들고 다니지 않는다. 얼굴 미리보기엔 720px이면 충분하다 */
const MAX_PHOTO_EDGE = 720

/** 데이터 URL 축소 — 실패하면(캔버스 차단·디코드 실패) 원본을 그대로 넘긴다 */
function downscalePhoto(dataUrl, done) {
  const img = new Image()
  img.onload = () => {
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(img.width, img.height, 1))
    if (scale >= 1 && dataUrl.length < 400000) return done(dataUrl)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      done(canvas.toDataURL('image/jpeg', 0.82))
    } catch {
      done(dataUrl)
    }
  }
  img.onerror = () => done(dataUrl)
  img.src = dataUrl
}

/** 답 값이 그릴 수 있는 이미지인지 — 라이브 이어보기·관리 페이지 미리보기의 답은 사진 원본이
    아니라 "사진 제출됨" 표식이다 (원본은 기기에만 남는다). 그대로 img에 넣으면 깨진 이미지가 된다 */
const isPhotoImage = (value) => /^(data:image\/|https?:\/\/|\.{0,2}\/)/.test(String(value || ''))

/* 설문 아이콘 — Figma [PP1K] 카메라(2px 선)·앨범·샘플 얼굴·달력. 전부 currentColor 선화라 색은 CSS 가 정한다 */
const CameraIcon = ({ strokeWidth = 2 }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8h5.4L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
)
const AlbumIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 15.5l-4.6-4.6a1.5 1.5 0 0 0-2.1 0L6 18.5" />
  </svg>
)
const FaceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 18.2a6.5 6.5 0 0 1 11 0" />
  </svg>
)
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </svg>
)

/* 사진 질문 문구 기본값 — Figma UploadSection·PreviewSection·ModelSelectPanel 원문.
   라이브 투영 아이템은 이 키들을 싣지 않으므로(defaults 병합 없음) undefined 는 기본 문구, '' 는 숨김이다 */
const PHOTO_TEXT = {
  hint: '분석을 위해 눈, 코, 입이 가려지지 않은 정면이 좋아요',
  pickedTitle: '사진이 선택되었어요',
  pickedHint: '다른 사진을 선택하려면 사진 영역을 탭하세요',
  samplesTitle: '모델 얼굴 선택',
  samplesHint: '내 피부 타입에 가까운 가상 모델을 골라주세요',
}

/* 사진 업로드 질문의 동선 (Figma [PP1K] 사진 업로드 플로우): 드롭존 → 선택 옵션 바텀시트(카메라 바로 촬영 ·
   앨범에서 사진 선택 · 샘플 얼굴 선택) → 카메라·앨범 = 파일 선택 / 샘플 얼굴 = 가운데 "모델 얼굴 선택" 모달(2×2).
   고르면 드롭존이 미리보기(200×200 둥근 사진 + "사진이 선택되었어요")로 바뀌고 점선은 회색으로 가라앉는다 */
function PhotoPicker({ p, ctx, picked }) {
  const [sheet, setSheet] = React.useState(null) // null | 'options' | 'samples'
  const fileRef = React.useRef(null)
  const captureRef = React.useRef(null)
  const isPlayer = ctx.mode === 'player'
  const samples = (p.samples ? String(p.samples).split('\n') : DEFAULT_SAMPLE_FACES)
    .map((u) => resolveSampleFace(u.trim()))
    .filter(Boolean)
  // 문구: 지정값 → 기본 문구 → '' 이면 숨김
  const raw = (key) => (p[key] === undefined ? PHOTO_TEXT[key] : p[key])
  const text = (key) => (raw(key) ? kText(raw(key), ctx, key) : null)

  const choose = (url) => {
    if (isPlayer) ctx.player.setAnswer(ctx.itemId, url)
    setSheet(null)
  }
  const readFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // 같은 파일 다시 고를 수 있게
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => downscalePhoto(String(reader.result || ''), choose)
    reader.readAsDataURL(file)
  }

  return (
    <div className="sb-survey-photo">
      <button
        type="button"
        className={'sb-photo-drop' + (picked ? ' is-filled' : '')}
        onClick={() => { if (isPlayer) setSheet('options') }}
      >
        {picked && isPhotoImage(picked) ? (
          <>
            <img className="sb-photo-drop__preview" src={picked} alt={raw('pickedTitle') || '선택한 사진'} draggable={false} />
            {(raw('pickedTitle') || raw('pickedHint')) && (
              <span className="sb-photo-drop__text">
                {raw('pickedTitle') ? <span className="sb-photo-drop__label">{text('pickedTitle')}</span> : null}
                {raw('pickedHint') ? <span className="sb-photo-drop__hint">{text('pickedHint')}</span> : null}
              </span>
            )}
          </>
        ) : picked ? (
          /* 사진 원본 없이 제출 표식만 남은 경우 (이어보기·관리 페이지) — 답한 상태로만 보여준다 */
          <>
            <span className="sb-photo-drop__icon" aria-hidden="true">✓</span>
            <span className="sb-photo-drop__text">
              <span className="sb-photo-drop__label">{picked}</span>
            </span>
          </>
        ) : (
          <>
            {/* Figma 드롭존: 80px 연보라 원 안 32px 카메라 — 문구를 따로 넣은 경우만 글자로 */}
            <span className="sb-photo-drop__icon">
              {p.iconLabel && p.iconLabel !== '사진 아이콘' ? kText(p.iconLabel, ctx, 'iconLabel') : <CameraIcon />}
            </span>
            <span className="sb-photo-drop__text">
              <span className="sb-photo-drop__label">{kText(p.placeholder, ctx, 'placeholder')}</span>
              {raw('hint') ? <span className="sb-photo-drop__hint">{text('hint')}</span> : null}
            </span>
          </>
        )}
      </button>
      {/* 실제 파일 선택 — 카메라는 후면/전면 캡처 힌트만 다르다 */}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={readFile} />
      <input ref={captureRef} type="file" accept="image/*" capture="user" hidden onChange={readFile} />

      {sheet === 'options' && (
        <BottomSheet onClose={() => setSheet(null)}>
          <div className="sb-sheet__menu">
            <button type="button" onClick={() => captureRef.current?.click()}><CameraIcon strokeWidth={1.8} /> 카메라 바로 촬영</button>
            <button type="button" onClick={() => fileRef.current?.click()}><AlbumIcon /> 앨범에서 사진 선택</button>
            <button type="button" onClick={() => setSheet('samples')}><FaceIcon /> 샘플 얼굴 선택</button>
          </div>
        </BottomSheet>
      )}
      {sheet === 'samples' && (
        <BottomSheet variant="center" title={text('samplesTitle')} subtitle={text('samplesHint')} onClose={() => setSheet(null)}>
          <div className="sb-sheet__faces">
            {samples.map((url, i) => (
              <button
                type="button"
                key={i}
                className={'sb-sheet__face' + (picked === url ? ' is-selected' : '')}
                aria-pressed={picked === url}
                onClick={() => choose(url)}
              >
                <img src={url} alt={`샘플 얼굴 ${i + 1}`} draggable={false} />
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const pad2 = (n) => String(n).padStart(2, '0')
const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`
/* "2026-08-19" → "2026년 8월 19일 (수)" — 필드에 보여줄 문구 (Figma DateInputRow 는 요일까지 쓴다) */
function dateLabel(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일 (${WEEKDAYS[d.getDay()]})`
}

/* 달력 본체 — 월 이동 줄 + 요일 행(일요일 빨강, 밑줄) + 날짜 그리드. 시트 안에서도, 필드 아래 펼친 채(inline)로도 쓴다 */
function CalendarGrid({ view, shift, selected, onPick }) {
  const first = new Date(view.y, view.m, 1).getDay()
  const days = new Date(view.y, view.m + 1, 0).getDate()
  return (
    <>
      <div className="sb-cal__nav">
        <button type="button" aria-label="이전 달" onClick={() => shift(-1)}>‹</button>
        <strong>{view.y}년 {view.m + 1}월</strong>
        <button type="button" aria-label="다음 달" onClick={() => shift(1)}>›</button>
      </div>
      <div className="sb-cal__grid sb-cal__grid--week">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={'sb-cal__wd' + (i === 0 ? ' is-sun' : '')}>{w}</span>
        ))}
      </div>
      <div className="sb-cal__grid">
        {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1
          const iso = toISO(view.y, view.m, day)
          return (
            <button
              key={day}
              type="button"
              className={
                'sb-cal__day' +
                (iso === selected ? ' is-selected' : '') +
                ((first + i) % 7 === 0 ? ' is-sun' : '')
              }
              aria-pressed={iso === selected}
              onClick={() => onPick(iso)}
            >
              {day}
            </button>
          )
        })}
      </div>
    </>
  )
}

/* 날짜 질문의 동선 (Figma [PP1K] 날짜 입력): 필드(달력 아이콘 + 안내) → 달력 바텀 시트(제목 · 요일 · 그리드 · 「확인」)
   → 날짜 탭 = 임시 선택(보라 원), 「확인」이 답으로 굳히고 닫는다. calendarMode 'inline' 이면 시트 대신 필드 아래에
   달력을 펼쳐 둔다 — 캔버스에서도 보이는 달력 컴포넌트가 필요할 때 */
function DatePicker({ p, ctx, value }) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState('') // 시트 안에서 고른 날 — 「확인」을 눌러야 답이 된다 (Figma ConfirmButton)
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  const today = new Date()
  const [view, setView] = React.useState(() =>
    parsed ? { y: Number(parsed[1]), m: Number(parsed[2]) - 1 } : { y: today.getFullYear(), m: today.getMonth() }
  )
  const isPlayer = ctx.mode === 'player'
  const inline = p.calendarMode === 'inline'
  const shift = (delta) => {
    const next = new Date(view.y, view.m + delta, 1)
    setView({ y: next.getFullYear(), m: next.getMonth() })
  }
  const openSheet = () => {
    if (!isPlayer || inline) return
    setDraft(value || '')
    if (parsed) setView({ y: Number(parsed[1]), m: Number(parsed[2]) - 1 })
    setOpen(true)
  }
  const confirm = () => {
    if (draft && isPlayer) ctx.player.setAnswer(ctx.itemId, draft)
    setOpen(false)
  }
  return (
    <div className="sb-survey-date">
      <button
        type="button"
        className={'sb-date-field' + (value ? ' is-filled' : '')}
        onClick={openSheet}
      >
        <span className="sb-date-field__icon" aria-hidden="true"><CalendarIcon /></span>
        <span className="sb-date-field__value">
          {dateLabel(value) || kText(p.placeholder, ctx, 'placeholder')}
        </span>
      </button>

      {inline && (
        <div className="sb-cal sb-cal--inline">
          <CalendarGrid
            view={view}
            shift={shift}
            selected={value}
            onPick={(iso) => { if (isPlayer) ctx.player.setAnswer(ctx.itemId, iso) }}
          />
        </div>
      )}

      {open && (
        <BottomSheet title={p.sheetTitle || '날짜 선택'} onClose={() => setOpen(false)}>
          <div className="sb-cal">
            <CalendarGrid view={view} shift={shift} selected={draft} onPick={setDraft} />
            <button type="button" className="sb-cal__confirm" disabled={!draft} onClick={confirm}>
              {kText(p.confirmLabel || '확인', ctx, 'confirmLabel')}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  )
}

/* 설문 질문 한 화면의 공통 껍데기 — 진행 표시 + 질문 문구 + 항목 + 다음 버튼.
   Figma "설문" 섹션의 화면 한 장이 곧 이 컴포넌트 하나다. 질문형 3종(선택지·사진·날짜)이
   같은 껍데기를 쓰고 안쪽 입력부만 children으로 갈린다. */
const NAV_DEFAULTS = { nextLabel: '다음', submitLabel: '맞춤 계획 확인하기', fillScreen: true }
const NAV_FIELDS = [
  /* 화면 꽉 채우기 — 질문 카드가 남은 높이를 다 먹고 「다음」이 화면 맨 아래에 붙는다 (Figma 설문 화면의
     Body fill + BottomBar). 기본 켜짐: 옛 저장분처럼 값이 없으면 켜진 것으로 본다 (false 만 꺼짐) */
  { key: 'fillScreen', label: '화면 꽉 채우기 (「다음」을 화면 맨 아래에)', kind: 'toggle', defaultValue: true },
  { key: 'nextLabel', label: '다음 버튼 문구', kind: 'text' },
  { key: 'submitLabel', label: '마지막 질문일 때 버튼 문구', kind: 'text' },
]

function QuestionShell({ p, ctx, children, answered = true, foot = null }) {
  const { index, total } = questionPosition(ctx)
  const isLast = index >= total - 1
  const fieldKey = isLast ? 'submitLabel' : 'nextLabel'
  const label = (isLast ? p.submitLabel : p.nextLabel) || NAV_DEFAULTS[fieldKey]
  // 캔버스는 목업이라 항상 활성처럼 보이고, 실제 체험에서만 답을 골라야 넘어간다
  const blocked = ctx.mode === 'player' && !answered
  // 화면 꽉 채우기는 실행 화면에서만 — 캔버스는 문서 흐름 스택이라 뷰포트 높이가 의미 없다
  const fill = ctx.mode === 'player' && p.fillScreen !== false
  return (
    <div className={'sb-survey-card' + (fill ? ' sb-survey-card--fill' : '')}>
      <div className="sb-survey-progress" aria-label="설문 진행">
        <span className="sb-survey-progress__count">{index + 1} / {total}</span>
        <span className="sb-survey-progress__track">
          <span className="sb-survey-progress__bar" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </span>
      </div>
      {/* 원본 clean-question-list 골격 유지 — 질문 라벨·선택지 그리드 스타일이 여기 걸려 있다 */}
      <div className="clean-question-list">
        <div>
          <label className="text-sm font-medium text-slate-400 mb-3 block">{kText(p.question, ctx, 'question')}</label>
          {children}
        </div>
      </div>
      {foot}
      <button
        type="button"
        className="sb-survey-card__next"
        disabled={blocked}
        title={blocked ? '먼저 답을 골라주세요' : undefined}
        onClick={() => {
          if (ctx.mode === 'player' && ctx.player.nextQuestion) ctx.player.nextQuestion()
        }}
      >
        {kText(label, ctx, fieldKey)}
      </button>
    </div>
  )
}

/* 설문 단계 컴포넌트 — 헤더·진행 표시·질문·사진/날짜 입력·프로필 요약 */
export const SURVEY_COMPONENTS = {
  surveyIntro: {
    label: '설문 헤더',
    stage: 'survey',
    icon: '📋',
    hint: '설문 화면 상단 안내 문구',
    defaults: {
      kicker: '',
      title: '상황에 맞는 계획을 위해\n몇 가지만 알려주세요',
      desc: '피부 타입, 무드, 예산을 가볍게 고르면 지금 목적에\n맞는 뷰티 플랜을 정리해드려요.',
    },
    fields: [
      { key: 'kicker', label: '키커 (비우면 숨김)', kind: 'text' },
      { key: 'title', label: '제목', kind: 'textarea' },
      { key: 'desc', label: '설명', kind: 'textarea' },
    ],
    render: (p, ctx) => (
      <div className="clean-info-header sb-static sb-survey-intro">
        {p.kicker ? <span className="clean-info-kicker">{kText(p.kicker, ctx, 'kicker')}</span> : null}
        <h2>{kText(p.title, ctx, 'title')}</h2>
        <p>{kText(p.desc, ctx, 'desc')}</p>
      </div>
    ),
  },

  surveyQuestion: {
    label: '설문 질문',
    stage: 'survey',
    icon: '❓',
    hint: '선택지 배치 수·도형·직접 입력 선택지를 조절하는 질문',
    defaults: {
      question: '1. 아침 메이크업에 쓸 수 있는 시간은요?',
      options:
        '5분 이내 · 최소 루틴|쿠션과 립만 빠르게, 기초는 전날 밤에 끝내요\n10분 · 균형 루틴|베이스와 아이브로우까지 기본을 챙기는 데일리 루틴이에요\n15분 · 꼼꼼 루틴|음영과 블러셔까지 더해 또렷한 인상을 만들어요\n20분 이상 · 풀 메이크업|아이 메이크업과 픽서 세팅까지 완성도 있게 마무리해요',
      multi: false,
      maxPerRow: '4',
      optionShape: 'list',
      horizontalScroll: false,
      customOption: false,
      customLabel: '직접 입력할게요',
      customPlaceholder: '직접 입력해주세요',
      defaultAnswer: '',
      locked: false,
      ...NAV_DEFAULTS,
    },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'textarea' },
      { key: 'options', label: '선택지', kind: 'options', list: true },
      { key: 'multi', label: '복수 선택 허용', kind: 'toggle' },
      {
        key: 'optionShape',
        label: '선택지 도형',
        kind: 'select',
        defaultValue: 'list',
        options: [
          { value: 'list', label: '리스트형 (전폭 세로)' },
          { value: 'card', label: '카드형' },
          { value: 'pill', label: '알약형' },
          { value: 'square', label: '정사각형' },
          { value: 'circle', label: '원형' },
        ],
      },
      {
        key: 'maxPerRow',
        label: '한 줄에 보이는 최대 선택지 (리스트형 제외)',
        kind: 'select',
        defaultValue: '4',
        options: ['1', '2', '3', '4', '5', '6'].map((value) => ({ value, label: `${value}개` })),
      },
      { key: 'horizontalScroll', label: '가로 스크롤 사용 (리스트형 제외)', kind: 'toggle' },
      { key: 'customOption', label: '"직접 입력" 선택지 추가', kind: 'toggle' },
      { key: 'customLabel', label: '직접 입력 선택지 문구', kind: 'text' },
      { key: 'customPlaceholder', label: '직접 입력 안내 문구', kind: 'text' },
      { key: 'defaultAnswer', label: '미리 선택할 답변', kind: 'text' },
      { key: 'locked', label: '미리 선택한 답변 고정', kind: 'toggle' },
      ...NAV_FIELDS,
    ],
    render: (p, ctx) => {
      const opts = splitOptions(p.options)
      const isPlayer = ctx.mode === 'player'
      const shape = ['list', 'card', 'pill', 'square', 'circle'].includes(p.optionShape)
        ? p.optionShape
        : 'list'
      const answer = isPlayer ? ctx.player.answers[ctx.itemId] : undefined
      const answered = Array.isArray(answer)
        ? answer.some((v) => String(v).trim())
        : String(answer ?? '').trim() !== ''
      return (
        <QuestionShell p={p} ctx={ctx} answered={answered}>
          <SurveyOptions p={p} ctx={ctx} opts={opts} shape={shape} isPlayer={isPlayer} />
        </QuestionShell>
      )
    },
  },

  surveyPhoto: {
    label: '사진 업로드 질문',
    stage: 'survey',
    icon: '📷',
    hint: '얼굴 사진 등 이미지를 올려 받는 질문 (점선 드롭존)',
    defaults: {
      question: '1. 얼굴 사진을 올려주세요',
      placeholder: '정면 얼굴 사진을 선택해주세요',
      ...PHOTO_TEXT, // 드롭존 보조 문구 · 선택 뒤 제목/보조 · 샘플 모달 제목/부제 (Figma 원문)
      iconLabel: '', // 비우면 카메라 아이콘 (Figma 드롭존)
      samples: '', // 비우면 Figma에서 내보낸 기본 샘플 얼굴 4종
      photoUrl: '',
      ...NAV_DEFAULTS,
    },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'textarea' },
      { key: 'placeholder', label: '드롭존 안내 문구', kind: 'text' },
      { key: 'hint', label: '드롭존 보조 문구 (비우면 숨김)', kind: 'text' },
      { key: 'iconLabel', label: '아이콘 자리 문구 (비우면 카메라 아이콘)', kind: 'text' },
      { key: 'pickedTitle', label: '사진 선택 뒤 문구', kind: 'text' },
      { key: 'pickedHint', label: '사진 선택 뒤 보조 문구 (비우면 숨김)', kind: 'text' },
      { key: 'samples', label: '샘플 얼굴 이미지 URL (비우면 기본 4종)', kind: 'stringList', list: true },
      { key: 'samplesTitle', label: '샘플 얼굴 모달 제목', kind: 'text' },
      { key: 'samplesHint', label: '샘플 얼굴 모달 부제 (비우면 숨김)', kind: 'text' },
      { key: 'photoUrl', label: '선택 완료 미리보기 이미지 URL', kind: 'url' },
      ...NAV_FIELDS,
    ],
    render: (p, ctx) => {
      const isPlayer = ctx.mode === 'player'
      // 플레이어에서는 "고른 값"만이 선택 상태다 — 설정된 photoUrl로 폴백하면 해제가 안 된다
      const picked = resolveSampleFace(isPlayer ? ctx.player.answers[ctx.itemId] || '' : p.photoUrl)
      return (
        <QuestionShell p={p} ctx={ctx} answered={!!picked}>
          <PhotoPicker p={p} ctx={ctx} picked={picked} />
        </QuestionShell>
      )
    },
  },

  surveyDate: {
    label: '날짜 입력 질문',
    stage: 'survey',
    icon: '📅',
    hint: '날짜를 골라 받는 질문 — 달력 시트(Figma) 또는 필드 아래 펼친 달력',
    defaults: {
      question: '1. 소개팅이 언제예요?',
      placeholder: '날짜를 선택해 주세요',
      sheetTitle: '소개팅 날짜 선택',
      confirmLabel: '확인',
      calendarMode: 'sheet',
      skipLabel: '',
      ...NAV_DEFAULTS,
    },
    fields: [
      { key: 'question', label: '질문 문구', kind: 'textarea' },
      { key: 'placeholder', label: '비어 있을 때 문구', kind: 'text' },
      {
        key: 'calendarMode',
        label: '달력 표시',
        kind: 'select',
        defaultValue: 'sheet',
        options: [
          { value: 'sheet', label: '탭하면 바텀 시트로 (Figma)' },
          { value: 'inline', label: '필드 아래 펼쳐 두기' },
        ],
      },
      { key: 'sheetTitle', label: '달력 시트 제목', kind: 'text' },
      { key: 'confirmLabel', label: '달력 확인 버튼 문구', kind: 'text' },
      { key: 'skipLabel', label: '건너뛰기 문구 (비우면 숨김)', kind: 'text' },
      ...NAV_FIELDS,
    ],
    render: (p, ctx) => {
      const isPlayer = ctx.mode === 'player'
      const value = isPlayer ? ctx.player.answers[ctx.itemId] || '' : ''
      // 건너뛰기는 답 없이 다음으로 보내는 유일한 통로 — 잠금 게이트를 우회한다
      const foot = p.skipLabel ? (
        <button
          type="button"
          className="sb-survey-card__skip"
          onClick={() => { if (isPlayer && ctx.player.nextQuestion) ctx.player.nextQuestion() }}
        >
          {kText(p.skipLabel, ctx, 'skipLabel')}
        </button>
      ) : null
      return (
        <QuestionShell p={p} ctx={ctx} answered={!!value} foot={foot}>
          <DatePicker p={p} ctx={ctx} value={value} />
        </QuestionShell>
      )
    },
  },

  profilePanel: {
    label: '프로필 요약 패널',
    stage: 'survey',
    icon: '🪪',
    hint: '"~님에 대해 이미 알고 있어요" — 배지 클릭으로 노출 조절',
    canvasInteractive: true,
    defaults: {
      hint: '이번엔 빼고 싶은 항목을 눌러주세요',
      hidden: '', // 이 시나리오에서 숨길 프로필 라벨 (쉼표 구분)
    },
    fields: [
      { key: 'hint', label: '우측 안내 문구', kind: 'text' },
      { key: 'hidden', label: '속성 칩 관리', kind: 'profileChips', list: true },
    ],
    render: (p, ctx) => {
      const profile = ctx.profile || { name: '사용자', items: [] }
      const items = (profile.items || []).filter((it) => it.label && it.label.trim())
      const hidden = splitList(p.hidden)
      const isPlayer = ctx.mode === 'player'
      const excluded = isPlayer ? ctx.player.excludedProfile || [] : []
      // 플레이어에서는 숨긴 항목을 아예 안 보여주고, 캔버스에서는 흐리게 보여준다
      const visible = isPlayer ? items.filter((it) => !hidden.includes(it.label)) : items
      // 계획의 설문 요약(보라 밴드 + 흰 라벨/값 칩)과 같은 톤 — viewer.css .sb-profile-panel
      return (
        <div className="sb-profile-panel">
          <div className="sb-profile-panel__head">
            <span className="sb-profile-panel__title">{profile.name}님에 대해 이미 알고 있어요</span>
            <span className="sb-profile-panel__hint">{isPlayer ? kText(p.hint, ctx) : '배지를 눌러 이 시나리오 노출을 켜고 끄세요'}</span>
          </div>
          <div className="sb-profile-panel__chips">
            {visible.length === 0 && (
              <span className="sb-pinned-panel__empty">프로필 항목이 없어요. 탐색 페이지 편집기에서 추가하세요.</span>
            )}
            {visible.map((it) => {
              const off = isPlayer ? excluded.includes(it.label) : hidden.includes(it.label)
              return (
                <button
                  key={it.label}
                  type="button"
                  className={'sb-profile-chip' + (off ? ' is-off' : '')}
                  title={isPlayer ? (off ? '다시 포함하기' : '이번 설문에서 빼기') : (off ? '이 시나리오에 노출하기' : '이 시나리오에서 숨기기')}
                  onClick={() => {
                    if (isPlayer) {
                      ctx.player.toggleProfileItem(it.label)
                    } else if (ctx.updateProps) {
                      const next = hidden.includes(it.label)
                        ? hidden.filter((l) => l !== it.label)
                        : [...hidden, it.label]
                      ctx.updateProps(ctx.itemId, 'hidden', next.join(', '))
                    }
                  }}
                >
                  <span className="sb-profile-chip__label">{it.label}</span>
                  <span className="sb-profile-chip__value">{it.value}</span>
                  <span className="sb-profile-chip__toggle" aria-hidden="true">
                    {off
                      ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )
    },
  },
}
