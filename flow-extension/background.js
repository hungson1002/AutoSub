/**
 * Flow Agent â€” Chrome Extension Background Service Worker
 *
 * Connects to local Python agent via WebSocket (agent runs WS server).
 * Captures bearer token, solves reCAPTCHA, proxies API calls through browser.
 */

importScripts('config.js');
importScripts('session-sync.js');

let callbackUrl = 'http://127.0.0.1:3001/api/ext/callback';
let ws = null;
let flowKey = null;
let flowKeySource = null;
let rejectedFlowToken = null;
let selectedFlowTabId = null;
let selectedFlowAccount = null;
let selectedFlowUrl = null;
let sessionUpdates = Promise.resolve();
const pendingTabTokens = new Map();

function persistSessionUpdate(token, capturedMetrics) {
  const account = selectedFlowAccount;
  const url = selectedFlowUrl;
  sessionUpdates = sessionUpdates.catch(() => {}).then(async () => {
    if (token) {
      await chrome.storage.local.set({
        flowKey: token,
        metrics: capturedMetrics,
        selectedFlowAccount: account,
        selectedFlowUrl: url,
      });
    } else {
      await chrome.storage.local.remove('flowKey');
      await chrome.storage.local.set({
        metrics: capturedMetrics,
        selectedFlowAccount: account,
        selectedFlowUrl: url,
      });
    }
    await sendToAgent({ type: 'token_captured', flowKey: token || '', clientId: extensionClientId });
  });
  return sessionUpdates;
}

function flowAccountFromUrl(value) {
  if (!isFlowUrl(value)) return null;
  const url = new URL(value);
  const account = url.pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1]
    || url.searchParams.get('authuser') || 'default';
  return `${url.origin}:${account}`;
}

function selectFlowAccount(tab) {
  const account = flowAccountFromUrl(tab.url);
  if (!account || tab.id === captchaTabId || tab.id === accountSyncTabId) return false;
  const changed = selectedFlowTabId !== tab.id || selectedFlowAccount !== account;
  selectedFlowTabId = tab.id;
  selectedFlowAccount = account;
  selectedFlowUrl = tab.url;
  if (changed) {
    // /u/N is a browser account slot, not a stable Google identity.
    // Never resurrect a token merely because that slot was used previously.
    void invalidateFlowSession().catch((error) =>
      console.error('[Flow Agent] Session invalidation failed:', error)
    );
  }
  return changed;
}

async function invalidateFlowSession() {
  flowKey = null;
  flowKeySource = null;
  metrics.tokenCapturedAt = null;
  await persistSessionUpdate(null, { ...metrics });
}
let callbackSecret = null;  // Auth secret for HTTP callback, received from server on WS connect
let httpConnected = false;
let httpPollTimer = null;
let httpPollIntervalMs = 1000;
let state = 'off'; // off | idle | running
let manualDisconnect = false;
let extensionClientId = '';
let connectedServerHost = CONFIG.DEFAULT_SERVER_HOST;

function normalizeCallbackUrl(value) {
  try {
    const raw = String(value || '').trim();
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const local = /^(localhost|127\.0\.0\.1|192\.168\.|10\.)/.test(parsed.hostname);
    parsed.protocol = local ? 'http:' : 'https:';
    parsed.pathname = '/api/ext/callback';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'http://127.0.0.1:8001/api/ext/callback';
  }
}
let metrics = {
  tokenCapturedAt: null,
  requestCount: 0,   // captcha-consuming requests only (gen image/video/upscale)
  successCount: 0,
  failedCount: 0,
  lastError: null,
};

// â”€â”€â”€ URL â†’ Log Type Classifier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Visible log types â€” only these appear in the request log
const _VISIBLE_TYPES = new Set(['GEN_IMG', 'GEN_VID', 'GEN_VID_REF', 'UPSCALE', 'TRACKING', 'URL_REFRESH']);

function _classifyApiUrl(url) {
  if (url.includes('uploadImage')) return 'UPLOAD';
  if (url.includes('batchGenerateImages')) return 'GEN_IMG';
  if (url.includes('UpsampleVideo')) return 'UPSCALE';
  if (url.includes('ReferenceImages')) return 'GEN_VID_REF';
  if (url.includes('batchAsyncGenerateVideo')) return 'GEN_VID';
  if (url.includes('batchCheckAsync')) return 'POLL';
  if (url.includes('upsampleImage')) return 'UPS_IMG';
  if (url.includes('/media/')) return 'MEDIA';
  if (url.includes('/credits')) return 'CREDITS';
  return 'API';
}

// â”€â”€â”€ Request Log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let requestLog = [];

function addRequestLog(entry) {
  requestLog.unshift(entry);
  if (requestLog.length > 100) requestLog.pop();
  chrome.storage.local.set({ requestLog }).catch(() => {});
  broadcastRequestLog();
}

function updateRequestLog(id, updates) {
  const entry = requestLog.find((e) => e.id === id);
  if (entry) Object.assign(entry, updates);
  chrome.storage.local.set({ requestLog }).catch(() => {});
  broadcastRequestLog();
}

function broadcastRequestLog() {
  chrome.runtime.sendMessage({ type: 'REQUEST_LOG_UPDATE', log: requestLog }).catch(() => { });
}

// â”€â”€â”€ Startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let initialization;
function ensureInitialized() {
  if (!initialization) initialization = init().catch((error) => {
    initialization = null;
    console.error('[Flow Agent] Initialization failed:', error);
  });
  return initialization;
}



chrome.runtime.onInstalled.addListener(ensureInitialized);
chrome.runtime.onStartup.addListener(ensureInitialized);
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'reconnect') connectToAgent();
  if (alarm.name === 'keepAlive') keepAlive();
  if (alarm.name === 'flushOutbox') flushOutbox();
  if (alarm.name === 'closeIdleFlowTab') await closeIdleFlowTab();
});

async function init() {
  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn('[Flow Agent] Side Panel click behavior unavailable:', error.message);
    }
  }
  await chrome.storage.local.remove('customServerIp');
  const data = await chrome.storage.local.get([
    'flowKey',
    'metrics',
    'callbackSecret',
    'callbackUrl',
    'requestLog',
    'selectedFlowAccount',
    'selectedFlowUrl',
    'rejectedFlowToken',
  ]);
  if (data.metrics) Object.assign(metrics, data.metrics);
  if (data.callbackSecret) callbackSecret = data.callbackSecret;
  if (data.callbackUrl) callbackUrl = normalizeCallbackUrl(data.callbackUrl);
  if (Array.isArray(data.requestLog)) requestLog = data.requestLog.slice(0, 100);
  if (data.selectedFlowAccount) selectedFlowAccount = data.selectedFlowAccount;
  if (data.selectedFlowUrl) selectedFlowUrl = data.selectedFlowUrl;
  if (typeof data.rejectedFlowToken === 'string') rejectedFlowToken = data.rejectedFlowToken;

  // Browser sign-in may have changed while the worker was stopped.
  flowKey = null;
  metrics.tokenCapturedAt = null;
  await chrome.storage.local.remove('accountTokens');
  await chrome.storage.local.remove('flowKey');

  // Discover existing open Flow tab if any
  try {
    if (chrome.tabs?.query) {
      const flowTabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((t) => t.id !== captchaTabId);
      const active = flowTabs.find((t) => t.active) || flowTabs.find((t) => t.id === selectedFlowTabId) || (flowTabs.length === 1 ? flowTabs[0] : null);
      if (active) {
        selectFlowAccount(active);
      }
    }
  } catch (err) {
    console.warn('[Flow Agent] Error querying flow tabs on init:', err);
  }

  await loadOutbox();
  connectToAgent();
  // 0.5 min is Chrome's minimum alarm period â€” anything lower is silently clamped.
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
  // Retry any responses left undelivered by a previous worker lifetime.
  chrome.alarms.create('flushOutbox', { periodInMinutes: 0.5 });
  flushOutbox();
}

ensureInitialized();

// â”€â”€â”€ Token Capture â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function captureBearerToken(value, sourceAccount = null, source = 'network') {
  const bearerMatch = String(value || '').match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) return false;

  // Google may change the access-token prefix. Validate by shape instead of
  // requiring the historical `ya29.` prefix.
  const token = bearerMatch[1].trim();
  if (token.length < 32 || /\s/.test(token)) return false;
  if (token === rejectedFlowToken) return false;
  if (rejectedFlowToken) {
    rejectedFlowToken = null;
    void chrome.storage.local.remove('rejectedFlowToken');
  }

  const account = sourceAccount || selectedFlowAccount || 'default';
  const now = Date.now();

  if (source === 'labs_session' && flowKey && flowKeySource !== 'labs_session') return true;
  flowKey = token;
  flowKeySource = source;
  metrics.tokenCapturedAt = now;
  void persistSessionUpdate(token, { ...metrics }).catch((error) => console.error('[Flow Agent] Token sync failed:', error));
  console.log('[Flow Agent] Bearer token captured for account:', account);
  return true;
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    // Requests made by this worker reuse flowKey. Observing them would make
    // an old account token look freshly captured forever.
    if (details.tabId < 0) return;
    const requestHeaders = details?.requestHeaders || [];
    try {
      const observedUrl = new URL(details.url);
      metrics.lastFlowRequestAt = Date.now();
      metrics.lastFlowRequestHost = observedUrl.host;
      metrics.lastFlowRequestPath = observedUrl.pathname;
      // Store names only. Header values may contain account credentials.
      metrics.lastFlowHeaderNames = requestHeaders
        .map((header) => String(header.name || '').toLowerCase())
        .filter(Boolean)
        .sort();
      chrome.storage.local.set({ metrics });
    } catch {}
    if (!requestHeaders.length) return;
    const authHeader = requestHeaders.find(
      (h) => h.name?.toLowerCase() === 'authorization',
    );
    const source = details.url.startsWith('https://aisandbox-pa.') ? 'aisandbox' : 'page';
    if (details.tabId === selectedFlowTabId) {
      captureBearerToken(authHeader?.value, selectedFlowAccount, source);
    } else if (authHeader?.value) {
      // Navigation requests can run before the document_start content script
      // tells us which Flow tab is active. Hold only the token from that exact
      // tab briefly, then accept it once FLOW_TAB_ACTIVE confirms the tab.
      pendingTabTokens.set(details.tabId, { authorization: authHeader.value, source, at: Date.now() });
    }
  },
  { urls: ['https://aisandbox-pa.googleapis.com/*', 'https://flow.google.com/*', 'https://labs.google/*'] },
  ['requestHeaders', 'extraHeaders'],
);

// Opera may omit sensitive request headers from webRequest for newer Flow
// pages. content.js relays the same bearer value observed in the page's MAIN
// world, giving us a browser-compatible fallback.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const senderUrl = sender.url || sender.tab?.url;
  if (!sender.tab || !isFlowUrl(senderUrl)) return;
  if (msg?.type === 'FLOW_TAB_ACTIVE') {
    if (sender.tab.id === accountSyncTabId) {
      void refreshSelectedAccountSession(false);
      return;
    }
    if (msg.visible === false && selectedFlowTabId !== null) return;
    selectFlowAccount({ id: sender.tab.id, url: senderUrl });
    const pending = pendingTabTokens.get(sender.tab.id);
    pendingTabTokens.delete(sender.tab.id);
    if (pending && Date.now() - pending.at < 30000) {
      captureBearerToken(pending.authorization, selectedFlowAccount, pending.source);
    }
    void refreshSelectedAccountSession(msg.visible === true);
    return;
  }
  if (selectedFlowTabId === null) {
    selectFlowAccount({ id: sender.tab.id, url: senderUrl });
  }
  if (sender.tab.id !== selectedFlowTabId) return;
  if (flowAccountFromUrl(senderUrl) !== selectedFlowAccount) return;
  if (msg?.type === 'FLOW_AUTH_TOKEN') {
    captureBearerToken(msg.authorization, selectedFlowAccount, msg.apiHost === 'aisandbox' ? 'aisandbox' : 'page');
  } else if (msg?.type === 'FLOW_MAIN_READY') {
    metrics.mainWorldReadyAt = Date.now();
    chrome.storage.local.set({ metrics });
  }
});
// Keep it available in the background so user tabs are never redirected.
const FLOW_TAB_URLS = [
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
  'https://flow.google.com/*',
];
// Labs remains the fallback token source, but the current Flow frontend may
// redirect there to flow.google.com. Keep the exact tab selected by the user so
// another signed-in account cannot silently replace its session.
const TOKEN_SOURCE_TAB_URLS = [
  'https://labs.google/fx/tools/flow*',
  'https://labs.google/fx/*/tools/flow*',
];
// Refresh the selected tab in place; never guess a Google account index.
const FLOW_URL = 'https://labs.google/fx/tools/flow';
let workTabId = null;
let flowTabOpening = null;
let workTabCreatedByExtension = false;
let captchaTabId = null;
let captchaTabOpening = null;
const CAPTCHA_COOKIE_RULE_ID = 1001;

function scheduleFlowTabClose() {
  if (workTabCreatedByExtension || captchaTabId) {
    chrome.alarms.create('closeIdleFlowTab', { delayInMinutes: 2 });
  }
}

async function closeIdleFlowTab() {
  if (state === 'running') {
    scheduleFlowTabClose();
    return;
  }
  const tabIds = [];
  if (workTabId && workTabCreatedByExtension) tabIds.push(workTabId);
  if (captchaTabId) tabIds.push(captchaTabId);
  workTabId = null;
  workTabCreatedByExtension = false;
  captchaTabId = null;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CAPTCHA_COOKIE_RULE_ID],
  }).catch(() => {});
  if (tabIds.length) {
    try {
      await chrome.tabs.remove([...new Set(tabIds)]);
    } catch { /* a tab was already closed */ }
  }
}

function isFlowUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'flow.google.com'
      || (parsed.hostname === 'labs.google' && /^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(parsed.pathname)));
  } catch { return false; }
}

function isTokenSourceUrl(url) {
  return !!url && TOKEN_SOURCE_TAB_URLS.some((p) => new RegExp(p.replace(/\./g, '\\.').replace(/\*/g, '.*')).test(url));
}

async function waitForTabComplete(tabId, maxWaitMs = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.get(tabId).then(resolve).catch(() => resolve(null));
    }, maxWaitMs);
  });
}

// Finds/wakes/creates the Flow tab. Returns
// the tab, or null if it couldn't be opened.
async function _getOrOpenFlowTab() {
  const flowTabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((tab) => tab.id !== captchaTabId);
  const selected = flowTabs.find((tab) => tab.id === selectedFlowTabId)
    || flowTabs.find((tab) => tab.active)
  if (selected) {
    selectFlowAccount(selected);
    return selected;
  }
  if (flowTabs.length > 1) {
    selectFlowAccount(flowTabs[0]);
    return flowTabs[0];
  }
  if (workTabId !== null) {
    try {
      const tab = await chrome.tabs.get(workTabId);
      scheduleFlowTabClose();
      return tab;
    } catch (e) {
      workTabId = null; // closed by the user â€” fall through and open fresh
    }
  }

  const tabs = await chrome.tabs.query({ url: FLOW_TAB_URLS });
  if (tabs.length) {
    workTabId = tabs[0].id;
    workTabCreatedByExtension = false;
    return tabs[0];
  }

  const createdTab = await chrome.tabs.create({ url: FLOW_URL, active: false });
  workTabId = createdTab.id;
  workTabCreatedByExtension = true;
  await waitForTabComplete(workTabId);
  await sleep(1500);

  // Inject content script to make sure reCAPTCHA bridge is ready
  try {
    await chrome.scripting.executeScript({
      target: { tabId: workTabId },
      files: ['content.js'],
    });
  } catch (e) {
    console.warn('[Flow Agent] Content script pre-injection:', e.message);
  }

  scheduleFlowTabClose();
  return createdTab;
}

async function getOrOpenFlowTab() {
  if (flowTabOpening) return flowTabOpening;
  flowTabOpening = _getOrOpenFlowTab();
  try {
    return await flowTabOpening;
  } finally {
    flowTabOpening = null;
  }
}

async function _getOrOpenCaptchaTab() {
  // Use the selected, signed-in Flow page. Never strip cookies to obtain an
  // anonymous verification context different from the generation account.
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [CAPTCHA_COOKIE_RULE_ID],
  });
  return getOrOpenFlowTab();
}

async function getOrOpenCaptchaTab() {
  if (captchaTabOpening) return captchaTabOpening;
  captchaTabOpening = _getOrOpenCaptchaTab();
  try {
    return await captchaTabOpening;
  } finally {
    captchaTabOpening = null;
  }
}

// Token is considered fresh if it exists and was captured less than 50 minutes ago.
// Google OAuth tokens expire after ~60 min, so 50 min gives a safe buffer.
function isTokenFresh() {
  if (!flowKey || !metrics.tokenCapturedAt) return false;
  const ageMs = Date.now() - metrics.tokenCapturedAt;
  return ageMs < 50 * 60 * 1000; // 50 minutes
}

async function captureTokenFromFlowTab(force = false) {
  // Skip if token is still fresh â€” no need to open/refresh anything
  if (!force && isTokenFresh()) {
    console.log('[Flow Agent] Token still fresh, skipping tab refresh');
    return;
  }

  if (_openingFlowTab) {
    console.log('[Flow Agent] Flow tab already opening, skipping');
    return;
  }
  _openingFlowTab = true;
  try {
    if (force) await invalidateFlowSession();
    const tab = await getOrOpenFlowTab();
    if (!tab) {
      console.log('[Flow Agent] Flow tab not ready yet after open');
      return;
    }
    if (force) {
      await chrome.tabs.reload(tab.id, { bypassCache: true });
      await waitForTabComplete(tab.id, 20000);
      await sleep(1500);
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['injected.js'],
      world: 'MAIN',
    });
    console.log('[Flow Agent] Token refresh triggered on Flow tab');
  } catch (e) {
    console.error('[Flow Agent] Token refresh failed:', e);
  } finally {
    _openingFlowTab = false;
  }
}


// â”€â”€â”€ WebSocket to Agent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function connectToAgent() {
  if (manualDisconnect) return;
  await connectHttpAgent();
  if (ws?.readyState === WebSocket.CONNECTING) return;
  if (ws?.readyState === WebSocket.OPEN) return;

  const data = await chrome.storage.local.get(['clientId']);
  const serverIp = CONFIG.DEFAULT_SERVER_HOST;
  connectedServerHost = serverIp;
  const isLocal = /^(127\.0\.0\.1|localhost|192\.168\.|10\.)/.test(serverIp);
  const wsScheme = isLocal ? 'ws' : 'wss';
  const httpScheme = isLocal ? 'http' : 'https';
  const wsUrl = `${wsScheme}://${serverIp}/ws`;

  // Dynamically resolve callbackUrl
  callbackUrl = `${httpScheme}://${serverIp}/api/ext/callback`;

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    console.error('[Flow Agent] WS connect error:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = async () => {
    console.log('[Flow Agent] Connected to agent: ' + wsUrl);
    chrome.alarms.clear('reconnect');
    setState('idle');

    const storage = await chrome.storage.local.get(['clientId']);
    let clientId = storage.clientId;
    if (!clientId) {
      const prefix = CONFIG.DEFAULT_CLIENT_ID_PREFIX || 'client';
      clientId = `${prefix}-${Math.random().toString(36).substring(2, 8)}`;
      await chrome.storage.local.set({ clientId });
    }
    extensionClientId = clientId;

    // Send current state + resend token if we have one, along with clientId
    ws.send(JSON.stringify({
      type: 'extension_ready',
      clientId: clientId,
      flowKeyPresent: !!flowKey,
      tokenAge: flowKey && metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
    }));
    if (flowKey) {
      ws.send(JSON.stringify({
        type: 'token_captured',
        clientId: clientId,
        flowKey: flowKey
      }));
    }
    // Backend is reachable again â€” push any responses queued while it was down.
    flushOutbox();
  };

  ws.onmessage = async ({ data }) => {
    try {
      const msg = JSON.parse(data);
      await handleAgentCommand(msg);
    } catch (e) {
      console.error('[Flow Agent] WS message error:', e);
    }
  };

  ws.onclose = () => {
    setState('off');
    if (!manualDisconnect) scheduleReconnect();
  };

  ws.onerror = (e) => {
    console.error('[Flow Agent] WS error:', e);
    metrics.lastError = 'WS_ERROR';
    chrome.storage.local.set({ metrics });
  };
}

async function handleAgentCommand(msg) {
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.method === 'api_request') {
      await handleApiRequest(msg);
    } else if (msg.method === 'get_media_url') {
      await handleGetMediaUrl(msg);
    } else if (msg.method === 'trpc_request') {
      await handleTrpcRequest(msg);
    } else if (msg.method === 'upload_video') {
      await handleUploadVideo(msg);
    } else if (msg.method === 'solve_captcha') {
      await handleSolveCaptcha(msg);
    } else if (msg.method === 'get_status') {
      sendToAgent({
        id: msg.id,
        result: {
          state,
          flowKeyPresent: !!flowKey,
          manualDisconnect,
          tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
          metrics,
          session: flowSessionStatus,
        },
      });
    } else if (msg.method === 'open_flow_tab') {
      if (isTokenFresh()) {
        console.log('[Flow Agent] open_flow_tab: token fresh, sending cached token');
        await sendToAgent({ type: 'token_captured', flowKey, clientId: extensionClientId });
      } else {
        console.log('[Flow Agent] open_flow_tab: token missing/expired, opening tab');
        await captureTokenFromFlowTab(true);
      }
    } else if (msg.method === 'refresh_flow_tab' || msg.method === 'force_refresh') {
      const force = msg.force === true || msg.method === 'force_refresh';
      if (isTokenFresh() && !force) {
        console.log('[Flow Agent] refresh_flow_tab: token fresh, sending cached token');
        await sendToAgent({ type: 'token_captured', flowKey, clientId: extensionClientId });
      } else {
        console.log('[Flow Agent] refresh_flow_tab: forcing tab reload + re-capture');
        if (force) {
          await invalidateFlowSession();
        }
        await refreshSelectedAccountSession(true);
        if (isTokenFresh() && flowKeySource !== 'labs_session') return;
        if (['account_mismatch', 'sign_in_required'].includes(flowSessionStatus.status)) return;
        await captureTokenFromFlowTab(force);
        await sleep(3000);
        if (flowKey) {
          await sendToAgent({ type: 'token_captured', flowKey, clientId: extensionClientId });
          console.log('[Flow Agent] Sent token after refresh');
        }
      }
    } else if (msg.type === 'callback_config') {
      callbackSecret = msg.secret;
      callbackUrl = normalizeCallbackUrl(msg.callback_url);
      chrome.storage.local.set({ callbackSecret: msg.secret, callbackUrl });
      console.log('[Flow Agent] Received callback config:', callbackUrl);
    } else if (msg.type === 'callback_secret') {
      callbackSecret = msg.secret;
      chrome.storage.local.set({ callbackSecret: msg.secret });
      console.log('[Flow Agent] Received callback secret');
    } else if (msg.type === 'pong') {
      // keepalive response
    }
  } catch (e) {
    console.error('[Flow Agent] Command execution error:', e);
  }
}

function agentHttpBase() {
  const host = String(connectedServerHost || CONFIG.DEFAULT_SERVER_HOST).trim().replace(/\/$/, '');
  const hostWithoutScheme = host.replace(/^https?:\/\//i, '');
  const local = /^(127\.0\.0\.1|localhost|192\.168\.|10\.)(:|$)/.test(hostWithoutScheme);
  return /^https?:\/\//i.test(host) ? host : `${local ? 'http' : 'https'}://${host}`;
}

async function connectHttpAgent() {
  if (manualDisconnect || httpConnected) return;
  const storage = await chrome.storage.local.get(['clientId']);
  let clientId = storage.clientId;
  if (!clientId) {
    const prefix = CONFIG.DEFAULT_CLIENT_ID_PREFIX || 'client';
    clientId = `${prefix}-${Math.random().toString(36).substring(2, 8)}`;
    await chrome.storage.local.set({ clientId });
  }
  extensionClientId = clientId;
  connectedServerHost = CONFIG.DEFAULT_SERVER_HOST;
  try {
    const response = await fetch(`${agentHttpBase()}/api/ext/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: clientId,
        account_session: flowSessionStatus,
        clientId,
        flowKey: flowKey || '',
        flowKeyPresent: !!flowKey,
        extension_version: chrome.runtime.getManifest().version,
        selected_flow_url: selectedFlowUrl,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    callbackSecret = data.secret;
    callbackUrl = new URL(data.callback_url, agentHttpBase()).toString();
    httpPollIntervalMs = Math.max(250, Number(data.poll_interval_ms) || 1000);
    httpConnected = true;
    await chrome.storage.local.set({ callbackSecret, callbackUrl });
    setState('idle');
    scheduleHttpPoll(0);
    flushOutbox();
  } catch (error) {
    httpConnected = false;
    console.warn('[Flow Agent] HTTP bridge unavailable; using WebSocket fallback:', error.message);
  }
}

function scheduleHttpPoll(delay = httpPollIntervalMs) {
  if (httpPollTimer) clearTimeout(httpPollTimer);
  if (!httpConnected || manualDisconnect) return;
  httpPollTimer = setTimeout(pollHttpCommands, delay);
}

async function pollHttpCommands() {
  if (!httpConnected || manualDisconnect) return;
  try {
    const response = await fetch(`${agentHttpBase()}/api/ext/poll?session_id=${encodeURIComponent(extensionClientId)}`, {
      headers: { Authorization: `Bearer ${callbackSecret}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const commands = data.commands || [];
    if (commands.length > 0) {
      commands.forEach((command) => {
        Promise.resolve(handleAgentCommand(command)).catch((err) => {
          console.error('[Flow Agent] Command execution error:', err);
        });
      });
    }
    scheduleHttpPoll();
  } catch (error) {
    httpConnected = false;
    console.warn('[Flow Agent] HTTP polling stopped:', error.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  chrome.alarms.create('reconnect', { delayInMinutes: 0.5 });
}

function keepAlive() {
  if (httpConnected) {
    connectHttpAgent();
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  } else {
    connectToAgent();
  }
}

function sendToAgent(msg) {
  // API responses (with msg.id) go through a durable outbox so a generated
  // result is never lost â€” persisted and retried until the agent acks it.
  if (msg.id) {
    enqueueResponse(msg);
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
  if (httpConnected && callbackSecret) {
    return fetch(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${callbackSecret}` },
      body: JSON.stringify({ ...msg, session_id: extensionClientId }),
    }).catch(() => {});
  }
}

// â”€â”€â”€ Durable Response Outbox â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// A generated image/video result must survive a momentary backend hiccup or a
// service-worker restart. Every id-bearing response is persisted and retried
// with backoff until the agent confirms receipt, then dropped.

const MAX_DELIVERY_ATTEMPTS = 8;
let outbox = {};              // id -> { msg, attempts, nextAt }
let _flushingOutbox = false;

async function loadOutbox() {
  try {
    const { responseOutbox } = await chrome.storage.local.get('responseOutbox');
    if (responseOutbox && typeof responseOutbox === 'object') outbox = responseOutbox;
  } catch { }
}

function persistOutbox() {
  chrome.storage.local.set({ responseOutbox: outbox }).catch(() => { });
}

function enqueueResponse(msg) {
  outbox[msg.id] = { msg, attempts: 0, nextAt: 0 };
  persistOutbox();
  flushOutbox();
}

async function deliverOnce(entry) {
  try {
    const serverIp = connectedServerHost || CONFIG.DEFAULT_SERVER_HOST;
    const targetCallbackUrl = normalizeCallbackUrl(serverIp);

    const resp = await fetch(targetCallbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(callbackSecret ? { Authorization: `Bearer ${callbackSecret}` } : {}),
      },
      body: JSON.stringify({ ...entry.msg, session_id: extensionClientId }),
    });
    // Any HTTP reply means the backend is reachable and has taken the response
    // (ok:true = matched a request, ok:false = unknown id / already handled).
    // Either way there is nothing to retry â€” only transport failures retry.
    if (resp.ok) return true;
    // 5xx / transient server error â€” retry.
    return false;
  } catch {
    // Network error: backend unreachable. Try WS as an immediate fallback but
    // keep the entry queued so a later flush can still deliver it.
    if (ws?.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(entry.msg)); } catch { }
    }
    return false;
  }
}

async function flushOutbox() {
  if (_flushingOutbox) return;
  _flushingOutbox = true;
  try {
    const ids = Object.keys(outbox);
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) {
      const entry = outbox[id];
      if (!entry) continue;
      if (entry.nextAt && entry.nextAt > now) continue;
      const delivered = await deliverOnce(entry);
      if (delivered) {
        delete outbox[id];
        persistOutbox();
        continue;
      }
      entry.attempts++;
      if (entry.attempts >= MAX_DELIVERY_ATTEMPTS) {
        console.error('[Flow Agent] Dropping response', id, 'after', entry.attempts, 'failed deliveries');
        delete outbox[id];
      } else {
        // Exponential backoff, capped at 30s.
        entry.nextAt = Date.now() + Math.min(30000, 1000 * 2 ** entry.attempts);
      }
      persistOutbox();
    }
  } finally {
    _flushingOutbox = false;
  }
}

// â”€â”€â”€ reCAPTCHA Solving â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function requestCaptchaFromTab(tabId, requestId, pageAction) {
  // Reloading an unpacked extension does not inject its new MAIN-world script
  // into tabs that were already open. Always ensure both halves of the bridge
  // exist before sending the request; both scripts have idempotent guards.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['injected.js'],
    world: 'MAIN',
  });
  await sleep(100);
  return chrome.tabs.sendMessage(tabId, {
    type: 'GET_CAPTCHA',
    requestId,
    pageAction,
  });
}

async function solveCaptcha(requestId, captchaAction) {
  let tab = await getOrOpenCaptchaTab();
  if (!tab) return { error: 'NO_FLOW_TAB' };

  try {
    let resp = await Promise.race([
      requestCaptchaFromTab(tab.id, requestId, captchaAction),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 50000)),
    ]);
    // Do not reload the user's project or loop on a missing page script.
    // Verification that needs user interaction must be completed in Flow.
    return resp;
  } catch (e) {
    return { error: e.message };
  }
}

async function handleSolveCaptcha(msg) {
  const { id, params } = msg;
  const result = await solveCaptcha(id, params?.captchaAction || 'VIDEO_GENERATION');

  // Standalone captcha solve counts as captcha-consuming
  metrics.requestCount++;
  if (result?.token) {
    metrics.successCount++;
  } else {
    metrics.failedCount++;
    metrics.lastError = result?.error || 'NO_TOKEN';
  }
  chrome.storage.local.set({ metrics });

  sendToAgent({ id, result });
}

// â”€â”€â”€ API Request Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function handleTrpcRequest(msg) {
  const { id, params } = msg;
  const { url, method = 'POST', headers = {}, body } = params;

  if (!url || (!url.startsWith('https://flow.google.com/') && !url.startsWith('https://labs.google/'))) {
    sendToAgent({ id, error: 'INVALID_TRPC_URL' });
    return;
  }

  setState('running');
  // TRPC calls don't consume captcha and are silent â€” no metrics, no request log.

  const fetchHeaders = { 'Content-Type': 'application/json', ...headers };
  if (flowKey) {
    fetchHeaders['authorization'] = `Bearer ${flowKey}`;
  }

  try {
    const resp = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    const data = await resp.json();
    sendToAgent({ id, status: resp.status, data });
  } catch (e) {
    console.error('[Flow Agent] tRPC request failed:', e);
    sendToAgent({ id, error: e.message || 'TRPC_FETCH_FAILED' });
  } finally {
    setState('idle');
  }
}


async function handleUploadVideo(msg) {
  const { id, params } = msg;
  const { videoBase64, projectId, videoSize } = params;

  try {
    const tabs = await chrome.tabs.query({ url: FLOW_TAB_URLS });
    if (!tabs.length) {
      sendToAgent({ id, error: 'NO_FLOW_TAB' });
      return;
    }

    const size = videoSize || (videoBase64 ? Math.floor(videoBase64.length * 3 / 4) : 0);

    // Get session URL via page context XHR (needs session cookies)
    const startResults = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      world: 'MAIN',
      func: (projId, sz) => {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/fx/api/upload-video?action=start');
          xhr.setRequestHeader('X-Upload-Project-Id', projId);
          xhr.setRequestHeader('X-Upload-Content-Type', 'video/mp4');
          xhr.setRequestHeader('X-Upload-Content-Length', sz.toString());
          xhr.withCredentials = true;
          xhr.onload = () => {
            let data;
            try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
            resolve({
              sessionUrl: data.sessionUrl || xhr.getResponseHeader('X-Upload-Session-Url') || '',
              status: xhr.status,
            });
          };
          xhr.onerror = () => resolve({ error: 'POST_FAILED' });
          xhr.send();
        });
      },
      args: [projectId, size],
    });

    const step1 = startResults?.[0]?.result;
    if (!step1 || step1.error || !step1.sessionUrl) {
      sendToAgent({ id, error: step1?.error || 'NO_SESSION_URL' });
      return;
    }

    // Return sessionUrl + token â€” caller handles PUT
    sendToAgent({
      id,
      result: {
        sessionUrl: step1.sessionUrl,
        token: flowKey || '',
      },
    });
  } catch (e) {
    sendToAgent({ id, error: `UPLOAD_ERROR: ${e.message}` });
  }
}

async function handleApiRequest(msg) {
  const { id, params } = msg;
  const { url, method, headers, body, captchaAction } = params;

  if (!url) {
    sendToAgent({ id, error: 'MISSING_URL' });
    return;
  }

  if (!url.startsWith('https://aisandbox-pa.googleapis.com/')) {
    sendToAgent({ id, error: 'INVALID_URL' });
    return;
  }

  const hasSelectedTabToken = isTokenFresh() && flowKeySource && flowKeySource !== 'labs_session';
  if (selectedFlowUrl?.startsWith('https://flow.google.com/') && !hasSelectedTabToken) {
    await refreshSelectedAccountSession(false);
    if (flowSessionStatus.status !== 'ready' || !flowKey) {
      sendToAgent({ id, status: 401, error: 'FLOW_ACCOUNT_SESSION_UNVERIFIED' });
      return;
    }
  }
  const requestAccount = selectedFlowAccount;
  const requestFlowKey = flowKey;

  setState('running');
  const hasCaptcha = !!captchaAction;
  if (hasCaptcha) metrics.requestCount++;

  const logId = id;
  const logType = _classifyApiUrl(url);
  if (_VISIBLE_TYPES.has(logType)) {
    const payloadSummary = body ? JSON.stringify(body).slice(0, 200) : null;
    addRequestLog({ id: logId, type: logType, time: new Date().toISOString(), status: 'processing', error: null, outputUrl: null, url, payloadSummary });
  }

  try {
    // Step 1: Solve captcha if needed
    let captchaToken = null;
    if (captchaAction) {
      const captchaResult = await solveCaptcha(id, captchaAction);
      captchaToken = captchaResult?.token || null;
      if (!captchaToken) {
        // Cannot proceed without captcha â€” API will 403
        const err = captchaResult?.error || 'CAPTCHA_FAILED';
        console.error(`[Flow Agent] Captcha failed for ${captchaAction}: ${err}`);
        sendToAgent({ id, status: 403, error: `CAPTCHA_FAILED: ${err}` });
        if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `CAPTCHA_FAILED: ${err}`; }
        chrome.storage.local.set({ metrics });
        updateRequestLog(logId, { status: 'failed', error: `CAPTCHA_FAILED: ${err}` });
        setState('idle');
        return;
      }
    }

    // Step 2: Inject captcha token into body
    let finalBody = body;
    if (captchaToken && finalBody) {
      finalBody = JSON.parse(JSON.stringify(finalBody)); // deep clone
      if (finalBody.clientContext?.recaptchaContext) {
        finalBody.clientContext.recaptchaContext.token = captchaToken;
      }
      if (finalBody.requests && Array.isArray(finalBody.requests)) {
        for (const req of finalBody.requests) {
          if (req.clientContext?.recaptchaContext) {
            req.clientContext.recaptchaContext.token = captchaToken;
          }
        }
      }
    }

    // Step 3: Use flowKey for auth
    const activeFlowKey = flowKey;
    if (requestAccount !== selectedFlowAccount || requestFlowKey !== activeFlowKey) {
      sendToAgent({ id, status: 409, error: 'FLOW_ACCOUNT_CHANGED' });
      setState('idle');
      return;
    }
    if (!activeFlowKey) {
      sendToAgent({ id, status: 503, error: 'NO_FLOW_KEY' });
      if (hasCaptcha) { metrics.failedCount++; metrics.lastError = 'NO_FLOW_KEY'; }
      chrome.storage.local.set({ metrics });
      updateRequestLog(logId, { status: 'failed', error: 'NO_FLOW_KEY' });
      setState('idle');
      return;
    }

    const fetchHeaders = { ...(headers || {}) };
    fetchHeaders['authorization'] = `Bearer ${activeFlowKey}`;

    // Step 4: Make the API call from browser context
    const response = await fetch(url, {
      method: method || 'POST',
      headers: fetchHeaders,
      credentials: 'include',
      body: method === 'GET' ? undefined : JSON.stringify(finalBody),
    });

    let responseData;
    const responseText = await response.text();
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    // Self-heal: a 401 means Google invalidated our cached token (usually via
    // inactivity, before our 50-min freshness window). Drop it so the very next
    // request / refresh forces a genuine tab reload + re-capture instead of
    // resending the same dead token.
    if (response.status === 401) {
      console.warn('[Flow Agent] 401 UNAUTHENTICATED â€” invalidating cached token to force refresh');
      rejectedFlowToken = activeFlowKey;
      await chrome.storage.local.set({ rejectedFlowToken });
      await invalidateFlowSession();
    }

    sendToAgent({
      id,
      status: response.status,
      data: responseData,
    });

    const responseSummary = responseText ? responseText.slice(0, 300) : null;
    if (response.ok) {
      if (hasCaptcha) { metrics.successCount++; metrics.lastError = null; }
      updateRequestLog(logId, { status: 'success', httpStatus: response.status, responseSummary });
    } else {
      if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `API_${response.status}`; }
      updateRequestLog(logId, { status: 'failed', error: `API_${response.status}`, httpStatus: response.status, responseSummary });
    }
  } catch (e) {
    sendToAgent({
      id,
      status: 500,
      error: e.message || 'API_REQUEST_FAILED',
    });
    if (hasCaptcha) { metrics.failedCount++; metrics.lastError = e.message; }
    updateRequestLog(logId, { status: 'failed', error: e.message || 'API_REQUEST_FAILED' });
  }

  chrome.storage.local.set({ metrics });
  setState('idle');
}

async function handleGetMediaUrl(msg) {
  const { id, params } = msg;
  const mediaId = params?.media_id;
  if (!mediaId) { sendToAgent({ id, error: 'MISSING_MEDIA_ID' }); return; }
  try {
    const url = new URL('https://labs.google/fx/api/trpc/media.getMediaUrlRedirect');
    url.searchParams.set('name', mediaId);
    const response = await fetch(url.toString(), { credentials: 'include', redirect: 'follow' });
    if (!response.ok) { sendToAgent({ id, status: response.status, error: `MEDIA_URL_HTTP_${response.status}` }); return; }
    sendToAgent({ id, status: 200, result: { url: response.url } });
  } catch (error) {
    sendToAgent({ id, error: `MEDIA_URL_FAILED: ${error.message}` });
  }
}

// â”€â”€â”€ State & Popup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function setState(newState) {
  state = newState;
  const badges = { idle: 'â—', running: 'â–¶', off: 'â—‹' };
  const iconPrefix = state === 'running' ? 'running' : state === 'idle' ? 'ready' : 'off';
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setTitle({
    title: state === 'running'
      ? 'Flow Agent đang tạo nội dung'
      : state === 'idle'
        ? 'Flow Agent đã kết nối'
        : 'Flow Agent chưa kết nối',
  }).catch(() => {});
  chrome.action.setIcon({
    path: {
      16: `icon-${iconPrefix}-16.png`,
      48: `icon-${iconPrefix}-48.png`,
      128: `icon-${iconPrefix}-128.png`,
    },
  }).catch(() => {});
  broadcastStatus();
}

function broadcastStatus() {
  chrome.runtime.sendMessage({ type: 'STATUS_PUSH' }).catch(() => { });
}

chrome.runtime.onMessage.addListener((msg, _, reply) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    if (ws) {
      try { ws.close(); } catch { }
    }
    connectToAgent();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'STATUS') {
    reply({
      connected: httpConnected || ws?.readyState === WebSocket.OPEN,
      agentConnected: httpConnected || ws?.readyState === WebSocket.OPEN,
      httpConnected,
      transport: httpConnected ? 'http' : (ws?.readyState === WebSocket.OPEN ? 'ws' : 'none'),
      flowKeyPresent: !!flowKey,
      manualDisconnect,
      tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
      metrics: { ...metrics },
      state,
      clientId: extensionClientId,
    });
  }

  if (msg.type === 'DISCONNECT') {
    manualDisconnect = true;
    httpConnected = false;
    if (httpPollTimer) clearTimeout(httpPollTimer);
    if (ws) ws.close();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'RECONNECT') {
    manualDisconnect = false;
    connectToAgent();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'REQUEST_LOG') {
    reply({ log: requestLog });
    return true;
  }

  if (msg.type === 'GET_CLIENT_CREDITS') {
    const host = String(connectedServerHost || CONFIG.DEFAULT_SERVER_HOST).trim().replace(/\/$/, '');
    const hostWithoutScheme = host.replace(/^https?:\/\//i, '');
    const local = /^(127\.0\.0\.1|localhost|192\.168\.|10\.)(:|$)/.test(hostWithoutScheme);
    const base = /^https?:\/\//i.test(host) ? host : `${local ? 'http' : 'https'}://${host}`;
    chrome.storage.local.get(['clientId']).then(({ clientId }) => fetch(`${base}/v1/credits`, {
      headers: (extensionClientId || clientId) ? { 'X-Client-Id': extensionClientId || clientId } : {},
    }))
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
        reply(data);
      })
      .catch((error) => {
        console.error('[Flow Agent] Credit request failed:', error);
        reply({ error: error.message });
      });
    return true;
  }

  if (msg.type === 'CLEAR_REQUEST_LOG') {
    requestLog = [];
    chrome.storage.local.remove('requestLog').then(() => {
      broadcastRequestLog();
      reply({ ok: true });
    });
    return true;
  }

  if (msg.type === 'ADD_HISTORY') {
    addRequestLog({
      id: msg.entry?.id || `popup-${Date.now()}`,
      time: msg.entry?.time || new Date().toISOString(),
      type: msg.entry?.type || 'GEN_IMG',
      status: msg.entry?.status || 'success',
      url: msg.entry?.url || '',
      payloadSummary: msg.entry?.prompt || '',
      responseSummary: msg.entry?.url ? 'Generated result ready' : 'Generation completed',
    });
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'OPEN_FLOW_TAB') {
    getOrOpenFlowTab().then(async (tab) => {
      await chrome.tabs.update(tab.id, { active: true });
      reply({ ok: true, tabId: tab.id });
    }).catch((e) => reply({ error: e.message }));
    return true;
  }

  if (msg.type === 'REFRESH_TOKEN') {
    captureTokenFromFlowTab(true)
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ error: e.message }));
    return true;
  }

  if (msg.type === 'TEST_CAPTCHA') {
    solveCaptcha(`test-${Date.now()}`, msg.pageAction || 'IMAGE_GENERATION')
      .then((r) => reply(r))
      .catch((e) => reply({ error: e.message }));
    return true;
  }

  if (msg.type === 'TRPC_MEDIA_URLS') {
    handleTrpcMediaUrls(msg.trpcUrl, msg.body);
    reply({ ok: true });
    return true;
  }

  return true;
});

// â”€â”€â”€ TRPC Media URL Extractor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleTrpcMediaUrls(trpcUrl, bodyText) {
  try {
    // Extract all fresh GCS signed URLs
    const urlRegex = /https:\/\/(?:storage\.googleapis\.com\/ai-sandbox-videofx|flow-content\.google\/(?:image|video))\/[0-9a-f-]{36}\?[^"'\s]+/g;
    const matches = bodyText.match(urlRegex) || [];
    if (!matches.length) return;

    // Deduplicate and parse
    const urlMap = {};
    for (const rawUrl of matches) {
      // Unescape JSON-escaped URLs
      const url = rawUrl.replace(/\\u0026/g, '&').replace(/\\/g, '');
      const mediaMatch = url.match(/\/(image|video)\/([0-9a-f-]{36})\?/);
      if (mediaMatch) {
        const [, mediaType, mediaId] = mediaMatch;
        // Keep last occurrence (freshest)
        urlMap[mediaId] = { mediaType, url, mediaId };
      }
    }

    const entries = Object.values(urlMap);
    if (!entries.length) return;

    console.log(`[Flow Agent] Captured ${entries.length} fresh media URLs from TRPC`);
    // URL refresh is silent â€” don't show in request log

    // Forward to agent for DB update
    sendToAgent({ type: 'media_urls_refresh', urls: entries, session_id: extensionClientId });
  } catch (e) {
    console.error('[Flow Agent] Failed to extract TRPC media URLs:', e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// â”€â”€â”€ Human-like Telemetry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Periodically send tracking events to Google's analytics endpoints
// to mimic normal browser behavior.

const _UA = navigator.userAgent;
let _telemetrySessionId = `;${Date.now()}`;

function _rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function _buildBatchLogPayload() {
  const events = [];
  const types = ['FLOW_IMAGE_LATENCY', 'FLOW_VIDEO_LATENCY'];
  const count = _rand(1, 3);
  for (let i = 0; i < count; i++) {
    events.push({
      event: types[_rand(0, types.length - 1)],
      eventProperties: [
        { key: 'CURRENT_TIME_MS', doubleValue: Date.now() },
        { key: 'DURATION_MS', doubleValue: _rand(150, 800) },
        { key: 'USER_AGENT', stringValue: _UA },
        { key: 'IS_DESKTOP', booleanValue: true },
      ],
      eventMetadata: { sessionId: _telemetrySessionId },
      eventTime: new Date().toISOString(),
    });
  }
  return { appEvents: events };
}

function _buildFrontendEventsPayload() {
  const eventTypes = [
    'FLOW_IMAGE_LATENCY', 'FLOW_VIDEO_LATENCY', 'GRID_SCROLL_DEPTH',
    'FLOW_PROJECT_OPEN', 'FLOW_SCENE_VIEW',
  ];
  const count = _rand(1, 4);
  const events = [];
  for (let i = 0; i < count; i++) {
    const et = eventTypes[_rand(0, eventTypes.length - 1)];
    const params = {
      USER_AGENT: { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: _UA },
      IS_DESKTOP: { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: 'true' },
    };
    if (et.includes('LATENCY')) {
      params.CURRENT_TIME_MS = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: String(Date.now()) };
      params.DURATION_MS = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: String(_rand(100, 600)) };
    }
    if (et === 'GRID_SCROLL_DEPTH') {
      params.MEDIA_GENERATION_PAYGATE_TIER = { '@type': 'type.googleapis.com/google.protobuf.StringValue', value: 'PAYGATE_TIER_TWO' };
    }
    events.push({
      eventType: et,
      metadata: {
        sessionId: _telemetrySessionId,
        createTime: new Date().toISOString(),
        additionalParams: params,
      },
    });
  }
  return { events };
}

async function sendTelemetry() {
  if (!flowKey || state === 'off') return;

  const headers = {
    'Content-Type': 'text/plain;charset=UTF-8',
    'authorization': `Bearer ${flowKey}`,
  };

  // Telemetry is silent â€” don't show in request log
  try {
    if (Math.random() < 0.5) {
      await fetch(`https://aisandbox-pa.googleapis.com/v1:batchLog`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify(_buildBatchLogPayload()),
      });
    } else {
      await fetch(`https://aisandbox-pa.googleapis.com/v1/flow:batchLogFrontendEvents`, {
        method: 'POST', headers, credentials: 'include',
        body: JSON.stringify(_buildFrontendEventsPayload()),
      });
    }
  } catch { }
}

// Send telemetry at random intervals (45-120s) to look organic
function scheduleTelemetry() {
  const delay = _rand(45, 120) * 1000;
  setTimeout(async () => {
    await sendTelemetry();
    scheduleTelemetry(); // reschedule with new random interval
  }, delay);
}

// Refresh session ID every ~30min like a real user
setInterval(() => { _telemetrySessionId = `;${Date.now()}`; }, _rand(25, 35) * 60 * 1000);

scheduleTelemetry();

console.log('[Flow Agent] Extension loaded');
