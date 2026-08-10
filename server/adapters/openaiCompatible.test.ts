import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AIProvider } from '../types';
import { listModels, normalizeSttLanguage, synthesize, transcribe, translateBatch } from './openaiCompatible';

test('normalizes UI language labels to provider language codes', () => {
  assert.equal(normalizeSttLanguage('中文'), 'zh');
  assert.equal(normalizeSttLanguage('Tiếng Việt'), 'vi');
  assert.equal(normalizeSttLanguage('Auto Detect'), undefined);
  assert.equal(normalizeSttLanguage('en'), 'en');
});

test('uses HiiuTTS model catalog and treats each model as a TTS voice', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'hiiu-provider', name: 'HiiuTTS', baseUrl: 'https://hiiu-tts.netlify.app/v1', enabled: true,
    models: [], providerType: 'hiiu-tts', authType: 'none', capabilities: { tts: true },
  };
  let requestedUrl = '';
  globalThis.fetch = (async (input: string | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ object: 'list', data: [{ id: 'Ban Mai', object: 'model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const models = await listModels(provider);
    assert.equal(requestedUrl, 'https://hiiu-tts.netlify.app/v1/tts/models');
    assert.deepEqual(models[0]?.capabilities, { chat: true, tts: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('omits a separate voice field when synthesizing with HiiuTTS', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'hiiu-provider', name: 'HiiuTTS', baseUrl: 'https://hiiu-tts.netlify.app/v1', enabled: true,
    models: [], providerType: 'hiiu-tts', authType: 'none', capabilities: { tts: true },
  };
  let request: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch;
  try {
    const audio = await synthesize(provider, 'Ban Mai', '', 'Xin chào', { format: 'wav' });
    assert.equal(audio.length, 4);
    assert.deepEqual(request, { model: 'Ban Mai', input: 'Xin chào', speed: 1, response_format: 'wav' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requests word-level timestamps when verbose STT JSON is available', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'word-provider', name: 'Word provider', baseUrl: 'http://provider.test/v1', enabled: true,
    models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { stt: true },
  };
  let requestBody: FormData | undefined;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    requestBody = init?.body as FormData;
    return new Response(JSON.stringify({ text: 'Hello', segments: [{ start: 0, end: 1, text: 'Hello', words: [{ word: 'Hello', start: 0.1, end: 0.8 }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await transcribe(provider, 'whisper-large-v3-turbo', Buffer.from('audio'), 'audio.wav', 'Auto Detect');
    assert.deepEqual(result.segments[0]?.words, [{ word: 'Hello', start: 0.1, end: 0.8 }]);
    assert.equal(requestBody?.get('response_format'), 'verbose_json');
    assert.deepEqual(requestBody?.getAll('timestamp_granularities[]'), ['segment', 'word']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps translation results in input id order and uses a strict one-to-one prompt', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'translation-provider', name: 'Translation provider', baseUrl: 'http://provider.test/v1', enabled: true,
    models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true },
  };
  let request: { messages?: Array<{ role: string; content: string }> } | undefined;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    request = JSON.parse(String(init?.body)) as typeof request;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: 'b', translation: 'B' }, { id: 'a', translation: 'A' }] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await translateBatch(provider, 'model', [
      { id: 'a', text: 'Source A', targetDurationMs: 1000 },
      { id: 'b', text: 'Source B', targetDurationMs: 1000 },
    ], 'Chinese', 'Vietnamese', 'Natural', '', []);
    assert.deepEqual(result, [{ id: 'a', translation: 'A' }, { id: 'b', translation: 'B' }]);
    assert.match(request?.messages?.[0]?.content || '', /one-to-one/i);
    assert.match(request?.messages?.[0]?.content || '', /Never merge/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects Chinese source text echoed unchanged for Vietnamese translation', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'translation-provider', name: 'Translation provider', baseUrl: 'http://provider.test/v1', enabled: true,
    models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true },
  };
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items: [{ id: 'a', translation: '你为什么不杀我' }] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    await assert.rejects(
      () => translateBatch(provider, 'model', [{ id: 'a', text: '你为什么不杀我', targetDurationMs: 1000 }], 'Chinese', 'Vietnamese', 'Natural', '', []),
      /nguyên văn tiếng Trung/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
