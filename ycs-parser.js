/* Independent parser for YouTube Innertube comment responses and YCS JSON exports.
 * No YCS code is bundled: shapes documented at pc035860/YCS-cont (MIT).
 */
(() => {
  'use strict';
  // Keep parser independent: it also runs in MAIN-world hooks and the popup.
  function parseLikeCount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    if (typeof value !== 'string') return 0;
    const found = value.normalize('NFKC').replace(/[,，\s]/g, '').match(/(\d+(?:\.\d+)?)(億|万|千|[kmb])?/i);
    if (!found) return 0;
    const unit = {'億':1e8,'万':1e4,'千':1e3,k:1e3,m:1e6,b:1e9}[found[2]?.toLowerCase()] || 1;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(found[1]) * unit)));
  }
  function extractResponseComments(response) {
    if (!response || typeof response !== 'object') return [];
    const result = [];
    const seen = new Map();
    function add(id, value, likes=0, isReply=false) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text) return;
      const stableId = typeof id === 'string' && id ? id : `unknown:${text}`;
      const score = parseLikeCount(likes);
      if (seen.has(stableId)) {
        const previous = seen.get(stableId);
        previous.likes = Math.max(previous.likes, score);
        previous.isReply ||= Boolean(isReply);
        return;
      }
      const item = { id: stableId, text, likes:score, isReply:Boolean(isReply) };
      seen.set(stableId, item);
      result.push(item);
    }
    const stack = [{node: response, depth: 0, reply: false, parentId:null}];
    const visited = new WeakSet();
    let count = 0;
    while (stack.length && count++ < 140000) {
      const {node, depth, reply, parentId} = stack.pop();
      if (!node || typeof node !== 'object' || depth > 26 || visited.has(node)) continue;
      visited.add(node);
      if (node.commentEntityPayload) {
        const entity = node.commentEntityPayload;
        const id = entity.properties?.commentId || entity.key;
        add(id, entity.properties?.content?.content || entity.properties?.content?.text || entity.properties?.contentText,
          entity.toolbar?.likeCountLiked ?? entity.toolbar?.likeCount ?? entity.properties?.likeCount,
          reply || Number(entity.properties?.replyLevel || 0) > 0 || Boolean(entity.properties?.parentCommentId));
        const found=seen.get(String(id)); if(found && (entity.properties?.parentCommentId || parentId)) found.parentId=String(entity.properties?.parentCommentId||parentId);
      }
      if (node.commentRenderer) {
        const renderer = node.commentRenderer;
        const content = renderer.contentText || renderer.content;
        const value = content?.fullText || content?.simpleText || content?.content
          || (Array.isArray(content?.runs) ? content.runs.map(x => x.text || '').join('') : '');
        add(renderer.commentId, value,
          renderer.likeCount ?? renderer.voteCount?.simpleText ?? renderer.likesForSort,
          reply || Number(node.replyLevel||0)>0 || node.typeComment==='R' || Boolean(node.originComment));
        const found=seen.get(String(renderer.commentId)); if(found && (node.originComment?.commentRenderer?.commentId || parentId)) found.parentId=String(node.originComment?.commentRenderer?.commentId||parentId);
      }
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) if (node[i] && typeof node[i] === 'object') stack.push({node:node[i],depth:depth+1,reply,parentId});
      } else {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'commentEntityPayload' || key === 'commentRenderer') continue;
          if (value && typeof value === 'object') stack.push({node:value,depth:depth+1,reply:reply || key==='commentRepliesRenderer' || key==='subThreads' || key==='ycsReplies',parentId:node.commentThreadRenderer?.comment?.commentRenderer?.commentId||parentId});
        }
      }
    }
    return result;
  }
  function videoIdFromUrl(url) {
    if (typeof url !== 'string') return '';
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url.replace(/^\/+/, '')}`);
      const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1]
        || (/(^|\.)youtu\.be$/.test(u.hostname) ? u.pathname.slice(1).split('/')[0] : '');
      return /^[\w-]{11}$/.test(id || '') ? id : '';
    } catch { return ''; }
  }
  function parseOffset(value) {
    if (typeof value !== 'string') return null;
    const m = value.trim().replace(/^\+/, '').match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
    if (!m) return null;
    return m[3] === undefined ? Number(m[1]) * 60 + Number(m[2])
      : Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  function extractYcsExport(data) {
    if (!data || typeof data !== 'object') throw new Error('JSONオブジェクトが必要です');
    const items = [];
    const seen = new Set();
    let videoId = typeof data.videoId === 'string' ? data.videoId : '';
    if (!videoId) videoId = videoIdFromUrl(data.urlVideo || data.url || '');
    function add(raw, type='comment', isReply=false, parentId=null) {
      if (!raw || typeof raw !== 'object') return;
      const text = raw.commentMessage || raw.contentText?.fullText || raw.text;
      if (typeof text !== 'string' || !text.trim()) return;
      const commentUrl = raw.commentUrl || '';
      let id = raw.commentId || raw.id || raw.commentRenderer?.commentId || '';
      if (!id && commentUrl) {
        const match = String(commentUrl).match(/[?&]lc=([^&#]+)/);
        if (match) {try{id=decodeURIComponent(match[1]);}catch{id=match[1];}}
      }
      const offset = Number(raw.videoOffsetMs);
      const time = type === 'chat'
        ? (Number.isFinite(offset) && offset >= 0 ? offset/1000 : parseOffset(raw.relativeTimestamp || raw.timestampText))
        : null;
      const key = String(id || `${type}:${text}:${time ?? ''}`);
      if (seen.has(key)) return;
      seen.add(key);
      const renderer = raw.commentRenderer || raw;
      const likes = parseLikeCount(raw.totalLikes ?? raw.likes ?? renderer.likeCount ?? renderer.likesForSort ?? renderer.voteCount?.simpleText);
      items.push({id:key,text,time,likes,parentId:raw.parentId||raw.originComment?.commentRenderer?.commentId||parentId||null,isReply:Boolean(isReply || raw.typeComment==='R' || Number(raw.replyLevel||0)>0 || raw.originComment || raw.parentId || parentId)});
    }
    function visitComments(array, depth=0, parentId=null) {
      if (!Array.isArray(array) || depth > 20) return;
      for (const c of array) {
        add(c,'comment',depth>0,parentId);
        const nested = c?.commentReplies?.replies || c?.replies || c?.commentRenderer?.ycsReplies;
        if (Array.isArray(nested)) visitComments(nested, depth+1, c?.commentId||c?.id||c?.commentRenderer?.commentId||parentId);
      }
    }
    if (Array.isArray(data)) visitComments(data);
    else {
      visitComments(data.comments);
      if (Array.isArray(data.commentsChat)) for (const c of data.commentsChat) add(c,'chat');
    }
    return {videoId,items};
  }
  const api = Object.freeze({extractResponseComments, extractYcsExport, videoIdFromUrl, parseLikeCount});
  globalThis.YDLYcsParser = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
