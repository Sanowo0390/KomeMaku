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
  function selectByLikes(items, budget) {
    if (!Number.isFinite(budget) || items.length <= budget) return [...items];
    return [...items].sort(likeRank).slice(0, Math.max(0, Math.floor(budget)));
  }
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
    const interval = Math.max(0.55, 6 / Math.max(1, density));
    const validDuration = Number.isFinite(duration) && duration > 0;
    const finishMargin = Number.isFinite(options.finishMargin)
      ? Math.max(0, options.finishMargin) : 0.6;
    // Content script provides exact canvas-width estimates. The default is useful
    // for unit tests / consumers without a canvas; it is not used for rendering.
    const travelFor = item => {
      const t = typeof options.travelFor === "function" ? options.travelFor(item) : 9;
      return Number.isFinite(t) && t > 0 ? t : 9;
    };
    let budget = validDuration ? Math.max(1, Math.ceil(duration / interval)) : Infinity;
    let selected = selectByLikes(eligible, budget);
    let lastGenericTime = 0;
    if (validDuration && selected.length) {
      // Reserve time for the *entire* comment to travel beyond the left edge.
      // When that reduces the budget, drop the lowest-liked comments first.
      // Budget only shrinks, preventing oscillations with very long comments.
      for (let pass = 0; pass < 8; pass++) {
        let maxTravel = 0;
        for (const item of selected) maxTravel = Math.max(maxTravel, travelFor(item));
        lastGenericTime = Math.max(0, duration - maxTravel - finishMargin);
        const adjustedBudget = Math.max(1, Math.floor(lastGenericTime / interval) + 1);
        if (adjustedBudget >= budget) break;
        budget = adjustedBudget;
        selected = selectByLikes(eligible, budget);
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
        : parseTimes(item.text, duration);
      if (times.length) {
        // Timestamped comments also need enough scrolling time. If the
        // timestamp is too close to the end, start a little early instead.
        const latest = validDuration ? Math.max(0, duration - travelFor(item) - finishMargin) : times[0];
        events.push({...item, time:Math.min(times[0], latest)});
      } else generic.push(item);
    }
    // One non-timestamped occurrence per video play; distribute over the
    // usable runtime instead of placing the final one at video.duration.
    generic.sort((a,b) => hash(String(a.id)) - hash(String(b.id)) || String(a.id).localeCompare(String(b.id)));
    if (validDuration) {
      const gap = generic.length > 1 ? lastGenericTime / (generic.length - 1) : 0;
      for (let i = 0; i < generic.length; i++) events.push({...generic[i], time: i * gap});
    }
    events.sort((a,b) => a.time - b.time || likeRank(a,b));
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
    const width = Math.ceil(Math.max(0, Number(opts.measureText(event.text)) || 0));
    const duration = Number(opts.duration);
    const margin = Number.isFinite(opts.finishMargin) ? opts.finishMargin : 0.6;
    const velocity = scrollingSpeed(width, w, (opts.speed || 1) * (Number(event.speedFactor) || 1), duration, margin);
    const target = Math.max(0, Number(event.time) || 0);
    const laneSpan = Math.min(laneCount,Math.max(1,Math.floor(event.lineCount)||1));
    let bestLane = -1;
    let bestTime = Infinity;
    for (let lane = 0; lane + laneSpan <= laneCount; lane++) {
      let start = target;
      for (let k=lane;k<lane+laneSpan;k++) {
        const entries = laneBuckets[k] || [];
        for (const prev of entries) {
          if (prev.end <= start) continue;
          start = Math.max(start, safeFollowingStart(prev, velocity, opts.gap ?? 28));
        }
      }
      if (start < bestTime) { bestTime = start; bestLane = lane; }
    }
    const end = trackEnd(bestTime, width, velocity, w);
    if (Number.isFinite(duration) && duration > 0 && end > duration - margin + 1e-6) return null;
    if (bestLane < 0) return null;
    return {...event, time:bestTime, end, width, velocity, lane:bestLane, laneSpan};
  }
  // Feed all events in planned start-time order. For equal timestamps the
  // existing schedule already uses descending likes, so the lowest-liked
  // colliding comments lose priority when lane capacity is exhausted.
  function planTracks(events, opts) {
    const lanes = Math.max(1, Math.floor(opts.lanes) || 1);
    const buckets = Array.from({length:lanes}, () => []);
    for (const fixed of opts.fixedTracks || []) {
      for (let lane=fixed.lane;lane<Math.min(lanes,fixed.lane+(fixed.laneSpan||1));lane++) {
        if(lane>=0) buckets[lane].push(fixed);
      }
    }
    const tracks = [];
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
      const track = createTrack(event, opts, buckets);
      if (!track) {collisionDrops++; continue; }
      tracks.push(track);
      for (let lane=track.lane;lane<track.lane+track.laneSpan;lane++) buckets[lane].push(track);
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
  function trackX(track, videoTime, viewportWidth) {
    return viewportWidth + 10 - track.velocity * (videoTime - track.time);
  }
  const api = Object.freeze({normalizeText, cleanOriginalText, prepareText, lineCount, selectFeatured, mergeStableTracks, parseTimes, lowerBound, hash, parseLikeCount, likeRank, selectByLikes, commentColor, speedFactor, scrollTravelSeconds, buildSchedule, scrollingSpeed, safeFollowingStart, createTrack, planTracks, visibleTracks, trackX});
  globalThis.YDLLogic = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
