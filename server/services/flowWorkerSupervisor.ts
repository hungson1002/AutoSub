import { spawn, type ChildProcess } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workdir } from './ffmpeg';

export type IsolatedFlowWorker = {
  clientId: string;
  port: number;
  baseUrl: string;
  state: string;
  tokenReady: boolean;
  pid?: number;
};

type FlowWorkerRecord = {
  clientId: string;
  port: number;
  createdAt: string;
};

const API_PORT_MIN = Number(process.env.AUTOSUB_FLOW_WORKER_PORT_MIN || 8101);
const API_PORT_MAX = Number(process.env.AUTOSUB_FLOW_WORKER_PORT_MAX || 8199);
const HTTP_CALLBACK_PORT_BASE = Number(process.env.AUTOSUB_FLOW_WORKER_HTTP_PORT_BASE || 18101);
const WS_PORT_BASE = Number(process.env.AUTOSUB_FLOW_WORKER_WS_PORT_BASE || 19101);
const registryFile = () => path.join(workdir, 'flow-workers', 'registry.json');
const workerOutputDir = (clientId: string) => path.join(workdir, 'flow-workers', clientId.replace(/[^a-zA-Z0-9._-]/g, '_'));
const workers = new Map<string, { record: FlowWorkerRecord; child?: ChildProcess }>();
let registryLoaded: Promise<void> | undefined;

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
      clients?: Array<{ client_id?: string; state?: string; has_flow_key?: boolean }>;
    };
  } catch {
    return undefined;
  }
}

function healthForClient(body: Awaited<ReturnType<typeof fetchWorkerHealth>>, clientId: string) {
  const client = body?.clients?.find((item) => item.client_id === clientId);
  return {
    tokenReady: Boolean(client?.has_flow_key),
    state: client?.state || (client ? 'connected' : body?.status || 'starting'),
  };
}

async function choosePort(preferredPort?: number) {
  await loadRegistry();
  const used = new Set([...workers.values()].map((item) => item.record.port));
  if (preferredPort && validPort(preferredPort)) {
    const occupant = [...workers.values()].find((item) => item.record.port === preferredPort);
    if (!occupant) return preferredPort;
  }
  for (let port = API_PORT_MIN; port <= API_PORT_MAX; port += 1) if (!used.has(port)) return port;
  throw new Error('Không còn cổng Flow worker trống.');
}

async function startWorker(record: FlowWorkerRecord) {
  const existingHealth = await fetchWorkerHealth(record.port, 700);
  if (existingHealth) return;

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
      MAX_CONCURRENT_REQUESTS: '1',
      REQUEST_MIN_INTERVAL: process.env.REQUEST_MIN_INTERVAL || '0.35',
      GLOBAL_REQUEST_MIN_INTERVAL: process.env.GLOBAL_REQUEST_MIN_INTERVAL || '0',
      API_REQUEST_TIMEOUT: process.env.API_REQUEST_TIMEOUT || '120',
      FLOW_INTERNAL_AUTO_FAILOVER: '0',
    },
  });
  child.unref();
  const item = workers.get(record.clientId);
  if (item) item.child = child;
  child.once('exit', () => {
    const current = workers.get(record.clientId);
    if (current?.child === child) current.child = undefined;
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await fetchWorkerHealth(record.port, 700)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Flow worker ${record.clientId} không mở được port ${record.port}.`);
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
  } else if (preferredPort && validPort(preferredPort) && item.record.port !== preferredPort) {
    const conflict = [...workers.values()].some((other) => other !== item && other.record.port === preferredPort);
    if (!conflict) {
      item.record.port = preferredPort;
      await saveRegistry();
    }
  }

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
  return (await listIsolatedFlowWorkers()).filter((item) => item.tokenReady);
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
  if (item.child?.pid) {
    try { process.kill(item.child.pid); } catch { /* already stopped */ }
    item.child = undefined;
  }
  await startWorker(item.record);
  return ensureIsolatedFlowWorker(clientId, item.record.port);
}
