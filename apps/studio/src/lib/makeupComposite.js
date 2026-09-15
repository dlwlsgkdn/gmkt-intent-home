/*
 * 가상 메이크업 합성 — 올린 사진에서 얼굴 랜드마크를 잡아 **룩 사양(LookSpec)대로** 색을 얹는다.
 *
 * 왜 랜드마크인가: 화면 고정 위치에 그라데이션을 얹는 방식(CSS tone 프리셋)은 얼굴 크기·각도가
 * 조금만 달라도 색이 엉뚱한 데 앉는다. 여기서 만든 결과가 있으면 비포/애프터의 AFTER를
 * 이 이미지로 갈아끼우고, 실패하면(모델 로드 실패·얼굴 미검출) CSS 프리셋이 그대로 남는다 —
 * 즉 **이 모듈은 언제 실패해도 되는 향상 계층**이다.
 *
 * 무엇을 칠하는가(2026-09): 계획 look 섹션의 사양(spec — 강도·립 hex/마감/기법·치크 색/위치/발색·
 * 눈 섀도/라이너/속눈썹/눈썹·베이스 마감/커버력/컨투어/하이라이트)을 그대로 소비한다. 정밀 렌더
 * (BFF buildLookRenderPrompt)도 같은 사양에서 지시문을 만들므로 두 단계의 룩이 같다. 사양이 없는
 * 옛 페이지·시나리오 목업은 색조(tone) 키에서 기본 사양(specFromTone)을 만든다.
 * 부위별 그리기는 각각 try/catch — 한 부위가 실패해도 나머지는 남는다.
 *
 * 사진은 기기 밖으로 나가지 않는다: 모델·wasm은 같은 오리진에서 받고 합성은 캔버스에서 끝난다.
 */

/* 런타임 자산은 전부 public/mediapipe에서 받는다 (문서 기준 상대 경로 — sample-faces와 같은 규칙).
   wasm은 패키지 exports가 막아 번들러가 못 집어 가므로 predev/prebuild가 복사해 둔다
   (scripts/copy-mediapipe-wasm.mjs), 모델(.task)은 커밋되어 있다 */
const WASM_LOADER_URL = './mediapipe/wasm/vision_wasm_internal.js'
const WASM_BINARY_URL = './mediapipe/wasm/vision_wasm_internal.wasm'
const MODEL_URL = './mediapipe/face_landmarker.task'

/** 합성 캔버스의 최대 변 — 원본이 커도 여기서 줄인다 (미리보기용, 메모리·시간 상한) */
const MAX_EDGE = 900

/* 룩 색조 → 기본 발색. tone 키는 와이어 계약(@ddak/schema LOOK_TONES)과 한 벌이고 값은
   @ddak/pipeline look.ts LOOK_TONE_COLORS 의 거울이다. lip = 입술 색, blush = 볼 색 */
export const TONE_PAINT = {
  coral: { lip: '#f4553a', blush: '#ff8f6d' },
  rose: { lip: '#d94b73', blush: '#f0879f' },
  red: { lip: '#c22232', blush: '#e07a80' },
  peach: { lip: '#f4744f', blush: '#ffa584' },
  brown: { lip: '#9c5a44', blush: '#c98a71' },
  plum: { lip: '#8d3b74', blush: '#b16f9e' },
}

/** 색조 키 → 기본 사양 (사양 없는 옛 페이지·시나리오 목업용) — 옛 합성과 같은 인상:
 *  틴트 그라데이션 립 + 볼 앞쪽 블러셔, 눈·베이스는 손대지 않는다 */
export function specFromTone(tone) {
  const paint = TONE_PAINT[tone]
  if (!paint) return null
  return {
    intensity: 'natural',
    lip: { color: paint.lip, finish: 'tint', technique: 'gradient', note: '' },
    cheek: { color: paint.blush, placement: 'apples', strength: 'medium', note: '' },
    eye: { shadow: [], liner: 'none', lashes: 'natural', brow: 'natural', note: '' },
    base: { finish: 'semi-matte', coverage: 'light', contour: false, highlight: false, note: '' },
  }
}

/** 합성 입력 정규화 — 문자열(tone)이면 기본 사양, { tone, spec } 이면 spec(없으면 tone 기본 사양) */
export function resolveLook(look) {
  if (!look) return null
  if (typeof look === 'string') return specFromTone(look)
  const spec = look.spec && look.spec.lip && look.spec.cheek ? look.spec : null
  return spec || specFromTone(look.tone)
}

/* MediaPipe FaceMesh(478점) 인덱스 — "left/right"는 **화면 기준**(정면 사진에서 왼쪽에 보이는 눈이 left)이다.
   입술은 외곽·내곽의 차집합이 곧 "입술 면", 눈꺼풀·눈썹은 바깥 꼭짓점→안쪽 순서라 그대로 path로 잇는다 */
const LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]
const LIP_INNER_TOP = 13
const LIP_INNER_BOTTOM = 14
const LIP_OUTER_BOTTOM = 17
const EYE_OUTER = { left: 33, right: 263 }
const UPPER_LID = {
  left: [33, 246, 161, 160, 159, 158, 157, 173, 133],
  right: [263, 466, 388, 387, 386, 385, 384, 398, 362],
}
const BROW_UPPER = { left: [70, 63, 105, 66, 107], right: [300, 293, 334, 296, 336] }
const BROW_LOWER = { left: [46, 53, 52, 65, 55], right: [276, 283, 282, 295, 285] }
const MOUTH_CORNER = { left: 61, right: 291 }
const FACE_EDGE = { left: 234, right: 454 }
const NOSE_BRIDGE = { top: 6, tip: 4 }
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]

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

/** 설문 시점 얼굴 확인 (Figma 설문 "사진 분석 중 → 사진이 등록되었어요 / 얼굴이 잘 보이지 않아요") — 사진에서 얼굴
    랜드마크가 잡히는지만 본다. true = 얼굴 있음, false = 못 찾음, null = 검출기를 못 써서 판단 불가.
    합성과 같은 향상 계층이라 null 이면 호출자가 그냥 통과시킨다 (모델 12MB 첫 로드는 여기서 미리 데워 두는 셈 —
    계획 단계의 가상 메이크업이 같은 랜드마커를 다시 쓴다) */
export async function detectFace(src) {
  const landmarker = await loadLandmarker()
  if (!landmarker) return null
  let img
  try {
    img = await loadImage(src)
  } catch {
    return null
  }
  try {
    const result = landmarker.detect(img)
    const landmarks = result?.faceLandmarks?.[0]
    return !!(landmarks && landmarks.length >= 400)
  } catch (e) {
    console.warn('[makeup] 얼굴 확인 실패 — 사진을 그대로 받습니다:', e)
    return null
  }
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

/** #rrggbb → rgba(...) — 그라데이션 stop의 투명도를 조절하려면 알파가 필요하다. 형식이 아니면 그대로 */
function rgba(hex, alpha) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''))
  if (!m) return hex
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const mean = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length })
const norm = (v) => {
  const len = Math.hypot(v.x, v.y) || 1
  return { x: v.x / len, y: v.y / len }
}
const scaleAbout = (p, c, s) => ({ x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s })

/** 정규화 랜드마크(0~1) → 캔버스 좌표 */
const toPoints = (landmarks, w, h) => landmarks.map((p) => ({ x: p.x * w, y: p.y * h }))

function setBlur(ctx, px) {
  try {
    ctx.filter = px > 0 ? `blur(${px}px)` : 'none'
  } catch {
    /* filter 미지원 — 또렷한 경계로 진행 */
  }
}

function polygonPath(ctx, pts) {
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
}

function fillPolygon(ctx, pts, { style, op = 'source-over', alpha = 1, blur = 0 }) {
  ctx.save()
  setBlur(ctx, blur)
  ctx.globalCompositeOperation = op
  ctx.globalAlpha = alpha
  ctx.fillStyle = style
  ctx.beginPath()
  polygonPath(ctx, pts)
  ctx.fill()
  ctx.restore()
}

function strokePolyline(ctx, pts, { color, width, alpha = 1, blur = 0, op = 'source-over' }) {
  ctx.save()
  setBlur(ctx, blur)
  ctx.globalCompositeOperation = op
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, width)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.stroke()
  ctx.restore()
}

/** 타원형 방사 그라데이션 한 장 — 가운데 진하고 가장자리로 사라진다(중간 stop 없이 떨어뜨리면 원반처럼 읽힌다).
 *  원을 rx/ry 로 늘려 그리므로 그라데이션도 타원을 따라 사라진다 */
function paintEllipse(ctx, { center, rx, ry, rot = 0, color, op, alpha, blur = 0, stops = [0.75, 0.35, 0] }) {
  const r = Math.max(rx, ry, 1)
  ctx.save()
  setBlur(ctx, blur)
  ctx.globalCompositeOperation = op
  ctx.globalAlpha = alpha
  ctx.translate(center.x, center.y)
  ctx.rotate(rot)
  ctx.scale(rx / r, ry / r)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, rgba(color, stops[0]))
  g.addColorStop(0.5, rgba(color, stops[1]))
  g.addColorStop(1, rgba(color, stops[2]))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** 광대 기준점 — 입꼬리에서 눈꼬리 쪽으로 올라간 뒤 얼굴 바깥으로 조금 밀어낸 자리 */
function cheekbone(points, side) {
  const mouth = points[MOUTH_CORNER[side]]
  const eye = points[EYE_OUTER[side]]
  const edge = points[FACE_EDGE[side]]
  if (!mouth || !eye || !edge) return null
  return { mouth, eye, edge, point: lerp(lerp(mouth, eye, 0.6), edge, 0.32) }
}

/* ── 부위별 그리기 — 순서: 베이스 → 치크 → 눈 → 립 (실제 화장 순서. 립이 맨 위라 색이 가장 또렷하다) ── */

/** 베이스 — 커버력(얼굴 안쪽만 흐린 사본을 얇게 얹어 결을 고른다)·컨투어·하이라이트·매트 */
function paintBase({ ctx, points, faceWidth, spec, alpha, blur, w, h }) {
  const base = spec.base || {}
  const oval = FACE_OVAL.map((i) => points[i])
  if (oval.some((p) => !p)) return
  const center = mean(oval)
  const COVER = { light: 0, medium: 0.16, full: 0.3 }
  const cover = COVER[base.coverage] ?? 0
  if (cover > 0) {
    const off = document.createElement('canvas')
    off.width = w
    off.height = h
    const octx = off.getContext('2d')
    if (octx) {
      octx.drawImage(ctx.canvas, 0, 0)
      ctx.save()
      ctx.beginPath()
      polygonPath(ctx, oval.map((p) => scaleAbout(p, center, 0.94)))
      ctx.clip()
      setBlur(ctx, blur(0.02))
      ctx.globalAlpha = alpha(cover)
      ctx.drawImage(off, 0, 0)
      ctx.restore()
    }
  }
  for (const side of ['left', 'right']) {
    const cb = cheekbone(points, side)
    if (!cb) continue
    const rot = Math.atan2(cb.edge.y - cb.mouth.y, cb.edge.x - cb.mouth.x)
    if (base.contour) {
      // 광대 아래·바깥쪽을 따라 어두운 띠
      const under = lerp(cb.point, lerp(cb.mouth, cb.edge, 0.6), 0.55)
      paintEllipse(ctx, { center: under, rx: faceWidth * 0.17, ry: faceWidth * 0.06, rot, color: '#7a4a35', op: 'multiply', alpha: alpha(0.3), blur: blur(0.01) })
    }
    if (base.highlight || base.finish === 'dewy') {
      // 광대 위 하이라이트 — dewy 마감은 하이라이트가 없어도 은은하게
      const top = lerp(cb.point, cb.eye, 0.35)
      paintEllipse(ctx, { center: top, rx: faceWidth * 0.09, ry: faceWidth * 0.05, rot, color: '#ffffff', op: 'screen', alpha: alpha(base.highlight ? 0.42 : 0.24), blur: blur(0.008) })
    }
  }
  if (base.highlight || base.finish === 'dewy') {
    const top = points[NOSE_BRIDGE.top]
    const tip = points[NOSE_BRIDGE.tip]
    if (top && tip) strokePolyline(ctx, [top, lerp(top, tip, 0.85)], { color: '#ffffff', width: faceWidth * 0.03, alpha: alpha(base.highlight ? 0.22 : 0.12), blur: blur(0.012), op: 'screen' })
  }
  if (base.finish === 'matte') {
    // 얼굴 안쪽의 윤기를 살짝 죽인다
    fillPolygon(ctx, oval, { style: '#e8d8cf', op: 'multiply', alpha: alpha(0.08), blur: blur(0.03) })
  }
}

/** 치크 — 색(hex)·위치(볼 앞/광대/드레이핑)·발색. 색상 치환 + 곱하기 두 겹이라 피부 명암이 살아 있다 */
function paintCheeks({ ctx, points, faceWidth, spec, alpha, blur }) {
  const cheek = spec.cheek || {}
  const STRENGTH = { light: 0.32, medium: 0.5, strong: 0.72 }
  const base = STRENGTH[cheek.strength] ?? 0.5
  for (const side of ['left', 'right']) {
    const cb = cheekbone(points, side)
    if (!cb) continue
    let center
    let rx
    let ry
    let rot = 0
    if (cheek.placement === 'cheekbones') {
      center = cb.point
      rx = faceWidth * 0.19
      ry = faceWidth * 0.11
      rot = Math.atan2(cb.eye.y - cb.mouth.y, cb.eye.x - cb.mouth.x)
    } else if (cheek.placement === 'drape') {
      const temple = lerp(cb.eye, cb.edge, 0.5)
      center = lerp(cb.point, temple, 0.4)
      rx = faceWidth * 0.26
      ry = faceWidth * 0.11
      rot = Math.atan2(temple.y - cb.point.y, temple.x - cb.point.x)
    } else {
      // apples — 볼 앞쪽, 둥글게
      center = lerp(lerp(cb.mouth, cb.eye, 0.42), cb.edge, 0.18)
      rx = faceWidth * 0.17
      ry = faceWidth * 0.15
    }
    const shape = { center, rx, ry, rot, color: cheek.color, blur: blur(0.006) }
    paintEllipse(ctx, { ...shape, op: 'color', alpha: alpha(base * 0.7) })
    paintEllipse(ctx, { ...shape, op: 'multiply', alpha: alpha(base * 0.55) })
  }
}

/** 눈 — 섀도(눈두덩 바탕 → 눈꼬리·크리즈 → 눈앞머리)·라이너(thin/winged)·속눈썹 볼륨·눈썹 채움 */
function paintEyes({ ctx, points, faceWidth, spec, alpha, blur }) {
  const eye = spec.eye || {}
  const glam = spec.intensity === 'glam'
  const shadow = (eye.shadow || []).filter(Boolean)
  for (const side of ['left', 'right']) {
    const lid = UPPER_LID[side].map((i) => points[i]) // 바깥 꼭짓점 → 안쪽
    const browLow = BROW_LOWER[side].map((i) => points[i])
    const browUp = BROW_UPPER[side].map((i) => points[i])
    if (lid.some((p) => !p) || browLow.some((p) => !p) || browUp.some((p) => !p)) continue
    const lidCenter = mean(lid)
    const browCenter = mean(browLow)
    const up = { x: browCenter.x - lidCenter.x, y: browCenter.y - lidCenter.y } // 눈꺼풀 → 눈썹 방향
    const eyeW = dist(lid[0], lid[lid.length - 1]) || faceWidth * 0.2

    if (shadow.length) {
      const f = glam ? 0.72 : 0.5 // 눈썹까지의 거리 중 어디까지 올릴지
      const top = lid.map((p) => ({ x: p.x + up.x * f, y: p.y + up.y * f }))
      const region = [...lid, ...top.slice().reverse()]
      const g = ctx.createLinearGradient(lidCenter.x, lidCenter.y, lidCenter.x + up.x * f, lidCenter.y + up.y * f)
      g.addColorStop(0, rgba(shadow[0], 0.85))
      g.addColorStop(0.6, rgba(shadow[0], 0.45))
      g.addColorStop(1, rgba(shadow[0], 0))
      fillPolygon(ctx, region, { style: g, op: 'multiply', alpha: alpha(glam ? 0.7 : 0.5), blur: blur(0.012) })
      if (shadow[1]) {
        const c = { x: lid[0].x + up.x * 0.25, y: lid[0].y + up.y * 0.25 } // 눈꼬리 위
        const g2 = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, eyeW * 0.55)
        g2.addColorStop(0, rgba(shadow[1], 0.85))
        g2.addColorStop(1, rgba(shadow[1], 0))
        fillPolygon(ctx, region, { style: g2, op: 'multiply', alpha: alpha(glam ? 0.75 : 0.55), blur: blur(0.012) })
      }
      if (shadow[2]) {
        const inner = lid[lid.length - 1]
        const g3 = ctx.createRadialGradient(inner.x, inner.y, 0, inner.x, inner.y, eyeW * 0.3)
        g3.addColorStop(0, rgba(shadow[2], 0.8))
        g3.addColorStop(1, rgba(shadow[2], 0))
        fillPolygon(ctx, region, { style: g3, op: 'screen', alpha: alpha(0.45), blur: blur(0.01) })
      }
    }

    if (eye.liner && eye.liner !== 'none') {
      const path = [...lid]
      if (eye.liner === 'winged') {
        // 눈꼬리에서 바깥·위로 뺀 윙
        const outer = lid[0]
        const dir = norm({ x: outer.x - lid[2].x, y: outer.y - lid[2].y })
        const upN = norm(up)
        const len = faceWidth * 0.045
        path.unshift({ x: outer.x + dir.x * len + upN.x * len * 0.55, y: outer.y + dir.y * len + upN.y * len * 0.55 })
      }
      strokePolyline(ctx, path, { color: '#1b1416', width: faceWidth * (eye.liner === 'winged' ? 0.0075 : 0.0055), alpha: alpha(0.85), blur: blur(0.003) })
    }
    if (eye.lashes === 'volume') {
      // 라인 위에 넓고 옅은 어두운 띠 — 속눈썹 밀도 근사
      strokePolyline(ctx, lid, { color: '#161114', width: faceWidth * 0.014, alpha: alpha(0.38), blur: blur(0.007) })
    }
    if (eye.brow === 'defined') {
      fillPolygon(ctx, [...browUp, ...browLow.slice().reverse()], { style: '#4a3128', op: 'multiply', alpha: alpha(0.4), blur: blur(0.008) })
    }
  }
}

/** 립 — 색(hex)·마감(matte/velvet/glossy/tint)·기법(full/gradient/overlined). 색상 치환으로 결을 살리고 곱하기로 깊이를 준다 */
function paintLips({ ctx, points, faceWidth, spec, alpha, blur }) {
  const lip = spec.lip || {}
  const outerPts = LIP_OUTER.map((i) => points[i])
  const innerPts = LIP_INNER.map((i) => points[i])
  if (outerPts.some((p) => !p) || innerPts.some((p) => !p)) return
  const center = lerp(points[LIP_INNER_TOP], points[LIP_INNER_BOTTOM], 0.5)
  const lipW = dist(points[MOUTH_CORNER.left], points[MOUTH_CORNER.right]) || faceWidth * 0.35
  const outer = lip.technique === 'overlined' ? outerPts.map((p) => scaleAbout(p, center, 1.05)) : outerPts
  const FINISH = {
    matte: { color: 0.95, mult: 0.42 },
    velvet: { color: 0.88, mult: 0.34 },
    glossy: { color: 0.82, mult: 0.28 },
    tint: { color: 0.6, mult: 0.16 },
  }
  const f = FINISH[lip.finish] || FINISH.tint
  const edge = blur(lip.finish === 'matte' ? 0.008 : 0.012) // 매트는 립 라인이 또렷, 나머지는 살짝 번진다
  const styleOf = () => {
    if (lip.technique !== 'gradient') return lip.color
    // 안쪽만 진하고 가장자리로 옅어지는 방사 마스크
    const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, lipW * 0.6)
    g.addColorStop(0, rgba(lip.color, 1))
    g.addColorStop(0.45, rgba(lip.color, 0.75))
    g.addColorStop(1, rgba(lip.color, 0.12))
    return g
  }
  const drawLip = (op, al) => {
    ctx.save()
    setBlur(ctx, edge)
    ctx.globalCompositeOperation = op
    ctx.globalAlpha = al
    ctx.fillStyle = styleOf()
    ctx.beginPath()
    polygonPath(ctx, outer)
    polygonPath(ctx, innerPts)
    ctx.fill('evenodd')
    ctx.restore()
  }
  drawLip('color', alpha(f.color)) // 색상 치환 — 명암(결)은 남기고 색만 바꾼다
  drawLip('multiply', alpha(f.mult)) // 깊이
  if (lip.finish === 'glossy') {
    // 아랫입술 가운데 윤광 — 입술 면 안에서만
    const lower = lerp(points[LIP_INNER_BOTTOM], points[LIP_OUTER_BOTTOM], 0.45)
    const lipH = dist(points[LIP_INNER_BOTTOM], points[LIP_OUTER_BOTTOM]) || lipW * 0.2
    ctx.save()
    ctx.beginPath()
    polygonPath(ctx, outer)
    polygonPath(ctx, innerPts)
    ctx.clip('evenodd')
    setBlur(ctx, blur(0.008))
    ctx.globalCompositeOperation = 'screen'
    ctx.globalAlpha = alpha(0.5)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.ellipse(lower.x, lower.y, lipW * 0.16, Math.max(1, lipH * 0.3), 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/**
 * 사진 → data URL (필요하면 축소). 샘플 얼굴은 상대 URL이라 그대로는 서버로 보낼 수 없고,
 * 정밀 렌더 요청 본문은 언제나 data:image/*;base64여야 한다 (@ddak/schema LookRenderBody).
 * 이미 data URL이면 그대로 돌려준다. 실패하면 null.
 */
export async function toPhotoDataUrl(src, maxEdge = MAX_EDGE, opts = {}) {
  if (!src || typeof document === 'undefined') return null
  /* 이미 data URL이면 그대로 — 전송 경로용 지름길이다 (고른 사진은 이미 720px 이하).
     단 opts.force면 **반드시 다시 그린다**: 캐시 저장처럼 "지금 크기가 얼마든 줄여야 하는"
     경로가 이 지름길을 타면 2MB대 PNG가 통째로 localStorage로 가서 조용히 실패한다 */
  if (!opts.force && String(src).startsWith('data:')) return src
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
 * 정밀 렌더 결과를 원본 사진의 가로세로 비율로 되맞춘다. 이미지 편집 API는 출력 크기를 표준 규격
 * (1024×1536 등)으로 맞추느라 원본(예: 3:4)을 세로로 살짝 늘려 돌려준다 — 비포/애프터 슬라이더는
 * 두 층을 같은 상자에 cover로 깔기 때문에 비율이 다르면 애프터 얼굴이 원본보다 길어 보이고 이음새가
 * 어긋난다. 출력 해상도(가로)는 그대로 두고 세로만 원본 비율로 다시 샘플링한다: 모델이 늘린 것을
 * 되돌리는 것이므로 왜곡을 더하지 않는다. 비율 차이가 0.5% 이내면 그대로, 어떤 실패에도 입력을
 * 그대로 돌려준다 (향상 계층 원칙).
 */
export async function matchAspectTo(dataUrl, refSrc) {
  if (!dataUrl || !refSrc || typeof document === 'undefined') return dataUrl
  try {
    const [img, ref] = await Promise.all([loadImage(dataUrl), loadImage(refSrc)])
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    const rw = ref.naturalWidth || ref.width
    const rh = ref.naturalHeight || ref.height
    if (!iw || !ih || !rw || !rh) return dataUrl
    const targetH = Math.round((iw * rh) / rw)
    if (Math.abs(targetH - ih) / ih < 0.005) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = iw
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, iw, ih, 0, 0, iw, targetH)
    return canvas.toDataURL('image/png')
  } catch {
    return dataUrl
  }
}

/**
 * 사진 + 룩(색조 키 또는 { tone, spec }) → 메이크업을 올린 데이터 URL.
 * 얼굴을 못 찾거나 모델이 없으면 **null** — 호출자는 CSS 색조 프리셋을 그대로 쓰면 된다.
 */
export async function composeMakeup(src, look) {
  const spec = resolveLook(look)
  if (!src || !spec || typeof document === 'undefined') return null
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
  const k = spec.intensity === 'glam' ? 1.3 : 1 // 강도 배율 — 사양의 부위별 발색 위에 곱한다
  const painter = {
    ctx,
    points,
    faceWidth,
    spec,
    w,
    h,
    alpha: (v) => Math.min(0.95, v * k),
    blur: (fraction) => Math.max(0.5, faceWidth * fraction),
  }
  for (const step of [paintBase, paintCheeks, paintEyes, paintLips]) {
    ctx.save()
    try {
      step(painter)
    } catch (e) {
      console.warn('[makeup] 부위 합성 실패 — 이 부위는 건너뜁니다:', e)
    }
    ctx.restore()
  }

  try {
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    return null // 오염된 캔버스(크로스 오리진 이미지) — 프리셋으로 되돌린다
  }
}
