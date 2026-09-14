/**
 * Content script â€” bridge between background.js and injected.js.
 * injected.js is registered in manifest.json with `world: MAIN`; inserting a
 * script element here is blocked by CSP/Trusted Types on current Flow pages.
 */
if (!globalThis.__FLOW_AGENT_CONTENT_LOADED__) {
globalThis.__FLOW_AGENT_CONTENT_LOADED__ = true;

let lastReportedFlowUrl = '';
function reportActiveFlowTab(force = false) {
  if (force || document.visibilityState === 'visible' || !lastReportedFlowUrl) {
    lastReportedFlowUrl = location.href;
    chrome.runtime.sendMessage({ type: 'FLOW_TAB_ACTIVE', url: location.href, visible: document.visibilityState === 'visible' }).catch(() => {});
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reportActiveFlowTab(true);
});
reportActiveFlowTab(true);
// Account switching can change /u/N/ without replacing the tab or document.
setInterval(() => {
  if (location.href !== lastReportedFlowUrl) reportActiveFlowTab(true);
}, 500);
// Recheck after login/bootstrap, even when the SPA keeps the same URL.
setInterval(() => {
  if (document.visibilityState === 'visible') reportActiveFlowTab();
}, 15000);

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source !== 'flow-agent-main') return;
  if (event.data.type === 'FLOW_MAIN_READY') {
    chrome.runtime.sendMessage({ type: 'FLOW_MAIN_READY' }).catch(() => {});
    return;
  }
  if (event.data.type !== 'FLOW_AUTH_TOKEN' || typeof event.data.authorization !== 'string') return;
  reportActiveFlowTab(true);
  chrome.runtime.sendMessage({
    type: 'FLOW_AUTH_TOKEN',
    authorization: event.data.authorization,
    url: location.href,
  }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type !== 'GET_CAPTCHA') return;

  const { requestId, pageAction } = msg;

  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('CAPTCHA_RESULT', handler);
      clearTimeout(timer);
      reply({ token: e.detail.token, error: e.detail.error });
    }
  };

  const timer = setTimeout(() => {
    window.removeEventListener('CAPTCHA_RESULT', handler);
    reply({ error: 'CONTENT_TIMEOUT' });
  }, 45000);

  window.addEventListener('CAPTCHA_RESULT', handler);

  window.dispatchEvent(new CustomEvent('GET_CAPTCHA', {
    detail: { requestId, pageAction },
  }));

  return true; // keep channel open for async reply
});

// â”€â”€â”€ TRPC Media URL Monitor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Forward intercepted TRPC responses with media URLs to background.js
window.addEventListener('TRPC_MEDIA_URLS', (e) => {
  const { url, body } = e.detail || {};
  if (!body) return;
  chrome.runtime.sendMessage({
    type: 'TRPC_MEDIA_URLS',
    trpcUrl: url,
    body,
  }).catch(() => {});
});

// â”€â”€â”€ Video Upload Relay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type !== 'UPLOAD_VIDEO') return;

  const { requestId, videoBase64, projectId } = msg;

  const handler = (e) => {
    if (e.detail?.requestId === requestId) {
      window.removeEventListener('UPLOAD_VIDEO_RESULT', handler);
      clearTimeout(timer);
      reply(e.detail);
    }
  };

  const timer = setTimeout(() => {
    window.removeEventListener('UPLOAD_VIDEO_RESULT', handler);
    reply({ error: 'UPLOAD_TIMEOUT' });
  }, 120000); // 2 min timeout for large uploads

  window.addEventListener('UPLOAD_VIDEO_RESULT', handler);

  window.dispatchEvent(new CustomEvent('UPLOAD_VIDEO', {
    detail: { requestId, videoBase64, projectId },
  }));

  return true; // keep channel open for async reply
});
}

