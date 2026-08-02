/* 라이브 와이어 페이지 → 스튜디오 아이템 투영 (DESIGN-LLM-SERVICE.md §2-1).
   매핑 기준: question→surveyQuestion, guide→planStep, products→hscroll+productCard,
   steps→checklist. 새 렌더 계층을 만들지 않고 레지스트리 player 렌더러를 그대로 재사용하기
   위한 얇은 변환이다. id는 결정적으로 부여한다 — 설문 답변 키는 와이어 질문 id 그대로
   (= surveyQuestion 아이템 id)라 answers 왕복에 재매핑이 없다. 좌표(x/y)는 넣지 않는다. */

import { joinTextList } from './store.js'

export function liveSurveyItems(page) {
  const items = [
    {
      id: 'live-survey-intro',
      type: 'surveyIntro',
      props: { kicker: 'Personal Brief', title: page.intro || '몇 가지만 알려주세요', desc: '' },
    },
    {
      id: 'live-profile-panel',
      type: 'profilePanel',
      props: { hint: '이번엔 빼고 싶은 항목을 눌러주세요', hidden: '' },
    },
  ]
  for (const q of page.questions || []) {
    items.push({
      id: q.id,
      type: 'surveyQuestion',
      props: {
        question: q.question,
        options: joinTextList(q.options || []), // 줄바꿈 직렬화 — 선택지 안 쉼표 보존
        multi: !!q.multi,
        maxPerRow: String(Math.min(4, Math.max(2, (q.options || []).length))),
        optionShape: 'card',
        horizontalScroll: true,
        defaultAnswer: '',
        locked: false,
      },
    })
  }
  return items
}

export function livePlanItems(page) {
  const items = [
    { id: 'live-plan-title', type: 'planTitle', props: { kicker: 'AI Plan', title: page.headline || '' } },
  ]
  if (page.summary) {
    items.push({ id: 'live-plan-summary', type: 'noticeCard', props: { title: '이렇게 정리했어요', body: page.summary } })
  }
  items.push({
    id: 'live-plan-survey-summary',
    type: 'surveySummary',
    props: { title: '설문 요약', hiddenProfile: '', hiddenQuestions: '' },
  })
  let stepNo = 0
  ;(page.sections || []).forEach((section, i) => {
    const base = `live-plan-s${i}`
    if (section.kind === 'guide') {
      stepNo += 1
      items.push({
        id: base,
        type: 'planStep',
        props: { no: String(stepNo), title: section.title, desc: section.body, points: '' },
      })
    } else if (section.kind === 'steps') {
      items.push({
        id: base,
        type: 'checklist',
        props: { title: section.title, items: joinTextList(section.steps || []) },
      })
    } else if (section.kind === 'products') {
      if (section.reason) {
        items.push({ id: `${base}-reason`, type: 'textBlock', props: { kicker: '', title: '', body: section.reason } })
      }
      items.push({ id: base, type: 'hscroll', props: { title: section.title, cardW: '232', items: '' } })
      ;(section.products || []).forEach((product, j) => {
        items.push({
          id: `${base}-p${j}`,
          type: 'productCard',
          parentId: base,
          slot: j,
          w: 232,
          props: {
            brand: product.brand || '',
            name: product.name,
            price: Number(product.price || 0).toLocaleString('ko-KR'),
            was: '',
            score: '',
            summary: '',
            emoji: '🧴', // 카탈로그에 이미지가 없어 목업 블록으로 렌더
            gradient: '',
            external: false,
            mall: '',
            imageUrl: '',
          },
        })
      })
    }
  })
  return items
}
