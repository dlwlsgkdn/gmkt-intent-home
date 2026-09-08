import test from 'node:test'
import assert from 'node:assert/strict'
import { apiBase, isSameOriginApi, CROSS_ORIGIN_FALLBACK } from '../src/lib/apiOrigin.js'

test('화면과 API를 같이 서빙하는 호스트는 전부 같은 오리진', () => {
  for (const host of [
    'ddak-scenario-studio.vercel.app', // Vercel
    'localhost', '127.0.0.1',          // vite 개발 서버
    'eevee-lab.apps.ocp.clouz.io',     // 사내 퓨전 — 옛 허용 목록이 놓치던 자리
    'ddak.gmarket.com',                // 사내 도메인이 붙어도 마찬가지
  ]) {
    assert.equal(isSameOriginApi(host), true, host)
  }
})

test('API 가 없는 정적 호스팅만 교차 오리진', () => {
  assert.equal(isSameOriginApi('dlwlsgkdn.github.io'), false)
  assert.equal(isSameOriginApi('github.io'), false)
})

test('github.io 를 흉내 낸 호스트에 속지 않는다', () => {
  assert.equal(isSameOriginApi('github.io.evil.com'), true)
  assert.equal(isSameOriginApi('notgithub.io'), true) // 라벨 경계(^ 또는 .)로만 매칭
})

test('apiBase 는 경로를 그대로 붙인다', () => {
  const saved = globalThis.location
  globalThis.location = { hostname: 'eevee-lab.apps.ocp.clouz.io' }
  assert.equal(apiBase('/api/state'), '/api/state')
  globalThis.location = { hostname: 'dlwlsgkdn.github.io' }
  assert.equal(apiBase('/api/bff'), `${CROSS_ORIGIN_FALLBACK}/api/bff`)
  if (saved === undefined) delete globalThis.location
  else globalThis.location = saved
})
