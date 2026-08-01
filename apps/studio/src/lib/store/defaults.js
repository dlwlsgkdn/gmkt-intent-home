import { uid } from './model.js'

/*
 * 첫 실행 기본값과 그로부터 파생되는 것들 — 탐색(홈) 페이지, 사용자 프로필, 키워드 사전.
 * "무엇을 처음에 보여줄까"만 담당하고, 저장은 persistence.js가 한다.
 */

/* ── 공통 탐색(홈) 페이지 설정 ── */
export const DEFAULT_EXPLORE = {
  greeting: '유진님, 오늘은 피부결이 먼저 보이는 베이스 루틴을 가볍게 정리해볼까요?',
  searchPlaceholder: '예: 출근 전에 10분 안에 안 무너지는 데일리 메이크업',
  searchOverflow: 'ellipsis', // 검색창 긴 텍스트: 'ellipsis'(한 줄 말줄임) | 'multiline'
  stories: [
    {
      kicker: 'Base Notes',
      title: '속광은 남기고 유분만 덜어내는 베이스',
      desc: '최근 쓰레드에서 반복된 키워드: 무너짐, 들뜸, 얇은 커버.',
      imageUrl: './makeup-clone-assets/d9b261330f3ffccf.avif',
    },
    {
      kicker: 'Color Mood',
      title: '맑은 로즈 한 끗',
      desc: '',
      imageUrl: './makeup-clone-assets/8e01e19fb7cf7c96.avif',
    },
    {
      kicker: 'Pouch Edit',
      title: '1박 2일 파우치 최소 구성',
      desc: '',
      imageUrl: './makeup-clone-assets/42072b0ad4be9333.avif',
    },
  ],
}

/* ── 사용자 프로필 (고정 설문 정보) — 계정 안의 모든 시나리오가 공유 ── */
export const DEFAULT_PROFILE = {
  name: '유진',
  items: [
    { label: '나이대', value: '20대 후반' },
    { label: '성별', value: '여성' },
    { label: '피부타입', value: '복합성' },
    { label: '퍼스널 컬러', value: '웜톤 봄 라이트' },
  ],
}

/* 프로필 요약 패널 기준 노출 항목 —
   설문 단계의 profilePanel 컴포넌트가 숨긴 라벨을 제외한다 (플레이어·빌더 요약 공용) */
export function visibleProfileItems(profile, scenario) {
  const items = ((profile && profile.items) || []).filter((item) => item.label && item.label.trim())
  const hidden = (scenario.stages.survey || [])
    .filter((item) => item.type === 'profilePanel')
    .flatMap((item) => String(item.props.hidden || '').split(',').map((label) => label.trim()).filter(Boolean))
  return items.filter((item) => !hidden.includes(item.label))
}

/* ── 키워드 사전 — 텍스트 안 [[키워드]]에 점선 밑줄 + 클릭 시 설명 모달 ── */
export const DEFAULT_KEYWORDS = [
  {
    word: '프라이머',
    desc: '메이크업 전에 피부 결과 모공을 매끈하게 정돈해 베이스의 밀착력을 높여주는 제품이에요.',
    points: '커버보다 결 정돈이 목적, T존 위주로 얇게, 손보다 퍼프 마무리',
  },
  {
    word: '픽서',
    desc: '완성한 메이크업 위에 분사해 고정력을 높여주는 스프레이예요. 유분·마찰에 의한 무너짐을 줄여줘요.',
    points: '얼굴에서 20cm 거리 유지, T존 위주로 한 번 더, 흔들어서 사용',
  },
  {
    word: '세라마이드',
    desc: '피부 장벽을 구성하는 지질 성분으로, 수분 손실을 막고 민감해진 피부를 진정시키는 데 도움을 줘요.',
    points: '건조·민감 피부에 적합, 레티놀과 함께 쓰기 좋은 진정 성분',
  },
]

/* ── 탐색(홈) 페이지의 캔버스 아이템 ──
   탐색 콘텐츠도 설문/계획과 같은 아이템 모델로 자유 배치·편집한다.
   구버전 설정(greeting/searchPlaceholder/stories)은 최초 1회 아이템으로 변환된다. */
export function exploreItemsFrom(config) {
  const merged = { ...DEFAULT_EXPLORE, ...(config || {}) }
  const stories = Array.isArray(merged.stories) && merged.stories.length === 3
    ? merged.stories
    : DEFAULT_EXPLORE.stories
  const make = (type, y, props, w = 672) => ({ id: uid(), type, x: 24, y, w, h: null, props })
  return [
    make('greeting', 24, { text: merged.greeting }),
    make('searchBox', 170, { placeholder: merged.searchPlaceholder, multiline: merged.searchOverflow === 'multiline' }),
    make('scenarioChips', 290, {}),
    make('storyFeature', 380, { ...stories[0] }),
    make('storyCard', 900, { kicker: stories[1].kicker, title: stories[1].title, imageUrl: stories[1].imageUrl }),
    make('storyCard', 1300, { kicker: stories[2].kicker, title: stories[2].title, imageUrl: stories[2].imageUrl }),
  ]
}
