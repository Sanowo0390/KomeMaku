const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const logic = require('../logic.js');

function assertNoOverlap(tracks, viewportWidth, gap) {
  const perLane = new Map();
  for (const track of tracks) {
    const list = perLane.get(track.lane) || [];
    list.push(track);
    perLane.set(track.lane,list);
  }
  for (const group of perLane.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i+1; j < group.length; j++) {
      const a=group[i], b=group[j];
      const from=Math.max(a.time,b.time), to=Math.min(a.end,b.end);
      if (from >= to - 1e-7) continue;
      const diff=t => logic.trackX(a,t,viewportWidth)-logic.trackX(b,t,viewportWidth);
      const min=Math.min(diff(from),diff(to));
      const max=Math.max(diff(from),diff(to));
      assert.ok(max <= -a.width-gap+1e-5 || min >= b.width+gap-1e-5,
        `lane ${a.lane} has overlapping comments ${a.id} and ${b.id}`);
    }
  }
}
for (const viewportWidth of [320, 800, 1920]) {
  for (const speed of [0.5, 1, 1.8, 2]) {
    const m = {viewportWidth, lanes:7, speed, duration:180, finishMargin:.6,
      measureText:text=>text.length*12, gap:28};
    let seed=927438;
    function rand() {seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
    const events = Array.from({length:550},(_,i)=>({id:'ev-'+i,
      text:'文'.repeat(2+Math.floor(rand()*100)),
      likes:Math.floor(rand()*1000), time:Math.min(160,Math.round(rand()*160*10)/10)}));
    events.sort((a,b)=>a.time-b.time || logic.likeRank(a,b));
    const result=logic.planTracks(events,m);
    assertNoOverlap(result.tracks,viewportWidth,28);
    assert.ok(result.tracks.every(x=>x.end <= m.duration-.6+1e-6));
    for (const t of [2,19,64,137]) {
      assert.deepEqual(logic.visibleTracks(result.tracks,t,result.maxTravel).map(x=>x.id),
        result.tracks.filter(x=>x.time<=t && t<x.end).map(x=>x.id));
    }
  }
}

// Use a controlled video clock with no RAF frames between tab switches.
let frame, onMessage;
const handlers = new Map();
let drawn=[];
const stage = {clientWidth:960,clientHeight:540,isConnected:true,
  classList:{contains:()=>false},querySelector:()=>null,appendChild(el){el.isConnected=true;}};
const videoHandlers = new Map();
const video = {paused:false,ended:false,currentTime:0,duration:100,playbackRate:1,
  isConnected:true,getBoundingClientRect:()=>({width:960}),
  closest:s=>s==='.html5-video-player'?stage:null,
  addEventListener:(type,fn)=>videoHandlers.set(type,fn)};
const ctx={font:'',save(){},restore(){},clearRect(){},setTransform(){},
  measureText:text=>({width:text.length*17}),
  strokeText(text,x,y){drawn.push({text,x,y});},fillText(){}};
const document={hidden:false,querySelector:()=>null,
  querySelectorAll:s=>s.includes('video')?[video]:[],
  createElement:()=>({id:'',style:{},width:960,height:540,remove(){},getContext:()=>ctx,isConnected:false}),
  addEventListener:()=>{}};
const window={devicePixelRatio:1,addEventListener:(name,fn)=>handlers.set(name,fn),
  dispatchEvent:e=>handlers.get(e.type)?.(e)};
const chrome={runtime:{onMessage:{addListener:fn=>onMessage=fn}},
  storage:{local:{get:(_default,cb)=>cb({speed:1,density:5})},onChanged:{addListener(){}}}};
const sandbox={window,document,chrome,URL,Date,Math,
  location:{href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'},
  ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
  setInterval(){},setTimeout:cb=>{cb();return 1;},requestAnimationFrame:cb=>{frame=cb;},
  CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail}},console};
vm.runInNewContext(fs.readFileSync(path.join(root,'logic.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),sandbox);
const comments=Array.from({length:45},(_,i)=>({id:'id'+i,text:`メッセージ${i}`,likes:45-i}));
onMessage({type:'YDL_IMPORT_BATCH',videoId:'abcdefghijk',comments},null,reply=>assert.equal(reply.ok,true));
function snapshot(t,paused=false){video.currentTime=t; video.paused=paused;drawn=[];frame();return drawn.map(x=>({...x}));}
const t10=snapshot(10);
assert.ok(t10.length>0);
// Jump forward, rewind, then return to exactly the same time.
snapshot(90);
videoHandlers.get('seeking')();
snapshot(40);
videoHandlers.get('seeking')();
assert.deepEqual(snapshot(10),t10,'rewind must reconstruct in-flight text exactly');
// No frames while backgrounded: render instantly from time after focus.
document.hidden=true;
video.currentTime=35;
document.hidden=false;
const resumed=snapshot(35);
assert.ok(resumed.length>0,'tab restore must show the current video-time comments');
assert.deepEqual(snapshot(35),[],'unchanged video time does not rerasterize an identical frame');
// Playback rate only changes how fast the media clock advances in wall time.
video.playbackRate=2;
assert.deepEqual(snapshot(35),[],'2x speed does not redraw same media time');
video.playbackRate=.5;
assert.deepEqual(snapshot(35,true),[],'pause / slow speed avoid redundant rendering');
console.log('PASS: all-lanes non-overlap, video-end clearance, seeking/rewinding, background and playback-rate sync');
