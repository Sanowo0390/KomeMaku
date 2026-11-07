const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const listeners = new Map();
const ext=path.join(__dirname,'..');
let frame=()=>{}, storageListener, messageListener, requests=[], draws=[];
const stage = {clientWidth:800,clientHeight:450, isConnected:true, classList:{contains:()=>false},
 querySelector:()=>null,appendChild(el){el.isConnected=true;},};
let video = {paused:false,ended:false,currentTime:0,duration:120,isConnected:true,
 getBoundingClientRect:()=>({width:800}),
 closest:s=>s==='.html5-video-player'?stage:null,
 addEventListener:()=>{}};
let ctx = {font:'',save(){},restore(){},clearRect(){},setTransform(){},
 measureText:text=>({width:text.length*16}),strokeText:(text,x,y)=>draws.push(text),fillText:()=>{}};
const document = {
 querySelector:()=>null,
 querySelectorAll:sel=>sel.includes('video')?[video]:[],
 createElement:tag=>({id:'',style:{},width:800,height:450,isConnected:false,remove(){},getContext:()=>ctx}),
 addEventListener:()=>{}
};
const window = {devicePixelRatio:1,addEventListener:(name,cb)=>listeners.set(name,cb),
 dispatchEvent:e=>{if(e.type==='ydl:request')requests.push(JSON.parse(e.detail));listeners.get(e.type)?.(e);}};
const chrome = {runtime:{onMessage:{addListener:cb=>messageListener=cb}},storage:{local:{get:(_defaults,cb)=>cb({})},onChanged:{addListener:cb=>storageListener=cb}}};
const location = {href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'};
const sandbox={window,document,location,chrome,URL,Date,Math,ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{disconnect(){}observe(){}},setInterval:()=>{},setTimeout:cb=>{cb();return 0;},requestAnimationFrame:cb=>{frame=cb;},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}},console};
vm.runInNewContext(fs.readFileSync(path.join(ext,'logic.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(path.join(ext,'content.js'),'utf8'),sandbox);
assert.equal(requests.length,1,'main-world bridge should be requested');
assert.equal(requests[0].videoId,'abcdefghijk');
window.dispatchEvent({type:'ydl:batch',detail:{...requests[0],comments:[{id:'a',text:'テスト表示',likes:10000}]}});
let status; messageListener({type:'YDL_GET_STATUS'},null,v=>status=v);
assert.equal(status.count,1);
frame(); video.currentTime=1;frame();
assert.ok(draws.includes('テスト表示'),'comment should be rendered before import');
// A large YCS feed must be admitted without the old 300-record cap.
messageListener({type:'YDL_IMPORT_BATCH',videoId:'abcdefghijk',comments:Array.from({length:1001},(_,i)=>({id:'import-'+i,text:'コメント'+i}))},null,reply=>assert.equal(reply.ok,true));
messageListener({type:'YDL_GET_STATUS'},null,v=>status=v);
assert.equal(status.count,1002);
assert.ok(status.selectedCount>60 && status.selectedCount<100,'display count is rate/space limited');
assert.ok(status.droppedCount>900,'exclude the least liked comments');
assert.equal(status.selectedCount + status.droppedCount, status.count);

storageListener({enabled:{newValue:false}},'local');frame();
assert.equal(status.videoId,'abcdefghijk');
console.log('PASS: content script bridge request, canvas rendering, storage toggle');
