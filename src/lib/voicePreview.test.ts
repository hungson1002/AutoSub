import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider } from '../types';
import { loadVoicePreview, VI_VOICE_PREVIEW_TEXT } from './voicePreview';

test('voice previews share in-flight generation and remain instant from memory', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as { text?: string };
    assert.equal(body.text, VI_VOICE_PREVIEW_TEXT);
    return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  }) as typeof fetch;
  const provider = { id: `preview-test-${Date.now()}`, baseUrl: 'http://voice.test', name: 'Voice test' } as AIProvider;
  try {
    const first = loadVoicePreview(provider, 'model', 'voice', 1);
    const shared = loadVoicePreview(provider, 'model', 'voice', 1);
    assert.equal(await first, await shared);
    assert.equal(await loadVoicePreview(provider, 'model', 'voice', 1), await first);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
