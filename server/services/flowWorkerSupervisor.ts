import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConnection } from 'node:net';
import { workdir } from './ffmpeg';
import { ensureFlowAgentRuntimePatched } from './flowAgentRuntimePatch';

export type IsolatedFlowWorker = {
  clientId: string;
  port: number;
  baseUrl: string;
  state: string;
  tokenReady: boolean;
  extensionConnected: boolean;
  pid?: number;
};

export type FlowWorkerIdempotencyRecord = {
  state: 'processing' | 'succeeded' | 'failed';
  recordedAtMs?: number;
  createdAtKnown?: boolean;
  response?: unknown;
  error?: { status_code?: number; detail?: string };
};

type FlowWorkerRecord = {
  clientId: string;
  port: number;
  createdAt: string;
  pid?: number;
};

const API_PORT_MIN = Number(process.env.AUTOSUB_FLOW_WORKER_PORT_MIN || 8101);
const API_PORT_MAX = Number(process.env.AUTOSUB_FLOW_WORKER_PORT_MAX || 8199);
const HTTP_CALLBACK_PORT_BASE = Number(process.env.AUTOSUB_FLOW_WORKER_HTTP_PORT_BASE || 18101);
const WS_PORT_BASE = Number(process.env.AUTOSUB_FLOW_WORKER_WS_PORT_BASE || 19101);
const WORKER_START_TIMEOUT_MS = Math.max(10_000, Math.min(60_000, Number(process.env.AUTOSUB_FLOW_WORKER_START_TIMEOUT_MS) || 30_000));
const registryFile = () => path.join(workdir, 'flow-workers', 'registry.json');
const workerOutputDir = (clientId: string) => path.join(workdir, 'flow-workers', clientId.replace(/[^a-zA-Z0-9._-]/g, '_'));
const workers = new Map<string, { record: FlowWorkerRecord; child?: ChildProcess }>();
let registryLoaded: Promise<void> | undefined;

/** Read the durable result written by this isolated worker's Flow Agent. */
export async function readFlowWorkerIdempotencyRecord(clientId: string, idempotencyKey: string): Promise<FlowWorkerIdempotencyRecord | undefined> {
  const normalizedClientId = String(clientId || '').trim();
  const normalizedKey = String(idempotencyKey || '').trim();
  if (!/^account-[a-zA-Z0-9_-]+$/.test(normalizedClientId) || !normalizedKey || normalizedKey.length > 4096) return undefined;
  const keyId = createHash('sha256').update(normalizedKey).digest('hex');
  try {
    const data = JSON.parse(await readFile(path.join(workerOutputDir(normalizedClientId), '.flow-idempotency.json'), 'utf8')) as {
      entries?: Record<string, unknown>;
    };
    const record = data?.entries?.[keyId];
    if (!record || typeof record !== 'object') return undefined;
    const value = record as Record<string, unknown>;
    if (!['processing', 'succeeded', 'failed'].includes(String(value.state))) return undefined;
    const error = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : undefined;
    const created = Number(value.created);
    const createdAtKnown = Number.isFinite(created) && created > 0;
    const recordedAtMs = createdAtKnown
      ? created * 1000
      : (await stat(path.join(workerOutputDir(normalizedClientId), '.flow-idempotency.json'))).mtimeMs;
    return {
      recordedAtMs,
      createdAtKnown,
      state: value.state as FlowWorkerIdempotencyRecord['state'],
      ...(value.response === undefined ? {} : { response: value.response }),
      ...(error ? {
        error: {
          ...(Number.isFinite(Number(error.status_code)) ? { status_code: Number(error.status_code) } : {}),
          ...(typeof error.detail === 'string' ? { detail: error.detail } : {}),
        },
      } : {}),
    };
  } catch {
    // A missing/unreadable local record must not turn an HTTP conflict into a
    // guessed replay. The caller will preserve the original conflict instead.
    return undefined;
  }
}

async function terminateFlowWorkerProcessTree(pid: number) {
  if (process.platform !== 'win32') {
    try { process.kill(pid); } catch { /* already stopped */ }
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      try { process.kill(pid); } catch { /* already stopped */ }
      finish();
    }, 5_000);
    killer.once('error', () => {
      try { process.kill(pid); } catch { /* already stopped */ }
      finish();
    });
    killer.once('exit', finish);
  });
}

async function flowWorkerListenerPids(record: FlowWorkerRecord) {
  if (process.platform !== 'win32') return [] as number[];
  const offset = record.port - API_PORT_MIN;
  const ports = new Set([record.port, HTTP_CALLBACK_PORT_BASE + offset, WS_PORT_BASE + offset]);
  return new Promise<number[]>((resolve) => {
    let output = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const pids = new Set<number>();
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
        if (!match || !ports.has(Number(match[1]))) continue;
        const pid = Number(match[2]);
        if (Number.isInteger(pid) && pid > 0) pids.add(pid);
      }
      resolve([...pids]);
    };
    const scanner = spawn('netstat.exe', ['-ano', '-p', 'tcp'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const timer = setTimeout(finish, 3_000);
    scanner.stdout?.on('data', (chunk) => { output += String(chunk); });
    scanner.once('error', finish);
    scanner.once('close', finish);
  });
}

async function isLocalPortListening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function isFlowWorkerRuntimeListening(record: FlowWorkerRecord) {
  const offset = record.port - API_PORT_MIN;
  const ports = [record.port, HTTP_CALLBACK_PORT_BASE + offset, WS_PORT_BASE + offset];
  for (const port of ports) {
    if (await isLocalPortListening(port)) return true;
  }
  return false;
}

export function shouldSpawnIsolatedFlowWorker(healthResponded: boolean, runtimePortListening: boolean) {
  return !healthResponded && !runtimePortListening;
}

async function stopFlowWorkerProcesses(record: FlowWorkerRecord, child?: ChildProcess) {
  const pids = new Set<number>();
  if (child?.pid) pids.add(child.pid);
  for (const pid of await flowWorkerListenerPids(record)) pids.add(pid);
  for (const pid of pids) await terminateFlowWorkerProcessTree(pid);
}

function flowExecutableCandidates() {
  const configured = process.env.FLOW_AGENT_COMMAND?.trim();
  const userProfile = process.env.USERPROFILE?.trim();
  const localAppData = process.env.LOCALAPPDATA?.trim();
  return [
    configured,
    userProfile ? path.join(userProfile, '.local', 'bin', 'flow.exe') : undefined,
    localAppData ? path.join(localAppData, 'AutoSub', 'flow-agent-runtime', 'flow.exe') : undefined,
  ].filter((item): item is string => Boolean(item));
}

async function resolveFlowExecutable() {
  for (const candidate of flowExecutableCandidates()) {
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  return 'flow';
}

function validPort(port: number) {
  return Number.isInteger(port) && port >= API_PORT_MIN && port <= API_PORT_MAX;
}

async function loadRegistry() {
  if (!registryLoaded) {
    registryLoaded = (async () => {
      try {
        const parsed = JSON.parse(await readFile(registryFile(), 'utf8')) as FlowWorkerRecord[];
        if (Array.isArray(parsed)) {
          for (const record of parsed) {
            if (!record?.clientId || !validPort(Number(record.port))) continue;
            workers.set(record.clientId, { record: { ...record, port: Number(record.port) } });
          }
        }
      } catch { /* first run */ }
    })();
  }
  await registryLoaded;
}

async function saveRegistry() {
  await mkdir(path.dirname(registryFile()), { recursive: true });
  const records = [...workers.values()].map((item) => item.record).sort((a, b) => a.port - b.port);
  await writeFile(registryFile(), JSON.stringify(records, null, 2), 'utf8');
}

async function fetchWorkerHealth(port: number, timeoutMs = 1_200) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return await response.json() as {
      status?: string;
      extension_connected?: boolean;
      clients?: Array<{ client_id?: string; state?: string; has_flow_key?: boolean }>;
    };
  } catch {
    return undefined;
  }
}

function healthForClient(body: Awaited<ReturnType<typeof fetchWorkerHealth>>, clientId: string) {
  const client = body?.clients?.find((item) => item.client_id === clientId);
  const state = client?.state || (client ? 'connected' : body?.status || 'starting');
  const disconnected = /unauthorized|disconnected|offline|failed/i.test(state);
  return {
    tokenReady: Boolean(client?.has_flow_key),
    extensionConnected: Boolean(client) && !disconnected
      && (typeof body?.extension_connected === 'boolean'
        ? body.extension_connected
        : !/unauthorized|disconnected|offline|failed/i.test(body?.status || '')),
    state,
  };
}

export function isReadyIsolatedFlowWorker(worker: Pick<IsolatedFlowWorker, 'tokenReady' | 'extensionConnected'>) {
  // The migrated Flow browser RPC uses the signed-in page session (cookies,
  // page CSRF token and a fresh CAPTCHA), not the retired Bearer token. A
  // linked worker with a live extension bridge can therefore serve images
  // even when /v1/credits reports NO_FLOW_KEY.
  return worker.extensionConnected;
}

async function choosePort(preferredPort?: number) {
  await loadRegistry();
  const used = new Set([...workers.values()].map((item) => item.record.port));
  const physicallyFree = async (port: number) => !(await fetchWorkerHealth(port, 180));
  if (preferredPort && validPort(preferredPort)) {
    const occupant = [...workers.values()].find((item) => item.record.port === preferredPort);
    if (!occupant && await physicallyFree(preferredPort)) return preferredPort;
  }
  for (let port = API_PORT_MIN; port <= API_PORT_MAX; port += 1) {
    if (used.has(port)) continue;
    if (await physicallyFree(port)) return port;
  }
  throw new Error('Không còn cổng Flow worker trống.');
}

async function startWorkerImpl(record: FlowWorkerRecord) {
  await ensureFlowAgentRuntimePatched();
  const existingHealth = await fetchWorkerHealth(record.port, 700);
  if (existingHealth) return;

  // /health shares the worker's event loop with image generation and can miss
  // this short probe while a request is still running. A listening port is
  // evidence that the worker process still owns this account and port; never
  // start a competing instance or kill its listener on that evidence alone.
  if (!shouldSpawnIsolatedFlowWorker(false, await isFlowWorkerRuntimeListening(record))) {
    const recoveryDeadline = Date.now() + 8_000;
    while (Date.now() < recoveryDeadline) {
      if (await fetchWorkerHealth(record.port, 1_200)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Flow worker ${record.clientId} vẫn đang giữ cổng ${record.port} nhưng /health đang chậm; giữ nguyên tiến trình để bảo toàn request đang chạy.`);
  }

  const executable = await resolveFlowExecutable();
  const offset = record.port - API_PORT_MIN;
  const outputDir = workerOutputDir(record.clientId);
  await mkdir(outputDir, { recursive: true });

  const child = spawn(executable, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      OPENAI_API_HOST: '127.0.0.1',
      OPENAI_API_PORT: String(record.port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${record.port}`,
      FLOW_OUTPUT_DIR: outputDir,
      HTTP_PORT: String(HTTP_CALLBACK_PORT_BASE + offset),
      WS_PORT: String(WS_PORT_BASE + offset),
      EXT_POLL_INTERVAL_MS: process.env.EXT_POLL_INTERVAL_MS || '250',
      EXT_TRANSPORT: 'http',
      // Isolated workers share the browser profile and its CAPTCHA reputation.
      // Keep each worker single-flight and use FlowKit's conservative 3s pace;
      // the backend also applies one profile-wide slot across these processes.
      MAX_CONCURRENT_REQUESTS: '1',
      REQUEST_MIN_INTERVAL: String(Math.max(3, Math.min(30, Number(process.env.REQUEST_MIN_INTERVAL) || 0))),
      GLOBAL_REQUEST_MIN_INTERVAL: String(Math.max(3, Math.min(30, Number(process.env.GLOBAL_REQUEST_MIN_INTERVAL) || 0))),
      API_REQUEST_TIMEOUT: process.env.API_REQUEST_TIMEOUT || '300',
      FLOW_INTERNAL_AUTO_FAILOVER: '0',
    },
  });
  child.unref();
  const item = workers.get(record.clientId);
  if (item) {
    item.child = child;
    item.record.pid = child.pid;
    void saveRegistry();
  }
  child.once('exit', () => {
    const current = workers.get(record.clientId);
    if (current?.child === child) {
      current.child = undefined;
      current.record.pid = undefined;
      void saveRegistry();
    }
  });

  const startupDeadline = Date.now() + WORKER_START_TIMEOUT_MS;
  while (Date.now() < startupDeadline) {
    if (await fetchWorkerHealth(record.port, 900)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (child.pid) await terminateFlowWorkerProcessTree(child.pid);
  throw new Error(`Flow worker ${record.clientId} không mở được port ${record.port}.`);
}

const flowWorkerStarts = new Map<string, Promise<void>>();

async function startWorker(record: FlowWorkerRecord) {
  const pending = flowWorkerStarts.get(record.clientId);
  if (pending) return pending;
  const start = startWorkerImpl(record);
  flowWorkerStarts.set(record.clientId, start);
  try {
    await start;
  } finally {
    if (flowWorkerStarts.get(record.clientId) === start) flowWorkerStarts.delete(record.clientId);
  }
}

export async function ensureIsolatedFlowWorker(clientId: string, preferredPort?: number) {
  const normalizedClientId = String(clientId || '').trim();
  if (!/^account-[a-zA-Z0-9_-]+$/.test(normalizedClientId)) throw new Error('Flow worker clientId không hợp lệ.');
  await loadRegistry();

  let item = workers.get(normalizedClientId);
  if (!item) {
    const port = await choosePort(preferredPort);
    item = {
      record: {
        clientId: normalizedClientId,
        port,
        createdAt: new Date().toISOString(),
      },
    };
    workers.set(normalizedClientId, item);
    await saveRegistry();
  }

  // Once a client has a registered port, keep it stable. Reassigning a live
  // account onto a preferred port that still contains an orphaned old Flow
  // process can silently bind the wrong runtime to the new account.
  await startWorker(item.record);
  const health = await fetchWorkerHealth(item.record.port, 1_000);
  const status = healthForClient(health, normalizedClientId);
  return {
    clientId: normalizedClientId,
    port: item.record.port,
    baseUrl: `http://127.0.0.1:${item.record.port}`,
    pid: item.child?.pid,
    ...status,
  } satisfies IsolatedFlowWorker;
}

export async function listRegisteredIsolatedFlowWorkerIds() {
  await loadRegistry();
  return [...workers.keys()].sort();
}

export async function listIsolatedFlowWorkers(options: { ensureRunning?: boolean } = {}) {
  await loadRegistry();
  const items = [...workers.values()].sort((a, b) => a.record.port - b.record.port);
  if (options.ensureRunning) {
    await Promise.allSettled(items.map((item) => startWorker(item.record)));
  }
  return Promise.all(items.map(async (item) => {
    const health = await fetchWorkerHealth(item.record.port, 1_200);
    const status = healthForClient(health, item.record.clientId);
    return {
      clientId: item.record.clientId,
      port: item.record.port,
      baseUrl: `http://127.0.0.1:${item.record.port}`,
      pid: item.child?.pid,
      ...status,
    } satisfies IsolatedFlowWorker;
  }));
}

export async function listReadyIsolatedFlowWorkers() {
  // Self-heal only isolated Flow worker executables. startWorker() never
  // restarts AutoSub/npm run dev/the UI; it only starts the missing flow worker
  // process on its registered port. This lets a recovered worker rejoin the pool
  // without interrupting the current video job.
  return (await listIsolatedFlowWorkers({ ensureRunning: true })).filter(isReadyIsolatedFlowWorker);
}

export async function syncIsolatedFlowWorkers(activeClientIds: string[]) {
  await loadRegistry();
  const active = new Set(activeClientIds.map((value) => String(value || '').trim()).filter((value) => /^account-[a-zA-Z0-9_-]+$/.test(value)));
  const removed: string[] = [];
  for (const [clientId, item] of [...workers.entries()]) {
    if (active.has(clientId)) continue;
    await stopFlowWorkerProcesses(item.record, item.child);
    workers.delete(clientId);
    removed.push(clientId);
  }
  if (removed.length) await saveRegistry();
  return { active: [...active], removed };
}

export async function isolatedFlowWorkerBase(clientId: string) {
  await loadRegistry();
  const item = workers.get(clientId);
  return item ? `http://127.0.0.1:${item.record.port}` : undefined;
}

export async function restartIsolatedFlowWorker(clientId: string) {
  await loadRegistry();
  const item = workers.get(clientId);
  if (!item) throw new Error('Không tìm thấy Flow worker.');
  await stopFlowWorkerProcesses(item.record, item.child);
  item.child = undefined;
  item.record.pid = undefined;
  await saveRegistry();
  await startWorker(item.record);
  return ensureIsolatedFlowWorker(clientId, item.record.port);
}
