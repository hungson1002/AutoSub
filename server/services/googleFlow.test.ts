import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import sharp from 'sharp';
// Pacing has its own test; transport fixtures should not depend on wall time.
process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_UNCERTAIN_REPLAY_DELAY_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS = '1';
const flowTestWorkdir = await mkdtemp(path.join(tmpdir(), 'autosub-google-flow-workdir-'));
process.env.AUTOSUB_WORKDIR = flowTestWorkdir;
after(async () => rm(flowTestWorkdir, { recursive: true, force: true }));
const { stableFlowUploadReference, flowImageSlotWaitMs, flowAgentStatus, generateGoogleFlowImage, generateGoogleFlowImages, generateGoogleFlowVideo, validateGoogleFlowSession, nextStableIsolatedImageCap } = await import('./googleFlow');

test('stable upload handles stay local to isolated workers and fall back for legacy or external URLs', () => {
  const base = 'http://127.0.0.1:8198';
  assert.equal(stableFlowUploadReference({ media_id: 'old', url: `${base}/download/upload_123_a.jpg` }, base, true), 'upload_123_a.jpg');
  for (const url of ['https://external.example/download/upload_123_a.jpg', '/download/unknown.png', '/download/upload_123_%2Fother.png', '%']) {
    assert.equal(stableFlowUploadReference({ media_id: 'old', url }, base, true), 'old');
  }
  assert.equal(stableFlowUploadReference({ media_id: 'old', url: '/download/upload_123_a.jpg' }, base, false), 'old');
  assert.equal(stableFlowUploadReference({ media_id: 'old' }, base, true), 'old');
});

test('safe worker handoff keeps its short slot deadline; only unresolved outcomes keep the sticky wait', () => {
  assert.equal(flowImageSlotWaitMs(15_000, false), 15_000);
  assert.equal(flowImageSlotWaitMs(undefined, false), undefined);
  assert.equal(flowImageSlotWaitMs(15_000, true), 60_000);
  assert.equal(flowImageSlotWaitMs(180_000, true), 180_000);
});

test('Flow pool cannot adapt above the profile-wide single-request cap', () => {
  assert.equal(nextStableIsolatedImageCap(1, 1, 9), 1);
  assert.equal(nextStableIsolatedImageCap(1, 1, 3), 1);
});

for (const failure of ['NO_FLOW_KEY', 'Request had invalid authentication credentials. Expected OAuth 2 access token']) test(`${failure} refreshes the active browser session and retries once`, async () => {
  const originalFetch = globalThis.fetch;
  let generations = 0;
  let refreshes = 0;
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-session', ok: refreshes > 0 }] });
    if (url.endsWith('/v1/refresh-tokens')) {
      assert.equal((init?.headers as Record<string, string>)['X-Client-Id'], 'opera-session');
      refreshes++;
      return Response.json({ nudged: 1 });
    }
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    generations++;
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    if (generations === 1) return new Response(JSON.stringify({ detail: failure }), { status: 400 });
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 7).toString('base64') }] });
  };
  try {
    const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-refresh-'));
    const output = path.join(directory, 'asset.png');
    await generateGoogleFlowImage('An educational illustration', output);
    assert.equal(generations, 2);
    assert.equal(refreshes, 1);
    assert.notEqual(keys[0], keys[1]);
    await rm(directory, { recursive: true, force: true });
  } finally { globalThis.fetch = originalFetch; }
});

for (const ambiguousDetail of [
  'Failed to fetch',
  'timed out waiting for Google Flow to respond. The image may still have been generated — check labs.google/fx/tools/flow. Try again or raise API_REQUEST_TIMEOUT if this recurs.',
]) test(`ambiguous Flow response replays same idempotency key: ${ambiguousDetail.slice(0, 28)}`, async () => {
  const originalFetch = globalThis.fetch;
  let generations = 0;
  let refreshes = 0;
  const keys: string[] = [];
  const clients: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [{ client_id: 'opera-session', state: 'idle', has_flow_key: true }] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-session', ok: true, credits: 100 }] });
    if (url.endsWith('/v1/refresh-tokens')) { refreshes += 1; return Response.json({ nudged: 1 }); }
    generations += 1;
    assert.equal(url.endsWith('/v1/images/generations'), true);
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    clients.push(String((init?.headers as Record<string, string>)?.['X-Client-Id'] || ''));
    if (generations === 1) return new Response(JSON.stringify({ detail: ambiguousDetail }), { status: 400 });
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 9).toString('base64') }] });
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-fetch-recovery-'));
  try {
    await generateGoogleFlowImage('A connected educational illustration', path.join(directory, 'asset.png'));
    assert.equal(generations, 2);
    assert.equal(refreshes, 0);
    assert.equal(keys[0], keys[1], 'uncertain replay must reuse the exact same idempotency key');
    assert.deepEqual(clients, ['opera-session', 'opera-session']);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('an already-processing image retries on the same worker with the same idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const keys: string[] = [];
  const clients: string[] = [];
  let generations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [{ client_id: 'flow-409-worker', state: 'idle', has_flow_key: true }] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'flow-409-worker', ok: true, credits: 100 }] });
    assert.ok(url.endsWith('/v1/images/generations'));
    generations += 1;
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    clients.push(String((init?.headers as Record<string, string>)?.['X-Client-Id'] || ''));
    if (generations <= 2) {
      return new Response(JSON.stringify({ detail: 'This idempotent image generation is already processing; retry with the same key.' }), { status: 409 });
    }
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 6).toString('base64') }] });
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-idempotency-409-'));
  try {
    await generateGoogleFlowImage('A clear educational illustration', path.join(directory, 'asset.png'), { idempotencyKey: 'same-processing-request', _preferredClientIds: ['flow-409-worker'] });
    assert.equal(generations, 3);
    assert.deepEqual(keys, ['same-processing-request', 'same-processing-request', 'same-processing-request']);
    assert.deepEqual(clients, ['flow-409-worker', 'flow-409-worker', 'flow-409-worker']);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('slow Flow images keep replaying 409 beyond the former 24-retry cutoff', async () => {
  const originalFetch = globalThis.fetch;
  const keys: string[] = [];
  let generations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [{ client_id: 'flow-slow-worker', state: 'idle', has_flow_key: true }] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'flow-slow-worker', ok: true, credits: 100 }] });
    assert.ok(url.endsWith('/v1/images/generations'));
    generations += 1;
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    if (generations <= 25) {
      return Response.json({ detail: 'This idempotent image generation is already processing; retry with the same key.' }, { status: 409 });
    }
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 13).toString('base64') }] });
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-slow-409-'));
  try {
    await generateGoogleFlowImage('A slow educational illustration', path.join(directory, 'asset.png'), { idempotencyKey: 'slow-production-asset', _preferredClientIds: ['flow-slow-worker'] });
    assert.equal(generations, 26);
    assert.equal(new Set(keys).size, 1, 'replays must keep the original durable key');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing captcha script preserves the session and does not retry generation', async () => {
  const originalFetch = globalThis.fetch;
  let generations = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ ok: true }] });
    assert.ok(url.endsWith('/v1/images/generations'), 'Must not refresh tokens for a script error');
    generations++;
    return Response.json({ detail: 'CAPTCHA_FAILED: grecaptcha not available' }, { status: 400 });
  };
  try {
    await assert.rejects(generateGoogleFlowImage('test', 'unused.png'), /grecaptcha not available/);
    assert.equal(generations, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent status requires backend, extension and Flow key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/v1/credits') ? { clients: [{ ok: true }] } : { status: 'healthy', extension_connected: true, has_flow_key: true, transport: 'extension' }), { status: 200 });
  try {
    const status = await flowAgentStatus();
    assert.equal(status.installed, true);
    assert.equal(status.connected, true);
    assert.equal(status.transport, 'extension');
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent status does not mistake an unreliable credits probe for session health', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    throw new Error('Status must use only the health endpoint');
  };
  try {
    assert.equal((await flowAgentStatus()).connected, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent status accepts ready linked accounts when legacy primary has no token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/health')) return Response.json({
      status: 'unauthorized_or_disconnected', extension_connected: true, has_flow_key: false,
      clients: [
        { client_id: 'account-one', state: 'idle', has_flow_key: true },
        { client_id: 'legacy-primary', state: 'idle', has_flow_key: false },
      ],
    });
    throw new Error(`Unexpected request: ${String(input)}`);
  };
  try {
    const status = await flowAgentStatus();
    assert.equal(status.connected, true);
    assert.equal(status.hasFlowKey, true);
    await validateGoogleFlowSession();
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent preflight explains a missing extension', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'starting', extension_connected: false, has_flow_key: false }), { status: 200 });
  try {
    await assert.rejects(validateGoogleFlowSession(), /Extension Flow Agent chưa kết nối/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent preflight automatically captures a missing token before generation', async () => {
  const originalFetch = globalThis.fetch;
  let refreshed = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: refreshed ? 'healthy' : 'unauthorized_or_disconnected', extension_connected: true, has_flow_key: refreshed });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-session', ok: refreshed }] });
    if (url.endsWith('/v1/refresh-tokens')) {
      const requestHeaders = init?.headers as Record<string, string>;
      assert.equal(requestHeaders['X-Client-Id'], 'opera-session');
      assert.equal(requestHeaders['X-Force-Refresh'], '1');
      refreshed = true;
      return Response.json({ nudged: 1 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await validateGoogleFlowSession();
    assert.equal(refreshed, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent image generation stores returned base64 image', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-image-'));
  const output = path.join(directory, 'asset.png');
  let requestCount = 0;
  globalThis.fetch = async (_input, init) => {
    const url = String(_input);
    if (url.endsWith('/v1/credits')) return new Response(JSON.stringify({ clients: [{ ok: true }] }));
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'healthy', extension_connected: true, has_flow_key: true }), { status: 200 });
    requestCount += 1;
    const body = JSON.parse(String(init?.body || '{}')) as { model?: string; response_format?: string };
    assert.equal(body.model, 'narwhal');
    assert.equal(body.response_format, 'remote_url');
    return new Response(JSON.stringify({ data: [{ b64_json: Buffer.alloc(128, 7).toString('base64') }] }), { status: 200 });
  };
  try {
    await generateGoogleFlowImage('A clean product background', output);
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow image generation uploads a recurring reference only once and reuses its media id', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-reference-cache-'));
  const reference = path.join(directory, 'character.png');
  const first = path.join(directory, 'first.png');
  const second = path.join(directory, 'second.png');
  await writeFile(reference, Buffer.alloc(257, 23));
  let uploads = 0;
  let generations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ ok: true }] });
    if (url.endsWith('/v1/upload')) { uploads += 1; return Response.json({ media_id: 'cached-character-media' }); }
    if (url.endsWith('/v1/images/generations')) {
      generations += 1;
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[]; image_base64?: string };
      assert.deepEqual(body.ref_media_ids, ['cached-character-media']);
      assert.equal(body.image_base64, undefined);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, generations).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('First shot', first, { referenceImagePath: reference });
    await generateGoogleFlowImage('Second shot', second, { referenceImagePath: reference });
    assert.equal(uploads, 1);
    assert.equal(generations, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow image generation attaches distinct mascot and supporting-character references in order', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-multiple-references-'));
  const mascot = path.join(directory, 'mascot.png');
  const cast = path.join(directory, 'cast.png');
  const output = path.join(directory, 'shot.png');
  await Promise.all([writeFile(mascot, Buffer.alloc(271, 43)), writeFile(cast, Buffer.alloc(277, 47))]);
  let uploads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ ok: true }] });
    if (url.endsWith('/v1/upload')) {
      const body = JSON.parse(String(init?.body || '{}')) as { image_base64?: string };
      const identity = Buffer.from(body.image_base64 || '', 'base64')[0] === 43 ? 'mascot-media' : 'cast-media';
      uploads += 1;
      return Response.json({ media_id: identity });
    }
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[] };
      assert.deepEqual(body.ref_media_ids, ['mascot-media', 'cast-media']);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 8).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A prehistoric hunter beside the narrator mascot', output, { referenceImagePaths: [mascot, cast] });
    assert.equal(uploads, 2);
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stale cached Flow reference is re-uploaded and repaired inside the same image attempt', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-reference-repair-'));
  const reference = path.join(directory, 'character.png');
  const output = path.join(directory, 'shot.png');
  await writeFile(reference, Buffer.alloc(263, 31));
  let uploads = 0;
  let generations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ ok: true }] });
    if (url.endsWith('/v1/upload')) {
      uploads += 1;
      return Response.json({ media_id: uploads === 1 ? 'stale-media' : 'fresh-media' });
    }
    if (url.endsWith('/v1/images/generations')) {
      generations += 1;
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[] };
      if (body.ref_media_ids?.[0] === 'stale-media') {
        return Response.json({ detail: "Media not found in history.json (media_id='stale-media'). Upload or generate it again, then retry." }, { status: 404 });
      }
      assert.deepEqual(body.ref_media_ids, ['fresh-media']);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 9).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('Recovered reference shot', output, { referenceImagePath: reference });
    assert.equal(uploads, 2);
    assert.equal(generations, 2);
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow Agent batches four image alternatives into one generation request', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-image-batch-'));
  const outputs = Array.from({ length: 4 }, (_, index) => path.join(directory, `asset-${index}.png`));
  let generationRequests = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ ok: true }] });
    generationRequests += 1;
    const body = JSON.parse(String(init?.body || '{}')) as { n?: number };
    assert.equal(body.n, 4);
    return Response.json({ data: Array.from({ length: 4 }, (_, index) => ({ b64_json: Buffer.alloc(128, index + 1).toString('base64') })) });
  };
  try {
    await generateGoogleFlowImages('Four distinct character alternatives', outputs);
    assert.equal(generationRequests, 1);
    for (let index = 0; index < outputs.length; index += 1) assert.equal((await readFile(outputs[index]))[0], index + 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('primary and linked Flow account share one profile-wide generation slot', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-account-pool-'));
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  const seen: string[] = [];
  let globalActive = 0;
  let globalPeak = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'legacy-primary', state: 'idle', has_flow_key: true },
      { client_id: 'account-aaaaaaaaaaaa', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/images/generations')) {
      const clientId = String((init?.headers as Record<string, string>)?.['X-Client-Id'] || '');
      assert.ok(clientId === 'legacy-primary' || clientId === 'account-aaaaaaaaaaaa');
      seen.push(clientId);
      const now = (active.get(clientId) || 0) + 1;
      active.set(clientId, now);
      globalActive += 1;
      globalPeak = Math.max(globalPeak, globalActive);
      peak.set(clientId, Math.max(peak.get(clientId) || 0, now));
      await new Promise((resolve) => setTimeout(resolve, 40));
      active.set(clientId, Math.max(0, (active.get(clientId) || 1) - 1));
      globalActive -= 1;
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 5).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) => generateGoogleFlowImage(
      `Parallel account shot ${index + 1}`,
      path.join(directory, `shot-${index + 1}.png`),
    )));
    assert.equal(seen.length, 4);
    assert.equal(new Set(seen).size, 2, 'healthy workers remain available for subsequent images');
    assert.equal(globalPeak, 1);
    assert.ok((peak.get('legacy-primary') || 0) <= 1);
    assert.ok((peak.get('account-aaaaaaaaaaaa') || 0) <= 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('linked Flow accounts upload and reuse account-scoped reference media ids', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-linked-reference-scope-'));
  const reference = path.join(directory, 'reference.png');
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 19, g: 47, b: 83, alpha: 1 } } }).png().toBuffer();
  await writeFile(reference, png);
  const uploads = new Map<string, number>();
  const uploadBytes = new Map<string, Buffer>();
  const generationRefs = new Map<string, string>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-one', state: 'idle', has_flow_key: true },
      { client_id: 'account-two', state: 'idle', has_flow_key: true },
    ] });
    const clientId = String((init?.headers as Record<string, string>)?.['X-Client-Id'] || '');
    if (url.endsWith('/v1/upload')) {
      assert.ok(clientId === 'account-one' || clientId === 'account-two');
      uploads.set(clientId, (uploads.get(clientId) || 0) + 1);
      const body = JSON.parse(String(init?.body || '{}')) as { image_base64?: string };
      uploadBytes.set(clientId, Buffer.from(body.image_base64 || '', 'base64'));
      return Response.json({ media_id: `media-${clientId}` });
    }
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[] };
      assert.ok(clientId === 'account-one' || clientId === 'account-two');
      assert.deepEqual(body.ref_media_ids, [`media-${clientId}`]);
      generationRefs.set(clientId, body.ref_media_ids![0]);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, generationRefs.size).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await Promise.all([
      generateGoogleFlowImage('Same reference one', path.join(directory, 'one.png'), { referenceImagePath: reference }),
      generateGoogleFlowImage('Same reference two', path.join(directory, 'two.png'), { referenceImagePath: reference }),
    ]);
    assert.equal(uploads.get('account-one'), 1);
    assert.equal(uploads.get('account-two'), 1);
    assert.equal(generationRefs.size, 2);
    assert.notEqual(generationRefs.get('account-one'), generationRefs.get('account-two'));
    assert.notDeepEqual(uploadBytes.get('account-one'), uploadBytes.get('account-two'));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stale history media IDs are re-uploaded with a fresh cache key before generation retries', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-stale-history-reference-'));
  const reference = path.join(directory, 'reference.png');
  const output = path.join(directory, 'result.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await writeFile(reference, png);
  const uploadedBytes: Buffer[] = [];
  const uploadedIds: string[] = [];
  const submittedIds: string[] = [];
  let generationCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-one', state: 'idle', has_flow_key: true },
      { client_id: 'account-two', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [
      { client_id: 'account-one', ok: true },
      { client_id: 'account-two', ok: true },
    ] });
    if (url.endsWith('/v1/upload')) {
      const body = JSON.parse(String(init?.body || '{}')) as { image_base64?: string };
      uploadedBytes.push(Buffer.from(body.image_base64 || '', 'base64'));
      const id = `history-media-${uploadedBytes.length}`;
      uploadedIds.push(id);
      return Response.json({ media_id: id });
    }
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[] };
      submittedIds.push(body.ref_media_ids?.[0] || '');
      generationCalls += 1;
      if (generationCalls === 1) {
        return new Response(JSON.stringify({ detail: `Could not revalidate history media ID ${uploadedIds[0]}: Could not revalidate media ID ${uploadedIds[0]}: Flow returned HTTP unknown` }), { status: 400 });
      }
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 8).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A clear educational illustration', output, { referenceImagePath: reference });
    assert.equal(generationCalls, 2);
    assert.equal(uploadedBytes.length, 2);
    assert.notDeepEqual(uploadedBytes[0], uploadedBytes[1]);
    assert.deepEqual(submittedIds, [uploadedIds[0], uploadedIds[1]]);
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('reference-backed idempotent image fails over after its assigned Flow session cannot refresh', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-project-reference-failover-'));
  const reference = path.join(directory, 'reference.png');
  const output = path.join(directory, 'asset.png');
  await writeFile(reference, Buffer.alloc(271, 52));
  const clients = ['account-a-stale-reference', 'account-z-healthy-reference'];
  const uploadedOn: string[] = [];
  const generatedOn: string[] = [];
  const refreshed: string[] = [];
  const idempotencyKeys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const requestHeaders = (init?.headers || {}) as Record<string, string>;
    const clientId = String(requestHeaders['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: clients.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return Response.json(clientId
      ? { _client_id: clientId, session_id: clientId, status: 200, data: { credits: 500 } }
      : { clients: clients.map((client_id) => ({ client_id, ok: true, credits: 500 })) });
    if (url.endsWith('/v1/upload')) {
      uploadedOn.push(clientId);
      return Response.json({ media_id: `${clientId}-reference` });
    }
    if (url.endsWith('/v1/refresh-tokens')) {
      refreshed.push(clientId);
      return new Response(JSON.stringify({ detail: 'The stale test session cannot refresh.' }), { status: 503 });
    }
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      idempotencyKeys.push(String(requestHeaders['Idempotency-Key'] || ''));
      if (clientId === clients[0]) return Response.json({ detail: 'NO_FLOW_KEY' }, { status: 400 });
      const body = JSON.parse(String(init?.body || '{}')) as { ref_media_ids?: string[] };
      assert.deepEqual(body.ref_media_ids, [`${clients[1]}-reference`]);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 14).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A storyboard shot using its character reference', output, {
      referenceImagePath: reference,
      idempotencyKey: 'autosub-asset-project-reference-fixture',
      _preferredClientIds: clients,
    });
    assert.deepEqual(uploadedOn, clients);
    assert.deepEqual(generatedOn, clients);
    assert.deepEqual(refreshed, [clients[0]]);
    assert.equal(idempotencyKeys[0], 'autosub-asset-project-reference-fixture');
    assert.equal(idempotencyKeys[1], idempotencyKeys[0], 'safe failover keeps the asset idempotency key across worker accounts');
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('session refresh failures rotate past multiple stale Flow workers to a healthy worker', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-session-failover-'));
  const clients = ['account-a-session-stale', 'account-b-session-stale', 'account-z-session-healthy'];
  const generatedOn: string[] = [];
  const refreshed: string[] = [];
  const creditReads: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const requestHeaders = (init?.headers || {}) as Record<string, string>;
    const clientId = String(requestHeaders['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: clients.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) {
      creditReads.push(clientId || '(aggregate)');
      return Response.json(clientId
        ? { _client_id: clientId, session_id: clientId, status: 200, data: { credits: 500 } }
        : { clients: clients.map((client_id) => ({ client_id, ok: true, credits: 500 })) });
    }
    if (url.endsWith('/v1/refresh-tokens')) {
      refreshed.push(clientId);
      return new Response(JSON.stringify({ detail: 'This worker has no usable Flow session.' }), { status: 503 });
    }
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      if (clientId !== clients[2]) return new Response(JSON.stringify({ detail: 'NO_FLOW_KEY' }), { status: 400 });
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 3).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const output = path.join(directory, 'asset.png');
    await generateGoogleFlowImage('A clear educational illustration', output);
    assert.deepEqual(generatedOn, clients, `credit reads: ${creditReads.join(', ')}`);
    assert.deepEqual(refreshed, clients.slice(0, 2));
    assert.equal((await readFile(output)).length, 128);

    await generateGoogleFlowImage('A second illustration after session failover', path.join(directory, 'second.png'));
    assert.deepEqual(generatedOn, [...clients, clients[2]], 'workers whose session refresh failed should stay out of the next work item');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stable image affinity reroutes off a worker whose live session probe returns NO_FLOW_KEY', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-sticky-no-key-'));
  const stale = 'account-session-no-flow-key-sticky';
  const verified = 'account-session-live-key-sticky';
  const key = `autosub-asset-${'d'.repeat(64)}`;
  const generatedOn: string[] = [];
  const refreshes: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: [stale, verified].map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return Response.json(clientId === stale
      ? { _client_id: stale, session_id: stale, status: 503, error: 'NO_FLOW_KEY' }
      : { _client_id: verified, session_id: verified, status: 200, data: { credits: 400 } });
    if (url.endsWith('/v1/refresh-tokens')) { refreshes.push(clientId); return Response.json({ nudged: 1 }); }
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      const requestKey = (init?.headers as Record<string, string>)['Idempotency-Key'];
      assert.match(requestKey, /^autosub-asset-[a-f0-9]{64}$/);
      assert.notEqual(requestKey, key, 'a failover worker must receive its own worker-scoped idempotency key');
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 10).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const output = path.join(directory, 'asset.png');
    await generateGoogleFlowImage('A stable-key storyboard image', output, { idempotencyKey: key, _preferredClientIds: [stale] });
    assert.deepEqual(generatedOn, [verified]);
    assert.deepEqual(refreshes, [], 'a known NO_FLOW_KEY account should be skipped before refresh/retry');
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('stable image affinity fails over when its assigned worker is absent from live health', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-sticky-disconnected-'));
  const disconnected = 'account-session-disconnected-sticky';
  const healthy = 'account-session-healthy-sticky';
  const key = `autosub-asset-${'f'.repeat(64)}`;
  const generatedOn: string[] = [];
  const progress: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: [{ client_id: healthy, state: 'idle', has_flow_key: true }],
    });
    if (url.endsWith('/v1/credits')) {
      if (clientId === disconnected) return new Response(JSON.stringify({ detail: 'worker unavailable' }), { status: 503 });
      return Response.json({ _client_id: healthy, status: 200, data: { credits: 200 } });
    }
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      const requestKey = (init?.headers as Record<string, string>)['Idempotency-Key'];
      assert.match(requestKey, /^autosub-asset-[a-f0-9]{64}$/);
      assert.notEqual(requestKey, key, 'a failover worker must receive its own worker-scoped idempotency key');
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 12).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A stable storyboard image', path.join(directory, 'asset.png'), {
      idempotencyKey: key,
      _preferredClientIds: [disconnected],
      onProgress: (message) => { progress.push(message); },
    });
    assert.deepEqual(generatedOn, [healthy]);
    assert.match(progress.join('\n'), /tạm mất kết nối\/phiên.*worker khỏe/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('a Flow account rejoins image routing after its credentials recover', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-worker-rejoin-'));
  const recovering = 'account-session-recovering';
  const healthy = 'account-session-healthy-rejoin';
  let credentialsReady = false;
  const generatedOn: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: [recovering, healthy].map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return clientId === recovering && !credentialsReady
      ? Response.json({ _client_id: recovering, status: 503, error: 'NO_FLOW_KEY' })
      : Response.json({ _client_id: clientId, status: 200, data: { credits: 200 } });
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, generatedOn.length).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowImage('First image while one session is invalid', path.join(directory, 'first.png'), {
      idempotencyKey: `autosub-asset-${'a'.repeat(64)}`,
      _preferredClientIds: [recovering],
    });
    assert.deepEqual(generatedOn, [healthy]);
    credentialsReady = true;
    await generateGoogleFlowImage('Next image after the session recovers', path.join(directory, 'next.png'), {
      idempotencyKey: `autosub-asset-${'b'.repeat(64)}`,
      _preferredClientIds: [recovering],
    });
    assert.deepEqual(generatedOn, [healthy, recovering]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow image scheduler stops promptly when every connected worker explicitly has NO_FLOW_KEY', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const clients = ['account-no-flow-key-one', 'account-no-flow-key-two'];
  let generations = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: clients.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return Response.json({ _client_id: clientId, session_id: clientId, status: 503, error: 'NO_FLOW_KEY' });
    if (url.endsWith('/v1/images/generations')) { generations++; return Response.json({ data: [] }); }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await assert.rejects(
      generateGoogleFlowImage('A Flow image with no authenticated workers', 'unused.png'),
      /Không có worker Flow nào có Flow key còn dùng được/,
    );
    assert.equal(generations, 0, 'do not submit a paid image request to an account known to have no Flow key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stable image affinity stays on a NO_FLOW_KEY worker when its durable idempotency record is processing', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-sticky-processing-'));
  const stale = 'account-session-processing-no-key';
  const verified = 'account-session-processing-fallback';
  const key = `autosub-asset-${'e'.repeat(64)}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  const workerDir = path.join(flowTestWorkdir, 'flow-workers', stale);
  const recordFile = path.join(workerDir, '.flow-idempotency.json');
  const bytes = Buffer.alloc(128, 11).toString('base64');
  await mkdir(workerDir, { recursive: true });
  await writeFile(recordFile, JSON.stringify({ entries: { [keyHash]: { state: 'processing', created: Math.floor(Date.now() / 1000) } } }), 'utf8');
  const generatedOn: string[] = [];
  const refreshes: string[] = [];
  const progress: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: [stale, verified].map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return Response.json(clientId === stale
      ? { _client_id: stale, session_id: stale, status: 503, error: 'NO_FLOW_KEY' }
      : { _client_id: verified, session_id: verified, status: 200, data: { credits: 400 } });
    if (url.endsWith('/v1/refresh-tokens')) { refreshes.push(clientId); return Response.json({ nudged: 1 }); }
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      setTimeout(async () => {
        const store = JSON.parse(await readFile(recordFile, 'utf8')) as { entries: Record<string, { state: string; response?: unknown }> };
        store.entries[keyHash] = { state: 'succeeded', response: { data: [{ b64_json: bytes }] } };
        await writeFile(recordFile, JSON.stringify(store), 'utf8');
      }, 20);
      return new Response(JSON.stringify({ detail: 'This idempotent image generation is already processing; retry with the same key.' }), { status: 409 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const output = path.join(directory, 'asset.png');
    await generateGoogleFlowImage('Reconcile an existing in-flight storyboard image', output, {
      idempotencyKey: key,
      _preferredClientIds: [stale],
      onProgress: (message) => { progress.push(message); },
    });
    assert.deepEqual(generatedOn, [stale], 'an existing durable request must be replayed on its original worker');
    assert.deepEqual(refreshes, []);
    assert.match(progress.join('\n'), /đang đối soát cùng khóa/);
    assert.equal((await readFile(output)).length, 128);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('credit-verified Flow workers are selected before connected workers with NO_FLOW_KEY', async () => {
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-verified-session-first-'));
  const stale = 'account-session-unverified-first';
  const verified = 'account-session-verified-last';
  const generatedOn: string[] = [];
  let exposeStale = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const clientId = String(((init?.headers || {}) as Record<string, string>)['X-Client-Id'] || '');
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy', extension_connected: true, has_flow_key: true,
      clients: [
        ...(exposeStale ? [{ client_id: stale, state: 'idle', has_flow_key: true }] : []),
        { client_id: verified, state: 'idle', has_flow_key: true },
      ],
    });
    if (url.endsWith('/v1/credits')) return Response.json(clientId === stale
      ? { _client_id: stale, session_id: stale, status: 503, error: 'NO_FLOW_KEY' }
      : { _client_id: verified, session_id: verified, status: 200, data: { credits: 400 } });
    if (url.endsWith('/v1/images/generations')) {
      generatedOn.push(clientId);
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 4).toString('base64') }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowImage('Warm the verified Flow worker', path.join(directory, 'warm.png'));
    exposeStale = true;
    await new Promise((resolve) => setTimeout(resolve, 800));
    await generateGoogleFlowImage('Use the verified Flow worker again', path.join(directory, 'next.png'));
    assert.deepEqual(generatedOn, [verified, verified]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow failover stops immediately when no healthy alternate worker remains', async () => {
  // The preceding fixture uses different clients. Let its 750ms health cache expire.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-no-alternate-'));
  let generations = 0;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 2_500);
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-one', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [
      { client_id: 'account-one', ok: true, credits: 100 },
    ] });
    if (url.endsWith('/v1/images/generations')) {
      generations += 1;
      return new Response(JSON.stringify({ detail: 'Google Flow extension is not connected' }), { status: 503 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      generateGoogleFlowImage('A clear educational illustration', path.join(directory, 'result.png'), { signal: controller.signal }),
      (error) => error instanceof Error
        && 'code' in error
        && error.code === 'FLOW_EXTENSION_NOT_CONNECTED',
    );
    assert.equal(generations, 1);
  } finally {
    clearTimeout(abortTimer);
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow keeps handing a safe disconnected-worker request to every registered alternate', async () => {
  const originalFetch = globalThis.fetch;
  const generationClients: string[] = [];
  const clientIds = Array.from({ length: 10 }, (_, index) => `account-dynamic-failover-${String(index + 1).padStart(2, '0')}`);
  const requestKeys: string[] = [];
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-dynamic-failover-'));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: clientIds.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })) });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: clientIds.map((client_id) => ({ client_id, ok: true, credits: 100 })) });
    if (url.endsWith('/v1/images/generations')) {
      const headers = init?.headers as Record<string, string>;
      generationClients.push(String(headers?.['X-Client-Id'] || ''));
      requestKeys.push(String(headers?.['Idempotency-Key'] || ''));
      if (generationClients.length < clientIds.length) return new Response(JSON.stringify({ detail: 'Google Flow extension is not connected' }), { status: 503 });
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 8).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A clear educational illustration', path.join(directory, 'result.png'));
    assert.deepEqual(new Set(generationClients), new Set(clientIds));
    assert.equal(generationClients.length, clientIds.length, 'try each registered worker once before returning a pool failure');
    assert.equal(new Set(requestKeys).size, 1, 'safe handoff keeps the same idempotency key');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Google batchexecute er/400 af.httprm rejection fails over instead of aborting the job', async () => {
  // Let the previous ten-account fixture expire from the bounded worker cache.
  await new Promise((resolve) => setTimeout(resolve, 800));
  // Exact shape from director job ddb54ce6 (worker account-79c1be1608e9):
  // Flow Agent HTTP 400 wrapping Google's batchexecute [["er",...,400],["di",16],["af.httprm",...]].
  // Google refused before generating: known-not-dispatched, safe to try the next worker.
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-batch400-'));
  const seenClients: string[] = [];
  const payload = ")]}'\n\n104\n[[\"er\",null,null,null,null,400,null,null,null,3],[\"di\",16],[\"af.httprm\",16,\"-7051460093543573843\",47]]\n25\n[[\"e\",4,null,null,140]]\n";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-batch400-a', state: 'idle', has_flow_key: true },
      { client_id: 'account-batch400-b', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [
      { client_id: 'account-batch400-a', ok: true, credits: 100 },
      { client_id: 'account-batch400-b', ok: true, credits: 100 },
    ] });
    if (url.endsWith('/v1/images/generations')) {
      const clientId = String((init?.headers as Record<string, string>)?.['X-Client-Id'] || '');
      seenClients.push(clientId);
      if (seenClients.length === 1) return new Response(JSON.stringify({ detail: payload }), { status: 400 });
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 8).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await generateGoogleFlowImage('A clear educational illustration', path.join(directory, 'result.png'));
    assert.deepEqual(seenClients, ['account-batch400-a', 'account-batch400-b']);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('a worker refused upstream 3 times in a row is rested with a named tab-reload hint', async () => {
  // Circuit breaker à la flow2api consecutive_error_count: the dead tab parks
  // itself so healthy workers serve the queue, and the job names the tab.
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-circuit-'));
  const seenClients: string[] = [];
  const progress: string[] = [];
  const payload = ")]}'\n\n104\n[[\"er\",null,null,null,null,400,null,null,null,3],[\"di\",16],[\"af.httprm\",16,\"-7051460093543573843\",47]]\n25\n[[\"e\",4,null,null,140]]\n";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-circuit-a', state: 'idle', has_flow_key: true },
      { client_id: 'account-circuit-b', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [
      { client_id: 'account-circuit-a', ok: true, credits: 100 },
      { client_id: 'account-circuit-b', ok: true, credits: 100 },
    ] });
    if (url.endsWith('/v1/images/generations')) {
      const clientId = String((init?.headers as Record<string, string>)?.['X-Client-Id'] || '');
      seenClients.push(clientId);
      if (clientId === 'account-circuit-a') return new Response(JSON.stringify({ detail: payload }), { status: 400 });
      return Response.json({ data: [{ b64_json: Buffer.alloc(128, 8).toString('base64') }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    for (let i = 0; i < 3; i += 1) {
      await generateGoogleFlowImage(`circuit image ${i}`, path.join(directory, `img-${i}.png`), {
        _preferredClientIds: ['account-circuit-a'],
        onProgress: (message) => { progress.push(String(message)); },
      });
    }
    assert.deepEqual(seenClients, ['account-circuit-a', 'account-circuit-b', 'account-circuit-a', 'account-circuit-b', 'account-circuit-a', 'account-circuit-b']);
    assert.ok(progress.some((message) => /cho nghỉ.*Reload/.test(message)), 'trip must name the tab-reload recovery');
    const before = seenClients.length;
    await generateGoogleFlowImage('circuit image 3', path.join(directory, 'img-3.png'));
    assert.deepEqual(seenClients.slice(before), ['account-circuit-b'], 'the rested worker must be skipped until cooldown ends');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('a resumed video attempt receives a fresh idempotency key', async () => {
  const originalFetch = globalThis.fetch;
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/credits')) return new Response(JSON.stringify({ clients: [{ ok: true }] }));
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'healthy', extension_connected: true, has_flow_key: true }), { status: 200 });
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    return new Response(JSON.stringify({ detail: 'synthetic failure' }), { status: 400 });
  };
  try {
    await assert.rejects(generateGoogleFlowVideo('Duration: 4 seconds', 'same-output.mp4'), /synthetic failure/);
    await assert.rejects(generateGoogleFlowVideo('Duration: 4 seconds', 'same-output.mp4'), /synthetic failure/);
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
  } finally { globalThis.fetch = originalFetch; }
});

test('video generation refreshes a lost Flow key once before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-video-refresh-'));
  const output = path.join(directory, 'clip.mp4');
  const mp4 = Buffer.alloc(10_001);
  Buffer.from('ftyp').copy(mp4, 4);
  let generations = 0;
  let refreshes = 0;
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-video', ok: refreshes > 0 }] });
    if (url.endsWith('/v1/refresh-tokens')) { refreshes++; return Response.json({ nudged: 1 }); }
    if (url.endsWith('/v1/videos/generations')) {
      generations++;
      keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
      if (generations === 1) return new Response(JSON.stringify({ detail: 'NO_FLOW_KEY' }), { status: 400 });
      return Response.json({ job_id: 'recovered-video', status: 'succeeded', data: [{ url: '/download/recovered.mp4' }] });
    }
    if (url.endsWith('/download/recovered.mp4')) return new Response(new Uint8Array(mp4));
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowVideo('Duration: 4 seconds', output);
    assert.equal(generations, 2);
    assert.equal(refreshes, 1);
    assert.notEqual(keys[0], keys[1]);
    assert.equal((await readFile(output)).length, mp4.length);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow continuity frame uses start_media_id instead of reference mode', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-video-start-'));
  const reference = path.join(directory, 'continuity.jpg');
  const output = path.join(directory, 'clip.mp4');
  const mp4 = Buffer.alloc(10_001);
  Buffer.from('ftyp').copy(mp4, 4);
  let videoBody: Record<string, unknown> = {};
  await writeFile(reference, Buffer.alloc(128, 3));
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/credits')) return new Response(JSON.stringify({ clients: [{ ok: true }] }));
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'healthy', extension_connected: true, has_flow_key: true }), { status: 200 });
    if (url.endsWith('/v1/upload')) return new Response(JSON.stringify({ media_id: 'continuity-media' }), { status: 200 });
    if (url.endsWith('/v1/videos/generations')) {
      videoBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ job_id: 'video-start', status: 'succeeded', data: [{ url: '/download/clip.mp4' }] }), { status: 200 });
    }
    if (url.endsWith('/download/clip.mp4')) return new Response(new Uint8Array(mp4), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowVideo('Duration: 6 seconds', output, 'Flow Agent Auto', undefined, { startImagePath: reference }, '16:9');
    assert.equal(videoBody.start_media_id, 'continuity-media');
    assert.equal(videoBody.ref_media_ids, undefined);
    assert.equal(videoBody.aspect, 'landscape');
    assert.equal(videoBody.duration, 6);
    assert.equal((await readFile(output)).length, mp4.length);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow character references use ref_media_ids without a start frame', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-video-reference-'));
  const first = path.join(directory, 'character-a.png');
  const second = path.join(directory, 'character-b.png');
  const output = path.join(directory, 'clip.mp4');
  const mp4 = Buffer.alloc(10_001);
  Buffer.from('ftyp').copy(mp4, 4);
  let uploadIndex = 0;
  let videoBody: Record<string, unknown> = {};
  await Promise.all([writeFile(first, Buffer.alloc(128, 1)), writeFile(second, Buffer.alloc(128, 2))]);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/v1/credits')) return new Response(JSON.stringify({ clients: [{ ok: true }] }));
    if (url.endsWith('/health')) return new Response(JSON.stringify({ status: 'healthy', extension_connected: true, has_flow_key: true }), { status: 200 });
    if (url.endsWith('/v1/upload')) return new Response(JSON.stringify({ media_id: `character-${++uploadIndex}` }), { status: 200 });
    if (url.endsWith('/v1/videos/generations')) {
      videoBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ job_id: 'video-reference', status: 'succeeded', data: [{ url: '/download/clip.mp4' }] }), { status: 200 });
    }
    if (url.endsWith('/download/clip.mp4')) return new Response(new Uint8Array(mp4), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await generateGoogleFlowVideo('Duration: 8 seconds', output, 'Flow Agent Auto', undefined, { referenceImagePaths: [first, second] });
    assert.deepEqual(videoBody.ref_media_ids, ['character-1', 'character-2']);
    assert.equal(videoBody.start_media_id, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Flow rejects conflicting start and reference modes before spending credit', async () => {
  await assert.rejects(
    generateGoogleFlowVideo('Duration: 8 seconds', 'unused.mp4', 'Flow Agent Auto', undefined, { startImagePath: 'start.png', referenceImagePaths: ['character.png'] }),
    /không hỗ trợ đồng thời/,
  );
});

test('credit errors name the Google Flow account instead of Flow Agent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    return new Response(JSON.stringify({ detail: 'Not enough credits: 0 left.' }), { status: 402 });
  };
  try {
    await assert.rejects(
      generateGoogleFlowVideo('Duration: 8 seconds', 'unused.mp4'),
      /Tài khoản Google Flow không đủ credit/,
    );
  } finally { globalThis.fetch = originalFetch; }
});

test('a false zero-credit response caused by an invalid Flow session is refreshed and retried', async () => {
  const originalFetch = globalThis.fetch;
  let refreshed = false;
  let generations = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('data:video/mp4')) return new Response(Buffer.from('not-an-mp4'));
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-session', ok: refreshed, credits: refreshed ? 697 : 0 }] });
    if (url.endsWith('/v1/refresh-tokens')) { refreshed = true; return Response.json({ nudged: 1 }); }
    if (url.endsWith('/v1/videos/generations')) {
      generations += 1;
      if (generations === 1) return new Response(JSON.stringify({ detail: 'Not enough credits: 0 left.' }), { status: 402 });
      return Response.json({ job_id: 'job-697', status: 'succeeded', data: [{ url: 'data:video/mp4;base64,AAAA' }] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    await assert.rejects(
      generateGoogleFlowVideo('Duration: 8 seconds', 'unused.mp4'),
      /không phải video MP4 hợp lệ|không trả về video/i,
    );
    assert.equal(refreshed, true);
    assert.equal(generations, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow too-much-traffic CAPTCHA pauses the pool instead of failing over to another account', async () => {
  const originalFetch = globalThis.fetch;
  const generationClients: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true, clients: [
      { client_id: 'account-traffic-test-one', state: 'idle', has_flow_key: true },
      { client_id: 'account-traffic-test-two', state: 'idle', has_flow_key: true },
    ] });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [
      { client_id: 'account-traffic-test-one', ok: true, credits: 100 },
      { client_id: 'account-traffic-test-two', ok: true, credits: 100 },
    ] });
    if (url.endsWith('/v1/images/generations')) {
      generationClients.push(String((init?.headers as Record<string, string>)?.['X-Client-Id'] || ''));
      return new Response(JSON.stringify({ detail: 'reCAPTCHA evaluation failed (PUBLIC_ERROR_UNUSUAL_ACTIVITY_TOO_MUCH_TRAFFIC)' }), { status: 400 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    await assert.rejects(
      generateGoogleFlowImage('A clear educational illustration', path.join(tmpdir(), 'flow-too-much-traffic.png')),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'FLOW_IMAGE_TRAFFIC_THROTTLED');
        assert.match((error as Error).message, /TOO_MUCH_TRAFFIC/i);
        return true;
      },
    );
    assert.equal(generationClients.length, 1);
    assert.ok(generationClients[0]);
    await assert.rejects(
      generateGoogleFlowImage('A second educational illustration', path.join(tmpdir(), 'flow-too-much-traffic-second.png')),
      (error: unknown) => (error as { code?: string }).code === 'FLOW_IMAGE_TRAFFIC_THROTTLED',
    );
    assert.equal(generationClients.length, 1, 'the pool must not dispatch queued images during cooldown');
  } finally { globalThis.fetch = originalFetch; }
});
