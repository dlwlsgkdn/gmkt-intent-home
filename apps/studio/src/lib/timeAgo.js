/* 상대 시각 라벨 — 쓰레드 패널·관리 페이지 등 목록 공용.
   7일이 넘으면 "N일 전" 대신 날짜로 접는다. empty는 파싱 불가 시 표시할 값. */
export function timeAgo(iso, { empty = '' } = {}) {
  const t = new Date(iso || '').getTime()
  if (!t) return empty
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '방금 전'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}일 전`
  return new Date(t).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}
