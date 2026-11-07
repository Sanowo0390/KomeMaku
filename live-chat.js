(() => {
  "use strict";
  if (window.__YDL_CHAT_INSTALLED__) return;
  window.__YDL_CHAT_INSTALLED__ = true;

  const seen = new Set();
  const order = [];
  let pending = false;
  let initialized = false;

  function textFrom(node) {
    if (!node) return "";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let text = "";
    while (walker.nextNode() && text.length < 210) {
      const entry = walker.currentNode;
      if (entry.nodeType === Node.TEXT_NODE) text += entry.textContent || "";
      else if (entry.nodeType === Node.ELEMENT_NODE && entry.tagName === "IMG") text += entry.alt || "";
    }
    return text.replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function scan() {
    pending = false;
    const url = new URL(location.href);
    const videoId = url.searchParams.get("v") || "";
    const messages = document.querySelectorAll(
      "yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-membership-item-renderer"
    );
    const fresh = [];
    for (const message of Array.from(messages).slice(-220)) {
      const text = textFrom(message.querySelector("#message, #content, #header-subtext"));
      if (!text) continue;
      const id = message.getAttribute("id") || message.data?.id || `fallback-${text}`;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      if (order.length > 600) seen.delete(order.shift());
      fresh.push({type:"YDL_CHAT", videoId, id, text});
    }
    // Skip messages already present on first load. A replay seek may render a
    // large burst of history; cap it to protect both the UI and the message port.
    if (initialized) {
      for (const message of fresh.slice(-20)) {
        chrome.runtime.sendMessage(message).catch(() => {});
      }
    }
    initialized = true;
  }

  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(scan, 140);
  });
  observer.observe(document.documentElement, {subtree:true,childList:true});
  scan();
  setInterval(scan, 5000);
})();
