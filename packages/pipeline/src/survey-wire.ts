import type { SurveyPageWire, SurveyQuestionWire } from '@ddak/schema'
import type { LlmStreamHandlers } from './llm-port'
import { SurveyGen, SurveyQuestionGen, SurveyQuestionPartialGen } from './schemas'

/*
 * 설문 생성물 → 와이어 페이지 조립 (LLM은 콘텐츠만, id·배치는 스캐폴드 소유 — §0-2).
 * legacy 경로(threads.service)와 그래프 엔진(engine/graph)이 **같은 규칙**을 써야
 * 스트리밍 미리보기와 최종 result의 질문 자리가 어긋나지 않으므로 여기 한 곳에 둔다.
 *
 * 사진 질문은 생성물의 머리 필드(photoQuestion)에서 나와 **언제나 첫 질문 자리**를 차지한다:
 * 얼굴을 보고 답이 달라지는 의도(가상 메이크업·룩 제안)에서 사진을 먼저 받아야
 * 뒤 질문과 계획이 그 위에 얹힌다. 사진이 없는 의도면 빈 문자열이라 자리도 없다.
 */

/** 사진 질문의 와이어 id — 답변 키이자 FE 아이템 id (선택지 질문의 q1..과 겹치지 않는다) */
export const PHOTO_QUESTION_ID = 'p1'

/** 생성물의 photoQuestion → 와이어 질문. 빈 문자열이면 null (사진 불필요) */
export function photoQuestionWire(text: string | undefined): SurveyQuestionWire | null {
  const question = (text ?? '').trim()
  if (!question) return null
  return { id: PHOTO_QUESTION_ID, question, kind: 'photo', options: [], multi: false }
}

/** 선택지 질문 → 와이어. index는 사진 질문을 뺀 배열 인덱스다 (id는 q1부터) */
export function choiceQuestionWire(gen: SurveyQuestionGen, index: number): SurveyQuestionWire {
  return { id: `q${index + 1}`, kind: 'choice', question: gen.question, options: gen.options, multi: gen.multi }
}

/** 설문 생성물 → 와이어 페이지 (사진 질문이 있으면 맨 앞) */
export function buildSurveyPage(content: SurveyGen): SurveyPageWire {
  const photo = photoQuestionWire(content.photoQuestion)
  const questions = content.questions.map(choiceQuestionWire)
  return { intro: content.intro, questions: photo ? [photo, ...questions] : questions }
}

/** 스트리밍 소비자 — 호출자는 이 두 콜백만 구현한다 (legacy=SSE 핸들러, graph=custom writer) */
export type SurveyStreamSink = {
  onIntro?: (intro: string) => void
  onQuestion?: (question: SurveyQuestionWire, index: number) => void
}

/** 설문 스트림 핸들러 조립 — 사진 질문(머리 필드)은 index 0으로, 선택지 질문은 그만큼
 * 밀린 index로 내보낸다. 자리 규칙이 buildSurveyPage와 같아 확정 렌더로 이어진다.
 * (구조화 출력은 스키마 키 순서대로 나오므로 questions가 열릴 때 photoQuestion은 이미 지나갔다 —
 *  순서가 어긋나도 권위는 언제나 최종 result다) */
export function surveyStreamHandlers(sink: SurveyStreamSink): LlmStreamHandlers {
  let photoOffset = 0
  const emitPhoto = (value: string) => {
    const photo = photoQuestionWire(value)
    if (!photo) return // 빈 문자열 = 사진 불필요 — 자리도 만들지 않는다
    photoOffset = 1
    sink.onQuestion?.(photo, 0)
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
          options: parsed.data.options ?? [],
          multi: parsed.data.multi ?? false,
        },
        index + photoOffset,
      )
    },
  }
}
