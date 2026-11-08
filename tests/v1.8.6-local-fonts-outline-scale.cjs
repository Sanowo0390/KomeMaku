'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const L=require('../logic.js');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

// Auto-scaling is tied to the actual 2-D player geometry, never to DPI.
assert.equal(L.fontScaleForViewport(960,540),1);
assert.equal(L.fontScaleForViewport(1920,1080),2);
assert.equal(L.fontScaleForViewport(3840,2160),2.5);
assert.equal(L.fontScaleForViewport(1280,540),1);
assert.equal(L.fontScaleForViewport(640,360),2/3);
assert.equal(L.fontScaleForViewport(20,10),.65);
assert.equal(L.fontScaleForViewport(1920,1080,false),1);
assert.equal(L.fontScaleForViewport(0,0),1);

// Full family names from Local Font Access are quoted and CSS-escaped.
const family='local:Yu Gothic UI';
assert.equal(L.fontCss(24,family),'700 24px "Yu Gothic UI", system-ui, sans-serif');
assert.ok(L.fontCss(24,'local:A"B').includes('"A\\"B"'));
assert.equal(L.fontCss(24,'local:'),L.fontCss(24,'system'));
assert.equal(L.fontCss(24,'unknown'),L.fontCss(24,'system'));

// Check actual GPU glyph rasterization and caching for stroke alpha variants.
let id=0;
const seen=[];
const ctx={font:'',measureText:s=>({width:s.length*10}),fillText(){},strokeText(){seen.push(this.strokeStyle)}};
const saved=global.OffscreenCanvas;
global.OffscreenCanvas=class{getContext(){return ctx}};
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
},{get:(o,k)=>k in o?o[k]:()=>{}});
const GL=require('../renderer-webgl.js');
const rend=new GL({width:960,height:540,getContext:which=>which==='webgl2'?gl:null});
for(const alpha of [0,.5,1]) {
  rend.begin();rend.drawText('X',10,10,24,'#ffffff',false,1,
     {fontFamily:family,outlineEnabled:true,outlineStrength:1,outlineOpacity:alpha});rend.end();
}
assert.deepEqual(seen,['rgba(0,0,0,0)','rgba(0,0,0,0.5)','rgba(0,0,0,1)']);
assert.equal(rend.glyphs.size,3,'stroke-opacity changes must invalidate glyph atlas selection');
assert.ok([...rend.glyphs.keys()].every(k=>k.includes(family)));
assert.equal(rend.fontCss(24,family),L.fontCss(24,family));
rend.destroy();global.OffscreenCanvas=saved;

// All control surfaces must expose consistent defaults, ranges and labels.
for(const file of ['content.js','options.js','popup.js']){
  const source=read(file);
  assert.match(source,/autoFontScale:true/);
  assert.match(source,/outlineOpacity:\s*\.86/);
  assert.match(source,/fontFamily:'system'/);
}
assert.match(read('content.js'),/fontScaleForViewport\(w,h,settings\.autoFontScale\)/);
assert.match(read('options.js'),/queryLocalFonts\(\)/);
assert.match(read('options.js'),/addEventListener\('click',\(\)=>\{void loadLocalFontList\(\);\}\)/);
assert.match(read('options.js'),/outlineOpacity:\[0,1,\.01\]/);
assert.match(read('popup.html'),/id="outlineOpacity"/);
assert.match(read('popup.html'),/id="autoFontScale"/);
assert.match(read('content.js'),/outlineOpacity:settings\.outlineOpacity/);
const I18N=require('../i18n.js');
for(const lang of ['ja','en','zh-CN','zh-TW'])for(const key of
  ['outlineOpacity','autoFontScale','loadLocalFonts','localFontsDenied','localFontsUnsupported'])
  assert.notEqual(I18N.translate(lang,key),key,lang+' missing '+key);
assert.equal(require('../manifest.json').version,'1.8.9');
console.log('PASS: installed font family escapes, explicit permission UI, outline-opacity GPU cache, 2D viewport scale, UI consistency');
