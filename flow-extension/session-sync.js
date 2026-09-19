// The migrated Flow UI uses Google SSO; the REST API still uses Labs OAuth.
// Never equate a /u/N browser slot with the identity of a Labs session.
let accountSyncPending = null;
let accountSyncTabId = null;
let linkedAccountSyncTargetId = null;
let lastAccountSignIn = { email: null, at: 0 };
let flowSessionStatus = { status: 'unverified', email: null };

function normalizeFlowEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim().toLowerCase() : null;
}

async function readFlowIdentity(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      const isEmail = (value) => typeof value === 'string'
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      // Google embeds the signed-in identity in its own page bootstrap.
      // Do not scan prompts/project text, which may mention unrelated emails.
      const emails = [...new Set(Object.values(window.WIZ_global_data || {}).filter(isEmail))];
      if (emails.length === 1) return { url: location.href, email: emails[0] };
      const labels = [...document.querySelectorAll('a[href*="SignOutOptions"], button[aria-label], a[aria-label]')]
        .filter((el) => /Google.*(?:Account|account)|Tài khoản Google/.test(el.getAttribute('aria-label') || ''))
        .map((el) => (el.getAttribute('aria-label') || '').match(/[^\s()<>]+@[^\s()<>]+\.[^\s()<>]+/)?.[0])
        .filter(isEmail);
      return { url: location.href, email: labels.length === 1 ? labels[0] : null };
    },
  });
  return results?.[0]?.result || {};
}

async function fetchLabsSession() {
  const response = await fetch('https://labs.google/fx/api/auth/session', {
    credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`LABS_SESSION_HTTP_${response.status}`);
  return response.json();
}

async function openMatchingLabsSignIn(email, flowUrl, active = true) {
  // One normal OAuth navigation, not a retry loop or automated consent.
  if (accountSyncTabId !== null) {
    try { await chrome.tabs.get(accountSyncTabId); return; }
    catch { accountSyncTabId = null; }
  }
  if (lastAccountSignIn.email === email && Date.now() - lastAccountSignIn.at < 120000) return;
  lastAccountSignIn = { email, at: Date.now() };
  const csrfResponse = await fetch('https://labs.google/fx/api/auth/csrf', {
    credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!csrfResponse.ok) throw new Error(`LABS_CSRF_HTTP_${csrfResponse.status}`);
  const { csrfToken } = await csrfResponse.json();
  if (typeof csrfToken !== 'string' || !csrfToken) throw new Error('LABS_CSRF_MISSING');
  const url = new URL('https://labs.google/fx/api/auth/signin/google');
  url.searchParams.set('login_hint', email);
  const account = new URL(flowUrl).pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1];
  if (account) url.searchParams.set('authuser', account);
  const response = await fetch(url.href, {
    method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrfToken, callbackUrl: 'https://labs.google/fx/tools/flow', json: 'true' }).toString(),
  });
  if (!response.ok) throw new Error(`LABS_SIGNIN_HTTP_${response.status}`);
  const data = await response.json();
  const destination = new URL(data.url);
  if (destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com'
      || destination.username || destination.password) throw new Error('UNEXPECTED_SIGNIN_DESTINATION');
  // Allocate before navigating, so the callback tab cannot steal selection.
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  accountSyncTabId = tab.id;
  await chrome.tabs.update(tab.id, { url: destination.href, active });
}

async function closeLinkedAccountSyncTab(accountId) {
  if (linkedAccountSyncTargetId !== accountId || accountSyncTabId === null) return;
  const syncId = accountSyncTabId;
  accountSyncTabId = null;
  linkedAccountSyncTargetId = null;
  await chrome.tabs.remove(syncId).catch(() => {});
}

async function cancelLinkedAccountSync(accountId) {
  if (linkedAccountSyncTargetId !== accountId) return;
  await closeLinkedAccountSyncTab(accountId);
  lastAccountSignIn = { email: null, at: 0 };
}

async function refreshLinkedAccountSession(account, allowSignIn = false) {
  if (!account?.tabId) return { status: 'missing_tab' };
  try {
    const identity = await readFlowIdentity(account.tabId);
    const identityAccount = flowAccountFromUrl(identity.url);
    if (account.flowAccount && identityAccount
        && canonicalFlowAccount(identityAccount) !== canonicalFlowAccount(account.flowAccount)) {
      return { status: 'account_changed' };
    }
    const email = normalizeFlowEmail(identity.email) || normalizeFlowEmail(account.email);
    if (!email) return { status: 'identity_unavailable' };
    account.email = email;
    account.flowUrl = identity.url || account.flowUrl;
    account.flowAccount = identityAccount || account.flowAccount;
    await persistLinkedAccounts();

    const session = await fetchLabsSession();
    const sessionEmail = normalizeFlowEmail(session?.user?.email);
    if (sessionEmail === email && typeof session?.access_token === 'string'
        && captureLinkedAccountToken(account, 'Bearer ' + session.access_token, 'labs_session')) {
      await closeLinkedAccountSyncTab(account.id);
      return { status: 'ready', email };
    }

    if (!allowSignIn) return {
      status: sessionEmail && sessionEmail !== email ? 'account_mismatch' : 'sign_in_required',
      email,
      labsEmail: sessionEmail,
    };

    // Labs owns one cookie session per browser profile. Switch that session to
    // this Google account only long enough to obtain its access token, then keep
    // the token bound to the linked account object while moving to the next one.
    linkedAccountSyncTargetId = account.id;
    await openMatchingLabsSignIn(email, account.flowUrl, false);
    return { status: 'sign_in_started', email };
  } catch (error) {
    return {
      status: 'session_sync_failed',
      error: error?.message?.startsWith('LABS_') || error?.message === 'UNEXPECTED_SIGNIN_DESTINATION'
        ? error.message : 'SESSION_CHECK_FAILED',
    };
  }
}

async function refreshSelectedAccountSession(allowSignIn = false) {
  if (accountSyncPending) return accountSyncPending;
  const tabId = selectedFlowTabId;
  const account = selectedFlowAccount;
  if (tabId === null || !account) return;
  const stillSelected = () => selectedFlowTabId === tabId && selectedFlowAccount === account;
  accountSyncPending = (async () => {
    try {
      const identity = await readFlowIdentity(tabId);
      if (!stillSelected() || flowAccountFromUrl(identity.url) !== account) return;
      const email = normalizeFlowEmail(identity.email);
      if (!email) {
        flowSessionStatus = { status: 'identity_unavailable', email: null };
        return;
      }
      if (flowSessionStatus.email && flowSessionStatus.email !== email) await invalidateFlowSession();
      const session = await fetchLabsSession();
      // Recheck the actual document after network I/O; a login can change
      // identity without changing either the tab id or /u/N URL.
      const current = await readFlowIdentity(tabId);
      if (!stillSelected() || flowAccountFromUrl(current.url) !== account
          || normalizeFlowEmail(current.email) !== email) return;
      const sessionEmail = normalizeFlowEmail(session?.user?.email);
      if (sessionEmail === email && typeof session?.access_token === 'string'
          && captureBearerToken(`Bearer ${session.access_token}`, account, 'labs_session')) {
        flowSessionStatus = { status: 'ready', email, source: 'verified_labs_session' };
        if (accountSyncTabId !== null) {
          const syncId = accountSyncTabId;
          accountSyncTabId = null;
          // Only close the tab this sync created, after successful verification.
          await chrome.tabs.remove(syncId).catch(() => {});
        }
        return;
      }
      await invalidateFlowSession();
      flowSessionStatus = { status: sessionEmail && sessionEmail !== email ? 'account_mismatch' : 'sign_in_required',
        email, labsEmail: sessionEmail };
      if (allowSignIn) await openMatchingLabsSignIn(email, identity.url);
    } catch (error) {
      if (stillSelected()) flowSessionStatus = { ...flowSessionStatus, status: 'session_sync_failed',
        error: error?.message?.startsWith('LABS_') || error?.message === 'UNEXPECTED_SIGNIN_DESTINATION'
          ? error.message : 'SESSION_CHECK_FAILED' };
    }
  })().finally(() => {
    accountSyncPending = null;
    if (stillSelected()) void sendToAgent({ type: 'account_session', account_session: flowSessionStatus,
      selected_flow_url: selectedFlowUrl, clientId: extensionClientId });
  });
  return accountSyncPending;
}
