'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const L=require('../logic.js');

assert.equal(L.shouldScrollFeatured({originalText:'one\ntwo\nthree',text:'one two three'},3),true);
assert.equal(L.shouldScrollFeatured({originalText:'one\ntwo',text:'one two'},3),false);
assert.equal(L.shouldScrollFeatured({originalText:'one\ntwo\nthree'},0),false);
assert.equal(L.shouldScrollFeatured({sourceLineCount:4,text:'flattened'},4),true);
assert.equal(L.shouldScrollFeatured({text:'one\ntwo'},2),true);
assert.equal(L.shouldScrollFeatured({originalText:'one\ntwo\nthree'},4),false);
const screen={viewportHeight:90,viewportWidth:240,duration:100,fontsize:24,
  measureText:(text,font)=>Array.from(String(text)).length*font*.65};
// Width, height, overlapping central rows and end-of-video all reject central placement.
const width=L.planFeatured([{id:'wide',text:'W'.repeat(50),time:10,fontsize:24}],screen);
assert.equal(width.tracks.length,0);assert.equal(width.rejected[0].id,'wide');
const height=L.planFeatured([{id:'tall',text:'1\n2\n3\n4',time:10,fontsize:24}],screen);
assert.equal(height.tracks.length,0);assert.equal(height.rejected[0].id,'tall');
const late=L.planFeatured([{id:'late',text:'hello',time:99,fontsize:24}],screen);
assert.equal(late.tracks.length,0);assert.equal(late.rejected[0].id,'late');
const crowded=L.planFeatured([
  {id:'first',text:'a',time:10,fontsize:24},
  {id:'second',text:'b',time:10,fontsize:24}
],screen);
assert.equal(crowded.tracks.length,1);
assert.deepEqual(crowded.rejected.map(x=>x.id),['second']);

// Integration: the real worker must send thresholded and rejected featured
// comments back as *scrolling* tracks, not silently count them as dropped.
let onMessage, outgoing=[];
const scope={self:null,console,Date,Math,Map,Set,Intl,Number,Object,String,Array,JSON,
  OffscreenCanvas:class{getContext(){return {font:'',measureText:t=>({width:Array.from(t).length*17})};}},
  importScripts(filename){vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),context,{filename});}};
scope.self=scope;scope.postMessage=m=>outgoing.push(m);
scope.addEventListener=(type,fn)=>{if(type==='message')onMessage=fn;};
const context=vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root,'scheduler-worker.js'),'utf8'),context,{filename:'scheduler-worker.js'});
assert.equal(outgoing.pop()?.type,'ready');
const send=data=>onMessage({data});
const m={w:960,h:540,fontsize:24,lanes:20};
const settings={fontSize:24,density:11,speed:1,speedMode:'fixed',hideReplies:false,hideFromLines:0,
  hideTimestamps:false,autoShrink:true,preserveLineBreaks:true,translateComments:false,
  translateLanguage:'ja',featuredPercent:30,featuredScrollFromLines:3,halfLineOverlap:true};
const data=[
  {id:'multiline',originalText:'a\nb\nc',likes:900,time:12},
  {id:'wide',originalText:'W'.repeat(65),likes:800,time:20},
  {id:'short-featured',originalText:'short',likes:700,time:27},
  ...Array.from({length:7},(_,i)=>({id:'other'+i,originalText:'hello'+i,likes:30-i,time:34+i*7}))
];
send({type:'reset',videoId:'abcdefghijk'});
send({type:'batch',videoId:'abcdefghijk',records:data});
send({type:'build',videoId:'abcdefghijk',requestId:1,settings,m,duration:120,now:0,force:true});
let built=outgoing.pop();assert.equal(built.type,'built',built.error);
const scrollIds=new Set(built.tracks.map(t=>t.id));
const centerIds=new Set(built.centerTracks.map(t=>t.id));
assert.ok(scrollIds.has('multiline'),'3-line popular comment must scroll');
assert.ok(scrollIds.has('wide'),'too-wide popular comment must fall back to scrolling');
assert.ok(centerIds.has('short-featured'),'short popular comment must remain featured');
assert.ok(!centerIds.has('multiline')&&!centerIds.has('wide'));
assert.equal(built.selectedCount+built.droppedCount,data.length);
// Live setting change should recompute in worker, not rely on popup reopening.
send({type:'build',videoId:'abcdefghijk',requestId:2,settings:{...settings,featuredScrollFromLines:0},m,duration:120,now:0,force:true});
built=outgoing.pop();assert.equal(built.type,'built',built.error);
assert.ok(new Set(built.centerTracks.map(t=>t.id)).has('multiline'),
  'turning off the threshold restores central placement');
for(const lang of ['ja','en','zh-CN','zh-TW']){
  const dictionary=require('../i18n.js');
  assert.ok(dictionary.translate(lang,'featuredScrollFromLines'));
  assert.ok(dictionary.translate(lang,'featuredScrollHint'));
}
for(const [file,key] of [['content.js','featuredScrollFromLines'],['popup.html','id="featuredScrollFromLines"'],['popup.js','featuredScrollFromLines'],['scheduler-worker.js','featuredScrollFromLines']])
  assert.ok(fs.readFileSync(path.join(root,file),'utf8').includes(key),file);
console.log('PASS: central placement rejections, 3+ line normal scrolling, worker fallback and live option');
