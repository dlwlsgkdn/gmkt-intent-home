/*
 * 채팅형 AI(claude.ai 등)에 붙여넣을 프롬프트 봉투(envelope).
 *
 * 스튜디오는 API 키를 쓰지 않는다. 모든 AI 기능은 "프롬프트를 복사해 쓰던 AI에 붙여넣고,
 * 돌아온 결과를 다시 붙여넣는다"는 하나의 왕복으로 통일돼 있다.
 * API 호출이라면 응답 스키마를 강제할 수 있지만 채팅창에는 그 장치가 없으므로,
 * 봉투가 (1) 출력 형식을 앞뒤로 두 번 못 박고, (2) 스키마 밖 키를 막고,
 * (3) 결과를 스튜디오 어디에 붙여넣을지까지 알려준다.
 */

const JSON_RULES = [
  '- 설명·머리말·맺음말 없이 ```json 코드블록 **하나만** 출력합니다.',
  '- 아래 스키마에 있는 키만 사용하고, 새 키를 추가하지 않습니다.',
  '- 모든 문자열은 한국어로 작성합니다.',
]

const DIVIDER = '─────────────────────────────'

export function wrapForChatApp(prompt, options = {}) {
  const { json = true, webSearch = false, pasteTarget = '' } = options
  const headLines = ['DDAK 시나리오 스튜디오에 붙여넣을 결과를 만들어 주세요.']
  if (webSearch) headLines.push('필요하면 웹 검색을 사용해 실제 정보를 확인해도 좋습니다.')
  headLines.push('', '출력 규칙:')
  headLines.push(...(json
    ? JSON_RULES
    : ['- 요청한 형식의 줄만 출력하고, 설명 문장이나 표 기호는 쓰지 않습니다.']))
  headLines.push('', DIVIDER, '')

  const tailLines = ['', DIVIDER, '']
  tailLines.push(json
    ? '다시 강조합니다: 위 스키마를 그대로 따르는 ```json 코드블록 하나만 출력하세요.'
    : '다시 강조합니다: 요청한 형식의 줄만 출력하세요.')
  if (pasteTarget) tailLines.push(`(이 결과는 스튜디오의 "${pasteTarget}"에 붙여넣습니다.)`)

  return `${headLines.join('\n')}\n${prompt}\n${tailLines.join('\n')}`
}
