import { createItem } from './store.js'
import { LIBRARY } from './registry.jsx'

function make(type, props, y, w = 672, h = null) {
  const item = createItem(type, { ...LIBRARY[type].defaults, ...props })
  item.x = 24
  item.y = y
  item.w = w
  item.h = h
  return item
}

/* 새 시나리오 생성 시 고를 수 있는 템플릿들 (Typeform 템플릿 갤러리 참고) */
export const TEMPLATES = [
  {
    key: 'blank',
    name: '빈 시나리오',
    icon: '📄',
    desc: '아무것도 없는 캔버스에서 시작',
    chip: '새_시나리오',
    build: () => ({ survey: [], plan: [] }),
  },
  {
    key: 'beauty-brief',
    name: '뷰티 브리프',
    icon: '💄',
    desc: '설문·계획 기본 구성이 채워진 상태',
    chip: '뷰티_브리프',
    build: () => ({
      survey: [
        make('profilePanel', {}, 24),
        make('surveyIntro', {}, 194),
        make('surveyQuestion', {}, 438),
        make('surveyQuestion', {
          question: '선호하는 마무리 느낌은?',
          options: '촉촉 광|글로우, 세미매트|밸런스, 매트|유분 차단',
        }, 602),
      ],
      plan: [
        make('surveySummary', {}, 24),
        make('planTitle', {}, 178),
        make('planStep', {}, 312),
        make('planStep', {
          badge: 'STEP 2',
          title: '픽서로 고정력 마무리',
          desc: '마지막 단계에서 고정력을 높여 하루 종일 유지해요.',
          points: '얼굴 20cm 거리에서 분사, T존 위주로 한 번 더',
        }, 556),
        make('productCard', {}, 800),
        make('ctaBar', {}, 934),
      ],
    }),
  },
  {
    key: 'gift',
    name: '선물 추천 플로우',
    icon: '🎁',
    desc: '받는 분 정보를 설문으로 모아 선물 계획 제안',
    chip: '선물_추천',
    build: () => ({
      survey: [
        make('profilePanel', { hidden: '피부타입, 퍼스널 컬러' }, 24),
        make('surveyIntro', {
          kicker: 'Gift Brief',
          title: '받는 분에 대해 알려주세요',
          desc: '관계, 예산, 취향 키워드만 고르면 마음이 전해지는 선물 플랜을 정리해드려요.',
        }, 194),
        make('surveyQuestion', {
          question: '받는 분과의 관계는?',
          options: '연인|가장 설레는, 친구|편안한, 가족|따뜻한, 동료|정중한',
        }, 438),
        make('surveyQuestion', {
          question: '생각하는 예산대는?',
          options: '3만원 이하, 3~5만원, 5~10만원, 10만원 이상',
        }, 602),
        make('surveyQuestion', {
          question: '받는 분의 취향 키워드는? (복수 선택)',
          options: '향|퍼퓸·바디, 보습|건조 피부, 메이크업|컬러, 디바이스|홈케어',
          multi: true,
        }, 766),
      ],
      plan: [
        make('surveySummary', {}, 24),
        make('planTitle', { kicker: 'Gift Plan', title: '마음이 전해지는 선물 플랜' }, 178),
        make('planStep', {
          badge: 'GIFT 1',
          title: '향으로 기억되는 선물',
          desc: '취향을 크게 타지 않는 무난하면서도 고급스러운 향 카테고리부터 제안해요.',
          points: '시향 후기 확인, 선물 포장 옵션 체크',
        }, 312),
        make('productCard', {
          name: '딥 모이스처 핸드크림 기프트 세트',
          price: '32,000',
          tag: 'GIFT PICK',
          desc: '포장 옵션 포함 · 리뷰 4.9점',
        }, 556),
        make('checklist', {
          title: '선물 전 확인 리스트',
          items: '선물 포장 여부, 선물용 영수증, 배송 예정일이 기념일 전인지',
        }, 690),
        make('ctaBar', { countLabel: '선물 구성 2개', price: '48,900원', buttonText: '선물 포장으로 주문하기' }, 854),
      ],
    }),
  },
]
