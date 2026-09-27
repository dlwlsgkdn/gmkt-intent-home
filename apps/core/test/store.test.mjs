import test from 'node:test'
import assert from 'node:assert/strict'
import store from '../dist/db/store.js'

/*
 * 저장소 선택 규칙(src/db/store.ts) — 코드는 두 저장소(github.com→Vercel=Neon, eevee-labatory→퓨전=Mongo)가 같고
 * 환경설정이 구현을 고른다. 이 규칙이 바뀌면 배포 하나가 조용히 다른 DB 를 보게 되므로 여기서 굳힌다.
 */
const { resolveStore, notConnectedMessage } = store

test('CORE_STORE 명시가 접속 문자열보다 우선한다 — 대소문자·공백 무시', () => {
  assert.equal(resolveStore({ CORE_STORE: ' Neon ', MONGO_URI: 'mongodb://x' }), 'neon')
  assert.equal(resolveStore({ CORE_STORE: 'MONGO', DATABASE_URL: 'postgres://x' }), 'mongo')
})

test('명시가 없으면 접속 문자열로 — mongo 먼저, 다음 neon, 둘 다 없으면 none', () => {
  assert.equal(resolveStore({ MONGO_URI: 'mongodb://x' }), 'mongo')
  assert.equal(resolveStore({ DATABASE_URL: 'postgres://x' }), 'neon')
  assert.equal(resolveStore({ MONGO_URI: 'mongodb://x', DATABASE_URL: 'postgres://x' }), 'mongo')
  assert.equal(resolveStore({}), 'none')
  assert.equal(resolveStore({ CORE_STORE: '' }), 'none')
})

test('잘못된 CORE_STORE 는 부팅에서 바로 죽는다 — 조용히 다른 저장소로 가지 않는다', () => {
  assert.throws(() => resolveStore({ CORE_STORE: 'postgres' }), /CORE_STORE/)
})

test('503 문구는 어느 설정이 빠졌는지 저장소별로 말한다', () => {
  assert.match(notConnectedMessage('mongo'), /Mongo/)
  assert.match(notConnectedMessage('neon'), /DATABASE_URL/)
  assert.match(notConnectedMessage('none'), /CORE_STORE/)
})
