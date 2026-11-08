'use strict';
const DEFAULTS = {enabled:true,fontSize:24,speed:1,density:5,opacity:.92,
  color:'#ffffff',colorMode:'single',speedMode:'fixed',language:'auto',selectionOrder:'popular',hideReplies:false,preserveLineBreaks:false,hideFromLines:0,featuredPercent:0,featuredScrollFromLines:0,
  translateComments:false,translateLanguage:'ja',autoShrink:true,halfLineOverlap:true,hideTimestamps:false,rendererMode:'auto',fpsLimit:0};
const I18N=globalThis.YDLI18N;
const settings={...DEFAULTS};
let lastStatus=null, activeTabId=null, statusTimer=null, statusRequest=0;
function t(key,...args){return I18N.translate(I18N.detect(settings.language),key,...args);}
function translateUi(){
  document.documentElement.lang=I18N.detect(settings.language);
  for(const node of document.querySelectorAll('[data-i18n]')) node.textContent=t(node.dataset.i18n);
  renderStatus(lastStatus);
}
function displayValue(key,value){
  return key==='fontSize'?`${value}px`:key==='speed'?`${Number(value).toFixed(1)}×`:
    key==='density'?(Number(value)===11?t('unlimited'):`${value}/10`):key==='opacity'?`${Math.round(Number(value)*100)}%`:
    key==='featuredPercent'?`${value}%`:(key==='hideFromLines'||key==='featuredScrollFromLines')?(Number(value)===0?t('unlimited'):`${value}${t('linesOrMore')}`):String(value);
}
function updateInput(key){
  const input=document.getElementById(key);
  if(!input)return;
  if(input.type==='checkbox')input.checked=settings[key];
  else input.value=settings[key];
  if(input.type==='range')document.getElementById(`${key}Out`).textContent=displayValue(key,settings[key]);
  if(key==='colorMode')document.getElementById('color').disabled=settings.colorMode==='random';
}
function renderStatus(status){
  const el=document.getElementById('statusText');
  if (!status?.videoId){el.textContent=t('unavailable');return;}
  if(status.count){el.textContent=t('statusCounts',status.count,status.selectedCount,status.droppedCount);return;}
  // API errors/status messages are not localized; use an understandable loading placeholder.
  el.textContent=t('statusLoading');
}
async function refreshStatus(){
  const request=++statusRequest;
  try {
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    const tab=tabs[0];
    if(request!==statusRequest)return;
    activeTabId=tab?.id || null;
    if(!tab?.id || !tab.url?.startsWith('https://www.youtube.com/')){
      lastStatus=null;renderStatus(lastStatus);return;
    }
    const result=await chrome.tabs.sendMessage(tab.id,{type:'YDL_GET_STATUS'});
    if(request!==statusRequest)return;
    lastStatus=result;
  } catch {if(request===statusRequest)lastStatus=null;}
  if(request===statusRequest)renderStatus(lastStatus);
}
function requestStatusRefresh(){
  if(statusTimer)clearTimeout(statusTimer);
  statusTimer=setTimeout(()=>{statusTimer=null;refreshStatus();},220);
}
chrome.runtime.onMessage.addListener((msg,sender)=>{
  if(msg?.type!=='YDL_STATUS_UPDATE'||sender.tab?.id!==activeTabId)return;
  ++statusRequest;
  lastStatus=msg.status;
  renderStatus(lastStatus);
});
chrome.storage.local.get(DEFAULTS,stored=>{
  for(const [key,value] of Object.entries(DEFAULTS)){
    if(typeof stored[key]===typeof value)settings[key]=stored[key];
    updateInput(key);
    const input=document.getElementById(key);
    if(!input)continue;
    input.addEventListener(input.type==='checkbox'||input.type==='color'||input.tagName==='SELECT'?'change':'input',()=>{
      const updated=input.type==='checkbox'?input.checked:(input.type==='range'||key==='fpsLimit')?Number(input.value):input.value;
      settings[key]=updated;
      chrome.storage.local.set({[key]:updated});
      updateInput(key);
      if(key==='language')translateUi();
      requestStatusRefresh();
    });
  }
  translateUi();
  refreshStatus();
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local')return;
  for(const [key,{newValue}] of Object.entries(changes)){
    if(key in DEFAULTS && typeof newValue===typeof DEFAULTS[key]){
      settings[key]=newValue;updateInput(key);
      if(key==='language')translateUi();
    }
  }
});
document.getElementById('openOptions')?.addEventListener('click',()=>{
  chrome.runtime.openOptionsPage?.();
});
const ycsFile=document.getElementById('ycsFile');
const importStatus=document.getElementById('importStatus');
ycsFile.addEventListener('change',async()=>{
  const file=ycsFile.files?.[0];if(!file)return;
  ycsFile.disabled=true;
  try{
    importStatus.textContent=t('importParsing');
    const data=JSON.parse(await file.text());
    const {videoId:sourceVideoId,items}=globalThis.YDLYcsParser.extractYcsExport(data);
    if(!items.length)throw new Error(t('importMissing'));
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    const tab=tabs[0];
    if(!tab?.id||!tab.url?.startsWith('https://www.youtube.com/'))throw new Error(t('importNeedTab'));
    const status=await chrome.tabs.sendMessage(tab.id,{type:'YDL_GET_STATUS'});
    if(!status?.videoId)throw new Error(t('importNeedReload'));
    if(!sourceVideoId)throw new Error(t('importMissingId'));
    if(sourceVideoId!==status.videoId)throw new Error(t('importOtherVideo'));
    for(let i=0;i<items.length;i+=200){
      const reply=await chrome.tabs.sendMessage(tab.id,{type:'YDL_IMPORT_BATCH',videoId:status.videoId,comments:items.slice(i,i+200)});
      if(!reply?.ok)throw new Error(reply?.reason || 'Could not deliver comments');
      importStatus.textContent=t('importProgress',Math.min(i+200,items.length),items.length);
      if(i%4000===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    importStatus.textContent=t('importDone',items.length);
    await refreshStatus();
  }catch(error){importStatus.textContent=t('importFailed',error?.message || String(error));}
  finally{ycsFile.disabled=false;ycsFile.value='';}
});
