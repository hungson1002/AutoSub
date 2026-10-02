import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('a traffic rejection releases all 18 queued tasks and enters single-request recovery', async () => {
  process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_START_GAP_MS = '0';
  process.env.AUTOSUB_FLOW_IMAGE_START_GAP_MS = '0';
  process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = '0';
  process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS = '0';
  const { generateGoogleFlowImage, getGoogleFlowImagePoolRuntimeStats } = await import('./googleFlow');
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-traffic-recovery-'));
  let recoveryClock = 0;
  const recoveryActive: number[] = [];
  const clients = Array.from({ length: 9 }, (_, index) => ({ client_id: `queue-account-${index}`, state: 'idle', has_flow_key: true, ok: true, credits: 100 }));
  let release!: () => void;
  const wave = new Promise<void>((resolve) => { release = resolve; });
  let submitted = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients });
    if (url.endsWith('/v1/credits')) return Response.json({ clients });
    if (url.endsWith('/v1/images/generations')) {
      submitted += 1;
      await wave;
      if (recoveryClock) {
        recoveryActive.push(getGoogleFlowImagePoolRuntimeStats().active);
        recoveryClock += 10_000;
        return Response.json({ data: [{ b64_json: Buffer.alloc(128, 1).toString('base64') }] });
      }
      return Response.json({ detail: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC' }, { status: 400 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const pending = Promise.allSettled(Array.from({ length: 18 }, (_, index) => generateGoogleFlowImage(`Queued image ${index}`, `unused-traffic-${index}.png`, { signal: controller.signal })));
  try {
    const cap = getGoogleFlowImagePoolRuntimeStats().cap;
    for (let i = 0; i < 300 && submitted < cap; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(submitted, cap);
    release();
    const results = await pending;
    assert.equal(controller.signal.aborted, false, 'queued tasks must drain without requiring an abort');
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason.code === 'FLOW_IMAGE_TRAFFIC_THROTTLED'));
    assert.equal(submitted, cap, 'no queued image or alternate account is dispatched after the rejection');
    assert.equal(getGoogleFlowImagePoolRuntimeStats().active, 0);
    assert.equal(getGoogleFlowImagePoolRuntimeStats().cap, 1);
    // Advance only the wall clock past the cooldown; all six calls still go
    // through the real scheduler, slot acquisition, and result persistence.
    recoveryClock = originalNow() + 600_001;
    Date.now = () => recoveryClock;
    await Promise.all(Array.from({ length: 6 }, (_, index) => generateGoogleFlowImage(`Recovery ${index}`, path.join(directory, `${index}.png`), { signal: controller.signal })));
    assert.deepEqual(recoveryActive, [1, 1, 1, 1, 1, 1]);
    assert.equal(getGoogleFlowImagePoolRuntimeStats().cap, 1);
  } finally {
    Date.now = originalNow;
    controller.abort();
    release();
    await pending;
    clearTimeout(timeout);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});
