(() => {
  "use strict";
  if (window.__YDL_CONTENT_INSTALLED__) return;
  window.__YDL_CONTENT_INSTALLED__ = true;

  const {fontScaleForViewport,fontCss,outlineWidthFor,textHeightFor,lineStepFor, normalizeText, cleanOriginalText, hideTimestamps, prepareText, parseLikeCount, buildSchedule, lowerBound, scrollTravelSeconds, timestampHeadLeadSeconds, createTrack, planFeatured, planTracks, mergeStableTracks, selectFeatured, shouldScrollFeatured, visibleTracks, paceFrame, trackX, commentColor, speedFactor} = globalThis.YDLLogic;
  const I18N = globalThis.YDLI18N;
  const parsePublishedAt = globalThis.YDLYcsParser?.parsePublishedAt || (()=>null);
  const t = (key,...args) => I18N.translate(I18N.detect(settings.language),key,...args);
  const DEFAULTS = Object.freeze({enabled:true,fontSize:24,fontFamily:'system',autoFontScale:true,outlineEnabled:true,outlineStrength:1,outlineOpacity:.86,lineSpacing:1,opacity:0.92,speed:1,density:5,
    color:'#ffffff',colorMode:'single',speedMode:'fixed',language:'auto',selectionOrder:'popular',
    hideReplies:false,preserveLineBreaks:false,hideFromLines:0,featuredPercent:0,featuredScrollFromLines:0,
    translateComments:false,translateLanguage:'ja',autoShrink:true,halfLineOverlap:true,hideTimestamps:false,rendererMode:'auto',fpsLimit:0});
  const settings = {...DEFAULTS};
  const records = [];
  const recordKeys = new Set();
  const recordByKey = new Map();
  let selectedCount = 0, droppedCount = 0;
  let renderTracks = [], centerTracks = [], maxTravel = 0, liveTracks = [];
  let lastRebuildAt = 0, invalidated = true, lastRenderedAt = 0, lastPaintTime = NaN;
  let nextPaintAt=0;
  const textWidths = new Map();
  const translationCache=new Map();
  const translationPending=new Set();
  const translationFailed=new Map();
  let translationJobs=0, translationEpoch=0;
  function translationKey(source){return settings.translateLanguage+'\0'+source;}
  function resetTranslationSession() {
    translationEpoch++;
    translationPending.clear();
    translationFailed.clear();
    translationJobs=0;
    invalidated=true;
  }
  function scheduleTranslations(now) {
    if(!settings.translateComments || !currentVideo || translationJobs>=2 ||
       (!renderTracks.length && !centerTracks.length)) return;
    const epoch=translationEpoch, target=settings.translateLanguage;
    let queued=0;
    for(const group of [renderTracks,centerTracks]) {
      // Include already-moving long comments, not just events that start
      // in the next 20 seconds (important after enabling translation mid-video).
      const startIndex=lowerBound(group,now-Math.max(25,maxTravel));
      for(let index=startIndex;index<group.length && index<startIndex+100;index++) {
        const item=group[index];
        if(item.time>now+20) break;
        if(Number.isFinite(item.end) && item.end<=now) continue;
        const source=item.originalText||item.text;
        const key=translationKey(source);
        const failed=translationFailed.get(key);
        if(source.length>700 || !source.trim() || translationCache.has(key) ||
           translationPending.has(key) || (failed && (failed.tries>=3 || failed.retryAt>Date.now())))continue;
        translationPending.add(key);translationJobs++;queued++;
        try {
          chrome.runtime.sendMessage({type:'YDL_TRANSLATE',text:source,target}, response=>{
            if(epoch!==translationEpoch)return;
            translationJobs=Math.max(0,translationJobs-1);translationPending.delete(key);
            if(response?.ok && typeof response.text==='string' && response.text.trim()) {
              const translated=cleanOriginalText(response.text);
              translationCache.set(key,translated);
              schedulerSend({type:'translated',videoId,source,language:target,text:translated});
              translationFailed.delete(key);
              if(translationCache.size>4000)translationCache.delete(translationCache.keys().next().value);
              queueRebuild();
            }else {
              const tries=(failed?.tries||0)+1;
              translationFailed.set(key,{tries,retryAt:Date.now()+Math.min(30000,tries*5000)});
            }
            invalidated=true;
          });
        } catch {
          translationJobs=Math.max(0,translationJobs-1);translationPending.delete(key);
          translationFailed.set(key,{tries:3,retryAt:Infinity});
        }
        if(translationJobs>=2 || queued>=2)break;
      }
      if(translationJobs>=2 || queued>=2)break;
    }
  }
  // WebGL2 is preferred on supported GPUs, while 2D remains the safe fallback.
  let webgl=null, rendererName='canvas',glDisabledForSession=false;
  let measureContext=null, animationCost=0, autoFps=60, autoFpsCheck=0;
  // Scheduling lives in an extension-origin iframe worker. It is optional:
  // if CSP, iframe or worker creation fails, the original 2D scheduler remains usable.
  let schedulerFrame=null,schedulerReady=false,schedulerHealthy=true;
  let schedulerRequest=0,schedulerPending=0,schedulerLastPlanAt=0;
  let schedulerWindowFrom=0,schedulerWindowUntil=0;
  let schedulerStarted=false;
  const schedulerOrigin=(typeof chrome.runtime?.getURL==='function')
    ? chrome.runtime.getURL('scheduler-host.html').match(/^chrome-extension:\/\/[^/]+/)?.[0]||null : null;
  function schedulerSend(data){
    if(!schedulerReady||!schedulerFrame?.contentWindow)return false;
    try{schedulerFrame.contentWindow.postMessage({source:'komemaku-content',...data},schedulerOrigin);return true;}
    catch{return false;}
  }
  function syncTranslations(){
    if(!schedulerReady||!translationCache.size)return;
    const entries=[...translationCache.entries()];
    for(let i=0;i<entries.length;i+=400)
      schedulerSend({type:'translations',videoId,entries:entries.slice(i,i+400)});
  }
  function disableScheduler(reason){
    if(!schedulerHealthy)return;
    console.warn('[KomeMaku] Worker scheduler fallback:',reason);
    schedulerHealthy=false;schedulerReady=false;schedulerPending=0;
    if(schedulerFrame){schedulerFrame.remove();schedulerFrame=null;}
    queueRebuild(true);
  }
  function startScheduler(){
    if(schedulerStarted||!schedulerOrigin||!document.documentElement)return;
    schedulerStarted=true;
    window.addEventListener('message',event=>{
      if(!schedulerFrame||event.source!==schedulerFrame.contentWindow||
         event.origin!==schedulerOrigin||event.data?.source!=='komemaku-scheduler')return;
      const message=event.data;
      if(message.type==='host-ready'){return;}
      if(message.type==='ready'){
        schedulerReady=true;schedulerPending=0;
        schedulerSend({type:'reset',videoId});
        for(let i=0;i<records.length;i+=800)schedulerSend({type:'batch',videoId,records:records.slice(i,i+800)});
        syncTranslations();
        if(records.length)queueRebuild(true);
      }else if(message.type==='built'){
        if(message.videoId!==videoId||message.requestId!==schedulerPending)return;
        schedulerPending=0;
        renderTracks=message.tracks||[];centerTracks=message.centerTracks||[];
        untimed=message.generic||[];maxTravel=message.maxTravel||0;
        selectedCount=message.selectedCount||0;droppedCount=message.droppedCount||0;
        schedulerWindowFrom=message.windowFrom||0;schedulerWindowUntil=message.windowUntil||0;
        schedulerLastPlanAt=globalThis.performance?.now?.()??Date.now();
        lastRebuildAt=schedulerLastPlanAt;invalidated=true;notifyStatus();
      }else if(message.type==='error')disableScheduler(message.error||'unknown error');
    });
    const iframe=document.createElement('iframe');
    schedulerFrame=iframe;
    iframe.setAttribute('aria-hidden','true');
    iframe.setAttribute('tabindex','-1');
    Object.assign(iframe.style,{position:'fixed',width:'0',height:'0',border:'0',opacity:'0',pointerEvents:'none',left:'-100px'});
    iframe.src=chrome.runtime.getURL('scheduler-host.html');
    iframe.addEventListener('error',()=>disableScheduler('iframe failed'));
    document.documentElement.appendChild(iframe);
    // Do not wait indefinitely for an extension iframe blocked by page policy.
    setTimeout(()=>{if(!schedulerReady&&schedulerHealthy)disableScheduler('startup timeout');},7000);
  }
  function workerBuild(force){
    if(!schedulerReady||!schedulerHealthy||!currentVideo||!stage)return false;
    const m=metrics(), now=Number(currentVideo.currentTime)||0;
    schedulerPending=++schedulerRequest;
    const sent=schedulerSend({type:'build',videoId,requestId:schedulerPending,settings:{...settings},m,
      duration:currentVideo.duration,now,force});
    if(!sent)schedulerPending=0;
    else{const requested=schedulerPending;setTimeout(()=>{if(schedulerPending===requested)disableScheduler('unresponsive scheduler');},15000);}
    return sent;
  }
  const spriteCache = new Map();
  let spriteBytes = 0;
  const MAX_SPRITE_BYTES = 20 * 1024 * 1024;
  const MAX_SPRITES = 130;
  let untimed = [], genericCursor = 0, nextGenericAt = null;
  let videoId = "", currentVideo = null, stage = null, canvas = null, ctx = null;
  let playerButton = null, playerPanel = null, panelIsOpen = false;
  let stageResize = null, lastVideoTime = null;
  let lastUrl = "", bridgeRequest = "", bridgeRetries = 0;
  let commentStatus = "まだコメントを取得していません";
  let commentStatusCode = "idle";
  let sources = new Set();
  let scanTimeout = null, domObserver = null, rebuildTimer = null;
  const liveSeen = new Set();
  const liveSeenOrder = [];
  let liveCount = 0;

  const videoIdFromUrl = () => {
    const url = new URL(location.href);
    if (url.pathname === "/watch") return url.searchParams.get("v") || "";
    const short = url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return short ? short[1] : "";
  };

  function newVideo(id) {
    resetTranslationSession();
    videoId = id;
    if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
    records.length = 0;
    recordKeys.clear();
    recordByKey.clear();
    selectedCount = 0; droppedCount = 0;
    renderTracks = []; centerTracks=[]; maxTravel = 0; liveTracks = []; untimed = [];
    textWidths.clear(); clearSprites(); lastRebuildAt=0; invalidated=true;
    genericCursor = 0; lastVideoTime = null; nextGenericAt = null;
    sources = new Set();
    commentStatus = "コメントを取得しています…";
    commentStatusCode = "loading";
    bridgeRequest = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    bridgeRetries = 0;
    liveSeen.clear();
    schedulerPending=0;schedulerWindowFrom=0;schedulerWindowUntil=0;
    schedulerSend({type:'reset',videoId});
    syncTranslations();
    liveSeenOrder.length = 0;
    liveCount = 0;
    if (canvas && webgl)webgl.clear();
    else if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (id) requestComments();
  }

  function requestComments() {
    if (!videoId || bridgeRetries >= 4) return;
    bridgeRetries++;
    window.dispatchEvent(new CustomEvent("ydl:request", {
      detail: JSON.stringify({id: bridgeRequest, videoId})
    }));
  }

  function readText(node) {
    if (!node) return "";
    let result = "";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && result.length < 750) {
      const part = walker.currentNode;
      if (part.nodeType === Node.TEXT_NODE) result += part.textContent || "";
      else if (part.nodeType === Node.ELEMENT_NODE) {
        if(part.tagName==='BR')result+='\n';
        else if(part.tagName==='IMG')result+=part.getAttribute('alt')||'';
      }
    }
    return cleanOriginalText(result,700);
  }

  function addComments(items, source) {
    if (!Array.isArray(items)) return;
    let changed = false;
    const delta=[];
    for (const item of items) {
      const originalText=cleanOriginalText(item?.text);
      if (!originalText) continue;
      const text=originalText.replace(/\s*\n\s*/g,' ');
      const id = String(item.id || `text:${text.toLowerCase()}`);
      const key = `comment:${id}`;
      const likes = parseLikeCount(item.likes ?? item.likeCount ?? item.totalLikes);
      const publishedAt=parsePublishedAt(item.publishedAt??item.publishedTimeText??item.commentTime);
      // Relative labels such as '3 days ago' are time-dependent. Never
      // advance a previously recorded timestamp when the same source is
      // scanned again. More authoritative API/YCS metadata may replace DOM.
      const publishedAtRank=source==='dom'?1:source==='api'?2:3;
      if (recordKeys.has(key)) {
        // The initial YouTube/DOM fetch may have no like information; YCS
        // often provides the accurate score later. Keep the higher known count.
        const previous = recordByKey.get(key);
        if (previous) {
          const wasChanged=changed;
          changed=false;
          if (likes > previous.likes) {previous.likes = likes;changed = true;}
          if(publishedAt && (!previous.publishedAt || publishedAtRank>(previous.publishedAtRank||0))){
            previous.publishedAt=publishedAt;previous.publishedAtRank=publishedAtRank;changed=true;
          }
          if (!previous.isReply && item.isReply===true) {previous.isReply=true;changed=true;}
          if(!previous.parentId && item.parentId) {previous.parentId=item.parentId;changed=true;}
          if (originalText.length > previous.originalText.length) {
            previous.originalText=originalText;changed=true;
          }
          if(changed)delta.push({...previous});
          changed=wasChanged||changed;
        }
        continue;
      }
      recordKeys.add(key);
      const record = {id, text, originalText, source, likes, publishedAt,publishedAtRank,
        isReply:item.isReply===true,parentId:item.parentId||null,
        time:Number.isFinite(item.time) && item.time >= 0 ? item.time : null};
      records.push(record);
      recordByKey.set(key, record);
      delta.push(record);
      changed = true;
    }
    if (changed) {
      if(schedulerReady&&schedulerHealthy)for(let i=0;i<delta.length;i+=800)
        schedulerSend({type:'batch',videoId,records:delta.slice(i,i+800)});
      sources.add(source);
      queueRebuild();
      commentStatus = `${records.length.toLocaleString()}件のコメントを取得`;
      commentStatusCode = "success";
    }
  }

  function queueRebuild(force=false) {
    // Schedule at a fixed throttle boundary, not a trailing debounce: a YCS
    // Load all session can stream for minutes, so continuous batches must not
    // postpone every update indefinitely.
    if (rebuildTimer && !force) return;
    if (rebuildTimer) clearTimeout(rebuildTimer);
    const elapsed=(globalThis.performance?.now?.() ?? Date.now())-lastRebuildAt;
    const delay=force?0:(lastRebuildAt?Math.max(75,4200-elapsed):550);
    rebuildTimer=setTimeout(()=>{rebuildTimer=null;rebuildSchedule(force);},delay);
  }

  function currentStatus() {
    return {videoId,count:records.length+liveCount,selectedCount,droppedCount,
      sources:Array.from(sources),status:commentStatus,statusCode:commentStatusCode,renderer:rendererName,
      scheduler:schedulerReady?'worker':'main',fpsLimit:settings.fpsLimit||'auto'};
  }
  function notifyStatus() {
    try { chrome.runtime.sendMessage({type:'YDL_STATUS_UPDATE',status:currentStatus()},()=>void chrome.runtime.lastError); }
    catch { /* popup closed or extension context changed */ }
  }
  function clearSprites() {spriteCache.clear();spriteBytes=0;webgl?.clearCache();}
  function textWidth(text,fontPx) {
    const key=`${settings.fontFamily}\0${fontPx}\0${text}`;
    if (textWidths.has(key)) return textWidths.get(key);
    if (!ctx) return String(text).length*fontPx;
    ctx.font=fontCss(fontPx,settings.fontFamily);
    const width=Math.max(...String(text).split('\n').map(line=>ctx.measureText(line).width),0);
    if (textWidths.size>9000) textWidths.clear();
    textWidths.set(key,width);
    return width;
  }
  function spriteFor(text,fontPx,color,centered=false) {
    if(typeof ctx?.drawImage !== 'function') return null;
    const key=`${fontPx}\0${settings.lineSpacing}\0${settings.fontFamily}\0${settings.outlineEnabled}\0${settings.outlineStrength}\0${settings.outlineOpacity}\0${color}\0${centered?"center":"left"}\0${text}`;
    let cached=spriteCache.get(key);
    if (cached) {spriteCache.delete(key);spriteCache.set(key,cached);return cached;}
    const lines=String(text).split('\n');
    const baseLineHeight=Math.ceil(fontPx*1.22+4);
    const lineHeight=lineStepFor(fontPx,settings.lineSpacing);
    const pad=Math.ceil(outlineWidthFor(fontPx,settings.outlineEnabled,settings.outlineStrength)/2+5);
    const width=Math.ceil(textWidth(text,fontPx))+pad*2;
    const height=lineHeight*(lines.length-1)+baseLineHeight+pad*2;
    const bytes=width*height*4;
    // Extremely long comments are drawn directly to prevent huge GPU buffers.
    if(width>4096 || height>1500 || bytes>MAX_SPRITE_BYTES/2) return null;
    const surface=document.createElement('canvas');
    surface.width=Math.max(1,width);surface.height=Math.max(1,height);
    const ink=surface.getContext('2d',{alpha:true});
    if(!ink)return null;
    ink.font=fontCss(fontPx,settings.fontFamily);
    ink.textBaseline='middle';ink.textAlign=centered?'center':'left';ink.lineJoin='round';
    ink.lineWidth=outlineWidthFor(fontPx,settings.outlineEnabled,settings.outlineStrength);ink.strokeStyle=`rgba(0,0,0,${settings.outlineOpacity})`;ink.fillStyle=color;
    lines.forEach((line,i)=>{
      const y=pad+lineHeight*i+baseLineHeight*.5;
      const px=centered?width/2:pad;if(settings.outlineEnabled)ink.strokeText(line,px,y);ink.fillText(line,px,y);
    });
    cached={surface,width,height,pad,bytes};
    while(spriteCache.size>=MAX_SPRITES || spriteBytes+bytes>MAX_SPRITE_BYTES) {
      const oldKey=spriteCache.keys().next().value;
      if(oldKey===undefined) break;
      spriteBytes-=spriteCache.get(oldKey).bytes;spriteCache.delete(oldKey);
    }
    spriteCache.set(key,cached);spriteBytes+=bytes;
    return cached;
  }

  function rebuildSchedule(force=false) {
    const m=metrics();
    const duration=currentVideo?.duration;
    if (!ctx || m.w<1) return;
    if(workerBuild(force))return;
    const eligible=[];
    for(const record of records) {
      if(settings.hideReplies && record.isReply) continue;
      const translated=settings.translateComments?translationCache.get(translationKey(record.originalText)):null;
      const rawDisplay=translated||record.originalText;
      const display=settings.hideTimestamps?hideTimestamps(rawDisplay):rawDisplay;
      const prepared=prepareText(display,settings.preserveLineBreaks,0);
      const sourceLineCount=record.originalText.split('\n').length;
      if(settings.hideFromLines>0 && sourceLineCount>=settings.hideFromLines)continue;
      if(!prepared) continue;
      const font=effectiveFontSize(m.fontsize,prepared.lineCount,m.h,settings.autoShrink);
      eligible.push({...record,...prepared,sourceLineCount,scheduleText:record.originalText,fontsize:font,
        speedFactor:speedFactor(record.id,settings.speedMode)});
    }
    const travelFor=record=>scrollTravelSeconds(textWidth(record.text,record.fontsize||m.fontsize),m.w,settings.speed*record.speedFactor);
    const timestampLeadFor=record=>timestampHeadLeadSeconds(
      textWidth(record.text,record.fontsize||m.fontsize),m.w,
      settings.speed*record.speedFactor,duration,.6);
    const schedule=buildSchedule(eligible,duration,settings.density,
      {travelFor,timestampLeadFor,selectionOrder:settings.selectionOrder});
    untimed=schedule.generic;
    const features=selectFeatured(schedule.events,settings.featuredPercent);
    const opts={viewportWidth:m.w,lanes:m.lanes,laneStep:m.laneStep,fontsize:m.fontsize,lineSpacing:settings.lineSpacing,outlineEnabled:settings.outlineEnabled,outlineStrength:settings.outlineStrength,duration,speed:settings.speed,
      measureText:(text,font)=>textWidth(text,font||m.fontsize),finishMargin:.6,gap:Math.max(24,m.fontsize),halfLineOverlap:settings.halfLineOverlap};
    const mediaTime=currentVideo?.currentTime || 0;
    // Pin already-started comments before deciding where future ones go.
    const displayById=new Map(eligible.map(item=>[String(item.id),item]));
    const refreshPinned=(tracks,center=false)=>tracks.filter(item=>item.time<=mediaTime+1.2)
      .map(item=>{
        const fresh=displayById.get(String(item.id));
        if(!fresh||fresh.text===item.text)return item;
        const font=center?Math.ceil(fresh.fontsize*1.5):fresh.fontsize;
        const width=Math.ceil(textWidth(fresh.text,font));
        const end=center?item.end:item.time+(m.w+18+width)/item.velocity;
        return {...item,text:fresh.text,fontSize:font,fontsize:font,width,end,
          bottom:item.top+textHeightFor(font,fresh.lineCount,settings.lineSpacing,
            settings.outlineEnabled,settings.outlineStrength)};
      });
    const pinnedCenter=!force && lastRebuildAt?refreshPinned(centerTracks,true):[];
    const pinnedScroll=!force && lastRebuildAt?refreshPinned(renderTracks):[];
    const pinnedIds=new Set([...pinnedCenter,...pinnedScroll].map(item=>String(item.id)));
    const featuredEvents=schedule.events.filter(event=>features.has(String(event.id)) &&
      !shouldScrollFeatured(event,settings.featuredScrollFromLines) && !pinnedIds.has(String(event.id)))
      .filter(event=>force || !lastRebuildAt || event.time>mediaTime+1.2)
      .sort((a,b)=>a.time-b.time);
    // Decide central placement first. Failed central candidates fall back to
    // scrolling; neither the line threshold nor a full bottom stack hides them.
    centerTracks=planFeatured(featuredEvents,{fixedTracks:pinnedCenter,viewportHeight:m.h,
      viewportWidth:m.w,duration,fontsize:m.fontsize,measureText:textWidth,gap:5,lineSpacing:settings.lineSpacing}).tracks;
    const centeredIds=new Set(centerTracks.map(item=>String(item.id)));
    const scrollingEvents=schedule.events.filter(event=>!centeredIds.has(String(event.id)));
    // Retain started scrolling comments during incremental YCS updates.
    const layout=!force && lastRebuildAt && renderTracks.length && Number.isFinite(duration)
      ? mergeStableTracks(pinnedScroll,scrollingEvents,opts,mediaTime,1.2)
      : planTracks(scrollingEvents,opts);
    renderTracks=layout.tracks;
    maxTravel=layout.maxTravel;
    selectedCount=renderTracks.length+centerTracks.length+untimed.length;
    droppedCount=Math.max(0,records.length-selectedCount);
    lastRebuildAt=globalThis.performance?.now?.() ?? Date.now();invalidated=true;
    if(force) {textWidths.clear();clearSprites();}
    notifyStatus();
  }

  function observeDom() {
    if (domObserver) domObserver.disconnect();
    domObserver = new MutationObserver(() => {
      if (scanTimeout) return;
      scanTimeout = setTimeout(() => {scanTimeout = null; scanDom();}, 700);
    });
    // Only scan the comment region; reacting to the whole video player is expensive.
    const commentRoot = document.querySelector("ytd-comments#comments, #comments ytd-item-section-renderer, ytd-comments");
    if (commentRoot) domObserver.observe(commentRoot, {childList: true, subtree: true});
  }

  function scanDom() {
    if (!videoId || !settings.enabled || (sources.has('ycs') && records.length>500)) return;
    const root = document.querySelector("ytd-comments#comments, ytd-comments, #comments");
    if (!root) return;
    const candidates = root.querySelectorAll("ytd-comment-view-model, ytd-comment-renderer");
    const items = [];
    for (const element of Array.from(candidates).slice(0, 250)) {
      const content = element.querySelector("#content-text, yt-attributed-string#content-text, #content yt-attributed-string, #content span.yt-core-attributed-string");
      const text = readText(content);
      if (text) {
        const votes = element.querySelector("#vote-count-middle, #vote-count-left, .yt-spec-button-shape-next__button-text-content");
        const likes = parseLikeCount(votes?.getAttribute("aria-label") || votes?.textContent);
        const publishedText=element.querySelector('#published-time-text, .published-time-text')?.textContent||'';
        items.push({text, id: element.getAttribute("id") || text, likes,
          publishedAt:parsePublishedAt(publishedText),
          isReply:Boolean(element.closest('ytd-comment-replies-renderer, #replies'))});
      }
    }
    if (items.length) addComments(items, "dom");
    if (!domObserver) observeDom();
  }

  function findPlayerVideo() {
    const videos = Array.from(document.querySelectorAll("video.html5-main-video, video"));
    const candidates = videos.filter(v => v.closest(".html5-video-player") && v.getBoundingClientRect().width > 100);
    if (!candidates.length) return null;
    return candidates.find(v => !v.paused && !v.ended) || candidates.find(v => v.closest("ytd-reel-video-renderer[is-active]")) || candidates[0];
  }

  function bindPlayer() {
    const video = findPlayerVideo();
    if (!video) return;
    const player = video.closest(".html5-video-player");
    if (!player) return;
    if (currentVideo === video && stage === player && canvas?.isConnected) {
      ensurePlayerControls();
      return;
    }
    if (canvas) canvas.remove();
    if (webgl){webgl.destroy();webgl=null;}
    destroyPlayerControls();
    if (stageResize) stageResize.disconnect();
    currentVideo = video;
    stage = player;
    canvas = document.createElement("canvas");
    canvas.id = "yt-danmu-lite-canvas";
    Object.assign(canvas.style, {
      position:"absolute", inset:"0", width:"100%", height:"100%",
      pointerEvents:"none", zIndex:"30", display:"block", userSelect:"none"
    });
    stage.appendChild(canvas);
    setupRenderer();
    stageResize = new ResizeObserver(resize);
    stageResize.observe(stage);
    liveTracks = [];
    invalidated=true;
    lastVideoTime = null;
    nextGenericAt = null;
    video.addEventListener("loadedmetadata", () => queueRebuild(true), {once: true});
    video.addEventListener("seeking", () => {
      if (currentVideo !== video) return;
      // Recorded comments immediately reappear at the new media time.
      // Live events aren't part of the recorded timeline, so discard them.
      liveTracks = [];
      lastVideoTime = null;
      nextGenericAt = null;
      invalidated = true;
    });
    video.addEventListener('seeked', () => {
      if(currentVideo!==video)return;
      const t=Number(video.currentTime)||0;
      // Request fresh window data even when the desired seek target is inside
      // a previously advertised window. A prior streaming batch may have
      // changed the plan while the user was seeking.
      if(schedulerReady&&schedulerHealthy&&records.length){
        if(t<schedulerWindowFrom||t>schedulerWindowUntil){
          renderTracks=[];centerTracks=[];
        }
        workerBuild(false);
      }
      invalidated=true;
    });
    resize();
    rebuildSchedule(true);
    ensurePlayerControls();
  }

  // Both a failed WebGL initialization and an explicit engine change require
  // a fresh canvas: browsers cannot switch a used WebGL canvas into 2D mode.
  function replaceRendererCanvas(){
    const old=canvas, replacement=document.createElement('canvas');
    replacement.id=old.id;
    if(old.style.cssText)replacement.style.cssText=old.style.cssText;
    else Object.assign(replacement.style,old.style);
    old.remove();
    stage.appendChild(replacement);
    canvas=replacement;
  }

  function setupRenderer(){
    if(!canvas)return;
    rendererName='canvas';webgl=null;
    if(!glDisabledForSession&&settings.rendererMode!=='canvas'&&typeof globalThis.KomeMakuGL==='function'){
      try{
        webgl=new globalThis.KomeMakuGL(canvas,{pixelRatio:Math.min(window.devicePixelRatio||1,1.5)});
        rendererName='webgl2';
        canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();settings.rendererMode='canvas';switchRenderer();},{once:true});
      }catch(error){
        console.warn('[KomeMaku] Canvas 2D fallback:',error?.message||error);
        // A WebGL context that failed after allocation cannot be reused as 2D.
        replaceRendererCanvas();
      }
    }
    if(webgl){
      if(!measureContext){
        const surface=typeof OffscreenCanvas==='function'?new OffscreenCanvas(2,2):document.createElement('canvas');
        measureContext=surface.getContext('2d',{alpha:true});
      }
      ctx=measureContext;
    }else ctx=canvas.getContext('2d',{alpha:true});
    clearSprites();invalidated=true;
  }
  function switchRenderer(){
    if(!stage||!canvas)return;
    if(webgl){webgl.destroy();webgl=null;}
    replaceRendererCanvas();
    setupRenderer();resize();queueRebuild(true);
  }
  function resize() {
    if (!stage || !canvas || !ctx) return;
    const width = Math.max(stage.clientWidth, 0);
    const height = Math.max(stage.clientHeight, 0);
    if (!width || !height) return;
    // A 4K canvas with 38px outlines is extremely costly on integrated GPUs.
    // Cap backing pixel area and DPI while preserving CSS-sized coordinates.
    const requested=Math.min(window.devicePixelRatio || 1, settings.fontSize>=30?1.15:1.5);
    const ratio=Math.max(0.75,Math.min(requested,Math.sqrt(3200000/(width*height))));
    const newW = Math.round(width * ratio), newH = Math.round(height * ratio);
    const changed = canvas.width !== newW || canvas.height !== newH;
    if (changed) {
      canvas.width = newW; canvas.height = newH;
    }
    if(webgl){
      const glyphRatio=Math.max(1,ratio);
      if(Math.abs(webgl.pixelRatio-glyphRatio)>.08){webgl.pixelRatio=glyphRatio;webgl.clearCache();}
      webgl.resize(width,height);
    }
    else ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (changed && records.length) queueRebuild(true);
    invalidated=true;
  }

  function metrics() {
    const w = stage?.clientWidth || 0, h = stage?.clientHeight || 0;
    const fontsize = Math.max(12, Math.round(settings.fontSize * fontScaleForViewport(w,h,settings.autoFontScale)));
    const lineHeight = Math.ceil((fontsize + 11)*settings.lineSpacing);
    // Normal lanes are even indices, and odd indices are only used as
    // a crowded-screen Niconico-style half-row fallback.
    const laneStep = settings.halfLineOverlap ? Math.max(9,Math.round(lineHeight*.5)) : lineHeight;
    const totalLanes = Math.max(1, Math.min(40, Math.floor(h * .77 / laneStep)));
    // Reserve a little space for real-time chat without covering comments.
    const lanes = Math.max(1, Math.floor(totalLanes * .85));
    return {w, h, fontsize, lineHeight, laneStep, lanes, totalLanes};
  }

  function effectiveFontSize(base,lines,height,enabled) {
    if(!enabled || lines<=2)return base;
    // Minimize tall comments but retain legibility (never below 12 CSS px).
    const fits=Math.max(12,Math.floor((height*.36)/(1+(lines-1)*settings.lineSpacing)/1.25));
    const densityFactor=Math.max(.64,1-Math.max(0,lines-3)*.07);
    return Math.max(12,Math.min(base,Math.round(base*densityFactor),fits));
  }
  function emitLive(record) {
    if (!record?.text || !ctx || !currentVideo || !stage) return;
    const m = metrics();
    if (m.w < 130 || m.h < 80) return;
    const t = currentVideo.currentTime;
    if (!Number.isFinite(t)) return;
    const offset = m.totalLanes > m.lanes ? m.lanes : 0;
    const count = offset ? m.totalLanes - offset : m.lanes;
    const buckets = Array.from({length:count}, () => []);
    for (const track of liveTracks) {
      if (track.end > t && track.lane < count) buckets[track.lane].push(track);
    }
    ctx.font = fontCss(m.fontsize,settings.fontFamily);
    const id = String(record.id || `live:${record.text}:${liveCount}`);
    const track = createTrack({...record,id,time:t,speedFactor:speedFactor(id,settings.speedMode)}, {
      viewportWidth:m.w, lanes:count,laneStep:m.laneStep,fontsize:m.fontsize,lineSpacing:settings.lineSpacing,outlineEnabled:settings.outlineEnabled,outlineStrength:settings.outlineStrength,speed:settings.speed,
      duration:currentVideo.duration, finishMargin:.6,
      measureText:text => ctx.measureText(text).width,
      gap: Math.max(24, m.fontsize),halfLineOverlap:settings.halfLineOverlap
    }, buckets);
    // For live comments, only short delays are acceptable: otherwise ignore.
    if (track && track.time <= t + 2) liveTracks.push({...track, offset});
  }

  function drawComment(item,t,m,isCenter=false) {
    const size=item.fontsize||m.fontsize;
    const color=commentColor(item.id,settings.colorMode,settings.color);
    const x=isCenter?(m.w-item.width)/2:trackX(item,t,m.w);
    const baseLineHeight=Math.ceil(size*1.22+4);
    const lineHeight=lineStepFor(size,settings.lineSpacing);
    const count=String(item.text).split('\n').length;
    const h=lineHeight*(count-1)+baseLineHeight;
    const pad=Math.ceil(Math.max(3,size/7)+3);
    // Align the visible glyph baseline near the physical bottom edge rather
    // than reserving a large (13%) unused margin below Niconico-style text.
    const y=isCenter?Math.max(0,m.h-2-(item.bottomOffset||0)-h+(baseLineHeight-size)/2)
      :8+(item.offset||0)*m.laneStep+item.lane*m.laneStep;
    if(webgl){webgl.drawText(item.text,x,y,size,color,isCenter,settings.lineSpacing,{fontFamily:settings.fontFamily,outlineEnabled:settings.outlineEnabled,outlineStrength:settings.outlineStrength,outlineOpacity:settings.outlineOpacity});return;}
    const sprite=spriteFor(item.text,size,color,isCenter);
    if(sprite) {
      ctx.drawImage(sprite.surface,Math.round(x-sprite.pad),Math.round(y-sprite.pad));
    } else {
      ctx.font=fontCss(size,settings.fontFamily);
      ctx.textBaseline='middle';ctx.textAlign=isCenter?'center':'left';ctx.strokeStyle=`rgba(0,0,0,${settings.outlineOpacity})`;
      ctx.lineWidth=outlineWidthFor(size,settings.outlineEnabled,settings.outlineStrength);ctx.fillStyle=color;
      String(item.text).split('\n').forEach((line,i)=>{
        const yy=y+lineHeight*i+baseLineHeight*.5;
        const px=isCenter?m.w/2:x;if(settings.outlineEnabled)ctx.strokeText(line,px,yy);ctx.fillText(line,px,yy);
      });
    }
  }
  function tick(timestamp) {
    requestAnimationFrame(tick);
    if (!stage || !canvas || !ctx || !currentVideo?.isConnected) return;
    if(document.visibilityState==='hidden') return;
    const pacing=paceFrame(timestamp,nextPaintAt,settings.fpsLimit||autoFps,invalidated);
    if(!pacing.draw)return;
    nextPaintAt=pacing.nextAt;
    const m=metrics();
    if (m.w<1 || m.h<1) return;
    const t=currentVideo.currentTime;
    if(!Number.isFinite(t)) return;
    if(schedulerReady&&schedulerHealthy&&!schedulerPending&&records.length&&
      (t>schedulerWindowUntil-22||t<schedulerWindowFrom-2))workerBuild(false);
    const paintStart=globalThis.performance?.now?.()??timestamp;
    // Don't keep redrawing identical paused video frames.
    if(!invalidated && t===lastPaintTime) return;
    const ad=Boolean(stage.classList.contains('ad-showing') || stage.querySelector('.ytp-ad-player-overlay'));
    if (!settings.enabled || ad) {
      if(webgl)webgl.clear();else ctx.clearRect(0,0,m.w,m.h);
      invalidated=false;lastPaintTime=t;lastRenderedAt=timestamp;return;
    }
    if (lastVideoTime!==null && (t<lastVideoTime-.15 || t-lastVideoTime>3)) {
      liveTracks=[];nextGenericAt=null;
    }
    lastVideoTime=t;
    if (!currentVideo.paused && !currentVideo.ended && untimed.length && !Number.isFinite(currentVideo.duration)) {
      if (nextGenericAt===null) nextGenericAt=t;
      const interval=settings.density>=11?.12:Math.max(.55,6/settings.density);
      if (t>=nextGenericAt) {
        emitLive(untimed[genericCursor++%untimed.length]);
        nextGenericAt=t+interval;
      }
    }
    liveTracks=liveTracks.filter(item=>t<item.end && t>=item.time-3);
    scheduleTranslations(t);
    const visible=visibleTracks(renderTracks,t,maxTravel);
    if(webgl)webgl.begin(settings.opacity);
    else {ctx.clearRect(0,0,m.w,m.h);ctx.save();ctx.globalAlpha=settings.opacity;}
    for(const item of visible) drawComment(item,t,m);
    for(const item of liveTracks) if(t>=item.time&&t<item.end) drawComment(item,t,m);
    for(const item of centerTracks) {
      if(item.time>t) break;
      if(t<item.end) drawComment(item,t,m,true);
    }
    if(webgl){
      webgl.end();
      if(webgl.missingGlyphs>0){
        // Do not silently drop characters when the GPU atlas fills up. Use
        // Canvas 2D for the rest of this session and permit manual retry.
        console.warn('[KomeMaku] WebGL2 atlas full; falling back to Canvas 2D');
        glDisabledForSession=true;
        switchRenderer();
        return;
      }
    }else ctx.restore();
    const elapsed=(globalThis.performance?.now?.()??timestamp)-paintStart;
    animationCost=animationCost?animationCost*.88+elapsed*.12:elapsed;
    if(settings.fpsLimit===0&&timestamp-autoFpsCheck>2500){
      autoFps=animationCost>24?15:animationCost>14?24:animationCost>9?30:60;
      autoFpsCheck=timestamp;
    }
    invalidated=false;lastRenderedAt=timestamp;lastPaintTime=t;
  }

  // A native-looking control inside the YouTube player, with an absolute
  // settings popover. Nothing is inserted into the page's flow/layout.
  const fields = [
    ['enabled','checkbox'], ['fontSize','range',14,38,1], ['fontFamily','select',['system','gothic','mincho','rounded','monospace']], ['autoFontScale','checkbox'], ['outlineEnabled','checkbox'], ['outlineStrength','range',0.25,2.5,0.25], ['outlineOpacity','range',0,1,0.01], ['lineSpacing','range',0.7,2,0.05], ['speed','range',0.5,2,0.1],
    ['density','range',1,11,1], ['opacity','range',0.2,1,0.05],
    ['rendererMode','select',['auto','webgl2','canvas']],
    ['fpsLimit','select',['0','15','24','30','45','60','120']],
    ['selectionOrder','select',['popular','newest']],
    ['colorMode','select',['single','random']], ['color','color'],
    ['speedMode','select',['fixed','random']], ['hideReplies','checkbox'],
    ['preserveLineBreaks','checkbox'], ['hideFromLines','range',0,10,1],
    ['featuredPercent','range',0,30,1],['featuredScrollFromLines','range',0,10,1],
    ['translateComments','checkbox'],['translateLanguage','select',['ja','en','zh-CN','zh-TW','ko','es','fr','de']],
    ['autoShrink','checkbox'],['halfLineOverlap','checkbox'],['hideTimestamps','checkbox'],
    ['language','select',['auto','ja','en','zh-CN','zh-TW']]
  ];
  const iconMarkup = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v2H4zm0 5h12v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>';
  function destroyPlayerControls() {
    if (playerButton) playerButton.remove();
    if (playerPanel) playerPanel.remove();
    playerButton = null; playerPanel = null; panelIsOpen = false;
  }
  function formatValue(key,value) {
    if (key === 'fontSize') return `${value}px`;
    if (key === 'lineSpacing' || key === 'outlineStrength' || key === 'outlineOpacity') return `${Math.round(value*100)}%`;
    if (key === 'speed') return `${Number(value).toFixed(1)}×`;
    if (key === 'density') return Number(value)===11?t('unlimited'):`${value}/10`;
    if (key === 'opacity') return `${Math.round(Number(value)*100)}%`;
    if (key === 'featuredPercent') return `${value}%`;
    if (key === 'hideFromLines' || key === 'featuredScrollFromLines') return Number(value)===0?t('unlimited'):`${value}${t('linesOrMore')}`;
    return String(value);
  }
  function chooseLabel(key,value) {
    if (key === 'fontFamily') return value.startsWith('local:')?value.slice(6):t('font'+value[0].toUpperCase()+value.slice(1));
    if (key === 'selectionOrder') return t(value==='newest'?'selectionNewest':'selectionPopular');
    if (key === 'rendererMode') return value==='auto'?t('rendererAuto'):value==='webgl2'?'WebGL2':'Canvas 2D';
    if (key === 'fpsLimit') return Number(value)===0?t('auto'):`${value} FPS`;
    if (key === 'colorMode') return t(value === 'single' ? 'colorSingle':'colorRandom');
    if (key === 'speedMode') return t(value === 'fixed' ? 'speedFixed':'speedRandom');
    if (key === 'language') return value === 'auto' ? t('auto') : ({ja:'日本語',en:'English','zh-CN':'简体中文','zh-TW':'繁體中文'}[value] || value);
    if(key==='translateLanguage') return ({ja:'日本語',en:'English','zh-CN':'简体中文','zh-TW':'繁體中文',ko:'한국어',es:'Español',fr:'Français',de:'Deutsch'}[value]||value);
    return value;
  }
  function createPanel() {
    const panel = document.createElement('section');
    panel.className = 'ydl-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label',t('playerPanel'));
    const header = document.createElement('div');
    header.className='ydl-panel-head';
    const heading=document.createElement('span');heading.className='ydl-panel-heading';
    const close=document.createElement('button');close.type='button';close.className='ydl-panel-close';
    close.textContent='×';close.title=t('close');close.setAttribute('aria-label',t('close'));
    close.addEventListener('click',()=>setPanelOpen(false));
    const fullOptions=document.createElement('button');fullOptions.type='button';
    fullOptions.className='ydl-open-options';fullOptions.textContent=t('openOptions');
    fullOptions.addEventListener('click',event=>{
      event.stopPropagation();setPanelOpen(false);
      try{chrome.runtime.sendMessage({type:'YDL_OPEN_OPTIONS'},()=>void chrome.runtime.lastError);}catch{}
    });
    header.append(heading,fullOptions,close);panel.appendChild(header);
    for(const [key,type,min,max,step] of fields) {
      const row=document.createElement('div');row.className='ydl-panel-field';
      const label=document.createElement('label');label.htmlFor=`ydl-player-${key}`;
      label.dataset.ydlLabel=key;
      const input=document.createElement(type==='select'?'select':'input');
      input.id=`ydl-player-${key}`;input.dataset.ydlInput=key;
      if(type==='select') {
        for(const value of min) {const option=document.createElement('option');option.value=value;option.textContent=chooseLabel(key,value);input.appendChild(option);}
      } else {input.type=type;
        if(type==='range') {input.min=String(min);input.max=String(max);input.step=String(step);}
      }
      row.appendChild(label);
      if(type==='range') {
        const output=document.createElement('output');output.dataset.ydlOutput=key;
        row.appendChild(output);panel.append(row,input);
      } else {row.appendChild(input);panel.appendChild(row);}
      // Stop shortcuts/playback from reacting to slider and dropdown input.
      input.addEventListener(type==='checkbox'||type==='select'||type==='color'?'change':'input',()=>{
        const value=type==='checkbox'?input.checked:(type==='range'||key==='fpsLimit')?Number(input.value):input.value;
        chrome.storage.local.set({[key]:value});
      });
    }
    panel.addEventListener('click',event=>event.stopPropagation());
    panel.addEventListener('keydown',event=>{
      if(event.key==='Escape') {event.stopPropagation();setPanelOpen(false);playerButton?.focus();}
      else if(event.target?.matches?.('input, select')) event.stopPropagation();
    });
    return panel;
  }
  function setPanelOpen(open) {
    panelIsOpen=!!open;
    playerPanel?.classList.toggle('ydl-open',panelIsOpen);
    playerButton?.setAttribute('aria-expanded',String(panelIsOpen));
  }
  function ensurePlayerControls() {
    if (!stage || !stage.isConnected || typeof document.createElement('button').setAttribute !== 'function') return;
    const controls=stage.querySelector('.ytp-right-controls') || stage.querySelector('.ytp-left-controls');
    if (playerButton && playerButton.isConnected && playerPanel?.isConnected) {
      if ((!controls && playerButton.parentElement===stage) || (controls && playerButton.parentElement===controls)) return;
    }
    destroyPlayerControls();
    const button=document.createElement('button');
    button.type='button';button.className=controls?'ytp-button ydl-control-button':'ydl-floating-toggle';
    button.innerHTML=iconMarkup;button.setAttribute('aria-haspopup','dialog');
    button.addEventListener('click',event=>{event.stopPropagation();setPanelOpen(!panelIsOpen);});
    const panel=createPanel();
    if(controls) controls.prepend(button); else stage.appendChild(button);
    stage.appendChild(panel);
    playerButton=button;playerPanel=panel;
    updatePlayerControls();
  }
  function updatePlayerControls() {
    if (!playerButton || !playerPanel) return;
    playerButton.title=t(settings.enabled?'playerButton':'playerButtonDisabled');
    playerButton.setAttribute('aria-label',playerButton.title);
    playerButton.setAttribute('aria-pressed',String(settings.enabled));
    playerPanel.setAttribute('aria-label',t('playerPanel'));
    playerPanel.querySelector('.ydl-panel-heading').textContent=t('playerPanel');
    const fullOptions=playerPanel.querySelector('.ydl-open-options');
    if(fullOptions)fullOptions.textContent=t('openOptions');
    const close=playerPanel.querySelector('.ydl-panel-close');
    close.title=t('close');close.setAttribute('aria-label',t('close'));
    for(const [key,type] of fields) {
      const input=playerPanel.querySelector(`[data-ydl-input="${key}"]`);
      const label=playerPanel.querySelector(`[data-ydl-label="${key}"]`);
      if (!input) continue;
      label.textContent=t(key);
      if(type==='checkbox') input.checked=settings[key];
      else input.value=settings[key];
      if(type==='select') {
        if(key==='fontFamily' && String(settings.fontFamily).startsWith('local:') &&
           !Array.from(input.options).some(o=>o.value===settings.fontFamily)) {
          const option=document.createElement('option');option.value=settings.fontFamily;input.appendChild(option);
        }
        Array.from(input.options).forEach(o=>o.textContent=chooseLabel(key,o.value));
      }
      const output=playerPanel.querySelector(`[data-ydl-output="${key}"]`);
      if(output) output.textContent=formatValue(key,settings[key]);
    }
    const colorInput=playerPanel.querySelector('[data-ydl-input="color"]');
    if(colorInput) colorInput.disabled=settings.colorMode==='random';
  }
  document.addEventListener('pointerdown', event=>{
    if(panelIsOpen && !playerPanel?.contains(event.target) && !playerButton?.contains(event.target)) setPanelOpen(false);
  },true);

  function updateRoute() {
    const id = videoIdFromUrl();
    if (location.href !== lastUrl) lastUrl = location.href;
    if (id !== videoId) {
      newVideo(id);
      if (domObserver) {domObserver.disconnect(); domObserver = null;}
    }
    if (id) {bindPlayer();startScheduler();}
    else if (currentVideo || canvas) {
      destroyPlayerControls();
      if (canvas) canvas.remove();
      if (stageResize) stageResize.disconnect();
      if(webgl){webgl.destroy();webgl=null;}
      currentVideo = null; stage = null; canvas = null; ctx = null;
    }
  }

  function readBridgeDetail(e) {
    try { return typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail; }
    catch { return null; }
  }
  window.addEventListener("ydl:batch", (e) => {
    const data = readBridgeDetail(e);
    if (data?.id !== bridgeRequest || data?.videoId !== videoId) return;
    addComments(data.comments,"api");
  });
  window.addEventListener("ydl:ycs-batch", e => {
    const data = readBridgeDetail(e);
    if (data?.videoId !== videoId) return;
    addComments(data.comments, "ycs");
  });
  window.addEventListener("ydl:status", (e) => {
    const data = readBridgeDetail(e);
    if (data?.id !== bridgeRequest || data?.videoId !== videoId) return;
    if(!records.length){
      commentStatus=String(data.status).slice(0,120);
      commentStatusCode=/失敗|取得できません/.test(commentStatus)?'error'
        :/トークンがありません/.test(commentStatus)?'noToken'
        :/API取得:\s*0件/.test(commentStatus)?'empty':'loading';
      notifyStatus();
    }
  });
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === "YDL_IMPORT_BATCH") {
      if (!videoId || msg.videoId !== videoId || !Array.isArray(msg.comments)) {
        reply({ok:false,reason:"動画IDが一致しません"}); return;
      }
      addComments(msg.comments,"ycs-import");
      reply({ok:true,count:records.length});
    } else if (msg?.type === "YDL_GET_STATUS") {
      reply(currentStatus());
    } else if (msg?.type === "YDL_CHAT_EVENT" && msg.text && videoId) {
      const isLive = !!document.querySelector("ytd-live-chat-frame, #chat iframe, ytd-live-chat-frame iframe");
      // A replay iframe can point to the same video, or be missing a videoId.
      if (msg.videoId && msg.videoId !== videoId) return;
      if (!isLive && !/\/live\//.test(location.pathname)) return;
      const id = normalizeText(msg.id, 160) || `${Date.now()}-${Math.random()}`;
      if (liveSeen.has(id)) return;
      liveSeen.add(id);
      liveSeenOrder.push(id);
      if (liveSeenOrder.length > 800) liveSeen.delete(liveSeenOrder.shift());
      liveCount++;
      sources.add("live");
      commentStatus = `${records.length + liveCount}件のコメントを取得`;
      if (settings.enabled && currentVideo && !currentVideo.paused) emitLive({id,text:normalizeText(msg.text)});
      invalidated=true;
    }
  });

  chrome.storage.local.get(DEFAULTS, stored => {
    for (const [key, value] of Object.entries(stored)) {
      if (key in settings && typeof value === typeof DEFAULTS[key]) settings[key] = value;
    }
    updateRoute();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, obj] of Object.entries(changes)) {
      if (key in settings && typeof obj.newValue === typeof DEFAULTS[key]) settings[key] = obj.newValue;
    }
    if (!settings.enabled) liveTracks = [];
    if(changes.rendererMode){glDisabledForSession=false;switchRenderer();}
    if(changes.fpsLimit)nextPaintAt=0;
    if (changes.fontSize || changes.autoFontScale) resize();
    if (changes.fontSize || changes.fontFamily || changes.outlineEnabled || changes.outlineStrength || changes.outlineOpacity || changes.lineSpacing || changes.preserveLineBreaks || changes.translateComments || changes.translateLanguage || changes.autoShrink || changes.hideTimestamps ||
        (!webgl && (changes.color || changes.colorMode))) clearSprites();
    if(changes.translateLanguage || changes.translateComments) resetTranslationSession();
    if (changes.fontSize || changes.fontFamily || changes.preserveLineBreaks || changes.hideTimestamps) textWidths.clear();
    if ((changes.selectionOrder || changes.density || changes.fontSize || changes.autoFontScale || changes.fontFamily || changes.outlineEnabled || changes.outlineStrength || changes.outlineOpacity || changes.lineSpacing || changes.speed || changes.speedMode || changes.hideReplies || changes.preserveLineBreaks || changes.hideFromLines || changes.featuredPercent || changes.featuredScrollFromLines || changes.translateComments || changes.translateLanguage || changes.autoShrink || changes.halfLineOverlap || changes.hideTimestamps) && records.length) queueRebuild(true);
    invalidated=true;
    updatePlayerControls();
    if (settings.enabled) {
      scanDom();
      if (videoId && !records.length) requestComments();
    }
  });
  document.addEventListener("yt-navigate-finish", updateRoute);
  document.addEventListener("yt-page-data-updated", updateRoute);
  window.addEventListener("popstate", updateRoute);
  setInterval(() => {
    updateRoute();
    scanDom();
    if (videoId && records.length === 0 && bridgeRetries < 4 && bridgeRetries > 0) requestComments();
  }, 2600);
  updateRoute();
  requestAnimationFrame(tick);
})();
