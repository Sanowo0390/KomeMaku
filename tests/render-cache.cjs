'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.join(__dirname,'..');
let frame=()=>{},dispatch={};let listener,updates,strokes=0,blits=0,clears=0;
const surfaceContext={font:'',textBaseline:'',fillStyle:'',strokeStyle:'',lineJoin:'',lineWidth:0,
 measureText:text=>({width:text.length*16}),strokeText(){strokes++},fillText(){},setTransform(){},save(){},restore(){},clearRect(){clears++},drawImage(){blits++}};
const stage={clientWidth:1280,clientHeight:720,isConnected:true,classList:{contains:()=>false},querySelector:()=>null,appendChild(el){el.isConnected=true}};
const video={paused:false,ended:false,currentTime:1,duration:120,isConnected:true,
 getBoundingClientRect:()=>({width:1280}),closest:sel=>sel==='.html5-video-player'?stage:null,addEventListener(){}};
const document={visibilityState:'visible',querySelector:()=>null,querySelectorAll:s=>s.includes('video')?[video]:[],
 createElement:tag=>({id:'',style:{},isConnected:false,remove(){},width:0,height:0,getContext:()=>surfaceContext}),addEventListener(){}};
const win={devicePixelRatio:2,addEventListener:(name,fn)=>dispatch[name]=fn,dispatchEvent:e=>dispatch[e.type]?.(e)};
const chrome={runtime:{onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:(_defaults,cb)=>cb({fontSize:36})},onChanged:{addListener:fn=>updates=fn}}};
const sandbox={document,window:win,chrome,URL,Date,Math,console,
 location:{href:'https://www.youtube.com/watch?v=abcdefghijk',pathname:'/watch'},
 ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
 setTimeout:cb=>{cb();return 1},clearTimeout(){},setInterval(){},requestAnimationFrame:fn=>frame=fn,
 CustomEvent:class{constructor(type,detail){this.type=type;this.detail=detail.detail}}};
for(const f of ['logic.js','i18n.js','content.js'])vm.runInNewContext(fs.readFileSync(path.join(root,f),'utf8'),sandbox);
listener({type:'YDL_IMPORT_BATCH',videoId:'abcdefghijk',comments:[{id:'a',text:'大きい文字のテスト',likes:100}]},null,()=>{});
frame(100);assert.ok(blits>=1,'comment sprite blitted');
const strokesAfter=strokes,blitsAfter=blits;
video.currentTime=1.2;frame(140);assert.ok(blits>blitsAfter,'next visible frame reuses sprite');
assert.equal(strokes,strokesAfter,'outline text rasterized only once for repeated frames');
const before=blits;
frame(141);assert.equal(blits,before,'30 fps cap prevents excessive rendering');
video.paused=true;frame(200);frame(280);assert.equal(blits,before,'paused frame does not rerasterize');
document.visibilityState='hidden';video.currentTime=5;frame(350);assert.equal(blits,before,'background tab skips rendering');
document.visibilityState='visible';frame(400);assert.ok(blits>before,'tab return redraws correct media time');
console.log('PASS: sprite bitmap reuse, FPS limit, paused tab suppression, resume, large fonts');
