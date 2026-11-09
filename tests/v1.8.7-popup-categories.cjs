'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const context=vm.createContext({globalThis:null});context.globalThis=context;
vm.runInContext(read('settings-groups.js'),context);
const groups=Array.from(context.KomeMakuSettingsGroups);
const ids=groups.map(g=>g.id);
assert.deepEqual(ids,['general','selection','featured','appearance','performance','translation']);
const html=read('popup.html');
const options=read('options.js');
assert.match(options,/groups=globalThis\.KomeMakuSettingsGroups/);
assert.match(read('options.html'),/settings-groups\.js/);
assert.ok(html.indexOf('settings-groups.js')<html.indexOf('popup.js'));
const groupNodes=new Map();
const tag=/<details\b[^>]*data-category="([a-z]+)"[^>]*>([\s\S]*?)<\/details>/g;
for(const match of html.matchAll(tag)){
 assert.ok(!groupNodes.has(match[1]),'category must only exist once: '+match[1]);
 groupNodes.set(match[1],match[2]);
}
assert.deepEqual([...groupNodes.keys()],[...ids,'import'],'YCS import must remain a separate fold');
const found=new Map();
for(const g of groups){
 const body=groupNodes.get(g.id);assert.ok(body,'missing category '+g.id);
 assert.match(body,/data-category-title=""/,'category title translated from shared definition');
 const keys=[...body.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(keys,Array.from(g.keys),g.id+': controls must match the full-settings category exactly');
 for(const key of keys){assert.ok(!found.has(key),'duplicate setting '+key);found.set(key,g.id);}
}
assert.equal(found.size,28,'all 28 settings available in popup');
assert.match(groupNodes.get('import'),/id="ycsFile"/);
assert.match(groupNodes.get('import'),/id="importStatus"/);
assert.match(html,/id="statusText"/,'video status remains visible outside the groups');
assert.match(read('.github/workflows/build.yml'),/settings-groups\.js/,'release package must include shared definitions');
const I18N=require('../i18n.js');
for(const lang of ['ja','en','zh-CN','zh-TW']){
 assert.notEqual(I18N.translate(lang,'expandAll'),'expandAll');
 assert.notEqual(I18N.translate(lang,'collapseAll'),'collapseAll');
}
const storedState={popupExpandedCategories:['appearance','translation']};
const writes=[];
class MockElement{
 constructor(id,type='text'){
  this.id=id;this.type=type;this.tagName=type==='select'?'SELECT':'INPUT';
  this.listeners={};this.value='';this.checked=false;this.dataset={};this.textContent='';this.options=[];
 }
 addEventListener(name,fn){this.listeners[name]=fn;}
 trigger(name){return this.listeners[name]?.();}
}
const details=groups.map(g=>{
 const d=new MockElement(g.id);d.dataset.category=g.id;d.open=g.id==='general';
 d.label=new MockElement('label-'+g.id);d.querySelector=selector=>selector==='[data-category-title]'?d.label:null;
 return d;
});
const utility=new MockElement('import');utility.dataset.category='import';utility.open=false;utility.querySelector=()=>null;
details.push(utility);
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,new MockElement(id));return elements.get(id);};
for(const g of groups)for(const key of g.keys){const type=['enabled','hideReplies','hideTimestamps','translateComments','autoShrink','halfLineOverlap','preserveLineBreaks','outlineEnabled','autoFontScale'].includes(key)?'checkbox':
 ['language','colorMode','speedMode','translateLanguage','fontFamily','selectionOrder','rendererMode','fpsLimit'].includes(key)?'select':'range';
 elements.set(key,new MockElement(key,type));}
let requestedLanguage='ja';
const chrome={
 storage:{local:{get:(defaults,cb)=>{
   if('popupExpandedCategories'in defaults){cb({popupExpandedCategories:storedState.popupExpandedCategories});return;}
   cb({...defaults,language:requestedLanguage});
  },set:record=>{writes.push(record);if('popupExpandedCategories'in record)storedState.popupExpandedCategories=[...record.popupExpandedCategories];}},
   onChanged:{addListener:()=>{}}},
 tabs:{query:async()=>[]},runtime:{onMessage:{addListener:()=>{}},openOptionsPage:()=>{}}
};
const sandbox={console,chrome,Promise,setTimeout,clearTimeout,document:{documentElement:{},
 getElementById:element,querySelectorAll:selector=>selector==='#popupCategories > details[data-category]'?details:[],
 querySelector:selector=>{
  const found=/data-category="([a-z]+)"/.exec(selector);
  return found?details.find(d=>d.dataset.category===found[1]):null;
 }},globalThis:null};
sandbox.globalThis=sandbox;
for(const file of ['i18n.js','ycs-parser.js','settings-groups.js','popup.js']){
 vm.runInNewContext(read(file),sandbox,{filename:file});
}
const open=()=>details.filter(d=>d.open).map(d=>d.dataset.category);
assert.deepEqual(open(),['appearance','translation'],'restored state opens only selected categories');
assert.equal(details.find(d=>d.id==='appearance').label.textContent,'見た目・動き');
const selection=details.find(d=>d.id==='selection');selection.open=true;selection.trigger('toggle');
assert.deepEqual(storedState.popupExpandedCategories,['selection','appearance','translation'],
 'native toggle persists independent group state');
element('collapseAll').trigger('click');assert.deepEqual(open(),[]);assert.deepEqual(storedState.popupExpandedCategories,[]);
element('expandAll').trigger('click');assert.deepEqual(open(),[...ids,'import']);
assert.deepEqual(storedState.popupExpandedCategories,[...ids,'import']);
const updatedCount=writes.length;
selection.trigger('toggle');assert.equal(writes.length,updatedCount,'no unnecessary duplicate writes');
const language=element('language');language.value='en';language.trigger('change');
assert.equal(details.find(d=>d.id==='appearance').label.textContent,'Appearance');
assert.ok(writes.some(w=>w.language==='en'),'language stays connected to existing settings');
assert.equal(require('../manifest.json').version,'1.9.2');
console.log('PASS: category parity (28 settings), independent collapsible folds, persisted state, expand/collapse all, localization, unchanged settings');
