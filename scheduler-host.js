/* Extension-origin bridge: YouTube content scripts cannot always launch chrome-extension workers directly. */
(() => {
 'use strict';
 let worker;
 const origin='https://www.youtube.com';
 try {
   worker=new Worker(chrome.runtime.getURL('scheduler-worker.js'));
   worker.addEventListener('message',event=>{
     window.parent.postMessage({source:'komemaku-scheduler',...event.data},origin);
   });
   worker.addEventListener('error',event=>{
     window.parent.postMessage({source:'komemaku-scheduler',type:'error',error:event.message},origin);
   });
 } catch(e){window.parent.postMessage({source:'komemaku-scheduler',type:'error',error:String(e)},origin);return;}
 window.addEventListener('message',event=>{
   if(event.source!==window.parent||event.origin!==origin||event.data?.source!=='komemaku-content')return;
   const {source,...data}=event.data;
   if(!['reset','batch','translated','translations','build'].includes(data.type))return;
   if(data.type==='batch'&&(!Array.isArray(data.records)||data.records.length>10000))return;
   if(data.type==='translations'&&(!Array.isArray(data.entries)||data.entries.length>500))return;
   worker.postMessage(data);
 });
 window.parent.postMessage({source:'komemaku-scheduler',type:'host-ready'},origin);
})();
