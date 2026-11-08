const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const logic=require('../logic.js');
const I18N=require('../i18n.js');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
assert.equal(manifest.version,'1.7.1');
assert.ok(manifest.content_scripts.filter(x=>x.world==='ISOLATED').some(x=>x.matches.includes('https://www.youtube.com/*')&&x.css.includes('player.css')&&x.js.includes('i18n.js')));
for(const [language,expected] of [['ja','ja'],['en','en'],['zh-Hans-CN','zh-CN'],['zh-TW','zh-TW'],['zh-HK','zh-TW']]){
  assert.equal(I18N.detect('auto',language),expected);
  assert.ok(I18N.translate(expected,'enabled'));
  assert.ok(I18N.translate(expected,'colorRandom'));
  assert.ok(I18N.translate(expected,'speedRandom'));
}
assert.equal(I18N.detect('en','ja'),'en');
assert.equal(logic.commentColor('a','single','#ff00dd'),'#ff00dd');
assert.equal(logic.commentColor('a','single','red'),'#ffffff');
for(let i=0;i<500;i++){
  assert.equal(logic.commentColor('comment'+i,'random'),logic.commentColor('comment'+i,'random'));
  assert.equal(logic.speedFactor('comment'+i,'random'),logic.speedFactor('comment'+i,'random'));
  assert.ok(logic.speedFactor('comment'+i,'random')>=.75&&logic.speedFactor('comment'+i,'random')<=1.25);
  assert.equal(logic.speedFactor('comment'+i,'fixed'),1);
}
assert.ok(new Set(Array.from({length:300},(_,i)=>logic.commentColor('comment'+i,'random'))).size>5);
assert.ok(new Set(Array.from({length:300},(_,i)=>logic.speedFactor('comment'+i,'random'))).size>100);
for(const speed of [.5,1,2]){
  const duration=110, viewportWidth=840,gap=35;
  const events=Array.from({length:800},(_,i)=>({id:'c'+i, text:'コメント'.repeat(2+(i*97)%40),likes:i,
    time:(i%22)*4.1,speedFactor:logic.speedFactor('c'+i,'random')}));
  events.sort((a,b)=>a.time-b.time||logic.likeRank(a,b));
  const result=logic.planTracks(events,{viewportWidth,lanes:12,speed,duration,finishMargin:.6,
    measureText:text=>text.length*13,gap});
  assert.ok(result.tracks.length>0);
  for(const a of result.tracks){
    assert.ok(a.end<=duration-.6+1e-5);
    for(const b of result.tracks){
      if(a===b||a.lane!==b.lane)continue;
      const from=Math.max(a.time,b.time),to=Math.min(a.end,b.end);
      if(from>=to)continue;
      const dx=t=>logic.trackX(a,t,viewportWidth)-logic.trackX(b,t,viewportWidth);
      const min=Math.min(dx(from),dx(to)),max=Math.max(dx(from),dx(to));
      assert.ok(max<=-a.width-gap+1e-5||min>=b.width+gap-1e-5, `overlap ${a.id}/${b.id}`);
    }
  }
}
const popup=fs.readFileSync(path.join(root,'popup.html'),'utf8');
for(const field of ['language','color','colorMode','speedMode','fontSize','speed','density','opacity'])
  assert.match(popup,new RegExp(`id="${field}"`));
for(const lang of ['ja','en','zh-CN','zh-TW'])assert.match(popup,new RegExp(`value="${lang}"`));
const code=fs.readFileSync(path.join(root,'content.js'),'utf8');
assert.ok(code.includes("stage.querySelector('.ytp-right-controls')"));
assert.ok(code.includes("document.addEventListener(\"yt-page-data-updated\", updateRoute)"));
console.log('PASS: 4 languages, controls, color modes, deterministic random speeds, 3 density/stress variants, no-overlap');
