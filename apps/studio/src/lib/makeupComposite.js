/*
 * 가상 메이크업 합성 — 올린 사진에서 얼굴 랜드마크를 잡아 **입술·볼에만** 룩 색을 얹는다.
 *
 * 왜 랜드마크인가: 화면 고정 위치에 그라데이션을 얹는 방식(CSS tone 프리셋)은 얼굴 크기·각도가
 * 조금만 달라도 색이 엉뚱한 데 앉는다. 여기서 만든 결과가 있으면 비포/애프터의 AFTER를
 * 이 이미지로 갈아끼우고, 실패하면(모델 로드 실패·얼굴 미검출) CSS 프리셋이 그대로 남는다 —
 * 즉 **이 모듈은 언제 실패해도 되는 향상 계층**이다.
 *
 * 사진은 기기 밖으로 나가지 않는다: 모델·wasm은 같은 오리진에서 받고 합성은 캔버스에서 끝난다.
 * (외부 이미지 모델을 쓰는 정밀 렌더는 사용자가 명시로 요청할 때만 — DESIGN 문서 참고)
 */

/* 런타임 자산은 전부 public/mediapipe에서 받는다 (문서 기준 상대 경로 — sample-faces와 같은 규칙).
   wasm은 패키지 exports가 막아 번들러가 못 집어 가므로 predev/prebuild가 복사해 둔다
   (scripts/copy-mediapipe-wasm.mjs), 모델(.task)은 커밋되어 있다 */
const WASM_LOADER_URL = './mediapipe/wasm/vision_wasm_internal.js'
const WASM_BINARY_URL = './mediapipe/wasm/vision_wasm_internal.wasm'
const MODEL_URL = './mediapipe/face_landmarker.task'

/** 합성 캔버스의 최대 변 — 원본이 커도 여기서 줄인다 (미리보기용, 메모리·시간 상한) */
const MAX_EDGE = 900

/* 룩 색조 → 실제로 바를 색. tone 키는 와이어 계약(@ddak/schema LOOK_TONES)과 한 벌이다.
   lip = 입술에 곱해질 색, blush = 볼에 얹을 색 */
export const TONE_PAINT = {
  coral: { lip: '#f4553a', blush: '#ff8f6d' },
  rose: { lip: '#d94b73', blush: '#f0879f' },
  red: { lip: '#c22232', blush: '#e07a80' },
  peach: { lip: '#f4744f', blush: '#ffa584' },
  brown: { lip: '#9c5a44', blush: '#c98a71' },
  plum: { lip: '#8d3b74', blush: '#b16f9e' },
}

/* MediaPipe FaceMesh(478점)의 입술 외곽·내곽 인덱스 — 둘의 차집합이 곧 "입술 면"이다.
   순서가 곧 윤곽선 순회 순서라 그대로 path로 잇는다 */
const LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
/* 볼 위치는 개별 인덱스의 의미에 기대지 않고 **기하로** 잡는다 (눈꼬리·입꼬리·얼굴 가장자리의
   가중 평균) — 인덱스 표를 잘못 외워도 자리가 크게 어긋나지 않는다 */
const EYE_OUTER = { left: 33, right: 263 }
const MOUTH_CORNER = { left: 61, right: 291 }
const FACE_EDGE = { left: 234, right: 454 }

let landmarkerPromise = null

/** 랜드마커 지연 로드 — 룩 섹션이 실제로 그려질 때 한 번만. 실패는 null(향상 계층이라 조용히 포기) */
function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision')
      return FaceLandmarker.createFromOptions(
        { wasmLoaderPath: WASM_LOADER_URL, wasmBinaryPath: WASM_BINARY_URL },
        { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'IMAGE', numFaces: 1 }
      )
    })().catch((e) => {
      console.warn('[makeup] 얼굴 랜드마커를 불러오지 못했어요 — 색조 프리셋으로 대신합니다:', e)
      return null
    })
  }
  return landmarkerPromise
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // 샘플 얼굴은 같은 오리진이지만, 외부 URL도 캔버스로 읽히게
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다'))
    img.src = src
  })
}

/** #rrggbb → rgba(...) — 그라데이션 중간 stop의 투명도를 조절하려면 알파가 필요하다 */
function rgba(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return hex
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** 정규화 랜드마크(0~1) → 캔버스 좌표 */
const toPoints = (landmarks, w, h) => landmarks.map((p) => ({ x: p.x * w, y: p.y * h }))

/** 볼(광대) 중심 — 입꼬리에서 눈꼬리 쪽으로 올라간 뒤 얼굴 바깥으로 조금 밀어낸 자리 */
function cheekCenter(points, side) {
  const mouth = points[MOUTH_CORNER[side]]
  const eye = points[EYE_OUTER[side]]
  const edge = points[FACE_EDGE[side]]
  if (!mouth || !eye || !edge) return null
  return lerp(lerp(mouth, eye, 0.55), edge, 0.3)
}

/**
 * 사진 → data URL (필요하면 축소). 샘플 얼굴은 상대 URL이라 그대로는 서버로 보낼 수 없고,
 * 정밀 렌더 요청 본문은 언제나 data:image/*;base64여야 한다 (@ddak/schema LookRenderBody).
 * 이미 data URL이면 그대로 돌려준다. 실패하면 null.
 */
export async function toPhotoDataUrl(src, maxEdge = MAX_EDGE) {
  if (!src || typeof document === 'undefined') return null
  if (String(src).startsWith('data:')) return src
  let img
  try {
    img = await loadImage(src)
  } catch {
    return null
  }
  const natural = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }
  if (!natural.w || !natural.h) return null
  const scale = Math.min(1, maxEdge / Math.max(natural.w, natural.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(natural.w * scale)
  canvas.height = Math.round(natural.h * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null // 오염된 캔버스 (크로스 오리진)
  }
}

/**
 * 사진 + 룩 색조 → 메이크업을 올린 데이터 URL.
 * 얼굴을 못 찾거나 모델이 없으면 **null** — 호출자는 CSS 색조 프리셋을 그대로 쓰면 된다.
 */
export async function composeMakeup(src, tone) {
  const paint = TONE_PAINT[tone]
  if (!src || !paint || typeof document === 'undefined') return null
  let img
  try {
    img = await loadImage(src)
  } catch {
    return null
  }
  const landmarker = await loadLandmarker()
  if (!landmarker) return null

  const natural = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height }
  if (!natural.w || !natural.h) return null
  const scale = Math.min(1, MAX_EDGE / Math.max(natural.w, natural.h))
  const w = Math.round(natural.w * scale)
  const h = Math.round(natural.h * scale)

  let result
  try {
    result = landmarker.detect(img)
  } catch (e) {
    console.warn('[makeup] 얼굴 검출 실패:', e)
    return null
  }
  const landmarks = result?.faceLandmarks?.[0]
  if (!landmarks || landmarks.length < 400) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  const points = toPoints(landmarks, w, h)
  const faceWidth = dist(points[FACE_EDGE.left], points[FACE_EDGE.right]) || w * 0.6

  /* 볼 — 색을 넓게 퍼뜨리는 방사 그라데이션. soft-light라 피부 명암이 살아 있다 */
  for (const side of ['left', 'right']) {
    const center = cheekCenter(points, side)
    if (!center) continue
    const radius = faceWidth * 0.2
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius)
    /* 중간 stop 없이 색→투명으로 한 번에 떨어뜨리면 경계가 원반처럼 읽힌다 —
       가운데부터 서서히 옅어지게 두 단계로 나눈다 */
    gradient.addColorStop(0, rgba(paint.blush, 0.55))
    gradient.addColorStop(0.5, rgba(paint.blush, 0.22))
    gradient.addColorStop(1, rgba(paint.blush, 0))
    ctx.save()
    ctx.globalCompositeOperation = 'soft-light'
    ctx.globalAlpha = 0.8
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /* 입술 — 외곽에서 내곽을 빼 입술 면만 남기고(evenodd) 곱하기로 얹는다.
     경계는 살짝 흐려 립 라인이 스티커처럼 보이지 않게 한다 (filter 미지원 브라우저는 또렷해질 뿐) */
  const lipBlur = Math.max(1, faceWidth * 0.012)
  ctx.save()
  try {
    ctx.filter = `blur(${lipBlur}px)`
  } catch {
    /* 미지원 — 또렷한 경계로 진행 */
  }
  ctx.globalCompositeOperation = 'multiply'
  ctx.globalAlpha = 0.34
  ctx.fillStyle = paint.lip
  ctx.beginPath()
  const addLoop = (indexes) => {
    indexes.forEach((idx, i) => {
      const p = points[idx]
      if (!p) return
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
  }
  addLoop(LIP_OUTER)
  addLoop(LIP_INNER)
  ctx.fill('evenodd')
  ctx.restore()

  /* 입술 채도 — 곱하기만 하면 어두워지기만 하므로 같은 면에 옅은 발색을 한 번 더 올린다 */
  ctx.save()
  try {
    ctx.filter = `blur(${lipBlur}px)`
  } catch {
    /* 미지원 */
  }
  ctx.globalCompositeOperation = 'soft-light'
  ctx.globalAlpha = 0.26
  ctx.fillStyle = paint.lip
  ctx.beginPath()
  addLoop(LIP_OUTER)
  addLoop(LIP_INNER)
  ctx.fill('evenodd')
  ctx.restore()

  try {
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null // 오염된 캔버스(크로스 오리진 이미지) — 프리셋으로 되돌린다
  }
}
