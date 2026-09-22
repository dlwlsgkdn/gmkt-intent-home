/* 비포/애프터 얼굴 정렬의 순수 기하. AFTER → 원본 좌표로 이동·회전·균일 확대만 한다.
   가로/세로를 따로 늘이거나 얼굴을 워핑하지 않는다. 저장하는 것은 픽셀이 아니라 이 변환이다. */
export const FACE_ALIGNMENT_VERSION = 1

const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const validSize = (s) => s && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0

export function transformPoint(p, m) {
  return { x: m.a * p.x - m.b * p.y + m.x, y: m.b * p.x + m.a * p.y + m.y }
}

/** 눈꼬리/눈머리의 중점 — 홍채는 시선에 따라 움직이고 속눈썹/눈썹은 메이크업으로 바뀐다.
 * MediaPipe의 정규화 좌표를 반드시 각 이미지의 실제 픽셀 좌표로 환산한다. */
export function faceAnchors(landmarks, size) {
  if (!validSize(size)) return null
  const indices = [33, 133, 362, 263, 4]
  const points = indices.map((i) => landmarks?.[i])
  if (points.some((p) => !finitePoint(p) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return null
  const [l1, l2, r1, r2, nose] = points.map((p) => ({ x: p.x * size.width, y: p.y * size.height }))
  return { left: midpoint(l1, l2), right: midpoint(r1, r2), nose }
}

/** 원본 중심의 동일 비율 사각형을 두 이미지의 교집합 안으로 줄인다.
 * 역변환한 네 꼭짓점이 AFTER 내부이면 사각형 전체도 내부다(볼록). 가장자리 보간용 1px 여유. */
export function sharedCrop(source, reference, transform) {
  if (!validSize(source) || !validSize(reference)) return null
  const { a, b, x, y } = transform
  const determinant = a * a + b * b
  if (![a, b, x, y].every(Number.isFinite) || determinant < 1e-8) return null
  const fits = (ratio) => {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const px = reference.width * (1 + sx * ratio) / 2
      const py = reference.height * (1 + sy * ratio) / 2
      const dx = px - x, dy = py - y
      const ix = (a * dx + b * dy) / determinant
      const iy = (-b * dx + a * dy) / determinant
      if (px < 1 || py < 1 || px > reference.width - 1 || py > reference.height - 1 ||
          ix < 1 || iy < 1 || ix > source.width - 1 || iy > source.height - 1) return false
    }
    return true
  }
  if (!fits(0)) return null
  let low = 0, high = 1
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  // 과도한 줌/잘림이 필요한 결과는 원래 구도가 너무 달라진 것 — 기기 합성을 유지한다.
  if (low < 0.72) return null
  return {
    x: reference.width * (1 - low) / 2,
    y: reference.height * (1 - low) / 2,
    width: reference.width * low,
    height: reference.height * low,
  }
}

/** AFTER 눈 두 점을 BEFORE 눈 두 점에 정확히 대응시키는 similarity transform.
 * 코 끝은 맞춤에 사용하지 않고 독립적인 품질 검사로 남겨 고개/얼굴 구조 변화와 오검출을 거른다. */
export function calculateFaceAlignment(sourceFace, referenceFace, source, reference) {
  if (!validSize(source) || !validSize(reference)) return null
  if ([sourceFace, referenceFace].some((f) => !f || ![f.left, f.right, f.nose].every(finitePoint))) return null
  const fromDistance = distance(sourceFace.left, sourceFace.right)
  const toDistance = distance(referenceFace.left, referenceFace.right)
  if (fromDistance < source.width * 0.035 || toDistance < reference.width * 0.035) return null
  const scale = toDistance / fromDistance
  const relativeScale = scale * source.width / reference.width
  const fromAngle = Math.atan2(sourceFace.right.y - sourceFace.left.y, sourceFace.right.x - sourceFace.left.x)
  const toAngle = Math.atan2(referenceFace.right.y - referenceFace.left.y, referenceFace.right.x - referenceFace.left.x)
  const angle = Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle))
  if (relativeScale < 0.65 || relativeScale > 1.5 || Math.abs(angle) > Math.PI / 12) return null
  const fromCenter = midpoint(sourceFace.left, sourceFace.right)
  const toCenter = midpoint(referenceFace.left, referenceFace.right)
  const a = scale * Math.cos(angle), b = scale * Math.sin(angle)
  const transform = {
    a, b,
    x: toCenter.x - a * fromCenter.x + b * fromCenter.y,
    y: toCenter.y - b * fromCenter.x - a * fromCenter.y,
  }
  if (distance(transformPoint(sourceFace.nose, transform), referenceFace.nose) > toDistance * 0.15) return null
  const crop = sharedCrop(source, reference, transform)
  if (!crop) return null
  return { version: FACE_ALIGNMENT_VERSION, source, reference, transform, crop }
}

/** 저장된 정렬도 치수·유한값·공통 크롭을 검증한다. 옛 버전은 원본에서 다시 계산한다. */
export function reusableFaceAlignment(alignment, source, reference) {
  if (alignment?.version !== FACE_ALIGNMENT_VERSION || !validSize(source) || !validSize(reference)) return null
  if (alignment.source?.width !== source.width || alignment.source?.height !== source.height ||
      alignment.reference?.width !== reference.width || alignment.reference?.height !== reference.height) return null
  if (!alignment.transform) return null
  const crop = sharedCrop(source, reference, alignment.transform)
  return crop ? { ...alignment, crop } : null
}
