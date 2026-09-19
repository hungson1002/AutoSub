import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureGoogleFlowAgentRuntime } from './googleFlow';

const flowUrl = () => {
  const configured = process.env.FLOW_GOOGLE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password
      || !['flow.google.com', 'labs.google'].includes(url.hostname)) {
      throw new Error('FLOW_GOOGLE_URL must be an HTTPS Google Flow URL.');
    }
    return url.href;
  }
  const account = process.env.FLOW_GOOGLE_AUTHUSER?.trim();
  return account && /^\d+$/.test(account)
    ? `https://flow.google.com/u/${account}/` : 'https://flow.google.com/';
};
const flowAgentUrl = () => String(process.env.FLOW_AGENT_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');

export async function resolveFlowBrowserUrl() {
  try {
    const response = await fetch(`${flowAgentUrl()}/health`, { signal: AbortSignal.timeout(1_500) });
    const health = response.ok ? await response.json() : null;
    const sessions = health && typeof health === 'object' && 'sessions' in health ? health.sessions : undefined;
    // Prefer the account actually selected in the connected browser. The env
    // URL is a startup fallback, not a permanent account binding.
    if (Array.isArray(sessions) && sessions.length === 1 && typeof sessions[0]?.selected_flow_url === 'string') {
      const url = new URL(sessions[0].selected_flow_url);
      if (url.protocol === 'https:' && !url.username && !url.password
          && (url.hostname === 'flow.google.com'
            || (url.hostname === 'labs.google' && /^\/fx\/(?:[^/]+\/)?tools\/flow(?:\/|$)/.test(url.pathname)))) {
        return url.href;
      }
    }
  } catch { /* Offline/older bridge: use the configured startup URL. */ }
  return flowUrl();
}

async function flowAgentIsRunning() {
  try {
    const response = await fetch(`${flowAgentUrl()}/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureFlowAgentRuntime() {
  const wasRunning = await flowAgentIsRunning();
  await ensureGoogleFlowAgentRuntime();
  return { started: !wasRunning, url: flowAgentUrl() };
}

function operaPath() {
  const configured = process.env.OPERA_PATH?.trim();
  if (configured) return configured;

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    throw new Error('Không tìm thấy Opera GX. Hãy đặt OPERA_PATH trong .env.');
  }

  return path.join(localAppData, 'Programs', 'Opera GX', 'opera.exe');
}

type FlowWorkerAccountRecord = {
  id: string;
  clientId: string;
  label: string;
  profileDir: string;
  createdAt: string;
};

export type FlowWorkerAccount = FlowWorkerAccountRecord & {
  connected: boolean;
  tokenReady: boolean;
  state: string;
  credits?: number;
};

const flowWorkerProcesses = new Map<string, ChildProcess>();
const flowWorkerRoot = () => path.join(process.env.LOCALAPPDATA || process.cwd(), 'AutoSub', 'flow-workers');
const flowWorkerRegistryFile = () => path.join(flowWorkerRoot(), 'accounts.json');
const flowExtensionRuntimePath = () => path.join(process.env.LOCALAPPDATA || '', 'AutoSub', 'flow-agent-runtime', 'flow-extension');

async function readFlowWorkerRegistry(): Promise<FlowWorkerAccountRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(flowWorkerRegistryFile(), 'utf8')) as FlowWorkerAccountRecord[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.clientId && item?.profileDir) : [];
  } catch {
    return [];
  }
}

async function writeFlowWorkerRegistry(accounts: FlowWorkerAccountRecord[]) {
  await mkdir(flowWorkerRoot(), { recursive: true });
  await writeFile(flowWorkerRegistryFile(), JSON.stringify(accounts, null, 2), 'utf8');
}

type FlowAgentClientHealth = { client_id?: string; state?: string; has_flow_key?: boolean };
async function flowAgentClientHealth() {
  try {
    const response = await fetch(`${flowAgentUrl()}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return [] as FlowAgentClientHealth[];
    const body = await response.json() as { clients?: FlowAgentClientHealth[] };
    return Array.isArray(body.clients) ? body.clients : [];
  } catch {
    return [] as FlowAgentClientHealth[];
  }
}

async function flowClientCredits(clientId: string) {
  try {
    const response = await fetch(`${flowAgentUrl()}/v1/credits`, {
      headers: { 'X-Client-Id': clientId },
      signal: AbortSignal.timeout(3_500),
    });
    if (!response.ok) return undefined;
    const body = await response.json() as { data?: { credits?: number }; credits?: number };
    const value = Number(body.data?.credits ?? body.credits);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function workerFlowUrl(id: string) {
  const url = new URL('https://flow.google.com/');
  url.searchParams.set('autosub_worker', id);
  return url.href;
}

async function spawnFlowWorker(account: FlowWorkerAccountRecord) {
  await ensureFlowAgentRuntime();
  const executablePath = operaPath();
  const extensionPath = flowExtensionRuntimePath();
  await Promise.all([
    access(executablePath),
    access(path.join(extensionPath, 'manifest.json')),
    mkdir(account.profileDir, { recursive: true }),
  ]).catch((error) => {
    throw new Error(`Không thể mở Flow worker: ${error instanceof Error ? error.message : String(error)}`);
  });
  const args = [
    `--user-data-dir=${account.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    workerFlowUrl(account.id),
  ];
  const child = spawn(executablePath, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.once('exit', () => {
    if (flowWorkerProcesses.get(account.id) === child) flowWorkerProcesses.delete(account.id);
  });
  child.unref();
  flowWorkerProcesses.set(account.id, child);
  return child;
}

export async function listFlowWorkerAccounts(): Promise<FlowWorkerAccount[]> {
  const accounts = await readFlowWorkerRegistry();
  const clients = await flowAgentClientHealth();
  const clientMap = new Map(clients.map((client) => [String(client.client_id || ''), client]));
  return Promise.all(accounts.map(async (account) => {
    const client = clientMap.get(account.clientId);
    const tokenReady = Boolean(client?.has_flow_key);
    return {
      ...account,
      connected: Boolean(client),
      tokenReady,
      state: client?.state || (client ? 'connected' : 'offline'),
      ...(tokenReady ? { credits: await flowClientCredits(account.clientId) } : {}),
    };
  }));
}

export async function addFlowWorkerAccount() {
  const accounts = await readFlowWorkerRegistry();
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const account: FlowWorkerAccountRecord = {
    id,
    clientId: `flow-worker-${id}`,
    label: `Flow account ${accounts.length + 1}`,
    profileDir: path.join(flowWorkerRoot(), id),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  await writeFlowWorkerRegistry(accounts);
  await spawnFlowWorker(account);
  return account;
}

export async function openFlowWorkerAccount(id: string) {
  const account = (await readFlowWorkerRegistry()).find((item) => item.id === id);
  if (!account) throw new Error('Không tìm thấy Flow account.');
  await spawnFlowWorker(account);
  return account;
}

export async function refreshFlowWorkerAccount(id: string) {
  const account = (await readFlowWorkerRegistry()).find((item) => item.id === id);
  if (!account) throw new Error('Không tìm thấy Flow account.');
  await spawnFlowWorker(account);
  try {
    await fetch(`${flowAgentUrl()}/v1/refresh-tokens`, {
      method: 'POST',
      headers: { 'X-Client-Id': account.clientId, 'X-Force-Refresh': '1' },
      signal: AbortSignal.timeout(8_000),
    });
  } catch { /* The browser window is already open for manual sign-in/recovery. */ }
  return account;
}

export async function removeFlowWorkerAccount(id: string) {
  const accounts = await readFlowWorkerRegistry();
  const account = accounts.find((item) => item.id === id);
  if (!account) return { removed: false };
  const child = flowWorkerProcesses.get(id);
  if (child?.pid) {
    try { process.kill(child.pid); } catch { /* already closed */ }
  }
  flowWorkerProcesses.delete(id);
  await writeFlowWorkerRegistry(accounts.filter((item) => item.id !== id));
  await rm(account.profileDir, { recursive: true, force: true }).catch(() => undefined);
  return { removed: true };
}

export async function openFlowBrowser() {
  await ensureFlowAgentRuntime();
  const executablePath = operaPath();
  await access(executablePath).catch(() => {
    throw new Error(`Không tìm thấy Opera GX tại ${executablePath}. Hãy đặt OPERA_PATH trong .env.`);
  });

  const targetUrl = await resolveFlowBrowserUrl();
  const child = spawn(executablePath, [targetUrl], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  return { open: true, browser: 'Opera GX', url: targetUrl };
}
