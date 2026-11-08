'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const L=require('../logic.js');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

// All comment pairs whose visible vertical ink regions intersect must remain
// horizontally separate throughout any shared video-time interval. The ONLY
// permitted exception is an explicitly crowded half-row of two single lines.
function verifyNoMultilineCollision(tracks,width,gap){
 let checked=0;
 for(let i=0;i<tracks.length;i++)for(let j=i+1;j<tracks.length;j++){
   const a=tracks[i],b=tracks[j];
   const start=Math.max(a.time,b.time),end=Math.min(a.end,b.end);
   if(start>=end-1e-6)continue;
   if(a.bottom<=b.top||b.bottom<=a.top)continue;
   if(a.lineCount===1&&b.lineCount===1&&(
     (a.staggered&&!b.staggered&&Math.abs(a.lane-b.lane)===1)||
     (b.staggered&&!a.staggered&&Math.abs(a.lane-b.lane)===1)))continue;
   const diff=t=>L.trackX(a,t,width)-L.trackX(b,t,width);
   const x1=diff(start),x2=diff(end),lo=Math.min(x1,x2),hi=Math.max(x1,x2);
   assert.ok(hi<=-a.width-gap+1e-5||lo>=b.width+gap-1e-5,
     `Collision: ${a.id}[${a.lineCount} lines, row ${a.lane}] / ${b.id}[${b.lineCount} lines,row ${b.lane}] at ${start.toFixed(2)}-${end.toFixed(2)} s; dx=${lo.toFixed(1)}..${hi.toFixed(1)}`);
   checked++;
 }
 return checked;
}
const widths=[];
for(const fontFamily of ['system','gothic','mincho','rounded','monospace']){
  assert.match(L.fontCss(24,fontFamily),/^700 24px /);
  widths.push(L.fontCss(24,fontFamily));
}
assert.equal(new Set(widths).size,5);
assert.equal(L.fontCss(24,'unknown'),L.fontCss(24,'system'));
assert.equal(L.outlineWidthFor(24,false,2.5),0);
assert.equal(L.outlineWidthFor(24,true,1),Math.max(2.6,24/7));
assert.ok(L.outlineWidthFor(24,true,2.5)>L.outlineWidthFor(24,true,.25));

for(const halfLineOverlap of [true,false])for(const spacing of [.7,1,2])for(const outlineStrength of [.25,1,2.5]) {
 const width=900,lanes=18,step=halfLineOverlap?18:36,gap=25;
 const inputs=Array.from({length:210},(_,i)=>{
   const lineCount=1+(i*7%4);
   const fontsize=18+(i*13%15);
   return {id:`c${i}`,lineCount,fontsize,time:4+Math.floor(i/10)*2.5,
     speedFactor:.75+(i%7)*.08,
     text:Array.from({length:lineCount},(_,k)=>'文'.repeat(5+(i+k)%8)).join('\n')};
 });
 const opts={viewportWidth:width,lanes,laneStep:step,fontsize:24,
   halfLineOverlap,lineSpacing:spacing,outlineEnabled:true,outlineStrength,
   speed:1,duration:150,finishMargin:.6,gap,
   measureText:text=>Math.max(...text.split('\n').map(s=>s.length*13))};
 const tracks=L.planTracks(inputs,opts).tracks;
 assert.ok(tracks.length>15,`underpopulated: ${tracks.length}`);
 assert.ok(tracks.some(x=>x.lineCount>1));
 for(const track of tracks){
   assert.equal(track.top,track.lane*step);
   assert.ok(track.bottom-track.top>=L.textHeightFor(track.fontsize,track.lineCount,spacing,true,outlineStrength));
 }
 verifyNoMultilineCollision(tracks,width,gap);
}

// Busy normal lanes can stagger *single* rows. Multiline comments cannot
// overlap that fallback even when they start at the exact same video time.
{
 const opts={viewportWidth:900,lanes:18,laneStep:18,fontsize:24,
   halfLineOverlap:true,lineSpacing:1,outlineEnabled:true,outlineStrength:1,
   speed:1,duration:150,measureText:()=>120,gap:24};
 const events=[
   {id:'multiline1',text:'A\nB\nC',lineCount:3,fontsize:24,time:5},
   {id:'single',text:'single',lineCount:1,fontsize:24,time:5},
   {id:'multiline2',text:'D\nE\nF',lineCount:3,fontsize:24,time:5},
   {id:'single2',text:'single',lineCount:1,fontsize:24,time:5}
 ];
 const tracks=L.planTracks(events,opts).tracks;
 assert.ok(tracks.length>=2);
 verifyNoMultilineCollision(tracks,900,24);
}

// WebGL must obey the same outline state and font family as Canvas 2D.
const GL=require('../renderer-webgl.js');
const styles=[];let strokes=0,filled=0,id=0;
class TextContext{
  set font(value){styles.push(value)}
  measureText(value){return {width:Array.from(value).length*15}}
  strokeText(){strokes++}
  fillText(){filled++}
}
const priorOffscreenCanvas=global.OffscreenCanvas;
global.OffscreenCanvas=class {getContext(){return new TextContext()}};
const gl=new Proxy({
  VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:1,LINK_STATUS:1,
  MAX_TEXTURE_SIZE:3379,TRIANGLES:4,TEXTURE_2D:3553,TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,
  TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,CLAMP_TO_EDGE:33071,LINEAR:9729,RGBA:6408,UNSIGNED_BYTE:5121,
  COLOR_BUFFER_BIT:16384,BLEND:3042,ONE:1,ONE_MINUS_SRC_ALPHA:771,DEPTH_TEST:2929,
  ARRAY_BUFFER:34962,FLOAT:5126,STREAM_DRAW:35040,TEXTURE0:33984,
  UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,
  getParameter:()=>2048,getShaderParameter:()=>true,getProgramParameter:()=>true,
  createShader:()=>++id,createProgram:()=>++id,createBuffer:()=>++id,createVertexArray:()=>++id,createTexture:()=>++id,
  getUniformLocation:()=>++id
},{get(o,k){return k in o?o[k]:()=>{}}});
const renderer=new GL({width:900,height:500,getContext:type=>type==='webgl2'?gl:null});
renderer.resize(900,500);
renderer.begin();renderer.drawText('X',0,0,24,'#ffffff',false,1,{fontFamily:'mincho',outlineEnabled:false,outlineStrength:1});renderer.end();
assert.equal(strokes,0,'disabled outline must not call strokeText');
assert.ok(filled>0);
assert.ok(styles.some(x=>x.includes('Yu Mincho')));
const glyphsNoOutline=renderer.glyphs.size;
renderer.begin();renderer.drawText('X',0,0,24,'#ffffff',false,1,{fontFamily:'mincho',outlineEnabled:true,outlineStrength:2});renderer.end();
assert.ok(strokes>0,'enabled outline should be rasterized');
assert.ok(renderer.glyphs.size>glyphsNoOutline,'outline style needs an independent raster cache entry');
renderer.destroy();global.OffscreenCanvas=priorOffscreenCanvas;

const manifest=JSON.parse(read('manifest.json'));
assert.equal(manifest.version,'1.9.1');
for(const file of ['content.js','scheduler-worker.js','options.js','popup.js']){
 for(const key of ['fontFamily','outlineEnabled','outlineStrength'])
   assert.match(read(file),new RegExp(key),`${file} missing ${key}`);
}
for(const key of ['fontFamily','outlineEnabled','outlineStrength']){
 assert.match(read('popup.html'),new RegExp(`id="${key}"`));
}
const I18N=require('../i18n.js');
for(const language of ['ja','en','zh-CN','zh-TW']){
 for(const key of ['fontFamily','fontSystem','fontGothic','fontMincho','fontRounded','fontMonospace','outlineEnabled','outlineStrength'])
   assert.ok(I18N.translate(language,key),`${language}: missing ${key}`);
}
console.log('PASS: multiline ink-box collision prevention, half-row fallback, five font choices, outline on/off and strength, UI parity');
