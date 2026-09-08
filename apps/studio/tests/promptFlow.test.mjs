import assert from 'node:assert/strict'
import { matchingAnswers, surveyReady, flowText } from '../src/lib/promptFlow.js'
const q = { id:'q1', kind:'choice', question:'피부 타입은?', options:['지성','건성'] }
const a = { questions:[q] }
const b = { questions:[{...q, id:'q2'}] }
assert.deepEqual(matchingAnswers(a,b,{q1:'지성'}),{q2:'지성'})
assert.deepEqual(matchingAnswers(a,{questions:[{...q,question:'예산은?'}]},{q1:'지성'}),{})
assert.equal(surveyReady(a,{}),false)
assert.equal(surveyReady(a,{q1:'지성'}),true)
assert.equal(surveyReady({questions:[{id:'photo',kind:'photo'}]},{}),true)
const p={prompts:[{id:'survey',text:'before'}],changes:[{id:'survey',proposedText:'after'}]}
assert.equal(flowText(p,'survey','baseline'),'before')
assert.equal(flowText(p,'survey','trial'),'after')
console.log('답변 연결·필수 답변·기준선 분리 검증 통과')
