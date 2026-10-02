import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Flow image requests stay single-flight across accounts and honor a global start interval', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-pacing-'));
  const originalWorkdir = process.env.AUTOSUB_WORKDIR;
  process.env.AUTOSUB_WORKDIR = directory;
  process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_START_GAP_MS = '100';
  process.env.AUTOSUB_FLOW_IMAGE_START_GAP_MS = '100';
  process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = '100';
  process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS = '100';
  const { generateGoogleFlowImage, getGoogleFlowImagePoolRuntimeStats } = await import('./googleFlow');
  const originalFetch = globalThis.fetch;
  const clients = Array.from({ length: 3 }, (_, index) => ({ client_id: `paced-${index}`, state: 'idle', has_flow_key: true, ok: true, credits: 100 }));
  const starts: Array<{ at: number; account: string }> = [];
  let active = 0;
  let peakActive = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients });
    if (url.endsWith('/v1/credits')) return Response.json({ clients });
    if (url.endsWith('/v1/images/generations')) {
      active += 1;
      peakActive = Math.max(peakActive, active);
      starts.push({ at: Date.now(), account: String((init?.headers as Record<string, string>)['X-Client-Id']) });
      await new Promise((resolve) => setTimeout(resolve, 160));
      active -= 1;
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 1).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await Promise.all(Array.from({ length: 3 }, (_, index) => generateGoogleFlowImage(`Image ${index}`, path.join(directory, `${index}.png`))));
    assert.equal(starts.length, 3);
    assert.equal(peakActive, 1, 'different linked accounts must not create parallel Flow RPCs');
    for (let index = 1; index < starts.length; index++) assert.ok(starts[index].at - starts[index - 1].at >= 90);
    assert.equal(getGoogleFlowImagePoolRuntimeStats().active, 0);
    assert.equal(getGoogleFlowImagePoolRuntimeStats().active, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWorkdir === undefined) delete process.env.AUTOSUB_WORKDIR;
    else process.env.AUTOSUB_WORKDIR = originalWorkdir;
    await rm(directory, { recursive: true, force: true });
  }
});
