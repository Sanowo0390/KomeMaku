'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const elements=new Map();
class Element {
  constructor(id,type='text'){this.id=id;this.type=type;this.tagName=type==='select'?'SELECT':'INPUT';
    this.listeners={};this.textContent='';this.value='';this.checked=false;this.dataset={};}
  addEventListener(type,fn){this.listeners[type]=fn;}
  trigger(type){this.listeners[type]?.();}
}
function getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);}
for(const key of ['enabled','hideReplies','hideTimestamps','translateComments','autoShrink','halfLineOverlap','preserveLineBreaks'])
  elements.set(key,new Element(key,'checkbox'));
for(const key of ['fontSize','speed','density','opacity','hideFromLines','featuredPercent'])
  elements.set(key,new Element(key,'range'));
for(const key of ['language','colorMode','speedMode','translateLanguage'])
  elements.set(key,new Element(key,'select'));
let onRuntimeMessage,onStorageChange;
const writes=[];
const chrome={tabs:{query:async()=>[{id:42,url:'https://www.youtube.com/watch?v=abcdefghijk'}],
    sendMessage:async()=>({videoId:'abcdefghijk',count:100,selectedCount:50,droppedCount:50})},
  storage:{local:{get:(defaults,cb)=>cb(defaults),set:x=>writes.push(x)},
    onChanged:{addListener:fn=>onStorageChange=fn}},
  runtime:{onMessage:{addListener:fn=>onRuntimeMessage=fn}}};
const sandbox={chrome,document:{documentElement:{},querySelectorAll:()=>[],getElementById},
  globalThis:null,console,setTimeout,clearTimeout,Promise};
sandbox.globalThis=sandbox;
for(const f of ['i18n.js','ycs-parser.js','popup.js'])
  vm.runInNewContext(fs.readFileSync(path.join(root,f),'utf8'),sandbox);
(async()=>{
  await new Promise(done=>setTimeout(done,10));
  assert.match(getElementById('statusText').textContent,/100.*50/);
  assert.ok(typeof onRuntimeMessage==='function');
  // No popup close/reopen: a content-script change event updates totals now.
  onRuntimeMessage({type:'YDL_STATUS_UPDATE',status:{videoId:'abcdefghijk',count:100,
    selectedCount:70,droppedCount:30}},{tab:{id:42}});
  assert.match(getElementById('statusText').textContent,/100.*70.*30/);
  onRuntimeMessage({type:'YDL_STATUS_UPDATE',status:{videoId:'abcdefghijk',count:100,
    selectedCount:1,droppedCount:99}},{tab:{id:777}});
  assert.match(getElementById('statusText').textContent,/100.*70.*30/,
    'updates from another YouTube tab must be ignored');
  onRuntimeMessage({type:'YDL_STATUS_UPDATE',status:{videoId:'abcdefghijk',count:0,statusCode:'error'}},{tab:{id:42}});
  assert.match(getElementById('statusText').textContent,/失敗/);
  onRuntimeMessage({type:'YDL_STATUS_UPDATE',status:{videoId:'abcdefghijk',count:0,statusCode:'noToken'}},{tab:{id:42}});
  assert.match(getElementById('statusText').textContent,/トークン/);
  onRuntimeMessage({type:'YDL_STATUS_UPDATE',status:{videoId:'abcdefghijk',count:0,statusCode:'empty'}},{tab:{id:42}});
  assert.match(getElementById('statusText').textContent,/ありません/);
  const hide=getElementById('hideTimestamps');hide.checked=true;hide.trigger('change');
  assert.ok(writes.some(x=>x.hideTimestamps===true));
  console.log('PASS: popup count updates in place without reopening, tab isolation, timestamp setting');
})().catch(e=>{console.error(e);process.exitCode=1});
