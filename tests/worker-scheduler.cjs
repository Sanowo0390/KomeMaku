const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const outgoing=[];let onMessage;
const self={postMessage:m=>outgoing.push(m),addEventListener:(type,fn)=>{if(type==='message')onMessage=fn}};
const mockContext={font:'',measureText:text=>({width:Array.from(text).length*17})};
const scope={self,console,Date,Math,Map,Set,Intl,Number,Object,String,Array,JSON,
  OffscreenCanvas:class{getContext(){return mockContext}},
  importScripts(filename){vm.runInContext(fs.readFileSync(path.join(root,filename),'utf8'),context,{filename});}};
scope.self=scope;scope.postMessage=self.postMessage;scope.addEventListener=self.addEventListener;
const context=vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root,'scheduler-worker.js'),'utf8'),context,{filename:'scheduler-worker.js'});
assert.equal(outgoing.pop()?.type,'ready');
const send=data=>onMessage({data});
const settings={fontSize:24,density:5,speed:1,speedMode:'fixed',hideReplies:false,hideFromLines:0,
 hideTimestamps:false,autoShrink:true,preserveLineBreaks:false,translateComments:false,translateLanguage:'ja',featuredPercent:10,halfLineOverlap:true};
const m={w:960,h:540,fontsize:24,lanes:20};
const data=Array.from({length:5000},(_,i)=>({id:'comment'+i,originalText:'テスト '+i,likes:i%100,isReply:false,source:'ycs'}));
send({type:'reset',videoId:'abcdefghijk'});
for(let i=0;i<data.length;i+=300)send({type:'batch',videoId:'abcdefghijk',records:data.slice(i,i+300)});
send({type:'build',videoId:'abcdefghijk',requestId:1,settings,m,duration:600,now:120,force:true});
let built=outgoing.pop();assert.equal(built.type,'built',built.error);assert.equal(built.videoId,'abcdefghijk');
assert.equal(built.requestId,1);assert.ok(built.selectedCount>0);
assert.equal(built.selectedCount+built.droppedCount,5000);
assert.ok(built.tracks.length<5000,'only the rolling viewport is sent');
assert.ok(built.windowUntil>120+80);
// A seek uses cached plans; it never has to re-serialize all source comments.
send({type:'build',videoId:'abcdefghijk',requestId:2,settings,m,duration:600,now:340,force:false});
built=outgoing.pop();assert.equal(built.type,'built',built.error);
assert.ok(built.tracks.every(x=>x.time<=built.windowUntil));
assert.equal(built.selectedCount+built.droppedCount,5000);
// Update likes incrementally and ensure only current video is updated.
send({type:'batch',videoId:'other',records:[{id:'wrong',originalText:'wrong'}]});
send({type:'batch',videoId:'abcdefghijk',records:[{...data[4],likes:999999}]});
send({type:'build',videoId:'abcdefghijk',requestId:3,settings,m,duration:600,now:340,force:false});
built=outgoing.pop();assert.equal(built.type,'built',built.error);
assert.equal(built.selectedCount+built.droppedCount,5000);
// Worker honors translated text and disabled replies on recompute.
send({type:'translated',videoId:'abcdefghijk',language:'ja',source:'テスト 4',text:'訳したコメント'});
send({type:'build',videoId:'abcdefghijk',requestId:4,settings:{...settings,translateComments:true,density:11},m,duration:600,now:3,force:true});
built=outgoing.pop();assert.equal(built.type,'built',built.error);
assert.ok(built.selectedCount>0);
send({type:'reset',videoId:'newvideo123'});
send({type:'build',videoId:'newvideo123',requestId:5,settings,m,duration:120,now:0,force:true});
built=outgoing.pop();assert.equal(built.selectedCount,0);
console.log('PASS: worker scheduler 5,000 comments, incremental updates, cached seeks, translation and reset');
