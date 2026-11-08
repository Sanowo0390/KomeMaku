'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const L=require('../logic.js');
const P=require('../ycs-parser.js');
const output=[];
let onMessage;
const scope={console,Date,Math,Map,Set,Intl,Number,Object,String,Array,JSON,
  OffscreenCanvas:class{getContext(){return {font:'',measureText:t=>({width:[...String(t)].length*14})}}},
  importScripts(file){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});}};
scope.self=scope;scope.postMessage=m=>output.push(m);
scope.addEventListener=(type,fn)=>{if(type==='message')onMessage=fn;};
const context=vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root,'scheduler-worker.js'),'utf8'),context,{filename:'scheduler-worker.js'});
assert.equal(output.shift()?.type,'ready');
function send(data){onMessage({data});assert.notEqual(output.at(-1)?.type,'error',output.at(-1)?.error);return output.at(-1);}
const videoId='abcdefghijk';
const settings={fontSize:24,density:11,speed:1,speedMode:'fixed',hideReplies:false,hideFromLines:0,
  hideTimestamps:false,autoShrink:true,preserveLineBreaks:true,translateComments:false,
  translateLanguage:'ja',featuredPercent:0,featuredScrollFromLines:0,
  selectionOrder:'popular',halfLineOverlap:false};
const m={w:960,h:540,fontsize:24,lanes:20};
const item=(id,text,time,extra={})=>({id,originalText:text,likes:1,isReply:false,time,...extra});
function reset(items){send({type:'reset',videoId});send({type:'batch',videoId,records:items});}
function build(id,now,forced=false,options=settings,metrics=m,duration=600){return send({type:'build',videoId,requestId:id,settings:options,m:metrics,duration,now,force:forced});}
// 1. A reported time window must include all overlapping tracks. The previous
// worker advertised [85,220] at 120s but omitted a 90s comment visible at 95s.
reset([item('early','90秒のコメント',90),item('middle','105秒のコメント',105),item('later','later',220)]);
let result=build(1,120,true);
assert.equal(result.type,'built');
assert.ok(result.windowFrom<=95 && result.windowUntil>=95);
assert.ok(result.tracks.some(t=>t.id==='early'),'every track active in the reported window must be transferred');
result=build(2,95);
assert.ok(result.tracks.some(t=>t.id==='early'),'rewinding into the same window must recover the comment');
// 2. Adding a YCS batch at 120s must not erase previously planned history.
const first=build(3,120,true);
send({type:'batch',videoId,records:[item('new-ycs','fresh data',300)]});
const updated=build(4,120,false);
assert.equal(updated.selectedCount+updated.droppedCount,4);
result=build(5,90,false);
assert.ok(result.tracks.some(t=>t.id==='early'),'new YCS comments must not erase old tracks');
assert.equal(result.selectedCount+result.droppedCount,4);
// Also test a late-discovered comment whose timestamp is behind playback.
send({type:'batch',videoId,records:[item('late-history','late-loaded early event',20)]});
build(6,120,false);
result=build(7,20,false);
assert.ok(result.tracks.some(t=>t.id==='late-history'),'late-loaded historical events must be scheduled for seeking');
// When new comments arrive from the *past*, future pinned tracks must not
// push their old timestamps forward just because they share a lane.
reset([item('future-pinned','future',90)]);
build(71,120,true,settings,{...m,lanes:1});
send({type:'batch',videoId,records:[item('new-old','late arrived',20)]});
build(72,120,false,settings,{...m,lanes:1});
const seekBack=build(73,20,false,settings,{...m,lanes:1});
assert.ok(seekBack.tracks.some(t=>t.id==='new-old'&&t.time<30),
  'late-loaded historical comment must keep its past timestamp even on the same lane');
// 3. A translation must replace the rendered string of an already-running
// pinned track without moving its time or lane; center tracks must not get NaN ends.
reset([item('translated','old source',10)]);
let original=build(8,12,true);
const track=original.tracks.find(t=>t.id==='translated');
assert.ok(track,'baseline track exists');
send({type:'translated',videoId,source:'old source',language:'ja',text:'新しい訳文'});
let translated=build(9,12,false,{...settings,translateComments:true});
const newTrack=translated.tracks.find(t=>t.id==='translated');
assert.equal(newTrack.text,'新しい訳文');
assert.equal(newTrack.time,track.time);assert.equal(newTrack.lane,track.lane);
assert.ok(Number.isFinite(newTrack.end));
reset([item('center','top rated',10,{likes:99})]);
let center=build(10,12,true,{...settings,featuredPercent:50});
assert.ok(center.centerTracks.some(x=>x.id==='center'));
send({type:'translated',videoId,source:'top rated',language:'ja',text:'人気翻訳された文章'});
center=build(11,12,false,{...settings,featuredPercent:50,translateComments:true});
assert.equal(center.centerTracks.find(x=>x.id==='center')?.text,'人気翻訳された文章');
assert.ok(Number.isFinite(center.centerTracks[0].end));
// 4. First calculation at 120s must plan a featured comment at 0s (even
// though it should not be transferred until seeking back there).
reset([item('popular-start','hello',0,{likes:100})]);
result=build(12,120,true,{...settings,featuredPercent:30});
assert.ok(!result.centerTracks.some(x=>x.id==='popular-start'));
result=build(13,0,false,{...settings,featuredPercent:30});
assert.ok(result.centerTracks.some(x=>x.id==='popular-start'));
// 5. Busy single lane respects newest preference, not like count.
// Long simultaneous comments genuinely exceed a single lane's capacity,
// even when early starts for timecodes are permitted.
reset([item('old','older '.repeat(28),0,{likes:100,publishedAt:100000}),item('new','newer '.repeat(28),0,{likes:1,publishedAt:200000})]);
result=build(14,0,true,{...settings,selectionOrder:'newest'}, {...m,lanes:1},10);
assert.ok(result.tracks.some(x=>x.id==='new'),'newer post must win collision');
assert.ok(!result.tracks.some(x=>x.id==='old'),'older post must lose if no lane remains');
// 6. Explicit reply timecode must never be replaced by the parent's schedule.
const replySchedule=L.buildSchedule([
  {id:'parent',text:'parent',scheduleText:'0:10 parent',isReply:false,source:'ycs'},
  {id:'reply',text:'1:20 reply',scheduleText:'1:20 reply',isReply:true,parentId:'parent',source:'ycs'}
],180,11,{travelFor:()=>3});
assert.equal(replySchedule.events.find(e=>e.id==='reply').time,80);
// 7. YCS parent ID may exist only in the commentUrl.
const parsed=P.extractYcsExport({videoId,comments:[{
  commentUrl:'https://www.youtube.com/watch?v=abcdefghijk&lc=parent-only-url',commentMessage:'main',
  commentReplies:{replies:[{commentId:'child',commentMessage:'reply'}]}
}]});
assert.equal(parsed.items.find(x=>x.id==='child').parentId,'parent-only-url');
assert.equal(parsed.items.find(x=>x.id==='child').isReply,true);
// 8. Avoid repeated same-source relative timestamp drift (checked in source);
// stronger sources may still replace the DOM estimate.
const contents=fs.readFileSync(path.join(root,'content.js'),'utf8');
assert.match(contents,/publishedAtRank>\(previous\.publishedAtRank\|\|0\)/);
assert.match(contents,/video\.addEventListener\('seeked'/);
// 9. The API bridge must preserve metadata needed by reply/newest selection.
const bridge=fs.readFileSync(path.join(root,'bridge.js'),'utf8');
assert.match(bridge,/publishedAt:c\.publishedAt,isReply:c\.isReply/);
assert.match(bridge,/parentId:c\.parentId/);
console.log('PASS: 9 audit regressions (worker rewind/window/history/translation/featured, newest collision, reply timecode, YCS parent ID, metadata)');
// 10. Fractional frame deadlines preserve requested FPS over 60Hz rAF ticks.
for(const fps of [15,24,30,45,60,120]){
  let nextAt=0,frames=0;
  for(let i=0;i<600;i++){
    const timestamp=i*1000/60;
    const result=L.paceFrame(timestamp,nextAt,fps,false);
    nextAt=result.nextAt;
    if(result.draw)frames++;
  }
  const expected=Math.min(fps,60)*10;
  assert.ok(Math.abs(frames-expected)<=2,`${fps}fps produced ${frames} instead of ~${expected}`);
}
console.log('PASS: fractional 60Hz frame pacing for 15/24/30/45/60/120 FPS');
