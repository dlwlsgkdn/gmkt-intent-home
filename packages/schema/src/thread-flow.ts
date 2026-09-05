import { z } from 'zod'
import { ThreadId, ThreadSource, ThreadStatus } from './thread'

/*
 * 쓰레드 플로우 계약 — FE ↔ BFF (threads API). 공식 용어는 thread 하나다:
 * 와이어 형식은 의미 단위 페이지 JSON이다. 스튜디오 레지스트리 아이템(x/y/w 배치)으로의
 * 투영은 FE 통합 단계에서 얹는다 — 매핑 기준: question→surveyQuestion, guide→planStep,
 * products→productCard, steps→checklist (DESIGN-LLM-SERVICE.md §2-1).
 */

/** 사용자 프로필 — 스튜디오 profilePanel 항목과 같은 라벨/값 쌍 */
export const Profile = z.array(z.object({ label: z.string(), value: z.string() }))
export type Profile = z.infer<typeof Profile>

/** 가상 메이크업 결과의 색조 — FE가 올린 사진 위에 올려 보여줄 톤 프리셋 키.
 * 값 집합은 FE 프리셋(registry beforeAfter TONE_PRESETS)과 한 벌이다 */
export const LOOK_TONES = ['coral', 'rose', 'red', 'peach', 'brown', 'plum'] as const
export const LookTone = z.enum(LOOK_TONES)
export type LookTone = z.infer<typeof LookTone>

/* ── 요청 ────────────────────────────────────────────────────────────── */

export const StartThreadBody = z
  .object({
    chipId: z.string().optional(),
    query: z.string().optional(),
    title: z.string().optional(),
    profile: Profile.optional(),
  })
  .refine((v) => v.chipId || v.query, { message: 'chipId 또는 query가 필요합니다' })
export type StartThreadBody = z.infer<typeof StartThreadBody>

export const SurveyRequestBody = z.object({
  profile: Profile.optional(),
})
export type SurveyRequestBody = z.infer<typeof SurveyRequestBody>

export const Answer = z.object({
  questionId: z.string(),
  choices: z.array(z.string()).min(1),
})
export type Answer = z.infer<typeof Answer>

/* ── 피드백 (사용자 평가) ─────────────────────────────────────────────────
 * 스튜디오 평가 스튜디오와 같은 문법: 별점 0~5 + 코멘트, null = 미평가 (0점과 구분).
 * 저장은 action 스텝(type='feedback')의 data — 제출 1회 = 스텝 1개(append)라 수정
 * 이력이 로그로 남고, 이어보기·관리 페이지는 단계별 최신 제출을 유효본으로 본다. */

export const FeedbackScore = z.number().int().min(0).max(5)

export const ThreadFeedbackComponent = z.object({
  /** livePage 투영 아이템 id — 설문 질문은 와이어 질문 id 그대로 */
  id: z.string(),
  /** 사람이 읽을 라벨(질문 문구·섹션 제목) — 관리 페이지 문서화용. 페이지가 재생성돼도 해석 가능하게 함께 저장 */
  label: z.string(),
  score: FeedbackScore.nullable(),
  feedback: z.string(),
})
export type ThreadFeedbackComponent = z.infer<typeof ThreadFeedbackComponent>

export const ThreadStageFeedback = z.object({
  stage: z.enum(['survey', 'plan']),
  /** 페이지 전체 평가 */
  review: z.object({ score: FeedbackScore.nullable(), feedback: z.string() }),
  /** 컴포넌트별 평가 — 별점이나 코멘트가 있는 항목만 실어 보낸다 */
  components: z.array(ThreadFeedbackComponent),
  /** 기록 시각 (이어보기 응답에서 action 스텝의 at으로 채워진다) */
  at: z.string().optional(),
})
export type ThreadStageFeedback = z.infer<typeof ThreadStageFeedback>

export const PlanRequestBody = z.object({
  answers: z.array(Answer).min(1),
  profile: Profile.optional(),
  /** 재생성에 반영할 계획 피드백(stage='plan') — 있으면 BFF가 직전 계획과 함께 프롬프트에 실어,
   * 지적된 상품을 빼고 웹 검색으로 대안을 찾는 등 피드백 반영 재생성이 된다. 없으면 일반 생성 */
  feedback: ThreadStageFeedback.optional(),
})
export type PlanRequestBody = z.infer<typeof PlanRequestBody>

/* ── 가상 메이크업 정밀 렌더 ──────────────────────────────────────────────
 * 기본 경로(기기 안 랜드마크 합성)와 결정적으로 다르다: **사진이 서버와 외부 이미지 편집
 * 모델로 나간다.** 그래서 자동으로 부르지 않고 사용자가 화면에서 명시로 요청할 때만 호출한다.
 * 사진은 요청 본문에만 실리고 스텝에는 남기지 않는다 (기록되는 것은 톤·모델·지연뿐). */

export const LookRenderBody = z.object({
  /** 얼굴 사진 — data:image/*;base64 (FE가 720px로 줄인 것) */
  photo: z.string().regex(/^data:image\/[a-zA-Z+]+;base64,/, 'photo는 data:image/*;base64 형식이어야 합니다'),
  tone: LookTone,
  /** 룩 이름·포인트 — 편집 지시문의 재료 (없으면 톤만으로 만든다) */
  title: z.string().optional(),
  points: z.array(z.string()).max(4).optional(),
})
export type LookRenderBody = z.infer<typeof LookRenderBody>

export const LookRenderResult = z.object({
  /** 메이크업이 올라간 이미지 — data:image/*;base64 */
  image: z.string(),
  model: z.string().optional(),
  latencyMs: z.number().optional(),
})
export type LookRenderResult = z.infer<typeof LookRenderResult>

export const ThreadEventBody = z.object({
  /** cartAdd | cartRemove | complete | restart | feedback 등 — FE 정의 이벤트 이름 */
  type: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type ThreadEventBody = z.infer<typeof ThreadEventBody>

/* ── 와이어 페이지 (BFF → FE) ────────────────────────────────────────── */

/** 질문 유형 — choice(선택지, 기본) | photo(얼굴 사진 업로드).
 * photo는 선택지가 없고 FE가 사진 업로드 컴포넌트(surveyPhoto)로 투영한다. 구 응답에는
 * 필드 자체가 없으므로 optional — 없으면 choice로 읽는다 */
export const SurveyQuestionKind = z.enum(['choice', 'photo'])
export type SurveyQuestionKind = z.infer<typeof SurveyQuestionKind>

/** 사진 질문의 답 — **사진 원본은 서버로 보내지 않는다**. 기기에 남기고, 와이어에는 제출
 * 표식만 실린다 (데이터 URL은 수백 KB라 스텝 저장·프롬프트에 실을 것이 못 된다).
 * 계획 생성 프롬프트도 이 표식으로 "사진을 올렸다"만 안다 */
export const PHOTO_ANSWER = '사진 제출됨'

export const SurveyQuestionWire = z
  .object({
    id: z.string(),
    question: z.string(),
    kind: SurveyQuestionKind.optional(),
    options: z.array(z.string()).max(6),
    multi: z.boolean(),
    /** photo 전용 — 드롭존 안내 문구 (비면 FE 기본값) */
    placeholder: z.string().optional(),
  })
  .refine((q) => q.kind === 'photo' || q.options.length >= 2, {
    message: '선택지 질문은 선택지가 2개 이상이어야 합니다',
    path: ['options'],
  })
export type SurveyQuestionWire = z.infer<typeof SurveyQuestionWire>

export const SurveyPageWire = z.object({
  intro: z.string(),
  questions: z.array(SurveyQuestionWire).min(1),
})
export type SurveyPageWire = z.infer<typeof SurveyPageWire>

/** 매칭율 세부 항목 — 항목 점수(0~100)와 가중치(합 100), 근거 한 줄. 화면 팝오버가 그대로 그린다 */
export const ProductMatchFactor = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().int().min(0).max(100),
  weight: z.number().int().min(0).max(100),
  note: z.string().optional(),
})
export type ProductMatchFactor = z.infer<typeof ProductMatchFactor>

/** 매칭율 — 파이프라인 검증 게이트가 상품마다 계산해 계획 페이지(plan 스텝 payload)에 남긴다.
 * score = Σ weight × factor.score / 100 (정수 반올림). basis 는 계산식 설명, version 은 가중치 표 버전 */
export const ProductMatch = z.object({
  score: z.number().int().min(0).max(100),
  factors: z.array(ProductMatchFactor),
  basis: z.string().optional(),
  version: z.number().int().optional(),
})
export type ProductMatch = z.infer<typeof ProductMatch>

export const CatalogProduct = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string(),
  price: z.number().int(),
  tags: z.array(z.string()),
  /** 매칭율 — 그라운딩 가드(@ddak/pipeline scoreProductMatch)가 붙인다. 옛 페이지에는 없다 */
  match: ProductMatch.optional(),
  /** 상품 페이지 URL — 웹 검색 상품은 BFF 검증(http/https)을 거쳐 채워진다. FE 상세보기 패널이 연다 */
  url: z.string().optional(),
  /** 판매처 이름 (올리브영 등) — 웹 검색 상품 전용. 없으면 지마켓(데모 카탈로그) 상품 */
  mall: z.string().optional(),
  /** 상품 썸네일 URL — 카탈로그는 검증된 지마켓 이미지, 웹 상품은 BFF url 검증 통과분만. 없으면 FE가 이모지 목업으로 렌더 */
  imageUrl: z.string().optional(),
})
export type CatalogProduct = z.infer<typeof CatalogProduct>

/** 참고 콘텐츠(웹 게시글·영상) 항목 — 웹 검색 그라운딩(BFF url 검증)을 거친 실제 콘텐츠만.
 * FE 투영: video→videoCard, article→articleCard (meta는 채널·조회수 또는 작성자·시점) */
export const PlanContentItem = z.object({
  type: z.enum(['video', 'article']),
  source: z.string(),
  title: z.string(),
  url: z.string(),
  imageUrl: z.string().optional(),
  meta: z.string().optional(),
  snippet: z.string().optional(),
  duration: z.string().optional(),
})
export type PlanContentItem = z.infer<typeof PlanContentItem>

export const PlanSectionWire = z.discriminatedUnion('kind', [
  /* 단계 안내 — 제목 · 서브타이틀(단계의 목적 한 줄, 뼈대 프롬프트가 채운다 — 옛 페이지는 없음) · 본문 */
  z.object({ kind: z.literal('guide'), title: z.string(), subtitle: z.string().optional(), body: z.string() }),
  /* 가상 메이크업 결과 — 사진 질문에 답한 쓰레드에서만 만들어진다. FE는 기기에 남은 사진을
     BEFORE로, 같은 사진에 tone 프리셋을 올린 것을 AFTER로 비포/애프터 컴포넌트에 투영한다
     (합성은 화면에서 — 서버는 어떤 룩인지만 정한다) */
  z.object({
    kind: z.literal('look'),
    title: z.string(),
    desc: z.string(),
    tone: LookTone,
    points: z.array(z.string()).max(4).optional(),
  }),
  z.object({
    kind: z.literal('products'),
    title: z.string(),
    reason: z.string(),
    products: z.array(CatalogProduct).min(1),
  }),
  z.object({
    kind: z.literal('contents'),
    title: z.string(),
    reason: z.string(),
    items: z.array(PlanContentItem).min(1),
  }),
  z.object({ kind: z.literal('steps'), title: z.string(), steps: z.array(z.string()).min(2) }),
])
export type PlanSectionWire = z.infer<typeof PlanSectionWire>

export const PlanPageWire = z.object({
  headline: z.string(),
  summary: z.string(),
  sections: z.array(PlanSectionWire).min(1),
})
export type PlanPageWire = z.infer<typeof PlanPageWire>

/** 쓰레드 시작 응답 — threadId는 core가 발급한 스노우플레이크 문자열 */
export const StartThreadResult = z.object({ threadId: ThreadId })
export type StartThreadResult = z.infer<typeof StartThreadResult>

/** 이어보기 응답 — 단계별 페이지를 FE가 복원하기 좋은 형태로 */
export const ThreadResumeWire = z.object({
  threadId: ThreadId,
  title: z.string().nullable(),
  status: ThreadStatus,
  source: ThreadSource.nullable(),
  survey: SurveyPageWire.nullable(),
  answers: z.array(Answer).nullable(),
  plan: PlanPageWire.nullable(),
  /** 단계별 최신 피드백 — action 스텝(type='feedback')에서 파생. 없으면 null (구 BFF 응답엔 필드 자체가 없다) */
  feedback: z
    .object({ survey: ThreadStageFeedback.nullable(), plan: ThreadStageFeedback.nullable() })
    .nullable()
    .optional(),
  updatedAt: z.string(),
})
export type ThreadResumeWire = z.infer<typeof ThreadResumeWire>
