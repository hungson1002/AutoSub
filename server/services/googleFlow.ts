import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { ensureIsolatedFlowWorker, isolatedFlowWorkerBase, listReadyIsolatedFlowWorkers, listRegisteredIsolatedFlowWorkerIds, readFlowWorkerIdempotencyRecord } from './flowWorkerSupervisor';
import { ensureFlowAgentRuntimePatched } from './flowAgentRuntimePatch';

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
const FLOW_REFERENCE_PREWARM_MAX = Math.max(1, Math.min(16, Number(process.env.AUTOSUB_FLOW_REFERENCE_PREWARM_MAX) || 12));
const FLOW_REFERENCE_PREWARM_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.AUTOSUB_FLOW_REFERENCE_PREWARM_CONCURRENCY) || 3));

// Flow's current browser RPC uses single-use CAPTCHA tokens and has shown
// unusual-activity responses when linked tabs submit bursts. Keep one image
// request active across the whole browser pool; account failover still chooses
// the next healthy worker after a confirmed, non-dispatched failure.
type FlowImageSlot = { clientId?: string; clientCount: number; startedAt: number };
type FlowCreditClient = { client_id?: string; ok?: boolean };
function flowImageDelayFromEnv(name: string, fallbackMs: number, maxMs = 30_000) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallbackMs;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(maxMs, value)) : fallbackMs;
}
const FLOW_IMAGE_SLOTS_PER_CLIENT = Math.max(1, Math.min(2, Number(process.env.AUTOSUB_FLOW_IMAGE_SLOTS_PER_ACCOUNT) || 1));
const FLOW_IMAGE_START_GAP_MS = flowImageDelayFromEnv('AUTOSUB_FLOW_IMAGE_START_GAP_MS', 3000);
const FLOW_IMAGE_GLOBAL_START_GAP_MS = flowImageDelayFromEnv('AUTOSUB_FLOW_IMAGE_GLOBAL_START_GAP_MS', 3000);
const FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = Math.max(FLOW_IMAGE_GLOBAL_START_GAP_MS, flowImageDelayFromEnv('AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS', 3000));
const FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS = Math.max(
  FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS,
  flowImageDelayFromEnv('AUTOSUB_FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS', 1500, 10_000),
);
let flowImageLastGlobalStartedAt = 0;
let flowImageRecoveringFromTraffic = false;
let flowImageTrafficRecoverySuccesses = 0;
let flowImageTrafficRounds = 0;
const FLOW_CLIENT_CACHE_MS = Math.max(250, Math.min(30_000, Number(process.env.AUTOSUB_FLOW_CLIENT_CACHE_MS) || 750));
const FLOW_CLIENT_STALE_CACHE_MS = Math.max(30_000, Math.min(600_000, Number(process.env.AUTOSUB_FLOW_CLIENT_STALE_CACHE_MS) || 300_000));
const FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS = Math.max(15_000, Math.min(300_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS) || 45_000));
const FLOW_IMAGE_SESSION_FAILURE_COOLDOWN_MS = Math.max(60_000, Math.min(1_800_000, Number(process.env.AUTOSUB_FLOW_IMAGE_SESSION_FAILURE_COOLDOWN_MS) || 60_000));
const FLOW_IMAGE_UNCERTAIN_REPLAY_LIMIT = Math.max(0, Math.min(4, Number(process.env.AUTOSUB_FLOW_IMAGE_UNCERTAIN_REPLAY_LIMIT ?? 2)));
const FLOW_IMAGE_UNCERTAIN_REPLAY_DELAY_MS = Math.max(0, Math.min(15_000, Number(process.env.AUTOSUB_FLOW_IMAGE_UNCERTAIN_REPLAY_DELAY_MS ?? 1_500)));
const FLOW_IMAGE_UNCERTAIN_REPLAY_TIMEOUT_MS = Math.max(60_000, Math.min(600_000, Number(process.env.AUTOSUB_FLOW_IMAGE_UNCERTAIN_REPLAY_TIMEOUT_MS) || 300_000));
// Recovery ladder: Flow Agent stops waiting first (300s), while the browser
// extension keeps the actual Google fetch alive for 600s. That deliberate
// overlap lets a slow generation arrive as a late callback and reconcile the
// same idempotency key instead of leaving a poisoned "processing" record.
// AutoSub itself waits longer (720s) so reconciliation can finish in-place.
const FLOW_IMAGE_REQUEST_TIMEOUT_MS = Math.max(180_000, Math.min(900_000, Number(process.env.AUTOSUB_FLOW_IMAGE_REQUEST_TIMEOUT_MS) || 720_000));
const FLOW_IMAGE_RECONCILIATION_STALE_MS = Math.max(
  360_000,
  Math.min(900_000, Number(process.env.AUTOSUB_FLOW_IMAGE_RECONCILIATION_STALE_MS) || 660_000),
);
const FLOW_IMAGE_STALE_HANDOFF_LIMIT = Math.max(1, Math.min(16, Number(process.env.AUTOSUB_FLOW_IMAGE_STALE_HANDOFF_LIMIT) || 8));
// Flow Agent may return 409 while the original generation is still running.
// Keep polling for the full caller timeout instead of abandoning it after the
// old fixed 24 attempts (~220s), which was shorter than a valid slow request.
// Bound repeated 409 checks to roughly five minutes even if a caller raises
// its request timeout. The same durable key/checkpoint remains available for a
// later resume, so this stops a visible job from polling for twelve minutes.
const FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT = Math.max(24, Math.min(32, Math.ceil(FLOW_IMAGE_REQUEST_TIMEOUT_MS / 10_000) + 2));
const FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS = Math.max(1, Math.min(10_000, Number(process.env.AUTOSUB_FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS) || 2_000));
const FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS = Math.max(5_000, Math.min(120_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS) || 20_000));
const FLOW_IMAGE_CLIENT_UNUSUAL_ACTIVITY_COOLDOWN_MS = 120_000;
const FLOW_IMAGE_CLIENT_TRAFFIC_COOLDOWN_MS = Math.max(
  15_000,
  Math.min(180_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CLIENT_TRAFFIC_COOLDOWN_MS) || 45_000),
);
const FLOW_IMAGE_FAILOVER_SLOT_WAIT_MS = Math.max(30_000, Math.min(300_000, Number(process.env.AUTOSUB_FLOW_IMAGE_FAILOVER_SLOT_WAIT_MS) || 180_000));
const FLOW_IMAGE_CREDIT_CACHE_MS = Math.max(2_000, Math.min(60_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CREDIT_CACHE_MS) || 10_000));
const FLOW_WORKER_REGISTRY_REFRESH_MS = Math.max(1_000, Math.min(30_000, Number(process.env.AUTOSUB_FLOW_WORKER_REGISTRY_REFRESH_MS) || 5_000));
const FLOW_IMAGE_CREDIT_COOLDOWN_MS = Math.max(30_000, Math.min(3_600_000, Number(process.env.AUTOSUB_FLOW_IMAGE_CREDIT_COOLDOWN_MS) || 300_000));
// Circuit breaker à la flow2api consecutive_error_count: a worker whose page
// session keeps getting refused upstream parks itself so healthy workers serve
// the queue instead of burning every image on the same dead tab.
const FLOW_IMAGE_UPSTREAM_400_LIMIT = Math.max(2, Math.min(10, Number(process.env.AUTOSUB_FLOW_IMAGE_UPSTREAM_400_LIMIT) || 3));
const FLOW_IMAGE_UPSTREAM_400_COOLDOWN_MS = Math.max(60_000, Math.min(1_800_000, Number(process.env.AUTOSUB_FLOW_IMAGE_UPSTREAM_400_COOLDOWN_MS) || 600_000));
const flowImageUpstream400StreakByClient = new Map<string, number>();
// All linked workers share one browser profile and CAPTCHA reputation, so the
// scheduler allows one active generation and spaces starts across accounts.
const FLOW_IMAGE_GLOBAL_CAP_MIN = 1;
const FLOW_IMAGE_GLOBAL_CAP_MAX = 1;
const FLOW_IMAGE_GLOBAL_CAP_INITIAL = 1;
// Keep legacy pool-sizing helpers bounded by the same one-slot ceiling.
// Optional env values remain accepted for compatibility but cannot raise it.
const FLOW_IMAGE_ISOLATED_CAP_MIN = 1;
const FLOW_IMAGE_ISOLATED_CAP_INITIAL_OVERRIDE = Math.max(0, Number(process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_CAP_INITIAL) || 0);
const FLOW_IMAGE_ISOLATED_CAP_MAX_OVERRIDE = Math.max(0, Number(process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_CAP_MAX) || 0);
// This is a browser-profile-wide cap. Multiple isolated Flow Agent processes
// still share the same Opera session and CAPTCHA reputation.
// Profile-wide ceiling for concurrent generations. Default 1 (serial) while
// account health is being restored. Raise via env to re-enable parallel
// lanes once tabs are healthy; traffic pause + per-worker circuit breaker
// remain the safety nets. Needs a backend restart to take effect.
// Example: AUTOSUB_FLOW_IMAGE_PROFILE_SAFE_CAP=4 AUTOSUB_FLOW_IMAGE_SLOTS_PER_ACCOUNT=1
const FLOW_IMAGE_PROFILE_SAFE_CAP = Math.max(1, Math.min(18, Number(process.env.AUTOSUB_FLOW_IMAGE_PROFILE_SAFE_CAP) || 1));
const FLOW_IMAGE_TRAFFIC_COOLDOWN_MS = Math.max(60_000, Math.min(600_000, Number(process.env.AUTOSUB_FLOW_IMAGE_TRAFFIC_COOLDOWN_MS) || 180_000));
const flowImageActiveByClient = new Map<string, number>();
// Reserve a new durable key at slot acquisition, before the worker writes its
// record. Concurrent callers of that key must choose the same account.
const flowImageAssetOwners = new Map<string, string>();
const flowImageLastStartedByClient = new Map<string, number>();
const flowImageCooldownUntilByClient = new Map<string, number>();
const flowImageSessionUnavailableUntilByClient = new Map<string, number>();
const flowImageWaiters: Array<() => void> = [];
let flowImageGlobalActive = 0;
let flowImagePeakActive = 0;
let flowImageTelemetryStartedAt = Date.now();
let flowImageTelemetryLastAt = flowImageTelemetryStartedAt;
let flowImageTelemetryActiveSlotMs = 0;
let flowImageTelemetryCapacitySlotMs = 0;
let flowImageTelemetrySaturatedMs = 0;
let flowImageAdaptiveCap = FLOW_IMAGE_GLOBAL_CAP_INITIAL;
let flowImageIsolatedAdaptiveCap = 0;
let flowImageIsolatedMaxCap = 0;
let flowImageTrafficThrottleUntil = 0;
let flowImagePoolPauseCode: string | undefined;
let flowImagePoolPauseMessage: string | undefined;
let flowImageSuccessStreak = 0;
let flowImagePressureUntil = 0;
let flowImageLastPressureAt = 0;
let flowIsolatedReadyCount = 0;
let flowClientCache: { at: number; ids: string[] } = { at: 0, ids: [] };
let flowClientRefresh: Promise<string[]> | undefined;
let flowWorkerRegistryCheckedAt = 0;
let flowWorkerRegistryRefresh: Promise<void> | undefined;
const flowImageCreditsByClient = new Map<string, { credits: number; at: number }>();
const flowImageCreditReads = new Map<string, Promise<number | undefined>>();

function isDisconnectedFlowState(state?: string) {
  return /unauthorized|disconnected|offline|failed/i.test(String(state || ''));
}

function flowExtensionConnected(health: FlowAgentHealth) {
  if (typeof health.extension_connected === 'boolean') return health.extension_connected;
  if (isDisconnectedFlowState(health.status)) return false;
  return health.status === 'healthy'
    || (health.clients || []).some((client) => !isDisconnectedFlowState(client.state));
}

function flowClientHasUsableSession(client: NonNullable<FlowAgentHealth['clients']>[number]) {
  return client.has_flow_key === true && !isDisconnectedFlowState(client.state);
}

function isolatedOneLaneCap(readyCount = flowIsolatedReadyCount) {
  return Math.max(FLOW_IMAGE_ISOLATED_CAP_MIN, readyCount);
}

function isolatedTwoLaneCap(readyCount = flowIsolatedReadyCount) {
  return Math.max(isolatedOneLaneCap(readyCount), readyCount * FLOW_IMAGE_SLOTS_PER_CLIENT);
}

function isolatedInitialCap(readyCount = flowIsolatedReadyCount) {
  const oneLane = isolatedOneLaneCap(readyCount);
  const maximum = isolatedTwoLaneCap(readyCount);
  if (FLOW_IMAGE_ISOLATED_CAP_INITIAL_OVERRIDE > 0) {
    return Math.max(FLOW_IMAGE_ISOLATED_CAP_MIN, Math.min(maximum, FLOW_IMAGE_PROFILE_SAFE_CAP, FLOW_IMAGE_ISOLATED_CAP_INITIAL_OVERRIDE));
  }
  return Math.max(FLOW_IMAGE_ISOLATED_CAP_MIN, Math.min(oneLane, FLOW_IMAGE_PROFILE_SAFE_CAP));
}

function isolatedMaxCap(readyCount = flowIsolatedReadyCount) {
  const natural = isolatedTwoLaneCap(readyCount);
  if (FLOW_IMAGE_ISOLATED_CAP_MAX_OVERRIDE > 0) {
    return Math.max(isolatedInitialCap(readyCount), Math.min(natural, FLOW_IMAGE_PROFILE_SAFE_CAP, FLOW_IMAGE_ISOLATED_CAP_MAX_OVERRIDE));
  }
  return Math.max(isolatedInitialCap(readyCount), Math.min(natural, FLOW_IMAGE_PROFILE_SAFE_CAP));
}

export function nextStableIsolatedImageCap(currentCap: number, maxCap: number, readyCount: number) {
  const oneLaneCap = isolatedOneLaneCap(readyCount);
  if (currentCap < oneLaneCap) return Math.min(maxCap, oneLaneCap);
  return Math.min(maxCap, currentCap + Math.max(1, readyCount));
}

function rememberReadyIsolatedWorkers(workers: Array<{ clientId: string }>) {
  if (!workers.length) return;
  const ids = [...new Set(workers.map((worker) => String(worker.clientId || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  flowIsolatedReadyCount = ids.length;
  const initialCap = isolatedInitialCap(ids.length);
  const maxCap = isolatedMaxCap(ids.length);
  flowImageIsolatedAdaptiveCap = Math.min(
    maxCap,
    Math.max(initialCap, flowImageIsolatedAdaptiveCap || initialCap),
  );
  flowImageIsolatedMaxCap = maxCap;
  flowClientCache = { at: Date.now(), ids };
}

async function refreshRegisteredFlowImageClients(signal?: AbortSignal) {
  if (Date.now() - flowWorkerRegistryCheckedAt < FLOW_WORKER_REGISTRY_REFRESH_MS) return;
  if (!flowWorkerRegistryRefresh) {
    flowWorkerRegistryRefresh = (async () => {
      flowWorkerRegistryCheckedAt = Date.now();
      const registered = await listRegisteredIsolatedFlowWorkerIds();
      const currentIds = [...new Set(flowClientCache.ids.filter(Boolean))];
      const current = new Set(currentIds);
      const now = Date.now();
      const missing = registered.filter((clientId) => !current.has(clientId)
        && !flowImageSessionUnavailable(clientId)
        && (flowImageCooldownUntilByClient.get(clientId) || 0) <= now);
      if (!missing.length) return;

      // /health on a worker serving a slow image can stall. Probe only workers
      // newly registered or recovering outside the cache, using the lightweight
      // read-only credits endpoint before admitting them to the live pool.
      const credits = await readFlowImageCredits(missing, signal, true);
      const recovered = missing.filter((clientId) => typeof credits.get(clientId) === 'number');
      if (recovered.length) {
        rememberReadyIsolatedWorkers([...new Set([...currentIds, ...recovered])].map((clientId) => ({ clientId })));
      }
    })().finally(() => { flowWorkerRegistryRefresh = undefined; });
  }
  await flowWorkerRegistryRefresh;
}

async function healthyFlowImageClients(signal?: AbortSignal) {
  const cacheAge = Date.now() - flowClientCache.at;
  if (cacheAge < FLOW_CLIENT_CACHE_MS && flowClientCache.ids.length) return flowClientCache.ids;
  // /health can become slow while Google requests are actively in flight even
  // though the linked browser workers themselves are still valid. Never probe
  // /health in the middle of a busy wave; use the last proven account list for
  // the bounded stale window and refresh it once the pool goes idle again.
  if (flowImageGlobalActive > 0 && cacheAge < FLOW_CLIENT_STALE_CACHE_MS && flowClientCache.ids.length) {
    await refreshRegisteredFlowImageClients(signal);
    return flowClientCache.ids;
  }
  if (!flowClientRefresh) {
    flowClientRefresh = (async () => {
      const timeout = AbortSignal.timeout(2_500);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const isolatedWorkers = await listReadyIsolatedFlowWorkers();
        if (isolatedWorkers.length) {
          rememberReadyIsolatedWorkers(isolatedWorkers);
          return flowClientCache.ids;
        }
        const healthResponse = await fetch(`${baseUrl()}/health`, { signal: requestSignal, headers: headers() });
        if (healthResponse.ok) {
          const health = await healthResponse.json() as FlowAgentHealth;
          const bridgeConnected = flowExtensionConnected(health);
          const readyClientIds = bridgeConnected ? [...new Set((health.clients || [])
            .filter((client) => flowClientHasUsableSession(client) && typeof client.client_id === 'string' && client.client_id.trim())
            .map((client) => client.client_id!.trim()))] : [];
          if (readyClientIds.length) {
            flowIsolatedReadyCount = 0;
            // Every token-ready Flow Agent client is a real browser worker.
            // Keep the primary browser client in the pool alongside same-profile
            // account-* clients; otherwise primary + one linked account still
            // collapses to only two slots instead of the expected four.
            flowClientCache = { at: Date.now(), ids: readyClientIds };
            return readyClientIds;
          }
          if (!bridgeConnected) {
            flowIsolatedReadyCount = 0;
            flowClientCache = { at: Date.now(), ids: [] };
            return [];
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

function currentFlowImageCap() {
  if (flowIsolatedReadyCount > 0) {
    const initialCap = isolatedInitialCap();
    const maxCap = flowImageIsolatedMaxCap || isolatedMaxCap();
    if (flowImageRecoveringFromTraffic) return Math.min(5, maxCap, isolatedOneLaneCap());
    return Math.max(initialCap, Math.min(maxCap, flowImageIsolatedAdaptiveCap || initialCap));
  }
  if (flowImageRecoveringFromTraffic) return 1;
  return flowImageAdaptiveCap;
}

function tickFlowImageTelemetry(now = Date.now()) {
  const elapsed = Math.max(0, now - flowImageTelemetryLastAt);
  const cap = Math.max(1, currentFlowImageCap());
  flowImageTelemetryActiveSlotMs += flowImageGlobalActive * elapsed;
  flowImageTelemetryCapacitySlotMs += cap * elapsed;
  if (flowImageGlobalActive >= cap) flowImageTelemetrySaturatedMs += elapsed;
  flowImageTelemetryLastAt = now;
}

export function resetGoogleFlowImagePoolRuntimeStats() {
  const now = Date.now();
  flowImagePeakActive = flowImageGlobalActive;
  flowImageTelemetryStartedAt = now;
  flowImageTelemetryLastAt = now;
  flowImageTelemetryActiveSlotMs = 0;
  flowImageTelemetryCapacitySlotMs = 0;
  flowImageTelemetrySaturatedMs = 0;
}

function wakeFlowImageWaiter() {
  const wake = flowImageWaiters.shift();
  if (wake) wake();
}

function noteFlowImageSuccess(slot: FlowImageSlot) {
  if (slot.clientId) flowImageUpstream400StreakByClient.delete(slot.clientId);
  // Late responses from the rejected wave do not prove recovery.
  if (slot.startedAt < flowImageTrafficThrottleUntil) return;
  const isolated = flowIsolatedReadyCount > 0;
  if (flowImageRecoveringFromTraffic) {
    if (++flowImageTrafficRecoverySuccesses < 6) return;
    flowImageRecoveringFromTraffic = false;
    flowImageTrafficRounds = 0;
    flowImageAdaptiveCap = Math.min(flowImageAdaptiveCap, 2);
    if (isolated) {
      const maxCap = flowImageIsolatedMaxCap || isolatedMaxCap();
      flowImageIsolatedAdaptiveCap = Math.max(1, Math.min(5, maxCap));
    }
    flowImageSuccessStreak = 0;
    wakeFlowImageWaiter();
    return;
  }
  flowImageSuccessStreak += 1;
  const currentCap = currentFlowImageCap();
  const maxCap = isolated ? (flowImageIsolatedMaxCap || isolatedMaxCap()) : FLOW_IMAGE_GLOBAL_CAP_MAX;
  // Keep the cap fixed at the profile-wide ceiling. Success updates remain
  // useful for legacy/global modes, but cannot open extra browser RPC lanes.
  const threshold = isolated ? Math.max(6, Math.min(16, currentCap)) : Math.max(8, flowImageAdaptiveCap * 2);
  if (flowImageSuccessStreak >= threshold && currentCap < maxCap) {
    if (isolated) flowImageIsolatedAdaptiveCap = nextStableIsolatedImageCap(currentCap, maxCap, flowIsolatedReadyCount);
    else flowImageAdaptiveCap += 1;
    flowImageSuccessStreak = 0;
    console.info(`[Flow pool] stable -> increase ${isolated ? 'isolated' : 'global'} cap to ${currentFlowImageCap()}`);
    wakeFlowImageWaiter();
  }
}

function noteFlowImagePressure(reason: string, severe = false, pauseMsOverride?: number) {
  flowImageSuccessStreak = 0;
  const now = Date.now();
  // Many queued requests can fail together when the bridge is overloaded. One
  // backoff adjustment per short window is enough; the profile gate already
  // holds concurrency at one while the cooldown is applied.
  if (now - flowImageLastPressureAt >= 4_000) {
    const isolated = flowIsolatedReadyCount > 0;
    const cap = currentFlowImageCap();
    const minCap = isolated
      ? Math.min(flowImageIsolatedMaxCap || isolatedMaxCap(), isolatedInitialCap())
      : FLOW_IMAGE_GLOBAL_CAP_MIN;
    const next = severe ? Math.max(minCap, Math.ceil(cap / 2)) : Math.max(minCap, cap - 2);
    if (next < cap) {
      if (isolated) flowImageIsolatedAdaptiveCap = next;
      else flowImageAdaptiveCap = next;
    }
    flowImageLastPressureAt = now;
  }
  const pauseMs = pauseMsOverride || (severe ? 12_000 : 5_000);
  flowImagePressureUntil = Math.max(flowImagePressureUntil, now + pauseMs);
  wakeFlowImageWaiter();
}

async function waitForFlowImageCapacity(signal?: AbortSignal) {
  signal?.throwIfAborted();
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

function flowImagePoolPauseError() {
  const seconds = Math.max(1, Math.ceil((flowImageTrafficThrottleUntil - Date.now()) / 1000));
  const reason = flowImagePoolPauseMessage || 'Google Flow đang tạm từ chối yêu cầu reCAPTCHA.';
  return new FlowSessionError(
    `${reason} Toàn bộ yêu cầu ảnh đang tạm chờ ${seconds} giây. Ảnh và checkpoint đã hoàn thành vẫn được giữ.`,
    flowImagePoolPauseCode || 'FLOW_IMAGE_TRAFFIC_THROTTLED',
    flowImageTrafficThrottleUntil,
  );
}

export function flowImageSlotWaitMs(requestedMs: number | undefined, preserveExistingOutcome: boolean) {
  return preserveExistingOutcome ? Math.max(requestedMs || 0, 60_000) : requestedMs;
}

async function acquireFlowImageSlot(
  signal?: AbortSignal,
  preferredClientIds?: string[],
  excludedClientIds?: string[],
  maxWaitMs?: number,
  allowUnavailablePreferred = false,
  assetKey?: string,
): Promise<FlowImageSlot> {
  const waitStartedAt = Date.now();
  while (true) {
    signal?.throwIfAborted();
    if (maxWaitMs && Date.now() - waitStartedAt >= maxWaitMs) {
      throw new Error('FLOW_NO_HEALTHY_ALTERNATE_WORKER');
    }
    const now = Date.now();
    if (now < flowImageTrafficThrottleUntil) {
      throw flowImagePoolPauseError();
    }
    if (now < flowImagePressureUntil) {
      await wait(Math.min(1_000, flowImagePressureUntil - now), signal);
      continue;
    }
    const effectiveGlobalCap = currentFlowImageCap();
    if (flowImageGlobalActive >= effectiveGlobalCap) {
      await waitForFlowImageCapacity(signal);
      continue;
    }

    const allClientIds = await healthyFlowImageClients(signal);
    const preferred = preferredClientIds?.length ? new Set(preferredClientIds) : undefined;
    const excluded = excludedClientIds?.length ? new Set(excludedClientIds) : undefined;
    // During isolated-account failover, an empty-string legacy fallback is not
    // a real alternate worker; port 8001 may be tokenless while isolated tabs
    // are healthy. Never route a failed isolated request there.
    const discoveredClientIds = excluded?.size ? allClientIds.filter(Boolean) : allClientIds;
    let claimedOwner = assetKey ? flowImageAssetOwners.get(assetKey) : undefined;
    if (claimedOwner && excluded?.has(claimedOwner)) {
      flowImageAssetOwners.delete(assetKey!);
      claimedOwner = undefined;
    }
    const clientIds = (preferred ? discoveredClientIds.filter((clientId) => preferred.has(clientId)) : discoveredClientIds)
      .filter((clientId) => !claimedOwner || clientId === claimedOwner)
      .filter((clientId) => !excluded?.has(clientId));
    if (!clientIds.length) {
      if (excluded?.size && !allClientIds.some((clientId) => Boolean(clientId) && !excluded.has(clientId))) {
        throw new Error('FLOW_NO_HEALTHY_ALTERNATE_WORKER');
      }
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
    })).filter((client) => client.active < slotsPerClient
      && (!flowImageSessionUnavailable(client.clientId) || (allowUnavailablePreferred && preferred?.has(client.clientId))));
    // Prefer the account with the largest live balance. Unknown balances stay
    // usable, while known-zero accounts are the last resort until another
    // account has been ruled out.
    const notCoolingDown = capacity.filter((client) => client.cooldownUntil <= afterProbe);
    // A connected extension with a stored token can still be rejected by
    // Google. Prefer accounts whose live credit probe proved the session works
    // before falling back to unknown/unverified accounts.
    const creditVerified = notCoolingDown.filter((client) => typeof client.credits === 'number' && client.credits > 0);
    const candidates = (creditVerified.length ? creditVerified : notCoolingDown)
      .sort((a, b) => a.active - b.active
        || a.lastStartedAt - b.lastStartedAt
        || creditRank(b.credits) - creditRank(a.credits)
        || a.clientId.localeCompare(b.clientId));
    const selected = candidates[0];
    if (!selected) {
      if (clientIds.length && clientIds.every(flowImageSessionUnavailable)) {
        throw new FlowSessionError(
          'Không có worker Flow nào có Flow key còn dùng được. Các ảnh trong checkpoint vẫn được giữ; hãy đăng nhập lại các tài khoản Flow rồi tiếp tục job.',
          'FLOW_NO_AUTHENTICATED_WORKERS',
        );
      }
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
    const currentGlobalCap = currentFlowImageCap();
    // Health/credit probes await I/O: another request may have closed the
    // pool meanwhile. Recheck before reserving or dispatching a new slot.
    if (Date.now() < flowImageTrafficThrottleUntil) throw flowImagePoolPauseError();
    if (flowImageGlobalActive >= currentGlobalCap) {
      await waitForFlowImageCapacity(signal);
      continue;
    }
    const isolated = flowIsolatedReadyCount > 0;
    const globalGap = isolated
      ? (flowImageRecoveringFromTraffic ? FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS : FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS)
      : (flowImageRecoveringFromTraffic ? Math.max(10_000, FLOW_IMAGE_GLOBAL_START_GAP_MS) : FLOW_IMAGE_GLOBAL_START_GAP_MS);
    const waitMs = Math.max(0, flowImageLastGlobalStartedAt + globalGap - Date.now(), selected.lastStartedAt + FLOW_IMAGE_START_GAP_MS - Date.now());
    if (waitMs) {
      await wait(Math.min(waitMs, 1000), signal);
      continue;
    }
    if (selected.cooldownUntil) flowImageCooldownUntilByClient.delete(selected.clientId);
    // Credit/health probes await I/O. Another caller may have reserved this
    // exact asset in the meantime; reevaluate without submitting it elsewhere.
    const currentOwner = assetKey ? flowImageAssetOwners.get(assetKey) : undefined;
    if (currentOwner && currentOwner !== selected.clientId) continue;
    if (assetKey) flowImageAssetOwners.set(assetKey, selected.clientId);
    tickFlowImageTelemetry();
    flowImageActiveByClient.set(selected.clientId, selected.active + 1);
    flowImageGlobalActive += 1;
    flowImagePeakActive = Math.max(flowImagePeakActive, flowImageGlobalActive);
    // Reserve both start timestamps synchronously with the slot.
    const startedAt = Date.now();
    flowImageLastGlobalStartedAt = startedAt;
    flowImageLastStartedByClient.set(selected.clientId, startedAt);
    return { clientId: selected.clientId || undefined, clientCount: Math.max(1, clientIds.filter(Boolean).length || 1), startedAt };
  }
}

function cooldownFlowImageClient(clientId: string | undefined, milliseconds: number) {
  if (!clientId) return;
  const until = Date.now() + Math.max(1_000, milliseconds);
  flowImageCooldownUntilByClient.set(clientId, Math.max(flowImageCooldownUntilByClient.get(clientId) || 0, until));
  wakeFlowImageWaiter();
}

function markFlowImageSessionUnavailable(clientId: string) {
  flowImageSessionUnavailableUntilByClient.set(clientId, Date.now() + FLOW_IMAGE_SESSION_FAILURE_COOLDOWN_MS);
}

function flowImageSessionUnavailable(clientId: string) {
  const unavailableUntil = flowImageSessionUnavailableUntilByClient.get(clientId) || 0;
  if (unavailableUntil > Date.now()) return true;
  if (unavailableUntil) flowImageSessionUnavailableUntilByClient.delete(clientId);
  return false;
}

function stableFlowWorkerPreference(idempotencyKey: string, clientIds: string[]) {
  return [...new Set(clientIds)].sort((left, right) => {
    const leftScore = createHash('sha256').update(`${idempotencyKey}\0${left}`).digest('hex');
    const rightScore = createHash('sha256').update(`${idempotencyKey}\0${right}`).digest('hex');
    return rightScore.localeCompare(leftScore) || left.localeCompare(right);
  })[0];
}

function freshProcessingRecord(record: Awaited<ReturnType<typeof readFlowWorkerIdempotencyRecord>> | undefined) {
  return record?.state === 'processing'
    && record.createdAtKnown === true
    && record.recordedAtMs !== undefined
    && Date.now() - record.recordedAtMs < FLOW_IMAGE_RECONCILIATION_STALE_MS;
}

async function rerouteStableAssetFromUnavailableWorker(
  idempotencyKey: string,
  preferredClientIds: string[],
  signal?: AbortSignal,
  onProgress?: (message: string) => Promise<void> | void,
  balanceUnclaimed = false,
): Promise<{ clientIds: string[]; preserveExistingOutcome: boolean }> {
  if (!preferredClientIds.length) return { clientIds: preferredClientIds, preserveExistingOutcome: false };
  const preferred = preferredClientIds[0];
  let discovered = await healthyFlowImageClients(signal);
  if (!discovered.includes(preferred)) {
    invalidateFlowClientPool();
    discovered = await healthyFlowImageClients(signal);
  }
  // /credits is a read-only live Flow check. A health token flag can stay true
  // after the Flow key has expired, so verify the sticky worker before pinning a
  // fresh durable image key to it.
  const preferredConnected = discovered.includes(preferred);
  if (preferredConnected) await readFlowImageCredit(preferred, signal);
  const preferredSessionUnavailable = flowImageSessionUnavailable(preferred);

  const registered = await listRegisteredIsolatedFlowWorkerIds();
  const recordOwners = [...new Set([...preferredClientIds, ...registered, ...discovered])];
  const records = await Promise.all(recordOwners.map(async (clientId) => {
    const resolved = await readAutoSubAssetRecord(clientId, idempotencyKey);
    return { clientId, requestKey: resolved.key, record: resolved.record };
  }));

  // A completed result wins regardless of which worker produced it. A genuinely
  // fresh processing record is also sticky so AutoSub cannot double-spend while
  // Google may still be generating the image.
  const succeeded = records.find(({ record }) => record?.state === 'succeeded');
  const processing = records.find(({ record }) => freshProcessingRecord(record));
  const existingOutcome = succeeded || processing;
  if (existingOutcome) return { clientIds: [existingOutcome.clientId], preserveExistingOutcome: true };

  // Legacy V2 records have created=null. Their file mtime is shared by every
  // entry and changes whenever ANY request writes the file, so they can look
  // fresh forever. Failed records are terminal for that worker-local key too.
  // Treat both as poisoned owners and route the durable asset key to a healthy
  // worker that has never claimed it.
  const poisonedOwners = new Set(records
    .filter(({ record }) => record?.state === 'failed'
      || (record?.state === 'processing' && !freshProcessingRecord(record)))
    .map(({ clientId }) => clientId));
  const cachedOwner = flowImageAssetOwners.get(idempotencyKey);
  if (cachedOwner && poisonedOwners.has(cachedOwner)) flowImageAssetOwners.delete(idempotencyKey);
  else if (cachedOwner) return { clientIds: [cachedOwner], preserveExistingOutcome: true };

  // A poisoned sticky key is exactly when a stale cached client list is most
  // dangerous. Refresh directly from the isolated worker supervisor so a clean
  // 3rd/4th/... worker can be used immediately instead of waiting on the same
  // tombstone again.
  if (poisonedOwners.has(preferred)) {
    const liveReady = await listReadyIsolatedFlowWorkers().catch(() => []);
    // Replace (do not union with) the cached discovery set. The whole point of
    // this probe is to discard stale clients that may have disappeared since
    // the cache was populated; keeping them here can cause a 60s sticky wait
    // on a worker that is not actually ready.
    discovered = [...new Set(liveReady.map((worker) => worker.clientId))];
  }

  if (preferredConnected && !preferredSessionUnavailable && !poisonedOwners.has(preferred)) {
    return {
      clientIds: balanceUnclaimed ? discovered.filter((id) => !poisonedOwners.has(id)) : preferredClientIds,
      preserveExistingOutcome: false,
    };
  }

  const candidates = [...new Set(discovered)].filter((clientId) => Boolean(clientId) && !poisonedOwners.has(clientId));
  if (!candidates.length) {
    // Every currently healthy worker has already claimed this asset key and no
    // trustworthy in-flight/succeeded outcome exists. Waiting on a legacy
    // tombstone again only recreates the endless 20% loop. Stop this one asset
    // immediately; the Director keeps the checkpoint and may retry only after
    // the pool has a genuinely clean owner.
    throw new FlowSessionError(
      'Mọi worker Flow đang sẵn sàng đều đã có bản ghi cũ/không xác định cho ảnh này; không tiếp tục chờ tombstone cũ.',
      'FLOW_RECONCILIATION_EXHAUSTED',
    );
  }
  // Query alternatives with a read-only probe. Cooled-down workers may have
  // reconnected since the previous failure and should rejoin immediately.
  const credits = await readFlowImageCredits(candidates, signal, true);
  const verified = candidates.filter((clientId) => typeof credits.get(clientId) === 'number' && (credits.get(clientId) || 0) > 0);
  const fallbackPool = verified.length ? verified : candidates.filter((clientId) => !flowImageSessionUnavailable(clientId));
  if (!fallbackPool.length) {
    throw new FlowSessionError(
      'Không có worker Flow nào có Flow key còn dùng được. Các ảnh trong checkpoint vẫn được giữ; hãy đăng nhập lại các tài khoản Flow rồi tiếp tục job.',
      'FLOW_NO_AUTHENTICATED_WORKERS',
    );
  }
  const fallback = stableFlowWorkerPreference(idempotencyKey, fallbackPool);
  if (!fallback) {
    throw new FlowSessionError('Không tìm thấy worker Flow đã xác thực để tạo ảnh.', 'FLOW_NO_AUTHENTICATED_WORKERS');
  }
  console.warn(`[Flow pool] stable image key moved off ${preferred} because its worker is disconnected or unauthenticated; selected ${fallback}`);
  await onProgress?.(`Flow worker ${preferred.replace(/^account-/, '').slice(0, 8)} tạm mất kết nối/phiên · chuyển ảnh sang worker khỏe ${fallback.replace(/^account-/, '').slice(0, 8)} · giữ nguyên khóa ảnh`);
  return { clientIds: balanceUnclaimed ? fallbackPool : [fallback], preserveExistingOutcome: false };
}

function releaseFlowImageSlot(slot: FlowImageSlot) {
  tickFlowImageTelemetry();
  const key = slot.clientId || '';
  flowImageActiveByClient.set(key, Math.max(0, (flowImageActiveByClient.get(key) || 1) - 1));
  flowImageGlobalActive = Math.max(0, flowImageGlobalActive - 1);
  // Wake the next queued account after a completion; only one profile-wide
  // Flow image request may be active at a time.
  const effectiveGlobalCap = currentFlowImageCap();
  for (let index = 0; index < Math.max(1, effectiveGlobalCap - flowImageGlobalActive); index += 1) wakeFlowImageWaiter();
}

function invalidateFlowClientPool() {
  flowClientCache = { at: 0, ids: flowClientCache.ids };
}

export function getGoogleFlowImagePoolRuntimeStats() {
  tickFlowImageTelemetry();
  const cap = currentFlowImageCap();
  const sampleMs = Math.max(0, Date.now() - flowImageTelemetryStartedAt);
  return {
    active: flowImageGlobalActive,
    peakActive: flowImagePeakActive,
    cap,
    isolatedReadyAccounts: flowIsolatedReadyCount,
    slotsPerAccount: FLOW_IMAGE_SLOTS_PER_CLIENT,
    sampleMs,
    utilizationPercent: flowImageTelemetryCapacitySlotMs > 0
      ? Math.round(flowImageTelemetryActiveSlotMs / flowImageTelemetryCapacitySlotMs * 10_000) / 100
      : 0,
    saturatedPercent: sampleMs > 0
      ? Math.round(flowImageTelemetrySaturatedMs / sampleMs * 10_000) / 100
      : 0,
    activeByClient: Object.fromEntries([...flowImageActiveByClient.entries()].filter(([, active]) => active > 0)),
  };
}

export async function getGoogleFlowImagePoolCapacity(signal?: AbortSignal) {
  const ids = await healthyFlowImageClients(signal);
  const accountCount = Math.max(1, ids.filter(Boolean).length || 1);
  const isolated = flowIsolatedReadyCount > 0;
  const slotsPerAccount = FLOW_IMAGE_SLOTS_PER_CLIENT;
  const totalSlots = accountCount * slotsPerAccount;
  const effectiveCap = isolated ? currentFlowImageCap() : flowImageAdaptiveCap;
  return {
    accountCount,
    slotsPerAccount,
    totalSlots,
    maxParallelSlots: isolated ? FLOW_IMAGE_PROFILE_SAFE_CAP : FLOW_IMAGE_GLOBAL_CAP_MAX,
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

async function readFlowImageCredit(clientId: string, signal?: AbortSignal, forceProbe = false): Promise<number | undefined> {
  const normalizedClientId = clientId.trim();
  if (!normalizedClientId) return undefined;
  if (!forceProbe && flowImageSessionUnavailable(normalizedClientId)) return undefined;
  const cached = flowImageCreditsByClient.get(normalizedClientId);
  if (!forceProbe && cached && Date.now() - cached.at < FLOW_IMAGE_CREDIT_CACHE_MS) return cached.credits;
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
        status?: number;
        error?: string;
      };
      if (body.error === 'NO_FLOW_KEY' || (Number(body.status) >= 400 && /NO_FLOW_KEY/i.test(String(body.error || '')))) {
        flowImageCreditsByClient.delete(normalizedClientId);
        markFlowImageSessionUnavailable(normalizedClientId);
        return undefined;
      }
      const credits = Number(body.data?.credits ?? body.credits ?? body.total_credits);
      if (!Number.isFinite(credits)) return undefined;
      flowImageSessionUnavailableUntilByClient.delete(normalizedClientId);
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

async function readFlowImageCredits(clientIds: string[], signal?: AbortSignal, forceProbe = false) {
  // Never let a slow /credits probe create empty generation lanes in the middle
  // of a healthy wave. Use the latest known balance immediately and refresh
  // stale balances in the background; a real 402 still cools that account and
  // reroutes the request, so this fast path does not risk repeated paid calls.
  if (flowImageGlobalActive > 0 && !forceProbe) {
    const cached = new Map<string, number | undefined>();
    for (const clientId of clientIds) {
      const entry = flowImageCreditsByClient.get(clientId);
      cached.set(clientId, entry?.credits);
      if (!entry || Date.now() - entry.at >= FLOW_IMAGE_CREDIT_CACHE_MS) {
        void readFlowImageCredit(clientId, signal).catch(() => undefined);
      }
    }
    return cached;
  }
  const entries = await Promise.all(clientIds.map(async (clientId) => [
    clientId,
    await readFlowImageCredit(clientId, signal, forceProbe),
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
  await ensureFlowAgentRuntimePatched();
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
                // Keep auto-started workers aligned with the profile-wide Flow
                // scheduler. Nine child processes must not each create their own
                // concurrent burst against the same browser session.
                MAX_CONCURRENT_REQUESTS: '1',
                REQUEST_MIN_INTERVAL: String(Math.max(3, Math.min(30, Number(process.env.REQUEST_MIN_INTERVAL) || 0))),
                GLOBAL_REQUEST_MIN_INTERVAL: String(Math.max(3, Math.min(30, Number(process.env.GLOBAL_REQUEST_MIN_INTERVAL) || 0))),
                API_REQUEST_TIMEOUT: process.env.API_REQUEST_TIMEOUT || '300',
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
  constructor(message: string, readonly code = 'FLOW_SESSION', readonly retryAt?: number) { super(message); }
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
    if (/FLOW_REQUEST_CONTEXT_MISSING|FLOW_PROJECT_REQUIRED/i.test(detail)) throw new FlowSessionError('Flow Agent nhận request ảnh nhưng thiếu context cần thiết. Worker và token vẫn kết nối; request chưa được gửi lên Google.', 'FLOW_REQUEST_CONTEXT_MISSING');
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
    if (response.status === 503 && /Google Flow extension is not connected|Open Google Flow in Chrome/i.test(detail)) {
      throw new FlowSessionError('Worker Google Flow đã mất kết nối trình duyệt. Hãy mở tab Flow trong cùng profile đang cài Flow Agent, sau đó tiếp tục job đã lưu.', 'FLOW_EXTENSION_NOT_CONNECTED');
    }
    // The bridge can wrap an upstream OAuth rejection in HTTP 400.
    // An existing key does not mean Google still accepts it.
    if (/invalid authentication credentials|expected OAuth 2 access token/i.test(detail)) {
      throw new FlowSessionError('Google Flow từ chối token đăng nhập hiện tại. Mở đúng tài khoản Google Flow và đăng nhập lại nếu được yêu cầu.', 'NO_FLOW_KEY');
    }
    // Browser/Flow-agent timeouts can happen after Google already accepted the
    // generation. Mark them as an uncertain outcome so generateGoogleFlowImages
    // replays the SAME idempotency key on the SAME worker instead of aborting
    // the whole video or creating a duplicate on another account.
    if (response.status === 400 && (
      /^failed to fetch\.?$/i.test(detail.trim())
      || /timed out waiting for Google Flow to respond/i.test(detail)
      || /image may still have been generated/i.test(detail)
    )) {
      throw new FlowSessionError('Google Flow chưa xác nhận kết quả của lượt tạo ảnh. AutoSub sẽ kiểm tra lại an toàn trên đúng worker bằng cùng idempotency key để lấy kết quả nếu ảnh đã được tạo.', 'FLOW_GENERATION_OUTCOME_UNKNOWN');
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
    if (isolatedWorkers.length) rememberReadyIsolatedWorkers(isolatedWorkers);
    const mainBridgeConnected = flowExtensionConnected(health);
    const linkedReady = mainBridgeConnected && (health.clients || []).some(flowClientHasUsableSession);
    const bearerWorkerIds = isolatedWorkers.filter((worker) => worker.tokenReady).map((worker) => worker.clientId);
    const isolatedCredits = bearerWorkerIds.length
      ? await readFlowImageCredits(bearerWorkerIds, signal)
      : undefined;
    const authenticatedIsolatedAccounts = isolatedCredits
      ? [...isolatedCredits.values()].filter((credits) => typeof credits === 'number').length
      : 0;
    const imageTransportReady = isolatedWorkers.length > 0;
    const extensionConnected = mainBridgeConnected || imageTransportReady;
    // The legacy primary client can legitimately have no token while seven
    // linked same-profile accounts are fully authenticated. Treat the linked
    // pool as the real session source instead of failing preflight because the
    // primary top-level has_flow_key flag is false.
    const hasFlowKey = imageTransportReady
      ? isolatedWorkers.some((worker) => worker.tokenReady)
      : Boolean(health.has_flow_key) || linkedReady;
    const poolHealthy = imageTransportReady
      ? true
      : health.status === 'healthy' || linkedReady;
    return {
      installed: true,
      connected: poolHealthy && extensionConnected && (hasFlowKey || imageTransportReady),
      extensionConnected,
      hasFlowKey,
      imageTransportReady,
      status: linkedReady || imageTransportReady ? 'healthy' : (health.status || 'unknown'),
      transport: imageTransportReady ? 'isolated' : (health.transport || 'none'),
      url: baseUrl(),
      imagePool: {
        ...getGoogleFlowImagePoolRuntimeStats(),
        workerAccounts: isolatedWorkers.length,
        authenticatedAccounts: authenticatedIsolatedAccounts,
      },
    };
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
    return { installed: false, connected: false, extensionConnected: false, hasFlowKey: false, imageTransportReady: false, status: 'offline', transport: 'none', url: baseUrl(), error: error instanceof Error ? error.message : String(error) };
  }
}

export async function validateGoogleFlowSession(_credentials?: unknown, signal?: AbortSignal, options: { requireBearer?: boolean } = {}) {
  let status = await flowAgentStatus(signal);
  if (!status.installed) {
    await ensureGoogleFlowAgentRuntime();
    status = await flowAgentStatus(signal);
  }
  if (!status.installed) throw new FlowSessionError(`Flow Agent chưa chạy tại ${status.url}. AutoSub đã thử tự khởi động nhưng bridge vẫn chưa phản hồi.`, 'FLOW_AGENT_OFFLINE');
  if (!status.extensionConnected) throw new FlowSessionError('Extension Flow Agent chưa kết nối. Hãy mở Google Flow trong Opera GX và giữ tab đăng nhập hoạt động.');
  const cookieImageSessionReady = status.imageTransportReady === true && status.extensionConnected;
  if (!status.hasFlowKey && (!cookieImageSessionReady || options.requireBearer)) {
    await refreshFlowSessionOnce(signal);
    status = await flowAgentStatus(signal);
  }
  if (!status.hasFlowKey && !(status.imageTransportReady === true && status.extensionConnected)) {
    throw new FlowSessionError('Flow Agent chưa lấy được token hoặc phiên Flow trong tab chưa sẵn sàng. Hãy mở Google Flow, đăng nhập đúng tài khoản và thử lại.');
  }
  if (!status.hasFlowKey && options.requireBearer) {
    throw new FlowSessionError('Luồng tạo video Flow hiện tại cần Bearer token; tab này chỉ sẵn sàng cho giao thức tạo ảnh mới. Hãy Refresh token hoặc chọn provider video khác.', 'NO_FLOW_KEY');
  }
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

const flowClientBackgroundRefreshes = new Map<string, Promise<void>>();

function refreshFlowClientInBackground(clientId: string) {
  if (flowClientBackgroundRefreshes.has(clientId)) return;
  markFlowImageSessionUnavailable(clientId);
  const recovery = refreshFlowClientSession(clientId)
    .catch(() => undefined)
    .finally(() => { flowClientBackgroundRefreshes.delete(clientId); });
  flowClientBackgroundRefreshes.set(clientId, recovery);
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
  if (!response.ok) throw new FlowSessionError(`Flow Agent không thể làm mới tài khoản ${clientId} (HTTP ${response.status}).`, 'FLOW_SESSION_REFRESH_FAILED');
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
      flowImageSessionUnavailableUntilByClient.delete(clientId);
      flowImageCooldownUntilByClient.delete(clientId);
      invalidateFlowClientPool();
      wakeFlowImageWaiter();
      return;
    }
    if (attempt < 11) await wait(1_500, requestSignal).catch(() => undefined);
  }
  throw new FlowSessionError(`Tài khoản Flow ${clientId} chưa sẵn sàng sau khi làm mới.`, 'FLOW_SESSION_REFRESH_FAILED');
}

function isImageGenerationAlreadyProcessing(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /Flow Agent HTTP 409:.*(?:idempotent image generation is already processing|already processing; retry with the same key)/i.test(detail);
}

function isImageGenerationIdempotencyConflict(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return /Flow Agent HTTP 409:.*Idempotency-Key was already used with a different image generation request/i.test(detail);
}

function isStableAutoSubAssetKey(value?: string) {
  return /^autosub-asset-[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function scopedAutoSubAssetKey(rootKey: string, clientId?: string) {
  if (!clientId || !isStableAutoSubAssetKey(rootKey)) return rootKey;
  return `autosub-asset-${createHash('sha256').update(`${rootKey}\0worker\0${clientId}`).digest('hex')}`;
}

async function readAutoSubAssetRecord(clientId: string, rootKey: string) {
  const scopedKey = scopedAutoSubAssetKey(rootKey, clientId);
  const scoped = await readFlowWorkerIdempotencyRecord(clientId, scopedKey);
  if (scoped) return { key: scopedKey, record: scoped };
  if (scopedKey !== rootKey) {
    const legacy = await readFlowWorkerIdempotencyRecord(clientId, rootKey);
    if (legacy) return { key: rootKey, record: legacy };
  }
  return { key: scopedKey, record: undefined };
}

async function reconcileAutoSubAssetKey<T>(idempotencyKey: string, clientId: string, signal?: AbortSignal, onProgress?: (message: string) => Promise<void> | void): Promise<T> {
  for (let replay = 0; ; replay += 1) {
    const record = await readFlowWorkerIdempotencyRecord(clientId, idempotencyKey);
    if (!record) {
      throw new FlowSessionError(
        `Flow Agent báo request ảnh vẫn đang xử lý trên ${clientId}, nhưng AutoSub không đọc được bản ghi gốc. AutoSub giữ checkpoint và không gửi lại ảnh để tránh tạo trùng.`,
        'FLOW_RECONCILIATION_EXHAUSTED',
      );
    }
    if (record.state === 'succeeded') {
      if (record.response && typeof record.response === 'object') return record.response as T;
      throw new FlowSessionError(
        `Flow Agent đã đánh dấu request ảnh thành công trên ${clientId} nhưng không lưu response. AutoSub giữ checkpoint và không tạo ảnh trùng.`,
        'FLOW_RECONCILIATION_EXHAUSTED',
      );
    }
    if (record.state === 'failed') {
      const status = record.error?.status_code || 500;
      const detail = record.error?.detail || 'Flow Agent lưu request ảnh trước đó là thất bại.';
      // Durable failures need the same classification as on-time responses:
      // a confirmed auth/bridge rejection may hand off; unknown outcomes may not.
      return parseResponse<T>(Response.json({ detail }, { status }));
    }
    if (signal?.aborted) throw new DOMException('Đã dừng đối soát kết quả Flow.', 'AbortError');
    if (replay >= FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT
      || (record.recordedAtMs !== undefined && Date.now() - record.recordedAtMs >= FLOW_IMAGE_RECONCILIATION_STALE_MS)) {
      throw new FlowSessionError(
        `Flow chưa trả kết quả ảnh trên ${clientId} sau thời hạn xác nhận. Đã dừng vòng chờ và giữ các ảnh đã xong. Cần kiểm tra kết quả trong tài khoản Flow này trước khi tiếp tục.`,
        'FLOW_RECONCILIATION_EXHAUSTED',
      );
    }
    if (replay === 0 || (replay + 1) % 6 === 0) {
      await onProgress?.(`Flow đang xử lý ảnh trên worker ${clientId.replace(/^account-/, '').slice(0, 8)} · đang đối soát cùng khóa (${replay + 1}/${FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT}) · giữ checkpoint, không tạo trùng`);
      console.warn(`[Flow] image still processing on ${clientId}; checking its durable result (${replay + 1}/${FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT})`);
    }
    await wait(Math.min(10_000, FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS * Math.min(replay + 1, 5)), signal);
  }
}

async function requestWithIdempotentImageReplay<T>(request: (attempt: number) => Promise<Response>, attempt: number, signal?: AbortSignal, clientId?: string, idempotencyKey?: string, onProgress?: (message: string) => Promise<void> | void) {
  let replay = 0;
  while (true) {
    try {
      return await parseResponse<T>(await request(attempt));
    } catch (error) {
      if ((isImageGenerationIdempotencyConflict(error) || isImageGenerationAlreadyProcessing(error))
        && clientId && isStableAutoSubAssetKey(idempotencyKey)) {
        // Flow Agent fingerprints account-scoped reference media IDs too. Those
        // IDs can change after a browser/backend recovery even though this
        // durable AutoSub asset key still identifies the exact same image. A
        // processing 409 has the same recovery path: read the assigned worker's
        // durable record so late callbacks can finish it without POST polling.
        return reconcileAutoSubAssetKey<T>(idempotencyKey!, clientId, signal, onProgress);
      }
      if (!isImageGenerationAlreadyProcessing(error) || signal?.aborted) throw error;
      if (replay >= FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT) {
        throw new FlowSessionError(
          `Google Flow vẫn đang xử lý request ảnh${clientId ? ` trên ${clientId}` : ''}. AutoSub đã chờ và gửi lại cùng idempotency key; giữ checkpoint và không chuyển request sang worker khác để tránh tạo trùng.`,
          'FLOW_GENERATION_OUTCOME_UNKNOWN',
        );
      }
      replay += 1;
      if (replay === 1 || replay % 6 === 0) {
        await onProgress?.(`Flow vẫn đang xử lý ảnh trên worker ${clientId?.replace(/^account-/, '').slice(0, 8) || 'hiện tại'} · đang gửi lại cùng khóa an toàn (${replay}/${FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT}) · giữ checkpoint`);
        console.warn(`[Flow] image generation still processing on ${clientId || 'primary'}; replaying the same idempotency key (${replay}/${FLOW_IMAGE_IDEMPOTENT_REPLAY_LIMIT})`);
      }
      await wait(Math.min(10_000, FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS * Math.min(replay, 5)), signal);
    }
  }
}

async function requestWithSessionRecovery<T>(request: (attempt: number) => Promise<Response>, signal?: AbortSignal, clientId?: string, idempotencyKeyForAttempt?: (attempt: number) => string | undefined, onProgress?: (message: string) => Promise<void> | void) {
  try {
    return await requestWithIdempotentImageReplay<T>(request, 0, signal, clientId, idempotencyKeyForAttempt?.(0), onProgress);
  } catch (error) {
    if (localFlowNetworkFailure(error)) {
      const isolatedBase = clientId ? await isolatedFlowWorkerBase(clientId) : undefined;
      if (clientId && isolatedBase) {
        // Self-heal only the isolated Flow worker process. This starts the
        // worker executable on its existing port; it never restarts AutoSub,
        // npm run dev, the backend, or the UI/job controller.
        try {
          await ensureIsolatedFlowWorker(clientId);
        } catch (workerStartError) {
          // A single isolated worker failing to reopen its registered port is
          // known-not-dispatched for this retry. Never let that generic
          // supervisor error escape and kill the whole Director job while the
          // remaining Flow pool is healthy.
          throw new FlowSessionError(
            `Flow worker ${clientId} không khởi động lại được local runtime: ${workerStartError instanceof Error ? workerStartError.message : String(workerStartError)}`,
            'FLOW_LOCAL_WORKER_UNAVAILABLE',
          );
        }
        await refreshFlowClientSession(clientId, signal).catch(() => undefined);
        // attempt=2 means transport recovery: reuse the original idempotency
        // key so a socket drop cannot create a duplicate generation.
        return requestWithIdempotentImageReplay<T>(request, 2, signal, clientId, idempotencyKeyForAttempt?.(2), onProgress);
      }
      throw new FlowSessionError(
        'Flow Agent local runtime không phản hồi; AutoSub không tự khởi động lại ứng dụng đang chạy.',
        'FLOW_LOCAL_WORKER_UNAVAILABLE',
      );
    }
    // Missing page scripts are not missing tokens: force_refresh invalidates
    // the current token but cannot repair a blocked/unloaded reCAPTCHA script.
    let shouldRefresh = error instanceof FlowSessionError && error.code === 'NO_FLOW_KEY';
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
    // An image rejected for missing credentials has not reached generation.
    // Let another isolated account take it while this account recovers.
    if (clientId && idempotencyKeyForAttempt && await isolatedFlowWorkerBase(clientId)) {
      const registered = await listRegisteredIsolatedFlowWorkerIds();
      if (registered.some((id) => id !== clientId)) {
        throw new FlowSessionError(`Tài khoản Flow ${clientId} đang làm mới phiên; chuyển ảnh sang worker khác.`, 'NO_FLOW_KEY');
      }
    }
    if (clientId) await refreshFlowClientSession(clientId, signal);
    else await refreshFlowSessionOnce(signal);
    // Flow Agent persists failed idempotent requests. Retrying with the old key
    // would only replay the stored failure and never reach Google again.
    return requestWithIdempotentImageReplay<T>(request, 1, signal, clientId, idempotencyKeyForAttempt?.(1), onProgress);
  }
}

type FlowImageOptions = {
  model?: string;
  size?: string;
  referenceImagePath?: string;
  referenceImagePaths?: string[];
  signal?: AbortSignal;
  idempotencyKey?: string;
  _creditRotationAttempt?: number;
  _failoverAttempt?: number;
  _trafficRotationAttempt?: number;
  _uncertainReplayAttempt?: number;
  _staleOutcomeHandoffAttempt?: number;
  _preferredClientIds?: string[];
  _excludedClientIds?: string[];
  _allowUnavailablePreferred?: boolean;
  _slotAcquireTimeoutMs?: number;
  _requestTimeoutMs?: number;
  onProgress?: (message: string) => Promise<void> | void;
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

function scopeLinkedReferenceBytes(bytes: Buffer, mimeType: string, clientId: string, uploadNonce: string) {
  // Flow Agent 2.0.7 caches uploaded references globally by SHA-256, while
  // Google media IDs are account/session scoped. The same reference bytes sent
  // through several X-Client-Id workers therefore collide in history.json and
  // get revalidated against the wrong Google account. Add harmless container
  // metadata per upload so a stale agent-side cache entry cannot be returned
  // after a session reset. AutoSub's in-process cache still reuses the media ID
  // for subsequent images without changing any visible pixel.
  const marker = Buffer.from(`AutoSubClient\0${clientId}:${uploadNonce}`, 'utf8');

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
    const text = Buffer.from(`AutoSubClient:${clientId}:${uploadNonce}`, 'utf8');
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

function referenceMimeType(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
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
  // Keep the same key across an uncertain transport replay on the same worker.
  // This lets Flow Agent return the persisted result instead of starting a
  // second paid generation after the browser callback stalls.
  const idempotencyKey = options.idempotencyKey?.trim()
    || `autosub-image-${createHash('sha256').update(`${outputFiles.join('|')}\n${JSON.stringify(prompts)}\n${randomUUID()}`).digest('hex').slice(0, 32)}`;
  // A caller-supplied idempotency key represents one durable asset attempt
  // across checkpoint/resume. Route that key to the same registered worker on
  // every process invocation so a resume can actually replay the worker-local
  // idempotency record instead of creating a duplicate on another account.
  let preferredClientIds = options._preferredClientIds;
  if (!preferredClientIds?.length && options.idempotencyKey?.trim()) {
    const registered = await listRegisteredIsolatedFlowWorkerIds();
    if (registered.length) {
      preferredClientIds = [stableFlowWorkerPreference(options.idempotencyKey.trim(), registered)];
    }
  }
  let preserveExistingOutcome = Boolean(options._allowUnavailablePreferred || options._uncertainReplayAttempt);
  if (options.idempotencyKey?.trim() && !options._uncertainReplayAttempt && !options._excludedClientIds?.length && preferredClientIds?.length === 1) {
    const routed = await rerouteStableAssetFromUnavailableWorker(options.idempotencyKey.trim(), preferredClientIds, options.signal, options.onProgress, !options._preferredClientIds?.length);
    preferredClientIds = routed.clientIds;
    preserveExistingOutcome ||= routed.preserveExistingOutcome;
  }
  // Waiting in AutoSub's local queue must not consume the provider timeout.
  // A sticky resume waits for its original worker to reconnect instead of
  // silently moving an outcome-unknown request to another Google account.
  const stickyWaitMs = flowImageSlotWaitMs(options._slotAcquireTimeoutMs, preserveExistingOutcome);
  const assetKey = !preserveExistingOutcome && isStableAutoSubAssetKey(options.idempotencyKey) ? options.idempotencyKey : undefined;
  const slot = await acquireFlowImageSlot(options.signal, preferredClientIds, options._excludedClientIds, stickyWaitMs, preserveExistingOutcome, assetKey);
  // Stable asset identity belongs to AutoSub, while Flow Agent idempotency stores
  // are worker-local. New attempts therefore use a deterministic worker-scoped
  // key; legacy root-key records remain readable/replayable for compatibility.
  const workerRequestKey = (await readAutoSubAssetRecord(slot.clientId || '', idempotencyKey)).key;
  // Let a slow Google generation finish. A replay after an uncertain transport
  // timeout uses a shorter watchdog because it must only recover the already
  // submitted idempotent request, not spend another full generation window.
  const requestTimeoutMs = options._requestTimeoutMs || FLOW_IMAGE_REQUEST_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(requestTimeoutMs);
  const requestSignal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  let slotReleased = false;
  let referenceRepairAttempted = false;
  try {
    const requestBase = await flowBaseUrlForClient(slot.clientId);
    await ensureGenerationFlowSession(requestSignal);
    // Upload the recurring reference once per linked account, then reuse that
    // account-scoped media ID for every storyboard beat. This avoids sending a
    // 1-2 MB base64 image through Flow Agent for every generation while still
    // keeping media IDs isolated between Google sessions.
    const referenceImagePaths = [...new Set([options.referenceImagePath, ...(options.referenceImagePaths || [])].filter((item): item is string => Boolean(item)))];
    let referenceMediaIds = await Promise.all(referenceImagePaths.map((reference) => uploadReference(reference, requestSignal, slot.clientId)));
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
      ...(referenceMediaIds.length ? { ref_media_ids: referenceMediaIds } : {}),
    });
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
      }), requestSignal, slot.clientId, (attempt) => attempt === 1 ? retryIdempotencyKey : baseKey, options.onProgress);
    };
    try {
      let result;
      try {
        result = await submit(workerRequestKey);
      } catch (error) {
        if (!referenceImagePaths.length || !staleFlowReferenceError(error)) throw error;
        referenceRepairAttempted = true;
        // Media IDs are scoped to the targeted Google account and can become
        // stale after a tab/session reset. Repair only this account's cached ID,
        // upload the reference with a fresh agent-side cache key, then retry the
        // same storyboard image once before failing over to another account.
        await Promise.all(referenceImagePaths.map((reference) => invalidateReferenceUpload(reference, slot.clientId)));
        referenceMediaIds = await Promise.all(referenceImagePaths.map((reference) => uploadReference(reference, requestSignal, slot.clientId)));
        result = await submit(`${workerRequestKey}-refrepair-${randomUUID().replace(/-/g, '').slice(0, 10)}`);
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
    noteFlowImageSuccess(slot);
    return results.map(({ bytes }) => ({ model: options.model || 'narwhal', bytes: bytes.length }));
  } catch (error) {
    // A processing record that outlived the provider watchdog can no longer
    // hold the whole storyboard indefinitely. First query one healthy alternate
    // with the same asset key (worker-local idempotency can recover a result
    // already present there); if absent, allow exactly one replacement request.
    if (error instanceof FlowSessionError && error.code === 'FLOW_RECONCILIATION_EXHAUSTED') {
      const handoffAttempt = options._staleOutcomeHandoffAttempt || 0;
      if (slot.clientId && handoffAttempt < FLOW_IMAGE_STALE_HANDOFF_LIMIT) {
        const alternates = (await listReadyIsolatedFlowWorkers().catch(() => []))
          .filter((worker) => worker.clientId !== slot.clientId && !(options._excludedClientIds || []).includes(worker.clientId));
        if (alternates.length) {
          releaseFlowImageSlot(slot);
          slotReleased = true;
          invalidateFlowClientPool();
          const nextWorkerIds = alternates.map((worker) => worker.clientId);
          await options.onProgress?.(`Flow chưa trả kết quả từ worker ${slot.clientId.replace(/^account-/, '').slice(0, 8)} · đang kiểm tra một lần trên worker khỏe khác, giữ ảnh đã xong`);
          console.warn(`[Flow pool] stale image outcome on ${slot.clientId}; one bounded handoff to another ready worker`);
          return generateGoogleFlowImages(prompt, outputFiles, {
            ...options,
            _preferredClientIds: nextWorkerIds,
            _excludedClientIds: [...new Set([...(options._excludedClientIds || []), slot.clientId])],
            _allowUnavailablePreferred: false,
            _uncertainReplayAttempt: 0,
            _staleOutcomeHandoffAttempt: handoffAttempt + 1,
            _requestTimeoutMs: FLOW_IMAGE_REQUEST_TIMEOUT_MS,
          });
        }
      }
      throw error;
    }
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
    const detail = error instanceof Error ? error.message : String(error);
    const timedOut = deadline.aborted && !options.signal?.aborted;
    let uncertainOutcome = timedOut
      || error instanceof FlowSessionError && ['FLOW_GENERATION_OUTCOME_UNKNOWN', 'FLOW_FETCH_FAILED'].includes(error.code)
      || /Flow Agent HTTP 5\d\d/i.test(detail);
    if (!uncertainOutcome && slot.clientId) {
      const durableOutcome = await readFlowWorkerIdempotencyRecord(slot.clientId, workerRequestKey);
      if (durableOutcome?.state === 'processing' || durableOutcome?.state === 'succeeded') {
        uncertainOutcome = true;
        await options.onProgress?.(`Flow đã ghi nhận ảnh trên worker ${slot.clientId.replace(/^account-/, '').slice(0, 8)} · đang đối soát cùng khóa để tránh tạo trùng`);
      }
    }
    const transient = uncertainOutcome || /failed to fetch|FLOW_FETCH_FAILED|CAPTCHA_TIMEOUT|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|socket|network|cổng 8001|Flow Agent HTTP 5\d\d/i.test(detail);
    const sessionScopedFailure = error instanceof FlowSessionError && [
      'CAPTCHA_FAILED',
      'FLOW_EXTENSION_PERMISSION',
      'FLOW_SCRIPT_NOT_READY',
      'NO_FLOW_KEY',
      'FLOW_EXTENSION_NOT_CONNECTED',
      'FLOW_SESSION_REFRESH_FAILED',
      'FLOW_LOCAL_WORKER_UNAVAILABLE',
    ].includes(error.code);
    const explicitlyRateLimited = /(?:Flow Agent HTTP 429|HTTP 429|Google Flow.*(?:rate.?limit|giới hạn))/i.test(detail);
    const unusualActivity = /PUBLIC_ERROR_UNUSUAL_ACTIVITY|reCAPTCHA evaluation failed[^\n]*unusual activity/i.test(detail);
    const trafficThrottled = /PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC|TOO_MUCH_TRAFFIC/i.test(detail);
    // Google batchexecute upstream rejection (["er",...,400] / af.httprm):
    // known-not-dispatched — Google refused before generating, so failing over
    // to another healthy worker with its own worker-scoped key is safe.
    const upstreamRejected = /af\.httprm|\["er",null,null,null,null,400/i.test(detail);
    const definitelyNotDispatched = /ECONNREFUSED|connection refused|connect call failed|không mở được port|không khởi động lại được local runtime/i.test(detail) || upstreamRejected;
    const rejectedStaleReference = referenceRepairAttempted && staleFlowReferenceError(error);

    if (unusualActivity || trafficThrottled) {
      // A CAPTCHA reputation rejection is not a dead worker. Pause generation
      // across the browser pool, then resume through the one-request profile gate.
      flowImageRecoveringFromTraffic = true;
      flowImageTrafficRecoverySuccesses = 0;
      flowImageSuccessStreak = 0;
      if (trafficThrottled) {
        if (Date.now() >= flowImageTrafficThrottleUntil) flowImageTrafficRounds += 1;
      }
      const pauseMs = trafficThrottled ? Math.min(600_000, FLOW_IMAGE_TRAFFIC_COOLDOWN_MS * 2 ** Math.max(0, flowImageTrafficRounds - 1)) : FLOW_IMAGE_CLIENT_UNUSUAL_ACTIVITY_COOLDOWN_MS;
      flowImageTrafficThrottleUntil = Math.max(flowImageTrafficThrottleUntil, Date.now() + pauseMs);
      flowImagePoolPauseCode = trafficThrottled ? 'FLOW_IMAGE_TRAFFIC_THROTTLED' : 'FLOW_IMAGE_RECAPTCHA_BLOCKED';
      flowImagePoolPauseMessage = trafficThrottled
        ? 'Google Flow trả về reCAPTCHA TOO_MUCH_TRAFFIC.'
        : 'Google Flow trả về reCAPTCHA unusual activity.';
      noteFlowImagePressure(trafficThrottled ? 'Google reCAPTCHA too much traffic' : 'Google reCAPTCHA unusual activity', true, pauseMs);
      // Every queued task must observe the rejection so the director can
      // finish checkpointing. Waking one leaves the remaining tasks stranded.
      while (flowImageWaiters.length) wakeFlowImageWaiter();
      throw flowImagePoolPauseError();
    }

    const failoverAttempt = options._failoverAttempt || 0;
    const extensionDisconnected = error instanceof FlowSessionError && error.code === 'FLOW_EXTENSION_NOT_CONNECTED';
    const accountSessionUnavailable = error instanceof FlowSessionError && ['NO_FLOW_KEY', 'FLOW_SESSION_REFRESH_FAILED'].includes(error.code);
    const registeredClientIds = await listRegisteredIsolatedFlowWorkerIds().catch(() => [] as string[]);
    const knownClientIds = [...new Set([...flowClientCache.ids, ...registeredClientIds, slot.clientId || ''].filter(Boolean))];
    const excludedClientIds = [...new Set([...(options._excludedClientIds || []), ...(slot.clientId ? [slot.clientId] : [])])];
    // FLOW_EXTENSION_NOT_CONNECTED is known-not-dispatched: the local worker has
    // no browser bridge, so Google never received this request. It is safe to
    // try another healthy worker. Do NOT kill/restart the local Flow Agent here:
    // the process owns late-response metadata needed to reconcile generations
    // that were already dispatched before a bridge bounce. The extension's
    // reconnect loop is responsible for healing the transport in place.
    // Missing/rejected account credentials are known-not-dispatched: NO_FLOW_KEY
    // is returned before the browser sends the image, and refresh failure follows
    // a rejected 402/NO_FLOW_KEY response. Skip that account and try the rest of
    // the pool; keep uncertain outcomes pinned to their original idempotency key.
    const failoverLimit = Math.max(0, knownClientIds.length - 1);
    const remainingClientIds = knownClientIds.filter((clientId) => !excludedClientIds.includes(clientId));
    // Never decide failover from flowIsolatedReadyCount/flowClientCache here:
    // those are snapshots and can briefly collapse while a worker is timing out.
    // A retry must release the broken lane, force a fresh health discovery, then
    // let acquireFlowImageSlot wait for another healthy account to become free.
    const canFailover = Boolean(slot.clientId)
      && failoverAttempt < failoverLimit
      && !uncertainOutcome
      && (sessionScopedFailure || explicitlyRateLimited || definitelyNotDispatched || rejectedStaleReference);

    if (slot.clientId && (transient || sessionScopedFailure) && !uncertainOutcome) {
      if (error instanceof FlowSessionError && ['NO_FLOW_KEY', 'FLOW_SESSION_REFRESH_FAILED'].includes(error.code)) {
        markFlowImageSessionUnavailable(slot.clientId);
      }
      const sessionCooldownMs = error instanceof FlowSessionError
        ? error.code === 'NO_FLOW_KEY'
          ? 90_000
          : error.code === 'FLOW_SESSION_REFRESH_FAILED'
            ? FLOW_IMAGE_SESSION_FAILURE_COOLDOWN_MS
          : error.code === 'CAPTCHA_FAILED'
            ? 45_000
            : error.code === 'FLOW_EXTENSION_NOT_CONNECTED'
              ? 120_000
              : 30_000
        : FLOW_IMAGE_CLIENT_TRANSIENT_COOLDOWN_MS;
      cooldownFlowImageClient(slot.clientId, sessionCooldownMs);
      invalidateFlowClientPool();
    }

    if (slot.clientId && upstreamRejected && !uncertainOutcome) {
      const streak = (flowImageUpstream400StreakByClient.get(slot.clientId) || 0) + 1;
      flowImageUpstream400StreakByClient.set(slot.clientId, streak);
      if (streak >= FLOW_IMAGE_UPSTREAM_400_LIMIT) {
        flowImageUpstream400StreakByClient.delete(slot.clientId);
        cooldownFlowImageClient(slot.clientId, FLOW_IMAGE_UPSTREAM_400_COOLDOWN_MS);
        invalidateFlowClientPool();
        await options.onProgress?.(`Flow worker ${slot.clientId.replace(/^account-/, '').slice(0, 8)} bị Google từ chối ${streak} ảnh liên tiếp · cho nghỉ ${Math.round(FLOW_IMAGE_UPSTREAM_400_COOLDOWN_MS / 60000)} phút · mở tab Flow của account này bấm Reload để hồi sớm · giữ nguyên ảnh đã xong`);
        console.warn(`[Flow pool] circuit-break ${slot.clientId} after ${streak} consecutive upstream er/400; cooldown ${FLOW_IMAGE_UPSTREAM_400_COOLDOWN_MS}ms`);
      }
    }

    if (canFailover) {
      releaseFlowImageSlot(slot);
      slotReleased = true;
      if (accountSessionUnavailable && slot.clientId && registeredClientIds.includes(slot.clientId)) {
        refreshFlowClientInBackground(slot.clientId);
      }
      await options.onProgress?.(`Flow worker ${slot.clientId?.replace(/^account-/, '').slice(0, 8) || 'không rõ'} lỗi phiên/kết nối · đang chuyển ảnh sang worker khác (${failoverAttempt + 1}/${failoverLimit}) · giữ nguyên ảnh đã xong`);
      console.warn(`[Flow pool] failover ${failoverAttempt + 1}/${failoverLimit}: ${slot.clientId} -> worker khác vì ${timedOut ? 'timeout' : rejectedStaleReference ? 'stale reference media ID' : detail.slice(0, 100)}`);
      return generateGoogleFlowImages(prompt, outputFiles, {
        ...options,
        idempotencyKey,
        _preferredClientIds: remainingClientIds,
        _failoverAttempt: failoverAttempt + 1,
        _excludedClientIds: excludedClientIds,
        _slotAcquireTimeoutMs: extensionDisconnected || accountSessionUnavailable || definitelyNotDispatched
          ? Math.min(FLOW_IMAGE_FAILOVER_SLOT_WAIT_MS, 15_000) : FLOW_IMAGE_FAILOVER_SLOT_WAIT_MS,
      });
    }

    if (uncertainOutcome) {
      const replayAttempt = options._uncertainReplayAttempt || 0;
      if (slot.clientId && replayAttempt < FLOW_IMAGE_UNCERTAIN_REPLAY_LIMIT) {
        // The outcome is unknown, so never move this request to another Google
        // account. Release only the local scheduler lane, then ask the SAME
        // worker for the SAME idempotency key. Flow Agent can replay its stored
        // result without spending another generation or producing a duplicate.
        releaseFlowImageSlot(slot);
        slotReleased = true;
        invalidateFlowClientPool();
        const replayDelayMs = FLOW_IMAGE_UNCERTAIN_REPLAY_DELAY_MS * Math.max(1, replayAttempt + 1);
        if (replayDelayMs) await wait(replayDelayMs, options.signal);
        console.warn(`[Flow pool] uncertain outcome on ${slot.clientId}; idempotent replay ${replayAttempt + 1}/${FLOW_IMAGE_UNCERTAIN_REPLAY_LIMIT} on the same worker`);
        return generateGoogleFlowImages(prompt, outputFiles, {
          ...options,
          idempotencyKey,
          _preferredClientIds: [slot.clientId],
          _excludedClientIds: (options._excludedClientIds || []).filter((clientId) => clientId !== slot.clientId),
          _allowUnavailablePreferred: true,
          _uncertainReplayAttempt: replayAttempt + 1,
          _slotAcquireTimeoutMs: Math.max(FLOW_IMAGE_FAILOVER_SLOT_WAIT_MS, 60_000),
          _requestTimeoutMs: FLOW_IMAGE_UNCERTAIN_REPLAY_TIMEOUT_MS,
        });
      }
      if (slot.clientId) {
        cooldownFlowImageClient(slot.clientId, FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS);
        invalidateFlowClientPool();
      }
      noteFlowImagePressure(slot.clientId ? `timeout ${slot.clientId}` : 'timeout', true);
      throw new FlowSessionError(`Flow Agent vẫn chưa xác nhận kết quả sau các lượt replay an toàn${slot.clientId ? ` trên ${slot.clientId}` : ''}. AutoSub giữ checkpoint và không chuyển request sang tài khoản khác để tránh tạo trùng.`, 'FLOW_GENERATION_OUTCOME_UNKNOWN');
    }
    if (transient) noteFlowImagePressure(detail.slice(0, 120), /cổng 8001|ECONNREFUSED|ECONNRESET|timeout/i.test(detail));
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
  return /could not revalidate(?: history)? media id|media not found in history\.json|upload or generate it again|media_id=.*not found/i.test(detail);
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

export function stableFlowUploadReference(uploaded: { media_id?: string; url?: string }, uploadBase: string, isolated: boolean) {
  // The isolated Agent replaces media_id when it recovers an expired upload,
  // but retains the history filename. Resolve that stable handle on each use.
  if (isolated && uploaded.url) {
    try {
      const url = new URL(uploaded.url, `${uploadBase}/`);
      if (url.origin === new URL(uploadBase).origin && /^\/download\/[^/]+$/.test(url.pathname)) {
        const filename = decodeURIComponent(url.pathname.slice('/download/'.length));
        if (/^upload_[\w.-]+\.(png|jpe?g|webp)$/i.test(filename)) return filename;
      }
    } catch { /* Older or remote Agents may only supply a media ID. */ }
  }
  return uploaded.media_id;
}

async function uploadReference(filePath: string, signal?: AbortSignal, clientId?: string) {
  const { bytes, key } = await referenceCacheKey(filePath, clientId);
  const cached = flowReferenceUploads.get(key);
  if (cached) {
    const mediaId = await cached;
    // Isolated uploads use stable history filenames; the owning Agent resolves
    // the current remote ID. Never look them up in another account's history.
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
    const uploadBytes = scopeLinkedReferenceBytes(bytes, referenceMimeType(bytes), clientId || 'default', randomUUID());
    const body = JSON.stringify({ image_base64: uploadBytes.toString('base64') });
    const uploaded = await requestWithSessionRecovery<{ media_id?: string; url?: string }>(() => fetch(`${uploadBase}/v1/upload`, {
      method: 'POST', signal: uploadSignal,
      headers: { ...headers(true), ...(clientId ? { 'X-Client-Id': clientId } : {}) },
      body,
    }), uploadSignal, clientId);
    if (!uploaded.media_id) throw new Error('Flow Agent không trả về media_id cho ảnh tham chiếu.');
    flowReferenceValidatedAt.set(key, Date.now());
    return stableFlowUploadReference(uploaded, uploadBase, Boolean(clientId && await isolatedFlowWorkerBase(clientId)))!;
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
  const clients = discovered.filter(Boolean)
    .slice(0, Math.max(1, Math.min(FLOW_REFERENCE_PREWARM_MAX, requestedClients)));
  if (!clients.length) throw new FlowSessionError('Không có tài khoản Flow nào sẵn sàng để đồng bộ ảnh tham chiếu.', 'NO_FLOW_KEY');
  const startedAt = Date.now();
  const ready: Array<{ clientId: string; mediaId: string }> = [];
  const failed: Array<{ clientId: string; error: string }> = [];
  // Reference uploads also mint captcha tokens and share the same browser/WAF
  // reputation. Uploading to all 9 accounts in one burst caused bridge churn
  // before generation even started. Keep a small bounded prewarm pool.
  const prewarmConcurrency = Math.max(1, Math.min(FLOW_REFERENCE_PREWARM_CONCURRENCY, clients.length));
  let cursor = 0;
  await Promise.all(Array.from({ length: prewarmConcurrency }, async (_, lane) => {
    while (true) {
      const index = cursor++;
      if (index >= clients.length) return;
      const clientId = clients[index];
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 250 * Math.min(3, lane + 1)));
      try {
        const mediaId = await uploadReference(referenceImagePath, signal, clientId);
        flowImageCooldownUntilByClient.delete(clientId);
        ready.push({ clientId, mediaId });
      } catch (error) {
        cooldownFlowImageClient(clientId, FLOW_IMAGE_CLIENT_TIMEOUT_COOLDOWN_MS);
        failed.push({ clientId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));
  if (!ready.length) throw new Error(`Không đồng bộ được ảnh tham chiếu lên ${clients.length} tài khoản Flow: ${failed[0]?.error || 'không rõ lỗi'}`);
  return { attempted: clients.length, ready, failed, elapsedMs: Date.now() - startedAt };
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(new DOMException('Đã dừng tác vụ.', 'AbortError')); return; }
  const abort = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    reject(new DOMException('Đã dừng tác vụ.', 'AbortError'));
  };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

export async function generateGoogleFlowVideo(prompt: string, outputFile: string, model: FlowVideoModel = 'Flow Agent Auto', _credentials?: unknown, references: FlowVideoReferences = {}, aspectRatio: FlowVideoAspectRatio = '9:16', signal?: AbortSignal, _browserRequired = false) {
  const startImagePath = references.startImagePath?.trim();
  const referenceImagePaths = (references.referenceImagePaths || []).filter(Boolean);
  if (startImagePath && referenceImagePaths.length) {
    throw new Error('Flow Agent không hỗ trợ đồng thời khung bắt đầu và ảnh reference trong cùng một lượt tạo.');
  }
  await validateGoogleFlowSession(undefined, signal, { requireBearer: true });
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
