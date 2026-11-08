"use strict";
// Optional external translation. The content script sends only selected visible/soon-visible
// texts after explicit opt-in; never send YouTube URLs, usernames or auth credentials.
const translateCache=new Map();
let nextTranslationAt=0;
const LANGUAGES=new Set(['ja','en','zh-CN','zh-TW','ko','es','fr','de']);
async function translate(text,target){
  if(!LANGUAGES.has(target)||typeof text!=='string'||!text.trim()||text.length>700)throw Error('Invalid translation request');
  const key=target+'\0'+text;
  if(translateCache.has(key))return translateCache.get(key);
  const wait=Math.max(0,nextTranslationAt-Date.now());
  nextTranslationAt=Math.max(Date.now(),nextTranslationAt)+600;
  if(wait)await new Promise(done=>setTimeout(done,wait));
  const url=new URL('https://translate.googleapis.com/translate_a/t');
  url.search=new URLSearchParams({client:'dict-chrome-ex',sl:'auto',tl:target,q:text}).toString();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const res=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-store'});
    if(!res.ok)throw Error('Translation service HTTP '+res.status);
    const json=await res.json();
    // Unofficial endpoint: multiple response shapes have appeared over time.
    const translated=Array.isArray(json)
      ? (Array.isArray(json[0]) ? (Array.isArray(json[0][0]) ? json[0].map(item=>String(item?.[0]||'')).join('') : String(json[0][0]||'')) : String(json[0]||''))
      : (typeof json?.translation==='string'?json.translation:'');
    if(!translated.trim())throw Error('No translation returned');
    if(translateCache.size>2200)translateCache.delete(translateCache.keys().next().value);
    translateCache.set(key,translated.slice(0,850));
    return translated.slice(0,850);
  }finally{clearTimeout(timeout);}
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg?.type==='YDL_TRANSLATE' && sender.tab && sender.url?.startsWith('https://www.youtube.com/')){
    translate(msg.text,msg.target).then(text=>sendResponse({ok:true,text})).catch(error=>sendResponse({ok:false,error:String(error?.message||error)}));
    return true;
  }
  // Preserve the live-chat relay used by previous releases.
  if(msg?.type==='YDL_CHAT' && sender.tab?.id && sender.url?.startsWith('https://www.youtube.com/live_chat')){
    const payload={type:'YDL_CHAT_EVENT',
      videoId:typeof msg.videoId==='string'?msg.videoId.slice(0,64):'',
      id:typeof msg.id==='string'?msg.id.slice(0,160):'',
      text:typeof msg.text==='string'?msg.text.slice(0,220):''};
    if(payload.text)chrome.tabs.sendMessage(sender.tab.id,payload,{frameId:0}).catch(()=>{});
  }
});
