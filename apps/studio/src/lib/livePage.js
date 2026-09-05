/* 라이브 와이어 페이지 → 스튜디오 아이템 투영 (DESIGN-LLM-SERVICE.md §2-1).
   매핑 기준: question→surveyQuestion(사진 질문은 surveyPhoto), guide→planStep,
   look→beforeAfter(가상 메이크업 결과), products→hscroll+productCard,
   contents→hscroll+videoCard/articleCard, steps→checklist. 새 렌더 계층을 만들지 않고
   레지스트리 player 렌더러를 그대로 재사용하기 위한 얇은 변환이다. id는 결정적으로
   부여한다 — 설문 답변 키는 와이어 질문 id 그대로(= surveyQuestion 아이템 id)라 answers
   왕복에 재매핑이 없다. 좌표(x/y)는 넣지 않는다. */

import { joinTextList } from './store.js'

/** 사진 질문의 와이어 답 — @ddak/schema PHOTO_ANSWER와 같은 문자열이어야 한다.
 * 사진 원본은 기기에 남고 서버로는 이 표식만 간다 (데이터 URL은 스텝·프롬프트에 실을 것이 못 된다) */
export const PHOTO_ANSWER = '사진 제출됨'

/** 답 값이 실제로 그릴 수 있는 이미지인지 — 이어보기·관리 페이지에서는 표식만 남는다 */
export const isPhotoValue = (value) => /^(data:image\/|https?:\/\/|\.{0,2}\/)/.test(String(value || ''))

/** 인트로 문장을 Figma Header(제목 22px + 설명 13px)로 가른다 — 문장이 둘 이상이면 첫 문장이 제목,
 *  나머지가 설명. 한 문장이면 제목만 (설명 자리는 비운다 — 지어내지 않는다) */
export function splitIntro(intro) {
  const text = String(intro || '').trim()
  if (!text) return { title: '', desc: '' }
  const m = /^(.+?[.!?。])\s+(\S[\s\S]*)$/.exec(text.replace(/\n+/g, ' '))
  return m ? { title: m[1].trim(), desc: m[2].trim() } : { title: text, desc: '' }
}

export function liveSurveyItems(page) {
  const intro = splitIntro(page.intro)
  const items = [
    // 화면 헤더는 클라이언트 소유 — LLM 산출물과 무관하게 생성 시작부터 늘 그린다
    { id: 'live-survey-header', type: 'screenHeader', props: { title: '설문 단계', back: true, home: true, ai: true } },
    {
      id: 'live-survey-intro',
      type: 'surveyIntro',
      props: { kicker: '', title: intro.title || '몇 가지만 알려주세요', desc: intro.desc },
    },
    {
      id: 'live-profile-panel',
      type: 'profilePanel',
      props: { hint: '이번엔 빼고 싶은 항목을 눌러주세요', hidden: '' },
    },
  ]
  for (const q of page.questions || []) {
    /* 사진 질문 — 선택지가 없고 사진 업로드 컴포넌트로 그린다. 아이템 id는 여기서도 와이어
       질문 id 그대로라, 고른 사진은 answers[q.id]에 담기고 계획 투영이 그 값을 다시 쓴다 */
    if (q.kind === 'photo') {
      items.push({
        id: q.id,
        type: 'surveyPhoto',
        props: {
          question: q.question,
          placeholder: q.placeholder || '정면 얼굴 사진을 선택해주세요',
          iconLabel: '사진 아이콘',
          samples: '', // 기본 샘플 얼굴 4종
          photoUrl: '',
        },
      })
      continue
    }
    items.push({
      id: q.id,
      type: 'surveyQuestion',
      props: {
        question: q.question,
        options: joinTextList(q.options || []), // 줄바꿈 직렬화 — 선택지 안 쉼표 보존
        multi: !!q.multi,
        maxPerRow: String(Math.min(4, Math.max(2, (q.options || []).length))),
        optionShape: 'list', // Figma 설문 기준 — 전폭 세로 리스트
        horizontalScroll: false,
        defaultAnswer: '',
        locked: false,
      },
    })
  }
  return items
}

/** opts.photo — 설문에서 고른 얼굴 사진(데이터 URL). 가상 메이크업 결과(look) 섹션의
 * BEFORE 재료다: 서버는 어떤 룩인지(tone)만 정하고 합성은 화면이 한다.
 * opts.photoAfter — 메이크업이 올라간 AFTER 이미지(로컬 랜드마크 합성 또는 정밀 렌더). 늦게
 * 도착하므로 없을 수도 있고, 그때는 같은 사진에 tone 프리셋을 얹어 보여준다.
 * opts.lookStage — AFTER 자리의 진행 단계(skeleton|landmark|refining|precise). 원본(BEFORE)은
 * 언제나 바로 보이고, 합성이 아직이거나 정밀 렌더가 도는 동안은 그 자리에 로딩을 얹는다.
 * opts.pendingSlots — 뼈대 조기 확정 뒤 아직 검색 결과가 안 채운 자리 인덱스. 이 자리는
 * LivePlayer가 로딩 카드로 렌더하는 `livePending` 아이템으로 투영된다 (레지스트리 밖 타입 —
 * id도 `live-plan-s#` 문법 밖이라 피드백 앵커 판정에 걸리지 않는다) */
export function livePlanItems(page, opts = {}) {
  const pendingSlots = opts.pendingSlots || []
  const items = [
    // 화면 헤더는 클라이언트 소유 — LLM 산출물과 무관하게 생성 시작부터 늘 그린다
    { id: 'live-plan-header', type: 'screenHeader', props: { title: 'AI 맞춤 계획', back: true, home: true, ai: true } },
    {
      id: 'live-plan-title',
      type: 'planTitle',
      props: {
        query: opts.query || '', // 사용자 질의 — 비면 인용 줄이 숨는다
        title: page.headline || '',
        notice: 'AI가 만든 계획이에요. 내용이 사실과 다를 수 있으니 확인해 주세요.',
        noticeOpen: false,
        highlight: true,
      },
    },
  ]
  /* Figma AIIntro = 인용 제목 + 설문 요약 칩이 한 밴드 — 요약 패널을 타이틀 바로 뒤에 두어
     플레이어의 인접 규칙이 두 아이템을 한 보라 밴드로 이어 붙인다. LLM 정리 문단은 그 아래
     카드 없는 텍스트 블록으로 (id는 평가 말풍선 앵커 '요약'이라 유지) */
  items.push({
    id: 'live-plan-survey-summary',
    type: 'surveySummary',
    props: { hiddenProfile: '', hiddenQuestions: '' },
  })
  if (page.summary) {
    items.push({ id: 'live-plan-summary', type: 'textBlock', props: { kicker: '', title: '이렇게 정리했어요', body: page.summary } })
  }
  const sections = page.sections || []
  /* forEach가 아니라 인덱스 순회다 — 스트리밍 중 partial.sections는 도착한 인덱스에만 값이
     있는 희소 배열이고, forEach는 그 구멍을 아예 건너뛴다. 아직 안 온 자리에 로딩 카드를
     제자리에 그리려면 구멍도 방문해야 한다 (렌더 여부는 pendingSlots가 정한다) */
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]
    // 단계 하위 표시 — 단계 안내(guide) 바로 뒤의 상품 섹션(자리 포함)은 그 단계에 속한
    // 콘텐츠처럼 들여 배치한다 (LivePlayer가 stepSub로 래퍼 클래스를 단다)
    const stepSub = sections[i - 1] != null && sections[i - 1].kind === 'guide'
    if (!section) {
      // 빈 슬롯 — 아직 안 온 상품·콘텐츠 자리. 인덱스는 보존되고, 자리 표시는 로딩 카드
      if (pendingSlots.includes(i)) {
        items.push({ id: `live-plan-pending-${i}`, type: 'livePending', stepSub, props: {} })
      }
      continue
    }
    const base = `live-plan-s${i}`
    if (section.kind === 'look') {
      /* 가상 메이크업 결과 — 올린 사진을 BEFORE로, 같은 사진에 룩 톤을 올린 것을 AFTER로.
         사진이 없으면(이어보기로 기기 보관분이 없거나 관리 페이지 미리보기) 합성할 재료가
         없으므로 룩 설명만 안내 카드로 정직하게 그린다 */
      const photo = opts.photo || ''
      if (photo) {
        /* AFTER는 셋 중 하나다 (좋은 순): ① 외부 이미지 모델의 정밀 렌더 ② 얼굴 랜드마크로
           입술·볼에만 색을 얹은 로컬 합성(makeupComposite) ③ 둘 다 없으면 같은 사진 + tone
           프리셋(CSS). ①②가 있으면 이미 색이 발린 이미지라 tone을 비워 겹칠하지 않는다 */
        /* AFTER 자리의 단계 — 'skeleton'(합성 전: 원본만 보이고 오른쪽은 로딩)
           → 'landmark'(기기 합성 표시) → 'refining'(그 위에서 정밀 렌더 진행)
           → 'precise'(정밀 렌더 적용). BEFORE(원본)는 어느 단계에서든 바로 보인다 */
        const stage = opts.lookStage || (opts.photoAfter ? 'landmark' : 'skeleton')
        const after = opts.photoAfter || photo
        items.push({
          id: base,
          type: 'beforeAfter',
          props: {
            title: section.title,
            desc: section.desc || '',
            beforeImage: photo,
            afterImage: after,
            tone: opts.photoAfter ? '' : section.tone || '',
            beforeLabel: '내 사진',
            afterLabel: stage === 'precise' ? 'AI 메이크업 · 정밀' : 'AI 메이크업',
            afterState: stage,
            // 합성 결과(data URL)가 있을 때만 — CSS 프리셋 단계에서 저장하면 화장 안 된 원본이 나간다
            downloadable: !!opts.photoAfter,
            split: '50',
            hint: '',
            disclaimer: 'AI가 올려 본 미리보기예요. 실제 발색은 피부톤 · 조명에 따라 다를 수 있어요.',
          },
        })
      } else {
        items.push({
          id: base,
          type: 'noticeCard',
          props: { title: section.title, body: section.desc || '' },
        })
      }
      const points = (section.points || []).filter(Boolean)
      if (points.length) {
        items.push({
          id: `${base}-points`,
          type: 'textBlock',
          stepSub,
          props: { kicker: '', title: '', body: points.map((pt) => `· ${pt}`).join('\n') },
        })
      }
    } else if (section.kind === 'guide') {
      items.push({
        id: base,
        type: 'planStep',
        // 와이어 guide = 제목 + 서브타이틀(단계 목적 한 줄 — 뼈대 프롬프트가 채운다, 옛 페이지는 없음) + 문단
        props: { badge: '', title: section.title, subtitle: section.subtitle || '', points: '', body: section.body },
      })
    } else if (section.kind === 'steps') {
      items.push({
        id: base,
        type: 'checklist',
        props: { title: section.title, items: joinTextList(section.steps || []) },
      })
    } else if (section.kind === 'products') {
      if (section.reason) {
        items.push({ id: `${base}-reason`, type: 'textBlock', stepSub, props: { kicker: '', title: '', body: section.reason } })
      }
      items.push({ id: base, type: 'hscroll', stepSub, props: { title: section.title, cardW: '170', items: '' } })
      ;(section.products || []).forEach((product, j) => {
        items.push({
          id: `${base}-p${j}`,
          type: 'productCard',
          parentId: base,
          slot: j,
          w: 170, // Figma [PP1K] ProductCard 170 고정
          props: {
            brand: product.brand || '',
            name: product.name,
            price: Number(product.price || 0).toLocaleString('ko-KR'),
            was: '',
            // 매칭율 — 검증 게이트(@ddak/pipeline guards/match.ts)가 상품마다 계산해 페이지에 남긴 값. 항목 표(factors)와
            // 계산식(basis)이 배지 팝오버 재료다. 옛 페이지(match 없음)는 예전처럼 "AI 추천" 문구 배지로 남는다
            score: product.match ? String(product.match.score) : '',
            tag: product.match ? '' : 'AI 추천',
            matchFactors: product.match ? product.match.factors : '',
            matchBasis: (product.match && product.match.basis) || '',
            summary: '',
            emoji: product.imageUrl ? '' : '🧴', // 썸네일 없는 상품만 이모지 목업 블록으로 렌더
            gradient: '',
            // mall 있음 = 웹 검색으로 찾은 외부몰 상품 (외부몰 태그·담기불가), 없음 = 데모 카탈로그(지마켓)
            external: !!product.mall,
            mall: product.mall || '',
            url: product.url || '', // 상세보기 사이드 패널이 iframe으로 연다
            imageUrl: product.imageUrl || '', // 카탈로그(지마켓 gdimg)·웹 검색 상품의 실제 썸네일
          },
        })
      })
    } else if (section.kind === 'contents') {
      // 참고 콘텐츠 — 웹 검색으로 확인한 게시글·영상. 스튜디오 미디어 카드 렌더러를 재사용한다
      if (section.reason) {
        items.push({ id: `${base}-reason`, type: 'textBlock', props: { kicker: '', title: '', body: section.reason } })
      }
      items.push({ id: base, type: 'hscroll', props: { title: section.title, cardW: '260', items: '' } })
      ;(section.items || []).forEach((c, j) => {
        const common = { id: `${base}-c${j}`, parentId: base, slot: j, w: 260 } // Figma VideoCard 는 전폭 — 트랙에선 한 장 반이 보이는 폭
        if (c.type === 'video') {
          items.push({
            ...common,
            type: 'videoCard',
            props: {
              source: c.source || '영상',
              title: c.title || '',
              channel: c.meta || '',
              duration: c.duration || '',
              url: c.url || '', // 카드 클릭 = 새 탭 (registry videoCard의 openExternal)
              imageUrl: c.imageUrl || '', // 없으면 유튜브 URL 자동 썸네일 → 폴백 이미지
            },
          })
        } else {
          items.push({
            ...common,
            type: 'articleCard',
            props: {
              source: c.source || '게시글',
              title: c.title || '',
              snippet: c.snippet || '',
              author: c.meta || '',
              url: c.url || '',
              imageUrl: c.imageUrl || '',
            },
          })
        }
      })
    }
  }
  /* Figma FeedbackSection — 계획 끝의 "도움이 됐나요?" (섹션이 하나라도 있을 때만, 평가 말풍선 대상 아님) */
  if (sections.some(Boolean)) {
    items.push({ id: 'live-plan-helpful', type: 'feedbackCard', props: { question: '도움이 되셨나요?', state: 'none' } })
  }
  return items
}
