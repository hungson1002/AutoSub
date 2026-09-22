import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { ensureIsolatedFlowWorker, isolatedFlowWorkerBase, listReadyIsolatedFlowWorkers } from './flowWorkerSupervisor';

export const FLOW_VIDEO_MODELS = ['Flow Agent Auto'] as const;
export type FlowVideoModel = typeof FLOW_VIDEO_MODELS[number];
export type FlowVideoAspectRatio = '9:16' | '16:9';
export type FlowVideoReferences = {
  startImagePath?: string;
  referenceImagePaths?: string[];
};

type FlowAgentHealth = { status?: string; extension_connected?: boolean; has_flow_key?: boolean; transport?: string; clients?: Array<{ client_id?: string; state?: string; has_flow_key?: boolean }> };
type FlowAgentMedia = { url?: string; media_id?: string; resolution?: string };
type FlowAgentVideoResult = { job_id: string; status: 'processing' | 'succeeded' | 'failed'; data?: FlowAgentMedia[]; note?: string; error?: { status_code?: number; detail?: string } };
let flowSessionRefreshInFlight: Promise<void> | undefined;
const flowReferenceUploads = new Map<string, Promise<string>>();
const flowReferenceValidatedAt = new Map<string, number>();
const flowReferencePrewarmTasks = new Map<string, Promise<{ attempted: number; ready: Array<{ clientId: string; mediaId: string }>; failed: Array<{ clientId: string; error: string }>; elapsedMs: number }>>();
const FLOW_REFERENCE_UPLOAD_TIMEOUT_MS = Math.max(45_000, Math.min(120_000, Number(process.env.AUTOSUB_FLOW_REFERENCE_UPLOAD_TIMEOUT_MS) || 75_000));
const FLOW_REFERENCE_PREWARM_MAX = Math.max(1, Math.min(7, Number(process.env.AUTOSUB_FLOW_REFERENCE_PREWARM_MAX) || 7));

// Multi-account Flow pool: every connected browser client contributes two
// independent image slots. This gives 1 account = 2 parallel images,
// 2 accounts = 4, 3 accounts = 6, ... without hammering one session with all
// storyboard workers. The extension registers each linked account as its own
// X-Client-Id, and each isolated local Flow worker routes generation by that id.
type FlowImageSlot = { clientId?: string; clientCount: number };
type FlowCreditClient = { client_id?: string; ok?: boolean };
const FLOW_IMAGE_SLOTS_PER_CLIENT = Math.max(1, Math.min(2, Number(process.env.AUTOSUB_FLOW_IMAGE_SLOTS_PER_ACCOUNT) || 2));
const FLOW_IMAGE_START_GAP_MS = Math.max(0, Math.min(5_000, Number(process.env.AUTOSUB_FLOW_IMAGE_START_GAP_MS) || 900));
const FLOW_CLIENT_CACHE_MS = Math.max(250, Math.min(30_000, Number(process.env.AUTOSUB_FLOW_CLIENT_CACHE_MS) || 750));
const FLOW_CLIENT_STALE_CACHE_MS = Math.max(30_000, Math.min(600_000, Number(process.env.AUTOSUB_FLOW_CLIENT_STALE_CACHE_MS) || 300_000));
const FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS = Math.max(30_000, Math.min(600_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS) || 120_000));
const FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS = Math.max(5_000, Math.min(120_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS) || 30_000));
const FLOW_IMAGE_CREDIT_CACHE_MS = Math.max(2_000, Math.min(60_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CREDIT_CACHE_MS) || 10_000));
const FLOW_IMAGE_CREDIT_COOLDOWN_MS = Math.max(30_000, Math.min(3_600_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CREDIT_COOLDOWN_MS) || 300_000));
// Isolated workers have their own local bridge, so two requests per account is
// the intended multi-worker test mode. The legacy single bridge still uses its
// smaller adaptive cap below; isolated workers use accountCount * slotsPerAccount.
const FLOW_IMAGE_GLOBAL_CAP_MIN = Math.max(2, Math.min(4, Number(process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_CAP_MIN) || 3));
const FLOW_IMAGE_GLOBAL_CAP_MAX = Math.max(FLOW_IMAGE_GLOBAL_CAP_MIN, Math.min(4, Number(process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_CAP_MAX) || 4));
const FLOW_IMAGE_GLOBAL_CAP_INITIAL = Math.max(FLOW_IMAGE_GLOBAL_CAP_MIN, Math.min(FLOW_IMAGE_GLOBAL_CAP_MAX, Number(process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_CAP_INITIAL) || 3));
const flowImageActiveByClient = new Map<string, number>();
const flowImageLastStartedByClient = new Map<string, number>();
const flowImageCooldownUntilByClient = new Map<string, number>();
const flowImageWaiters: Array<() => void> = [];
let flowImageGlobalActive = 0;
let flowImageAdaptiveCap = FLOW_IMAGE_GLOBAL_CAP_INITIAL;
let flowImageSuccessStreak = 0;
let flowImagePressureUntil = 0;
let flowImageLastPressureAt = 0;
let flowIsolatedReadyCount = 0;
let flowClientCache: { at: number; ids: string[] } = { at: 0, ids: [] };
let flowClientRefresh: Promise<string[]> | undefined;
const flowImageCreditsByClient = new Map<string, { credits: number; at: number }>();
const flowImageCreditReads = new Map<string, Promise<number | undefined>>();

async function healthyFlowImageClients(signal?: AbortSignal) {
  const cacheAge = Date.now() - flowClientCache.at;
  if (cacheAge < FLOW_CLIENT_CACHE_MS && flowClientCache.ids.length) return flowClientCache.ids;
  // /health can become slow while Google requests are actively in flight even
  // though the linked browser workers themselves are still valid. Never probe
  // /health in the middle of a busy wave; use the last proven account list for
  // the bounded stale window and refresh it once the pool goes idle again.
  if (flowImageGlobalActive > 0 && cacheAge < FLOW_CLIENT_STALE_CACHE_MS && flowClientCache.ids.length) return flowClientCache.ids;
  if (!flowClientRefresh) {
    flowClientRefresh = (async () => {
      const timeout = AbortSignal.timeout(2_500);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const isolatedWorkers = await listReadyIsolatedFlowWorkers();
        if (isolatedWorkers.length) {
          flowIsolatedReadyCount = isolatedWorkers.length;
          const isolatedIds = isolatedWorkers.map((worker) => worker.clientId);
          flowClientCache = { at: Date.now(), ids: isolatedIds };
          return isolatedIds;
        }
        const healthResponse = await fetch(`${baseUrl()}/health`, { signal: requestSignal, headers: headers() });
        if (healthResponse.ok) {
          const health = await healthResponse.json() as FlowAgentHealth;
          const readyClientIds = [...new Set((health.clients || [])
            .filter((client) => client.has_flow_key === true && typeof client.client_id === 'string' && client.client_id.trim())
            .map((client) => client.client_id!.trim()))];
          if (readyClientIds.length) {
            flowIsolatedReadyCount = 0;
            // Every token-ready Flow Agent client is a real browser worker.
            // Keep the primary browser client in the pool alongside same-profile
            // account-* clients; otherwise primary + one linked account still
            // collapses to only two slots instead of the expected four.
            flowClientCache = { at: Date.now(), ids: readyClientIds };
            return readyClientIds;
          }
        }

        // Compatibility fallback for an older Flow Agent that does not expose
        // sanitized per-client health yet. Keep this probe bounded so a tokenless
        // client can never stall the whole storyboard queue for minutes.
        const creditsTimeout = AbortSignal.timeout(2_500);
        const creditsSignal = signal ? AbortSignal.any([signal, creditsTimeout]) : creditsTimeout;
        const response = await fetch(`${baseUrl()}/v1/credits`, { signal: creditsSignal, headers: headers() });
        if (!response.ok) throw new Error(`Flow credits HTTP ${response.status}`);
        const body = await response.json() as { clients?: FlowCreditClient[] };
        const allIds = [...new Set((body.clients || [])
          .filter((client) => client.ok === true && typeof client.client_id === 'string' && client.client_id.trim())
          .map((client) => client.client_id!.trim()))];
        const ids = allIds;
        if (ids.length) flowClientCache = { at: Date.now(), ids };
        return ids;
      } catch {
        // A busy Flow Agent can make /health miss the short probe deadline even
        // while all linked browser workers are still healthy. Do not collapse a
        // 7-account pool back to the tokenless primary client just because one
        // health probe was slow; reuse the last proven worker list for a bounded
        // stale window and let the next probe refresh it.
        if (flowClientCache.ids.length && Date.now() - flowClientCache.at < FLOW_CLIENT_STALE_CACHE_MS) {
          return flowClientCache.ids;
        }
        return [];
      }
    })().finally(() => { flowClientRefresh = undefined; });
  }
  const ids = await flowClientRefresh;
  return ids.length ? ids : [''];
}

function wakeFlowImageWaiter() {
  const wake = flowImageWaiters.shift();
  if (wake) wake();
}

function noteFlowImageSuccess() {
  flowImageSuccessStreak += 1;
  const threshold = Math.max(8, flowImageAdaptiveCap * 2);
  if (flowImageSuccessStreak >= threshold && flowImageAdaptiveCap < FLOW_IMAGE_GLOBAL_CAP_MAX) {
    flowImageAdaptiveCap += 1;
    flowImageSuccessStreak = 0;
    console.info(`[Flow pool] ổn định -> tăng global cap lên ${flowImageAdaptiveCap}`);
    wakeFlowImageWaiter();
  }
}

function noteFlowImagePressure(reason: string, severe = false) {
  flowImageSuccessStreak = 0;
  const now = Date.now();
  // Many sibling requests can fail together when the bridge is overloaded. One
  // backoff adjustment per short window is enough; otherwise seven timeouts
  // would collapse the pool all the way to one slot.
  if (now - flowImageLastPressureAt >= 4_000) {
    const next = severe
      ? Math.max(FLOW_IMAGE_GLOBAL_CAP_MIN, Math.ceil(flowImageAdaptiveCap / 2))
      : Math.max(FLOW_IMAGE_GLOBAL_CAP_MIN, flowImageAdaptiveCap - 2);
    if (next < flowImageAdaptiveCap) {
      flowImageAdaptiveCap = next;
      console.warn(`[Flow pool] backoff (${reason}) -> global cap ${flowImageAdaptiveCap}`);
    }
    flowImageLastPressureAt = now;
  }
  const pauseMs = severe ? 12_000 : 5_000;
  flowImagePressureUntil = Math.max(flowImagePressureUntil, now + pauseMs);
  wakeFlowImageWaiter();
}

async function waitForFlowImageCapacity(signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const wake = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => {
      const index = flowImageWaiters.indexOf(wake);
      if (index >= 0) flowImageWaiters.splice(index, 1);
      reject(new DOMException('Đã dừng tác vụ.', 'AbortError'));
    };
    flowImageWaiters.push(wake);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function acquireFlowImageSlot(signal?: AbortSignal, preferredClientIds?: string[]): Promise<FlowImageSlot> {
  while (true) {
    const now = Date.now();
    if (now < flowImagePressureUntil) {
      await wait(Math.min(1_000, flowImagePressureUntil - now), signal);
      continue;
    }
    const effectiveGlobalCap = flowIsolatedReadyCount > 0 ? flowIsolatedReadyCount * FLOW_IMAGE_SLOTS_PER_CLIENT : flowImageAdaptiveCap;
    if (flowImageGlobalActive >= effectiveGlobalCap) {
      await waitForFlowImageCapacity(signal);
      continue;
    }

    const allClientIds = await healthyFlowImageClients(signal);
    const preferred = preferredClientIds?.length ? new Set(preferredClientIds) : undefined;
    const clientIds = preferred ? allClientIds.filter((clientId) => preferred.has(clientId)) : allClientIds;
    if (!clientIds.length) {
      await wait(250, signal);
      continue;
    }
    const afterProbe = Date.now();
    const slotsPerClient = FLOW_IMAGE_SLOTS_PER_CLIENT;
    const creditByClient = await readFlowImageCredits(clientIds, signal);
    const capacity = clientIds.map((clientId) => ({
      clientId,
      active: flowImageActiveByClient.get(clientId) || 0,
      lastStartedAt: flowImageLastStartedByClient.get(clientId) || 0,
      cooldownUntil: flowImageCooldownUntilByClient.get(clientId) || 0,
      credits: creditByClient.get(clientId),
    })).filter((client) => client.active < slotsPerClient);
    // Prefer the account with the largest live balance. Unknown balances stay
    // usable, while known-zero accounts are the last resort until another
    // account has been ruled out.
    const candidates = capacity.filter((client) => client.cooldownUntil <= afterProbe)
      .sort((a, b) => creditRank(b.credits) - creditRank(a.credits)
        || a.active - b.active
        || a.lastStartedAt - b.lastStartedAt);
    const selected = candidates[0];
    if (!selected) {
      if (capacity.length) {
        const earliest = Math.min(...capacity.map((client) => client.cooldownUntil));
        await wait(Math.max(50, Math.min(5_000, earliest - afterProbe)), signal);
      } else {
        await waitForFlowImageCapacity(signal);
      }
      continue;
    }
    // Another waiter may have claimed the last global slot while /health was
    // being probed, so check the effective cap again before reserving.
    const currentGlobalCap = flowIsolatedReadyCount > 0 ? flowIsolatedReadyCount * FLOW_IMAGE_SLOTS_PER_CLIENT : flowImageAdaptiveCap;
    if (flowImageGlobalActive >= currentGlobalCap) {
      await waitForFlowImageCapacity(signal);
      continue;
    }
    if (selected.cooldownUntil) flowImageCooldownUntilByClient.delete(selected.clientId);
    flowImageActiveByClient.set(selected.clientId, selected.active + 1);
    flowImageGlobalActive += 1;
    const waitMs = Math.max(0, selected.lastStartedAt + FLOW_IMAGE_START_GAP_MS - Date.now());
    // Reserve this account's next-start timestamp before awaiting the stagger.
    // Otherwise several concurrent waiters can all observe lastStartedAt=0 and
    // pick the same lexicographically-first account before its first request
    // has actually started, defeating fair rotation across the seven sessions.
    flowImageLastStartedByClient.set(selected.clientId, Date.now() + waitMs);
    if (waitMs) await wait(waitMs, signal);
    return { clientId: selected.clientId || undefined, clientCount: Math.max(1, clientIds.filter(Boolean).length || 1) };
  }
}

function cooldownFlowImageClient(clientId: string | undefined, milliseconds: number) {
  if (!clientId) return;
  const until = Date.now() + Math.max(1_000, milliseconds);
  flowImageCooldownUntilByClient.set(clientId, Math.max(flowImageCooldownUntilByClient.get(clientId) || 0, until));
  wakeFlowImageWaiter();
}

function releaseFlowImageSlot(slot: FlowImageSlot) {
  const key = slot.clientId || '';
  flowImageActiveByClient.set(key, Math.max(0, (flowImageActiveByClient.get(key) || 1) - 1));
  flowImageGlobalActive = Math.max(0, flowImageGlobalActive - 1);
  // Wake queued workers after a completion. Isolated workers expose two real
  // lanes per linked account, while the legacy bridge keeps its smaller cap.
  const effectiveGlobalCap = flowIsolatedReadyCount > 0 ? flowIsolatedReadyCount * FLOW_IMAGE_SLOTS_PER_CLIENT : flowImageAdaptiveCap;
  for (let index = 0; index < Math.max(1, effectiveGlobalCap - flowImageGlobalActive); index += 1) wakeFlowImageWaiter();
}

function invalidateFlowClientPool() {
  flowClientCache = { at: 0, ids: flowClientCache.ids };
}

export async function getGoogleFlowImagePoolCapacity(signal?: AbortSignal) {
  const ids = await healthyFlowImageClients(signal);
  const accountCount = Math.max(1, ids.filter(Boolean).length || 1);
  const isolated = flowIsolatedReadyCount > 0;
  const slotsPerAccount = FLOW_IMAGE_SLOTS_PER_CLIENT;
  const totalSlots = accountCount * slotsPerAccount;
  const effectiveCap = isolated ? totalSlots : flowImageAdaptiveCap;
  return {
    accountCount,
    slotsPerAccount,
    totalSlots,
    recommendedSlots: Math.max(1, Math.min(totalSlots, effectiveCap)),
    adaptiveCap: effectiveCap,
    isolatedWorkers: isolated,
  };
}

const baseUrl = () => String(process.env.FLOW_AGENT_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
async function flowBaseUrlForClient(clientId?: string) {
  if (!clientId) return baseUrl();
  return (await isolatedFlowWorkerBase(clientId)) || baseUrl();
}

function creditRank(credits: number | undefined) {
  if (typeof credits !== 'number' || !Number.isFinite(credits)) return -1;
  if (credits <= 0) return -2;
  return credits;
}

async function readFlowImageCredit(clientId: string, signal?: AbortSignal): Promise<number | undefined> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) return undefined;
  const cached = flowImageCreditsByClient.get(normalizedClientId);
  if (cached && Date.now() - cached.at < FLOW_IMAGE_CREDIT_CACHE_MS) return cached.credits;
  const inFlight = flowImageCreditReads.get(normalizedClientId);
  if (inFlight) return inFlight;

  const read = (async () => {
    try {
      const requestTimeout = AbortSignal.timeout(3_500);
      const requestSignal = signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout;
      const clientBase = await flowBaseUrlForClient(normalizedClientId);
      const response = await fetch(`${clientBase}/v1/credits`, {
        signal: requestSignal,
        headers: { ...headers(), 'X-Client-Id': normalizedClientId },
      });
      if (!response.ok) return undefined;
      const body = await response.json() as {
        data?: { credits?: unknown };
        credits?: unknown;
        total_credits?: unknown;
      };
      const credits = Number(body.data?.credits ?? body.credits ?? body.total_credits);
      if (!Number.isFinite(credits)) return undefined;
      flowImageCreditsByClient.set(normalizedClientId, { credits, at: Date.now() });
      return credits;
    } catch {
      return undefined;
    }
  })().finally(() => {
    flowImageCreditReads.delete(normalizedClientId);
  });
  flowImageCreditReads.set(normalizedClientId, read);
  return read;
}

async function readFlowImageCredits(clientIds: string[], signal?: AbortSignal) {
  const entries = await Promise.all(clientIds.map(async (clientId) => [
    clientId,
    await readFlowImageCredit(clientId, signal),
  ] as const));
  return new Map(entries);
}

const localFlowUrl = () => {
  try { return ['127.0.0.1', 'localhost', '::1'].includes(new URL(baseUrl()).hostname); }
  catch { return false; }
};
let flowAgentStartInFlight: Promise<void> | undefined;

const localFlowCandidates = () => {
  const explicit = String(process.env.FLOW_AGENT_COMMAND || '').trim();
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return [...new Set([
    explicit,
    process.platform === 'win32' && home ? path.join(home, '.local', 'bin', 'flow.exe') : '',
    'flow',
  ].filter(Boolean))];
};

async function flowHealthReachable(timeoutMs = 1800) {
  try {
    const response = await fetch(`${baseUrl()}/health`, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

async function localFlowPortListening(timeoutMs = 500) {
  if (!localFlowUrl()) return false;
  let parsed: URL;
  try { parsed = new URL(baseUrl()); } catch { return false; }
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  const host = parsed.hostname === 'localhost' || parsed.hostname === '::1' ? '127.0.0.1' : parsed.hostname;
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function ensureGoogleFlowAgentRuntime() {
  if (!localFlowUrl()) throw new FlowSessionError(`FLOW_AGENT_URL đang trỏ tới ${baseUrl()}, AutoSub không tự khởi động bridge từ xa.`, 'FLOW_AGENT_REMOTE');
  if (await flowHealthReachable(1500)) return;
  // If the local port is already listening, Flow Agent is alive but temporarily
  // busy. Never launch a second copy: both instances would fight for the
  // extension WebSocket port 9227 and make generation even less stable.
  if (await localFlowPortListening(700)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (await flowHealthReachable(1200)) return;
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    // During real Google generation the single FastAPI process can become slow
    // to answer /health even though the provider requests are still progressing.
    // If port 8001 is still accepting TCP connections, never misclassify this as
    // a dead bridge or spawn a second Flow Agent. Back off new work and let the
    // current request's own watchdog decide whether it truly stalled.
    noteFlowImagePressure('Flow Agent đang bận; /health phản hồi chậm', false);
    return;
  }
  if (!flowAgentStartInFlight) {
    const start = (async () => {
      let launched = false;
      let lastError = '';
      for (const command of localFlowCandidates()) {
        if (path.isAbsolute(command)) {
          try { await access(command); } catch { continue; }
        }
        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(command, [], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              shell: false,
              env: {
                ...process.env,
                // Each isolated Flow account intentionally exposes two image slots.
                // Keep the bridge semaphore aligned with the AutoSub scheduler so
                // both requests can actually run concurrently on that account.
                MAX_CONCURRENT_REQUESTS: process.env.AUTOSUB_FLOW_WORKER_CONCURRENCY || process.env.MAX_CONCURRENT_REQUESTS || '2',
                // Multi-account scheduling already spreads the first wave across
                // distinct sessions. A three-second GLOBAL gap made seven ready
                // accounts behave almost sequentially, so keep only a small
                // anti-burst stagger here and let AutoSub's adaptive cap protect
                // the single local bridge.
                REQUEST_MIN_INTERVAL: process.env.REQUEST_MIN_INTERVAL || '1.5',
                GLOBAL_REQUEST_MIN_INTERVAL: process.env.GLOBAL_REQUEST_MIN_INTERVAL || '0.35',
                API_REQUEST_TIMEOUT: process.env.API_REQUEST_TIMEOUT || '90',
                EXT_POLL_INTERVAL_MS: process.env.EXT_POLL_INTERVAL_MS || '250',
              },
            });
            const timer = setTimeout(() => resolve(), 500);
            child.once('spawn', () => { clearTimeout(timer); child.unref(); launched = true; resolve(); });
            child.once('error', (error) => { clearTimeout(timer); lastError = error.message; reject(error); });
          });
          if (launched) break;
        } catch { /* try next candidate */ }
      }
      if (!launched) throw new FlowSessionError(`Không tự khởi động được Flow Agent${lastError ? `: ${lastError}` : ''}. Hãy chạy lệnh “flow”.`, 'FLOW_AGENT_START_FAILED');
      flowReferenceUploads.clear();
      flowReferenceValidatedAt.clear();
      invalidateFlowClientPool();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await flowHealthReachable(1200)) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new FlowSessionError('Đã tự khởi động Flow Agent nhưng cổng 8001 vẫn chưa phản hồi.', 'FLOW_AGENT_START_TIMEOUT');
    })().finally(() => {
      if (flowAgentStartInFlight === start) flowAgentStartInFlight = undefined;
    });
    flowAgentStartInFlight = start;
  }
  await flowAgentStartInFlight;
}

const headers = (json = false) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(process.env.FLOW_AGENT_API_KEY?.trim() ? { Authorization: `Bearer ${process.env.FLOW_AGENT_API_KEY.trim()}` } : {}),
});

export class FlowSessionError extends Error {
  constructor(message: string, readonly code = 'FLOW_SESSION') { super(message); }
}

export async function flowImageModels() {
  const response = await fetch(`${baseUrl()}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(5000) });
  const result = await parseResponse<{ data?: Array<{ id: string }> }>(response);
  // Labels follow kodelyx/flow-agent README (206285a); send the API IDs unchanged.
  const names: Record<string, string> = { harbor_seal: 'Nano Banana 2 Lite', narwhal: 'Nano Banana 2', gem_pix_2: 'Nano Banana Pro' };
  return (result.data || []).filter((model) => typeof model.id === 'string' && model.id in names)
    .map(({ id }) => ({ id, label: names[id] }));
}

class FlowCreditError extends Error {}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    const detail = String(body?.detail || body?.error?.detail || body?.error?.message || text || response.statusText).slice(0, 500);
    if (/NO_FLOW_KEY/i.test(detail)) throw new FlowSessionError('Extension Flow Agent chưa có khóa phiên Google Flow (NO_FLOW_KEY), dù backend có thể vẫn báo đã kết nối. Mở Google Flow trong Opera GX, kiểm tra đăng nhập và tải lại tab sau khi bật extension Flow Agent. Không cần mua hay nhập API key.', 'NO_FLOW_KEY');
    if (/CAPTCHA_FAILED/i.test(detail) && /manifest must request permission|cannot access contents/i.test(detail)) {
      throw new FlowSessionError('Extension Flow Agent đang chạy bản chưa có quyền truy cập flow.google.com. Mở opera://extensions, bấm Tải lại tại Flow Agent rồi tải lại tab Google Flow; AutoSub chưa gửi lượt tạo video.', 'FLOW_EXTENSION_PERMISSION');
    }
    if (/CAPTCHA_FAILED/i.test(detail) && /grecaptcha not available/i.test(detail)) {
      throw new FlowSessionError('Trang Google Flow chưa tải được script xác minh (grecaptcha not available). Mở tab Google Flow, tải lại trang và kiểm tra tiện ích chặn script nếu lỗi vẫn còn.', 'FLOW_SCRIPT_NOT_READY');
    }
    if (/CAPTCHA_FAILED/i.test(detail)) throw new FlowSessionError(`Flow Agent chưa xác minh được phiên Google Flow: ${detail}`, 'CAPTCHA_FAILED');
    if (/FLOW_ACCOUNT_SESSION_UNVERIFIED/i.test(detail)) throw new FlowSessionError('Phiên tài khoản Google Flow chưa được xác minh. Mở tab Google Flow, hoàn tất xác minh rồi bấm tạo lại các ảnh lỗi.', 'FLOW_ACCOUNT_SESSION_UNVERIFIED');
    if (response.status === 402) throw new FlowCreditError(`Tài khoản Google Flow không đủ credit: ${detail}`);
    // The bridge can wrap an upstream OAuth rejection in HTTP 400.
    // An existing key does not mean Google still accepts it.
    if (/invalid authentication credentials|expected OAuth 2 access token/i.test(detail)) {
      throw new FlowSessionError('Google Flow từ chối token đăng nhập hiện tại. Mở đúng tài khoản Google Flow và đăng nhập lại nếu được yêu cầu.', 'NO_FLOW_KEY');
    }
    // The extension reports a browser-side network rejection as HTTP 400.
    // Health/credits may still be green because those use a different request.
    if (response.status === 400 && /^failed to fetch\.?$/i.test(detail.trim())) {
      throw new FlowSessionError('Tab Google Flow đã kết nối nhưng lượt gọi tới Google bị gián đoạn (Failed to fetch). Phiên trên tab hiện tại cần được làm mới trước khi thử lại.', 'FLOW_FETCH_FAILED');
    }
    if (response.status === 401 || response.status === 403) throw new Error(`Flow Agent từ chối xác thực (HTTP ${response.status}): ${detail}`);
    if (response.status === 429 && /credit|quota|not enough|insufficient/i.test(detail)) {
      throw new FlowCreditError(`Tài khoản Google Flow không đủ credit: ${detail}`);
    }
    if (response.status === 429) throw new Error(`Google Flow đang giới hạn request hoặc tài khoản không đủ credit: ${detail}`);
    throw new Error(`Flow Agent HTTP ${response.status}: ${detail}`);
  }
  return body as T;
}

export async function flowAgentStatus(signal?: AbortSignal) {
  const readStatus = async () => {
    const deadline = AbortSignal.timeout(5_000);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const [health, isolatedWorkers] = await Promise.all([
      fetch(`${baseUrl()}/health`, { signal: requestSignal, headers: headers() }).then((response) => parseResponse<FlowAgentHealth>(response)),
      listReadyIsolatedFlowWorkers().catch(() => []),
    ]);
    const linkedReady = (health.clients || []).some((client) => client.has_flow_key === true);
    const isolatedReady = isolatedWorkers.length > 0;
    const extensionConnected = Boolean(health.extension_connected) || (health.clients || []).length > 0 || isolatedReady;
    // The legacy primary client can legitimately have no token while seven
    // linked same-profile accounts are fully authenticated. Treat the linked
    // pool as the real session source instead of failing preflight because the
    // primary top-level has_flow_key flag is false.
    const hasFlowKey = Boolean(health.has_flow_key) || linkedReady || isolatedReady;
    const poolHealthy = health.status === 'healthy' || linkedReady || isolatedReady;
    return { installed: true, connected: poolHealthy && extensionConnected && hasFlowKey, extensionConnected, hasFlowKey, status: linkedReady || isolatedReady ? 'healthy' : (health.status || 'unknown'), transport: isolatedReady ? 'isolated' : (health.transport || 'none'), url: baseUrl() };
  };
  try {
    return await readStatus();
  } catch (error) {
    if (localFlowUrl() && localFlowNetworkFailure(error)) {
      try {
        await ensureGoogleFlowAgentRuntime();
        return await readStatus();
      } catch (restartError) {
        return { installed: false, connected: false, extensionConnected: false, hasFlowKey: false, status: 'offline', transport: 'none', url: baseUrl(), error: restartError instanceof Error ? restartError.message : String(restartError) };
      }
    }
    return { installed: false, connected: false, extensionConnected: false, hasFlowKey: false, status: 'offline', transport: 'none', url: baseUrl(), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validateGoogleFlowSession(_credentials?: unknown, signal?: AbortSignal) {
  let status = await flowAgentStatus(signal);
  if (!status.installed) {
    await ensureGoogleFlowAgentRuntime();
    status = await flowAgentStatus(signal);
  }
  if (!status.installed) throw new FlowSessionError(`Flow Agent chưa chạy tại ${status.url}. AutoSub đã thử tự khởi động nhưng bridge vẫn chưa phản hồi.`, 'FLOW_AGENT_OFFLINE');
  if (!status.extensionConnected) throw new FlowSessionError('Extension Flow Agent chưa kết nối. Hãy mở Google Flow trong Opera GX và giữ tab đăng nhập hoạt động.');
  if (!status.hasFlowKey) {
    await refreshFlowSessionOnce(signal);
    status = await flowAgentStatus(signal);
  }
  if (!status.hasFlowKey) throw new FlowSessionError('Flow Agent chưa lấy được token. Hãy mở Google Flow trong cửa sổ thường (không ẩn danh), đăng nhập đúng tài khoản rồi bấm Refresh Token; AutoSub không tự mở tab khi đang chạy voice.');
  if (!status.connected) throw new FlowSessionError(('error' in status && status.error) || `Flow Agent chưa sẵn sàng (${status.status}).`);
  return { ok: true as const };
}

async function refreshFlowSession(signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(30_000);
  signal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const probeSignal = () => AbortSignal.any([signal!, AbortSignal.timeout(5_000)]);
  const credits = await fetch(`${baseUrl()}/v1/credits`, { signal: probeSignal(), headers: headers() }).then((response) => response.ok ? response.json() : {}).catch(() => ({})) as { clients?: Array<{ client_id?: string; ok?: boolean }> };
  const clientIds = (credits.clients || []).map((client) => client.client_id).filter((id): id is string => Boolean(id));
  const targets: Array<string | undefined> = clientIds.length ? clientIds : [undefined];
  for (const clientId of targets) {
    const response = await fetch(`${baseUrl()}/v1/refresh-tokens`, {
      // Refresh reuses a normal Flow tab opened by the user; it must not turn
      // an unrelated voice task into an implicit browser-tab launch.
      method: 'POST', signal, headers: { ...headers(), 'X-Force-Refresh': '1', ...(clientId ? { 'X-Client-Id': clientId } : {}) },
    });
    if (!response.ok) throw new FlowSessionError(`Flow Agent không thể làm mới phiên (HTTP ${response.status}).`);
  }

  // /v1/refresh-tokens only confirms that the refresh command was queued.
  // Wait until the extension can actually reach Flow before retrying a request.
  for (let attempt = 0; attempt < 12 && !signal.aborted; attempt += 1) {
    const checked = await fetch(`${baseUrl()}/v1/credits`, { signal: probeSignal(), headers: headers() })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({})) as { clients?: Array<{ client_id?: string; ok?: boolean }> };
    const clients = checked.clients || [];
    const ready = clientIds.length
      ? clients.some((client) => client.ok === true && client.client_id && clientIds.includes(client.client_id))
      : clients.some((client) => client.ok === true);
    if (ready) return;
    if (attempt < 11 && !signal.aborted) await wait(1_500, signal).catch(() => undefined);
  }
  throw new FlowSessionError('Flow Agent đã thử làm mới nhưng extension vẫn chưa xác thực được với Google Flow. Mở opera://extensions, bấm Tải lại tại Flow Agent, sau đó tải lại tab flow.google.com. AutoSub chưa gửi lại lượt tạo.', 'FLOW_SESSION_REFRESH_FAILED');
}

function refreshFlowSessionOnce(signal?: AbortSignal) {
  if (!flowSessionRefreshInFlight) {
    const refresh = refreshFlowSession(signal).finally(() => {
      if (flowSessionRefreshInFlight === refresh) flowSessionRefreshInFlight = undefined;
    });
    flowSessionRefreshInFlight = refresh;
  }
  return flowSessionRefreshInFlight;
}

export async function refreshGoogleFlowSession(signal?: AbortSignal) {
  await refreshFlowSessionOnce(signal);
  flowReferenceUploads.clear();
  flowReferenceValidatedAt.clear();
  invalidateFlowClientPool();
  return flowAgentStatus(signal);
}

function localFlowNetworkFailure(error: unknown) {
  if (error instanceof FlowSessionError) return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  const cause = error instanceof Error ? (error as Error & { cause?: { code?: string; message?: string } }).cause : undefined;
  const detail = `${error instanceof Error ? error.message : String(error)} ${cause?.code || ''} ${cause?.message || ''}`;
  return /ECONNREFUSED|ECONNRESET|fetch failed|failed to fetch|socket hang up/i.test(detail);
}

async function refreshFlowClientSession(clientId: string, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const clientBase = await flowBaseUrlForClient(clientId);
  const response = await fetch(`${clientBase}/v1/refresh-tokens`, {
    method: 'POST',
    signal: requestSignal,
    headers: { ...headers(), 'X-Force-Refresh': '1', 'X-Client-Id': clientId },
  });
  if (!response.ok) throw new FlowSessionError(`Flow Agent không thể làm mới tài khoản ${clientId} (HTTP ${response.status}).`);
  for (let attempt = 0; attempt < 12 && !requestSignal.aborted; attempt += 1) {
    const checked = await fetch(`${clientBase}/v1/credits`, {
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(5_000)]),
      headers: { ...headers(), 'X-Client-Id': clientId },
    }).then(async (item) => ({
      ok: item.ok,
      body: item.ok ? await item.json() : {},
    })).catch(() => ({ ok: false, body: {} as any }));
    const body = checked.body as {
      clients?: Array<{ client_id?: string; ok?: boolean }>;
      _client_id?: string;
      session_id?: string;
      data?: unknown;
      status?: number;
    };
    const aggregateReady = (body.clients || []).some((client) => client.client_id === clientId && client.ok === true);
    const directReady = checked.ok
      && (body._client_id === clientId || body.session_id === clientId)
      && body.data !== undefined
      && Number(body.status ?? 200) < 400;
    if (aggregateReady || directReady) {
      invalidateFlowClientPool();
      return;
    }
    if (attempt < 11) await wait(1_500, requestSignal).catch(() => undefined);
  }
  throw new FlowSessionError(`Tài khoản Flow ${clientId} chưa sẵn sàng sau khi làm mới.`, 'FLOW_SESSION_REFRESH_FAILED');
}

async function requestWithSessionRecovery<T>(request: (attempt: number) => Promise<Response>, signal?: AbortSignal, recoverFetchFailure = false, clientId?: string) {
  try {
    return await parseResponse<T>(await request(0));
  } catch (error) {
    if (localFlowNetworkFailure(error)) {
      const isolatedBase = clientId ? await isolatedFlowWorkerBase(clientId) : undefined;
      if (clientId && isolatedBase) await ensureIsolatedFlowWorker(clientId);
      else await ensureGoogleFlowAgentRuntime();
      if (clientId) {
        await refreshFlowClientSession(clientId, signal).catch(() => undefined);
      } else {
        await validateGoogleFlowSession(undefined, signal);
      }
      // attempt=2 means transport recovery: reuse the original idempotency key.
      // If the first HTTP request reached Flow before the socket dropped, this
      // lets the local idempotency store replay that result instead of paying
      // for a duplicate image generation.
      for (let replay = 0; replay < 8; replay += 1) {
        try { return await parseResponse<T>(await request(2)); }
        catch (retryError) {
          if (!/already processing|processing; retry with the same key/i.test(retryError instanceof Error ? retryError.message : String(retryError)) || replay === 7) throw retryError;
          await wait(1_500, signal);
        }
      }
    }
    // Missing page scripts are not missing tokens: force_refresh invalidates
    // the current token but cannot repair a blocked/unloaded reCAPTCHA script.
    let shouldRefresh = error instanceof FlowSessionError
      && (error.code === 'NO_FLOW_KEY' || (recoverFetchFailure && error.code === 'FLOW_FETCH_FAILED'));
    if (error instanceof FlowCreditError) {
      // Older Flow Agent builds converted an unauthenticated credit probe into
      // HTTP 402 with a fake zero balance. Only trust 402 when at least one
      // connected browser actually returned a valid credit response.
      const probeBase = clientId ? await flowBaseUrlForClient(clientId) : baseUrl();
      const probe = await fetch(`${probeBase}/v1/credits`, { signal, headers: headers() })
        .then((response) => response.ok ? response.json() : {})
        .catch(() => ({})) as { clients?: Array<{ ok?: boolean }> };
      const clients = probe.clients || [];
      if (clients.length && !clients.some((client) => client.ok === true)) shouldRefresh = true;
    }
    if (!shouldRefresh) throw error;
    if (clientId) await refreshFlowClientSession(clientId, signal);
    else await refreshFlowSessionOnce(signal);
    // Flow Agent persists failed idempotent requests. Retrying with the old key
    // would only replay the stored failure and never reach Google again.
    return parseResponse<T>(await request(1));
  }
}

type FlowImageOptions = {
  model?: string;
  size?: string;
  referenceImagePath?: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
  _creditRotationAttempt?: number;
};

const FLOW_MULTI_PROMPT_PREFIX = '__AUTOSUB_MULTI_PROMPT_V1__:';
function encodeFlowImagePrompts(prompts: string[]) {
  const cleaned = prompts.map((prompt) => String(prompt || '').trim().slice(0, 4000));
  if (cleaned.some((prompt) => !prompt)) throw new Error('Prompt ảnh không được để trống.');
  if (cleaned.length <= 1) return cleaned[0] || '';
  return `${FLOW_MULTI_PROMPT_PREFIX}${Buffer.from(JSON.stringify(cleaned), 'utf8').toString('base64')}`;
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function scopeLinkedReferenceBytes(bytes: Buffer, mimeType: string, clientId: string) {
  // Flow Agent 2.0.7 caches uploaded references globally by SHA-256, while
  // Google media IDs are account/session scoped. The same reference bytes sent
  // through several X-Client-Id workers therefore collide in history.json and
  // get revalidated against the wrong Google account. Add harmless container
  // metadata that is stable per client so each account owns its own cache key
  // without changing any visible pixel.
  const marker = Buffer.from(`AutoSubClient\0${clientId}`, 'utf8');

  if (mimeType === 'image/png' && bytes.length > 20 && bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const next = offset + 12 + length;
      if (next > bytes.length) break;
      if (bytes.subarray(offset + 4, offset + 8).toString('ascii') === 'IEND') {
        const type = Buffer.from('tEXt');
        const chunk = Buffer.alloc(12 + marker.length);
        chunk.writeUInt32BE(marker.length, 0);
        type.copy(chunk, 4);
        marker.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(Buffer.concat([type, marker])), 8 + marker.length);
        return Buffer.concat([bytes.subarray(0, offset), chunk, bytes.subarray(offset)]);
      }
      offset = next;
    }
  }

  if (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const text = Buffer.from(`AutoSubClient:${clientId}`, 'utf8');
    const segment = Buffer.alloc(4 + text.length);
    segment[0] = 0xff; segment[1] = 0xfe;
    segment.writeUInt16BE(text.length + 2, 2);
    text.copy(segment, 4);
    return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
  }

  if (mimeType === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    const padded = marker.length % 2 ? Buffer.concat([marker, Buffer.from([0])]) : marker;
    const chunk = Buffer.alloc(8 + padded.length);
    chunk.write('ASUB', 0, 'ascii');
    chunk.writeUInt32LE(marker.length, 4);
    padded.copy(chunk, 8);
    const scoped = Buffer.concat([bytes, chunk]);
    scoped.writeUInt32LE(scoped.length - 8, 4);
    return scoped;
  }

  return bytes;
}

let recentGenerationSessionCheckAt = 0;
let generationSessionCheck: Promise<unknown> | undefined;
async function ensureGenerationFlowSession(signal?: AbortSignal) {
  if (flowIsolatedReadyCount > 0) return;
  // During long storyboard jobs the browser bridge may be busy serving image
  // requests; re-probing /health every few seconds adds load and can create
  // false failures. Actual generation calls already recover expired sessions.
  if (Date.now() - recentGenerationSessionCheckAt < 60_000) return;
  if (!generationSessionCheck) generationSessionCheck = validateGoogleFlowSession(undefined, signal)
    .then((result) => { recentGenerationSessionCheckAt = Date.now(); return result; })
    .finally(() => { generationSessionCheck = undefined; });
  await generationSessionCheck;
}

export async function generateGoogleFlowImages(prompt: string | string[], outputFiles: string[], options: FlowImageOptions = {}) {
  if (!outputFiles.length || outputFiles.length > 4) throw new Error('Flow Agent chỉ hỗ trợ batch từ 1 đến 4 ảnh.');
  const prompts = Array.isArray(prompt) ? prompt : Array(outputFiles.length).fill(prompt);
  if (prompts.length !== outputFiles.length) throw new Error(`Số prompt (${prompts.length}) phải bằng số ảnh cần tạo (${outputFiles.length}).`);
  const flowPrompt = encodeFlowImagePrompts(prompts);
  // Waiting in AutoSub's local queue must not consume the provider timeout.
  // Start the watchdog only after this request owns the single Flow slot.
  const slot = await acquireFlowImageSlot(options.signal);
  // The extension's browser-side fetch is bounded well below this. Keeping
  // AutoSub's outer watchdog at two minutes prevents seven stalled requests
  // from pinning the entire local bridge for 4.5 minutes at a time.
  const deadline = AbortSignal.timeout(120_000);
  const requestSignal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const requestBase = await flowBaseUrlForClient(slot.clientId);
  let slotReleased = false;
  try {
    await ensureGenerationFlowSession(requestSignal);
    // Upload the recurring reference once per linked account, then reuse that
    // account-scoped media ID for every storyboard beat. This avoids sending a
    // 1-2 MB base64 image through Flow Agent for every generation while still
    // keeping media IDs isolated between Google sessions.
    let referenceMediaId = options.referenceImagePath
      ? await uploadReference(options.referenceImagePath, requestSignal, slot.clientId)
      : undefined;
    const buildBody = () => JSON.stringify({
      prompt: flowPrompt,
      model: options.model || 'narwhal',
      n: outputFiles.length,
      size: options.size || '1024x1024',
      // Fast path implemented in our Flow Agent runtime: return Google's
      // signed media URL immediately and let AutoSub download the bytes itself.
      // This keeps large image downloads/base64 payloads off the single FastAPI
      // event loop, which is the main bottleneck when several accounts finish
      // at nearly the same time.
      response_format: 'remote_url',
      ...(referenceMediaId ? { ref_media_ids: [referenceMediaId] } : {}),
    });
    // A caller may keep the same key across a transport timeout and replay the
    // original paid request. A fresh key remains the default for a new, explicit
    // generation so clicking "Tạo lại" still creates a new take.
    const idempotencyKey = options.idempotencyKey?.trim()
      || `autosub-image-${createHash('sha256').update(`${outputFiles.join('|')}\n${JSON.stringify(prompts)}\n${randomUUID()}`).digest('hex').slice(0, 32)}`;
    const submit = async (baseKey: string) => {
      const retryIdempotencyKey = `${baseKey}-retry-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      return requestWithSessionRecovery<{ data?: Array<{ b64_json?: string; url?: string; media_id?: string }> }>((attempt) => fetch(`${requestBase}/v1/images/generations`, {
        method: 'POST', signal: requestSignal,
        // attempt=1 is an authenticated-session refresh and needs a fresh key
        // because Flow Agent persists the original auth failure. attempt=2 is a
        // local transport recovery and MUST reuse the original key so a request
        // that already reached Flow is replayed rather than duplicated.
        headers: {
          ...headers(true),
          ...(slot.clientId ? { 'X-Client-Id': slot.clientId } : {}),
          'Idempotency-Key': attempt === 1 ? retryIdempotencyKey : baseKey,
        }, body: buildBody(),
      }), requestSignal, true, slot.clientId);
    };
    try {
      let result;
      try {
        result = await submit(idempotencyKey);
      } catch (error) {
        if (!options.referenceImagePath || !staleFlowReferenceError(error)) throw error;
        // Media IDs are scoped to the targeted Google account and can become
        // stale after a tab/session reset. Repair only this account's cached ID,
        // upload the reference once again for that worker, then retry the same
        // storyboard image without poisoning the rest of the pool.
        await invalidateReferenceUpload(options.referenceImagePath, slot.clientId);
        referenceMediaId = await uploadReference(options.referenceImagePath, requestSignal, slot.clientId);
        result = await submit(`${idempotencyKey}-refrepair-${randomUUID().replace(/-/g, '').slice(0, 10)}`);
      }
    if (!result.data || result.data.length < outputFiles.length) throw new Error(`Flow Agent chỉ trả về ${result.data?.length || 0}/${outputFiles.length} ảnh.`);
    const results = await Promise.all(outputFiles.map(async (outputFile, index) => {
      const item = result.data?.[index];
      if (!item) throw new Error(`Flow Agent không trả về dữ liệu ảnh thứ ${index + 1}.`);
      let bytes: Buffer;
      if (item.url) {
        const response = await fetch(item.url, { signal: AbortSignal.any([requestSignal, AbortSignal.timeout(60_000)]) });
        if (!response.ok) throw new Error(`Không tải được ảnh Flow thứ ${index + 1}: HTTP ${response.status}.`);
        bytes = Buffer.from(await response.arrayBuffer());
      } else if (item.b64_json) {
        // Backward compatibility with an older Flow Agent runtime.
        bytes = Buffer.from(item.b64_json, 'base64');
      } else {
        throw new Error(`Flow Agent không trả về URL hoặc dữ liệu ảnh thứ ${index + 1}.`);
      }
      if (bytes.length < 100) throw new Error(`Flow Agent trả về ảnh thứ ${index + 1} không hợp lệ.`);
      return { outputFile, bytes };
    }));
    await Promise.all(results.map(({ outputFile, bytes }) => writeFile(outputFile, bytes)));
    if (flowIsolatedReadyCount === 0) noteFlowImageSuccess();
    return results.map(({ bytes }) => ({ model: options.model || 'narwhal', bytes: bytes.length }));
  } catch (error) {
    if (error instanceof FlowCreditError) {
      if (slot.clientId) {
        flowImageCreditsByClient.set(slot.clientId, { credits: 0, at: Date.now() });
        cooldownFlowImageClient(slot.clientId, FLOW_IMAGE_CREDIT_COOLDOWN_MS);
        const rotationAttempt = options._creditRotationAttempt || 0;
        const knownClientCount = flowClientCache.ids.filter(Boolean).length;
        // A 402 means this request was not charged. Release the current lane
        // and transparently retry the same image on the next ranked account.
        // Keep the retry bounded so an all-exhausted pool returns a clear error.
        if (rotationAttempt < Math.max(0, (knownClientCount || 1) - 1)) {
          releaseFlowImageSlot(slot);
          slotReleased = true;
          return generateGoogleFlowImages(prompt, outputFiles, {
            ...options,
            idempotencyKey: undefined,
            _creditRotationAttempt: rotationAttempt + 1,
          });
        }
      }
    }
    if (deadline.aborted && !options.signal?.aborted) {
      cooldownFlowImageClient(slot.clientId, FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS);
      if (flowIsolatedReadyCount === 0) noteFlowImagePressure(slot.clientId ? `timeout ${slot.clientId}` : 'timeout', true);
      throw new Error(`Flow Agent không phản hồi lượt tạo ảnh trong 2 phút${slot.clientId ? ` trên ${slot.clientId}` : ''}. ${flowIsolatedReadyCount > 0 ? 'AutoSub chỉ tạm loại worker này; các worker khác vẫn tiếp tục.' : 'AutoSub đã giảm tải toàn pool và tạm loại worker này.'}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    const transient = /failed to fetch|FLOW_FETCH_FAILED|CAPTCHA_TIMEOUT|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|socket|network|cổng 8001|Flow Agent HTTP 5\d\d/i.test(detail);
    const sessionScopedFailure = error instanceof FlowSessionError && [
      'CAPTCHA_FAILED',
      'FLOW_EXTENSION_PERMISSION',
      'FLOW_SCRIPT_NOT_READY',
      'FLOW_ACCOUNT_SESSION_UNVERIFIED',
      'NO_FLOW_KEY',
      'FLOW_FETCH_FAILED',
      'FLOW_SESSION_REFRESH_FAILED',
    ].includes(error.code);
    if (slot.clientId && (transient || sessionScopedFailure)) {
      cooldownFlowImageClient(slot.clientId, sessionScopedFailure ? 90_000 : FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS);
    }
    if (transient && flowIsolatedReadyCount === 0) noteFlowImagePressure(detail.slice(0, 120), /cổng 8001|ECONNREFUSED|ECONNRESET|timeout/i.test(detail));
    if (slot.clientId) {
      if (error instanceof FlowSessionError) throw new FlowSessionError(`${error.message} [worker ${slot.clientId}]`, error.code);
      if (error instanceof Error) throw new Error(`${error.message} [worker ${slot.clientId}]`);
    }
    throw error;
  }
  } finally {
    if (!slotReleased) releaseFlowImageSlot(slot);
  }
}

export async function generateGoogleFlowImage(prompt: string, outputFile: string, options: FlowImageOptions = {}) {
  return (await generateGoogleFlowImages(prompt, [outputFile], options))[0];
}

function staleFlowReferenceError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /media not found in history\.json|upload or generate it again|media_id=.*not found/i.test(detail);
}

async function flowHistoryContainsMediaId(mediaId: string, signal?: AbortSignal) {
  try {
    const timeout = AbortSignal.timeout(4_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${baseUrl()}/v1/history`, { signal: requestSignal, headers: headers() });
    if (!response.ok) return true; // Validation is advisory; don't break generation on a probe failure.
    const body = await response.json() as { history?: Array<{ media_id?: string }> };
    return (body.history || []).some((entry) => entry.media_id === mediaId);
  } catch {
    return true;
  }
}

async function referenceDigest(filePath: string) {
  const bytes = await readFile(filePath);
  return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
}

async function referenceCacheKey(filePath: string, clientId?: string) {
  const { bytes, digest } = await referenceDigest(filePath);
  return { bytes, digest, key: `${clientId || 'default'}:${digest}` };
}

async function invalidateReferenceUpload(filePath: string, clientId?: string) {
  const { key } = await referenceCacheKey(filePath, clientId);
  flowReferenceUploads.delete(key);
  flowReferenceValidatedAt.delete(key);
}

async function uploadReference(filePath: string, signal?: AbortSignal, clientId?: string) {
  const { bytes, key } = await referenceCacheKey(filePath, clientId);
  const cached = flowReferenceUploads.get(key);
  if (cached) {
    const mediaId = await cached;
    // Targeted linked-account IDs are account-scoped and cannot be validated
    // safely through Flow Agent's global history. Trust the in-process cache and
    // repair it lazily if generation reports a stale media ID.
    if (clientId) return mediaId;
    const lastValidatedAt = flowReferenceValidatedAt.get(key) || 0;
    if (Date.now() - lastValidatedAt < 30_000 || await flowHistoryContainsMediaId(mediaId, signal)) {
      flowReferenceValidatedAt.set(key, Date.now());
      return mediaId;
    }
    flowReferenceUploads.delete(key);
    flowReferenceValidatedAt.delete(key);
  }
  const upload = (async () => {
    // Reference media is account-scoped. Upload different accounts in parallel:
    // each linked tab has its own command queue, so serializing these one-time
    // uploads only multiplies the cold-start penalty without protecting Google.
    const timeout = AbortSignal.timeout(FLOW_REFERENCE_UPLOAD_TIMEOUT_MS);
    const uploadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const uploadBase = await flowBaseUrlForClient(clientId);
    const body = JSON.stringify({ image_base64: bytes.toString('base64') });
    const uploaded = await requestWithSessionRecovery<{ media_id?: string }>(() => fetch(`${uploadBase}/v1/upload`, {
      method: 'POST', signal: uploadSignal,
      headers: { ...headers(true), ...(clientId ? { 'X-Client-Id': clientId } : {}) },
      body,
    }), uploadSignal, true, clientId);
    if (!uploaded.media_id) throw new Error('Flow Agent không trả về media_id cho ảnh tham chiếu.');
    flowReferenceValidatedAt.set(key, Date.now());
    return uploaded.media_id;
  })().catch((error) => {
    flowReferenceUploads.delete(key);
    flowReferenceValidatedAt.delete(key);
    throw error;
  });
  flowReferenceUploads.set(key, upload);
  return upload;
}

export async function prewarmGoogleFlowImageReference(referenceImagePath: string, requestedClients = FLOW_REFERENCE_PREWARM_MAX, signal?: AbortSignal) {
  const discovered = await healthyFlowImageClients(signal);
  if (flowIsolatedReadyCount === 0) await validateGoogleFlowSession(undefined, signal);
  const clients = discovered.filter(Boolean).slice(0, Math.max(1, Math.min(FLOW_REFERENCE_PREWARM_MAX, requestedClients)));
  if (!clients.length) throw new FlowSessionError('Không có tài khoản Flow nào sẵn sàng để đồng bộ ảnh tham chiếu.', 'NO_FLOW_KEY');
  const startedAt = Date.now();
  const settled = await Promise.allSettled(clients.map(async (clientId) => {
    const mediaId = await uploadReference(referenceImagePath, signal, clientId);
    flowImageCooldownUntilByClient.delete(clientId);
    return { clientId, mediaId };
  }));
  const ready: Array<{ clientId: string; mediaId: string }> = [];
  const failed: Array<{ clientId: string; error: string }> = [];
  settled.forEach((result, index) => {
    const clientId = clients[index];
    if (result.status === 'fulfilled') ready.push(result.value);
    else {
      cooldownFlowImageClient(clientId, FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS);
      failed.push({ clientId, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
  });
  if (!ready.length) throw new Error(`Không đồng bộ được ảnh tham chiếu lên ${clients.length} tài khoản Flow: ${failed[0]?.error || 'không rõ lỗi'}`);
  return { attempted: clients.length, ready, failed, elapsedMs: Date.now() - startedAt };
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Đã dừng tác vụ.', 'AbortError')); }, { once: true });
});

export async function generateGoogleFlowVideo(prompt: string, outputFile: string, model: FlowVideoModel = 'Flow Agent Auto', _credentials?: unknown, references: FlowVideoReferences = {}, aspectRatio: FlowVideoAspectRatio = '9:16', signal?: AbortSignal, _browserRequired = false) {
  const startImagePath = references.startImagePath?.trim();
  const referenceImagePaths = (references.referenceImagePaths || []).filter(Boolean);
  if (startImagePath && referenceImagePaths.length) {
    throw new Error('Flow Agent không hỗ trợ đồng thời khung bắt đầu và ảnh reference trong cùng một lượt tạo.');
  }
  await validateGoogleFlowSession(undefined, signal);
  const startMediaId = startImagePath ? await uploadReference(startImagePath, signal) : undefined;
  const referenceMediaIds: string[] = [];
  for (const reference of referenceImagePaths) referenceMediaIds.push(await uploadReference(reference, signal));
  const requestedDuration = Number(/Duration:\s*(\d+(?:\.\d+)?)\s*seconds/i.exec(prompt)?.[1] || 8);
  const duration = requestedDuration <= 4 ? 4 : requestedDuration <= 6 ? 6 : 8;
  // A key belongs to one user-initiated attempt. Reusing a deterministic key
  // here would permanently replay a stored failure when the user resumes.
  const body = JSON.stringify({ prompt, aspect: aspectRatio === '16:9' ? 'landscape' : 'portrait', duration, n: 1, ...(startMediaId ? { start_media_id: startMediaId } : {}), ...(referenceMediaIds.length ? { ref_media_ids: referenceMediaIds } : {}) });
  const idempotencyKey = `autosub-${createHash('sha256').update(`${outputFile}\n${prompt}\n${randomUUID()}`).digest('hex').slice(0, 32)}`;
  const retryIdempotencyKey = `${idempotencyKey}-retry-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let result = await requestWithSessionRecovery<FlowAgentVideoResult>((attempt) => fetch(`${baseUrl()}/v1/videos/generations`, {
    method: 'POST', signal, headers: { ...headers(true), 'Idempotency-Key': attempt ? retryIdempotencyKey : idempotencyKey }, body,
  }), signal);
  for (let attempt = 0; result.status === 'processing' && attempt < 180; attempt += 1) {
    await wait(3_000, signal);
    const polled = await fetch(`${baseUrl()}/v1/videos/generations/${encodeURIComponent(result.job_id)}`, { signal, headers: headers() });
    result = await parseResponse<FlowAgentVideoResult>(polled);
  }
  if (result.status === 'failed') throw new Error(`Flow Agent tạo video thất bại: ${result.error?.detail || 'không có chi tiết'}`);
  if (result.status !== 'succeeded') throw new Error('Flow Agent quá thời gian tạo video.');
  const media = result.data?.[0];
  if (!media?.url) throw new Error('Flow Agent hoàn tất nhưng không trả về URL video.');
  const downloaded = await fetch(new URL(media.url, `${baseUrl()}/`), { signal, headers: headers() });
  if (!downloaded.ok) throw new Error(`Không tải được video từ Flow Agent (HTTP ${downloaded.status}).`);
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  if (bytes.length < 10_000 || !bytes.subarray(0, 64).includes(Buffer.from('ftyp'))) throw new Error('Flow Agent trả về file không phải video MP4 hợp lệ.');
  await writeFile(outputFile, bytes);
  return { model, taskId: result.job_id, mediaId: media.media_id, note: result.note };
}

export const generateGoogleFlowPreview = (prompt: string, outputFile: string) => generateGoogleFlowVideo(prompt, outputFile);
