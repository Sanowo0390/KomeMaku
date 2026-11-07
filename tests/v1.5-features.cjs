'use strict';
const assert=require('node:assert/strict');
const logic=require('../logic.js');
const parser=require('../ycs-parser.js');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {prepareText,selectFeatured,mergeStableTracks,planTracks,trackX}=logic;
assert.equal(prepareText('a\nb',false,2),null,'line-count filter checks original newlines');
assert.deepEqual(prepareText('a\nb',false,3),{text:'a b',lineCount:1});
assert.deepEqual(prepareText('a\nb',true,3),{text:'a\nb',lineCount:2});
assert.deepEqual(prepareText('a\nb',true,0),{text:'a\nb',lineCount:2});
assert.deepEqual(prepareText('one\n\ntwo',true,3),null);
assert.equal(prepareText('one two',false,1),null);
const comments=[{id:'a',likes:200},{id:'b',likes:0},{id:'c',likes:99},{id:'d',likes:3},{id:'e',likes:2}];
const picked=selectFeatured(comments,20);assert.deepEqual([...picked],['a']);
assert.equal(selectFeatured(comments,0).size,0);
assert.equal(selectFeatured(comments,100).has('b'),false,'unliked comments never become featured');
const opts={viewportWidth:400,lanes:4,duration:100,speed:1,measureText:t=>t.split('\n').reduce((n,s)=>Math.max(n,s.length*12),0),gap:18};
const old=planTracks([{id:'old',text:'A',time:2,lineCount:2},{id:'pin2',text:'B',time:3,lineCount:1},{id:'future',text:'C',time:40,lineCount:1}],opts).tracks;
assert.ok(old.length>=2);
const revised=mergeStableTracks(old,[{id:'new',text:'D',time:60,lineCount:1},{id:'new2',text:'LONG'.repeat(15),time:63,lineCount:2}],opts,6,1);
for (const prior of old.filter(x=>x.time<=7)) {
 const now=revised.tracks.find(x=>x.id===prior.id);
 assert.ok(now,'previously shown track remains');
 assert.equal(now.time,prior.time);assert.equal(now.lane,prior.lane);
 assert.equal(trackX(now,6,opts.viewportWidth),trackX(prior,6,opts.viewportWidth));
}
const two=planTracks([{id:'a',text:'a\nb\nc',time:1,lineCount:3},{id:'b',text:'b',time:1.1,lineCount:1}],opts).tracks;
assert.ok(two.every(x=>x.lane+x.laneSpan<=4),'multi-line takes several adjacent lanes');
const exported=parser.extractYcsExport({videoId:'abcdefghijk',comments:[{id:'root',commentMessage:'root',commentReplies:{replies:[{id:'reply',commentMessage:'reply'}]}}]});
assert.equal(exported.items.find(x=>x.id==='reply').isReply,true);
assert.equal(exported.items.find(x=>x.id==='root').isReply,false);
const raw=parser.extractResponseComments({frameworkUpdates:{entityBatchUpdate:{mutations:[{payload:{commentEntityPayload:{key:'r',properties:{commentId:'r',content:{content:'reply'},replyLevel:1}}}}]}}});
assert.equal(raw[0].isReply,true);
for(const name of ['hideReplies','preserveLineBreaks','hideFromLines','featuredPercent']) {
 assert.ok(fs.readFileSync(path.join(root,'content.js'),'utf8').includes(`'${name}'`));
 assert.ok(fs.readFileSync(path.join(root,'popup.html'),'utf8').includes(`id="${name}"`));
}
console.log('PASS: YCS replies, original line filters, centered liked selection, stable timeline, multiline lanes and UI');
