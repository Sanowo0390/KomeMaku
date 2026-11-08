'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const L=require('../logic.js');
const W=960, font=24;
const width=text=>Array.from(String(text)).length*14;
const record=(id,text,time,extra={})=>({id,text,originalText:text,time,likes:1,isReply:false,source:'ycs',fontSize:font,fontsize:font,speedFactor:1,...extra});
function scenario(items,duration=120,speed=1){
  const travelFor=r=>L.scrollTravelSeconds(width(r.text),W,speed*r.speedFactor);
  const timestampLeadFor=r=>L.timestampHeadLeadSeconds(width(r.text),W,speed*r.speedFactor,duration,.6);
  const schedule=L.buildSchedule(items,duration,11,{travelFor,timestampLeadFor});
  const layout=L.planTracks(schedule.events,{viewportWidth:W,lanes:12,duration,speed,
    measureText:t=>width(t),gap:24,halfLineOverlap:false,finishMargin:.6});
  return {schedule,layout};
}
// A timecode marks the leading (leftmost) glyph arriving at the CENTER;
// the text begins entering from the right some seconds before that.
for(const speed of [.5,1,2]){
  const item=record('explicit-'+speed,'0:20 この場面好き',null);
  const {schedule,layout}=scenario([item],120,speed);
  assert.equal(schedule.events.length,1);
  const event=schedule.events[0],track=layout.tracks[0];
  assert.equal(event.timestampTime,20);
  assert.ok(event.time<20,'scroll must begin before its timestamp');
  assert.ok(track,'the timestamped track must be scheduled');
  assert.ok(Math.abs(L.trackX(track,20,W)-W/2)<0.05,
    `head should be at center at 20s, speed ${speed}: ${L.trackX(track,20,W)}`);
  assert.ok(L.trackX(track,event.time,W)>W);
}
// For the originally reported example, the leading edge at 1:20 is at the
// viewport CENTER, not the left edge; test multiple text lengths too.
for(const text of ['1:20', '1:20 長いコメントを画面中央で合わせる']){
  const {layout}=scenario([record('80-'+text,text,null)],200,1);
  assert.equal(layout.tracks.length,1);
  const track=layout.tracks[0];
  assert.ok(Math.abs(L.trackX(track,80,W)-W/2)<.05,
    `at 80 seconds the first glyph should be at ${W/2}px, got ${L.trackX(track,80,W)}`);
  assert.ok(L.trackX(track,80,W)>0,'the first glyph must NOT be at the left edge');
}
// Early timestamps are allowed to start at negative virtual media time.
// They must remain visible in the FIRST actual video frame.
for(const time of [0,2,4]){
  const {layout}=scenario([record('early-'+time,'早いコメント',time)]);
  const track=layout.tracks[0];
  assert.ok(track.time<0,`time ${time} needs a virtual pre-start`);
  assert.ok(Math.abs(L.trackX(track,time,W)-W/2)<.05);
  assert.ok(L.visibleTracks(layout.tracks,0,layout.maxTravel).includes(track),
    'a negative-time entry should still render at 0s');
}
for(const viewport of [640,960,1920]){
  const velocity=L.scrollingSpeed(250,viewport,1.25,200,.6);
  const lead=L.timestampHeadLeadSeconds(250,viewport,1.25,200,.6);
  assert.ok(Math.abs(lead*velocity-(viewport/2+10))<1e-6);
}
// A centered/featured comment must NOT be advanced: it has no leading edge.
const centered=scenario([record('featured','1:20 重要',80,{likes:100})],120);
const fixed=L.planFeatured(centered.schedule.events,{viewportWidth:W,viewportHeight:540,duration:120,
  fontsize:font,measureText:t=>width(t),lineSpacing:1,gap:5});
assert.equal(fixed.tracks[0]?.time,80);
// Near the end, prioritize completing the animation before the video ends.
const nearEnd=scenario([record('late','0:59 ラスト',null)],60);
assert.ok(nearEnd.layout.tracks.length===1,'near-end comment still scheduled');
assert.ok(nearEnd.layout.tracks[0].end<=59.4+1e-6,'near-end text should finish before the video');
// Generic comments have no timestamp and retain their distribution.
const generic=scenario([record('untimed','hello no timestamp',null)]);
assert.equal(generic.schedule.events[0].time,0);
assert.equal(generic.schedule.events[0].explicitTime,undefined);

// Verify the Worker returns negative-start tracks in its 0s window; the main
// renderer uses the same trackX and therefore sees the first visible frame.
const root=path.resolve(__dirname,'..');
const responses=[];
let dispatch;
const scope={console,Math,Date,Intl,Map,Set,Number,Object,String,Array,JSON,
  OffscreenCanvas:class{getContext(){return{font:'',measureText:t=>({width:width(t)})}}},
  postMessage:m=>responses.push(m),
  addEventListener:(type,fn)=>{if(type==='message')dispatch=fn;},
  importScripts(filename){vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),context,{filename});}};
scope.self=scope;
const context=vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root,'scheduler-worker.js'),'utf8'),context,{filename:'scheduler-worker.js'});
assert.equal(responses.shift()?.type,'ready');
function send(data){dispatch({data});assert.notEqual(responses.at(-1)?.type,'error',responses.at(-1)?.error);return responses.at(-1);}
const videoId='testVideoId';
const settings={fontSize:24,lineSpacing:1,density:11,speed:1,speedMode:'fixed',
 hideReplies:false,hideFromLines:0,hideTimestamps:false,autoShrink:true,
 preserveLineBreaks:true,translateComments:false,translateLanguage:'ja',
 featuredPercent:0,featuredScrollFromLines:0,selectionOrder:'popular',halfLineOverlap:false};
const metrics={w:W,h:540,fontsize:font,lanes:12};
send({type:'reset',videoId});
send({type:'batch',videoId,records:[record('early-worker','0:02 Worker',null),record('later-worker','0:20 Worker',null)]});
function build(now,id){return send({type:'build',videoId,requestId:id,now,settings,m:metrics,duration:120,force:id===1});}
let reply=build(0,1);
const earlyTrack=reply.tracks.find(x=>x.id==='early-worker');
assert.ok(earlyTrack,'Worker must return negative-start tracks for time 0');
assert.ok(earlyTrack.time<0);
assert.ok(Math.abs(L.trackX(earlyTrack,2,W)-W/2)<0.05);
assert.ok(reply.tracks.some(x=>x.id==='later-worker'));
build(90,2);
reply=build(0,3);
assert.ok(reply.tracks.some(x=>x.id==='early-worker'), 'Worker must restore the early track after rewind');
console.log('PASS: timecode starts early so leading glyph reaches center at requested video time, including 0s, featured, video end, Worker rewind');
