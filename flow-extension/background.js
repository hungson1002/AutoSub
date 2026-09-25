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
let _openingFlowTab = false;
let linkedAccountsRefreshTask = null;

// Multi-account image workers. Each linked Flow tab is exposed to Flow Agent as
// its own virtual browser client, so AutoSub can target it with X-Client-Id.
// The legacy selected account above remains the primary client for backwards
// compatibility; linked accounts never overwrite its token/session.
let linkedFlowAccounts = [];
const linkedPollTimers = new Map();
const linkedPollBusy = new Set();
const linkedCommandQueues = new Map();
const linkedTabRepairTasks = new Map();
const linkedTabEnsureLocks = new Map();
let linkedTabHealthSweepRunning = false;
// Each linked account is backed by its own isolated Flow worker. Keep two
// commands in flight so one account can use both image lanes safely.
const MAX_LINKED_COMMANDS_PER_ACCOUNT = 2;
const FLOW_WORKER_PORT_MIN = 8101;
const FLOW_WORKER_PORT_MAX = 8199;

function assignLinkedWorkerPort(account) {
  const current = Number(account?.workerPort);
  if (Number.isInteger(current) && current >= FLOW_WORKER_PORT_MIN && current <= FLOW_WORKER_PORT_MAX) return current;
  const used = new Set(linkedFlowAccounts.filter((item) => item !== account).map((item) => Number(item.workerPort)).filter((port) => Number.isInteger(port)));
  for (let port = FLOW_WORKER_PORT_MIN; port <= FLOW_WORKER_PORT_MAX; port += 1) {
    if (!used.has(port)) {
      account.workerPort = port;
      return port;
    }
  }
  throw new Error('NO_FLOW_WORKER_PORT_AVAILABLE');
}

function normalizeLinkedWorkerPorts() {
  const used = new Set();
  for (const account of linkedFlowAccounts) {
    let port = Number(account.workerPort);
    if (!Number.isInteger(port) || port < FLOW_WORKER_PORT_MIN || port > FLOW_WORKER_PORT_MAX || used.has(port)) {
      port = 0;
      for (let candidate = FLOW_WORKER_PORT_MIN; candidate <= FLOW_WORKER_PORT_MAX; candidate += 1) {
        if (!used.has(candidate)) { port = candidate; break; }
      }
      account.workerPort = port;
    }
    if (port) used.add(port);
  }
}

function linkedAccountForTab(tabId) {
  return linkedFlowAccounts.find((account) => account.tabId === tabId) || null;
}

function canonicalFlowAccount(value) {
  return String(value || '').replace(/:default$/i, ':0');
}

function ensureLinkedAccountForTab(tabId, flowUrl) {
  const flowAccount = flowAccountFromUrl(flowUrl);
  if (!tabId || !flowAccount) return null;
  let account = linkedFlowAccounts.find((item) =>
    canonicalFlowAccount(item.flowAccount) === canonicalFlowAccount(flowAccount)
  );
  if (account) {
    // Persisted linked accounts must be allowed to re-bind after Opera/extension
    // restarts even when the primary Flow tab is currently closed.
    if (tabId === selectedFlowTabId) return null;
    if (selectedFlowTabId !== null
      && canonicalFlowAccount(flowAccount) === canonicalFlowAccount(selectedFlowAccount)) return null;
    account.tabId = tabId;
    account.flowUrl = flowUrl;
    account.flowAccount = flowAccount;
    void persistLinkedAccounts();
    broadcastStatus();
    return account;
  }
  if (selectedFlowTabId === null) return null;
  if (canonicalFlowAccount(flowAccount) === canonicalFlowAccount(selectedFlowAccount)) return null;
  if (!account) {
    const id = newLinkedAccountId();
    account = {
      id,
      clientId: `account-${id.slice(-12)}`,
      email: null,
      flowUrl,
      flowAccount,
      tabId,
      flowKey: null,
      flowKeySource: null,
      tokenCapturedAt: null,
      callbackSecret: null,
      callbackUrl: null,
      pollIntervalMs: 1000,
      httpConnected: false,
      activeRequests: 0,
    };
    linkedFlowAccounts.push(account);
    assignLinkedWorkerPort(account);
  }
  void persistLinkedAccounts();
  broadcastStatus();
  return account;
}

function publicLinkedAccount(account) {
  return {
    id: account.id,
    clientId: account.clientId,
    email: normalizeStoredFlowEmail(account.email),
    flowUrl: account.flowUrl || null,
    tabId: account.tabId ?? null,
    connected: !!account.httpConnected,
    tokenReady: !!account.flowKey,
    tokenAge: account.tokenCapturedAt ? Date.now() - account.tokenCapturedAt : null,
    activeRequests: account.activeRequests || 0,
    workerPort: Number(account.workerPort) || null,
  };
}

function persistLinkedAccounts() {
  return chrome.storage.local.set({
    linkedFlowAccounts: linkedFlowAccounts.map((account) => ({
      id: account.id,
      clientId: account.clientId,
      email: normalizeStoredFlowEmail(account.email),
      flowUrl: account.flowUrl || null,
      tabId: account.tabId ?? null,
      flowAccount: account.flowAccount || null,
      flowKey: account.flowKey || null,
      tokenCapturedAt: account.tokenCapturedAt || null,
      workerPort: Number(account.workerPort) || null,
    })),
  });
}

// Never expose stale or malformed account labels from extension storage.
function normalizeStoredFlowEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

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
  if (tab?.incognito) {
    console.warn('[Flow Agent] Bỏ qua tab ẩn danh; Flow Agent cần tab Flow trong profile thường để đồng bộ token.');
    return false;
  }
  const account = flowAccountFromUrl(tab.url);
  if (!account || tab.id === captchaTabId || tab.id === accountSyncTabId) return false;
  const previousAccount = selectedFlowAccount;
  const changed = selectedFlowTabId !== tab.id || selectedFlowAccount !== account;
  const identityChanged = !!previousAccount
    && canonicalFlowAccount(previousAccount) !== canonicalFlowAccount(account);
  selectedFlowTabId = tab.id;
  selectedFlowAccount = account;
  selectedFlowUrl = tab.url;
  if (identityChanged) {
    // Re-opening the SAME Google account in another tab must not throw away a
    // perfectly good bearer token. Only a true /u/N account change invalidates
    // the primary session.
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
let reconnectTimer = null;
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
    'linkedFlowAccounts',
    'manualDisconnect',
  ]);
  if (data.metrics) Object.assign(metrics, data.metrics);
  if (data.callbackSecret) callbackSecret = data.callbackSecret;
  if (data.callbackUrl) callbackUrl = normalizeCallbackUrl(data.callbackUrl);
  if (Array.isArray(data.requestLog)) requestLog = data.requestLog.slice(0, 100);
  if (data.selectedFlowAccount) selectedFlowAccount = data.selectedFlowAccount;
  if (data.selectedFlowUrl) selectedFlowUrl = data.selectedFlowUrl;
  if (typeof data.rejectedFlowToken === 'string') rejectedFlowToken = data.rejectedFlowToken;
  manualDisconnect = data.manualDisconnect === true;
  // Same-profile multi-account mode: keep one linked Flow tab per Google
  // account (/u/N) and bind tokens to the exact tab that produced them. This
  // keeps one Opera profile while still exposing each signed-in account as an
  // independent Flow Agent client.
  if (Array.isArray(data.linkedFlowAccounts)) {
    linkedFlowAccounts = data.linkedFlowAccounts
      .filter((account) => account && account.id && account.clientId)
      .map((account) => ({
        ...account,
        email: normalizeStoredFlowEmail(account.email),
        httpConnected: false,
        callbackSecret: null,
        callbackUrl: null,
        pollIntervalMs: 1000,
        activeRequests: 0,
      }));
    normalizeLinkedWorkerPorts();
    await persistLinkedAccounts();
  }

  // Browser sign-in may have changed while the worker was stopped.
  flowKey = null;
  metrics.tokenCapturedAt = null;
  await chrome.storage.local.remove('accountTokens');
  await chrome.storage.local.remove('flowKey');

  // Discover existing open Flow tab if any
  try {
    if (chrome.tabs?.query) {
      const flowTabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((t) => t.id !== captchaTabId && !t.incognito);
      const isPersistedLinked = (tab) => !!tab.url && linkedFlowAccounts.some((account) =>
        canonicalFlowAccount(account.flowAccount) === canonicalFlowAccount(flowAccountFromUrl(tab.url))
      );
      const primaryTabs = flowTabs.filter((tab) => !isPersistedLinked(tab));
      const rememberedPrimary = selectedFlowAccount
        ? primaryTabs.find((tab) => tab.url
          && canonicalFlowAccount(flowAccountFromUrl(tab.url)) === canonicalFlowAccount(selectedFlowAccount))
        : null;
      const active = rememberedPrimary
        || primaryTabs.find((t) => t.active)
        || primaryTabs.find((t) => t.id === selectedFlowTabId)
        || (primaryTabs.length === 1 ? primaryTabs[0] : null);
      if (active) selectFlowAccount(active);
      for (const tab of flowTabs) {
        if (active && tab.id === active.id || !tab.url) continue;
        const linked = ensureLinkedAccountForTab(tab.id, tab.url);
        if (linked) void refreshLinkedAccountIdentity(linked);
      }
    }
  } catch (err) {
    console.warn('[Flow Agent] Error querying flow tabs on init:', err);
  }

  await loadOutbox();
  connectToAgent();
  setTimeout(() => {
    restoreLinkedAccountSessions()
      .then(() => healthCheckLinkedTabs())
      .catch(() => {});
  }, 700);
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

function captureLinkedAccountToken(account, value, source = 'network') {
  const bearerMatch = String(value || '').match(/^Bearer\s+(.+)$/i);
  if (!account || !bearerMatch) return false;
  const token = bearerMatch[1].trim();
  if (token.length < 32 || /\s/.test(token)) return false;
  account.flowKey = token;
  account.flowKeySource = source;
  account.tokenCapturedAt = Date.now();
  account.flowAccount = flowAccountFromUrl(account.flowUrl) || account.flowAccount || null;
  void persistLinkedAccounts();
  // Re-register even when the HTTP poll session already exists: a linked
  // account can connect tokenless first, then capture its bearer token later.
  // The second hello updates Flow Agent's per-client token map in-place.
  void connectLinkedAccount(account, true);
  broadcastStatus();
  return true;
}

async function refreshLinkedAccountIdentity(account) {
  if (!account?.tabId) return;
  try {
    const tab = await chrome.tabs.get(account.tabId);
    if (!tab?.url || !isFlowUrl(tab.url)) return;
    account.flowUrl = tab.url;
    account.flowAccount = flowAccountFromUrl(tab.url);
    const identity = await readFlowIdentity(account.tabId).catch(() => ({}));
    const email = normalizeFlowEmail(identity?.email);
    if (email) account.email = email;
    await persistLinkedAccounts();
    broadcastStatus();
  } catch { /* Tab may be between Google login redirects. */ }
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
    const linked = linkedAccountForTab(details.tabId);
    if (linked) {
      captureLinkedAccountToken(linked, authHeader?.value, source);
    } else if (details.tabId === selectedFlowTabId) {
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
  if (msg?.type === 'AUTOSUB_WORKER_ID') {
    const workerId = String(msg.workerId || '').trim();
    if (!/^[a-z0-9]{8,32}$/i.test(workerId)) return;
    const clientId = `flow-worker-${workerId}`;
    chrome.storage.local.get(['clientId'], async (stored) => {
      if (stored.clientId === clientId && extensionClientId === clientId) return;
      await chrome.storage.local.set({ clientId, autosubWorkerId: workerId });
      extensionClientId = clientId;
      httpConnected = false;
      if (httpPollTimer) clearTimeout(httpPollTimer);
      if (ws) { try { ws.close(); } catch {} }
      setTimeout(() => connectToAgent(), 100);
    });
    return;
  }
  const senderUrl = sender.url || sender.tab?.url;
  if (!sender.tab || !isFlowUrl(senderUrl)) return;
  if (sender.tab.id === accountSyncTabId) {
    if (msg?.type === 'FLOW_TAB_ACTIVE' || msg?.type === 'FLOW_MAIN_READY') {
      const target = linkedAccountSyncTargetId
        ? linkedFlowAccounts.find((account) => account.id === linkedAccountSyncTargetId)
        : null;
      if (target) {
        void refreshLinkedAccountSession(target, false).then((result) => {
          if (!target.flowKey && result?.status !== 'ready') {
            setTimeout(() => refreshLinkedAccountSession(target, false).catch(() => {}), 1500);
          }
        });
      } else {
        void refreshSelectedAccountSession(false);
      }
    }
    return;
  }
  if (msg?.type === 'FLOW_TAB_ACTIVE') {
    const linked = linkedAccountForTab(sender.tab.id) || ensureLinkedAccountForTab(sender.tab.id, senderUrl);
    if (linked) {
      linked.flowUrl = senderUrl;
      linked.flowAccount = flowAccountFromUrl(senderUrl);
      const pending = pendingTabTokens.get(sender.tab.id);
      pendingTabTokens.delete(sender.tab.id);
      if (pending && Date.now() - pending.at < 30000) captureLinkedAccountToken(linked, pending.authorization, pending.source);
      void refreshLinkedAccountIdentity(linked);
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
  const linked = linkedAccountForTab(sender.tab.id);
  if (linked) {
    linked.flowUrl = senderUrl;
    if (msg?.type === 'FLOW_AUTH_TOKEN') {
      captureLinkedAccountToken(linked, msg.authorization, msg.apiHost === 'aisandbox' ? 'aisandbox' : 'page');
    } else if (msg?.type === 'FLOW_MAIN_READY') {
      void refreshLinkedAccountIdentity(linked);
    }
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
async function _getOrOpenFlowTab(allowCreate = true) {
  const flowTabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((tab) => tab.id !== captchaTabId && !tab.incognito);
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

  const tabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((tab) => !tab.incognito);
  if (tabs.length) {
    workTabId = tabs[0].id;
    workTabCreatedByExtension = false;
    return tabs[0];
  }

  if (!allowCreate) return null;

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

async function getOrOpenFlowTab(allowCreate = true) {
  if (flowTabOpening) return flowTabOpening;
  flowTabOpening = _getOrOpenFlowTab(allowCreate);
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

async function captureTokenFromFlowTab(force = false, allowCreate = true, preferredTabId = null) {
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
    const tab = preferredTabId === null
      ? await getOrOpenFlowTab(allowCreate)
      : await chrome.tabs.get(preferredTabId).catch(() => null);
    if (!tab) {
      console.log('[Flow Agent] No normal Flow tab is open; skipped non-interactive token refresh');
      return;
    }
    if (linkedAccountForTab(tab.id)) {
      console.log('[Flow Agent] Skipped primary token refresh on a linked-account tab');
      return;
    }
    if (force) await invalidateFlowSession();
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
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
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

const AUTOSUB_MULTI_PROMPT_PREFIX = '__AUTOSUB_MULTI_PROMPT_V1__:';

function expandAutoSubMultiPrompt(body) {
  if (!body || !Array.isArray(body.requests) || body.requests.length < 2) return body;
  const firstText = body.requests[0]?.structuredPrompt?.parts?.[0]?.text;
  if (typeof firstText !== 'string' || !firstText.startsWith(AUTOSUB_MULTI_PROMPT_PREFIX)) return body;
  try {
    const encoded = firstText.slice(AUTOSUB_MULTI_PROMPT_PREFIX.length);
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const prompts = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(prompts) || prompts.length !== body.requests.length || prompts.some((prompt) => typeof prompt !== 'string' || prompt.trim().length < 8)) {
      throw new Error('invalid prompt batch');
    }
    const next = JSON.parse(JSON.stringify(body));
    next.requests.forEach((request, index) => {
      request.structuredPrompt = { ...(request.structuredPrompt || {}), parts: [{ text: prompts[index].trim() }] };
    });
    return next;
  } catch (error) {
    console.error('[Flow Agent] AutoSub multi-prompt decode failed:', error);
    return body;
  }
}

const MAX_API_REQUESTS_PER_SESSION = 2;
// Browser-side fetches can occasionally remain pending forever even after the
// AutoSub HTTP caller has already timed out. Bound every Google API proxy call
// so the two per-account worker slots are always released again.
const FLOW_API_FETCH_TIMEOUT_MS = 75_000;
let activeApiRequests = 0;
const apiRequestQueue = [];

function pumpApiRequests() {
  while (activeApiRequests < MAX_API_REQUESTS_PER_SESSION && apiRequestQueue.length) {
    const item = apiRequestQueue.shift();
    activeApiRequests += 1;
    Promise.resolve(handleApiRequest(item.msg))
      .then(item.resolve, item.reject)
      .finally(() => {
        activeApiRequests = Math.max(0, activeApiRequests - 1);
        pumpApiRequests();
      });
  }
}

function enqueueApiRequest(msg) {
  return new Promise((resolve, reject) => {
    apiRequestQueue.push({ msg, resolve, reject });
    pumpApiRequests();
  });
}

async function handleAgentCommand(msg) {
  if (!msg || typeof msg !== 'object') return;
  try {
    if (msg.method === 'api_request') {
      // Allow exactly two Google Flow API calls per linked account tab/client.
      // This matches AutoSub's two image slots per account while still bounding
      // concurrency tightly enough to avoid the old unbounded retry storms.
      await enqueueApiRequest(msg);
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
        // Server-side refresh is a non-interactive health check. Do not open
        // an OAuth tab when no normal Flow tab/session is available.
        await refreshSelectedAccountSession(false);
        if (isTokenFresh() && flowKeySource !== 'labs_session') return;
        if (['account_mismatch', 'sign_in_required'].includes(flowSessionStatus.status)) return;
        // A background refresh must never create a visible Flow tab. The user
        // can open Flow explicitly, after which this refresh reuses it.
        await captureTokenFromFlowTab(force, false);
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

function linkedAgentHttpBase(account) {
  const port = assignLinkedWorkerPort(account);
  const base = new URL(agentHttpBase());
  base.protocol = 'http:';
  base.hostname = '127.0.0.1';
  base.port = String(port);
  return base.origin;
}

async function ensureLinkedWorkerRuntime(account) {
  const workerPort = assignLinkedWorkerPort(account);
  const response = await fetch('http://127.0.0.1:8787/api/ai-video/flow-workers/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: account.clientId, workerPort }),
  });
  if (!response.ok) throw new Error(`WORKER_SUPERVISOR_HTTP_${response.status}`);
  const body = await response.json().catch(() => ({}));
  const confirmedPort = Number(body?.worker?.port);
  if (Number.isInteger(confirmedPort) && confirmedPort >= FLOW_WORKER_PORT_MIN && confirmedPort <= FLOW_WORKER_PORT_MAX) account.workerPort = confirmedPort;
  return linkedAgentHttpBase(account);
}

function scheduleLinkedPoll(account, delay = account.pollIntervalMs || 1000) {
  const existing = linkedPollTimers.get(account.id);
  if (existing) clearTimeout(existing);
  if (!account.httpConnected || manualDisconnect) return;
  linkedPollTimers.set(account.id, setTimeout(() => pollLinkedAccount(account.id), delay));
}

async function connectLinkedAccount(account, force = false) {
  if (!account || manualDisconnect || (account.httpConnected && !force)) return;
  try {
    const workerBase = await ensureLinkedWorkerRuntime(account);
    const response = await fetch(`${workerBase}/api/ext/hello`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: account.clientId,
        clientId: account.clientId,
        flowKey: account.flowKey || '',
        flowKeyPresent: !!account.flowKey,
        extension_version: chrome.runtime.getManifest().version,
        selected_flow_url: account.flowUrl || '',
        account_session: { status: account.flowKey ? 'ready' : 'connected', email: account.email || null, source: 'linked_flow_tab' },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    account.callbackSecret = data.secret;
    account.callbackUrl = new URL(data.callback_url, workerBase).toString();
    account.pollIntervalMs = Math.max(250, Number(data.poll_interval_ms) || 1000);
    account.httpConnected = true;
    scheduleLinkedPoll(account, 0);
    broadcastStatus();
  } catch (error) {
    account.httpConnected = false;
    console.warn(`[Flow Agent] Linked account ${account.email || account.clientId} unavailable:`, error.message);
    scheduleLinkedPoll(account, 5000);
  }
}

async function sendLinkedResponse(account, msg) {
  if (!account?.callbackSecret) throw new Error('LINKED_ACCOUNT_NOT_CONNECTED');
  const response = await fetch(account.callbackUrl || `${linkedAgentHttpBase(account)}/api/ext/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.callbackSecret}` },
    body: JSON.stringify({ ...msg, session_id: account.clientId }),
  });
  if (!response.ok) throw new Error(`CALLBACK_HTTP_${response.status}`);
}

function pumpLinkedCommands(account) {
  const queue = linkedCommandQueues.get(account.id) || [];
  while ((account.activeRequests || 0) < MAX_LINKED_COMMANDS_PER_ACCOUNT && queue.length) {
    const command = queue.shift();
    account.activeRequests = (account.activeRequests || 0) + 1;
    Promise.resolve(handleLinkedAccountCommand(account, command)).catch((error) => {
      console.error('[Flow Agent] Linked account command failed:', error);
    }).finally(() => {
      account.activeRequests = Math.max(0, (account.activeRequests || 1) - 1);
      pumpLinkedCommands(account);
      broadcastStatus();
    });
  }
  linkedCommandQueues.set(account.id, queue);
}

async function pollLinkedAccount(accountId) {
  const account = linkedFlowAccounts.find((item) => item.id === accountId);
  if (!account || !account.httpConnected || manualDisconnect || linkedPollBusy.has(accountId)) return;
  linkedPollBusy.add(accountId);
  try {
    const response = await fetch(`${linkedAgentHttpBase(account)}/api/ext/poll?session_id=${encodeURIComponent(account.clientId)}`, {
      headers: { Authorization: `Bearer ${account.callbackSecret}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const queue = linkedCommandQueues.get(account.id) || [];
    queue.push(...(data.commands || []));
    linkedCommandQueues.set(account.id, queue);
    pumpLinkedCommands(account);
  } catch (error) {
    account.httpConnected = false;
    console.warn(`[Flow Agent] Linked account ${account.email || account.clientId} polling stopped:`, error.message);
    setTimeout(() => connectLinkedAccount(account), 3000);
  } finally {
    linkedPollBusy.delete(accountId);
    if (account.httpConnected) scheduleLinkedPoll(account);
  }
}

async function waitForLinkedAccountToken(account, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (account.flowKey) return true;
    await sleep(500);
  }
  return !!account.flowKey;
}

async function restoreLinkedAccountSessions() {
  // Labs has one cookie session in this Opera profile, so token bootstrap must
  // be sequential. Startup restore is intentionally passive: it may inspect
  // an already-open normal Flow tab, but it must not create tabs or launch a
  // Google sign-in flow while the user is doing an unrelated task such as TTS.
  for (const [index, account] of linkedFlowAccounts.entries()) {
    try {
      if (index) await sleep(450);
      const tab = await ensureLinkedFlowAccountTab(account, false, false);
      if (!tab?.id) {
        await connectLinkedAccount(account);
        continue;
      }
      await refreshLinkedAccountIdentity(account);
      await connectLinkedAccount(account);

      if (!account.flowKey) {
        // A passive session check can reuse an existing cookie, but never
        // opens the account chooser or a new OAuth tab during startup.
        await refreshLinkedAccountSession(account, false);
      }

      // Force hello again after token capture so Flow Agent updates the same
      // client from connected/tokenless -> ready without creating a new client.
      await connectLinkedAccount(account, true);
    } catch (error) {
      console.warn('[Flow Agent] Linked account restore failed:', account.email || account.clientId, error?.message || error);
    }
  }
}

async function connectAllLinkedAccounts() {
  await Promise.all(linkedFlowAccounts.map((account) => connectLinkedAccount(account)));
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
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    chrome.alarms.clear('reconnect');
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
  if (manualDisconnect) return;
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectToAgent();
      void connectAllLinkedAccounts();
    }, 1500);
  }
  // Alarm is the durable fallback if MV3 suspends the service worker before
  // the short timer fires. Chrome clamps alarms below 30 seconds.
  chrome.alarms.create('reconnect', { delayInMinutes: 0.5 });
}

async function healthCheckLinkedTabs() {
  if (linkedTabHealthSweepRunning || manualDisconnect) return;
  linkedTabHealthSweepRunning = true;
  try {
    for (const account of linkedFlowAccounts) {
      // Do not resurrect seven idle Flow tabs every 30 seconds. A real queued
      // request/captcha will call ensureHealthyLinkedFlowTab on demand.
      if (!account || account.activeRequests <= 0 || !account.flowKey) continue;
      if (account.tabHealthyAt && Date.now() - account.tabHealthyAt < 20_000) continue;
      if (account.tabRepairFailedAt && Date.now() - account.tabRepairFailedAt < 15_000) continue;
      try {
        await ensureHealthyLinkedFlowTab(account, false);
      } catch (error) {
        console.warn('[Flow Agent] Linked tab watchdog repair failed:', account.clientId, error?.message || error);
      }
      // Stagger scripting/navigation work so seven idle tabs never stampede the
      // MV3 service worker after Opera wakes from sleep.
      await sleep(180);
    }
  } finally {
    linkedTabHealthSweepRunning = false;
  }
}

function keepAlive() {
  if (httpConnected) {
    connectHttpAgent();
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  } else {
    connectToAgent();
  }
  void connectAllLinkedAccounts();
  void healthCheckLinkedTabs();
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

function linkedFlowRecoveryUrl(account) {
  if (account?.flowUrl && isFlowUrl(account.flowUrl)) return account.flowUrl;
  const match = String(account?.flowAccount || '').match(/:(default|\d+)$/i);
  if (match?.[1] && match[1] !== 'default') return `https://flow.google.com/u/${match[1]}/`;
  return 'https://flow.google.com/';
}

async function findExistingLinkedFlowAccountTab(account) {
  if (!account) return null;
  const expectedAccount = canonicalFlowAccount(account.flowAccount || flowAccountFromUrl(account.flowUrl) || '');
  const expectedEmail = normalizeStoredFlowEmail(account.email);
  const tabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((tab) =>
    tab.id !== captchaTabId
      && tab.id !== accountSyncTabId
      && !tab.incognito
      && !linkedFlowAccounts.some((other) => other !== account && other.tabId === tab.id)
      && tab.url
      && isFlowUrl(tab.url)
  );

  if (expectedAccount) {
    const matching = tabs.filter((tab) =>
      canonicalFlowAccount(flowAccountFromUrl(tab.url)) === expectedAccount
    );
    for (const tab of matching) {
      if (!expectedEmail) return tab;
      const identity = await readFlowIdentity(tab.id).catch(() => ({}));
      const email = normalizeFlowEmail(identity?.email);
      if (!email || email === expectedEmail) return tab;
    }
  }

  if (expectedEmail) {
    for (const tab of tabs) {
      const identity = await readFlowIdentity(tab.id).catch(() => ({}));
      if (normalizeFlowEmail(identity?.email) === expectedEmail) return tab;
    }
  }
  return null;
}

async function ensureLinkedFlowAccountTabUnlocked(account, active = false, create = true) {
  if (!account) return null;
  const expectedAccount = canonicalFlowAccount(account.flowAccount || flowAccountFromUrl(account.flowUrl) || '');
  if (account.tabId) {
    try {
      const tab = await chrome.tabs.get(account.tabId);
      if (!tab?.id) throw new Error('FLOW_TAB_MISSING');
      const assignedElsewhere = linkedFlowAccounts.some((other) => other !== account && other.tabId === tab.id);
      const routeMatches = !expectedAccount
        || canonicalFlowAccount(flowAccountFromUrl(tab.url)) === expectedAccount;
      let emailMatches = true;
      if (tab?.url && !expectedAccount && normalizeStoredFlowEmail(account.email)) {
        const identity = await readFlowIdentity(tab.id).catch(() => ({}));
        const email = normalizeFlowEmail(identity?.email);
        emailMatches = !email || email === normalizeStoredFlowEmail(account.email);
      }
      if (tab?.url && isFlowUrl(tab.url) && !tab.incognito && !assignedElsewhere && routeMatches && emailMatches) return tab;
    } catch {}
    account.tabId = null;
  }

  // tabIds can become stale after extension/browser restarts. Adopt an already
  // open tab for this exact Google account before creating another Flow tab.
  const existing = await findExistingLinkedFlowAccountTab(account);
  if (existing?.id) {
    account.tabId = existing.id;
    account.flowUrl = existing.url;
    account.flowAccount = flowAccountFromUrl(existing.url) || account.flowAccount || null;
    await persistLinkedAccounts();
    console.info('[Flow Agent] Reusing existing linked Flow tab:', account.clientId, existing.id);
    return existing;
  }

  if (!create) {
    await persistLinkedAccounts();
    return null;
  }
  const tab = await chrome.tabs.create({ url: linkedFlowRecoveryUrl(account), active });
  account.tabId = tab.id;
  account.flowUrl = tab.url && isFlowUrl(tab.url) ? tab.url : linkedFlowRecoveryUrl(account);
  await persistLinkedAccounts();
  console.info('[Flow Agent] Opened linked Flow tab:', account.clientId, tab.id);
  return tab;
}

async function ensureLinkedFlowAccountTab(account, active = false, create = true) {
  if (!account) return null;
  const previous = linkedTabEnsureLocks.get(account.id) || Promise.resolve();
  let unlock;
  const current = new Promise((resolve) => { unlock = resolve; });
  const tail = previous.catch(() => {}).then(() => current);
  linkedTabEnsureLocks.set(account.id, tail);
  await previous.catch(() => {});
  try {
    return await ensureLinkedFlowAccountTabUnlocked(account, active, create);
  } finally {
    unlock();
    if (linkedTabEnsureLocks.get(account.id) === tail) linkedTabEnsureLocks.delete(account.id);
  }
}

async function pingLinkedFlowTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.id || !tab.url || !isFlowUrl(tab.url)) throw new Error(`FLOW_TAB_NOT_READY:${tab?.url || 'missing'}`);
  if (tab.status !== 'complete') await waitForTabComplete(tab.id, 20000).catch(() => {});
  const latest = await chrome.tabs.get(tab.id).catch(() => null);
  if (!latest?.url || !isFlowUrl(latest.url)) throw new Error(`FLOW_TAB_NAVIGATED:${latest?.url || 'missing'}`);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['injected.js'], world: 'MAIN' });
  await sleep(120);
  const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING_FLOW_BRIDGE' });
  if (!pong?.ok) throw new Error('FLOW_BRIDGE_PING_FAILED');
  return latest;
}

async function ensureHealthyLinkedFlowTab(account, forceRepair = false) {
  if (!account) throw new Error('NO_LINKED_ACCOUNT');
  const existing = linkedTabRepairTasks.get(account.id);
  if (existing) return existing;

  const task = (async () => {
    let tab = await ensureLinkedFlowAccountTab(account, false);
    if (!tab?.id) throw new Error('NO_FLOW_TAB');
    if (!forceRepair) {
      try {
        const healthy = await pingLinkedFlowTab(tab.id);
        account.tabId = healthy.id;
        account.flowUrl = healthy.url;
        account.tabHealthyAt = Date.now();
        return healthy;
      } catch {}
    }

    console.info('[Flow Agent] Replacing linked Flow tab during recovery:', account.clientId, tab.id);
    try { if (tab.id) await chrome.tabs.remove(tab.id); } catch {}
    account.tabId = null;
    // A second tab for the same account may already be open. Reuse it first;
    // only create a fresh tab after the broken tab is closed and no match exists.
    tab = await findExistingLinkedFlowAccountTab(account);
    const recoveryUrl = linkedFlowRecoveryUrl(account);
    if (!tab) tab = await chrome.tabs.create({ url: recoveryUrl, active: false });
    account.tabId = tab.id;
    account.flowUrl = tab.url && isFlowUrl(tab.url) ? tab.url : recoveryUrl;
    account.flowAccount = flowAccountFromUrl(account.flowUrl) || account.flowAccount || null;
    await persistLinkedAccounts();
    console.info('[Flow Agent] Recovered linked Flow tab:', account.clientId, tab.id);
    await waitForTabComplete(tab.id, 20000).catch(() => {});
    await sleep(500);
    const healthy = await pingLinkedFlowTab(tab.id);
    account.tabId = healthy.id;
    account.flowUrl = healthy.url;
    account.tabHealthyAt = Date.now();
    account.tabRepairFailedAt = null;
    await persistLinkedAccounts();
    return healthy;
  })().catch((error) => {
    account.tabRepairFailedAt = Date.now();
    throw error;
  }).finally(() => linkedTabRepairTasks.delete(account.id));

  linkedTabRepairTasks.set(account.id, task);
  return task;
}

function captchaResultError(result) {
  if (result?.token) return null;
  return result?.error || 'NO_CAPTCHA_TOKEN';
}

async function requestLinkedCaptcha(account, requestId, captchaAction, forceRepair = false) {
  const tab = await ensureHealthyLinkedFlowTab(account, forceRepair);
  const result = await Promise.race([
    requestCaptchaFromTab(tab.id, requestId, captchaAction),
    new Promise((_, reject) => setTimeout(() => reject(new Error('CAPTCHA_TIMEOUT')), 50000)),
  ]);
  const error = captchaResultError(result);
  if (error) throw new Error(error);
  account.tabHealthyAt = Date.now();
  return result;
}

async function solveCaptchaForLinkedAccount(account, requestId, captchaAction) {
  let firstError = null;
  try {
    return await requestLinkedCaptcha(account, requestId, captchaAction, false);
  } catch (error) {
    firstError = error;
  }

  // Repair exactly this linked tab and retry once. The per-account repair lock
  // prevents concurrent requests from opening duplicate tabs for one account.
  try {
    return await requestLinkedCaptcha(account, `${requestId}-repair`, captchaAction, true);
  } catch (repairError) {
    const detail = `${firstError?.message || firstError || ''} | ${repairError?.message || repairError || ''}`;
    console.warn('[Flow Agent] Linked CAPTCHA tab repair failed:', account.clientId, detail);
  }

  // reCAPTCHA tokens are bound to the Flow site/action, while API auth remains
  // the linked account's own bearer token. A healthy shared Flow tab is a safe
  // last-resort CAPTCHA source and keeps one broken account tab from dropping a
  // whole seven-worker wave.
  try {
    const fallback = await solveCaptcha(`${requestId}-shared`, captchaAction);
    if (fallback?.token) {
      account.tabRepairFailedAt = Date.now();
      return fallback;
    }
    return { error: `LINKED_AND_SHARED_CAPTCHA_FAILED: ${fallback?.error || 'NO_TOKEN'}` };
  } catch (fallbackError) {
    return { error: `LINKED_AND_SHARED_CAPTCHA_FAILED: ${fallbackError?.message || fallbackError || 'CAPTCHA_FAILED'}` };
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
    const tabs = (await chrome.tabs.query({ url: FLOW_TAB_URLS })).filter((tab) => !tab.incognito);
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

async function handleLinkedApiRequest(account, msg) {
  const { id, params } = msg;
  const { url, method, headers, body, captchaAction } = params || {};
  if (!url) return sendLinkedResponse(account, { id, error: 'MISSING_URL' });
  if (!url.startsWith('https://aisandbox-pa.googleapis.com/')) return sendLinkedResponse(account, { id, error: 'INVALID_URL' });
  if (!account.flowKey) return sendLinkedResponse(account, { id, status: 503, error: 'NO_FLOW_KEY' });

  setState('running');
  const hasCaptcha = !!captchaAction;
  if (hasCaptcha) metrics.requestCount++;
  const logId = `${account.clientId}:${id}`;
  const logType = _classifyApiUrl(url);
  if (_VISIBLE_TYPES.has(logType)) {
    const payloadSummary = body ? JSON.stringify(body).slice(0, 200) : null;
    addRequestLog({ id: logId, type: logType, time: new Date().toISOString(), status: 'processing', error: null, outputUrl: null, url, payloadSummary });
  }

  try {
    let captchaToken = null;
    if (captchaAction) {
      const captchaResult = await solveCaptchaForLinkedAccount(account, id, captchaAction);
      captchaToken = captchaResult?.token || null;
      if (!captchaToken) {
        const err = captchaResult?.error || 'CAPTCHA_FAILED';
        if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `CAPTCHA_FAILED: ${err}`; }
        updateRequestLog(logId, { status: 'failed', error: `CAPTCHA_FAILED: ${err}` });
        await chrome.storage.local.set({ metrics });
        return sendLinkedResponse(account, { id, status: 403, error: `CAPTCHA_FAILED: ${err}` });
      }
    }

    let finalBody = body;
    if (captchaToken && finalBody) {
      finalBody = JSON.parse(JSON.stringify(finalBody));
      if (finalBody.clientContext?.recaptchaContext) finalBody.clientContext.recaptchaContext.token = captchaToken;
      if (Array.isArray(finalBody.requests)) {
        for (const req of finalBody.requests) {
          if (req.clientContext?.recaptchaContext) req.clientContext.recaptchaContext.token = captchaToken;
        }
      }
    }

    const activeFlowKey = account.flowKey;
    if (!activeFlowKey) return sendLinkedResponse(account, { id, status: 503, error: 'NO_FLOW_KEY' });
    const fetchHeaders = { ...(headers || {}), authorization: `Bearer ${activeFlowKey}` };
    const response = await fetch(url, {
      method: method || 'POST',
      headers: fetchHeaders,
      // Linked accounts share one Opera cookie jar. Mixing that shared jar with
      // a different account's bearer token causes cross-account affinity bugs
      // and makes concurrent uploads behave as if only one session is valid.
      // aisandbox is already authenticated by the captured bearer token.
      credentials: 'omit',
      body: method === 'GET' ? undefined : JSON.stringify(finalBody),
      signal: AbortSignal.timeout(FLOW_API_FETCH_TIMEOUT_MS),
    });
    const responseText = await response.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = responseText; }

    if (response.status === 401) {
      account.flowKey = null;
      account.tokenCapturedAt = null;
      account.httpConnected = false;
      await persistLinkedAccounts();
    }
    await sendLinkedResponse(account, { id, status: response.status, data: responseData });
    const responseSummary = responseText ? responseText.slice(0, 300) : null;
    if (response.ok) {
      if (hasCaptcha) { metrics.successCount++; metrics.lastError = null; }
      updateRequestLog(logId, { status: 'success', httpStatus: response.status, responseSummary });
    } else {
      if (hasCaptcha) { metrics.failedCount++; metrics.lastError = `API_${response.status}`; }
      updateRequestLog(logId, { status: 'failed', error: `API_${response.status}`, httpStatus: response.status, responseSummary });
    }
  } catch (error) {
    if (hasCaptcha) { metrics.failedCount++; metrics.lastError = error.message || 'API_REQUEST_FAILED'; }
    updateRequestLog(logId, { status: 'failed', error: error.message || 'API_REQUEST_FAILED' });
    await sendLinkedResponse(account, { id, status: 500, error: error.message || 'API_REQUEST_FAILED' }).catch(() => {});
  } finally {
    await chrome.storage.local.set({ metrics });
    setState('idle');
  }
}

async function handleLinkedAccountCommand(account, msg) {
  if (!account || !msg || typeof msg !== 'object') return;
  if (msg.method === 'api_request') return handleLinkedApiRequest(account, msg);
  if (msg.method === 'solve_captcha') {
    const result = await solveCaptchaForLinkedAccount(account, msg.id, msg.params?.captchaAction || 'VIDEO_GENERATION');
    return sendLinkedResponse(account, { id: msg.id, result });
  }
  if (msg.method === 'get_status') {
    return sendLinkedResponse(account, { id: msg.id, result: {
      state: (account.activeRequests || 0) ? 'running' : 'idle',
      flowKeyPresent: !!account.flowKey,
      tokenAge: account.tokenCapturedAt ? Date.now() - account.tokenCapturedAt : null,
      account: account.email || account.flowAccount || account.clientId,
    } });
  }
  if (msg.method === 'open_flow_tab') {
    if (account.tabId) await chrome.tabs.update(account.tabId, { active: true }).catch(() => {});
    return sendLinkedResponse(account, { id: msg.id, result: { ok: true } });
  }
  if (msg.method === 'refresh_flow_tab' || msg.method === 'force_refresh') {
    account.flowKey = null;
    account.flowKeySource = null;
    account.tokenCapturedAt = null;
    await persistLinkedAccounts();
    const tab = await ensureLinkedFlowAccountTab(account, false);
    if (tab?.id) {
      await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
      await waitForTabComplete(tab.id, 20000).catch(() => {});
      await refreshLinkedAccountIdentity(account);
    }
    await connectLinkedAccount(account, true);
    const sync = await refreshLinkedAccountSession(account, true);
    if (sync?.status === 'sign_in_started') {
      const ready = await waitForLinkedAccountToken(account, 30000);
      if (!ready) await cancelLinkedAccountSync(account.id);
    }
    await connectLinkedAccount(account, true);
    return sendLinkedResponse(account, { id: msg.id, result: { queued: !account.flowKey, ready: !!account.flowKey, status: sync?.status || null } });
  }
  if (msg.method === 'trpc_request') {
    const { id, params = {} } = msg;
    const { url, method = 'POST', headers = {}, body } = params;
    if (!url || (!url.startsWith('https://flow.google.com/') && !url.startsWith('https://labs.google/'))) {
      return sendLinkedResponse(account, { id, error: 'INVALID_TRPC_URL' });
    }
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers, ...(account.flowKey ? { authorization: `Bearer ${account.flowKey}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include',
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return sendLinkedResponse(account, { id, status: response.status, data });
    } catch (error) {
      return sendLinkedResponse(account, { id, error: error.message || 'TRPC_FETCH_FAILED' });
    }
  }
  return sendLinkedResponse(account, { id: msg.id, error: `UNSUPPORTED_LINKED_METHOD:${msg.method || 'unknown'}` });
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
      signal: AbortSignal.timeout(FLOW_API_FETCH_TIMEOUT_MS),
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

function newLinkedAccountId() {
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `flowacct-${suffix}`;
}

async function addLinkedFlowAccount() {
  const id = newLinkedAccountId();
  const clientId = `account-${id.slice(-12)}`;
  const continueUrl = encodeURIComponent('https://flow.google.com/');
  const tab = await chrome.tabs.create({
    url: `https://accounts.google.com/AccountChooser?continue=${continueUrl}`,
    active: true,
  });
  const account = {
    id,
    clientId,
    email: null,
    flowUrl: null,
    flowAccount: null,
    tabId: tab.id,
    flowKey: null,
    flowKeySource: null,
    tokenCapturedAt: null,
    callbackSecret: null,
    callbackUrl: null,
    pollIntervalMs: 1000,
    httpConnected: false,
    activeRequests: 0,
  };
  linkedFlowAccounts.push(account);
  assignLinkedWorkerPort(account);
  await persistLinkedAccounts();
  await ensureLinkedWorkerRuntime(account).catch((error) => console.warn('[Flow Agent] Could not prestart linked worker:', error.message));
  broadcastStatus();
  return publicLinkedAccount(account);
}

async function focusLinkedFlowAccount(account) {
  if (!account) throw new Error('FLOW_ACCOUNT_NOT_FOUND');
  const tab = await ensureLinkedFlowAccountTab(account, true);
  if (!tab?.id) throw new Error('FLOW_ACCOUNT_TAB_UNAVAILABLE');
  await chrome.tabs.update(tab.id, { active: true });
}

async function refreshLinkedFlowAccount(account, { active = true } = {}) {
  if (!account) throw new Error('FLOW_ACCOUNT_NOT_FOUND');
  const tab = await ensureLinkedFlowAccountTab(account, active);
  if (!tab?.id) throw new Error('FLOW_ACCOUNT_TAB_UNAVAILABLE');
  account.flowKey = null;
  account.flowKeySource = null;
  account.tokenCapturedAt = null;
  const timer = linkedPollTimers.get(account.id);
  if (timer) clearTimeout(timer);
  linkedPollTimers.delete(account.id);
  await persistLinkedAccounts();
  await chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
  await waitForTabComplete(tab.id, 20000).catch(() => {});
  await refreshLinkedAccountIdentity(account);
  await connectLinkedAccount(account, true);
  const sync = await refreshLinkedAccountSession(account, true);
  if (sync?.status === 'sign_in_started') {
    const ready = await waitForLinkedAccountToken(account, 30000);
    if (!ready) await cancelLinkedAccountSync(account.id);
  }
  await connectLinkedAccount(account, true);
  broadcastStatus();
  return { ready: !!account.flowKey, status: sync?.status || null };
}

function isLinkedAccountTokenFresh(account) {
  const capturedAt = Number(account?.tokenCapturedAt);
  return !!account?.flowKey && Number.isFinite(capturedAt)
    && Date.now() - capturedAt >= 0
    && Date.now() - capturedAt < 50 * 60 * 1000;
}

function reportLinkedRefreshProgress(progress) {
  try {
    chrome.runtime.sendMessage({ type: 'FLOW_TOKEN_REFRESH_PROGRESS', progress }, () => {
      // Consume the expected "no receiving end" error when the popup is closed.
      void chrome.runtime.lastError;
    });
  } catch {}
}

async function refreshAllLinkedFlowAccounts() {
  if (linkedAccountsRefreshTask) return linkedAccountsRefreshTask;
  linkedAccountsRefreshTask = (async () => {
    const accounts = [...linkedFlowAccounts];
    const total = accounts.length;
    const tabs = new Map();
    const tabErrors = new Map();
    reportLinkedRefreshProgress({ phase: 'opening', done: 0, total });

    // Open/reuse one normal Flow tab per linked account first. Never reuse an
    // incognito or another account's assigned tab, and keep these tabs inactive.
    for (const [index, account] of accounts.entries()) {
      try {
        const tab = await ensureLinkedFlowAccountTab(account, false);
        if (!tab?.id) throw new Error('FLOW_ACCOUNT_TAB_UNAVAILABLE');
        tabs.set(account.id, tab);
      } catch (error) {
        tabErrors.set(account.id, error?.message || 'FLOW_ACCOUNT_TAB_UNAVAILABLE');
      }
      reportLinkedRefreshProgress({
        phase: 'opening', done: index + 1, total,
        account: account.email || account.clientId || `Account ${index + 1}`,
      });
    }

    // Preserve the original button behavior for the primary account, but do
    // not create an extra default Flow tab if the primary tab is not open.
    const primaryTabId = selectedFlowTabId;
    if (primaryTabId !== null && !linkedAccountForTab(primaryTabId)) {
      await captureTokenFromFlowTab(true, false, primaryTabId);
    }

    const results = [];
    for (const [index, account] of accounts.entries()) {
      const label = account.email || account.clientId || `Account ${index + 1}`;
      reportLinkedRefreshProgress({ phase: 'connecting', done: index, total, account: label });
      try {
        if (tabErrors.has(account.id) || !tabs.has(account.id)) {
          throw new Error(tabErrors.get(account.id) || 'FLOW_ACCOUNT_TAB_UNAVAILABLE');
        }

        let result;
        if (Number(account.activeRequests) > 0) {
          if (account.flowKey && !account.httpConnected) await connectLinkedAccount(account, true);
          result = {
            ready: !!account.flowKey && !!account.httpConnected,
            status: 'busy_skipped',
          };
        } else if (isLinkedAccountTokenFresh(account)) {
          if (!account.httpConnected) await connectLinkedAccount(account, true);
          result = { ready: !!account.flowKey && !!account.httpConnected, status: 'already_fresh' };
        } else {
          result = await refreshLinkedFlowAccount(account, { active: false });
        }
        results.push({ id: account.id, account: label, ...result });
      } catch (error) {
        results.push({ id: account.id, account: label, ready: false, error: error?.message || 'REFRESH_FAILED' });
      }
      reportLinkedRefreshProgress({ phase: 'connecting', done: index + 1, total, account: label });
    }

    const ready = results.filter((result) => result.ready).length;
    const summary = { total, ready, failed: total - ready, results };
    reportLinkedRefreshProgress({ phase: 'complete', done: total, total, ready, failed: total - ready });
    return summary;
  })().finally(() => {
    linkedAccountsRefreshTask = null;
  });
  return linkedAccountsRefreshTask;
}

async function removeLinkedFlowAccount(account) {
  if (!account) throw new Error('FLOW_ACCOUNT_NOT_FOUND');
  const timer = linkedPollTimers.get(account.id);
  if (timer) clearTimeout(timer);
  linkedPollTimers.delete(account.id);
  linkedCommandQueues.delete(account.id);
  linkedPollBusy.delete(account.id);
  linkedFlowAccounts = linkedFlowAccounts.filter((item) => item.id !== account.id);
  if (account.tabId) await chrome.tabs.remove(account.tabId).catch(() => {});
  await persistLinkedAccounts();
  broadcastStatus();
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const account = linkedAccountForTab(tabId);
  if (!account) return;
  account.tabId = null;
  account.httpConnected = false;
  const timer = linkedPollTimers.get(account.id);
  if (timer) clearTimeout(timer);
  linkedPollTimers.delete(account.id);
  void persistLinkedAccounts();
  broadcastStatus();
});

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
    const agentConnected = httpConnected || ws?.readyState === WebSocket.OPEN;
    reply({
      connected: agentConnected,
      agentConnected,
      enabled: !manualDisconnect,
      httpConnected,
      transport: httpConnected ? 'http' : (ws?.readyState === WebSocket.OPEN ? 'ws' : 'none'),
      flowKeyPresent: !!flowKey,
      manualDisconnect,
      tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
      metrics: { ...metrics },
      state,
      clientId: extensionClientId,
      readyLinkedAccounts: linkedFlowAccounts.filter((account) => account.httpConnected && account.flowKey).length,
    });
  }

  if (msg.type === 'LIST_FLOW_ACCOUNTS') {
    const agentConnected = httpConnected || ws?.readyState === WebSocket.OPEN;
    reply({
      enabled: !manualDisconnect,
      accounts: [{
        id: 'primary',
        clientId: extensionClientId || 'primary',
        email: flowSessionStatus?.email || null,
        flowUrl: selectedFlowUrl || null,
        tabId: selectedFlowTabId,
        connected: !!agentConnected,
        tokenReady: !!flowKey,
        tokenAge: metrics.tokenCapturedAt ? Date.now() - metrics.tokenCapturedAt : null,
        activeRequests: activeApiRequests,
        primary: true,
      }, ...linkedFlowAccounts.map((account) => ({ ...publicLinkedAccount(account), primary: false }))],
    });
    return true;
  }

  if (msg.type === 'ADD_FLOW_ACCOUNT') {
    addLinkedFlowAccount()
      .then((account) => reply({ ok: true, account }))
      .catch((error) => reply({ error: error.message || String(error) }));
    return true;
  }

  if (msg.type === 'FOCUS_FLOW_ACCOUNT') {
    if (msg.accountId === 'primary') {
      captureTokenFromFlowTab(true)
        .then(() => reply({ ok: true }))
        .catch((error) => reply({ error: error.message || String(error) }));
      return true;
    }
    const account = linkedFlowAccounts.find((item) => item.id === msg.accountId);
    focusLinkedFlowAccount(account)
      .then(() => reply({ ok: true }))
      .catch((error) => reply({ error: error.message || String(error) }));
    return true;
  }

  if (msg.type === 'REFRESH_FLOW_ACCOUNT') {
    if (msg.accountId === 'primary') {
      refreshSelectedAccountSession(true)
        .then(() => reply({ ok: true }))
        .catch((error) => reply({ error: error.message || String(error) }));
      return true;
    }
    const account = linkedFlowAccounts.find((item) => item.id === msg.accountId);
    refreshLinkedFlowAccount(account)
      .then(() => reply({ ok: true }))
      .catch((error) => reply({ error: error.message || String(error) }));
    return true;
  }

  if (msg.type === 'REMOVE_FLOW_ACCOUNT') {
    if (msg.accountId === 'primary') {
      reply({ error: 'PRIMARY_FLOW_ACCOUNT_CANNOT_BE_REMOVED' });
      return true;
    }
    const account = linkedFlowAccounts.find((item) => item.id === msg.accountId);
    removeLinkedFlowAccount(account)
      .then(() => reply({ ok: true }))
      .catch((error) => reply({ error: error.message || String(error) }));
    return true;
  }

  if (msg.type === 'DISCONNECT') {
    manualDisconnect = true;
    void chrome.storage.local.set({ manualDisconnect: true });
    httpConnected = false;
    if (httpPollTimer) clearTimeout(httpPollTimer);
    if (ws) ws.close();
    for (const account of linkedFlowAccounts) {
      account.httpConnected = false;
      const timer = linkedPollTimers.get(account.id);
      if (timer) clearTimeout(timer);
    }
    linkedPollTimers.clear();
    broadcastStatus();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'RECONNECT') {
    manualDisconnect = false;
    void chrome.storage.local.set({ manualDisconnect: false });
    connectToAgent();
    void connectAllLinkedAccounts();
    broadcastStatus();
    reply({ ok: true });
    return true;
  }

  if (msg.type === 'REQUEST_LOG') {
    reply({ log: requestLog });
    return true;
  }

  if (msg.type === 'GET_CLIENT_CREDITS') {
    chrome.storage.local.get(['clientId']).then(async ({ clientId }) => {
      const host = String(connectedServerHost || CONFIG.DEFAULT_SERVER_HOST).trim().replace(/\/$/, '');
      const hostWithoutScheme = host.replace(/^https?:\/\//i, '');
      const local = /^(127\.0\.0\.1|localhost|192\.168\.|10\.)(:|$)/.test(hostWithoutScheme);
      const primaryBase = /^https?:\/\//i.test(host) ? host : `${local ? 'http' : 'https'}://${host}`;
      const linkedTargets = linkedFlowAccounts
        .filter((account) => account?.flowKey && account.clientId)
        .map((account) => ({ base: linkedAgentHttpBase(account), clientId: account.clientId, label: account.email || account.clientId }));
      const targets = linkedTargets.length
        ? linkedTargets
        : [{ base: primaryBase, clientId: extensionClientId || clientId || '', label: 'primary' }];
      const parseCredits = (payload) => {
        const values = [payload?.data?.credits, payload?.credits, payload?.total_credits];
        for (const value of values) {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }
        return null;
      };
      const balances = (await Promise.all(targets.map(async (target) => {
        try {
          const response = await fetch(`${target.base}/v1/credits`, {
            signal: AbortSignal.timeout(4000),
            headers: target.clientId ? { 'X-Client-Id': target.clientId } : {},
          });
          if (!response.ok) return null;
          const value = parseCredits(await response.json().catch(() => ({})));
          return value == null ? null : { label: target.label, credits: value };
        } catch {
          return null;
        }
      }))).filter(Boolean);
      if (!balances.length) throw new Error('CREDITS_UNAVAILABLE');
      const total = balances.reduce((sum, item) => sum + item.credits, 0);
      reply({ credits: total, total_credits: total, accounts: balances });
    }).catch((error) => {
      console.error('[Flow Agent] Credit request failed:', error);
      reply({ error: error.message || 'CREDITS_UNAVAILABLE' });
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
    refreshAllLinkedFlowAccounts()
      .then((summary) => reply({ ok: true, ...summary }))
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
