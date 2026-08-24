import { strict as assert } from 'node:assert';
import { writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import test from 'node:test';
import type { AIProvider } from '../types';
import { cleanupUploadSession, createUploadSession } from '../services/uploads';
import { extractionRoutes, GROQ_DIRECT_AUDIO_LIMIT_BYTES, mapWithConcurrency } from './extraction';

test('bounded extraction work preserves input order and concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, (6 - value) * 2));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(values, [10, 20, 30, 40, 50]);
  assert.equal(peak, 2);
});

test('missing extraction progress is reported as failed instead of running forever', async () => {
  const app = Fastify({ logger: false });
  try {
    await extractionRoutes(app);
    const response = await app.inject({ method: 'GET', url: '/api/extract/progress/missing-job' });
    assert.equal(response.statusCode, 200);
    assert.equal((response.json() as { status: string }).status, 'failed');
  } finally {
    await app.close();
  }
});

test('STT extraction chunks oversized Groq audio after receiving only JSON uploadId', async () => {
  const directory = await createUploadSession();
  const uploadId = path.basename(directory);
  const audioPath = path.join(directory, 'source-large.wav');
  const audioSize = 26 * 1024 * 1024;
  const audio = Buffer.alloc(audioSize);
  audio.write('RIFF', 0); audio.writeUInt32LE(audioSize - 8, 4); audio.write('WAVE', 8);
  audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audioSize - 44, 40);
  await writeFile(audioPath, audio);
  await writeFile(path.join(directory, 'upload.json'), JSON.stringify({
    uploadId,
    filename: 'large.wav',
    contentType: 'audio/wav',
    size: audioSize,
    storedPath: path.posix.join('uploads', uploadId, 'source-large.wav'),
  }), 'utf8');

  const provider: AIProvider = {
    id: 'groq-test', name: 'Groq test', baseUrl: 'https://api.groq.com/openai/v1', enabled: true,
    models: [], providerType: 'groq', authType: 'none', capabilities: { stt: true },
  };
  const calls: number[] = [];
  const originalFetch = globalThis.fetch;
  const app = Fastify({ logger: false });

  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    const file = form.get('file');
    assert.ok(file instanceof Blob);
    calls.push(file.size);
    return new Response(JSON.stringify({ text: 'chunk', segments: [{ start: 0, end: 1, text: 'chunk' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await extractionRoutes(app);
    await app.ready();
    const response = await app.inject({
      method: 'POST',
      url: '/api/extract/stt',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ uploadId, provider, model: 'whisper-large-v3-turbo', language: 'Auto Detect' }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((size) => size <= GROQ_DIRECT_AUDIO_LIMIT_BYTES));
    const result = response.json() as { cues: Array<{ startMs: number }>; uploadId: string };
    assert.equal(result.uploadId, uploadId);
    assert.equal(result.cues.length, 2);
    assert.ok((result.cues[1]?.startMs || 0) >= 600000);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
    await cleanupUploadSession(directory);
  }
});
