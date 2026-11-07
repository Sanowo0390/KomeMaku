const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'..');
const parser = require('../ycs-parser.js');

// Exact 2026 frameworkUpdates shape and legacy replies.
const response = {
  onResponseReceivedEndpoints:[{appendContinuationItemsAction:{continuationItems:[
    {commentThreadRenderer:{comment:{commentRenderer:{commentId:'parent',contentText:{runs:[{text:'親コメント'}]},voteCount:{simpleText:'1.2万'}}}}},
    {commentViewModel:{commentId:'reply-1'}}
  ]}}],
  frameworkUpdates:{entityBatchUpdate:{mutations:[
    {payload:{commentEntityPayload:{properties:{commentId:'reply-1',content:{content:'返信の内容'}},toolbar:{likeCountLiked:'38'}}}},
    {payload:{commentEntityPayload:{properties:{commentId:'reply-2',content:{content:'ネストされた返信'}}}}}
  ]}}
};
assert.deepEqual(parser.extractResponseComments(response).map(c=>c.text).sort(),['親コメント','返信の内容','ネストされた返信'].sort());
assert.equal(parser.extractResponseComments(response).find(x=>x.id==='parent').likes,12000);
assert.equal(parser.extractResponseComments(response).find(x=>x.id==='reply-1').likes,38);
const exported = {urlVideo:'https://www.youtube.com/watch?v=abcdefghijk',comments:[
  {commentUrl:'youtube.com/watch?v=abcdefghijk&lc=parent',commentMessage:'親コメント',totalLikes:555,commentReplies:{replies:[
    {commentUrl:'youtube.com/watch?v=abcdefghijk&lc=reply-1',commentMessage:'返信の内容',totalLikes:13}
  ]}}
],commentsChat:[{id:'chat-1',commentMessage:'録画チャット',relativeTimestamp:'+00:30'}]};
const imported = parser.extractYcsExport(exported);
assert.equal(imported.videoId,'abcdefghijk');
assert.equal(imported.items.length,3);
assert.equal(imported.items[2].time,30);
assert.equal(imported.items[1].id,'reply-1');
assert.equal(imported.items[0].likes,555);
assert.equal(imported.items[1].likes,13);
assert.equal(parser.parseLikeCount('2.2万'),22000);

// Verify the passive fetch hook forwards all pages without changing response for YCS.
let route = 'https://www.youtube.com/watch?v=abcdefghijk';
const events = [], responseBody = response;
const nativeFetch = async()=>({ok:true,headers:{get:()=>null}, clone(){return {json:async()=>responseBody};}, json:async()=>responseBody});
class CustomEvent { constructor(type, options){this.type=type;this.detail=options.detail;} }
const sandbox = {URL,CustomEvent,console,location:{get href(){return route},origin:'https://www.youtube.com'},fetch:nativeFetch,window:null};
sandbox.window=sandbox; sandbox.dispatchEvent = e=>events.push(e);
vm.runInNewContext(fs.readFileSync(path.join(root,'ycs-parser.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(path.join(root,'ycs-bridge.js'),'utf8'),sandbox);
(async()=>{
  const r = await sandbox.fetch('https://www.youtube.com/youtubei/v1/next?key=fake',{});
  assert.equal((await r.json()).onResponseReceivedEndpoints.length,1);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(events.length,1);
  const event=JSON.parse(events[0].detail);
  assert.equal(event.videoId,'abcdefghijk');
  assert.equal(event.comments.length,3);
  assert.equal(sandbox.fetch !== nativeFetch,true);
  await sandbox.fetch('https://www.youtube.com/api/not-comments');
  assert.equal(events.length,1);
  route='https://www.youtube.com/watch?v=12345678901';
  assert.equal(parser.videoIdFromUrl('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(parser.extractResponseComments({contents:{continuationCommand:{token:'a'}}}).length,0);
  const big = {videoId:'abcdefghijk',comments:Array.from({length:12000},(_,i)=>({commentUrl:`https://www.youtube.com/watch?v=abcdefghijk&lc=id${i}`,commentMessage:`#${i}`}))};
  assert.equal(parser.extractYcsExport(big).items.length,12000,'do not cap exported comment count');
  console.log('PASS: YCS normal/reply/nested extraction, export JSON+chat, passive fetch hook, 12,000 comments');
})().catch(err=>{console.error(err);process.exitCode=1;});
