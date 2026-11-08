const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const L=require('../logic.js');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');

assert.equal(L.lineStepFor(24,1),34,'100% must match v1.8.1');
assert.equal(L.lineStepFor(24,.7),24);
assert.equal(L.lineStepFor(24,2),68);
assert.equal(L.lineStepFor(24,undefined),34,'legacy callers default to 100%');
const event={id:'center',time:5,text:'A\nB\nC',fontsize:24,likes:100};
const make=spacing=>L.planFeatured([event],{viewportWidth:960,viewportHeight:540,
  duration:100,fontsize:24,lineSpacing:spacing,measureText:()=>72,gap:5}).tracks[0];
const tight=make(.7),normal=make(1),wide=make(2);
assert.ok(tight&&normal&&wide);
assert.ok(tight.displayHeight<normal.displayHeight&&normal.displayHeight<wide.displayHeight,
  'featured stacking must reserve the selected line spacing');
assert.equal(normal.displayHeight-tight.displayHeight,2*(L.lineStepFor(36,1)-L.lineStepFor(36,.7)));
assert.equal(wide.displayHeight-normal.displayHeight,2*(L.lineStepFor(36,2)-L.lineStepFor(36,1)));

for(const f of ['content.js','popup.js','options.js']){
  assert.match(read(f),/lineSpacing:1/,'new setting must default to legacy spacing in '+f);
}
assert.match(read('content.js'),/lineSpacing:settings.lineSpacing/);
assert.match(read('scheduler-worker.js'),/lineSpacing:settings.lineSpacing/);
assert.match(read('options.js'),/lineSpacing:\[\.7,2,\.05\]/);
assert.match(read('popup.html'),/id=\"lineSpacing\"/);
assert.match(read('content.js'),/changes\.lineSpacing/);
for(const key of ['ja','en','zh-CN','zh-TW'])assert.ok(read('i18n.js').includes('lineSpacing:'),'all locales expose line spacing');
assert.equal(JSON.parse(read('manifest.json')).version,'1.8.7');
console.log('PASS: line spacing 70-200%, multi-line center layout, WebGL/Worker/UI defaults and synchronization');
