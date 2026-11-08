'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const L=require('../logic.js');
const I18N=require('../i18n.js');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
assert.equal(manifest.version,'1.8.0');

// Remove timestamp markers without changing the comment's playback placement.
assert.equal(L.hideTimestamps('ここ好き 0:35、ここも 1:20\n次の行 02:00:10'), 'ここ好き 、ここも\n次の行');
assert.equal(L.hideTimestamps('invalid 02:99 01:70:00'), 'invalid 02:99 01:70:00');
const source='0:35 これ好き';
const scheduled=L.buildSchedule([{id:'a',text:L.hideTimestamps(source),scheduleText:source,likes:8}],100,11,{travelFor:()=>5});
assert.equal(scheduled.events[0].time,35);
assert.equal(scheduled.events[0].text,'これ好き');

// Uncrowded normal lanes must never be half-offset.
const opts={viewportWidth:960,lanes:8,duration:120,speed:1,
  halfLineOverlap:true,measureText:text=>text.length*15,gap:24};
const input=Array.from({length:6},(_,i)=>({id:'c'+i,time:3,text:'test',likes:6-i,lineCount:1}));
const tracks=L.planTracks(input,opts).tracks;
assert.deepEqual(tracks.slice(0,4).map(t=>t.lane),[0,2,4,6]);
assert.ok(tracks.slice(0,4).every(t=>!t.staggered && t.time===3));
assert.ok(tracks.slice(4).some(t=>t.staggered && t.lane%2===1 && t.time===3),
  'half-row fallback must occur only when all normal rows are occupied');
// Turning fallback off must prevent odd-row placements.
const strict=L.planTracks(input,{...opts,halfLineOverlap:false});
assert.ok(strict.tracks.every(t=>!t.staggered));

// Popular comments are allowed to coexist in stacked rows at the actual bottom.
const featured=L.planFeatured(Array.from({length:4},(_,i)=>({id:'featured'+i,text:'short '+i,
    time:9,likes:30-i,fontsize:22})),{
  viewportHeight:430,viewportWidth:960,duration:120,
  measureText:(text,font)=>text.length*font*.65});
assert.equal(featured.tracks.length,4);
assert.ok(featured.tracks.every(x=>x.time===9 && x.end===12.8));
assert.equal(featured.tracks[0].bottomOffset,0);
for(let i=1;i<4;i++) assert.ok(featured.tracks[i].bottomOffset>=
  featured.tracks[i-1].bottomOffset+featured.tracks[i-1].displayHeight+4);
const multi=L.planFeatured([{id:'multi',text:'line1\nline two\nline 3',time:5,
  fontsize:24,likes:800}],{viewportHeight:430,viewportWidth:960,duration:120,
    measureText:(text,font)=>Math.max(...text.split('\n').map(l=>l.length*font*.6))});
assert.equal(multi.tracks.length,1);
assert.equal(multi.tracks[0].bottomOffset,0);

// Realistic content-script smoke: changing settings updates totals while the
// popup is still open, and switching videos retries translations without an
// off/on toggle even when the previous page's async response never returned.
const listeners=new Map(), docListeners=new Map(), sent=[], requests=[], translationCallbacks=[];
let raf, messageHandler, storageHandler, renders=[];
const stage={clientWidth:960,clientHeight:540,isConnected:true,
  classList:{contains:()=>false},querySelector:()=>null,appendChild(n){n.isConnected=true;}};
const video={paused:false,ended:false,currentTime:0,duration:100,isConnected:true,
  getBoundingClientRect:()=>({width:960}),closest:s=>s==='.html5-video-player'?stage:null,
  addEventListener:()=>{}};
const ctx={font:'',save(){},restore(){},clearRect(){},setTransform(){},
  measureText:txt=>({width:txt.length*14}),strokeText:(text,x,y)=>renders.push({text,x,y}),fillText:()=>{}};
const document={visibilityState:'visible',querySelector:()=>null,
  querySelectorAll:q=>q.includes('video')?[video]:[],
  createElement:()=>({style:{},width:960,height:540,isConnected:false,remove(){},getContext:()=>ctx}),
  addEventListener:(n,fn)=>docListeners.set(n,fn)};
const window={devicePixelRatio:1,addEventListener:(n,fn)=>listeners.set(n,fn),
  dispatchEvent:e=>{if(e.type==='ydl:request')requests.push(JSON.parse(e.detail));listeners.get(e.type)?.(e);}};
const location={href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'};
const chrome={runtime:{onMessage:{addListener:fn=>messageHandler=fn},
    sendMessage:(msg,cb)=>{
      sent.push(msg);
      if(msg.type==='YDL_TRANSLATE')translationCallbacks.push({msg,cb});
      else if(cb)cb();
    },lastError:undefined},
  storage:{local:{get:(defaults,cb)=>cb({...defaults,translateComments:true})},
  onChanged:{addListener:fn=>storageHandler=fn}}};
const sandbox={window,document,location,chrome,URL,Date,Math,console,
  ResizeObserver:class{observe(){}disconnect(){}},
  MutationObserver:class{observe(){}disconnect(){}},
  setInterval(){},setTimeout:fn=>{fn();return 1;},clearTimeout(){},
  requestAnimationFrame:fn=>raf=fn,
  CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}}};
for(const f of ['logic.js','i18n.js','content.js'])
  vm.runInNewContext(fs.readFileSync(path.join(root,f),'utf8'),sandbox);
assert.equal(requests.length,1);
window.dispatchEvent({type:'ydl:batch',detail:{...requests[0],comments:[
 {id:'p',text:'0:01 Hello world',likes:1000},
 {id:'r',text:'Reply item',likes:20,isReply:true,parentId:'p'}]}});
assert.equal(sent.filter(x=>x.type==='YDL_STATUS_UPDATE').at(-1).status.count,2);
storageHandler({hideReplies:{newValue:true}},'local');
assert.equal(sent.filter(x=>x.type==='YDL_STATUS_UPDATE').at(-1).status.selectedCount,1,
  'popup totals must refresh immediately after changing a display filter');
storageHandler({hideTimestamps:{newValue:true}},'local');
video.currentTime=1;raf(10);
assert.ok(renders.some(x=>x.text==='Hello world'),JSON.stringify(renders));
assert.ok(!renders.some(x=>x.text.includes('0:01')));
assert.ok(translationCallbacks.some(x=>x.msg.text.includes('Hello world')),
  'translation enabled in stored settings must run on first video');
const old=translationCallbacks[0];
location.href='https://www.youtube.com/watch?v=vwxyz123456';
docListeners.get('yt-navigate-finish')();
assert.equal(requests.at(-1).videoId,'vwxyz123456');
window.dispatchEvent({type:'ydl:batch',detail:{...requests.at(-1),comments:[
  {id:'p2',text:'bonjour tout le monde',likes:800}]}});
video.currentTime=2;raf(50);
assert.ok(translationCallbacks.some(x=>x.msg.text==='bonjour tout le monde'),
  'translation must continue on another video without toggling the checkbox');
const count=translationCallbacks.length;
old.cb({ok:false});
video.currentTime=3;raf(120);
assert.ok(count<=translationCallbacks.length,'previous video response must not disable current translation');
// Centered multiline text must be truly bottom-aligned and line-by-line centered.
window.dispatchEvent({type:'ydl:batch',detail:{...requests.at(-1),comments:[
  {id:'featured-multi',text:'first line\nsecond line',likes:10000,time:0}]}});
storageHandler({featuredPercent:{newValue:30},preserveLineBreaks:{newValue:true}},'local');
renders=[];video.currentTime=2.5;raf(200);
const centerLines=renders.filter(x=>['first line','second line'].includes(x.text));
assert.equal(centerLines.length,2,JSON.stringify(renders));
assert.equal(centerLines[0].x,centerLines[1].x,'multiline center text must center every line');
assert.equal(centerLines[0].x,480);
assert.ok(centerLines[1].y>500,`last centered line should touch bottom edge, y=${centerLines[1].y}`);
// When original comment has two or more lines, the new option makes it
// scroll normally even though it remains the most-liked comment.
storageHandler({featuredScrollFromLines:{newValue:2}},'local');
renders=[];video.currentTime=2.6;raf(250);
const movingLines=renders.filter(x=>['first line','second line'].includes(x.text));
assert.equal(movingLines.length,2,JSON.stringify(renders));
assert.ok(movingLines.every(x=>x.x!==480),'multiline featured text must scroll, not stay centered');
// Restoring 0 disables the rule immediately, without reopening the popup.
storageHandler({featuredScrollFromLines:{newValue:0}},'local');
renders=[];video.currentTime=2.7;raf(300);
const centeredAgain=renders.filter(x=>['first line','second line'].includes(x.text));
assert.equal(centeredAgain.length,2,JSON.stringify(renders));
assert.ok(centeredAgain.every(x=>x.x===480),'0 must restore central placement immediately');
for(const lang of ['ja','en','zh-CN','zh-TW'])assert.ok(I18N.translate(lang,'hideTimestamps'));
assert.match(fs.readFileSync(path.join(root,'popup.html'),'utf8'),/id="hideTimestamps"/);
assert.match(fs.readFileSync(path.join(root,'popup.js'),'utf8'),/YDL_STATUS_UPDATE/);
console.log('PASS: crowded-only stagger, bottom-edge multi-featured, timestamp hiding, popup status, translation across navigation');
