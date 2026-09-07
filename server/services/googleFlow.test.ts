import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { flowAgentStatus, generateGoogleFlowImage, generateGoogleFlowVideo, validateGoogleFlowSession } from './googleFlow';

test('a missing extension key refreshes the active browser session and retries once', async () => {
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
    if (generations === 1) return new Response(JSON.stringify({ detail: 'NO_FLOW_KEY' }), { status: 400 });
    return Response.json({ data: [{ b64_json: Buffer.alloc(128, 7).toString('base64') }] });
  };
  try {
    const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-refresh-'));
    const output = path.join(directory, 'asset.png');
    await generateGoogleFlowImage('An educational illustration', output);
    assert.equal(generations, 2);
    assert.equal(refreshes, 1);
    assert.equal(keys[0], keys[1]);
    await rm(directory, { recursive: true, force: true });
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

test('Flow Agent preflight explains a missing extension', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'starting', extension_connected: false, has_flow_key: false }), { status: 200 });
  try {
    await assert.rejects(validateGoogleFlowSession(), /Extension Flow Agent chưa kết nối/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Flow Agent image generation stores returned base64 image', async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(path.join(tmpdir(), 'autosub-flow-image-'));
  const output = path.join(directory, 'asset.png');
  let requestCount = 0;
  globalThis.fetch = async (_input, init) => {
    if (String(_input).endsWith('/v1/credits')) return new Response(JSON.stringify({ clients: [{ ok: true }] }));
    requestCount += 1;
    if (requestCount === 1) return new Response(JSON.stringify({ status: 'healthy', extension_connected: true, has_flow_key: true }), { status: 200 });
    const body = JSON.parse(String(init?.body || '{}')) as { model?: string; response_format?: string };
    assert.equal(body.model, 'narwhal');
    assert.equal(body.response_format, 'b64_json');
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
    assert.equal(keys[0], keys[1]);
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
