import type { LookScope, SurveyPageWire, SurveyQuestionWire } from '@ddak/schema'
import type { LlmStreamHandlers } from './llm-port'
import { SurveyGen, SurveyQuestionGen, SurveyQuestionPartialGen } from './schemas'

/*
 * 설문 생성물 → 와이어 페이지 조립 (LLM은 콘텐츠만, id·배치는 스캐폴드 소유 — §0-2).
 * legacy 경로(threads.service)와 그래프 엔진(engine/graph)이 **같은 규칙**을 써야
 * 스트리밍 미리보기와 최종 result의 질문 자리가 어긋나지 않으므로 여기 한 곳에 둔다.
 *
 * 사진 질문은 생성물의 머리 필드(photoQuestion)에서 나와 **앞머리 자리**를 차지한다:
 * 얼굴을 보고 답이 달라지는 의도(가상 메이크업·룩 제안)에서 사진을 먼저 받아야
 * 뒤 질문과 계획이 그 위에 얹힌다. 사진이 없는 의도면 빈 문자열이라 자리도 없다.
 *
 * 사진을 받는 설문에는 **스타일링 범위 질문(s1)이 사진 질문(p1)보다 먼저** 선다(2026-09): "어디까지
 * 스타일링해 볼까요?" — 메이크업만 / +헤어 / +옷차림. LLM 이 아니라 스캐폴드가 만드는 고정 질문이라
 * 문구·선택지가 결정적이고, 답이 룩 사양의 scope 가 된다(뼈대 프롬프트). 범위를 먼저 알아야 사진 안내를
 * "얼굴 정면"에서 "어깨·상반신까지"로 바꿀 수 있어 사진보다 앞이다.
 */

/** 사진 질문의 와이어 id — 답변 키이자 FE 아이템 id (선택지 질문의 q1..과 겹치지 않는다) */
export const PHOTO_QUESTION_ID = 'p1'
/** 스타일링 범위 질문의 와이어 id — 사진 질문 앞 고정 자리 */
export const SCOPE_QUESTION_ID = 's1'
export const SCOPE_QUESTION_TEXT = '어디까지 스타일링해 볼까요?'
/** 범위 선택지 — "제목|부제" 와이어 문법. 제목이 곧 답변(choices)이라 lookScopeFromAnswer 가 제목을 대조한다 */
export const SCOPE_OPTIONS: ReadonlyArray<{ scope: LookScope; label: string; desc: string }> = [
  { scope: 'makeup', label: '메이크업만', desc: '얼굴에 올릴 룩만 볼게요' },
  { scope: 'hair', label: '메이크업 + 헤어', desc: '헤어스타일·컬러까지 제안받을게요' },
  { scope: 'outfit', label: '메이크업 + 헤어 + 옷차림', desc: '상의 톤·핏까지 한 벌로 볼게요' },
]

/*
 * 선택지 와이어 문법 — FE 옵션 파서(store splitOptions "메인|서브|상세")와 같은 "제목|부제" 한 줄.
 * 생성물은 {label, desc} 객체지만 와이어 options 는 문자열 배열이고 답변(choices)은 제목만 실린다.
 * 구분자 '|'가 제목·부제 안에 들어오면 공백으로 바꿔 자리를 지킨다. 옛 문자열 선택지도 그대로 통과.
 */
export const OPTION_SEP = '|'
export function optionWire(option: unknown): string {
  if (typeof option === 'string') return option.trim()
  const o = (option ?? {}) as { label?: unknown; desc?: unknown }
  const label = String(o.label ?? '').replace(/\|/g, ' ').trim()
  const desc = String(o.desc ?? '').replace(/\|/g, ' ').trim()
  if (!label) return ''
  return desc ? `${label}${OPTION_SEP}${desc}` : label
}
/** 와이어 선택지 → 제목·부제 (프롬프트 가변부·심사 요청·답변 대조는 제목만 본다) */
export function optionParts(option: string): { label: string; desc: string } {
  const [label = '', ...rest] = String(option ?? '').split(OPTION_SEP)
  return { label: label.trim(), desc: rest.join(OPTION_SEP).trim() }
}
export function optionLabel(option: string): string {
  return optionParts(option).label
}

/** 생성물의 photoQuestion → 와이어 질문. 빈 문자열이면 null (사진 불필요) */
export function photoQuestionWire(text: string | undefined): SurveyQuestionWire | null {
  const question = (text ?? '').trim()
  if (!question) return null
  return { id: PHOTO_QUESTION_ID, question, kind: 'photo', options: [], multi: false }
}

/** 스타일링 범위 질문 — 사진 질문이 있을 때만 그 앞에 선다 (스캐폴드 고정, 단일 선택) */
export function scopeQuestionWire(): SurveyQuestionWire {
  return {
    id: SCOPE_QUESTION_ID,
    kind: 'choice',
    question: SCOPE_QUESTION_TEXT,
    options: SCOPE_OPTIONS.map((o) => `${o.label}${OPTION_SEP}${o.desc}`),
    multi: false,
  }
}

/** 범위 답(선택지 제목) → scope. 모르는 값·없음은 makeup — 옛 쓰레드(범위 질문 이전)도 여기로 온다 */
export function lookScopeFromAnswer(label: string | undefined | null): LookScope {
  const text = optionLabel(String(label ?? ''))
  if (!text) return 'makeup'
  const hit = SCOPE_OPTIONS.find((o) => o.label === text)
  if (hit) return hit.scope
  if (text.includes('옷')) return 'outfit'
  if (text.includes('헤어')) return 'hair'
  return 'makeup'
}

/** 사진 질문(kind=photo)에 답이 실렸는가 — 답의 원본은 기기에만 있고 와이어에는 표식뿐이라 **질문 종류로** 판정한다.
 * 뼈대 프롬프트 가변부(planContext)가 「얼굴 사진을 올렸습니다」로 푸는 것과 **같은 조건**이어야 한다 — 프롬프트는
 * 룩을 만들라 하는데 호출 스키마(planSkeletonGenFor)에 look 갈래가 없는 어긋남을 막기 위해서다 */
export function hasPhotoAnswer(
  survey: Pick<SurveyPageWire, 'questions'> | null | undefined,
  answers: ReadonlyArray<{ questionId: string }> | null | undefined,
): boolean {
  if (!survey || !answers?.length) return false
  const photoIds = new Set(survey.questions.filter((q) => q.kind === 'photo').map((q) => q.id))
  return photoIds.size > 0 && answers.some((a) => photoIds.has(a.questionId))
}

/** 답변 목록에서 범위 — s1 답이 없으면 makeup */
export function lookScopeOfAnswers(answers: ReadonlyArray<{ questionId: string; choices: string[] }> | undefined): LookScope {
  const a = (answers ?? []).find((x) => x.questionId === SCOPE_QUESTION_ID)
  return lookScopeFromAnswer(a?.choices?.[0])
}

/** 사진 질문 앞머리 — 범위 질문 + 사진 질문 (사진이 없으면 빈 배열) */
export function photoLeadQuestions(text: string | undefined): SurveyQuestionWire[] {
  const photo = photoQuestionWire(text)
  return photo ? [scopeQuestionWire(), photo] : []
}

/** 선택지 질문 → 와이어. index는 사진 질문을 뺀 배열 인덱스다 (id는 q1부터) */
export function choiceQuestionWire(gen: SurveyQuestionGen, index: number): SurveyQuestionWire {
  return {
    id: `q${index + 1}`,
    kind: 'choice',
    question: gen.question,
    options: gen.options.map(optionWire).filter(Boolean),
    multi: gen.multi,
  }
}

/** 설문 생성물 → 와이어 페이지 (사진 질문이 있으면 [범위 질문, 사진 질문]이 맨 앞) */
export function buildSurveyPage(content: SurveyGen): SurveyPageWire {
  const lead = photoLeadQuestions(content.photoQuestion)
  const questions = content.questions.map(choiceQuestionWire)
  return { intro: content.intro, questions: [...lead, ...questions] }
}

/** 스트리밍 소비자 — 호출자는 이 두 콜백만 구현한다 (legacy=SSE 핸들러, graph=custom writer) */
export type SurveyStreamSink = {
  onIntro?: (intro: string) => void
  onQuestion?: (question: SurveyQuestionWire, index: number) => void
}

/** 설문 스트림 핸들러 조립 — 앞머리(범위 질문 index 0 · 사진 질문 index 1)는 머리 필드가 오는 순간
 * 내보내고, 선택지 질문은 그만큼 밀린 index로 내보낸다. 자리 규칙이 buildSurveyPage와 같아 확정 렌더로 이어진다.
 * (구조화 출력은 스키마 키 순서대로 나오므로 questions가 열릴 때 photoQuestion은 이미 지나갔다 —
 *  순서가 어긋나도 권위는 언제나 최종 result다) */
export function surveyStreamHandlers(sink: SurveyStreamSink): LlmStreamHandlers {
  let photoOffset = 0
  const emitPhoto = (value: string) => {
    const lead = photoLeadQuestions(value)
    if (!lead.length) return // 빈 문자열 = 사진 불필요 — 자리도 만들지 않는다
    photoOffset = lead.length
    lead.forEach((q, i) => sink.onQuestion?.(q, i))
  }
  return {
    arrayKey: 'questions',
    headKeys: ['intro', 'photoQuestion'],
    onHead: (key, value) => {
      if (key === 'intro') sink.onIntro?.(value)
      else if (key === 'photoQuestion') emitPhoto(value)
    },
    onHeadPartial: (key, value) => {
      if (key === 'intro') sink.onIntro?.(value)
      else if (key === 'photoQuestion') emitPhoto(value)
    },
    onElement: (element, index) => {
      const parsed = SurveyQuestionGen.safeParse(element)
      if (parsed.success) sink.onQuestion?.(choiceQuestionWire(parsed.data, index), index + photoOffset)
    },
    // 자라는 중인 질문 — 문구가 나오기 시작하면 토큰 단위로 같은 index에 재전송한다
    onElementPartial: (element, index) => {
      const parsed = SurveyQuestionPartialGen.safeParse(element)
      if (!parsed.success || !parsed.data.question) return
      sink.onQuestion?.(
        {
          id: `q${index + 1}`,
          kind: 'choice',
          question: parsed.data.question,
          options: (parsed.data.options ?? []).map(optionWire).filter(Boolean),
          multi: parsed.data.multi ?? false,
        },
        index + photoOffset,
      )
    },
  }
}
