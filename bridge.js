(() => {
  "use strict";

  // MAIN-world code: use the current YouTube page's own Innertube context.
  // This is an undocumented interface and may change. There is no external backend.
  if (window.__YDL_BRIDGE_INSTALLED__) return;
  window.__YDL_BRIDGE_INSTALLED__ = true;

  let generation = 0;
  let abort = null;
  const MAX_PAGES = 6;
  const MAX_COMMENTS = 180;

  function event(name, detail) {
    window.dispatchEvent(new CustomEvent(`ydl:${name}`, {detail: JSON.stringify(detail)}));
  }

  function readJsonAssignment(source, marker) {
    const startIndex = source.indexOf(marker);
    if (startIndex < 0) return null;
    const first = source.indexOf("{", startIndex + marker.length);
    if (first < 0) return null;
    let depth = 0, quote = false, escaped = false;
    for (let i = first; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quote = false;
      } else if (c === '"') quote = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(first, i + 1)); } catch { return null; }
      }
    }
    return null;
  }

  function getContinuation(entry) {
    return entry?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
      || entry?.continuationItemRenderer?.button?.buttonRenderer?.command?.continuationCommand?.token
      || null;
  }

  function findCommentsContinuation(data) {
    if (!data || typeof data !== "object") return null;
    const roots = [
      data?.contents?.twoColumnWatchNextResults?.results?.results,
      data?.contents?.twoColumnWatchNextResults?.results,
      data?.contents?.singleColumnWatchNextResults?.results?.results,
      data?.contents,
      data
    ];
    let fallback = null;
    for (const root of roots) {
      if (!root) continue;
      const stack = [{node: root, depth: 0, path: ""}];
      let visited = 0;
      while (stack.length && visited++ < 15000) {
        const {node, depth, path} = stack.pop();
        if (!node || typeof node !== "object" || depth > 14) continue;
        const token = getContinuation(node);
        if (token && /comment/i.test(path)) return token;
        if (node.itemSectionRenderer) {
          const section = node.itemSectionRenderer;
          const target = String(section.targetId || section.sectionIdentifier || "");
          const candidates = section.contents || [];
          if (/comment/i.test(target)) {
            for (const item of candidates) {
              const candidate = getContinuation(item);
              if (candidate) return candidate;
            }
          }
          for (const item of candidates) {
            const candidate = getContinuation(item);
            if (candidate && !fallback) fallback = candidate;
          }
        }
        if (Array.isArray(node)) {
          for (let i = node.length - 1; i >= 0; i--) stack.push({node: node[i], depth: depth + 1, path});
        } else {
          for (const [key, value] of Object.entries(node)) {
            if (typeof value === "object" && value) {
              stack.push({node: value, depth: depth + 1, path: `${path}.${key}`});
            }
          }
        }
      }
    }
    return fallback;
  }

  function getConfig() {
    const cfg = window.ytcfg;
    return {
      key: cfg?.get?.("INNERTUBE_API_KEY") || "",
      context: cfg?.get?.("INNERTUBE_CONTEXT") || null,
      visitor: cfg?.get?.("VISITOR_DATA") || ""
    };
  }

  async function resolveToken(videoId, signal) {
    // On SPA navigation, ytInitialData can be stale. Check the current watch data first.
    const flex = document.querySelector("ytd-watch-flexy");
    const currentVideoId = flex?.data?.currentVideoEndpoint?.watchEndpoint?.videoId
      || flex?.data?.playerResponse?.videoDetails?.videoId;
    if (currentVideoId === videoId) {
      const token = findCommentsContinuation(flex?.data)
        || findCommentsContinuation(window.ytInitialData);
      if (token) return token;
    }
    // On a direct initial load, global data is for this video. On SPA navigation
    // it may describe the previous video, so prefer a fresh watch response.
    if (!currentVideoId && window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId) {
      const token = findCommentsContinuation(window.ytInitialData);
      if (token) return token;
    }
    // Fallback gets the current video's initial public watch data without scrolling.
    const response = await fetch(`/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: "same-origin", signal, headers: {"accept":"text/html"}
    });
    if (!response.ok) throw new Error(`watch HTTP ${response.status}`);
    const html = await response.text();
    const data = readJsonAssignment(html, "var ytInitialData = ")
      || readJsonAssignment(html, "window[\"ytInitialData\"] = ")
      || readJsonAssignment(html, "ytInitialData = ");
    return findCommentsContinuation(data);
  }

  function textFromRuns(renderer) {
    const part = renderer?.contentText || renderer?.content;
    if (typeof part === "string") return part;
    if (typeof part?.content === "string") return part.content;
    if (Array.isArray(part?.runs)) return part.runs.map(x => x.text || "").join("");
    return part?.simpleText || "";
  }

  function extractBatch(response) {
    const comments = [];
    const entities = new Map();
    const mutations = response?.frameworkUpdates?.entityBatchUpdate?.mutations || [];
    for (const m of mutations) {
      const entity = m?.payload?.commentEntityPayload;
      if (entity) {
        for (const key of [m.entityKey, entity.key, entity.properties?.commentId]) {
          if (key) entities.set(key, entity);
        }
      }
    }
    let nextToken = null;
    for (const endpoint of response?.onResponseReceivedEndpoints || []) {
      const sections = [endpoint?.reloadContinuationItemsCommand, endpoint?.appendContinuationItemsAction,
        endpoint?.reloadContinuationItemsCommand?.continuationItems ? null : endpoint?.appendContinuationItemsCommand];
      for (const section of sections) {
        if (!section) continue;
        const items = section.continuationItems || [];
        for (const item of items) {
          const candidate = getContinuation(item);
          if (candidate) nextToken = candidate;
          const wrapper = item.commentThreadRenderer?.commentViewModel?.commentViewModel
            || item.commentViewModel?.commentViewModel
            || item.commentViewModel;
          const key = wrapper?.commentKey || wrapper?.commentEntityKey;
          const entity = entities.get(key);
          const old = item.commentThreadRenderer?.comment?.commentRenderer || item.commentRenderer;
          if (entity) {
            const text = entity.properties?.content?.content;
            if (typeof text === "string" && text.trim()) {
              comments.push({id: entity.properties.commentId || key, text,
                likes: entity.toolbar?.likeCountLiked ?? entity.toolbar?.likeCount ?? 0,
                isReply:Number(entity.properties?.replyLevel||0)>0 || Boolean(entity.properties?.parentCommentId)});
            }
          } else if (old) {
            const text = textFromRuns(old);
            if (text.trim()) comments.push({id: old.commentId, text,
              likes: old.likeCount ?? old.voteCount?.simpleText ?? 0,
              isReply:Boolean(item.typeComment==='R' || item.originComment || Number(item.replyLevel||0)>0)});
          }
        }
      }
    }
    // Some YouTube responses contain the entity mutations but omit the legacy wrappers.
    // Preserve response order and collect any payload not yet read.
    const ids = new Set(comments.map(x => x.id));
    for (const entity of entities.values()) {
      const id = entity.properties?.commentId;
      const value = entity.properties?.content?.content;
      if (typeof value === "string" && value.trim() && !ids.has(id)) {
        comments.push({id, text: value,
          likes: entity.toolbar?.likeCountLiked ?? entity.toolbar?.likeCount ?? 0,
                isReply:Number(entity.properties?.replyLevel||0)>0 || Boolean(entity.properties?.parentCommentId)});
        ids.add(id);
      }
    }
    return {comments, nextToken};
  }

  async function collect(id, videoId, currentGen) {
    if (abort) abort.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const cfg = getConfig();
    if (!cfg.key || !cfg.context) {
      event("status", {id, videoId, status: "API設定が取得できません"});
      return;
    }
    let token;
    try { token = await resolveToken(videoId, signal); }
    catch (error) {
      if (!signal.aborted) event("status", {id, videoId, status: `初期情報の取得に失敗: ${String(error.message).slice(0, 70)}`});
      return;
    }
    if (!token) {
      event("status", {id, videoId, status: "コメント取得トークンがありません（DOM方式で補完）"});
      return;
    }
    const known = new Set();
    let pages = 0;
    try {
      while (token && pages++ < MAX_PAGES && known.size < MAX_COMMENTS) {
        if (signal.aborted || generation !== currentGen) return;
        const response = await fetch(`/youtubei/v1/next?key=${encodeURIComponent(cfg.key)}&prettyPrint=false`, {
          method: "POST", credentials: "same-origin", signal,
          headers: {
            "content-type": "application/json",
            "x-youtube-client-name": "1",
            "x-youtube-client-version": String(cfg.context.client?.clientVersion || ""),
            ...(cfg.visitor ? {"x-goog-visitor-id":cfg.visitor} : {})
          },
          body: JSON.stringify({context: cfg.context, continuation: token})
        });
        if (!response.ok) throw new Error(`comments HTTP ${response.status}`);
        const result = extractBatch(await response.json());
        const batch = [];
        for (const c of result.comments) {
          if (known.size >= MAX_COMMENTS) break;
          if (typeof c.text !== "string" || !c.text.trim()) continue;
          const key = String(c.id || c.text);
          if (known.has(key)) continue;
          known.add(key);
          batch.push({id:key, text:c.text, likes:c.likes});
        }
        if (batch.length && generation === currentGen) event("batch", {id, videoId, comments: batch});
        if (!result.nextToken || result.nextToken === token) break;
        token = result.nextToken;
        if (pages > 1 && !result.comments.length) break;
      }
      if (generation === currentGen) event("status", {id, videoId, status: `API取得: ${known.size}件`});
    } catch (error) {
      if (!signal.aborted) event("status", {id, videoId, status: `コメントAPI取得失敗: ${String(error.message).slice(0, 70)}`});
    }
  }

  window.addEventListener("ydl:request", (e) => {
    let detail;
    try { detail = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail; }
    catch { return; }
    if (!detail || typeof detail.id !== "string" || typeof detail.videoId !== "string") return;
    if (!/^[\w-]{11}$/.test(detail.videoId)) return;
    const gen = ++generation;
    collect(detail.id, detail.videoId, gen);
  });
})();
