'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const L=require('../logic.js');
const P=require('../ycs-parser.js');
const manifest=require('../manifest.json');
const I18N=require('../i18n.js');
assert.equal(manifest.version,'1.9.0');
assert.equal(manifest.options_ui.page,'options.html');
assert.ok(manifest.content_scripts[1].js.indexOf('ycs-parser.js')<manifest.content_scripts[1].js.indexOf('content.js'));
assert.ok(fs.readFileSync(path.join(root,'options.html'),'utf8').includes('options.js'));
const opts=fs.readFileSync(path.join(root,'options.js'),'utf8');
for(const key of ['selectionOrder','featuredPercent','translateComments','fpsLimit','hideReplies','hideFromLines','featuredScrollFromLines'])assert.ok(opts.includes(key),key);
for(const lang of ['ja','en','zh-CN','zh-TW']){
 assert.notEqual(I18N.translate(lang,'selectionOrder'),'selectionOrder');
 assert.notEqual(I18N.translate(lang,'selectionNewest'),'selectionNewest');
 assert.notEqual(I18N.translate(lang,'openOptions'),'openOptions');
}
// Publication timestamps and video playback timestamps are independent values.
const now=Date.UTC(2026,10,9);
assert.equal(P.parsePublishedAt('2 days ago',now),now-2*86400000);
assert.equal(P.parsePublishedAt('3日前',now),now-3*86400000);
assert.equal(P.parsePublishedAt({runs:[{text:'2 hours ago'}]},now),now-2*3600000);
assert.equal(P.parsePublishedAt('2026-11-08T00:00:00Z',now),Date.UTC(2026,10,8));
assert.equal(P.parsePublishedAt(1794096000,now),Date.UTC(2026,10,8));
assert.equal(P.parsePublishedAt('0:35',now),null);
assert.equal(P.parsePublishedAt('not a time',now),null);
const exportData=P.extractYcsExport({videoId:'abcdefghijk',comments:[
 {commentId:'new',commentMessage:'newest',totalLikes:1,commentTime:'2026-11-08T00:00:00Z'},
 {commentId:'old',commentMessage:'older',totalLikes:99,commentTime:'2026-10-01T00:00:00Z'},
 {commentId:'unknown',commentMessage:'undated',totalLikes:800}
]});
assert.equal(exportData.items[0].publishedAt,Date.UTC(2026,10,8));
const rows=exportData.items;
assert.equal(L.selectForDisplay(rows,1,'popular')[0].id,'unknown');
assert.equal(L.selectForDisplay(rows,1,'newest')[0].id,'new');
assert.deepEqual(L.selectForDisplay(rows,2,'newest').map(x=>x.id),['new','old']);
assert.equal(L.selectForDisplay(rows,3,'newest').length,3);
assert.equal(L.selectForDisplay(rows,Infinity,'newest').length,3);
assert.equal(L.selectForDisplay(rows,1,'unsupported')[0].id,'unknown');
const popular=L.buildSchedule(rows,8,1,{travelFor:()=>1,selectionOrder:'popular'});
const newest=L.buildSchedule(rows,8,1,{travelFor:()=>1,selectionOrder:'newest'});
assert.ok(popular.selectedCount<3);
assert.notDeepEqual(new Set(popular.events.map(x=>x.id)),new Set(newest.events.map(x=>x.id)));
assert.ok(newest.events.some(x=>x.id==='new'));
assert.ok(!newest.events.some(x=>x.id==='unknown'));
// Worker should use the same selection mode and recompute on a live setting change.
let listener,posts=[];
const context=vm.createContext({console,Date,Math,Map,Set,Intl,Number,Object,String,Array,JSON,
 OffscreenCanvas:class{getContext(){return {measureText:s=>({width:String(s).length*10})}}},
 self:null,importScripts(file){vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file})}});
context.self=context;context.postMessage=m=>posts.push(m);context.addEventListener=(name,fn)=>{if(name==='message')listener=fn;};
vm.runInContext(fs.readFileSync(path.join(root,'scheduler-worker.js'),'utf8'),context,{filename:'scheduler-worker.js'});
assert.equal(posts.pop().type,'ready');
function send(data){listener({data});return posts.at(-1);}
send({type:'reset',videoId:'abcdefghijk'});
send({type:'batch',videoId:'abcdefghijk',records:rows.map(x=>({...x,originalText:x.text}))});
const m={w:960,h:540,fontsize:24,lanes:20},defaults={fontSize:24,hideReplies:false,translateComments:false,preserveLineBreaks:false,hideFromLines:0,autoShrink:true,halfLineOverlap:true,hideTimestamps:false,featuredPercent:0,featuredScrollFromLines:0,translateLanguage:'ja',speedMode:'fixed',speed:1,density:1};
const result1=send({type:'build',videoId:'abcdefghijk',requestId:1,settings:{...defaults,selectionOrder:'popular'},m,duration:8,now:0,force:true});
const result2=send({type:'build',videoId:'abcdefghijk',requestId:2,settings:{...defaults,selectionOrder:'newest'},m,duration:8,now:0,force:true});
assert.equal(result1.type,'built');assert.equal(result2.type,'built');
assert.ok(result2.tracks.some(x=>x.id==='new'),'newest should be selected by worker');
assert.ok(!result2.tracks.some(x=>x.id==='unknown'),'unknown date must not be considered new');
console.log('PASS: newest/popular selection, publication metadata, worker runtime changes, options page registration');
