(() => {
  "use strict";
  const timePattern = /(^|[^\d:])((?:\d{1,2}:)?\d{1,2}:\d{2})(?!\d)/g;
  function normalizeText(value, limit = 150) {
    return typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
      : "";
  }
  // Keep source line boundaries to make filters reversible when toggled.
  function cleanOriginalText(value, limit = 700) {
    if (typeof value !== 'string') return '';
    return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
      .split('\n').map(line => line.replace(/ {2,}/g, ' ').trim()).join('\n')
      .replace(/\n{4,}/g, '\n\n\n').trim().slice(0,limit);
  }
  // Hide recognizable playback timestamps from the displayed text, while
  // retaining the untouched source for timestamp-based scheduling.
  function hideTimestamps(text) {
    if (typeof text !== 'string') return '';
    return text.replace(timePattern, (match, prefix, token) => {
      const parts = token.split(':').map(Number);
      if (parts.some(p => !Number.isFinite(p)) || parts.at(-1) >= 60 ||
          (parts.length === 3 && parts[1] >= 60)) return match;
      return prefix;
    }).replace(/[^\S\n]{2,}/g, ' ').split('\n').map(line => line.trim()).join('\n').trim();
  }
  function lineStepFor(size,spacing=1) {
    const factor=Number.isFinite(spacing)?Math.max(.7,Math.min(2,spacing)):1;
    return Math.max(1,Math.ceil(Math.ceil(size*1.22+4)*factor));
  }
  function lineCount(text) { return String(text || '').split('\n').length; }
  function prepareText(original, preserveLineBreaks=false, hideFromLines=0) {
    const source=cleanOriginalText(original);
    if (!source || (hideFromLines > 0 && lineCount(source) >= hideFromLines)) return null;
    return {text:preserveLineBreaks?source:source.replace(/\s*\n\s*/g,' '),
      lineCount:preserveLineBreaks?lineCount(source):1};
  }
  function selectFeatured(events, percent) {
    if (!(percent > 0) || !events.length) return new Set();
    const count=Math.ceil(events.length*Math.min(100,percent)/100);
    return new Set(events.filter(c => parseLikeCount(c.likes)>0).sort(likeRank).slice(0,count).map(c=>String(c.id)));
  }
  // Keep the ranking percentage unchanged, but display long featured comments
  // using regular scrolling lanes. Match the existing line filter: original
  // source line count, even if line breaks are collapsed for rendering.
  function shouldScrollFeatured(event, fromLines=0) {
    const threshold=Math.floor(Number(fromLines)||0);
    if(threshold<=0)return false;
    const originalLines=Number(event.sourceLineCount) || lineCount(event.originalText || event.scheduleText || event.text);
    return originalLines>=threshold;
  }
  // Prevent YCS incremental loads from teleporting already-started text.
  // Existing tracks at/before the media-time fence remain immutable.
  function mergeStableTracks(previous, candidates, opts, currentTime, fence=1) {
    const cutoff=Math.max(0,Number(currentTime)||0)+Math.max(0,fence);
    const pinned=previous.filter(item=>item.time<=cutoff && item.displayMode!=='center');
    const pinnedIds=new Set(pinned.map(item=>String(item.id)));
    const pending=candidates.filter(item=>item.time>cutoff && !pinnedIds.has(String(item.id)));
    const layout=planTracks(pending,{...opts,fixedTracks:pinned});
    return {...layout, tracks:[...pinned,...layout.tracks].sort((a,b)=>a.time-b.time||likeRank(a,b)),
      maxTravel:Math.max(layout.maxTravel,...pinned.map(t=>t.end-t.time),0),
      pinnedCount:pinned.length};
  }
  function parseTimes(text, duration) {
    const matches = [];
    if (typeof text !== "string" || !Number.isFinite(duration) || duration <= 0) return matches;
    for (const match of text.matchAll(timePattern)) {
      const parts = match[2].split(":").map(Number);
      const seconds = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
      if (parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) continue;
      if (seconds < duration && !matches.includes(seconds)) matches.push(seconds);
      if (matches.length === 5) break;
    }
    return matches;
  }
  function lowerBound(items, time) {
    let a = 0, b = items.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (items[mid].time < time) a = mid + 1;
      else b = mid;
    }
    return a;
  }
  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  // YouTube/YCS use both numeric counts and localized abbreviated labels.
  function parseLikeCount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (typeof value !== "string") return 0;
    const label = value.normalize("NFKC").replace(/[,，\s]/g, "");
    const match = label.match(/(\d+(?:\.\d+)?)(億|万|千|[kmb])?/i);
    if (!match) return 0;
    const multiplier = {"億":1e8, "万":1e4, "千":1e3, k:1e3, m:1e6, b:1e9}[match[2]?.toLowerCase()] || 1;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(match[1]) * multiplier)));
  }
  function likeRank(a, b) {
    return parseLikeCount(b.likes) - parseLikeCount(a.likes)
      || hash(String(a.id)) - hash(String(b.id))
      || String(a.id).localeCompare(String(b.id));
  }

  // Deterministic per-comment color and speed avoid flicker after seeks,
  // tab restoration or rescheduling. Random mode uses a stable ID hash.
  const PALETTE = Object.freeze(['#ffffff','#ffe08a','#8ceeff','#a7f3d0','#ffb3d0','#d4c1ff','#ffd3a8','#b7d5ff']);
  function commentColor(id, mode='single', base='#ffffff') {
    if (mode !== 'random') return /^#[0-9a-f]{6}$/i.test(base) ? base : '#ffffff';
    return PALETTE[hash('color:'+String(id)) % PALETTE.length];
  }
  function speedFactor(id, mode='fixed') {
    return mode === 'random' ? 0.75 + (hash('speed:'+String(id)) % 501) / 1000 : 1;
  }
  // Newest means publication time, not fetch order or video playback timestamp.
  // Missing/invalid dates go after known dates, with a stable ID tie-breaker.
  function newestRank(a,b) {
    const at=Number.isFinite(a.publishedAt)&&a.publishedAt>0?a.publishedAt:0;
    const bt=Number.isFinite(b.publishedAt)&&b.publishedAt>0?b.publishedAt:0;
    return bt-at || hash(String(a.id))-hash(String(b.id)) || String(a.id).localeCompare(String(b.id));
  }
  function selectForDisplay(items,budget,order='popular') {
    if (!Number.isFinite(budget) || items.length <= budget) return [...items];
    const rank=order==='newest'?newestRank:likeRank;
    return [...items].sort(rank).slice(0,Math.max(0,Math.floor(budget)));
  }
  function selectByLikes(items,budget){return selectForDisplay(items,budget,'popular');}
  // Matches the scrolling distance and velocity used by content.js.
  // The extra pixels are the initial right margin and the off-screen exit margin.
  function scrollTravelSeconds(textWidth, viewportWidth, speedMultiplier = 1) {
    const w = Math.max(1, Number(viewportWidth) || 1);
    const width = Math.max(0, Number(textWidth) || 0);
    const multiplier = Math.max(0.1, Number(speedMultiplier) || 1);
    const pxPerSecond = Math.max(60, (w + Math.min(width, w)) / (9 / multiplier));
    return (w + 18 + width) / pxPerSecond;
  }
  function buildSchedule(records, duration, density, options = {}) {
    const eligible = records.filter(x => x.source !== "live");
    const unlimited = Number(density) >= 11;
    const interval = unlimited ? 0 : Math.max(0.55, 6 / Math.max(1, density));
    const validDuration = Number.isFinite(duration) && duration > 0;
    const finishMargin = Number.isFinite(options.finishMargin)
      ? Math.max(0, options.finishMargin) : 0.6;
    // Content script provides exact canvas-width estimates. The default is useful
    // for unit tests / consumers without a canvas; it is not used for rendering.
    const travelFor = item => {
      const t = typeof options.travelFor === "function" ? options.travelFor(item) : 9;
      return Number.isFinite(t) && t > 0 ? t : 9;
    };
    let budget = unlimited ? Infinity : (validDuration ? Math.max(1, Math.ceil(duration / interval)) : Infinity);
    let selected = selectForDisplay(eligible,budget,options.selectionOrder);
    let lastGenericTime = 0;
    if (validDuration && selected.length) {
      // Reserve time for the *entire* comment to travel beyond the left edge.
      // When that reduces the budget, drop the lowest-liked comments first.
      // Budget only shrinks, preventing oscillations with very long comments.
      for (let pass = 0; pass < (unlimited ? 1 : 8); pass++) {
        let maxTravel = 0;
        for (const item of selected) maxTravel = Math.max(maxTravel, travelFor(item));
        lastGenericTime = Math.max(0, duration - maxTravel - finishMargin);
        if (unlimited) break;
        const adjustedBudget = Math.max(1, Math.floor(lastGenericTime / interval) + 1);
        if (adjustedBudget >= budget) break;
        budget = adjustedBudget;
        selected = selectForDisplay(eligible,budget,options.selectionOrder);
      }
      // Recalculate once more if the last pass removed a long comment.
      let maxTravel = 0;
      for (const item of selected) maxTravel = Math.max(maxTravel, travelFor(item));
      lastGenericTime = Math.max(0, duration - maxTravel - finishMargin);
    }
    const events = [];
    const generic = [];
    for (const item of selected) {
      const times = item.time !== null && item.time !== undefined
        ? (Number.isFinite(item.time) && item.time >= 0 && item.time < duration ? [item.time] : [])
        : parseTimes(item.scheduleText ?? item.text, duration);
      if (times.length) {
        // Timestamped comments also need enough scrolling time. If the
        // timestamp is too close to the end, start a little early instead.
        const latest = validDuration ? Math.max(0, duration - travelFor(item) - finishMargin) : times[0];
        events.push({...item, time:Math.min(times[0], latest),explicitTime:true});
      } else generic.push(item);
    }
    // One non-timestamped occurrence per video play; distribute over the
    // usable runtime instead of placing the final one at video.duration.
    generic.sort((a,b) => hash(String(a.id)) - hash(String(b.id)) || String(a.id).localeCompare(String(b.id)));
    if (validDuration) {
      const gap = generic.length > 1 ? lastGenericTime / (generic.length - 1) : 0;
      for (let i = 0; i < generic.length; i++) events.push({...generic[i], time: i * gap});
    }
    // Group replies near their parent without moving explicit timestamps.
    const parentTimes = new Map(events.filter(e=>!e.isReply).map(e=>[String(e.id),e.time]));
    const replyOrder = new Map();
    for (const e of events) if(e.isReply && !e.explicitTime && e.parentId && parentTimes.has(String(e.parentId)) && e.time != null) {
      const parentId=String(e.parentId);
      const ordinal=replyOrder.get(parentId)||0;
      replyOrder.set(parentId,ordinal+1);
      e.time=Math.min(lastGenericTime||Infinity,parentTimes.get(parentId)+Math.min(12,.55+(ordinal*.85)));
    }
    const collisionRank=options.selectionOrder==='newest'?newestRank:likeRank;
    events.sort((a,b) => a.time - b.time || collisionRank(a,b));
    return {events, generic:validDuration ? [] : generic,
      selectedCount:selected.length, droppedCount:eligible.length-selected.length,
      budget, lastGenericTime};
  }

  // Media-time-driven placement. Both visibility and position are functions of
  // HTMLVideoElement.currentTime; no RAF deltas, playback state or tab focus
  // are used to advance the scrolling text.
  function scrollingSpeed(textWidth, viewportWidth, speedMultiplier = 1, duration = Infinity, finishMargin = 0.6) {
    const width = Math.max(0, Number(textWidth) || 0);
    const w = Math.max(1, Number(viewportWidth) || 1);
    const mult = Math.max(0.1, Number(speedMultiplier) || 1);
    const normal = Math.max(60, (w + Math.min(width, w)) / (9 / mult));
    const usable = Number(duration) - finishMargin;
    return Number.isFinite(usable) && usable > 0
      ? Math.max(normal, (w + 18 + width) / usable)
      : normal;
  }
  function trackEnd(start, width, velocity, viewportWidth) {
    return start + (viewportWidth + 18 + width) / velocity;
  }
  // A faster following comment must not catch the tail of its predecessor.
  // Check separation at entry and, when v2>v1, just before the first one exits.
  function safeFollowingStart(previous, velocity, gap = 28) {
    const entrySafe = previous.time + (previous.width + gap) / previous.velocity;
    if (velocity <= previous.velocity) return Math.min(previous.end, entrySafe);
    const exitSafe = previous.end -
      (previous.velocity * (previous.end - previous.time) - previous.width - gap) / velocity;
    return Math.min(previous.end, Math.max(entrySafe, exitSafe));
  }
  function createTrack(event, opts, laneBuckets) {
    const w = Math.max(1, Number(opts.viewportWidth) || 1);
    const laneCount = Math.max(1, Math.floor(opts.lanes) || 1);
    const width = Math.ceil(Math.max(0, Number(opts.measureText(event.text,event.fontsize)) || 0));
    const duration = Number(opts.duration);
    const margin = Number.isFinite(opts.finishMargin) ? opts.finishMargin : 0.6;
    const velocity = scrollingSpeed(width, w, (opts.speed || 1) * (Number(event.speedFactor) || 1), duration, margin);
    const target = Math.max(0, Number(event.time) || 0);
    // Normal rows (0,2,4...) never overlap each other. When all normal rows
    // are occupied, fallback rows (1,3,5...) sit half a line lower, permitting
    // *controlled visual overlap* with normal rows, Niconico-style. Same-parity
    // lanes still prevent text from overtaking within their own row.
    const lineStep=opts.halfLineOverlap?2:1;
    const laneSpan = Math.max(1,(Math.max(1,Number(event.lineCount)||1)-1)*lineStep+1);
    const parent = event.parentId ? String(event.parentId) : null;
    const parentTrack = parent && opts.parentTracks?.get(parent);
    let bestNormal = null, bestStaggered = null;
    for (let lane = 0; lane + laneSpan <= laneCount; lane++) {
      let start = target;
      for (let k = lane; k < lane + laneSpan; k += lineStep) {
        for (const prev of laneBuckets[k] || []) {
          if(prev.end<=start)continue;
          // Fixed tracks may lie in the future when a late YCS batch brings
          // an older timestamp. They should not push a new 20s event behind
          // a previously planned 90s event if the new one clears before 90s.
          if(opts.fixedTrackIds?.has(String(prev.id)) && prev.time>start &&
             prev.time>=start+(width+(opts.gap??28))/velocity)continue;
          start=Math.max(start,safeFollowingStart(prev,velocity,opts.gap??28));
        }
      }
      const end = trackEnd(start,width,velocity,w);
      if (Number.isFinite(duration) && duration > 0 && end > duration-margin+1e-6) continue;
      const proximity = parentTrack ? Math.abs(lane-parentTrack.lane)*0.08 : 0;
      const candidate = {lane, start, end, score:start+proximity};
      if (!opts.halfLineOverlap || lane % 2 === 0) {
        if (!bestNormal || candidate.score < bestNormal.score) bestNormal=candidate;
      } else if (!bestStaggered || candidate.score < bestStaggered.score) {
        bestStaggered=candidate;
      }
    }
    // Use only full, non-overlapping rows when one is immediately available.
    // Half-row placement is a fallback for congestion, not the default.
    const chosen = bestNormal && bestNormal.start <= target + 0.001
      ? bestNormal
      : bestStaggered && (!bestNormal || bestStaggered.start + 0.06 < bestNormal.start)
        ? bestStaggered : bestNormal || bestStaggered;
    if (!chosen) return null;
    return {...event,time:chosen.start,end:chosen.end,width,velocity,
      lane:chosen.lane,laneSpan,staggered:!!opts.halfLineOverlap && chosen.lane%2===1};
  }

  // Independently stack popular comments from the bottom edge up, permitting
  // multiple simultaneous comments without obscuring one another.
  function planFeatured(events, opts) {
    const tracks=[...(opts.fixedTracks||[])];
    const viewportHeight=Math.max(1,Number(opts.viewportHeight)||1);
    const viewportWidth=Math.max(1,Number(opts.viewportWidth)||1);
    const duration=Number(opts.duration);
    const lifetime=Number(opts.lifetime)||3.8;
    const gap=Number.isFinite(opts.gap)?opts.gap:4;
    let dropped=0;
    const rejected=[];
    // Retain only concurrently visible featured comments. The old implementation
    // scanned every past track for every new event (quadratic on large YCS loads).
    let active=tracks.filter(t=>t.end>0);
    for(const event of events) {
      const font=Math.ceil((event.fontsize || opts.fontsize || 24)*1.5);
      const lines=String(event.text).split('\n').length;
      const height=lineStepFor(font,opts.lineSpacing)*(lines-1)+Math.ceil(font*1.22+4)+2*Math.ceil(Math.max(3,font/7)+3);
      const width=Number(opts.measureText(event.text,font));
      const start=Math.max(0,Number(event.time)||0), end=start+lifetime;
      if(!Number.isFinite(width) || width>viewportWidth*.92 || height>viewportHeight-3 ||
        (Number.isFinite(duration) && duration>0 && end>duration-.4)) {
        dropped++;rejected.push(event);continue;
      }
      let bottomOffset=0;
      active=active.filter(t=>t.end>start);
      active.sort((a,b)=>(a.bottomOffset||0)-(b.bottomOffset||0));
      for(const prev of active) {
        if(prev.time>=end)continue;
        const from=prev.bottomOffset||0;
        if(bottomOffset+height+gap<=from) break;
        bottomOffset=Math.max(bottomOffset,from+(prev.displayHeight||0)+gap);
      }
      if(bottomOffset+height+2>viewportHeight) {dropped++;rejected.push(event);continue;}
      const item={...event,displayMode:'center',time:start,end,width,fontsize:font,
        bottomOffset,displayHeight:height};
      tracks.push(item);active.push(item);
    }
    tracks.sort((a,b)=>a.time-b.time||likeRank(a,b));
    // Rejected central comments are eligible for regular scrolling instead
    // of disappearing after their featured selection.
    return {tracks,dropped,rejected};
  }
  // Feed all events in planned start-time order. For equal timestamps the
  // existing schedule already uses descending likes, so the lowest-liked
  // colliding comments lose priority when lane capacity is exhausted.
  function planTracks(events, opts) {
    const lanes = Math.max(1, Math.floor(opts.lanes) || 1);
    const buckets = Array.from({length:lanes}, () => []);
    for (const fixed of opts.fixedTracks || []) {
      for (let lane=fixed.lane;lane<Math.min(lanes,fixed.lane+(fixed.laneSpan||1));lane+=(opts.halfLineOverlap?2:1)) {
        if(lane>=0) buckets[lane].push(fixed);
      }
    }
    const tracks = [];
    const parentTracks = new Map((opts.fixedTracks||[]).map(t=>[String(t.id),t]));
    const fixedTrackIds=new Set((opts.fixedTracks||[]).map(t=>String(t.id)));
    const activeOpts = {...opts,parentTracks,fixedTrackIds};
    let collisionDrops = 0;
    for (const event of events) {
      // The caller submits events in wanted-time order. Expired tracks can
      // never collide with any later event, so keep only recent lane entries.
      const wanted = Math.max(0, Number(event.time) || 0);
      for (let lane = 0; lane < lanes; lane++) {
        if (buckets[lane].length && buckets[lane][0].end <= wanted) {
          buckets[lane] = buckets[lane].filter(t => t.end > wanted);
        }
      }
      const track = createTrack(event, activeOpts, buckets);
      if (!track) {collisionDrops++; continue; }
      tracks.push(track);
      parentTracks.set(String(track.id),track);
      for (let lane=track.lane;lane<track.lane+track.laneSpan;lane+=(opts.halfLineOverlap?2:1)) buckets[lane].push(track);
    }
    tracks.sort((a,b) => a.time - b.time || likeRank(a,b));
    return {
      tracks,
      collisionDrops,
      maxTravel:tracks.reduce((max, t) => Math.max(max, t.end - t.time), 0),
      buckets
    };
  }
  function visibleTracks(tracks, videoTime, maxTravel = 0) {
    if (!Number.isFinite(videoTime) || !tracks.length) return [];
    const start = lowerBound(tracks, videoTime - maxTravel - 0.001);
    const result = [];
    for (let i = start; i < tracks.length && tracks[i].time <= videoTime; i++) {
      if (videoTime < tracks[i].end) result.push(tracks[i]);
    }
    return result;
  }
  // Fractional frame deadlines prevent 24/45 FPS from collapsing to 20/30
  // on 60Hz displays. Explicit invalidation may redraw before the deadline.
  function paceFrame(timestamp,nextAt,fps,forced=false){
    const step=1000/Math.max(1,Number(fps)||30);
    if(!forced&&nextAt>0&&timestamp+0.5<nextAt)return {draw:false,nextAt};
    if(!Number.isFinite(nextAt)||nextAt<=0||timestamp-nextAt>step*5)nextAt=timestamp+step;
    else if(timestamp+0.5>=nextAt)nextAt+=step*(Math.floor(Math.max(0,timestamp-nextAt)/step)+1);
    return {draw:true,nextAt};
  }
  function trackX(track, videoTime, viewportWidth) {
    return viewportWidth + 10 - track.velocity * (videoTime - track.time);
  }
  const api = Object.freeze({lineStepFor,normalizeText, cleanOriginalText, hideTimestamps, prepareText, lineCount, selectFeatured, shouldScrollFeatured, mergeStableTracks, parseTimes, lowerBound, hash, parseLikeCount, likeRank, newestRank, selectByLikes, selectForDisplay, commentColor, speedFactor, scrollTravelSeconds, buildSchedule, scrollingSpeed, safeFollowingStart, createTrack, planFeatured, planTracks, visibleTracks, paceFrame, trackX});
  globalThis.YDLLogic = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
