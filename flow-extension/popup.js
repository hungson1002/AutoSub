const TYPE_LABELS = {
  GENERATE_IMAGE:           'GEN IMAGE',
  REGENERATE_IMAGE:         'REGEN IMAGE',
  EDIT_IMAGE:               'EDIT IMAGE',
  GENERATE_CHARACTER_IMAGE: 'GEN REF',
  REGENERATE_CHARACTER_IMAGE: 'REGEN REF',
  EDIT_CHARACTER_IMAGE:     'EDIT REF',
  GENERATE_VIDEO:           'GEN VIDEO',
  GENERATE_VIDEO_REFS:      'GEN VIDEO FROM REFS',
  UPSCALE_VIDEO:            'UPSCALE VIDEO',
  GEN_IMG:                  'GEN IMAGE',
  GEN_VID:                  'GEN VIDEO',
  GEN_VID_REF:              'GEN VIDEO FROM REFS',
  UPSCALE:                  'UPSCALE VIDEO',
  TRACKING:                 'TRACKING',
  URL_REFRESH:              'URL REFRESH',
};

function formatType(type) {
  if (!type) return '—';
  return TYPE_LABELS[type] || type.slice(0, 12).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '—';
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Media URLs come from the backend, so only allow schemes that are safe to
// drop into an href/src — a `javascript:` URL would otherwise be clickable.
function safeUrl(raw) {
  const url = String(raw || '').trim();
  return /^(https?|blob|data):/i.test(url) ? url : '';
}

function badgeHtml(status) {
  if (status === 'COMPLETED' || status === 'success') {
    return '<span class="badge badge-ok">&#10003; done</span>';
  } else if (status === 'FAILED' || status === 'failed' || (typeof status === 'number' && status >= 400)) {
    return '<span class="badge badge-fail">&#10007; fail</span>';
  } else if (status === 'PROCESSING') {
    return '<span class="badge badge-proc">&#9203; gen...</span>';
  } else {
    return '<span class="badge badge-proc">&#9203; sent</span>';
  }
}

function renderLog(entries) {
  const list = document.getElementById('log-list');
  const countEl = document.getElementById('log-count');

  if (!entries || entries.length === 0) {
    list.innerHTML = '<div class="log-empty">No requests yet</div>';
    countEl.textContent = '0';
    return;
  }

  countEl.textContent = entries.length;

  list.innerHTML = entries.map((entry, i) => {
    const shortId = entry.id ? String(entry.id).slice(0, 8) : '—';
    const type = formatType(entry.type || entry.method);
    const time = formatTime(entry.time || entry.timestamp);
    const status = entry.status || 'pending';
    const error = entry.error || '';

    const urlDisplay = entry.url
      ? `<div class="detail-section">
           <div class="detail-label">URL</div>
           <div class="detail-value url" title="${escHtml(entry.url)}">${escHtml(entry.url)}</div>
         </div>`
      : '';

    const payloadDisplay = entry.payloadSummary
      ? `<div class="detail-section">
           <div class="detail-label">Payload</div>
           <div class="detail-value">${escHtml(entry.payloadSummary)}</div>
         </div>`
      : '';

    const responseDisplay = entry.responseSummary
      ? `<div class="detail-section">
           <div class="detail-label">Response${entry.httpStatus ? ` (${entry.httpStatus})` : ''}</div>
           <div class="detail-value">${escHtml(entry.responseSummary)}</div>
         </div>`
      : '';

    const errorDisplay = error
      ? `<div class="detail-section">
           <div class="detail-label">Error</div>
           <div class="detail-value detail-error">${escHtml(error)}</div>
         </div>`
      : '';

    const hasDetails = entry.url || entry.payloadSummary || entry.responseSummary || error;

    return `<div class="entry" data-idx="${i}">
      <div class="entry-row">
        <span class="entry-id">${escHtml(shortId)}</span>
        <span class="entry-type">${escHtml(type)}</span>
        <span class="entry-time">${escHtml(time)}</span>
        ${badgeHtml(status)}
        ${hasDetails ? '<span class="expand-icon">&#9654;</span>' : '<span class="expand-icon" style="visibility:hidden">&#9654;</span>'}
      </div>
      ${hasDetails ? `<div class="entry-details">${urlDisplay}${payloadDisplay}${responseDisplay}${errorDisplay}</div>` : ''}
    </div>`;
  }).join('');

  // Toggle expand on row click
  list.querySelectorAll('.entry-row').forEach((row) => {
    row.addEventListener('click', () => {
      const entry = row.closest('.entry');
      if (entry.querySelector('.entry-details')) {
        entry.classList.toggle('open');
      }
    });
  });
}

function selectTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${name}`));
  if (name === 'media') loadMedia();
  if (name === 'accounts') loadFlowAccounts();
}

const AUTOSUB_BACKEND = 'http://127.0.0.1:8787';
async function autosubApiJson(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const body = options.body ?? (['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined);
  const hasBody = body !== undefined && body !== null;
  const response = await fetch(`${AUTOSUB_BACKEND}${path}`, {
    ...options,
    method,
    ...(hasBody ? { body } : {}),
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!response.ok) throw new Error(data.error || data.detail || `HTTP ${response.status}`);
  return data;
}

async function loadFlowAccounts() {
  const list = document.getElementById('accounts-list');
  const summary = document.getElementById('accounts-summary');
  if (!list || !summary) return;
  try {
    const data = await runtimeMessage({ type: 'LIST_FLOW_ACCOUNTS' });
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const ready = accounts.filter((account) => account.connected && account.tokenReady);
    summary.textContent = `${ready.length} ready account${ready.length === 1 ? '' : 's'} · ${ready.length * 2} parallel slots`;
    if (!accounts.length) {
      list.innerHTML = '<div class="accounts-empty">No linked Flow accounts yet.<br>Press + Add and choose another Google account in this same Opera profile.</div>';
      return;
    }
    list.innerHTML = accounts.map((account, index) => {
      const name = escHtml(account.email || (account.primary ? 'Primary Flow account' : `Flow account ${index + 1}`));
      const client = escHtml(account.clientId || '—');
      const readyState = account.connected && account.tokenReady;
      const status = readyState ? 'Ready' : account.tokenReady ? 'Token ready · reconnecting' : account.email ? 'Waiting for Flow token' : 'Choose/sign in to Google';
      const active = Math.max(0, Math.min(2, Number(account.activeRequests) || 0));
      return `<article class="flow-account" data-account-id="${escHtml(account.id)}">
        <div class="flow-account-top">
          <span class="flow-account-dot ${readyState ? 'ready' : ''}"></span>
          <div class="flow-account-copy"><strong>${name}</strong><span>${client} · ${escHtml(status)}</span></div>
          <span class="flow-account-slots">${readyState ? `${active}/2` : '—'}</span>
        </div>
        <div class="flow-account-actions">
          <button type="button" data-account-action="open">Open tab</button>
          <button type="button" data-account-action="refresh">Refresh</button>
          ${account.primary ? '' : '<button type="button" class="danger" data-account-action="remove">Remove</button>'}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-account-action]').forEach((button) => button.addEventListener('click', async () => {
      const card = button.closest('.flow-account');
      const accountId = card?.dataset.accountId;
      if (!accountId) return;
      const action = button.dataset.accountAction;
      button.disabled = true;
      try {
        if (action === 'open') await runtimeMessage({ type: 'FOCUS_FLOW_ACCOUNT', accountId });
        else if (action === 'refresh') await runtimeMessage({ type: 'REFRESH_FLOW_ACCOUNT', accountId });
        else if (action === 'remove') await runtimeMessage({ type: 'REMOVE_FLOW_ACCOUNT', accountId });
        if (action === 'remove') showToast('Flow account removed');
        else showToast(action === 'open' ? 'Opened linked Flow tab' : 'Refreshing linked Flow tab');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
        setTimeout(loadFlowAccounts, action === 'refresh' ? 1200 : 300);
      }
    }));
  } catch (error) {
    list.innerHTML = `<div class="accounts-empty">Could not load linked Flow accounts: ${escHtml(error.message)}</div>`;
    summary.textContent = 'Account pool unavailable';
  }
}

async function loadMedia() {
  const grid = document.getElementById('media-grid');
  grid.innerHTML = '<div class="media-empty">Loading media…</div>';
  try {
    const [data, base] = await Promise.all([apiJson('/v1/history'), getBackendBase()]);
    const items = Array.isArray(data.history) ? data.history : [];
    if (!items.length) {
      grid.innerHTML = '<div class="media-empty">No generated media yet</div>';
      return;
    }
    grid.innerHTML = items.map((item) => {
      const rawUrl = safeUrl(item.url);
      if (!rawUrl) return '';
      const url = escHtml(rawUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1):8001/i, base));
      const prompt = escHtml(item.prompt || 'Generated media');
      const preview = item.type === 'video'
        ? `<video src="${url}" controls preload="metadata"></video>`
        : `<img src="${url}" alt="${prompt}" loading="lazy">`;
      const date = item.timestamp ? new Date(item.timestamp * 1000).toLocaleDateString() : '';
      return `<article class="media-item"><a href="${url}" target="_blank" rel="noreferrer">${preview}</a><div class="media-info"><div class="media-copy"><strong>Generation ready</strong><span title="${prompt}">${prompt} · ${escHtml(date)}</span></div><a class="media-view" href="${url}" target="_blank" rel="noreferrer">View</a></div></article>`;
    }).join('');
    grid.querySelectorAll('img,video').forEach((media) => {
      media.addEventListener('error', () => media.closest('.media-item')?.remove(), { once: true });
    });
  } catch (error) {
    grid.innerHTML = `<div class="media-empty">Could not load media: ${escHtml(error.message)}</div>`;
  }
}

let monitorEnabled = false;
let wasConnected = false;
function runtimeMessage(payload) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (response?.error) reject(new Error(response.error));
    else resolve(response || {});
  }));
}

let toastTimer;
function showToast(message, kind = 'ok') {
  const toast = document.getElementById('toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `show ${kind}`;
  toastTimer = setTimeout(() => { toast.className = ''; }, 2600);
}

async function refreshMonitor() {
  try {
    const status = await runtimeMessage({ type: 'STATUS' });
    monitorEnabled = status.enabled !== false && status.manualDisconnect !== true;
    const connected = !!status.agentConnected;
    const mark = document.getElementById('extension-mark');
    if (mark) {
      mark.classList.toggle('ready', connected && status.state !== 'running');
      mark.classList.toggle('running', connected && status.state === 'running');
      mark.classList.toggle('offline', !connected);
    }
    document.getElementById('monitor-dot').classList.toggle('on', connected);
    document.getElementById('monitor-state').textContent = !monitorEnabled
      ? 'Paused by you'
      : !connected
        ? 'Reconnecting…'
        : status.state === 'running' ? 'Generating...' : 'Ready';
    const toggle = document.getElementById('agent-toggle');
    toggle.textContent = monitorEnabled ? 'ON' : 'OFF';
    toggle.classList.toggle('on', monitorEnabled);
    document.getElementById('metric-total').textContent = status.metrics?.requestCount || 0;
    document.getElementById('metric-success').textContent = status.metrics?.successCount || 0;
    document.getElementById('metric-failed').textContent = status.metrics?.failedCount || 0;
    const age = status.tokenAge == null ? null : Math.round(status.tokenAge / 60000);
    const linkedReady = Math.max(0, Number(status.readyLinkedAccounts) || 0);
    document.getElementById('monitor-token').textContent = status.flowKeyPresent
      ? `Token ${age || 0}m`
      : linkedReady ? `${linkedReady} linked token${linkedReady === 1 ? '' : 's'}` : 'No token';
    document.getElementById('monitor-client').textContent = (status.clientId || '-').replace(/^client-/, '');
    // Credits cost a real backend round-trip, so only fetch them when the
    // connection actually comes back up - not on every status tick.
    const creditText = document.getElementById('quick-credits')?.textContent || '—';
    if (connected && (!wasConnected || (creditText === '—' && Date.now() % 15000 < 3000))) refreshQuickStatus();
    wasConnected = connected;
  } catch {
    const mark = document.getElementById('extension-mark');
    if (mark) {
      mark.classList.remove('ready', 'running');
      mark.classList.add('offline');
    }
    document.getElementById('monitor-state').textContent = 'Extension offline';
    wasConnected = false;
  }
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => selectTab(tab.dataset.tab)));
document.getElementById('add-flow-account')?.addEventListener('click', async () => {
  const button = document.getElementById('add-flow-account');
  button.disabled = true;
  try {
    await runtimeMessage({ type: 'ADD_FLOW_ACCOUNT' });
    showToast('Choose another Google account in this same Opera profile.');
    setTimeout(loadFlowAccounts, 700);
  } catch (error) {
    showToast(`Could not add account: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
});
document.getElementById('agent-toggle').addEventListener('click', async () => {
  await runtimeMessage({ type: monitorEnabled ? 'DISCONNECT' : 'RECONNECT' });
  setTimeout(refreshMonitor, 350);
});
document.getElementById('open-flow').addEventListener('click', () => runtimeMessage({ type: 'OPEN_FLOW_TAB' }));
document.getElementById('refresh-token').addEventListener('click', async () => {
  const button = document.getElementById('refresh-token');
  button.textContent = 'Refreshing…';
  try {
    await runtimeMessage({ type: 'REFRESH_TOKEN' });
    showToast('Flow token refreshed successfully');
  } catch (error) {
    showToast(`Token refresh failed: ${error.message}`, 'error');
  } finally {
    button.textContent = 'Refresh Token';
    setTimeout(refreshMonitor, 500);
  }
});
chrome.storage.local.get(['clientId'], (data) => {
  document.getElementById('setting-server').value = CONFIG.DEFAULT_SERVER_HOST;
  document.getElementById('setting-client').value = data.clientId || '';
});

document.getElementById('save-settings').addEventListener('click', async () => {
  await chrome.storage.local.set({ clientId: document.getElementById('setting-client').value.trim() });
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
  selectTab('create');
  // New client id means a different balance — re-arm so the next tick refetches
  // once the reconnect has actually landed.
  wasConnected = false;
});

document.getElementById('clear-history').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLEAR_REQUEST_LOG' }, () => renderLog([]));
});
document.getElementById('refresh-media').addEventListener('click', loadMedia);
document.getElementById('delete-media').addEventListener('click', async () => {
  const button = document.getElementById('delete-media');
  button.disabled = true;
  try {
    await apiJson('/v1/history', { method: 'DELETE' });
    showToast('All media deleted');
    loadMedia();
  } catch (error) {
    showToast(`Delete failed: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
});

chrome.runtime.sendMessage({ type: 'REQUEST_LOG' }, (data) => {
  if (chrome.runtime.lastError) return;
  if (data && data.log) renderLog(data.log);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'REQUEST_LOG_UPDATE' && message.log) renderLog(message.log);
  if (message.type === 'STATUS_PUSH') refreshMonitor();
});

// ── Quick generation ────────────────────────────────────────

function getBackendBase() {
  const raw = String(CONFIG.DEFAULT_SERVER_HOST).trim().replace(/\/$/, '');
  if (/^https?:\/\//i.test(raw)) return Promise.resolve(raw);
  const local = /^(localhost|127\.0\.0\.1)(:|$)/i.test(raw);
  return Promise.resolve(`${local ? 'http' : 'https'}://${raw}`);
}

async function apiJson(path, options = {}) {
  const base = await getBackendBase();
  const stored = await chrome.storage.local.get(['clientId']);
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(stored.clientId ? { 'X-Client-Id': stored.clientId } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text }; }
  if (!response.ok) {
    const detail = data.detail || data.error || `HTTP ${response.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data;
}

// Credits come back in two shapes: a single client's response
// ({data:{credits}}) or, when no client id is known yet, the pooled
// fan-out across every connected browser ({total_credits}).
function parseCredits(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = [payload.data?.credits, payload.credits, payload.total_credits];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

let creditsInFlight = false;
async function refreshQuickStatus() {
  if (creditsInFlight) return;
  creditsInFlight = true;
  const credits = document.getElementById('quick-credits');
  try {
    let creditData;
    try {
      creditData = await runtimeMessage({ type: 'GET_CLIENT_CREDITS' });
    } catch (backgroundError) {
      if (backgroundError?.message === 'CREDITS_UNAVAILABLE') throw backgroundError;
      console.warn('[Flow Agent] Background credits failed, trying direct API:', backgroundError);
      creditData = await apiJson('/v1/credits');
    }
    const balance = parseCredits(creditData);
    if (balance == null) throw new Error('Credits missing from response');
    credits.textContent = String(balance);
    credits.title = `Current client credits: ${balance}`;
  } catch (error) {
    // A transient failure shouldn't wipe a known-good balance off the UI.
    if (!/^\d+$/.test(credits.textContent)) credits.textContent = '—';
    credits.title = `Credits unavailable: ${error.message}`;
    console.error('[Flow Agent] Credits unavailable:', error);
  } finally {
    creditsInFlight = false;
  }
}

function updateQuickFields() {
  const isVideo = document.getElementById('quick-type').value === 'video';
  const aspect = document.getElementById('quick-aspect');
  document.getElementById('model-field').hidden = isVideo;
  document.getElementById('duration-field').hidden = !isVideo;
  const square = document.querySelector('[data-input="quick-aspect"] [data-value="square"]');
  square.disabled = isVideo;
  if (isVideo && aspect.value === 'square') {
    aspect.value = 'landscape';
    const widget = document.querySelector('[data-input="quick-aspect"]');
    widget.querySelector('.select-trigger').textContent = 'Landscape';
    widget.querySelectorAll('.select-choice').forEach((choice) => choice.classList.toggle('selected', choice.dataset.value === 'landscape'));
  }
}

document.querySelectorAll('.custom-select').forEach((widget) => {
  const trigger = widget.querySelector('.select-trigger');
  trigger.addEventListener('click', () => {
    document.querySelectorAll('.custom-select').forEach((item) => item !== widget && item.classList.remove('open'));
    widget.classList.toggle('open');
  });
  widget.querySelectorAll('.select-choice').forEach((choice) => choice.addEventListener('click', () => {
    document.getElementById(widget.dataset.input).value = choice.dataset.value;
    trigger.textContent = choice.textContent;
    widget.querySelectorAll('.select-choice').forEach((item) => item.classList.toggle('selected', item === choice));
    widget.classList.remove('open');
  }));
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.custom-select')) document.querySelectorAll('.custom-select').forEach((item) => item.classList.remove('open'));
});

document.querySelectorAll('.type-option').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.type-option').forEach((item) => item.classList.toggle('active', item === button));
    document.getElementById('quick-type').value = button.dataset.type;
    updateQuickFields();
  });
});

document.getElementById('quick-generate').addEventListener('click', async () => {
  const button = document.getElementById('quick-generate');
  const result = document.getElementById('quick-result');
  const prompt = document.getElementById('quick-prompt').value.trim();
  if (!prompt) {
    result.textContent = 'Prompt required.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Generating…';
  result.textContent = 'Generating with Flow… This may take a moment.';

  try {
    const type = document.getElementById('quick-type').value;
    const aspect = document.getElementById('quick-aspect').value;
    let data;
    if (type === 'image') {
      const sizes = { landscape: '1792x1024', portrait: '1024x1792', square: '1024x1024' };
      data = await apiJson('/v1/images/generations', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          model: document.getElementById('quick-model').value,
          size: sizes[aspect] || sizes.landscape,
          n: 1,
        }),
      });
    } else {
      data = await apiJson('/v1/videos/generations', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          aspect,
          duration: Number(document.getElementById('quick-duration').value),
          n: 1,
        }),
      });
    }

    const item = data.data?.[0] || {};
    chrome.runtime.sendMessage({
      type: 'ADD_HISTORY',
      entry: {
        id: `popup-${Date.now()}`,
        time: new Date().toISOString(),
        type: type === 'image' ? 'GEN_IMG' : 'GEN_VID',
        status: 'success',
        url: item.url || '',
        prompt,
      },
    });
    if (item.url) {
      const safeHref = safeUrl(item.url);
      const safeUrlAttr = escHtml(safeHref);
      const preview = type === 'image'
        ? `<img class="result-preview" src="${safeUrlAttr}" alt="Generated image">`
        : `<video class="result-preview" src="${safeUrlAttr}" controls preload="metadata"></video>`;
      result.innerHTML = `<div class="result-card">${preview}<div class="result-meta"><strong>Generation ready</strong><a class="result-open" href="${safeUrlAttr}" target="_blank" rel="noreferrer">View</a></div></div>`;
    } else {
      result.textContent = 'Done. Check Flow history for the result.';
    }
    refreshQuickStatus();
    loadMedia();
  } catch (error) {
    result.textContent = `Failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Generate with Flow';
  }
});

updateQuickFields();
refreshMonitor();
setInterval(refreshMonitor, 3000);
setInterval(() => {
  if (document.querySelector('.tab[data-tab="accounts"]')?.classList.contains('active')) loadFlowAccounts();
}, 2500);
