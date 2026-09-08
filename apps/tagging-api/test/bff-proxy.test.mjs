import test from 'node:test'
import assert from 'node:assert/strict'
import proxy from '../dist/bff-proxy.js'

const { targetUrl, bffProxy } = proxy

test('경로를 BFF의 /api 아래로 옮긴다', () => {
  assert.equal(targetUrl('http://bff:8788', '/threads'), 'http://bff:8788/api/threads')
  assert.equal(targetUrl('http://bff:8788', '/threads/abc?x=1'), 'http://bff:8788/api/threads/abc?x=1')
})

test('base 의 후행 슬래시·경로가 있어도 오리진 기준으로 붙는다', () => {
  assert.equal(targetUrl('http://bff:8788/', '/threads'), 'http://bff:8788/api/threads')
})

test('경로 조작으로 다른 호스트에 새지 않는다', () => {
  for (const evil of ['//evil.com/steal', '/../../evil', 'http://evil.com/x']) {
    const url = new URL(targetUrl('http://bff:8788', `/${evil}`))
    assert.equal(url.host, 'bff:8788', `${evil} → ${url.href}`)
  }
})

test('BFF_URL 이 없으면 프록시를 달지 않는다', () => {
  const saved = process.env.BFF_URL
  delete process.env.BFF_URL
  assert.equal(bffProxy(), null)
  if (saved !== undefined) process.env.BFF_URL = saved
})
