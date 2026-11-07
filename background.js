"use strict";

// Cross-frame delivery for YouTube's separate live-chat iframe.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "YDL_CHAT" || !sender.tab?.id) return;
  if (!sender.url?.startsWith("https://www.youtube.com/live_chat")) return;
  const payload = {
    type: "YDL_CHAT_EVENT",
    videoId: typeof message.videoId === "string" ? message.videoId.slice(0, 64) : "",
    id: typeof message.id === "string" ? message.id.slice(0, 160) : "",
    text: typeof message.text === "string" ? message.text.slice(0, 220) : ""
  };
  if (!payload.text) return;
  chrome.tabs.sendMessage(sender.tab.id, payload, {frameId: 0}).catch(() => {});
});
