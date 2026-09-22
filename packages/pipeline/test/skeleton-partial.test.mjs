// 뼈대 부분 스트리밍 조각 → 부분 와이어 섹션 (partial.ts partialSkeletonSection) — 성분 비교표·주의 성분은 완성 행만 (v26).
// 실행: npm run test --workspace=@ddak/pipeline
import test from 'node:test'
import assert from 'node:assert/strict'
import { partialSkeletonSection } from '../dist/partial.js'

test('guide·steps 조각 — 제목이 있어야 나가고 부제·본문은 온 만큼', () => {
  assert.equal(partialSkeletonSection({ kind: 'guide' }), null)
  assert.deepEqual(partialSkeletonSection({ kind: 'guide', title: '자극 원인 짚기', body: '면도 직후' }), {
    kind: 'guide',
    title: '자극 원인 짚기',
    body: '면도 직후',
  })
  assert.deepEqual(partialSkeletonSection({ kind: 'steps', title: '순서', steps: ['미온수'] }), { kind: 'steps', title: '순서', steps: ['미온수'] })
})

test('상품·콘텐츠 자리와 look 은 부분을 내보내지 않는다', () => {
  assert.equal(partialSkeletonSection({ kind: 'products', title: '추천 쿠션', reason: '지속력' }), null)
  assert.equal(partialSkeletonSection({ kind: 'contents', title: '참고' }), null)
  assert.equal(partialSkeletonSection({ kind: 'look', title: '코랄 룩', desc: '', tone: 'coral' }), null)
})

test('compare 조각 — rows 가 열린 키면 마지막(잘렸을 수 있는) 행을 버리고, 완성 행이 없으면 null', () => {
  const alt = { badge: '기존 제품', name: '일반 올인원 워시', short: '' }
  const pick = { badge: '추천 기준', name: '약산성 저자극 쉐이빙 젤', short: '쉐이빙 젤' }
  // alt 가 열린 키(rows 아직 없음) → null
  assert.equal(partialSkeletonSection({ kind: 'compare', title: '비교', alt: { badge: '기존 제품', name: '일반 올인' } }), null)
  // rows 에 행 하나 — 열린 키라 그 하나가 잘렸을 수 있어 버린다 → null
  assert.equal(partialSkeletonSection({ kind: 'compare', title: '비교', alt, pick, rows: [{ ingredient: 'SLS', alt: '있음', pick: '없', risk: '높음' }] }), null)
  const two = partialSkeletonSection({
    kind: 'compare',
    title: '비교',
    alt,
    pick,
    rows: [
      { ingredient: 'SLS/SLES', alt: '있음', pick: '없음', risk: '높음' },
      { ingredient: '인공향', alt: '', pick: '', risk: '중간' },
    ],
  })
  assert.deepEqual(two, {
    kind: 'compare',
    title: '비교',
    alt: { badge: '기존 제품', name: '일반 올인원 워시' }, // 빈 short 는 떨어진다
    pick: { badge: '추천 기준', name: '약산성 저자극 쉐이빙 젤', short: '쉐이빙 젤' },
    rows: [{ ingredient: 'SLS/SLES', alt: '있음', pick: '없음', risk: '높음' }],
  })
  // 위험도 값이 눈금 밖(잘린 토큰)인 행은 완성분에서도 빠진다
  const badRisk = partialSkeletonSection({ kind: 'compare', title: '비교', alt, pick, rows: [{ ingredient: 'SLS', alt: '있음', pick: '없음', risk: '높' }, {}] })
  assert.equal(badRisk, null)
})

test('caution 조각 — items 완성분만, 빈 desc 는 떨어진다', () => {
  assert.equal(partialSkeletonSection({ kind: 'caution', title: '주의해서 볼 성분', desc: '', items: [{ name: 'SLS', note: '자극' }] }), null)
  const out = partialSkeletonSection({
    kind: 'caution',
    title: '주의해서 볼 성분',
    desc: '',
    items: [{ name: 'SLS (Sodium Lauryl Sulfate)', note: '자극이 될 수 있어요.' }, { name: '인공향료', note: '민감' }],
  })
  assert.deepEqual(out, {
    kind: 'caution',
    title: '주의해서 볼 성분',
    items: [{ name: 'SLS (Sodium Lauryl Sulfate)', note: '자극이 될 수 있어요.' }],
  })
})
