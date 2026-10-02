import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../flow-extension/background.js', import.meta.url), 'utf8');
const flowSource = await readFile(new URL('./googleFlow.ts', import.meta.url), 'utf8');
const supervisorSource = await readFile(new URL('./flowWorkerSupervisor.ts', import.meta.url), 'utf8');
function section(start: string, end: string) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0);
  const finish = source.indexOf(end, offset + start.length);
  assert.ok(finish > offset);
  return source.slice(offset, finish);
}
function fixture() {
  const account = { id: 'linked-one', clientId: 'account-one', callbackSecret: 'test-secret', callbackUrl: 'http://127.0.0.1:8101/api/ext/callback', httpConnected: true, pollIntervalMs: 1000, pollFailures: 0 };
  const saved: any[] = [];
  const scheduled: number[] = [];
  let reconnects = 0;
  const context = vm.createContext({
    account, linkedFlowAccounts: [account], linkedPollBusy: new Set(), linkedCommandQueues: new Map(), linkedCommandIds: new Set(),
    outbox: {}, _flushingOutbox: false, outboxRetryTimer: null, MAX_DELIVERY_ATTEMPTS: 0,
    FLOW_AGENT_CALLBACK_TIMEOUT_MS: 2000, FLOW_AGENT_POLL_TIMEOUT_MS: 2000,
    manualDisconnect: false, callbackSecret: 'primary-secret', extensionClientId: 'primary', connectedServerHost: '127.0.0.1:8001',
    CONFIG: { DEFAULT_SERVER_HOST: '127.0.0.1:8001' }, ws: null, WebSocket: { OPEN: 1 }, AbortSignal, Date,
    console: { warn() {}, error() {} },
    chrome: { storage: { local: { async set(value: unknown) { saved.push(structuredClone(value)); } } } },
    setTimeout(_fn: unknown, delay: number) { scheduled.push(delay); return 1; }, clearTimeout() {},
    linkedAgentHttpBase: () => 'http://127.0.0.1:8101', normalizeCallbackUrl: () => 'http://127.0.0.1:8001/api/ext/callback',
    async connectLinkedAccount() { reconnects += 1; }, scheduleLinkedReconnect() { reconnects += 1; },
    scheduleLinkedPoll(_account: unknown, delay: number) { scheduled.push(delay); }, pumpLinkedCommands() {},
    fetch: async () => Response.json({ commands: [] }),
  });
  vm.runInContext([
    section('async function sendLinkedResponse(', 'function syncLinkedActivityState('),
    section('async function pollLinkedAccount(', 'async function waitForLinkedAccountToken('),
    section('function persistOutbox(', 'function enqueueResponse('),
    section('async function deliverOnce(', 'async function flushOutbox('),
    section('async function flushOutbox(', 'async function requestCaptchaFromTab('),
  ].join('\n'), context);
  return { context, account, saved, scheduled, reconnects: () => reconnects };
}

test('Flow recovery may self-heal isolated workers but never restarts AutoSub/npm dev', () => {
  assert.match(flowSource, /ensureIsolatedFlowWorker\s*\(/);
  assert.match(supervisorSource, /listIsolatedFlowWorkers\(\{\s*ensureRunning:\s*true\s*\}\)/);
  assert.doesNotMatch(supervisorSource, /spawn\(\s*['\"]npm(?:\.cmd)?['\"]/i);
  const reconnectSection = section('async function connectLinkedAccount(', 'async function sendLinkedResponse(');
  assert.match(reconnectSection, /ensureLinkedWorkerRuntime\s*\(/);
});

test('missing linked token preserves the Flow tab so refresh can recover it', () => {
  const apiSection = section('async function handleLinkedApiRequest(', 'async function handleLinkedAccountCommand(');
  const missingTokenBranch = apiSection.slice(apiSection.indexOf('if (!account.flowKey)'), apiSection.indexOf('const hasCaptcha'));
  assert.doesNotMatch(missingTokenBranch, /closeUnusableLinkedFlowAccountTab/);
  assert.match(missingTokenBranch, /needsInitialTokenBootstrap\s*=\s*true/);
  const refreshSection = section('async function refreshLinkedFlowAccount(', 'function isLinkedAccountTokenFresh(');
  assert.match(refreshSection, /needsInitialTokenBootstrap\s*=\s*true/);
});

test('Flow recovery ladder lets the Agent time out before the browser fetch so late results can reconcile', () => {
  assert.match(source, /FLOW_API_FETCH_TIMEOUT_MS\s*=\s*600_000/);
  assert.match(supervisorSource, /API_REQUEST_TIMEOUT:\s*process\.env\.API_REQUEST_TIMEOUT\s*\|\|\s*'300'/);
  assert.match(flowSource, /AUTOSUB_FLOW_IMAGE_REQUEST_TIMEOUT_MS\)\s*\|\|\s*720_000/);
  assert.match(flowSource, /AUTOSUB_FLOW_IMAGE_UNCERTAIN_REPLAY_TIMEOUT_MS\)\s*\|\|\s*300_000/);
});

test('linked image result survives a callback failure and retries delivery to its own worker', async () => {
  const f = fixture();
  const calls: Array<{ url: string; body: any }> = [];
  let fail = true;
  f.context.fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (fail) throw new Error('connection reset');
    return Response.json({ ok: true });
  };
  const message = { id: 'image-1', status: 200, data: { image: 'finished-image' } };
  await f.context.sendLinkedResponse(f.account, message);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.saved[0].responseOutbox['account-one:image-1'].msg.data.image, 'finished-image');
  assert.ok(f.context.outbox['account-one:image-1']);
  assert.ok(f.scheduled.some((delay) => delay > 0 && delay < 30_000));
  fail = false;
  f.context.outbox['account-one:image-1'].nextAt = 0;
  await f.context.flushOutbox();
  assert.equal(f.context.outbox['account-one:image-1'], undefined);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === f.account.callbackUrl && call.body.session_id === f.account.clientId));
  assert.deepEqual(calls[0].body, calls[1].body);
});



test('durable outbox never drops a generated result after repeated callback failures', async () => {
  const f = fixture();
  f.context.fetch = async () => { throw new Error('backend offline'); };
  const message = { id: 'image-durable', status: 200, data: { image: 'keep-me' } };
  await f.context.sendLinkedResponse(f.account, message);
  await new Promise((resolve) => setImmediate(resolve));
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const entry = f.context.outbox['account-one:image-durable'];
    assert.ok(entry, `result disappeared after callback failure ${attempt + 1}`);
    entry.nextAt = 0;
    await f.context.flushOutbox();
  }
  assert.equal(f.context.outbox['account-one:image-durable'].msg.data.image, 'keep-me');
  assert.ok(f.context.outbox['account-one:image-durable'].attempts >= 12);
});

test('primary HTTP polling tolerates transient failures before reconnecting', async () => {
  const scheduled: number[] = [];
  let reconnects = 0;
  const context = vm.createContext({
    httpConnected: true,
    manualDisconnect: false,
    httpPollFailures: 0,
    httpPollIntervalMs: 1000,
    httpPollTimer: null,
    callbackSecret: '[REDACTED]',
    extensionClientId: 'primary',
    FLOW_AGENT_POLL_TIMEOUT_MS: 2000,
    AbortSignal,
    console: { warn() {} },
    setTimeout(_fn: unknown, delay: number) { scheduled.push(delay); return 1; },
    clearTimeout() {},
    agentHttpBase: () => 'http://127.0.0.1:8001',
    handleAgentCommand() {},
    scheduleReconnect() { reconnects += 1; },
    fetch: async () => { throw new Error('temporary timeout'); },
  });
  vm.runInContext(section('function scheduleHttpPoll(', 'function scheduleReconnect('), context);
  await context.pollHttpCommands();
  assert.equal(context.httpConnected, true);
  assert.equal(context.httpPollFailures, 1);
  assert.equal(reconnects, 0);
  await context.pollHttpCommands();
  assert.equal(context.httpConnected, true);
  await context.pollHttpCommands();
  assert.equal(context.httpConnected, true, 'transient stalls under multi-account load must not flap the bridge at 3/5');
  await context.pollHttpCommands();
  assert.equal(context.httpConnected, true);
  await context.pollHttpCommands();
  assert.equal(context.httpConnected, false);
  assert.equal(reconnects, 1);
});

test('a queued linked result is never delivered through the primary account', async () => {
  const f = fixture();
  f.context.linkedFlowAccounts = [];
  f.context.fetch = () => { throw new Error('must not send'); };
  assert.equal(await f.context.deliverOnce({ clientId: 'account-one', msg: { id: 'one' } }), false);
});

test('one transient poll failure preserves connection; success clears the failure count', async () => {
  const f = fixture();
  f.context.fetch = async () => { throw new Error('temporary timeout'); };
  await f.context.pollLinkedAccount(f.account.id);
  assert.equal(f.account.httpConnected, true);
  assert.equal(f.reconnects(), 0);
  f.context.fetch = async () => Response.json({ commands: [] });
  await f.context.pollLinkedAccount(f.account.id);
  assert.equal(f.account.pollFailures, 0);
});

test('three consecutive poll failures trigger reconnect; authentication failure does so immediately', async () => {
  const f = fixture();
  f.context.fetch = async () => Response.json({}, { status: 503 });
  for (let index = 0; index < 3; index++) await f.context.pollLinkedAccount(f.account.id);
  assert.equal(f.account.httpConnected, false);
  assert.equal(f.reconnects(), 1);
  const auth = fixture();
  auth.context.fetch = async () => Response.json({}, { status: 401 });
  await auth.context.pollLinkedAccount(auth.account.id);
  assert.equal(auth.account.httpConnected, false);
  assert.equal(auth.reconnects(), 1);
});

test('redelivered commands do not schedule another generation while queued or awaiting callback delivery', async () => {
  const f = fixture();
  f.context.fetch = async () => Response.json({ commands: [{ id: 'one', method: 'api_request' }] });
  await f.context.pollLinkedAccount(f.account.id);
  await f.context.pollLinkedAccount(f.account.id);
  assert.equal(f.context.linkedCommandQueues.get(f.account.id).length, 1);
  f.context.linkedCommandIds.clear();
  f.context.linkedCommandQueues.set(f.account.id, []);
  f.context.outbox['account-one:one'] = { clientId: 'account-one', msg: { id: 'one', status: 200 } };
  await f.context.pollLinkedAccount(f.account.id);
  assert.equal(f.context.linkedCommandQueues.get(f.account.id).length, 0);
});

test('accounts sharing one Flow project are flagged so the popup names the collision', () => {
  // Exact live shape: 9 workers, one shared project 0143adf4-… — only its
  // owner passes Google; the rest fail upstream er/400. The popup must say
  // which accounts collide instead of failing silently at generation time.
  const shared = '0143adf4-5864-4cb4-abb5-fe4254ad0dc7';
  const solo = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const accounts = [
    { id: 'a1', clientId: 'account-01', email: 'a1@x.test', flowProjectId: shared, httpConnected: true, flowKey: 'k1' },
    { id: 'a2', clientId: 'account-02', email: 'a2@x.test', flowProjectId: shared, httpConnected: true, flowKey: 'k2' },
    { id: 'a3', clientId: 'account-03', email: 'a3@x.test', flowProjectId: solo, httpConnected: true, flowKey: 'k3' },
    { id: 'a4', clientId: 'account-04', email: 'a4@x.test', flowProjectId: null, httpConnected: true, flowKey: 'k4' },
  ];
  const context = vm.createContext({
    linkedFlowAccounts: accounts,
    FlowBatchCompat: {
      isUsableFlowProjectId: (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || '').trim()),
    },
    normalizeStoredFlowEmail: (value: unknown) => String(value || '').trim().toLowerCase() || null,
  });
  vm.runInContext(section('function publicLinkedAccount(', 'function persistLinkedAccounts('), context);
  const [one, two, three, four] = accounts.map((account) => context.publicLinkedAccount(account));
  assert.equal(one.flowProjectId, shared);
  assert.equal(one.flowProjectHint, shared.slice(-8));
  assert.equal(one.projectShared, true);
  assert.equal(two.projectShared, true);
  assert.equal(three.projectShared, false);
  assert.equal(four.projectShared, false);
  assert.equal(four.flowProjectId, null);
  // Token alive but no usable project: generation would fall back to the
  // retired placeholder and die upstream er/400. Flag it, don't call it ready.
  assert.equal(four.needsProject, true);
  assert.equal(one.needsProject, false);
  const noToken = { id: 'a5', clientId: 'account-05', email: 'a5@x.test', flowProjectId: null, httpConnected: false, flowKey: null };
  assert.equal(context.publicLinkedAccount(noToken).needsProject, false);
});

test('project-less accounts get their Flow tabs auto-opened one by one', () => {
  // Google removed project creation from every API: the click stays manual,
  // but the extension must bring each project-less tab to flow.google.com
  // itself instead of asking the user to hunt tabs.
  const sectionText = source.slice(source.indexOf('async function ensureFlowProjectTabs('));
  assert.match(sectionText, /ensureLinkedFlowAccountTab\(account,\s*true\)/);
  assert.match(sectionText, /https:\/\/flow\.google\.com\//);
  assert.match(sectionText, /isUsableFlowProjectId\(account\.flowProjectId\)/);
  assert.match(source, /msg\.type === 'ENSURE_FLOW_PROJECTS'/);
});

test('tab diagnosis reports project presence per account without touching tabs', async () => {
  const tabs: Record<number, { id: number; url: string; status: string; active: boolean }> = {
    11: { id: 11, url: 'https://flow.google.com/u/1/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'complete', active: true },
    22: { id: 22, url: 'https://flow.google.com/', status: 'complete', active: false },
  };
  const accounts = [
    { id: 'a1', clientId: 'account-01', email: 'a1@x.test', tabId: 11, flowKey: 'k1', httpConnected: true },
    { id: 'a2', clientId: 'account-02', email: 'a2@x.test', tabId: 22, flowKey: 'k2', httpConnected: true },
    { id: 'a3', clientId: 'account-03', email: 'a3@x.test', tabId: 99, flowKey: null, httpConnected: false },
  ];
  const context = vm.createContext({
    linkedFlowAccounts: accounts,
    URL,
    FlowBatchCompat: {
      isUsableFlowProjectId: (value: unknown) => /^[0-9a-f-]{36}$/i.test(String(value || '').trim()),
      flowProjectIdFromUrl: (url: unknown) => String(url || '').match(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i)?.[0] || null,
    },
    normalizeStoredFlowEmail: (value: unknown) => String(value || '').trim().toLowerCase() || null,
    chrome: { tabs: { async get(tabId: number) { return tabs[tabId] || null; } } },
  });
  vm.runInContext(section('async function diagnoseLinkedTabs(', 'async function removeLinkedFlowAccount('), context);
  const summary = await context.diagnoseLinkedTabs();
  assert.equal(summary.total, 3);
  const [one, two, three] = summary.rows;
  assert.equal(one.hasTab, true);
  assert.equal(one.isFlowPage, true);
  assert.equal(one.urlHasProject, true);
  assert.equal(one.tabActive, true);
  assert.equal(two.hasTab, true);
  assert.equal(two.urlHasProject, false);
  assert.equal(three.hasTab, false);
  assert.equal(three.tokenPresent, false);
});
