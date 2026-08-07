/*
 * 상품 태깅 검토 스튜디오의 데이터 계층.
 *
 * 상품 목록은 BFF 데모 카탈로그(apps/bff/src/llm/catalog.ts)의 FE 사본이다 — 상품별
 * 특징 태그가 라이브 생성의 상품 매칭(그라운딩) 근거라서, 태그가 어긋나면 추천 품질이
 * 바로 흔들린다. 이 스튜디오는 AI 1차 분류(필드별 태그 + 확신도 + 근거)를 사람이
 * 점검하는 곳: 애매한 필드(미검토)만 확인하고, 규칙 위반(수정 필요)을 고친 뒤
 * 작업 단위를 승인/반려한다.
 *
 * 검토 상태는 이 브라우저 localStorage에만 저장한다 — 계정 서버 동기화 기계 밖의
 * 검토 유틸이라서다. 기기 간 이동·카탈로그 반영은 JSON 내보내기가 담당한다.
 * (AI 확신도·근거는 데모용 목데이터 — 카탈로그 원본은 코드라 자동 반영되지 않는다)
 */

const STORE_KEY = 'ddak-tagging-review-v2'

/* ── 태그 사전 ── */
export const CATEGORIES = ['스킨케어', '색조메이크업', '선케어', '클렌징', '마스크팩', '미용기기', '두피·헤어', '기타']
export const SUBTYPES = {
  스킨케어: ['토너', '에센스', '세럼', '크림', '로션', '아이크림', '미스트', '패드'],
  색조메이크업: ['립', '블러셔', '쿠션', '파운데이션', '컨실러', '파우더', '아이섀도', '아이라이너', '마스카라', '브로우'],
  선케어: ['선크림', '선스틱', '선쿠션', '선스프레이'],
  클렌징: ['클렌징폼', '클렌징오일', '클렌징워터', '클렌징밤', '스크럽'],
  마스크팩: ['시트마스크', '워시오프팩', '슬리핑팩', '코팩'],
  미용기기: ['LED마스크', '진동클렌저', '마사지기', '제모기'],
  '두피·헤어': ['샴푸', '트리트먼트', '두피세럼', '헤어에센스', '헤어오일'],
  기타: ['기타'],
}
export const AREAS = ['얼굴전체', 'T존', '눈가', '입술', '치크', '아이', '눈썹', 'M자', '정수리', '두피전체', '모발', '바디']
export const SKIN_TYPES = ['모든피부', '건성', '지성', '복합성', '민감성', '트러블성']
export const SCALP_TYPES = ['모든두피', '지성두피', '건성두피', '민감두피']
export const CONCERNS = ['수분부족', '모공부각', '각질', '밀림·들뜸', '유분과다', '잡티·미백', '주름·탄력', '홍조·진정', '트러블', '다크서클', '블랙헤드', '색빠짐', '번짐', '묻어남', '가루날림', '두피유분', '가려움', '비듬', '모발가늘어짐']
export const RESULTS = ['뽀송', '촉촉물광', '은은한광', '얇고가벼움', '커버력', '톤업', '진정됨', '맑은생기', '또렷함', '특별함', '선명함', '자연스러움', '지속력', '산뜻함', '쿨링', '볼륨감', '저자극순함']
export const CONDITIONS = ['장시간', '야외·땀', '사진·촬영', '기념일', '데일리', '시술전후', '마스크착용']
export const CONFLICTS = [['뽀송', '촉촉물광'], ['건성', '지성'], ['수분부족', '유분과다'], ['지성두피', '건성두피']]

export const FIELD_DEFS = [
  { key: 'category', label: '대분류', min: 1, max: 1, required: true },
  { key: 'subtype', label: '세부유형', min: 1, max: 1, required: true },
  { key: 'area', label: '부위', min: 1, max: 1, required: true },
  { key: 'type', label: '타입', min: 1, max: 2, required: true },
  { key: 'concern', label: '고민', min: 0, max: 2, required: false },
  { key: 'result', label: '결과', min: 1, max: 2, required: true },
  { key: 'condition', label: '조건', min: 0, max: 1, required: false },
]

export const TAG_LIMIT = { min: 3, max: 8 }

export function optionsFor(key, category) {
  switch (key) {
    case 'category': return CATEGORIES
    case 'subtype': return category ? SUBTYPES[category] || [] : []
    case 'area': return AREAS
    case 'type': return category === '두피·헤어' ? SCALP_TYPES : SKIN_TYPES
    case 'concern': return CONCERNS
    case 'result': return RESULTS
    case 'condition': return CONDITIONS
    default: return []
  }
}

/* 작업 단위(승인/반려 포함)와 필드 공용 상태 표기 */
export const UNIT_STATUS = {
  done: { label: '검토 완료', cls: 'done' },
  unreviewed: { label: '미검토', cls: 'unreviewed' },
  fix: { label: '수정 필요', cls: 'fix' },
  approved: { label: '승인됨', cls: 'approved' },
  rejected: { label: '반려됨', cls: 'rejected' },
}

/* ── 시드 — 상품 정체성은 BFF 카탈로그(2026-08), 필드 분류·확신도·근거는 데모 목데이터 ── */
const gdimg = (goodsCode) => `https://gdimg.gmarket.co.kr/${goodsCode}/still/280`

/* 필드 한 칸: 선택 태그·대표(★)·AI 확신도·근거·검토 상태 */
const fd = (selected, rep, confidence, rationale, status = 'done') => ({
  selected,
  rep: selected.length === 1 ? selected[0] : rep,
  confidence,
  rationale,
  status,
  origin: 'ai',
})

export const TAGGING_SEED = [
  {
    id: 'p-001', brand: '라운드랩', name: '자작나무 수분 토너 300ml', option: '단일 옵션', price: 16900,
    imageUrl: gdimg('4075320386'), catalogTags: ['토너', '수분', '진정', '민감성'],
    copy: '자작나무 수액 베이스의 수분 토너. 저자극 처방, 민감 피부 테스트 완료 소구.',
    review: '“순하고 자극이 없다”, “속당김이 줄었다” 반복 언급. 데일리 토너로 무난하다는 평 다수.',
    fields: {
      category: fd(['스킨케어'], null, 97, '토너 — 스킨케어 카테고리 명확 (1순위: 객관적 상품 특성)'),
      subtype: fd(['토너'], null, 96, '제형·사용 방식 일치'),
      area: fd(['얼굴전체'], null, 94, '얼굴 전체 사용 제품'),
      type: fd(['민감성'], null, 90, '저자극 소구 + “자극 없다” 리뷰 반복'),
      concern: fd(['수분부족'], null, 88, '수분 공급이 핵심 소구 — 리뷰 근거 일치'),
      result: fd(['진정됨', '촉촉물광'], '진정됨', 82, '진정 소구 우선, 보습 마무리 후기 다수'),
      condition: fd(['데일리'], null, 76, '데일리 사용 후기 다수'),
    },
  },
  {
    id: 'p-002', brand: '아비브', name: '어성초 스팟 토너 패드 카밍터치 (본품+리필)', option: '본품+리필', price: 19800,
    imageUrl: gdimg('4446018108'), catalogTags: ['토너패드', '진정', '트러블'],
    copy: '어성초 추출물 진정 패드. 약산성, 피부 결 정돈 소구.',
    review: '“트러블 진정에 효과” 다수. 민감 피부 자극 여부는 후기 의견이 엇갈림.',
    fields: {
      category: fd(['스킨케어'], null, 96, '토너 패드 — 스킨케어 명확'),
      subtype: fd(['패드'], null, 95, '패드 제형 일치'),
      area: fd(['얼굴전체'], null, 92, '얼굴 전체 사용 제품'),
      type: fd(['트러블성', '민감성'], '트러블성', 62, '트러블 진정 후기 다수 — 민감성 적합 여부는 후기가 엇갈려 자동 확정 보류', 'unreviewed'),
      concern: fd(['트러블', '홍조·진정'], '트러블', 84, '진정·트러블 케어가 핵심 소구'),
      result: fd(['진정됨'], null, 86, '브랜드 소구와 리뷰 일치'),
      condition: fd([], null, 60, '특정 사용 조건 근거 없음 — 미적용'),
    },
  },
  {
    id: 'p-003', brand: '토리든', name: '다이브인 저분자 히알루론산 세럼 100ml+20ml', option: '100ml+20ml', price: 38500,
    imageUrl: gdimg('3694639295'), catalogTags: ['세럼', '수분', '속건조'],
    copy: '5중 저분자 히알루론산 수분 세럼. 즉각 수분 공급·진정 소구.',
    review: '“속건조가 잡힌다”, “물광 마무리” 반복. 각질 개선 언급도 다수.',
    fields: {
      category: fd(['스킨케어'], null, 97, '세럼 — 스킨케어 명확'),
      subtype: fd(['세럼'], null, 96, '제형 일치'),
      area: fd(['얼굴전체'], null, 94, '얼굴 전체 사용'),
      type: fd(['건성', '복합성'], '건성', 85, '수분 소구 + 건성 피부 후기 다수'),
      concern: fd(['수분부족', '각질'], '수분부족', 88, '핵심 고민 — 리뷰 반복 확인'),
      result: fd(['촉촉물광', '진정됨'], '촉촉물광', 83, '리뷰 “물광 마무리” 반복 + 진정 소구 — 단, 전체 태그 수 초과 상태', 'fix'),
      condition: fd(['데일리'], null, 78, '데일리 사용 후기 다수 — 전체 태그 수 초과로 보조 태그 축소 필요', 'fix'),
    },
  },
  {
    id: 'p-004', brand: '이니스프리', name: '레티놀 시카 흔적 앰플 50ml', option: '단일 옵션', price: 42750,
    imageUrl: gdimg('3775017167'), catalogTags: ['세럼', '주름', '탄력', '레티놀'],
    copy: '레티놀 + 시카 진정 결합 앰플. 흔적·탄력 케어와 저자극 사용감 소구.',
    review: '“화끈거림 없이 순하다”, “결이 정리된다” 언급 다수. 효과 체감 시점은 후기마다 상이.',
    fields: {
      category: fd(['스킨케어'], null, 96, '앰플 — 스킨케어 명확'),
      subtype: fd(['세럼'], null, 94, '앰플 제형 — 세럼 유형으로 분류'),
      area: fd(['얼굴전체'], null, 90, '얼굴 전체 사용'),
      type: fd(['모든피부'], null, 74, '레티놀 초심자용 저자극 소구 — 특정 타입 제한 근거 없음'),
      concern: fd(['주름·탄력'], null, 91, '탄력·흔적 케어가 핵심 소구'),
      result: fd(['진정됨'], null, 80, '시카 진정 결합 소구 + “순하다” 리뷰'),
      condition: fd([], null, 58, '특정 사용 조건 근거 없음 — 미적용'),
    },
  },
  {
    id: 'p-005', brand: '구달', name: '청귤 비타C 잡티 케어 세럼 30ml', option: '단일 옵션', price: 22000,
    imageUrl: gdimg('4468727856'), catalogTags: ['세럼', '미백', '잡티', '비타민'],
    copy: '청귤 비타민C 잡티 케어 세럼. 톤 보정·생기 소구.',
    review: '“얼굴이 밝아 보인다”, “잡티가 옅어진 것 같다” 반복. 산뜻한 사용감 언급 다수.',
    fields: {
      category: fd(['스킨케어'], null, 96, '세럼 — 스킨케어 명확'),
      subtype: fd(['세럼'], null, 95, '제형 일치'),
      area: fd(['얼굴전체'], null, 93, '얼굴 전체 사용'),
      type: fd(['모든피부'], null, 76, '특정 피부 타입 제한 근거 없음'),
      concern: fd(['잡티·미백'], null, 92, '비타C 잡티 케어가 핵심 소구 — 리뷰 일치'),
      result: fd(['맑은생기', '톤업'], '맑은생기', 81, '“밝아 보인다” 리뷰 + 생기 소구'),
      condition: fd([], null, 60, '특정 사용 조건 근거 없음'),
    },
  },
  {
    id: 'p-006', brand: '닥터지', name: '레드 블레미쉬 클리어 수딩 크림 50ml 듀오', option: '50ml 듀오', price: 28000,
    imageUrl: gdimg('3463379181'), catalogTags: ['크림', '진정', '수분', '민감성'],
    copy: '시카 진정 수분 크림. 예민해진 피부 진정 소구, 저자극 테스트 완료.',
    review: '“뒤집어졌을 때 바르면 가라앉는다” 반복. 여름철 산뜻한 제형 언급 다수.',
    fields: {
      category: fd(['스킨케어'], null, 96, '크림 — 스킨케어 명확'),
      subtype: fd(['크림'], null, 95, '제형 일치'),
      area: fd(['얼굴전체'], null, 93, '얼굴 전체 사용'),
      type: fd(['민감성', '트러블성'], '민감성', 88, '진정 소구 + 예민 피부 후기 반복'),
      concern: fd(['홍조·진정'], null, 85, '붉은기 진정이 핵심 소구'),
      result: fd(['진정됨'], null, 87, '브랜드 소구와 리뷰 일치'),
      condition: fd([], null, 60, '특정 사용 조건 근거 없음'),
    },
  },
  {
    id: 'p-007', brand: '에스트라', name: '아토베리어365 크림 80ml', option: '단일 옵션', price: 25000,
    imageUrl: null, catalogTags: ['크림', '장벽', '건성'],
    copy: '피부 장벽 보습 크림. 세라마이드 장벽 강화 소구, 더마 브랜드.',
    review: '“건조·당김이 확실히 줄었다” 반복. 민감한 피부도 무난하다는 평 다수.',
    fields: {
      category: fd(['스킨케어'], null, 96, '크림 — 스킨케어 명확'),
      subtype: fd(['크림'], null, 95, '제형 일치'),
      area: fd(['얼굴전체'], null, 92, '얼굴 전체 사용'),
      type: fd(['건성', '민감성'], '건성', 89, '장벽 보습 소구 + 건조 피부 후기 반복'),
      concern: fd(['수분부족'], null, 83, '건조·당김 완화가 핵심 근거'),
      result: fd(['저자극순함'], null, 85, '더마 저자극 소구와 리뷰 일치'),
      condition: fd([], null, 60, '특정 사용 조건 근거 없음'),
    },
  },
  {
    id: 'p-008', brand: '닥터지', name: '브라이트닝 업 선 플러스 SPF50+ 50ml', option: '단일 옵션', price: 21900,
    imageUrl: null, catalogTags: ['선크림', '톤업', '무기자차', '민감성'],
    copy: '톤업 무기자차 선크림. 백탁 최소화한 브라이트닝 마무리 소구.',
    review: '“화장 전 톤 보정용으로 좋다” 다수. 민감 피부 무자극 후기 반복.',
    tagRequest: { result: true },
    fields: {
      category: fd(['선케어'], null, 97, '선크림 — 선케어 명확'),
      subtype: fd(['선크림'], null, 96, '제형 일치'),
      area: fd(['얼굴전체'], null, 93, '얼굴 전체 사용'),
      type: fd(['민감성'], null, 87, '무기자차·저자극 소구 + 민감 피부 후기'),
      concern: fd([], null, 65, '특정 고민 근거 약함 — 미적용'),
      result: fd(['톤업'], null, 88, '톤업 마무리가 핵심 소구 — ‘무기자차’는 사전에 없는 값이라 태그 추가 요청으로 처리'),
      condition: fd(['데일리'], null, 72, '데일리 겸용 후기 다수'),
    },
  },
  {
    id: 'p-009', brand: '비오레', name: 'UV 아쿠아리치 워터리 에센스 선크림 70g', option: '단일 옵션', price: 12900,
    imageUrl: gdimg('3471531930'), catalogTags: ['선크림', '수분', '지성'],
    copy: '워터리 에센스 제형 선크림. 가볍고 산뜻한 발림 소구.',
    review: '“선크림 같지 않게 가볍다” 반복. 지성 피부 만족 후기 다수.',
    fields: {
      category: fd(['선케어'], null, 97, '선크림 — 선케어 명확'),
      subtype: fd(['선크림'], null, 96, '제형 일치'),
      area: fd(['얼굴전체'], null, 93, '얼굴 전체 사용'),
      type: fd(['지성'], null, 84, '산뜻한 워터리 제형 — 지성 만족 후기 반복'),
      concern: fd(['수분부족'], null, 74, '수분 에센스 소구 — 보조 근거'),
      result: fd(['산뜻함'], null, 86, '가벼운 발림·산뜻함이 핵심 리뷰'),
      condition: fd(['데일리'], null, 75, '데일리 사용 후기 다수'),
    },
  },
  {
    id: 'p-010', brand: '라운드랩', name: '1025 독도 클렌저 200ml', option: '단일 옵션', price: 14000,
    imageUrl: gdimg('3209544905'), catalogTags: ['클렌저', '약산성', '민감성'],
    copy: '약산성 pH 저자극 클렌징폼. 순한 세정·보습 세안 소구.',
    review: '“세안 후 당기지 않는다”, “자극 없다” 반복. 온 가족 사용 후기 다수.',
    fields: {
      category: fd(['클렌징'], null, 97, '제형·사용 방식이 클렌징으로 명확'),
      subtype: fd(['클렌징폼'], null, 95, '폼 타입 세안제 — 제형 일치'),
      area: fd(['얼굴전체'], null, 94, '얼굴 전체 세안용'),
      type: fd(['민감성'], null, 90, '약산성 포뮬러 + “자극 없다” 리뷰 반복'),
      concern: fd([], null, 68, '특정 고민 근거 없음 — 미적용'),
      result: fd(['저자극순함', '산뜻함'], '저자극순함', 88, '순한 세정이 핵심 소구 — 리뷰 반복 확인'),
      condition: fd(['데일리'], null, 77, '데일리 세안 후기 다수'),
    },
  },
  {
    id: 'p-011', brand: '마녀공장', name: '퓨어 클렌징 오일 200ml 더블 기획 (+55ml)', option: '더블 기획 (+55ml)', price: 33000,
    imageUrl: gdimg('4419642825'), catalogTags: ['클렌징오일', '모공', '블랙헤드'],
    copy: '피지 용해 클렌징 오일. 모공 속 노폐물·블랙헤드 케어 소구.',
    review: '“코 블랙헤드가 줄었다” 반복. 세정 후 미끈거림은 후기 엇갈림.',
    fields: {
      category: fd(['클렌징'], null, 97, '클렌징 오일 — 카테고리 명확'),
      subtype: fd(['클렌징오일'], null, 96, '제형 일치'),
      area: fd(['얼굴전체'], null, 92, '얼굴 전체 세안용'),
      type: fd(['모든피부'], null, 68, '특정 타입 제한 근거 약함 — 자동 확정 보류', 'unreviewed'),
      concern: fd(['모공부각', '블랙헤드'], '모공부각', 89, '모공·블랙헤드 케어가 핵심 소구 — 리뷰 일치'),
      result: fd(['산뜻함'], null, 78, '세정 후 산뜻함 소구 — 후기 일부 엇갈림'),
      condition: fd([], null, 60, '특정 사용 조건 근거 없음'),
    },
  },
  {
    id: 'p-012', brand: '클리오', name: '킬커버 더뉴 파운웨어 쿠션 (본품+리필)', option: '본품+리필', price: 32000,
    imageUrl: gdimg('4123344949'), catalogTags: ['쿠션', '베이스', '커버', '지속력'],
    copy: '브랜드 소구: “하루 종일 무너지지 않는 초밀착 지속력”, 하이커버 강조.',
    review: '커버력 만족 다수. 다만 “마스크에 묻어난다” 후기가 반복 확인됨 → 브랜드의 지속력 소구와 충돌.',
    fields: {
      category: fd(['색조메이크업'], null, 97, '쿠션 파운데이션 — 색조 카테고리 명확'),
      subtype: fd(['쿠션'], null, 96, '제형 일치'),
      area: fd(['얼굴전체'], null, 93, '베이스 메이크업 — 얼굴 전체'),
      type: fd(['모든피부'], null, 80, '특정 피부 타입 제한 근거 없음'),
      concern: fd(['묻어남'], null, 55, '리뷰에서 “마스크에 묻어남” 반복 — 단, 브랜드 소구(지속력)와 충돌해 자동 확정 보류', 'unreviewed'),
      result: fd(['커버력', '지속력'], '커버력', 58, '커버력은 근거 일치. ‘지속력’은 브랜드 소구 vs 리뷰(묻어남) 충돌 — 미검토', 'unreviewed'),
      condition: fd(['장시간'], null, 75, '브랜드가 장시간 지속을 핵심 소구로 반복'),
    },
  },
  {
    id: 'p-013', brand: '이니스프리', name: '노세범 미네랄 파우더 팩트 8.5g', option: '단일 옵션', price: 12000,
    imageUrl: gdimg('4314605095'), catalogTags: ['파우더', '픽서', '유분', '지속력'],
    copy: '피지 흡착 미네랄 파우더. 번들거림 없는 뽀송 마무리 소구.',
    review: '“T존 유분이 잡힌다”, “화장이 덜 무너진다” 반복 언급.',
    fields: {
      category: fd(['색조메이크업'], null, 95, '메이크업 픽서 파우더 — 색조 분류'),
      subtype: fd(['파우더'], null, 94, '제형 일치'),
      area: fd(['얼굴전체'], null, 88, 'T존 부분 사용 후기도 있으나 전체 사용이 다수'),
      type: fd(['지성'], null, 86, '피지 흡착 소구 + 지성 피부 후기 반복'),
      concern: fd(['유분과다'], null, 90, '번들거림 억제가 핵심 소구 — 리뷰 일치'),
      result: fd(['뽀송', '지속력'], '뽀송', 87, '뽀송 마무리 + 화장 지속 후기'),
      condition: fd(['장시간'], null, 74, '“화장이 덜 무너진다” — 장시간 근거'),
    },
  },
  {
    id: 'p-014', brand: '롬앤', name: '더 쥬시 래스팅 틴트', option: '단일 옵션', price: 13000,
    imageUrl: null, catalogTags: ['립', '틴트', '보습'],
    copy: '과즙 광택의 쥬시 립 틴트. 선명 발색 + 촉촉 지속 소구.',
    review: '“발색이 선명하고 오래간다” 반복. 지속 시 건조함은 후기 소수 언급.',
    fields: {
      category: fd(['색조메이크업'], null, 96, '립 틴트 — 색조 명확'),
      subtype: fd(['립'], null, 95, '립 제품 — 제형 일치'),
      area: fd(['입술'], null, 96, '입술 전용'),
      type: fd(['모든피부'], null, 75, '피부 타입 무관 립 제품'),
      concern: fd(['색빠짐'], null, 62, '지속 발색 소구의 이면 고민 — 근거 보통'),
      result: fd(['선명함', '지속력'], '선명함', 84, '선명 발색·래스팅이 핵심 소구 — 리뷰 일치'),
      condition: fd(['데일리'], null, 73, '데일리 사용 후기 다수'),
    },
  },
]

/* 이미지 없는 상품의 이모지 목업 — 카탈로그 대표 태그(첫 태그)에서 고른다 */
const TAG_EMOJI = {
  토너: '🧴', 토너패드: '🧴', 세럼: '💧', 크림: '🫙', 선크림: '🌞',
  클렌저: '🫧', 클렌징오일: '🫧', 쿠션: '🪞', 파우더: '🪞', 립: '💄',
}
export const productEmoji = (tags) => TAG_EMOJI[(tags && tags[0]) || ''] || '🧴'

/* ── 파생값·검증 ── */
export const totalTags = (unit) =>
  FIELD_DEFS.reduce((n, d) => n + unit.fields[d.key].selected.length, 0)

export function validateUnit(unit) {
  const errs = []
  const warns = []
  const category = unit.fields.category.selected[0]
  const total = totalTags(unit)
  if (total > TAG_LIMIT.max) errs.push(`전체 태그 ${total}개 — 최대 ${TAG_LIMIT.max}개 초과. 핵심과 관련성이 낮은 보조 태그를 줄여주세요.`)
  if (total < TAG_LIMIT.min) errs.push(`전체 태그 ${total}개 — 최소 ${TAG_LIMIT.min}개 필요.`)
  for (const def of FIELD_DEFS) {
    const field = unit.fields[def.key]
    if (def.required && field.selected.length === 0) errs.push(`‘${def.label}’은(는) 필수 입력입니다.`)
    if (field.selected.length > 1 && !field.selected.includes(field.rep)) errs.push(`‘${def.label}’ 복수 선택 — 대표 태그(★)를 지정해주세요.`)
    const allow = optionsFor(def.key, category)
    for (const tag of field.selected) {
      if (!allow.includes(tag)) errs.push(`‘${def.label}’의 “${tag}”는 현재 허용 목록에 없는 값입니다.`)
    }
  }
  const all = FIELD_DEFS.flatMap((d) => unit.fields[d.key].selected)
  for (const [a, b] of CONFLICTS) {
    if (all.includes(a) && all.includes(b)) warns.push(`“${a}”와 “${b}”는 충돌 가능성이 있는 조합입니다.`)
  }
  for (const [key, on] of Object.entries(unit.tagRequest || {})) {
    if (!on) continue
    const def = FIELD_DEFS.find((d) => d.key === key)
    if (def) warns.push(`‘${def.label}’에 신규 태그 추가 요청이 있습니다 — 임의 생성 대신 요청으로 처리됩니다.`)
  }
  return { errs, warns }
}

export function unitStatusKey(unit) {
  if (unit.decision === 'approved') return 'approved'
  if (unit.decision === 'rejected') return 'rejected'
  if (validateUnit(unit).errs.length) return 'fix'
  if (FIELD_DEFS.some((d) => unit.fields[d.key].status === 'unreviewed')) return 'unreviewed'
  return 'done'
}

/* ── 저장/복원 — 저장본을 시드에 겹친다: 목록·확신도·근거의 원천은 언제나 시드 ── */
const cloneFields = (fields) => Object.fromEntries(
  Object.entries(fields).map(([key, field]) => [key, { ...field, selected: [...field.selected] }])
)

const freshUnit = (seed) => ({
  ...seed,
  fields: cloneFields(seed.fields),
  tagRequest: { ...(seed.tagRequest || {}) },
  decision: null,
  note: '',
})

const FIELD_STATUSES = ['done', 'unreviewed', 'fix']

export function loadTaggingReview() {
  let stored = null
  try {
    stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
  } catch {
    stored = null
  }
  const byId = new Map(
    stored && Array.isArray(stored.units) ? stored.units.map((u) => [u.id, u]) : []
  )
  return TAGGING_SEED.map((seed) => {
    const unit = freshUnit(seed)
    const saved = byId.get(seed.id)
    if (!saved) return unit
    if (saved.decision === 'approved' || saved.decision === 'rejected') unit.decision = saved.decision
    if (typeof saved.note === 'string') unit.note = saved.note
    if (saved.tagRequest && typeof saved.tagRequest === 'object') {
      unit.tagRequest = Object.fromEntries(
        Object.entries(saved.tagRequest).filter(([key]) => FIELD_DEFS.some((d) => d.key === key)).map(([key, on]) => [key, !!on])
      )
    }
    if (saved.fields && typeof saved.fields === 'object') {
      for (const def of FIELD_DEFS) {
        const savedField = saved.fields[def.key]
        if (!savedField || !Array.isArray(savedField.selected)) continue
        const field = unit.fields[def.key]
        field.selected = savedField.selected.filter((t) => typeof t === 'string' && t.trim())
        field.rep = field.selected.length === 1
          ? field.selected[0]
          : (field.selected.includes(savedField.rep) ? savedField.rep : null)
        if (FIELD_STATUSES.includes(savedField.status)) field.status = savedField.status
        if (savedField.origin === 'human') field.origin = 'human'
      }
    }
    return unit
  })
}

export function saveTaggingReview(units) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      units: units.map((u) => ({
        id: u.id,
        decision: u.decision,
        note: u.note,
        tagRequest: u.tagRequest,
        fields: Object.fromEntries(FIELD_DEFS.map((d) => {
          const f = u.fields[d.key]
          return [d.key, { selected: f.selected, rep: f.rep, status: f.status, origin: f.origin }]
        })),
      })),
    }))
  } catch {
    /* 저장 실패(용량 등)는 조용히 무시 — 검토 유틸이라 치명적이지 않다 */
  }
}

export function resetTaggingReview() {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* noop */
  }
  return TAGGING_SEED.map(freshUnit)
}

/* 내보내기 봉투 — 검토 결과를 카탈로그(코드)에 반영하거나 다른 기기로 옮길 때 */
export function taggingExportPayload(units) {
  return {
    format: 'ddak-tagging-review',
    version: 2,
    exportedAt: new Date().toISOString(),
    units: units.map((u) => ({
      id: u.id,
      brand: u.brand,
      name: u.name,
      option: u.option,
      status: unitStatusKey(u),
      decision: u.decision,
      note: u.note,
      catalogTags: u.catalogTags,
      tagRequest: Object.keys(u.tagRequest || {}).filter((key) => u.tagRequest[key]),
      fields: Object.fromEntries(FIELD_DEFS.map((d) => {
        const f = u.fields[d.key]
        return [d.key, { selected: f.selected, rep: f.rep, origin: f.origin, status: f.status }]
      })),
      finalTags: FIELD_DEFS.flatMap((d) => u.fields[d.key].selected),
    })),
  }
}
