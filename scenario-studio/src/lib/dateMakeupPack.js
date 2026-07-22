import { createAccount, createItem, createScenario } from './store.js'
import { LIBRARY } from './registry.jsx'

export const DATE_MAKEUP_PACK_ID = 'date-makeup-all-cases-v1'
export const DATE_MAKEUP_CASE_COUNT = 72

const QUERY = '소개팅 때 안 무너지는 메이크업 추천'
const INTENT_REASON = '소개팅이라는 상황에서 장시간 무너지지 않는 베이스 메이크업 완성이 목적'

export const DATE_MAKEUP_QUESTIONS = [
  {
    key: 'base',
    title: '베이스에서 가장 걱정되는 부분은?',
    stepName: '베이스 고민 케어',
    essential: true,
    options: ['밀림', '모공부각', '각질', '번들거림', '다크닝', '뜸'],
  },
  {
    key: 'finish',
    title: '원하는 피부 표현은?',
    stepName: '피부 표현 세팅',
    essential: false,
    options: ['은은한 물광', '촉촉한 물광', '뽀송', '얇고 가벼운'],
  },
  {
    key: 'place',
    title: '소개팅 장소는?',
    stepName: '장소 대비 지속력',
    essential: true,
    options: ['실내 카페·식당', '야외', '술자리·장시간'],
  },
]

/* 첨부 HTML의 SOLUTION_MAP을 스튜디오 데이터로 옮긴 원본 데이터. */
export const DATE_MAKEUP_SOLUTIONS = {
  모공부각: {
    headline: '모공부각 → 프라이머',
    tip: '프라이머는 소량만! 나비존 부분으로 롤링해서 발라 주세요.',
    howto: ['쌀알 크기 소량만 덜기', '코 옆 나비존 중심으로', '문지르지 말고 손끝으로 롤링'],
    products: [
      { brand: '바닐라코', name: '프라임 프라이머 클래식 30ml', price: 15900, was: 24000, score: 98, emoji: '🧴', grad: 'linear-gradient(135deg,#fce3ec,#f6d0dd)', sum: ['모공·요철을 부드럽게 메워주는 스테디셀러', '수부지도 당김 없이 매끈한 베이스 완성'] },
      { brand: '베네피트', name: '더 포어페셔널 프라이머 22ml', price: 42500, was: 52000, score: 93, emoji: '🫙', grad: 'linear-gradient(135deg,#ffe9d6,#ffd9b8)', sum: ['나비존 모공 블러 효과로 유명한 포어 프라이머', '소량으로도 매끈하게 정돈되는 발림성'] },
      { brand: '보나메두사', name: '프라이머 오렌지 스킨 (딜리트 그린 택1)', price: 18900, was: 26000, score: 90, emoji: '🍊', grad: 'linear-gradient(135deg,#ffe4cf,#d8f2d8)', sum: ['오렌지 스킨은 톤 보정, 그린은 홍조 커버', '여름 쿨톤 라이트 베이스와 궁합이 좋아요'] },
    ],
  },
  밀림: {
    headline: '밀림 방지 → 가벼운 레이어링',
    tip: '스킨케어를 가볍게 줄이고, 완전히 흡수시킨 뒤 베이스를 얇게 여러 번 나눠 올리세요.',
    howto: ['기초는 2단계 이내로 가볍게', '흡수 후 1~2분 텀 두기', '쿠션은 얇게 2회 레이어링'],
    products: [
      { brand: '클리오', name: '킬커버 픽서 쿠션', price: 22900, was: 32000, score: 95, emoji: '🪞', grad: 'linear-gradient(135deg,#e8e4ff,#d5cdfa)', sum: ['밀착력 좋은 픽서 타입으로 밀림 최소화', '커버력과 지속력의 균형이 좋아요'] },
      { brand: '에스쁘아', name: '비벨벳 커버 파운데이션', price: 24500, was: 34000, score: 91, emoji: '🧴', grad: 'linear-gradient(135deg,#f3e3d6,#e7cdb8)', sum: ['얇게 발려 뭉침·밀림이 적은 벨벳 피니시', '소량씩 나눠 바르기에 적합한 제형'] },
    ],
  },
  각질: {
    headline: '각질 정돈 → 결 케어 먼저',
    tip: '메이크업 전 토너 패드로 각질을 정돈하고, 크림으로 피부를 유연하게 만들어 주세요.',
    howto: ['토너 패드로 결 정돈', '보습크림 얇게 흡수', '베이스는 촉촉 타입 선택'],
    products: [
      { brand: '라운드랩', name: '1025 독도 토너 패드', price: 16900, was: 22000, score: 94, emoji: '🩹', grad: 'linear-gradient(135deg,#dff0fb,#c9e4f6)', sum: ['저자극으로 들뜬 각질을 부드럽게 정돈', '메이크업 전 결 정리 루틴에 딱'] },
      { brand: '피지오겔', name: 'DMT 페이셜 크림', price: 23900, was: 30000, score: 90, emoji: '🫧', grad: 'linear-gradient(135deg,#e8f6ef,#d2ecdd)', sum: ['각질 들뜸을 잡아주는 고보습 크림', '끈적임 없이 베이스 전 단계로 무난'] },
    ],
  },
  번들거림: {
    headline: '번들거림 → 피지 컨트롤',
    tip: 'T존 위주로 피지 컨트롤 프라이머를 얇게, 수정할 땐 기름종이로 유분 제거 후 팩트로 마무리하세요.',
    howto: ['T존만 세범 프라이머', '기름종이 → 팩트 순서로 수정', '볼은 과하게 매트하지 않게'],
    products: [
      { brand: '이니스프리', name: '노세범 블러 프라이머', price: 12000, was: 15000, score: 93, emoji: '🌿', grad: 'linear-gradient(135deg,#e4f3e0,#cfe9c8)', sum: ['피지 흡착으로 T존 번들거림 억제', '가볍게 발려 데일리로 부담 없어요'] },
      { brand: '에뛰드', name: '제로 세범 드라잉 파우더', price: 6500, was: 9000, score: 90, emoji: '🥚', grad: 'linear-gradient(135deg,#fdeef3,#f8dbe6)', sum: ['초미세 파우더로 유분기만 잡아주는 픽스', '가방에 넣기 좋은 수정용 아이템'] },
    ],
  },
  다크닝: {
    headline: '다크닝 → 산화 방지 조합',
    tip: '산화가 적은 파운데이션에 톤 보정 베이스를 조합하면 시간이 지나도 칙칙해지지 않아요.',
    howto: ['피지 산화 막는 프라이머 먼저', '본인 톤보다 밝은 호수 금지', '반 톤 보정 베이스로 마무리'],
    products: [
      { brand: '정샘물', name: '에센셜 스킨 누더 파운데이션', price: 38000, was: 45000, score: 94, emoji: '🧴', grad: 'linear-gradient(135deg,#f5e8dc,#ead6c3)', sum: ['시간이 지나도 톤 변화가 적은 세미매트', '여름 쿨톤 라이트 호수 선택 추천'] },
      { brand: '메이크업포에버', name: 'HD 스킨 파운데이션', price: 52000, was: 62000, score: 91, emoji: '🎨', grad: 'linear-gradient(135deg,#efe3f5,#dfc9ec)', sum: ['다크닝 적기로 유명한 롱웨어 베이스', '얇은 막감으로 자연스러운 피부 표현'] },
    ],
  },
  뜸: {
    headline: '들뜸 → 속수분 채우기',
    tip: '수분 부족이 원인이에요. 수분 앰플로 속을 채운 뒤 촉촉한 타입 쿠션을 사용해 주세요.',
    howto: ['수분 앰플 1~2방울 흡수', '크림은 얇게 마무리', '촉촉 타입 쿠션으로 밀착'],
    products: [
      { brand: '토리든', name: '다이브인 저분자 히알루론산 세럼', price: 14900, was: 23000, score: 95, emoji: '💧', grad: 'linear-gradient(135deg,#dcf1fb,#c3e6f8)', sum: ['속건조를 빠르게 채우는 수분 세럼', '수부지 베이스 전 단계로 인기'] },
      { brand: '헤라', name: '글로우 래스팅 쿠션', price: 42000, was: 50000, score: 92, emoji: '🪞', grad: 'linear-gradient(135deg,#1c1c22,#3a3a44)', sum: ['촉촉하게 밀착돼 들뜸을 잡아주는 쿠션', '광 있는 마무리로 생기 표현까지'] },
    ],
  },
  뽀송: {
    headline: '뽀송 → 파우더',
    tip: '베이스 메이크업 이후 파우더로 마무리해 주세요.',
    howto: ['퍼프에 소량만 덜어내기', 'T존 → 볼 순서로 눌러서 픽스', '수정 시에도 문지르지 말고 프레스'],
    products: [
      { brand: '어바웃톤', name: '블러 파우더 팩트 9g · 01 페어', price: 12800, was: 18000, score: 97, emoji: '🫧', grad: 'linear-gradient(135deg,#f2ecfb,#e2d6f5)', sum: ['보송한 블러 피니시로 모공까지 커버', '수부지에 부담 없는 가벼운 사용감'] },
      { brand: '이니스프리', name: '노세범 미네랄 파우더 5g', price: 6000, was: 8000, score: 95, emoji: '🌿', grad: 'linear-gradient(135deg,#e4f3e0,#cfe9c8)', sum: ['국민 피지 픽스 파우더, T존 뽀송 유지', '휴대해서 수정용으로도 활용도 최고'] },
      { brand: '입큰', name: '퍼스널 톤 코렉팅 블러 팩트 5.5g', price: 14900, was: 22000, score: 91, emoji: '🎀', grad: 'linear-gradient(135deg,#fde8ef,#f8cfdd)', sum: ['톤 보정과 블러를 동시에 잡는 팩트', '여름 쿨톤 안색을 화사하게 정리'] },
    ],
  },
  '은은한 물광': {
    headline: '은은한 물광 → 포인트 광',
    tip: '광채 프라이머를 소량 섞고, 하이라이터는 광대 위쪽에만 은은하게 얹어 주세요.',
    howto: ['베이스에 광채 프라이머 1방울 믹싱', '하이라이터는 광대 위·콧대만', 'T존 유분과 광 구분하기'],
    products: [
      { brand: '바닐라코', name: '프라임 프라이머 하이라이팅', price: 16900, was: 24000, score: 93, emoji: '✨', grad: 'linear-gradient(135deg,#fff3d9,#ffe6b8)', sum: ['펄 없이 은은한 윤광을 만드는 베이스', '무너져도 티가 덜 나는 자연 광'] },
      { brand: '클리오', name: '프리즘 에어 하이라이터', price: 15500, was: 21000, score: 91, emoji: '💫', grad: 'linear-gradient(135deg,#fdeef3,#f6d8e4)', sum: ['미세 펄로 부담 없는 포인트 광 연출', '쿨톤에 잘 맞는 라벤더 베이스 컬러'] },
    ],
  },
  '촉촉한 물광': {
    headline: '촉촉한 물광 → 수분 믹싱',
    tip: '수분 세럼을 베이스에 믹싱해 얇게 펴 바르고, 파우더는 T존에만 최소로 사용하세요.',
    howto: ['세럼 1방울 + 쿠션 믹싱', '얼굴 중앙부터 바깥으로', '파우더는 T존만 살짝'],
    products: [
      { brand: '헤라', name: '글로우 래스팅 쿠션', price: 42000, was: 50000, score: 94, emoji: '🪞', grad: 'linear-gradient(135deg,#1c1c22,#3a3a44)', sum: ['광이 오래 유지되는 글로우 쿠션', '촉촉하지만 무너짐이 적은 밀착력'] },
      { brand: '라네즈', name: '네오 쿠션 글로우', price: 28000, was: 38000, score: 92, emoji: '💦', grad: 'linear-gradient(135deg,#e0f0fb,#c8e2f7)', sum: ['수분광 표현에 특화된 글로우 피니시', '가벼운 막감으로 데이트 룩에 적합'] },
    ],
  },
  '얇고 가벼운': {
    headline: '얇고 가벼운 → 스킨 틴트',
    tip: '스킨 틴트나 세럼 파운데이션으로 얇게 깔고, 결점 부위만 컨실러로 보완하세요.',
    howto: ['틴트 베이스 얇게 1회', '잡티만 컨실러 포인트 커버', '브러시로 경계 블렌딩'],
    products: [
      { brand: '정샘물', name: '스킨 세팅 톤업 선베이스', price: 28000, was: 34000, score: 93, emoji: '🌤️', grad: 'linear-gradient(135deg,#fdf1e3,#f7e0c8)', sum: ['자차 겸용으로 자연스러운 반 톤업', '얇고 가벼운 원스텝 베이스'] },
      { brand: '에스쁘아', name: '테이핑 컨실러', price: 12000, was: 16000, score: 91, emoji: '🖍️', grad: 'linear-gradient(135deg,#f3e3d6,#e7cdb8)', sum: ['부분 결점만 정확하게 커버', '얇은 베이스 위에도 티 안 나는 밀착'] },
    ],
  },
  '술자리·장시간': {
    headline: '장시간 지속력 → 픽서',
    tip: '기초 단계 이후 메이크업 픽서 한 번, 메이크업 마무리 후 픽서 두 번!',
    howto: ['기초 흡수 후 픽서 1회 분사', '메이크업 완성 후 픽서 2회', '20cm 거리에서 X자 → T자 분사'],
    products: [
      { brand: '쏘내추럴', name: '올 데이 타이트 메이크업 세팅 픽서 75ml', price: 16900, was: 24000, score: 98, emoji: '💨', grad: 'linear-gradient(135deg,#e6f7e6,#cdeecd)', sum: ['국내 픽서 스테디셀러, 강한 고정력', '술자리·장시간 일정에 딱 맞는 지속력'] },
      { brand: '어반디케이', name: '올나이터 메이크업 세팅 픽서 30ml', price: 25900, was: 39000, score: 94, emoji: '🌙', grad: 'linear-gradient(135deg,#e5e1f7,#cfc7ef)', sum: ['최대 16시간 지속으로 유명한 글로벌 픽서', '미스트 입자가 고와 화장이 안 뭉쳐요'] },
      { brand: '에뛰드', name: '소프트 픽스 메이크업 픽서', price: 9900, was: 13000, score: 90, emoji: '🎀', grad: 'linear-gradient(135deg,#fde8ef,#f8cfdd)', sum: ['가성비 좋은 데일리 픽서 입문템', '산뜻한 마무리로 덧뿌리기 부담 없음'] },
    ],
  },
  '실내 카페·식당': {
    headline: '실내 조명 → 세미매트 + 립 지속',
    tip: '실내 조명에선 과한 광보다 세미매트가 사진에 잘 받아요. 립은 식사에도 남는 지속형으로.',
    howto: ['베이스는 세미매트 피니시', '식사 전 립 티슈오프 후 재발색', '블러셔로 생기 포인트'],
    products: [
      { brand: '롬앤', name: '쥬시 래스팅 틴트', price: 8900, was: 13000, score: 94, emoji: '🍒', grad: 'linear-gradient(135deg,#ffe3e3,#ffc9cf)', sum: ['식사 후에도 예쁘게 남는 국민 틴트', '여름 쿨톤 추천 컬러 라인업 풍부'] },
      { brand: '페리페라', name: '잉크 무드 매트 틴트', price: 9000, was: 12000, score: 91, emoji: '💋', grad: 'linear-gradient(135deg,#fddde6,#f7c3d4)', sum: ['보송한 매트 발색으로 실내 조명에 최적', '가볍게 발려 덧발라도 안 뭉쳐요'] },
    ],
  },
  야외: {
    headline: '야외 → 자외선 + 수정템',
    tip: '자외선 차단은 필수! 톤업 선크림으로 베이스를 잡고, 수정용 선팩트를 챙기세요.',
    howto: ['톤업 선크림으로 베이스 시작', '2~3시간마다 선팩트 덧발라 주기', '기름종이로 유분 먼저 제거'],
    products: [
      { brand: '닥터지', name: '그린 마일드 업 선 플러스 SPF50+', price: 19900, was: 28000, score: 95, emoji: '☀️', grad: 'linear-gradient(135deg,#e2f3e2,#cbe9cb)', sum: ['백탁 없이 자연스러운 톤업 선크림', '민감성도 무난한 순한 처방'] },
      { brand: 'AHC', name: '마스터즈 에어리치 선팩트', price: 15900, was: 25000, score: 92, emoji: '🪞', grad: 'linear-gradient(135deg,#fff0dc,#ffe2bd)', sum: ['메이크업 위에 덧바르는 수정용 선팩트', '보송 마무리로 야외 데이트 필수템'] },
    ],
  },
}

const COLORS = ['#b45a6b', '#7b5a86', '#4a6b8a', '#a9762c', '#5b6673', '#5f7465']

function make(type, props, y, w = 672, h = null) {
  const item = createItem(type, { ...LIBRARY[type].defaults, ...props })
  item.x = 24
  item.y = y
  item.w = w
  item.h = h
  return item
}

function productGroup(question, answer, solution, y) {
  const group = make('hscroll', {
    title: `${question.stepName} · ${answer} 추천 상품`,
    cardW: '232',
    scrollbar: false,
    items: '',
  }, y)
  const children = solution.products.map((product, slot) => {
    const child = make('productCard', {
      brand: product.brand,
      name: product.name,
      price: product.price.toLocaleString('ko-KR'),
      was: product.was.toLocaleString('ko-KR'),
      score: String(product.score),
      summary: product.sum.join('\n'),
      emoji: product.emoji,
      gradient: product.grad,
      imageUrl: '',
    }, 0, 232)
    child.x = 0
    child.y = 0
    child.parentId = group.id
    child.slot = slot
    return child
  })
  return [group, ...children]
}

function buildStages(answers) {
  const survey = [
    make('profilePanel', { hint: '첨부 소스의 선아 프로필을 반영했어요', hidden: '' }, 24),
    make('surveyIntro', {
      kicker: 'DDAK Scenario Studio · All Cases',
      title: '소개팅 때 안 무너지는 메이크업을 위해 3가지를 확인해요',
      desc: '이 시나리오는 전체 선택 조합 중 하나를 검토할 수 있도록 답변이 미리 선택되어 있어요.',
    }, 194),
    ...DATE_MAKEUP_QUESTIONS.map((question, index) => make('surveyQuestion', {
      question: question.title,
      options: question.options.join(', '),
      multi: false,
      maxPerRow: index === 0 ? '3' : String(question.options.length),
      optionShape: 'pill',
      horizontalScroll: true,
      defaultAnswer: answers[index],
      locked: true,
    }, 438 + index * 164)),
    make('noticeCard', {
      title: '이 케이스의 선택',
      body: DATE_MAKEUP_QUESTIONS.map((q, i) => `${q.stepName}: ${answers[i]}`).join('\n'),
    }, 930),
  ]

  const solutions = answers.map((answer) => DATE_MAKEUP_SOLUTIONS[answer])
  const productCount = solutions.reduce((sum, solution) => sum + solution.products.length, 0)
  const total = solutions.flatMap((solution) => solution.products).reduce((sum, product) => sum + product.price, 0)
  const plan = [
    make('surveySummary', { title: '선아님의 선택 요약' }, 24),
    make('planTitle', {
      kicker: 'DDAK Plan · All Selection Cases',
      title: '선아님, 소개팅 끝까지 안 무너지는 플랜이에요 💚',
    }, 178),
    make('noticeCard', {
      title: '플랜 구성 기준',
      body: `${INTENT_REASON}\n수부지 × 여름 쿨톤 프로필을 반영했어요.`,
    }, 300),
  ]

  let y = 440
  DATE_MAKEUP_QUESTIONS.forEach((question, index) => {
    const answer = answers[index]
    const solution = solutions[index]
    plan.push(make('planStep', {
      no: String(index + 1),
      title: solution.headline,
      desc: `${question.title} → ${answer} 선택 기준으로 구성했어요.\n딱's TIP · ${solution.tip}`,
      points: solution.howto.join(', '),
    }, y))
    y += 280
    plan.push(...productGroup(question, answer, solution, y))
    y += 380
  })
  plan.push(make('ctaBar', {
    countLabel: `추천 상품 ${productCount}개`,
    price: `${total.toLocaleString('ko-KR')}원`,
    buttonText: '선택 상품 주문하기',
  }, y))

  return { survey, plan }
}

export function buildDateMakeupScenarios() {
  const scenarios = []
  let caseNo = 0
  DATE_MAKEUP_QUESTIONS[0].options.forEach((base, baseIndex) => {
    DATE_MAKEUP_QUESTIONS[1].options.forEach((finish) => {
      DATE_MAKEUP_QUESTIONS[2].options.forEach((place) => {
        caseNo += 1
        const answers = [base, finish, place]
        const padded = String(caseNo).padStart(2, '0')
        scenarios.push(createScenario({
          title: `소개팅 메이크업 ${padded} · ${answers.join(' / ')}`,
          chip: `소개팅_${base}_${finish}_${place}`.replace(/[\s·/]+/g, '_'),
          query: QUERY,
          device: 'iphone-15',
          color: COLORS[baseIndex],
          compact: 'vertical',
          status: 'published',
          sourcePackId: DATE_MAKEUP_PACK_ID,
          sourceCaseNo: caseNo,
          sourceAnswers: { base, finish, place },
          stages: buildStages(answers),
        }))
      })
    })
  })
  return scenarios
}

export function buildDateMakeupAccount() {
  const account = createAccount({
    sourcePackId: DATE_MAKEUP_PACK_ID,
    profile: {
      name: '선아',
      items: [
        { label: '나이대', value: '20대 후반' },
        { label: '성별', value: '여성' },
        { label: '피부타입', value: '수부지' },
        { label: '퍼스널 컬러', value: '여름 쿨톤' },
        { label: '뷰티관심도', value: '중상' },
      ],
    },
    scenarios: buildDateMakeupScenarios(),
    threads: [],
  })
  account.explore = {
    ...account.explore,
    greeting: '선아님, 소개팅 끝까지 안 무너지는 메이크업 플랜을 골라볼까요?',
    searchPlaceholder: QUERY,
    items: (account.explore.items || []).map((item) => {
      if (item.type === 'greeting') return { ...item, props: { ...item.props, text: '선아님, 소개팅 끝까지 안 무너지는 메이크업 플랜을 골라볼까요?' } }
      if (item.type === 'searchBox') return { ...item, props: { ...item.props, placeholder: QUERY } }
      return item
    }),
  }
  return account
}

function mergePackScenarios(account, bundledScenarios = buildDateMakeupScenarios()) {
  const existingCases = new Set(
    (account.scenarios || [])
      .filter((scenario) => scenario.sourcePackId === DATE_MAKEUP_PACK_ID)
      .map((scenario) => scenario.sourceCaseNo)
  )
  const missing = bundledScenarios.filter((scenario) => !existingCases.has(scenario.sourceCaseNo))
  return {
    ...account,
    sourcePackId: DATE_MAKEUP_PACK_ID,
    scenarios: [
      ...(account.scenarios || []).map((scenario) =>
        scenario.sourcePackId === DATE_MAKEUP_PACK_ID
          ? { ...scenario, status: 'published' }
          : scenario
      ),
      ...missing.map((scenario) => ({ ...scenario, status: 'published' })),
    ],
  }
}

/*
 * 기존에 사용자가 만든 '선아' 프로필이 있으면 그 워크스페이스에 72개를 넣는다.
 * 이전 버전이 별도 '선아' 팩 계정을 만든 경우에는 사용자 계정으로 합쳐 중복 프로필을 없앤다.
 * 설치 표식만 남고 계정 저장이 누락된 경우도 매번 실제 시나리오를 기준으로 복구한다.
 */
export function installDateMakeupPack(initial) {
  const accounts = initial.accounts || []
  const packAccount = accounts.find((account) => account.sourcePackId === DATE_MAKEUP_PACK_ID)
  const userSeona = accounts.find(
    (account) => account.id !== packAccount?.id && String(account.profile?.name || '').trim() === '선아'
  )

  if (userSeona) {
    const sourceScenarios = packAccount
      ? (packAccount.scenarios || []).filter((scenario) => scenario.sourcePackId === DATE_MAKEUP_PACK_ID)
      : buildDateMakeupScenarios()
    const merged = mergePackScenarios(userSeona, sourceScenarios)
    const repaired = mergePackScenarios(merged)
    return {
      accounts: accounts
        .filter((account) => account.id !== packAccount?.id)
        .map((account) => account.id === userSeona.id ? repaired : account),
      activeId: initial.activeId === packAccount?.id ? userSeona.id : initial.activeId,
    }
  }

  if (packAccount) {
    const repaired = mergePackScenarios(packAccount)
    return {
      ...initial,
      accounts: accounts.map((account) => account.id === packAccount.id ? repaired : account),
    }
  }

  const account = buildDateMakeupAccount()
  return { accounts: [...initial.accounts, account], activeId: account.id }
}
