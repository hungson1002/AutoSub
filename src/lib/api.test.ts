import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AIProvider } from '../types';
import { api, buildRequestInit } from './api';

const responsePayload = { id: 'job-1', status: 'paused', totalCues: 1, doneCues: 0, failedCues: 0 };

test('dubbing POST actions do not send an empty JSON body or JSON content type', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(responsePayload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await api.startDubbingJob('job-1');
    await api.pauseDubbingJob('job-1');
    await api.resumeDubbingJob('job-1');
    await api.cancelDubbingJob('job-1');
    await api.retryFailedDubbingJob('job-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.init?.method, 'POST');
    assert.equal(call.init?.body, undefined);
    assert.equal(new Headers(call.init?.headers).has('content-type'), false);
  }
});

test('create dubbing job keeps JSON body, content type and audio mix config', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ jobId: 'job-2', status: 'queued', totalCues: 1 }), { status: 201, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const provider: AIProvider = { id: 'provider-1', name: 'Test', baseUrl: 'http://localhost/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true, tts: true } };
  try {
    await api.createDubbingJob([{
      id: 'cue-1', index: 1, startMs: 0, endMs: 1000, originalText: 'Hello', translatedText: 'Xin chào', text: 'Xin chào', previousText: '', nextText: '', provider, model: 'model-1', voice: 'voice-1', speed: 1, volume: 1,
    }], { timingMode: 'natural', batchSize: 30, ttsConcurrency: 3, llmConcurrency: 2, maxRetries: 3, audioMix: { keepOriginal: true, originalVolume: 0.25 } });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const init = calls[0]?.init;
  assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
  assert.ok(typeof init?.body === 'string');
  const body = JSON.parse(init.body as string) as { cues: unknown[]; audioMix: { keepOriginal: boolean; originalVolume: number } };
  assert.equal(body.cues.length, 1);
  assert.deepEqual(body.audioMix, { keepOriginal: true, originalVolume: 0.25 });
});

test('request helper removes an accidental JSON header when a request has no body', () => {
  const init = buildRequestInit({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(init.body, undefined);
  assert.equal(new Headers(init.headers).has('content-type'), false);
});
