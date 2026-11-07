/* Passive MAIN-world capture of comment API responses while YCS loads comments.
 * No YCS internal storage or private extension APIs are accessed.
 */
(() => {
  'use strict';
  if (window.__YDL_YCS_HOOKED__) return;
  window.__YDL_YCS_HOOKED__ = true;
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  const pageVideoId = () => {
    const url = new URL(location.href);
    return (url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1]) || '';
  };
  function isCommentEndpoint(input) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && /^\/youtubei\/v1\/(?:next|browse)$/.test(parsed.pathname);
    } catch {return false;}
  }
  const send = (response, id) => {
    if (!response?.ok || !id || !response.clone) return;
    let clone;
    try {
      if (Number(response.headers?.get('content-length') || 0) > 12_000_000) return;
      clone = response.clone();
    } catch {return;}
    void clone.json().then(data => {
      if (pageVideoId() !== id) return;
      const items = globalThis.YDLYcsParser?.extractResponseComments(data) || [];
      if (!items.length) return;
      for (let i=0;i<items.length;i+=150) {
        window.dispatchEvent(new CustomEvent('ydl:ycs-batch', {
          detail:JSON.stringify({videoId:id,comments:items.slice(i,i+150)})
        }));
      }
    }).catch(() => {});
  };
  window.fetch = function(input, init) {
    const capture = isCommentEndpoint(input);
    const id = capture ? pageVideoId() : '';
    const pending = Reflect.apply(originalFetch, this, arguments);
    if (!capture || !id) return pending;
    return pending.then(response => {
      // Inspect a cloned body asynchronously, without delaying YCS's own result.
      send(response, id);
      return response;
    });
  };
})();
