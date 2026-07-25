/*
 * 채팅 응답에서 JSON 본문 건져내기.
 *
 * 스튜디오는 API가 아니라 채팅창을 거치므로, 응답에는 코드블록 표시나 앞뒤 설명 문장이 섞여 들어온다.
 * 프롬프트에서 "코드블록 하나만" 이라고 못 박아도 실제로는 지켜지지 않는 경우가 있어서,
 * 붙여넣은 원문을 그대로 받아 JSON 부분만 잘라내는 일은 이 한 곳에서 처리한다.
 */

/* ```json … ``` 코드블록이 있으면 그 안쪽을, 없으면 첫 여는 괄호~마지막 닫는 괄호 구간을 돌려준다 */
export function extractJsonText(value) {
  const text = String(value || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()
  const arrayStart = text.indexOf('[')
  const objectStart = text.indexOf('{')
  const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart
  if (start < 0) return text
  const end = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'))
  return end > start ? text.slice(start, end + 1) : text
}

/* 문자열이면 잘라내 파싱하고, 이미 객체면 그대로 — 파싱 실패는 호출부가 사용자 메시지로 감싼다 */
export function parseJsonAnswer(raw) {
  if (typeof raw !== 'string') return raw
  return JSON.parse(extractJsonText(raw))
}
