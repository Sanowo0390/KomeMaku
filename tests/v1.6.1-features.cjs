'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const logic=require('../logic.js');
const popup=require('../i18n.js');
const parser=require('../ycs-parser.js');
// Unlimited = retain all comments in the timeline before spatial collision checks.
const many=Array.from({length:3000},(_,i)=>({id:'c'+i,text:'hello',likes:i}));
const finite=logic.buildSchedule(many,120,5,{travelFor:()=>5});
const unlimited=logic.buildSchedule(many,120,11,{travelFor:()=>5});
assert.ok(finite.selectedCount<300,finite.selectedCount);
assert.equal(unlimited.selectedCount,3000);
assert.equal(unlimited.droppedCount,0);
assert.ok(unlimited.events.every(event=>event.time>=0 && event.time<=115));
// Half-height lane staggering; multiline comments reserve enough half-row slots.
const opts={viewportWidth:900,lanes:12,duration:120,speed:1,halfLineOverlap:true,measureText:(text,font)=>text.length*(font||20),gap:22};
const a=logic.createTrack({id:'a',text:'first',time:10,lineCount:1,fontsize:20},opts,Array.from({length:12},()=>[]));
assert.ok(a && a.laneSpan===1);
const b=logic.createTrack({id:'b',text:'first\nsecond\nthird',time:10,lineCount:3,fontsize:12},opts,Array.from({length:12},()=>[]));
assert.ok(b && b.laneSpan===5);
// Replies with a parentId are re-timed closer to the parent.
const threaded=logic.buildSchedule([{id:'parent',text:'a',likes:50},{id:'reply1',text:'b',isReply:true,parentId:'parent',likes:1},{id:'reply2',text:'c',isReply:true,parentId:'parent',likes:2}],90,11,{travelFor:()=>5});
const parent=threaded.events.find(x=>x.id==='parent');
for(const child of threaded.events.filter(x=>x.isReply))assert.ok(child.time>=parent.time && child.time<=parent.time+12,JSON.stringify({parent,child}));
const exported=parser.extractYcsExport({videoId:'abcdefghijk',comments:[{id:'p',commentMessage:'P',commentReplies:{replies:[{id:'r',commentMessage:'Reply'}]}}]});
assert.equal(exported.items.find(x=>x.id==='r').parentId,'p');
// Translation is opt-in, isolated in the service worker, and errors preserve original texts.
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.version,'1.6.2');
assert.ok(manifest.host_permissions.includes('https://translate.googleapis.com/*'));
const content=fs.readFileSync(path.join(root,'content.js'),'utf8');
for(const key of ['translateComments','translateLanguage','autoShrink','halfLineOverlap']){
 assert.ok(content.includes("'"+key+"'"),key);
 assert.ok(fs.readFileSync(path.join(root,'popup.html'),'utf8').includes('id="'+key+'"'),key);
 assert.ok(popup.translate('ja',key).length>0);
}
let registered=[]; let fetchCount=0;
const worker={chrome:{runtime:{onMessage:{addListener:fn=>registered.push(fn)}},tabs:{sendMessage:()=>Promise.resolve()}},
 URL,URLSearchParams,AbortController,Date,Map,Set,Error,Promise,setTimeout,clearTimeout,
 fetch:async url=>{fetchCount++;return {ok:true,json:async()=>[['こんにちは','en']]};}};
vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),worker);
assert.equal(registered.length,1);
function deliver(message,sender){return new Promise(resolve=>registered[0](message,sender,resolve));}
(async()=>{
 const result=await deliver({type:'YDL_TRANSLATE',target:'ja',text:'Hello'},{url:'https://www.youtube.com/watch?v=abcdefghijk',tab:{id:1}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{ok:true,text:'こんにちは'});
 const cached=await deliver({type:'YDL_TRANSLATE',target:'ja',text:'Hello'},{url:'https://www.youtube.com/watch?v=abcdefghijk',tab:{id:1}});
 assert.equal(cached.text,'こんにちは');assert.equal(fetchCount,1);
 const invalid=await deliver({type:'YDL_TRANSLATE',target:'xx',text:'Hello'},{url:'https://www.youtube.com/',tab:{id:1}});
 assert.equal(invalid.ok,false);
 console.log('PASS: unlimited frequency, half-row lanes, threaded grouping, translation opt-in and caching');
})().catch(e=>{console.error(e);process.exitCode=1});
