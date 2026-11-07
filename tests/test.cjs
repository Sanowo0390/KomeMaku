const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ext = path.join(__dirname,'..');
const logic = require('../logic.js');

assert.equal(logic.normalizeText('  こんにちは\n　世界  '),'こんにちは 世界');
assert.deepEqual(logic.parseTimes('0:30 いいね、 1:23:45 最後', 6000),[30, 5025]);
assert.deepEqual(logic.parseTimes('100:90 間違い・9:59 OK', 700),[599]);
assert.deepEqual(logic.parseTimes('10:00 の話', 180),[]);
assert.equal(logic.lowerBound([{time:1},{time:3},{time:3},{time:9}],3),1);
assert.equal(logic.hash('same'),logic.hash('same'));
assert.equal(logic.parseLikeCount('1.5万'),15000);
assert.equal(logic.parseLikeCount('1,234'),1234);
assert.equal(logic.parseLikeCount('2.5K'),2500);
assert.equal(logic.parseLikeCount('いいね 12'),12);
assert.equal(logic.parseLikeCount(undefined),0);
const ranked = [{id:'one',text:'1',likes:1}, {id:'top',text:'top',likes:50},
  {id:'low',text:'low',likes:0}, {id:'middle',text:'middle',likes:4}];
assert.deepEqual(logic.selectByLikes(ranked,2).map(x=>x.id),['top','middle']);
assert.deepEqual(logic.selectByLikes([...ranked].reverse(),2).map(x=>x.id),['top','middle']);
// The last emission must allow enough time for the text to exit the left edge.
// This reduces the display budget while keeping the highest-liked comments.
const schedule = logic.buildSchedule(ranked,12,5);
assert.equal(schedule.selectedCount,3);
assert.ok(schedule.events.every(x => x.time <= 12 - 9 - 0.6));
const trimmed = logic.buildSchedule(ranked,2,5);
assert.equal(trimmed.selectedCount,1);
assert.equal(trimmed.droppedCount,3);
assert.deepEqual(trimmed.events.map(x=>x.id),['top']);
const timed = logic.buildSchedule([
  {id:'low-timed',text:'0:03 low',likes:1,time:null},
  {id:'high-generic',text:'high',likes:100,time:null},
  {id:'highest-timed',text:'0:04 top',likes:200,time:null}
], 20, 5);
assert.equal(timed.selectedCount,3);
assert.equal(timed.events.find(x=>x.id==='highest-timed').time,4);
assert.equal(timed.events.find(x=>x.id==='low-timed').time,3);
for (const speed of [0.5, 1, 2]) {
  for (const viewport of [320, 800, 1920]) {
    const texts = Array.from({length:300},(_,i)=>({
      id:`comment-${i}`, text:'コメント'.repeat(i%27+1), likes:i, time:null
    }));
    const estimate = record => logic.scrollTravelSeconds(record.text.length*16, viewport, speed);
    const planned = logic.buildSchedule(texts, 180, 10, {travelFor:estimate});
    assert.ok(planned.selectedCount < 300);
    assert.ok(planned.droppedCount > 0);
    assert.equal(planned.events.length,planned.selectedCount);
    for(const item of planned.events) {
      assert.ok(item.time + estimate(item) <= 180 - 0.6 + 0.000001,
        `comment ${item.id} would be cut (${speed}x, ${viewport}px)`);
    }
    const chosen = new Set(planned.events.map(x=>x.id));
    const minLike = Math.min(...planned.events.map(x=>x.likes));
    assert.ok(texts.filter(x=>x.likes>minLike).every(x=>chosen.has(x.id)),
      'higher liked comments must not be removed before lower liked comments');
  }
}
// A timestamp too close to the ending is moved earlier, not truncated.
const endTimed = logic.buildSchedule([
  {id:'end',text:'0:59 すごい',likes:100,time:null}
],60,5,{travelFor:()=>12});
assert.equal(endTimed.events[0].time,47.4);
// Clips shorter than a normal scroll start at 0; emit() accelerates to fit.
const shorts = logic.buildSchedule([{id:'short',text:'短い',likes:1,time:null}],3,5,
  {travelFor:()=>10});
assert.equal(shorts.events[0].time,0);
const manifest = JSON.parse(fs.readFileSync(path.join(ext,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.ok(manifest.content_scripts.some(x=>x.world==='MAIN'));
assert.ok(manifest.content_scripts.some(x=>x.js.includes('live-chat.js')));

// Simulate YouTube's 2026 ViewModel + frameworkUpdates entity payloads.
const TOP = 'comment-token-top', NEXT = 'comment-token-next';
const initialData = {
  contents: {twoColumnWatchNextResults: {results: {results: {contents: [
    {videoPrimaryInfoRenderer:{}},
    {itemSectionRenderer:{targetId:'comments-section',contents:[
      {continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:TOP}}}}
    ]}}
  ]}}}}
};
const commentsPayload = (id,text) => ({entityKey:`comment_entity_${id}`,payload:{commentEntityPayload:{properties:{commentId:id,content:{content:text}}}}});
const responses = {
  [TOP]: {frameworkUpdates:{entityBatchUpdate:{mutations:[commentsPayload('c1','0:30 最高！')] }}, onResponseReceivedEndpoints:[
    {reloadContinuationItemsCommand:{continuationItems:[
      {commentThreadRenderer:{commentViewModel:{commentViewModel:{commentKey:'comment_entity_c1'}}}},
      {continuationItemRenderer:{continuationEndpoint:{continuationCommand:{token:NEXT}}}}
    ]}}
  ]},
  [NEXT]: {frameworkUpdates:{entityBatchUpdate:{mutations:[commentsPayload('c2','これはテストコメント')] }},onResponseReceivedEndpoints:[
    {appendContinuationItemsAction:{continuationItems:[
      {commentThreadRenderer:{commentViewModel:{commentViewModel:{commentKey:'comment_entity_c2'}}}}
    ]}}
  ]}
};
class CustomEvent { constructor(type, init){this.type=type;this.detail=init?.detail;} }
const listeners = new Map(), batches = [], statuses = [], calls = [];
const window = {
  ytInitialData: initialData,
  ytInitialPlayerResponse:{videoDetails:{videoId:'abcdefghijk'}},
  ytcfg:{get: k=> ({INNERTUBE_API_KEY:'api-key', INNERTUBE_CONTEXT:{client:{clientName:'WEB',clientVersion:'2.20261107.00.00'}}, VISITOR_DATA:''})[k]},
  addEventListener: (type,fn) => listeners.set(type,fn),
  dispatchEvent: e => { if(e.type==='ydl:batch') batches.push(...JSON.parse(e.detail).comments); if(e.type==='ydl:status')statuses.push(JSON.parse(e.detail)); listeners.get(e.type)?.(e); }
};
const sandbox = {
  window, document:{querySelector:()=>null}, CustomEvent, AbortController,
  fetch:async(url,options)=>{
    calls.push(url);
    if(url.startsWith('/watch'))return {ok:true,text:async()=>`var ytInitialData = ${JSON.stringify(initialData)};`};
    const data = JSON.parse(options.body);
    return {ok:true,json:async()=>responses[data.continuation]};
  }, console, encodeURIComponent, Date, Map, Set
};
vm.runInNewContext(fs.readFileSync(path.join(ext,'bridge.js'),'utf8'),sandbox);
window.dispatchEvent(new CustomEvent('ydl:request',{detail:JSON.stringify({id:'req1',videoId:'abcdefghijk'})}));
setTimeout(()=>{
  try {
    assert.equal(batches.length,2);
    assert.deepEqual(batches.map(x=>x.text),['0:30 最高！','これはテストコメント']);
    assert.equal(calls.length,2);
    assert.ok(statuses[0].status.includes('2件'));
    console.log('PASS: pure logic, manifest, Innertube ViewModel integration (2 batches)');
  } catch (e) { console.error(e); process.exitCode=1; }
},60);
