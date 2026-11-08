const assert=require('node:assert/strict');
const GL=require('../renderer-webgl.js');
const called=[];
let nextId=0;
const gl=new Proxy({
 VERTEX_SHADER:35633,FRAGMENT_SHADER:35632,COMPILE_STATUS:1,LINK_STATUS:1,
 MAX_TEXTURE_SIZE:3379,TRIANGLES:4,TEXTURE_2D:3553,TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,
 TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,CLAMP_TO_EDGE:33071,LINEAR:9729,RGBA:6408,UNSIGNED_BYTE:5121,
 COLOR_BUFFER_BIT:16384,BLEND:3042,ONE:1,ONE_MINUS_SRC_ALPHA:771,DEPTH_TEST:2929,
 ARRAY_BUFFER:34962,FLOAT:5126,STREAM_DRAW:35040,TEXTURE0:33984,
 UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,
 getParameter:()=>2048,getShaderParameter:()=>true,getProgramParameter:()=>true,
 createShader:()=>++nextId,createProgram:()=>++nextId,createBuffer:()=>++nextId,createVertexArray:()=>++nextId,createTexture:()=>++nextId,
 getUniformLocation:()=>++nextId,drawArrays:(...args)=>called.push(['draw',...args]),
 pixelStorei:(pname,value)=>called.push(['pixelStorei',pname,value]),
 texSubImage2D:()=>called.push(['upload']),bufferData:(target,data)=>called.push(['buffer',Array.from(data)]),
 getError:()=>0}, {get(target,key){return key in target?target[key]:(...args)=>{called.push([String(key),...args.slice(0,1)]);};}});
const priorDocument=global.document,priorCanvas=global.OffscreenCanvas;
class Ctx {measureText(s){return {width:Array.from(s).length*18}}strokeText(){}fillText(){}}
global.OffscreenCanvas=class{getContext(){return new Ctx()}};
const canvas={width:800,height:400,getContext:kind=>kind==='webgl2'?gl:null};
const r=new GL(canvas);r.resize(800,400);
r.begin(.8);r.drawText('こんにちは\n世界',200,120,30,'#ffcc00',true);r.drawText('HELLO',10,10,30,'#00ff00');r.end();
assert.ok(r.glyphs.size>3);assert.ok(r.used>8);assert.ok(called.some(x=>x[0]==='draw'));
// Glyph canvas has a top-left origin. Vertex UV must preserve that orientation:
// top of each quad samples source top row; left samples source left column.
const flipCalls=called.filter(entry=>entry[0]==='pixelStorei' && entry[1]===gl.UNPACK_FLIP_Y_WEBGL);
assert.ok(flipCalls.length>0,'glyphs must configure texture orientation on upload');
assert.ok(flipCalls.every(entry=>entry[2]===false),'glyph upload must not vertically flip image pixels');
const firstBatch=called.find(entry=>entry[0]==='buffer')?.[1];
assert.ok(firstBatch?.length>=42,'at least one textured quad must be submitted');
const stride=7;
assert.ok(firstBatch[stride]>firstBatch[0] && firstBatch[stride+2]>firstBatch[2],
  'glyph x and atlas u must increase together; no horizontal mirroring');
assert.ok(firstBatch[stride*2+1]>firstBatch[1] && firstBatch[stride*2+3]>firstBatch[3],
  'glyph y and atlas v must increase together; no vertical mirroring');
const uploaded=called.filter(x=>x[0]==='upload').length;
r.begin(.8);r.drawText('こんにちは\n世界',200,120,30,'#00ffff',true);r.end();
assert.equal(called.filter(x=>x[0]==='upload').length,uploaded,'color changes must not rerasterize glyphs');
// Under atlas pressure a failed glyph must not be permanently removed from
// the cached text layout. The host can switch to Canvas 2D in that frame.
const oldAllocate=r._allocate.bind(r);
r._allocate=()=>null;
r.begin();r.drawText('XY',0,0,24,'#ffffff');r.end();
const starvedLayout=r._layout('XY',24,false);
assert.equal(starvedLayout.rows[0].items.length,2,'all glyphs remain in cached layout');
assert.equal(r.missingGlyphs,2,'host must detect atlas exhaustion');
r._allocate=oldAllocate;
r.begin();r.drawText('XY',0,0,24,'#ffffff');r.end();
assert.equal(r.missingGlyphs,0,'failed glyphs must be retried next frame');
assert.equal(r.used,2);
r.clearCache();assert.equal(r.glyphs.size,0);r.destroy();
global.document=priorDocument;global.OffscreenCanvas=priorCanvas;
console.log('PASS: WebGL2 glyph orientation, atlas, multiline alignment, batched rendering, color-independent cache');
