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

/* ── 가상 메이크업 룩 사양 (2026-09) ──────────────────────────────────────
 * 색조(tone) 하나로는 "어떤 메이크업인지"가 렌더에 닿지 않았다 — 기기 합성은 톤별 립·볼 색 한 벌만
 * 칠했고, 정밀 렌더는 고정 풀글램 템플릿 뒤에 한국어 포인트를 붙여 서로 모순됐다(틴트 그라데이션 vs
 * "never a sheer tint"). 이 사양은 **뼈대 LLM 이 답변에서 정하고 두 렌더가 그대로 소비하는 한 원천**이다:
 * 기기 합성(makeupComposite)은 hex·마감·기법·위치를 직접 칠하고, 정밀 렌더 프롬프트(buildLookRenderPrompt)는
 * 이 값에서 영어 지시문을 생성한다. 부위마다 note 한 줄은 사용자에게 보이는 포인트 문구(한국어)라
 * 화면의 points 는 여기서 파생한다(lookPointsOf). 옛 페이지에는 없으므로 와이어에서는 optional. */
export const LOOK_INTENSITIES = ['natural', 'glam'] as const
export const LookIntensity = z.enum(LOOK_INTENSITIES)
export type LookIntensity = z.infer<typeof LookIntensity>

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '색은 #rrggbb 형식이어야 합니다')

export const LOOK_LIP_FINISHES = ['matte', 'velvet', 'glossy', 'tint'] as const
export const LOOK_LIP_TECHNIQUES = ['full', 'gradient', 'overlined'] as const
export const LOOK_CHEEK_PLACEMENTS = ['apples', 'cheekbones', 'drape'] as const
export const LOOK_STRENGTHS = ['light', 'medium', 'strong'] as const
export const LOOK_LINERS = ['none', 'thin', 'winged'] as const
export const LOOK_LASHES = ['natural', 'volume'] as const
export const LOOK_BROWS = ['natural', 'defined'] as const
export const LOOK_BASE_FINISHES = ['matte', 'semi-matte', 'dewy'] as const
export const LOOK_COVERAGES = ['light', 'medium', 'full'] as const

/* 스타일링 범위 — 설문의 스캐폴드 질문("어디까지 스타일링해 볼까요?", id s1)이 정하고 뼈대 LLM 이 사양에 옮긴다.
 * 누적 의미: hair = 메이크업+헤어, outfit = 메이크업+헤어+옷차림. 기기 합성은 메이크업만 그리고(랜드마크는 얼굴뿐)
 * 헤어·옷은 정밀 렌더가 맡는다 — 화면은 그 사이 "헤어·옷은 정밀 렌더에서" 를 안내한다 */
export const LOOK_SCOPES = ['makeup', 'hair', 'outfit'] as const
export const LookScope = z.enum(LOOK_SCOPES)
export type LookScope = z.infer<typeof LookScope>

export const LOOK_HAIR_STYLES = ['keep', 'straight', 'wavy', 'curly', 'updo', 'ponytail'] as const
export const LOOK_HAIR_LENGTHS = ['keep', 'short', 'medium', 'long'] as const
export const LOOK_HAIR_BANGS = ['keep', 'none', 'see-through', 'full'] as const
export const LOOK_OUTFIT_TOPS = ['keep', 'tee', 'shirt', 'blouse', 'knit', 'jacket', 'dress'] as const
export const LOOK_OUTFIT_FITS = ['regular', 'oversized', 'fitted'] as const
export const LOOK_OUTFIT_NECKLINES = ['keep', 'crew', 'v', 'collar', 'off-shoulder'] as const

/** 헤어 사양 — 'keep' 은 그 요소를 바꾸지 않는다는 뜻. color 는 #rrggbb 또는 'keep' */
export const LookHairSpec = z.object({
  style: z.enum(LOOK_HAIR_STYLES),
  length: z.enum(LOOK_HAIR_LENGTHS),
  color: z.string(),
  bangs: z.enum(LOOK_HAIR_BANGS),
  note: z.string(),
})
export type LookHairSpec = z.infer<typeof LookHairSpec>

/** 옷차림 사양 — 상의 한 벌만 바꾼다 (얼굴·포즈·배경은 그대로). color 는 #rrggbb 또는 'keep' */
export const LookOutfitSpec = z.object({
  top: z.enum(LOOK_OUTFIT_TOPS),
  color: z.string(),
  fit: z.enum(LOOK_OUTFIT_FITS),
  neckline: z.enum(LOOK_OUTFIT_NECKLINES),
  note: z.string(),
})
export type LookOutfitSpec = z.infer<typeof LookOutfitSpec>

export const LookSpec = z.object({
  /** 스타일링 범위 — 없으면 makeup (v23 초기 페이지 호환) */
  scope: LookScope.optional(),
  /** 전체 강도 — natural(데일리·출근) | glam(파티·데이트·화보). 기기 합성의 불투명도 배율이자 정밀 렌더의 강도 문구 */
  intensity: LookIntensity,
  lip: z.object({
    color: HexColor,
    finish: z.enum(LOOK_LIP_FINISHES),
    technique: z.enum(LOOK_LIP_TECHNIQUES),
    /** 사용자에게 보이는 포인트 한 줄 (한국어) */
    note: z.string(),
  }),
  cheek: z.object({
    color: HexColor,
    placement: z.enum(LOOK_CHEEK_PLACEMENTS),
    strength: z.enum(LOOK_STRENGTHS),
    note: z.string(),
  }),
  eye: z.object({
    /** 섀도 색 0~3개 — 비면 섀도 없음. 순서: 눈두덩 바탕 → 눈꼬리·크리즈 → 눈앞머리 하이라이트 */
    shadow: z.array(HexColor).max(3),
    liner: z.enum(LOOK_LINERS),
    lashes: z.enum(LOOK_LASHES),
    brow: z.enum(LOOK_BROWS),
    note: z.string(),
  }),
  base: z.object({
    finish: z.enum(LOOK_BASE_FINISHES),
    coverage: z.enum(LOOK_COVERAGES),
    contour: z.boolean(),
    highlight: z.boolean(),
    note: z.string(),
  }),
  /** scope 가 hair 이상일 때만 실린다 (sanitizeLookSpec 이 범위 밖이면 뗀다) */
  hair: LookHairSpec.optional(),
  /** scope 가 outfit 일 때만 실린다 */
  outfit: LookOutfitSpec.optional(),
})
export type LookSpec = z.infer<typeof LookSpec>

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
  /** 화면 포인트 — 부위 4 + 헤어·옷(범위 안일 때) 최대 6줄 */
  points: z.array(z.string()).max(6).optional(),
  /** 룩 사양 — 있으면 편집 지시문을 고정 템플릿이 아니라 이 사양에서 생성한다 (계획 look 섹션의 spec 그대로) */
  spec: LookSpec.optional(),
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
  /** 판매가 미확인 — 검색 결과에 가격이 없어 0으로 실린 웹 상품 (FE 카드가 "가격 확인 필요"로 보인다, 2026-09) */
  priceUnknown: z.boolean().optional(),
  tags: z.array(z.string()),
  /** 매칭율 — 그라운딩 가드(@ddak/pipeline scoreProductMatch)가 붙인다. 옛 페이지에는 없다 */
  match: ProductMatch.optional(),
  /** 상품 페이지 URL — 웹 검색 상품은 BFF 검증(http/https)을 거쳐 채워진다. FE 상세보기 패널이 연다 */
  url: z.string().optional(),
  /** url 종류 — pdp(기본): 상품 상세 페이지 / search: 상세 페이지를 못 찾아 그 몰의 검색 결과 주소를 대신 실은 웹 상품
   * (FE 카드 버튼이 「몰에서 찾기」가 되고 근거 신뢰 점수가 낮아진다, 2026-09) */
  urlKind: z.enum(['pdp', 'search']).optional(),
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
  /** 이 콘텐츠를 고른 이유 한 줄 — 답변을 인용 (5c 콘텐츠 단계가 채운다, 옛 페이지에는 없다) */
  why: z.string().optional(),
})
export type PlanContentItem = z.infer<typeof PlanContentItem>

/** 성분 비교표 한쪽 — 구체 상품이 아니라 **제품 유형**이다(기존/일반 제품 유형 · 이 계획이 권하는 제품 유형).
 * badge 는 카드 알약 문구("기존 제품"·"추천 기준"), name 은 유형 이름, short 는 표 머리에 쓸 짧은 이름(없으면 name) */
export const CompareSide = z.object({
  badge: z.string(),
  name: z.string(),
  short: z.string().optional(),
})
export type CompareSide = z.infer<typeof CompareSide>

/** 성분 비교표 행 — 성분 이름 · 기존 열 값(있음/없음/소량) · 추천 열 값 · 위험도(높음/중간/낮음 — 없으면 열을 숨긴다) */
export const CompareRow = z.object({
  ingredient: z.string(),
  alt: z.string(),
  pick: z.string(),
  risk: z.string().optional(),
})
export type CompareRow = z.infer<typeof CompareRow>

/** 주의 성분 항목 — 이름(한글 + 영문/INCI 병기) · 왜 주의하는지 한 줄 */
export const CautionItem = z.object({ name: z.string(), note: z.string() })
export type CautionItem = z.infer<typeof CautionItem>

export const PlanSectionWire = z.discriminatedUnion('kind', [
  /* 단계 안내 — 제목 · 서브타이틀(단계의 목적 한 줄, 뼈대 프롬프트가 채운다 — 옛 페이지는 없음) · 본문 */
  z.object({ kind: z.literal('guide'), title: z.string(), subtitle: z.string().optional(), body: z.string() }),
  /* 가상 메이크업 결과 — 사진 질문에 답한 쓰레드에서만 만들어진다. FE는 기기에 남은 사진을
     BEFORE로, 같은 사진에 룩을 올린 것을 AFTER로 비포/애프터 컴포넌트에 투영한다
     (합성은 화면에서 — 서버는 어떤 룩인지(tone + spec)만 정한다) */
  z.object({
    kind: z.literal('look'),
    title: z.string(),
    desc: z.string(),
    tone: LookTone,
    /** 화면용 포인트 문구 — spec 이 있으면 부위별 note 에서 파생된 값(BFF `skeletonSectionWire` — 부위 4 + 범위 안 헤어·옷, 최대 6), 옛 페이지는 LLM 원문 */
    points: z.array(z.string()).max(6).optional(),
    /** 룩 사양 — 기기 합성·정밀 렌더가 소비하는 한 원천 (v23 부터, 옛 페이지에는 없음) */
    spec: LookSpec.optional(),
  }),
  /* 성분 비교표 — 기존(일반) 제품 유형 vs 이 계획이 권하는 제품 유형을 성분별로 대조 (FE ingredientCompare).
     뼈대(5a)가 성분이 판단 기준인 의도(면도 자극·민감·성분 비교 요청)에서만 만든다 — 제품 유형·기준 수준이라 검색 없이
     쓸 수 있고, 그 기준으로 고른 실제 상품은 바로 뒤 상품 자리가 채운다 (v26, 2026-09) */
  z.object({
    kind: z.literal('compare'),
    title: z.string(),
    alt: CompareSide,
    pick: CompareSide,
    rows: z.array(CompareRow).min(1),
  }),
  /* 주의 성분 — 이 고민에서 먼저 확인할 성분 목록 (FE cautionIngredients). compare 와 같은 조건에서 뼈대가 만든다 */
  z.object({
    kind: z.literal('caution'),
    title: z.string(),
    desc: z.string().optional(),
    items: z.array(CautionItem).min(1),
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
