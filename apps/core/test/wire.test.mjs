import test from 'node:test'
import assert from 'node:assert/strict'
import wire from '../dist/db/wire.js'

const {
  threadToWire,
  stepToWire,
  settingToWire,
  evalCaseToWire,
  evalRunToWire,
  paginate,
  isFeedbackStep,
  compareFeedbackSteps,
} = wire

/* ── 문서 → 와이어 변환: _id → id/key, Date → ISO 문자열 ───────────────── */

test('threadToWire — _id를 id로, Date를 ISO 문자열로 옮긴다', () => {
  const doc = {
    _id: '2195943212345678901',
    userId: 'device-1',
    title: '제목',
    source: { kind: 'chip', chipId: 'c1' },
    status: 'planning',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
  }
  const wireOut = threadToWire(doc)
  assert.equal(wireOut.id, '2195943212345678901')
  assert.equal('_id' in wireOut, false)
  assert.equal(wireOut.createdAt, '2026-09-01T00:00:00.000Z')
  assert.equal(wireOut.updatedAt, '2026-09-02T00:00:00.000Z')
  assert.deepEqual(wireOut.source, { kind: 'chip', chipId: 'c1' })
})

test('threadToWire — title/source가 null이면 그대로 null을 옮긴다', () => {
  const doc = {
    _id: '1',
    userId: 'u',
    title: null,
    source: null,
    status: 'exploring',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const wireOut = threadToWire(doc)
  assert.equal(wireOut.title, null)
  assert.equal(wireOut.source, null)
})

test('stepToWire — _id를 id로 옮기고 llmMeta null을 보존한다', () => {
  const doc = {
    _id: 'abc-uuid',
    threadId: '1',
    seq: 3,
    stage: 'plan',
    payload: { foo: 'bar' },
    llmMeta: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  }
  const wireOut = stepToWire(doc)
  assert.equal(wireOut.id, 'abc-uuid')
  assert.equal(wireOut.threadId, '1')
  assert.equal(wireOut.seq, 3)
  assert.deepEqual(wireOut.payload, { foo: 'bar' })
  assert.equal(wireOut.llmMeta, null)
  assert.equal(wireOut.createdAt, '2026-09-01T00:00:00.000Z')
})

test('settingToWire — _id를 key로 옮긴다', () => {
  const doc = { _id: 'llm-model', value: { model: 'sonnet' }, updatedAt: new Date('2026-09-01T00:00:00.000Z') }
  const wireOut = settingToWire(doc)
  assert.equal(wireOut.key, 'llm-model')
  assert.deepEqual(wireOut.value, { model: 'sonnet' })
  assert.equal(wireOut.updatedAt, '2026-09-01T00:00:00.000Z')
})

test('evalCaseToWire — 전 필드를 옮기고 nullable을 보존한다', () => {
  const doc = {
    _id: '1',
    title: null,
    intent: '피부 톤 개선',
    profile: null,
    survey: null,
    answers: null,
    sourceThreadId: '2',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  }
  const wireOut = evalCaseToWire(doc)
  assert.equal(wireOut.id, '1')
  assert.equal(wireOut.intent, '피부 톤 개선')
  assert.equal(wireOut.sourceThreadId, '2')
  assert.equal(wireOut.createdAt, '2026-09-01T00:00:00.000Z')
})

test('evalRunToWire — score·judge null(미채점)을 구분해 보존한다', () => {
  const doc = {
    _id: '1',
    caseId: '2',
    config: { engine: 'langgraph' },
    page: null,
    dropLog: [],
    meta: null,
    score: null,
    comment: '',
    components: [],
    judge: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  }
  const wireOut = evalRunToWire(doc)
  assert.equal(wireOut.score, null)
  assert.equal(wireOut.judge, null)
  assert.deepEqual(wireOut.config, { engine: 'langgraph' })
})

/* ── paginate — listByUser·listAll 공용 키셋 커서 규칙 ───────────────── */

test('paginate — 행 개수가 limit 이하면 다음 페이지가 없다', () => {
  const rows = [{ v: 1 }, { v: 2 }]
  const { items, nextCursor } = paginate(rows, 2, (r) => String(r.v))
  assert.deepEqual(items, rows)
  assert.equal(nextCursor, null)
})

test('paginate — limit+1개를 받으면 마지막 한 개를 잘라내고 커서를 만든다', () => {
  const rows = [{ v: 1 }, { v: 2 }, { v: 3 }]
  const { items, nextCursor } = paginate(rows, 2, (r) => String(r.v))
  assert.deepEqual(items, [{ v: 1 }, { v: 2 }])
  // 커서는 "포함된 마지막 항목"(잘린 첫 항목이 아니라) 기준이다
  assert.equal(nextCursor, '2')
})

test('paginate — 빈 배열이면 items도 비고 커서도 없다', () => {
  const { items, nextCursor } = paginate([], 20, (r) => String(r.v))
  assert.deepEqual(items, [])
  assert.equal(nextCursor, null)
})

/* ── listFeedbackSteps 필터·정렬 규칙 ─────────────────────────────────── */

test('isFeedbackStep — action 스텝 + payload.type===feedback만 통과', () => {
  assert.equal(isFeedbackStep({ stage: 'action', payload: { type: 'feedback' } }), true)
})

test('isFeedbackStep — stage가 action이 아니면 거부', () => {
  assert.equal(isFeedbackStep({ stage: 'plan', payload: { type: 'feedback' } }), false)
})

test('isFeedbackStep — payload.type이 feedback이 아니거나 없으면 거부', () => {
  assert.equal(isFeedbackStep({ stage: 'action', payload: { type: 'cartAdd' } }), false)
  assert.equal(isFeedbackStep({ stage: 'action', payload: {} }), false)
})

test('compareFeedbackSteps — createdAt 내림차순(최신 먼저)', () => {
  const older = { createdAt: new Date('2026-09-01T00:00:00.000Z'), seq: 1 }
  const newer = { createdAt: new Date('2026-09-02T00:00:00.000Z'), seq: 1 }
  assert.ok(compareFeedbackSteps(newer, older) < 0)
  assert.ok(compareFeedbackSteps(older, newer) > 0)
})

test('compareFeedbackSteps — createdAt이 같으면 seq 내림차순', () => {
  const at = new Date('2026-09-01T00:00:00.000Z')
  const a = { createdAt: at, seq: 5 }
  const b = { createdAt: at, seq: 2 }
  assert.ok(compareFeedbackSteps(a, b) < 0)
  const sorted = [b, a].sort(compareFeedbackSteps)
  assert.deepEqual(sorted, [a, b])
})
