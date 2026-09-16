/* 라이브 와이어 페이지 → 스튜디오 아이템 투영 (DESIGN-LLM-SERVICE.md §2-1).
   매핑 기준: question→surveyQuestion(사진 질문은 surveyPhoto), guide→planStep,
   look→beforeAfter(가상 메이크업 결과), products→hscroll+productCard,
   contents→hscroll+videoCard/articleCard, steps→checklist,
   compare→ingredientCompare(성분 비교표)·caution→cautionIngredients(주의 성분 — 뼈대가 성분이
   기준인 의도에서만 만든다, v26). 새 렌더 계층을 만들지 않고
   레지스트리 player 렌더러를 그대로 재사용하기 위한 얇은 변환이다. id는 결정적으로
   부여한다 — 설문 답변 키는 와이어 질문 id 그대로(= surveyQuestion 아이템 id)라 answers
   왕복에 재매핑이 없다. 좌표(x/y)는 넣지 않는다. */

import { joinTextList } from './store.js'

/** 계획 섹션 i 의 투영 아이템 id — 섹션 종류와 무관하게 인덱스로 결정된다(스트리밍 중 같은 index 재도착 = 같은 엘리먼트).
 * lib/cart.js 가 단계(guide) 목록에 같은 id 를 실어, 담은 상품 시트의 파트 → 계획 단계 앵커 스크롤이 이 id 로 래퍼를 찾는다 */
export const livePlanSectionId = (index) => `live-plan-s${index}`

/** 사진 질문의 와이어 답 — @ddak/schema PHOTO_ANSWER와 같은 문자열이어야 한다.
 * 사진 원본은 기기에 남고 서버로는 이 표식만 간다 (데이터 URL은 스텝·프롬프트에 실을 것이 못 된다) */
export const PHOTO_ANSWER = '사진 제출됨'

/** 룩 사양 → 화면 포인트 문구 — @ddak/pipeline look.ts `lookPointsOf` 의 거울(부위 라벨 + note).
 *  BFF 가 와이어 points 를 이 규칙으로 채워 보내므로 보통은 쓰이지 않고, 운영 콘솔 단계 단독 dry-run 처럼
 *  뼈대 생성물을 FE 가 직접 투영할 때만 폴백으로 쓴다. 규칙을 바꾸면 양쪽을 같이 맞출 것 */
const LOOK_PART_LABELS = { lip: '립', cheek: '치크', eye: '눈', base: '베이스', hair: '헤어', outfit: '옷' }
/** 범위가 그 부위를 포함하는가 — 누적: hair ⊃ makeup, outfit ⊃ hair (@ddak/pipeline look.ts scopeIncludes 거울) */
export function scopeIncludes(scope, part) {
  const s = scope || 'makeup'
  if (part === 'hair') return s === 'hair' || s === 'outfit'
  return s === 'outfit'
}
export function lookPointsOf(spec) {
  if (!spec) return []
  return ['lip', 'cheek', 'eye', 'base', 'hair', 'outfit']
    .map((part) => {
      if ((part === 'hair' || part === 'outfit') && !scopeIncludes(spec.scope, part)) return ''
      const note = String((spec[part] && spec[part].note) || '').trim()
      return note ? `${LOOK_PART_LABELS[part]} — ${note}` : ''
    })
    .filter(Boolean)
}

/** 스타일링 범위 질문(스캐폴드 고정, id s1)의 답 → scope. @ddak/pipeline survey-wire `lookScopeFromAnswer` 의 거울 —
 *  선택지 제목이 곧 답이라 제목을 대조하고, 답이 없으면(옛 쓰레드) makeup */
export const SCOPE_QUESTION_ID = 's1'
export function lookScopeOfAnswers(answers) {
  const raw = answers && answers[SCOPE_QUESTION_ID]
  const label = String((Array.isArray(raw) ? raw[0] : raw) || '').split('|')[0].trim()
  if (!label) return 'makeup'
  if (label.includes('옷')) return 'outfit'
  if (label.includes('헤어')) return 'hair'
  return 'makeup'
}

/** 범위별 사진 안내 — 헤어까지면 머리 전체, 옷차림까지면 상반신이 보여야 정밀 렌더가 손댈 수 있다 */
const PHOTO_PLACEHOLDER_BY_SCOPE = {
  makeup: '정면 얼굴 사진을 선택해주세요',
  hair: '머리 전체가 나온 정면 사진을 선택해주세요',
  outfit: '상반신이 나온 정면 사진을 선택해주세요',
}
const PHOTO_HINT_BY_SCOPE = {
  hair: '헤어까지 보려면 머리카락이 잘리지 않은 사진이 좋아요',
  outfit: '옷차림까지 보려면 어깨와 상의가 보이는 사진이 좋아요',
}

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

export function liveSurveyItems(page, opts = {}) {
  const scope = opts.scope || 'makeup'
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
          // 범위 질문(s1)이 앞에 있어 답이 이미 정해져 있다 — 헤어·옷차림까지면 안내를 그에 맞춘다
          placeholder: q.placeholder || PHOTO_PLACEHOLDER_BY_SCOPE[scope] || PHOTO_PLACEHOLDER_BY_SCOPE.makeup,
          ...(PHOTO_HINT_BY_SCOPE[scope] ? { hint: PHOTO_HINT_BY_SCOPE[scope] } : {}),
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
 * opts.photoBefore — 정밀 정렬 시 AFTER와 동일 영역으로 자른 BEFORE. 없으면 opts.photo 그대로.
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
        title: '', // Figma AIIntro 는 인용 한 줄뿐 — LLM 헤드라인은 아래 정리 문단의 제목 자리로 (2026-09-12)
        notice: 'AI가 만든 계획이에요. 내용이 사실과 다를 수 있으니 확인해 주세요.',
        noticeOpen: false,
        highlight: false,
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
    items.push({
      id: 'live-plan-summary',
      type: 'textBlock',
      props: { kicker: '', title: page.headline || '이렇게 정리했어요', body: page.summary },
    })
  }
  const sections = page.sections || []
  /* forEach가 아니라 인덱스 순회다 — 스트리밍 중 partial.sections는 도착한 인덱스에만 값이
     있는 희소 배열이고, forEach는 그 구멍을 아예 건너뛴다. 아직 안 온 자리에 로딩 카드를
     제자리에 그리려면 구멍도 방문해야 한다 (렌더 여부는 pendingSlots가 정한다) */
  // 단계 하위 연쇄 — 직전 섹션이 단계 안내(guide)이거나, 그 단계에 붙은 상품·콘텐츠 섹션(빈 자리 포함)이면
  // 이번 섹션도 같은 단계에 속한다. 뼈대(v20)가 단계마다 [안내 → 상품 자리 → 콘텐츠 자리]를 이어 두므로
  // 콘텐츠 카드가 계획 끝이 아니라 단계 본문 사이에 서고, LivePlayer가 stepSub로 간격만 당겨 붙인다
  let chain = false
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i]
    // 상품·콘텐츠(빈 자리 포함)와 단계 본문 섹션(성분 비교표·주의 성분)만 단계 하위가 될 수 있다 — 다음 단계 안내·사용 순서는 연쇄를 끊는다
    const isSubKind = !section || ['products', 'contents', 'compare', 'caution'].includes(section.kind)
    const stepSub = chain && isSubKind
    chain = (section != null && section.kind === 'guide') || stepSub
    if (!section) {
      // 빈 슬롯 — 아직 안 온 상품·콘텐츠 자리. 인덱스는 보존되고, 자리 표시는 로딩 카드
      if (pendingSlots.includes(i)) {
        items.push({ id: `live-plan-pending-${i}`, type: 'livePending', stepSub, props: {} })
      }
      continue
    }
    const base = livePlanSectionId(i)
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
        // 범위가 헤어·옷차림까지면 기기 합성은 메이크업만 그린다(랜드마크는 얼굴뿐) — 정밀 렌더 전엔 그 사실을 안내한다
        const beyond = !!(section.spec && scopeIncludes(section.spec.scope, 'hair'))
        const beyondLabel = section.spec && section.spec.scope === 'outfit' ? '헤어·옷차림' : '헤어'
        items.push({
          id: base,
          type: 'beforeAfter',
          props: {
            title: section.title,
            desc: section.desc || '',
            beforeImage: opts.photoBefore || photo,
            afterImage: after,
            tone: opts.photoAfter ? '' : section.tone || '',
            // 합성 전 CSS 프리셋 단계에서도 사양의 립 색을 쓴다 (tone 고정색 대신)
            tint: (!opts.photoAfter && section.spec && section.spec.lip && section.spec.lip.color) || '',
            beforeLabel: '내 사진',
            afterLabel: stage === 'precise' ? (beyond ? 'AI 스타일링 · 정밀' : 'AI 메이크업 · 정밀') : 'AI 메이크업',
            afterState: stage,
            // 합성 결과(data URL)가 있을 때만 — CSS 프리셋 단계에서 저장하면 화장 안 된 원본이 나간다
            downloadable: !!opts.photoAfter,
            split: '50',
            hint: '',
            disclaimer:
              'AI가 올려 본 미리보기예요. 실제 발색은 피부톤 · 조명에 따라 다를 수 있어요.' +
              (beyond && stage !== 'precise' ? ` ${beyondLabel}은 정밀 렌더에서 반영돼요.` : ''),
          },
        })
      } else {
        items.push({
          id: base,
          type: 'noticeCard',
          props: { title: section.title, body: section.desc || '' },
        })
      }
      // 포인트는 BFF 가 사양 note 에서 파생해 보낸다 — 없으면(FE 직접 투영) 같은 규칙으로 여기서 파생
      const points = (section.points && section.points.length ? section.points : lookPointsOf(section.spec)).filter(Boolean)
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
    } else if (section.kind === 'compare') {
      /* 성분 비교표(v26) — 뼈대가 성분이 기준인 의도에서 만든 **제품 유형 수준**의 대조(기존/일반 제품 유형 vs 추천 기준).
         스튜디오 ingredientCompare 렌더러의 행 문법 "추천 값|성분|기존 값|위험도"로 직렬화한다(셀 안의 | 는 / 로).
         이미지는 싣지 않는다 — 특정 상품의 전성분을 확인한 것이 아니라 유형 비교라 상품 사진을 붙이면 단정이 된다 */
      const cell = (v) => String(v || '').replace(/\|/g, '/')
      const alt = section.alt || {}
      const pick = section.pick || {}
      items.push({
        id: base,
        type: 'ingredientCompare',
        stepSub,
        props: {
          caption: section.title || '',
          pickBadge: pick.badge || '추천 기준',
          pickName: pick.name || '',
          pickMeta: pick.short || '',
          pickImage: '',
          altBadge: alt.badge || '기존 제품',
          altName: alt.name || '',
          altMeta: alt.short || '',
          altImage: '',
          rows: joinTextList((section.rows || []).map((r) => [r.pick, r.ingredient, r.alt, r.risk].map(cell).join('|'))),
        },
      })
    } else if (section.kind === 'caution') {
      // 주의 성분(v26) — 이 고민에서 먼저 확인할 성분. 스튜디오 cautionIngredients 렌더러의 "이름|설명" 행 문법
      const cell = (v) => String(v || '').replace(/\|/g, '/')
      items.push({
        id: base,
        type: 'cautionIngredients',
        stepSub,
        props: {
          title: section.title || '주의해서 볼 성분',
          desc: section.desc || '',
          items: joinTextList((section.items || []).map((it) => `${cell(it.name)}|${cell(it.note)}`)),
        },
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
            // 판매가를 못 확인한 웹 상품(priceUnknown·0원)은 가격을 비운다 — 카드가 "가격 확인 필요"로 보인다 (2026-09)
            price: product.priceUnknown || !(Number(product.price) > 0) ? '' : Number(product.price).toLocaleString('ko-KR'),
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
            // mall 있음 = 웹 검색으로 찾은 상품, 없음 = 데모 카탈로그(지마켓). 지마켓에서 찾은 웹 상품은 외부몰이 아니다(v25 —
            // 지마켓 50 : 외부몰 50). 어느 쪽이든 담기는 된다(2026-09-14) — external 은 몰 표기·담기 버튼 툴팁만 가른다
            external: !!product.mall && !/지마켓|g마켓|gmarket/i.test(product.mall),
            urlKind: product.urlKind || 'pdp', // search = PDP 를 못 찾아 몰 검색 결과를 여는 상품 (「몰에서 찾기」)
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
      /* Figma [PP1K] 계획 2-2·4-1 의 VideoCard 는 단계 본문 안 전폭 카드 한 장이다 — 콘텐츠가 하나면 트랙 없이 최상위
         전폭 카드로(섹션 id `base` 를 카드가 그대로 받아 피드백 말풍선 앵커·늦은 도착 페이드인 규칙이 섹션과 같다),
         둘 이상이면 가로 트랙(한 장 반이 보이는 260 폭)으로 투영한다 */
      const contents = section.items || []
      const single = contents.length === 1
      if (!single) items.push({ id: base, type: 'hscroll', stepSub, props: { title: section.title, cardW: '260', items: '' } })
      contents.forEach((c, j) => {
        const common = single
          ? { id: base, stepSub }
          : { id: `${base}-c${j}`, parentId: base, slot: j, w: 260 }
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
              note: c.why || '', // 5c 콘텐츠 단계가 답변을 인용해 적은 "왜 이 콘텐츠인지" (옛 페이지엔 없음)
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
              note: c.why || '',
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
