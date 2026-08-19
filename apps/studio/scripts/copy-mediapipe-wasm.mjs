/*
 * MediaPipe 런타임(wasm) → public/mediapipe/wasm 복사 (dev·build 전에 자동 실행).
 *
 * 왜 복사인가: @mediapipe/tasks-vision의 package exports가 wasm 파일을 내보내지 않아
 * 번들러가 `?url`로 집어 갈 수 없다. public/에 두면 개발 서버와 빌드 산출물이 같은 경로
 * (./mediapipe/wasm/...)로 받는다. 12MB짜리 바이너리라 **리포에는 커밋하지 않는다**
 * (.gitignore) — 설치된 패키지에서 매번 가져온다. 얼굴 랜드마커 모델(.task)은 npm이 아니라
 * 구글 배포본이라 public/mediapipe/face_landmarker.task로 커밋되어 있다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(here, '../../../node_modules/@mediapipe/tasks-vision/wasm')
const dest = path.resolve(here, '../public/mediapipe/wasm')

// SIMD 빌드만 쓴다 (요즘 브라우저는 전부 지원 — nosimd까지 복사하면 11MB가 더 붙는다)
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']

if (!fs.existsSync(src)) {
  console.warn('[mediapipe] 패키지를 찾지 못해 복사를 건너뜁니다 — 가상 메이크업 합성은 색조 프리셋으로 동작합니다')
  process.exit(0)
}
fs.mkdirSync(dest, { recursive: true })
for (const file of FILES) {
  const from = path.join(src, file)
  const to = path.join(dest, file)
  // 같은 크기면 다시 쓰지 않는다 — dev 재시작마다 12MB를 복사하지 않기 위해
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue
  fs.copyFileSync(from, to)
  console.log(`[mediapipe] ${file} 복사 완료`)
}
