const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function verify({duration, speed, comments}) {
  let frame, onMessage, drawn = [], seen = new Set();
  const listeners = new Map();
  const stage = {clientWidth:800,clientHeight:450,isConnected:true,
    classList:{contains:()=>false},querySelector:()=>null,
    appendChild(el){el.isConnected=true;}};
  const video = {paused:false,ended:false,currentTime:0,duration,isConnected:true,
    getBoundingClientRect:()=>({width:800}),
    closest:s=>s==='.html5-video-player'?stage:null,
    addEventListener(){}};
  const ctx = {font:'',save(){},restore(){},clearRect(){},setTransform(){},
    measureText:text=>({width:text.length*16}),
    strokeText(text,x){drawn.push({text,x});seen.add(text);},fillText(){}};
  const document = {querySelector:()=>null,
    querySelectorAll:selector=>selector.includes('video')?[video]:[],
    createElement:()=>({id:'',style:{},width:800,height:450,remove(){},
      getContext:()=>ctx,isConnected:false}),addEventListener(){}};
  const window = {devicePixelRatio:1,addEventListener:(name,cb)=>listeners.set(name,cb),
    dispatchEvent:event=>listeners.get(event.type)?.(event)};
  const chrome = {runtime:{onMessage:{addListener:fn=>onMessage=fn}},
    storage:{local:{get:(_defaults,cb)=>cb({speed})},onChanged:{addListener(){}}}};
  const sandbox={window,document,chrome,URL,Date,Math,location:{
    href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'},
    ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
    setInterval(){},setTimeout:cb=>{cb();return 1;},requestAnimationFrame:cb=>{frame=cb;},
    CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts.detail}},console};
  vm.runInNewContext(fs.readFileSync(path.join(root,'logic.js'),'utf8'),sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(root,'content.js'),'utf8'),sandbox);
  onMessage({type:'YDL_IMPORT_BATCH',videoId:'abcdefghijk',comments},null,reply=>assert.equal(reply.ok,true));
  let response;
  onMessage({type:'YDL_GET_STATUS'},null,reply=>response=reply);
  assert.ok(response.selectedCount>0);
  for (let tick=0; tick<Math.ceil((duration-0.2)*30); tick++) {
    video.currentTime=tick/30;
    drawn=[];
    frame();
  }
  assert.ok(seen.size>0,'at least one comment should have been displayed');
  assert.equal(drawn.length,0,`comments still onscreen at ${video.currentTime}s (duration ${duration}s, speed ${speed})`);
  return {rendered:seen.size, selected:response.selectedCount};
}
// The normal multi-comment case should finish the entire set before the video ends.
const many = Array.from({length:250},(_,i)=>({id:`i${i}`,text:`コメント${i}`,likes:i}));
verify({duration:120,speed:1,comments:many});
// Long and slow text must receive a larger ending buffer.
verify({duration:60,speed:0.5,comments:Array.from({length:15},(_,i)=>({
  id:`long-${i}`,text:`長文${i}` + 'ほげ'.repeat(35),likes:i}))});
// A very short clip should accelerate one comment rather than freeze it at the end.
verify({duration:5,speed:0.5,comments:[{id:'short',text:'コメント'.repeat(22),likes:9}]});
// A near-end timestamp must be displayed in time to clear.
verify({duration:60,speed:1,comments:[{id:'last-timestamp',text:'0:59 最高の場面',likes:5}]});
console.log('PASS: animation completes before video end at different widths/speeds/durations');
