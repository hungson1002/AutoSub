import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { flowAgentStatus, generateGoogleFlowImage, generateGoogleFlowImages, generateGoogleFlowVideo, validateGoogleFlowSession } from './googleFlow';

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

test('browser Failed to fetch refreshes the current Flow session and retries the image once', async () => {
  const originalFetch = globalThis.fetch;
  let generations = 0;
  let refreshes = 0;
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', extension_connected: true, has_flow_key: true });
    if (url.endsWith('/v1/credits')) return Response.json({ clients: [{ client_id: 'opera-session', ok: true }] });
    if (url.endsWith('/v1/refresh-tokens')) { refreshes += 1; return Response.json({ nudged: 1 }); }
    generations += 1;
    keys.push(String((init?.headers as Record<string, string>)?.['Idempotency-Key'] || ''));
    if (generations === 1) return new Response(JSON.stringify({ detail: 'Failed to fetch' }), { status: 400 });
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 7).toString('base64') }] });
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-fetch-recovery-'));
  try {
    await generateGoogleFlowImage('A connected educational illustration', path.join(directory, 'asset.png'));
    assert.equal(generations, 2);
    assert.equal(refreshes, 1);
    assert.notEqual(keys[0], keys[1]);
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

test('primary plus same-profile linked Flow account contribute four targeted slots', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-account-pool-'));
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  const seen: string[] = [];
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
      peak.set(clientId, Math.max(peak.get(clientId) || 0, now));
      await new Promise((resolve) => setTimeout(resolve, 40));
      active.set(clientId, Math.max(0, (active.get(clientId) || 1) - 1));
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
    assert.equal(seen.filter((id) => id === 'legacy-primary').length, 2);
    assert.equal(seen.filter((id) => id === 'account-aaaaaaaaaaaa').length, 2);
    assert.ok((peak.get('legacy-primary') || 0) <= 2);
    assert.ok((peak.get('account-aaaaaaaaaaaa') || 0) <= 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('linked Flow accounts upload and reuse account-scoped reference media ids', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-linked-reference-scope-'));
  const reference = path.join(directory, 'reference.png');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await writeFile(reference, png);
  const uploads = new Map<string, number>();
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
