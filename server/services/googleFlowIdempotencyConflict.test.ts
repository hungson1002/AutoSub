import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const originalWorkdir = process.env.AUTOSUB_WORKDIR;
const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'autosub-flow-idempotency-conflict-'));
process.env.AUTOSUB_WORKDIR = fixtureRoot;
process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_RECOVERY_START_GAP_MS = '0';
process.env.AUTOSUB_FLOW_IMAGE_IDEMPOTENT_REPLAY_BASE_MS = '1';
process.env.AUTOSUB_FLOW_IMAGE_GLOBAL_CAP_INITIAL = '4';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_CAP_INITIAL = '4';
process.env.AUTOSUB_FLOW_IMAGE_ISOLATED_GLOBAL_START_GAP_MS = '1';

const workerId = `account-autosub-test-${process.pid}`;
const workerPort = 8198;
const alternateWorkerId = `account-autosub-alt-${process.pid}`;
const alternateWorkerPort = 8197;
const flowWorkersDir = path.join(fixtureRoot, 'flow-workers');
const workerDir = path.join(flowWorkersDir, workerId);
const alternateWorkerDir = path.join(flowWorkersDir, alternateWorkerId);
await mkdir(workerDir, { recursive: true });
await mkdir(alternateWorkerDir, { recursive: true });
await writeFile(path.join(flowWorkersDir, 'registry.json'), JSON.stringify([
  { clientId: workerId, port: workerPort, createdAt: new Date().toISOString() },
  { clientId: alternateWorkerId, port: alternateWorkerPort, createdAt: new Date().toISOString() },
]));

const { generateGoogleFlowImage } = await import('./googleFlow');

function idempotencyEntry(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

async function writeRecord(key: string, record: Record<string, unknown>) {
  await writeFile(path.join(workerDir, '.flow-idempotency.json'), JSON.stringify({
    version: 1,
    entries: { [idempotencyEntry(key)]: record },
  }));
}

function installFlowMock(onGeneration: (clientId: string) => Response, readyClients = [workerId]) {
  const originalFetch = globalThis.fetch;
  let generationRequests = 0;
  const generationRequestsByClient = new Map<string, number>();
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({
      status: 'healthy',
      extension_connected: true,
      clients: readyClients.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })),
    });
    if (url.endsWith('/v1/credits')) return Response.json({
      clients: readyClients.map((client_id) => ({ client_id, ok: true, credits: 100 })),
    });
    if (url.endsWith('/v1/images/generations')) {
      assert.equal(init?.method, 'POST');
      const clientId = String((init?.headers as Record<string, string>)?.['X-Client-Id']);
      assert.ok(readyClients.includes(clientId));
      generationRequests += 1;
      generationRequestsByClient.set(clientId, (generationRequestsByClient.get(clientId) || 0) + 1);
      return onGeneration(clientId);
    }
    throw new Error(`Unexpected Flow request: ${url}`);
  };
  return {
    get generationRequests() { return generationRequests; },
    generationRequestsByClient,
    restore() { globalThis.fetch = originalFetch; },
  };
}

const conflictResponse = () => new Response(JSON.stringify({
  detail: 'Idempotency-Key was already used with a different image generation request.',
}), { status: 409 });

test('new durable images serialize through the profile-wide gate when multiple workers are idle', async () => {
  const clients = [workerId, alternateWorkerId];
  const keys: string[] = [];
  for (let index = 0; keys.length < 4; index++) {
    const key = `autosub-asset-${createHash('sha256').update(`balanced-${index}`).digest('hex')}`;
    const scores = clients.map((id) => createHash('sha256').update(`${key}\0${id}`).digest('hex'));
    if (scores[0] > scores[1]) keys.push(key);
  }
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  let active = 0;
  let peakActive = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, clients: clients.map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })) });
    if (url.endsWith('/v1/credits')) return Response.json({ credits: 100 });
    assert.ok(url.endsWith('/v1/images/generations'));
    seen.push(String((init?.headers as Record<string, string>)['X-Client-Id']));
    active += 1;
    peakActive = Math.max(peakActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return Response.json({ data: [{ b64_json: Buffer.alloc(192, 8).toString('base64') }] });
  };
  try {
    await Promise.all(keys.map((idempotencyKey, index) => generateGoogleFlowImage('independent durable shot', path.join(fixtureRoot, `balanced-${index}.png`), { idempotencyKey })));
    assert.equal(seen.length, 4);
    assert.equal(peakActive, 1, 'idle accounts must not bypass the shared browser-profile gate');
  } finally { globalThis.fetch = originalFetch; }
});

test('a rejected isolated image hands off before its old account finishes refreshing', async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  let releaseRefresh!: () => void;
  const refreshBarrier = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let refreshDone!: () => void;
  const refreshed = new Promise<void>((resolve) => { refreshDone = resolve; });
  let recovering = false;
  const watchdog = setTimeout(releaseRefresh, 5_000);
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, clients: [workerId, alternateWorkerId].map((client_id) => ({ client_id, state: 'idle', has_flow_key: true })) });
    if (url.endsWith('/v1/refresh-tokens')) {
      await refreshBarrier;
      recovering = true;
      return Response.json({ nudged: 1 });
    }
    if (url.endsWith('/v1/credits')) {
      if (recovering) refreshDone();
      return Response.json({ _client_id: workerId, data: { credits: 100 }, credits: 100 });
    }
    assert.ok(url.endsWith('/v1/images/generations'));
    const clientId = String((init?.headers as Record<string, string>)['X-Client-Id']);
    seen.push(clientId);
    return clientId === workerId ? Response.json({ detail: 'NO_FLOW_KEY' }, { status: 400 })
      : Response.json({ data: [{ b64_json: Buffer.alloc(192, 9).toString('base64') }] });
  };
  try {
    await generateGoogleFlowImage('safe session handoff', path.join(fixtureRoot, 'background-recovery.png'), { _preferredClientIds: [workerId] });
    assert.deepEqual(seen, [workerId, alternateWorkerId]);
    assert.equal(recovering, false, 'healthy account must finish while refresh is still pending');
  } finally {
    clearTimeout(watchdog);
    releaseRefresh();
    await refreshed;
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.fetch = originalFetch;
  }
});

test('concurrent callers of a new durable key keep one account owner before a disk record exists', async () => {
  const key = `autosub-asset-${createHash('sha256').update('concurrent-new-owner').digest('hex')}`;
  const seen: string[] = [];
  const flow = installFlowMock((clientId) => {
    seen.push(clientId);
    return Response.json({ data: [{ b64_json: Buffer.alloc(192, 5).toString('base64') }] });
  }, [workerId, alternateWorkerId]);
  try {
    await Promise.all([0, 1].map((index) => generateGoogleFlowImage('same asset requested concurrently', path.join(fixtureRoot, `duplicate-${index}.png`), { idempotencyKey: key })));
    assert.equal(seen.length, 2);
    assert.equal(new Set(seen).size, 1, 'provider idempotency requires both callers to use the same account');
  } finally { flow.restore(); }
});

test('isolated reference reuse survives remote media ID replacement without uploading again', async () => {
  const originalFetch = globalThis.fetch;
  const reference = path.join(fixtureRoot, 'stable-reference.png');
  await writeFile(reference, Buffer.alloc(192, 21));
  let uploads = 0;
  let generations = 0;
  let currentMediaId = 'original-remote-id';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, clients: [{ client_id: workerId, state: 'idle', has_flow_key: true }] });
    if (url.endsWith('/v1/credits')) return Response.json({ credits: 100 });
    if (url.endsWith('/v1/upload')) {
      uploads++;
      return Response.json({ media_id: currentMediaId, url: '/download/upload_123_reference.png' });
    }
    assert.ok(url.endsWith('/v1/images/generations'));
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.ref_media_ids, ['upload_123_reference.png']);
    // Agent recovery changes its history record's ID, retaining the filename.
    currentMediaId = 'recovered-remote-id';
    generations++;
    return Response.json({ data: [{ b64_json: Buffer.alloc(192, 3).toString('base64') }] });
  };
  try {
    for (let index = 0; index < 2; index++) {
      await generateGoogleFlowImage('same cast, different shot', path.join(fixtureRoot, `stable-reference-${index}.png`), {
        _preferredClientIds: [workerId], referenceImagePaths: [reference],
      });
    }
    assert.equal(uploads, 1);
    assert.equal(generations, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('a payload-conflict 409 reuses the succeeded durable image from that worker', async () => {
  const key = `autosub-asset-${'a'.repeat(64)}`;
  const imageBytes = Buffer.alloc(192, 0x5a);
  await writeRecord(key, {
    fingerprint: 'previous-reference-media-id',
    state: 'succeeded',
    response: { data: [{ b64_json: imageBytes.toString('base64') }] },
  });
  const flow = installFlowMock(conflictResponse);
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-idempotency-output-'));
  const output = path.join(directory, 'asset.png');
  try {
    await generateGoogleFlowImage('same durable storyboard asset', output, {
      idempotencyKey: key,
      _preferredClientIds: [workerId],
    });
    assert.equal(flow.generationRequests, 1, 'must not submit a second generation under another key');
    assert.deepEqual(await readFile(output), imageBytes);
  } finally {
    flow.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a payload-conflict 409 waits for the same worker to finish its durable request', async () => {
  const key = `autosub-asset-${'b'.repeat(64)}`;
  const imageBytes = Buffer.alloc(192, 0x6b);
  await writeRecord(key, { fingerprint: 'old-reference-media-id', state: 'processing', created: Math.floor(Date.now() / 1000) });
  let finishScheduled = false;
  const flow = installFlowMock(() => {
    if (!finishScheduled) {
      finishScheduled = true;
      setTimeout(() => {
        void writeRecord(key, {
          fingerprint: 'old-reference-media-id',
          state: 'succeeded',
          response: { data: [{ b64_json: imageBytes.toString('base64') }] },
        });
      }, 100);
    }
    return conflictResponse();
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-idempotency-output-'));
  const output = path.join(directory, 'asset.png');
  try {
    await generateGoogleFlowImage('same durable storyboard asset still processing', output, {
      idempotencyKey: key,
      _preferredClientIds: [workerId],
    });
    assert.equal(flow.generationRequests, 1, 'reconciliation must not resubmit generation');
    assert.deepEqual(await readFile(output), imageBytes);
  } finally {
    flow.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test('an already-processing 409 polls the assigned worker record instead of repeating POSTs', async () => {
  const key = `autosub-asset-${'c'.repeat(64)}`;
  const imageBytes = Buffer.alloc(192, 0x7c);
  await writeRecord(key, { fingerprint: 'current-payload', state: 'processing', created: Math.floor(Date.now() / 1000) });
  let completionScheduled = false;
  const flow = installFlowMock(() => {
    if (!completionScheduled) {
      completionScheduled = true;
      setTimeout(() => {
        void writeRecord(key, {
          fingerprint: 'current-payload',
          state: 'succeeded',
          response: { data: [{ b64_json: imageBytes.toString('base64') }] },
        });
      }, 100);
    }
    return new Response(JSON.stringify({ detail: 'This idempotent image generation is already processing; retry with the same key.' }), { status: 409 });
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-idempotency-processing-'));
  const output = path.join(directory, 'asset.png');
  try {
    await generateGoogleFlowImage('same durable storyboard asset still processing', output, {
      idempotencyKey: key,
      _preferredClientIds: [workerId],
    });
    assert.equal(flow.generationRequests, 1, 'processing reconciliation must not repeat the image POST');
    assert.deepEqual(await readFile(output), imageBytes);
  } finally {
    flow.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

after(async () => {
  if (originalWorkdir === undefined) delete process.env.AUTOSUB_WORKDIR;
  else process.env.AUTOSUB_WORKDIR = originalWorkdir;
  await rm(fixtureRoot, { recursive: true, force: true });
});

// A healthy bridge must not make an hours-old processing record retry forever.
test('legacy created=null processing tombstone never looks fresh because another record touched the file', async () => {
  const key = `autosub-asset-${'f'.repeat(64)}`;
  const imageBytes = Buffer.alloc(192, 0x3b);
  await writeRecord(key, { state: 'processing', created: null, job_id: null });
  // Simulate the real failure: another request rewrites the shared JSON file,
  // making file mtime recent even though this legacy processing entry is old.
  await writeFile(path.join(workerDir, '.flow-idempotency.json'), JSON.stringify({
    version: 1,
    entries: {
      [idempotencyEntry(key)]: { state: 'processing', created: null, job_id: null },
      other: { state: 'succeeded', created: Math.floor(Date.now() / 1000), response: { data: [] } },
    },
  }));
  const flow = installFlowMock((clientId) => clientId === alternateWorkerId
    ? Response.json({ data: [{ b64_json: imageBytes.toString('base64') }] })
    : conflictResponse(), [workerId, alternateWorkerId]);
  const output = path.join(fixtureRoot, 'legacy-null-recovery.png');
  try {
    await generateGoogleFlowImage('legacy poisoned asset', output, { idempotencyKey: key, _preferredClientIds: [workerId] });
    assert.equal(flow.generationRequestsByClient.get(workerId) || 0, 0);
    assert.equal(flow.generationRequestsByClient.get(alternateWorkerId), 1);
    assert.deepEqual(await readFile(output), imageBytes);
  } finally { flow.restore(); }
});

test('stale processing exits all generation replay layers and leaves the key intact', async () => {
  const key = `autosub-asset-${'d'.repeat(64)}`;
  await writeRecord(key, { state: 'processing', created: null, job_id: null });
  const old = new Date(Date.now() - 5 * 3600_000);
  await utimes(path.join(workerDir, '.flow-idempotency.json'), old, old);
  const flow = installFlowMock(conflictResponse);
  try {
    await assert.rejects(generateGoogleFlowImage('stale pending image', path.join(fixtureRoot, 'never.png'), {
      idempotencyKey: key, _preferredClientIds: [workerId],
    }), (error: any) => error.code === 'FLOW_RECONCILIATION_EXHAUSTED');
    assert.equal(flow.generationRequests, 0, 'known-stale processing must be rejected before another provider POST');
    const saved = JSON.parse(await readFile(path.join(workerDir, '.flow-idempotency.json'), 'utf8'));
    assert.equal(saved.entries[idempotencyEntry(key)].state, 'processing');
  } finally { flow.restore(); }
});

test('stale processing is skipped before submit and a clean healthy worker completes the missing asset', async () => {
  const key = `autosub-asset-${'e'.repeat(64)}`;
  const imageBytes = Buffer.alloc(192, 0x2a);
  await writeRecord(key, { state: 'processing', created: Date.now() / 1000 - 5 * 3600 });
  const flow = installFlowMock((clientId) => clientId === alternateWorkerId
    ? Response.json({ data: [{ b64_json: imageBytes.toString('base64') }] })
    : conflictResponse(), [workerId, alternateWorkerId]);
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-stale-handoff-'));
  const output = path.join(directory, 'asset.png');
  try {
    await generateGoogleFlowImage('the one missing storyboard asset', output, {
      idempotencyKey: key,
      _preferredClientIds: [workerId],
    });
    assert.equal(flow.generationRequestsByClient.get(workerId) || 0, 0, 'a known-stale worker-local tombstone must not consume another request');
    assert.equal(flow.generationRequestsByClient.get(alternateWorkerId), 1, 'route the asset directly to a clean healthy worker');
    assert.deepEqual(await readFile(output), imageBytes);
    const oldRecord = JSON.parse(await readFile(path.join(workerDir, '.flow-idempotency.json'), 'utf8'));
    assert.equal(oldRecord.entries[idempotencyEntry(key)].state, 'processing', 'leave the unknown original outcome untouched');
  } finally {
    flow.restore();
    await rm(directory, { recursive: true, force: true });
  }
});
