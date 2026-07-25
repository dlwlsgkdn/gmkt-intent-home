/*
 * 추천 상품 후보 수집 — "상품 찾기 프롬프트"와 그 결과 파싱.
 *
 * 시나리오 목업/데이터셋용이라 "실제로 존재하는 상품명"을 확보하는 게 목적이다.
 * 검색은 스튜디오가 아니라 사용자가 쓰는 AI(웹 검색 가능한 채팅)가 수행하고,
 * 스튜디오는 프롬프트를 만들어 주고 돌아온 줄을 파싱해 카탈로그 입력란을 채우기만 한다
 * (생성에 바로 들어가지 않음 — 사용자가 검토·수정한 뒤 사용).
 * 가격은 검색 시점 기준이라 정확하지 않을 수 있다.
 */

export const DEFAULT_SEARCH_COUNT = 6

export function buildProductSearchPrompt({ query, persona, notes, count = DEFAULT_SEARCH_COUNT }) {
  return [
    `당신은 한국 이커머스 상품 리서처입니다. 아래 검색 의도에 맞는 실제 상품 ${count}개를 웹에서 찾아 정리하세요.`,
    '',
    `검색 의도: ${query}`,
    persona ? `대상 페르소나: ${persona}` : '',
    notes ? `추가 조건: ${notes}` : '',
    '',
    '규칙:',
    '1. 웹 검색으로 실제 판매 중인 상품을 찾습니다. 상품명과 브랜드는 검색으로 확인한 실제 이름을 씁니다.',
    '2. 한국에서 살 수 있는 상품 위주로, 서로 다른 브랜드·유형이 섞이게 고릅니다. 같은 상품을 중복하지 않습니다.',
    '3. 가격은 검색에서 확인한 대략적인 원화 가격을 숫자와 쉼표만으로 씁니다(예: 22,900). 확인이 안 되면 비웁니다.',
    '4. 정가(할인 전 가격)를 알 수 있으면 쓰고, 모르면 비웁니다.',
    '5. 특징은 이 검색 의도에 왜 맞는지를 한 줄로 씁니다.',
    '',
    '출력 형식 — 아래 형식의 줄만 출력합니다. 머리말·번호·표 기호·설명 문장을 쓰지 마세요.',
    '브랜드 | 상품명 | 가격 | 정가 | 특징',
    '',
    '예시:',
    '클리오 | 킬커버 픽서 쿠션 | 22,900 | 32,000 | 밀착력 좋은 픽서 타입으로 오래 지속',
  ].filter(Boolean).join('\n')
}

/* 모델이 앞뒤로 설명을 붙이거나 마크다운 표로 내놓아도 상품 줄만 건져낸다 */
export function parseProductSearchResult(text) {
  const lines = String(text || '').split('\n')
  const rows = []
  lines.forEach((rawLine) => {
    let line = rawLine.trim()
    if (!line) return
    if (/^[|\s:-]+$/.test(line)) return // 마크다운 표 구분선
    line = line.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '') // 불릿·번호 제거
    line = line.replace(/^\|/, '').replace(/\|$/, '').trim() // 마크다운 표 행
    const parts = line.split('|').map((part) => part.trim())
    if (parts.length < 2 || !parts[1]) return
    if (/^브랜드$/.test(parts[0])) return // 표 헤더
    rows.push(parts.slice(0, 5).join(' | '))
  })
  return rows
}

/* 기존 카탈로그와 상품명이 겹치지 않게 이어붙인다 */
export function mergeCatalogText(existingText, newRows) {
  const existing = String(existingText || '').trim()
  const nameOf = (line) => (line.split('|')[1] || '').trim()
  const seen = new Set(
    existing.split('\n').map(nameOf).filter(Boolean)
  )
  const added = newRows.filter((row) => {
    const name = nameOf(row)
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })
  const merged = existing ? [existing, ...added].join('\n') : added.join('\n')
  return { text: merged, addedCount: added.length, skipped: newRows.length - added.length }
}
