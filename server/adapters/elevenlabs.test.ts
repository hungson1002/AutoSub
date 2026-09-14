import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider } from '../types';
import { transcribe } from './elevenlabs';

test('ElevenLabs requests diarization and returns separate speaker turns', async () => {
  const provider: AIProvider = { id: 'eleven', name: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io/v1', enabled: true, models: [], providerType: 'elevenlabs', authType: 'none', capabilities: { stt: true } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    assert.equal(form.get('diarize'), 'true');
    assert.equal(form.get('timestamps_granularity'), 'word');
    return new Response(JSON.stringify({ text: 'Xin chào', words: [
      { text: 'Xin ', start: 0, end: .2, speaker_id: 'speaker_0', type: 'word' },
      { text: 'chào', start: .3, end: .6, speaker_id: 'speaker_1', type: 'word' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await transcribe(provider, 'scribe_v2', Buffer.from('audio'), 'sample.wav', 'vi');
    assert.deepEqual(result.segments.map((segment) => segment.speakerId), ['speaker_0', 'speaker_1']);
  } finally { globalThis.fetch = originalFetch; }
});
