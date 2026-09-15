import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateFaceAlignment, faceAnchors, reusableFaceAlignment, sharedCrop, transformPoint,
} from '../src/lib/faceAlignment.js'
import { lookRenderInputKey } from '../src/lib/lookCache.js'

const reference = { width: 600, height: 800 }
const face = { left: { x: 190, y: 270 }, right: { x: 410, y: 275 }, nose: { x: 300, y: 365 } }
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} ≠ ${b}`)
const moveFace = (m) => Object.fromEntries(Object.entries(face).map(([key, p]) => [key, transformPoint(p, m)]))

test('같은 이미지 비율에서도 눈 위치 이동을 보정한다', () => {
  const after = moveFace({ a: 1, b: 0, x: 12, y: -28 })
  const alignment = calculateFaceAlignment(after, face, reference, reference)
  assert.ok(alignment)
  close(alignment.transform.x, -12, '가로 이동')
  close(alignment.transform.y, 28, '눈높이 이동')
})

for (const source of [{ width: 900, height: 1200 }, { width: 1024, height: 1536 }]) {
  test(`출력 비율 ${source.width}×${source.height}: 눈높이·크기·회전을 균일 변환으로 맞춘다`, () => {
    const angle = 5 * Math.PI / 180
    const scale = source.width / reference.width * 1.04
    const a = scale * Math.cos(angle), b = scale * Math.sin(angle)
    const forward = {
      a, b,
      x: source.width / 2 - a * reference.width / 2 + b * reference.height / 2 + 8,
      y: source.height / 2 - b * reference.width / 2 - a * reference.height / 2 - 28,
    }
    const after = moveFace(forward)
    const alignment = calculateFaceAlignment(after, face, source, reference)
    assert.ok(alignment)
    for (const key of ['left', 'right', 'nose']) {
      const aligned = transformPoint(after[key], alignment.transform)
      close(aligned.x, face[key].x, `${key}.x`)
      close(aligned.y, face[key].y, `${key}.y`)
    }
    close(Math.hypot(alignment.transform.a, alignment.transform.b), 1 / scale, '균일 확대율')
    const crop = alignment.crop
    close(crop.width / crop.height, reference.width / reference.height, '원본 비율의 공통 크롭')
    for (const x of [crop.x, crop.x + crop.width]) for (const y of [crop.y, crop.y + crop.height]) {
      assert.ok(x >= 1 && x <= reference.width - 1 && y >= 1 && y <= reference.height - 1)
      const p = transformPoint({ x, y }, forward)
      assert.ok(p.x >= 1 - 1e-7 && p.x <= source.width - 1 + 1e-7, 'AFTER 가로 빈 공간 없음')
      assert.ok(p.y >= 1 - 1e-7 && p.y <= source.height - 1 + 1e-7, 'AFTER 세로 빈 공간 없음')
    }
  })
}

test('눈 정렬에 사용하지 않은 코로 고개/얼굴 구조 변화 결과를 거른다', () => {
  assert.equal(calculateFaceAlignment({ ...face, nose: { x: 360, y: 370 } }, face, reference, reference), null)
  assert.equal(calculateFaceAlignment({ ...face, nose: { x: 300, y: 430 } }, face, reference, reference), null)
})

test('과도한 회전·확대·잘림과 검출 실패는 정렬하지 않는다', () => {
  const angle = 20 * Math.PI / 180
  for (const after of [null, { ...face, right: face.left }, moveFace({ a: Math.cos(angle), b: Math.sin(angle), x: 0, y: 0 }),
    moveFace({ a: 2, b: 0, x: 0, y: 0 }), moveFace({ a: 1, b: 0, x: 200, y: 0 })]) {
    assert.equal(calculateFaceAlignment(after, face, reference, reference), null)
  }
  assert.equal(sharedCrop(reference, reference, { a: NaN, b: 0, x: 0, y: 0 }), null)
  assert.equal(sharedCrop(reference, reference, { a: 0, b: 0, x: 0, y: 0 }), null)
})

test('정규화 랜드마크는 눈꼬리/눈머리 중점과 각 이미지 치수를 사용한다', () => {
  const landmarks = []
  for (const [i, x, y] of [[33, .2, .3], [133, .4, .3], [362, .6, .3], [263, .8, .3], [4, .5, .5]]) {
    landmarks[i] = { x, y }
  }
  const result = faceAnchors(landmarks, reference)
  close(result.left.x, 180, '왼쪽 눈')
  close(result.right.x, 420, '오른쪽 눈')
  close(result.left.y, 240, '눈높이')
  assert.deepEqual(result.nose, { x: 300, y: 400 })
  assert.equal(faceAnchors([], reference), null)
  assert.equal(faceAnchors(landmarks, { width: 0, height: 0 }), null)
  landmarks[4].x = NaN
  assert.equal(faceAnchors(landmarks, reference), null)
})

test('캐시의 생성 원본 기준 정렬은 재사용해도 이동·크롭이 누적되지 않는다', () => {
  const alignment = calculateFaceAlignment(moveFace({ a: 1, b: 0, x: 10, y: -20 }), face, reference, reference)
  assert.ok(alignment)
  const saved = JSON.stringify(alignment)
  let reused = JSON.parse(saved)
  for (let i = 0; i < 10; i++) reused = reusableFaceAlignment(reused, reference, reference)
  assert.equal(JSON.stringify(reused), saved)
  assert.equal(reusableFaceAlignment({ ...alignment, version: 0 }, reference, reference), null)
  assert.equal(reusableFaceAlignment(alignment, { width: 700, height: 800 }, reference), null)
  assert.equal(reusableFaceAlignment(alignment, reference, { width: 600, height: 900 }), null)
})

test('같은 길이의 다른 사진이나 다른 룩은 이전 정렬 캐시를 쓰지 않는다', async () => {
  const key = await lookRenderInputKey('coral', 'data:image/png;base64,AAAA')
  assert.equal(await lookRenderInputKey('coral', 'data:image/png;base64,AAAA'), key)
  assert.notEqual(await lookRenderInputKey('coral', 'data:image/png;base64,BBBB'), key)
  assert.notEqual(await lookRenderInputKey('brown', 'data:image/png;base64,AAAA'), key)
})
