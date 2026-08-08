import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AIProvider } from '../types';
import { api, buildRequestInit, friendlyErrorMessage } from './api';
import { LatestUploadGuard } from './latestUpload';

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
    }], { videoId: 'upload-video-1', timingMode: 'natural', batchSize: 30, ttsConcurrency: 3, llmConcurrency: 2, maxRetries: 3, audioMix: { keepOriginal: true, originalVolume: 0.25, separateVocals: true } });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const init = calls[0]?.init;
  assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
  assert.ok(typeof init?.body === 'string');
  const body = JSON.parse(init.body as string) as { cues: unknown[]; videoId: string; audioMix: { keepOriginal: boolean; originalVolume: number; separateVocals: boolean } };
  assert.equal(body.cues.length, 1);
  assert.equal(body.videoId, 'upload-video-1');
  assert.deepEqual(body.audioMix, { keepOriginal: true, originalVolume: 0.25, separateVocals: true });
});

test('request helper removes an accidental JSON header when a request has no body', () => {
  const init = buildRequestInit({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
  assert.equal(init.body, undefined);
  assert.equal(new Headers(init.headers).has('content-type'), false);
});

test('provider errors are shown as actionable messages instead of raw quota codes', () => {
  assert.match(friendlyErrorMessage(Object.assign(new Error('usage_exceeded'), { status: 400 })), /hết hạn mức sử dụng/i);
  assert.match(friendlyErrorMessage(Object.assign(new Error('rate limit'), { status: 429 })), /giới hạn tần suất/i);
  assert.match(friendlyErrorMessage(Object.assign(new Error('Unauthorized'), { status: 401 })), /API key không hợp lệ/i);
  assert.match(friendlyErrorMessage(Object.assign(new Error('Request Entity Too Large'), { status: 413 })), /quá lớn/i);
});

test('extraction sends only the stored upload reference after the one-time upload', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ cues: [], uploadId: 'upload-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const provider: AIProvider = { id: 'provider-1', name: 'Test', baseUrl: 'http://localhost/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { vision: true, stt: true } };

  try {
    await api.extractStt('upload-1', provider, 'stt-model', 'Auto Detect');
    await api.extractOcr('upload-1', provider, 'vision-model', { x: 10, y: 70, w: 80, h: 20 }, 2, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init?.method, 'POST');
    assert.equal(new Headers(call.init?.headers).get('content-type'), 'application/json');
    const body = JSON.parse(String(call.init?.body)) as { uploadId: string };
    assert.equal(body.uploadId, 'upload-1');
    assert.equal(String(call.init?.body).includes('[object File]'), false);
  }
});

test('latest video upload wins when an earlier upload resolves later', () => {
  const guard = new LatestUploadGuard();
  const fileA = new File(['A'], 'a.mp4', { type: 'video/mp4' });
  const fileB = new File(['B'], 'b.mp4', { type: 'video/mp4' });
  let finalState: { file: File; uploadId?: string } = { file: fileA };

  const uploadA = guard.begin();
  finalState = { file: fileA };
  const uploadB = guard.begin();
  finalState = { file: fileB };

  if (guard.isCurrent(uploadB)) {
    finalState = { file: fileB, uploadId: 'upload-b' };
    guard.complete(uploadB);
  }
  if (guard.isCurrent(uploadA)) finalState = { file: fileA, uploadId: 'upload-a' };

  assert.equal(uploadA.controller.signal.aborted, true);
  assert.equal(finalState.file, fileB);
  assert.equal(finalState.uploadId, 'upload-b');
});

test('translation request sends each cue independently without neighboring cue text', async () => {
  const originalFetch = globalThis.fetch;
  let body: { items: Array<Record<string, unknown>> } | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as typeof body;
    return new Response(JSON.stringify({ items: [{ id: 'cue-a', translation: 'A' }, { id: 'cue-b', translation: 'B' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const provider: AIProvider = { id: 'provider-translation', name: 'Translation', baseUrl: 'http://localhost/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true } };
  try {
    await api.translate(provider, 'model-translation', [
      { id: 'cue-a', index: 1, startMs: 0, endMs: 1000, originalText: 'Source A', translatedText: '', voiceGroup: 'G1', enabled: true },
      { id: 'cue-b', index: 2, startMs: 1000, endMs: 2200, originalText: 'Source B', translatedText: '', voiceGroup: 'G1', enabled: true },
    ], 'Chinese', 'Vietnamese', 'Natural', '', []);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(body?.items, [
    { id: 'cue-a', text: 'Source A', durationMs: 1000, targetDurationMs: 1000 },
    { id: 'cue-b', text: 'Source B', durationMs: 1200, targetDurationMs: 1200 },
  ]);
});

test('OCR progress polling stays a small JSON request tied to the upload reference', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ percent: 42, stage: 'Vision provider', status: 'running' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const provider: AIProvider = { id: 'provider-vision', name: 'Vision', baseUrl: 'http://localhost/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { vision: true } };
  try {
    await api.extractOcr('upload-1', provider, 'vision-model', { x: 0, y: 75, w: 100, h: 25 }, 2, false, undefined, 'ocr-progress-1');
    await api.getExtractionProgress('ocr-progress-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 2);
  const extractionBody = JSON.parse(String(calls[0]?.init?.body)) as { uploadId: string; progressId: string; roi: { x: number; y: number; w: number; h: number } };
  assert.equal(extractionBody.uploadId, 'upload-1');
  assert.equal(extractionBody.progressId, 'ocr-progress-1');
  assert.deepEqual(extractionBody.roi, { x: 0, y: 75, w: 100, h: 25 });
  assert.equal(calls[1]?.init?.method, undefined);
  assert.equal(calls[1]?.init?.body, undefined);
  assert.match(calls[1]?.url || '', /\/api\/extract\/progress\/ocr-progress-1$/);
});
