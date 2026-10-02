export type StoryboardFlowWorkItem = {
  taskIndex: number;
  task: { sceneIndex: number; beatIndex: number };
};

// Only the scene's first image is a dependency. Once checkpointed, sibling
// shots share that anchor and can fill every available provider lane.
export function createStoryboardSceneGate(restoredScenes: number[] = []) {
  const anchors = new Map<number, Promise<void>>(restoredScenes.map((scene) => [scene, Promise.resolve()]));
  return (scene: number) => {
    const existing = anchors.get(scene);
    if (existing) return { ready: existing, release: () => {} };
    let release!: () => void;
    anchors.set(scene, new Promise<void>((resolve) => { release = resolve; }));
    return { ready: Promise.resolve(), release };
  };
}

/**
 * Put the first beat from many scenes ahead of later beats from the same scene.
 * Each scene establishes its shared reference first; its remaining beats can
 * then run together without waiting for sibling generation or Vision QC.
 */
export function interleaveStoryboardFlowWork<T extends StoryboardFlowWorkItem>(items: T[]) {
  return [...items].sort((a, b) =>
    a.task.beatIndex - b.task.beatIndex
    || a.task.sceneIndex - b.task.sceneIndex
    || a.taskIndex - b.taskIndex
  );
}

/**
 * Flow generation itself is hard-capped by googleFlow.ts. Extra pipeline
 * workers keep that pool fed while completed images are waiting on Vision QC.
 */
export function isolatedFlowPipelineWorkerCount(maxConcurrency: number, pendingItems: number) {
  const max = Math.max(1, Math.floor(Number(maxConcurrency) || 1));
  const pending = Math.max(0, Math.floor(Number(pendingItems) || 0));
  return Math.min(pending, max * 2);
}

export type FlowWorkerRecoveryKind = 'reroute' | 'reconcile';

/**
 * Keep recoverable worker/session failures in the active image queue. Explicit
 * Google throttling and CAPTCHA blocks use their own pool-wide policy and must
 * not be treated like a single worker disconnect.
 */
export function flowWorkerRecoveryKind(error: unknown, reconciliationAttempts = 0): FlowWorkerRecoveryKind | undefined {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; name?: unknown } : undefined;
  const code = String(value?.code || '');
  if (code === 'FLOW_RECONCILIATION_EXHAUSTED') return undefined;
  if (['FLOW_FETCH_FAILED', 'FLOW_GENERATION_OUTCOME_UNKNOWN'].includes(code)) return reconciliationAttempts < 1 ? 'reconcile' : undefined;
  if ([
    'FLOW_NO_AUTHENTICATED_WORKERS',
    'FLOW_SESSION_REFRESH_FAILED',
    'FLOW_EXTENSION_NOT_CONNECTED',
    'FLOW_AGENT_OFFLINE',
    'FLOW_AGENT_HUNG',
    'NO_FLOW_KEY',
  ].includes(code)) return 'reroute';

  const message = `${String(value?.message || error || '')} ${code}`;
  if (/FLOW_NO_HEALTHY_ALTERNATE_WORKER|FLOW_LOCAL_WORKER_UNAVAILABLE|ECONNREFUSED|ECONNRESET|FLOW_AGENT_OFFLINE|FLOW_AGENT_HUNG|FLOW_EXTENSION_NOT_CONNECTED|không mở được port|không khởi động lại được local runtime/i.test(message)) return 'reroute';
  if (/FLOW_FETCH_FAILED|FLOW_GENERATION_OUTCOME_UNKNOWN/i.test(message)) return reconciliationAttempts < 1 ? 'reconcile' : undefined;
  return undefined;
}

export function flowWorkerRetryDelayMs(attempt: number, baseMs = 1_000, maxMs = 30_000) {
  const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  const safeBase = Math.max(1, Math.floor(Number(baseMs) || 1));
  const safeMax = Math.max(safeBase, Math.floor(Number(maxMs) || safeBase));
  return Math.min(safeMax, safeBase * 2 ** Math.min(30, safeAttempt - 1));
}
