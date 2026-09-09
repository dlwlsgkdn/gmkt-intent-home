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
import { compareRows, comparePreviewItems } from '../src/lib/promptFlow.js'
const rows = compareRows(['그대로 A', '그대로 B'], ['새 선택지', '그대로 A', '그대로 B'])
assert.equal(rows.after[0].type, 'added')
assert.equal(rows.after[1], null)
assert.equal(rows.after[2], null)
assert.equal(compareRows(['A','B'],['B','A']).after[0].type,'moved')
assert.equal(compareRows(['A','B'],['A']).before[1].type,'removed')
const item = { id:'q1', type:'surveyQuestion', props:{question:'피부 타입은?', options:'지성|번들거려요\n건성|당겨요', locked:false} }
assert.deepEqual(comparePreviewItems([item],[{...item,id:'q9',props:{...item.props,locked:true}}]),{baseline:{},trial:{}})
const modified = {...item,props:{...item.props,options:'지성|번들거려요\n건성|각질이 일어나요'}}
const marks = comparePreviewItems([item],[modified])
assert.equal(marks.trial.q1.type,'changed')
assert.equal(marks.trial.q1.options[0],null)
assert.equal(marks.trial.q1.options[1].type,'changed')
const parent={id:'products',type:'hscroll',props:{title:'추천'}}
const product={id:'p1',parentId:'products',type:'productCard',props:{name:'제품 A',price:10000}}
assert.equal(comparePreviewItems([parent,product],[parent,{...product,props:{...product.props,price:12000}}]).trial.products.type,'changed')
console.log('추가·삭제·순서·선택지·상품 변경 표시 검증 통과')

const summaryItems = [{ id: 'summary', type: 'surveySummary', props: {} }]
assert.equal(comparePreviewItems(summaryItems, summaryItems, { baseline: { questions: [{ q: '고민', a: '건성' }] }, trial: { questions: [{ q: '고민', a: '들뜸' }] } }).trial.summary.type, 'changed')

import { createPreviewScrollSync } from '../src/lib/promptFlow.js'
const panes = { baseline: { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }, trial: { scrollTop: 0, scrollHeight: 1800, clientHeight: 200 } }
const sync = createPreviewScrollSync((side) => panes[side])
panes.baseline.scrollTop = 400
sync.onScroll('baseline')
assert.equal(panes.trial.scrollTop, 800)
sync.onScroll('trial')
assert.equal(panes.baseline.scrollTop, 400, 'mirrored event must not bounce back')
sync.takeControl('trial')
panes.trial.scrollTop = 1200
sync.onScroll('trial')
assert.equal(panes.baseline.scrollTop, 600, 'right side can drive left immediately')
panes.trial.scrollTop = 1600
sync.onScroll('trial')
assert.equal(panes.baseline.scrollTop, 800, 'both reach their bottom')
sync.reset()
assert.equal(panes.baseline.scrollTop + panes.trial.scrollTop, 0)
panes.baseline.scrollHeight = 200
sync.takeControl('baseline')
sync.onScroll('baseline')
assert.equal(panes.trial.scrollTop, 0, 'non-scrolling pane must not create NaN')
console.log('양방향 스크롤·서로 다른 높이·재진입·초기화 검증 통과')
