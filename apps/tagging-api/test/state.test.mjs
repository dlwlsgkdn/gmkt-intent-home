import test from 'node:test'
import assert from 'node:assert/strict'
import stateLogic from '../dist/state-logic.js'

const {
  KEY_PATTERN,
  isValidKey,
  parseKeysParam,
  normalizeBootId,
  bootWantedKeys,
  pickBootFallbackKey,
} = stateLogic

test('isValidKey — 유효한 키 형태를 통과시킨다', () => {
  assert.equal(isValidKey('account:abc'), true)
  assert.equal(isValidKey('account:abc:threads'), true)
  assert.equal(isValidKey('account:abc:scenario:x'), true)
  assert.equal(isValidKey('account:abc:versions:x'), true)
  assert.equal(isValidKey('starter:y'), true)
  assert.equal(isValidKey('starters-meta'), true)
  assert.equal(isValidKey('accounts-meta'), true)
  assert.equal(isValidKey('keywords'), true)
  assert.equal(isValidKey('accounts'), true)
})

test('isValidKey — 부적합한 키 형태를 거부한다', () => {
  assert.equal(isValidKey('../etc'), false)
  assert.equal(isValidKey(''), false)
  assert.equal(isValidKey('a'.repeat(65)), false)
  assert.equal(isValidKey(`account:${'a'.repeat(65)}`), false)
  assert.equal(isValidKey('account:abc:unknown:x'), false)
  assert.equal(isValidKey(null), false)
  assert.equal(isValidKey(undefined), false)
  assert.equal(isValidKey(123), false)
})

test('KEY_PATTERN — 원본 api/state.js 의 정규식과 동일한 문자열이다', () => {
  // 옮겨 적다 실수로 바뀌는 것을 잡기 위한 문자열 대조
  assert.equal(
    KEY_PATTERN.source,
    '^(accounts|keywords|accounts-meta|starters-meta|starter:[A-Za-z0-9_-]{1,64}|account:[A-Za-z0-9_-]{1,64}(?::threads|:(?:versions|scenario):[A-Za-z0-9_-]{1,64})?)$',
  )
})

test('parseKeysParam — 쉼표 구분·트림·빈 항목 제거', () => {
  const parsed = parseKeysParam(' keywords , account:a , account:a:threads ')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.list, ['keywords', 'account:a', 'account:a:threads'])
})

test('parseKeysParam — 33개면 거부', () => {
  const list = Array.from({ length: 33 }, (_, i) => `account:a${i}`).join(',')
  assert.equal(parseKeysParam(list).ok, false)
})

test('parseKeysParam — 32개는 통과', () => {
  const list = Array.from({ length: 32 }, (_, i) => `account:a${i}`).join(',')
  const parsed = parseKeysParam(list)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.list.length, 32)
})

test('parseKeysParam — 빈 문자열이나 형식 위반이 섞이면 거부', () => {
  assert.equal(parseKeysParam('').ok, false)
  assert.equal(parseKeysParam('keywords,../etc').ok, false)
})

test('normalizeBootId — 유효하면 그대로, 아니면 null', () => {
  assert.equal(normalizeBootId('abc-123'), 'abc-123')
  assert.equal(normalizeBootId('../etc'), null)
  assert.equal(normalizeBootId(''), null)
  assert.equal(normalizeBootId(undefined), null)
})

test('bootWantedKeys — 요청 계정이 실재할 때만 본문 키를 더한다', () => {
  assert.deepEqual(bootWantedKeys('a1', ['accounts-meta', 'account:a1']), [
    'accounts-meta',
    'keywords',
    'starters-meta',
    'account:a1',
  ])
  // 존재하지 않는 계정이면 본문 키를 조회 목록에 넣지 않는다
  assert.deepEqual(bootWantedKeys('nobody', ['accounts-meta']), ['accounts-meta', 'keywords', 'starters-meta'])
  assert.deepEqual(bootWantedKeys(null, ['account:a1']), ['accounts-meta', 'keywords', 'starters-meta'])
})

test('pickBootFallbackKey — 요청 계정 본문이 이미 있으면 폴백 불필요', () => {
  const rows = [{ key: 'accounts-meta' }, { key: 'account:a1' }]
  assert.equal(pickBootFallbackKey(rows, ['accounts-meta', 'account:a1'], { order: ['a1'] }), null)
})

test('pickBootFallbackKey — 본문이 없으면 accounts-meta.order 첫 계정으로', () => {
  const rows = [{ key: 'accounts-meta' }, { key: 'keywords' }]
  const allKeys = ['accounts-meta', 'keywords', 'account:a2', 'account:a1']
  const fallback = pickBootFallbackKey(rows, allKeys, { order: ['a1', 'a2'] })
  assert.equal(fallback, 'account:a1')
})

test('pickBootFallbackKey — order에 없거나 order가 없으면 아무 본문 행이나', () => {
  const rows = [{ key: 'keywords' }]
  const allKeys = ['keywords', 'account:zz']
  assert.equal(pickBootFallbackKey(rows, allKeys, undefined), 'account:zz')
  assert.equal(pickBootFallbackKey(rows, allKeys, { order: ['nobody'] }), 'account:zz')
})

test('pickBootFallbackKey — 본문 행이 전혀 없으면 null', () => {
  const rows = [{ key: 'keywords' }]
  const allKeys = ['keywords', 'starters-meta']
  assert.equal(pickBootFallbackKey(rows, allKeys, undefined), null)
})
