'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const manifest=require('../manifest.json');
assert.equal(manifest.version,'1.8.9');
assert.equal(manifest.manifest_version,3);
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
for(const px of [16,32,48,128]){
  const file='icons/icon'+px+'.png';
  assert.equal(manifest.icons[String(px)],file);
  assert.equal(manifest.action.default_icon[String(px)],file);
  const bytes=fs.readFileSync(path.join(root,file));
  assert.ok(bytes.subarray(0,8).equals(signature),file+' should be a PNG');
  assert.equal(bytes.toString('ascii',12,16),'IHDR');
  assert.equal(bytes.readUInt32BE(16),px,file+' width');
  assert.equal(bytes.readUInt32BE(20),px,file+' height');
  assert.ok(bytes.length>100 && bytes.length<1e6,file+' plausible file size');
}
for(const name of ['icon.svg','icon-small.svg']){
  const xml=fs.readFileSync(path.join(root,'icons',name),'utf8');
  assert.match(xml,/<svg\b/);
  assert.match(xml,/viewBox="0 0 128 128"/);
}
assert.notDeepEqual(
 fs.readFileSync(path.join(root,'icons/icon16.png')),
 fs.readFileSync(path.join(root,'icons/icon32.png')),
 '16px glyph must be distinct from 32px');
const options=fs.readFileSync(path.join(root,'options.html'),'utf8');
const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
assert.match(options,/<img src="icons\/icon48\.png"/);
assert.match(popup,/<img src="icons\/icon48\.png"/);
assert.doesNotMatch(options,/<span class="brand-mark">弾<\/span>/);
assert.doesNotMatch(popup,/<span class="logo">弾<\/span>/);
const css=fs.readFileSync(path.join(root,'options.css'),'utf8');
for(const hex of ['#101119','#eb5873','#f1f2f7']){
  assert.ok(css.includes(hex),'Settings palette missing '+hex);
  assert.ok(fs.readFileSync(path.join(root,'icons/icon.svg'),'utf8').includes(hex),'Icon palette missing '+hex);
}
console.log('PASS: KomeMaku icon assets are valid PNGs at 16/32/48/128 px, correctly referenced, and editable SVGs are retained');
