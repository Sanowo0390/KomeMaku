/* Persistent off-main-thread scheduler for YCS streaming, preloading and scrubbing. */
'use strict';
importScripts('logic.js');
const L=self.YDLLogic;
const records=new Map();
const translations=new Map();
let videoId='',dirty=true,allTracks=[],allCenter=[],generic=[],selectedCount=0,droppedCount=0,maxTravel=0;
let cachedOptions='', lastDuration=NaN, lastNow=0, computed=false;
const measureCanvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(2,2):null;
const ctx=measureCanvas?.getContext('2d',{alpha:false});
const widthCache=new Map();
function measureText(value,size){
  const key=size+'\0'+value;
  let width=widthCache.get(key);
  if(width!==undefined)return width;
  if(ctx){ctx.font=`700 ${size}px system-ui, sans-serif`;width=0;
    for(const line of String(value).split('\n'))width=Math.max(width,ctx.measureText(line).width);
  }else width=Math.max(...String(value).split('\n').map(x=>x.length*size),0);
  widthCache.set(key,width);
  if(widthCache.size>16000)widthCache.clear();
  return width;
}
function effectiveFontSize(base,lines,height,enabled,spacing=1){
  if(!enabled||lines<=2)return base;
  const factor=Number.isFinite(spacing)?Math.max(.7,Math.min(2,spacing)):1;
  const fits=Math.max(12,Math.floor(height*.36/(1+(lines-1)*factor)/1.25));
  const densityFactor=Math.max(.64,1-Math.max(0,lines-3)*.07);
  return Math.max(12,Math.min(base,Math.round(base*densityFactor),fits));
}
function compute(message){
  const {settings,m,duration,now,force}=message;
  const optionsKey=JSON.stringify([settings,m.w,m.h,m.fontsize,m.lanes,duration]);
  if(force||optionsKey!==cachedOptions||!computed){dirty=true;cachedOptions=optionsKey;}
  if(dirty){
    const eligible=[];
    for(const record of records.values()){
      if(settings.hideReplies&&record.isReply)continue;
      const tr=settings.translateComments?translations.get(settings.translateLanguage+'\0'+record.originalText):null;
      const text=settings.hideTimestamps?L.hideTimestamps(tr||record.originalText):tr||record.originalText;
      const prepared=L.prepareText(text,settings.preserveLineBreaks,0);
      if(settings.hideFromLines>0&&record.originalText.split('\n').length>=settings.hideFromLines)continue;
      if(!prepared)continue;
      const sourceLineCount=record.originalText.split('\n').length;
      const font=effectiveFontSize(m.fontsize,prepared.lineCount,m.h,settings.autoShrink,settings.lineSpacing);
      eligible.push({...record,...prepared,sourceLineCount,scheduleText:record.originalText,fontsize:font,
        speedFactor:L.speedFactor(record.id,settings.speedMode)});
    }
    const travelFor=r=>L.scrollTravelSeconds(measureText(r.text,r.fontsize||m.fontsize),m.w,settings.speed*r.speedFactor);
    const timestampLeadFor=record=>L.timestampHeadLeadSeconds(
      measureText(record.text,record.fontsize||m.fontsize),m.w,
      settings.speed*record.speedFactor,duration,.6);
    const schedule=L.buildSchedule(eligible,duration,settings.density,
      {travelFor,timestampLeadFor,selectionOrder:settings.selectionOrder});
    generic=schedule.generic;
    const features=L.selectFeatured(schedule.events,settings.featuredPercent);
    const opts={viewportWidth:m.w,lanes:m.lanes,duration,speed:settings.speed,
      measureText:(text,font)=>measureText(text,font||m.fontsize),finishMargin:.6,
      gap:Math.max(24,m.fontsize),halfLineOverlap:settings.halfLineOverlap};
    // A Worker keeps its *entire* scheduled history, even when new YCS batches
    // arrive. The old implementation pinned only tracks visible around `now`,
    // then silently dropped everything earlier than that window.
    const cutoff=Math.max(0,Number(now)||0)+1.2;
    const eligibleById=new Map(eligible.map(e=>[String(e.id),e]));
    function preserveStarted(source){
      if(force||!computed)return [];
      return source.filter(track=>track.time<=cutoff && eligibleById.has(String(track.id)))
        .map(track=>{
          const fresh=eligibleById.get(String(track.id));
          if(fresh.text===track.text&&fresh.fontsize===track.fontsize)return track;
          // Refresh translation/text on a track without moving its start time,
          // lane or velocity. Its new geometry gets accounted for as a fixed
          // obstacle when placing new comments. Existing sprites are repainted.
          const font=track.displayMode==='center'
            ? Math.ceil((fresh.fontsize||m.fontsize)*1.5) : fresh.fontsize;
          const width=Math.ceil(measureText(fresh.text,font));
          const end=track.displayMode==='center' ? track.end
            : track.time+(m.w+18+width)/track.velocity;
          return {...track,text:fresh.text,fontsize:font,
            lineCount:fresh.lineCount,width,end};
        });
    }
    const previous=preserveStarted(allTracks);
    const previousCenter=preserveStarted(allCenter);
    const fixedIds=new Set([...previous,...previousCenter].map(t=>String(t.id)));
    const featured=schedule.events.filter(e=>features.has(String(e.id)) &&
      !L.shouldScrollFeatured(e,settings.featuredScrollFromLines) && !fixedIds.has(String(e.id)))
      .sort((a,b)=>a.time-b.time);
    const centers=L.planFeatured(featured,{fixedTracks:previousCenter,
      viewportHeight:m.h,viewportWidth:m.w,duration,fontsize:m.fontsize,
      measureText,gap:5,lineSpacing:settings.lineSpacing});
    const centeredIds=new Set(centers.tracks.map(e=>String(e.id)));
    // If a featured comment did not fit at the bottom, it gets its normal
    // scrolling attempt rather than disappearing altogether.
    const scrolling=schedule.events.filter(e=>!centeredIds.has(String(e.id)) && !fixedIds.has(String(e.id)));
    const result=L.planTracks(scrolling,{...opts,fixedTracks:previous});
    allTracks=[...previous,...result.tracks].sort((a,b)=>a.time-b.time||L.likeRank(a,b));
    allCenter=centers.tracks;
    maxTravel=Math.max(result.maxTravel,...previous.map(t=>t.end-t.time),0);
    selectedCount=allTracks.length+allCenter.length+generic.length;
    droppedCount=Math.max(0,records.size-selectedCount);
    computed=true;dirty=false;
  }
  lastNow=now;lastDuration=duration;
  const from=Math.max(0,now-35),until=now+100;
  // The advertised window must be fully covered by the transferred tracks:
  // include all comments overlapping [from,until], even those which started
  // earlier than `from`. Only the window is serialized; all history stays here.
  const select=(arr,lookback)=>{
    const visible=[];
    for(let i=L.lowerBound(arr,from-lookback);i<arr.length;i++){
      const track=arr[i];
      if(track.time>until)break;
      if(track.end>from)visible.push(track);
    }
    return visible;
  };
  self.postMessage({type:'built',videoId,requestId:message.requestId,
    tracks:select(allTracks,maxTravel+1),centerTracks:select(allCenter,10),generic,
    maxTravel,selectedCount,droppedCount,windowFrom:from,windowUntil:until});
}
self.addEventListener('message',({data})=>{
  try{
    if(!data||!['reset','batch','translated','translations','build'].includes(data.type))return;
    if(data.type==='reset'){
      videoId=data.videoId||'';records.clear();translations.clear();widthCache.clear();
      dirty=true;computed=false;cachedOptions='';allTracks=[];allCenter=[];generic=[];
      selectedCount=0;droppedCount=0;maxTravel=0;
      return;
    }
    if(data.videoId!==videoId)return;
    if(data.type==='batch'){
      for(const record of (data.records||[]))if(record?.id)records.set(String(record.id),record);
      dirty=true;return;
    }
    if(data.type==='translations'){
      for(const entry of (data.entries||[]))translations.set(entry[0],entry[1]);
      dirty=true;return;
    }
    if(data.type==='translated'){
      translations.set(data.language+'\0'+data.source,data.text);dirty=true;return;
    }
    if(data.type==='build'){compute(data);return;}
  }catch(e){self.postMessage({type:'error',videoId,requestId:data?.requestId,error:String(e?.message||e)});}
});
self.postMessage({type:'ready'});
