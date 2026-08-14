import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIProvider } from '../types';
import { EDGE_TTS_MODEL, EDGE_VIETNAMESE_VOICES, listModels, synthesize, synthesizeBatch } from './edgeTts';

const provider: AIProvider = {
  id: 'edge-tts-local', name: 'Microsoft Edge TTS', baseUrl: 'local://edge-tts', enabled: true,
  models: [], providerType: 'edge-tts', authType: 'none', capabilities: { tts: true },
};

test('Edge TTS exposes one TTS model and the two stable Vietnamese voices', async () => {
  assert.deepEqual((await listModels(provider)).map((model) => model.id), [EDGE_TTS_MODEL]);
  assert.deepEqual(EDGE_VIETNAMESE_VOICES.map((voice) => voice.id), ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural']);
});

test('Edge TTS rejects an unknown voice before contacting the online service', async () => {
  await assert.rejects(() => synthesize(provider, EDGE_TTS_MODEL, 'vi-VN-Unknown', 'Xin chào', {}), /Hoài My hoặc Nam Minh/);
});

test('Edge TTS validates review batches before contacting the online service', async () => {
  await assert.rejects(() => synthesizeBatch(provider, EDGE_TTS_MODEL, EDGE_VIETNAMESE_VOICES[0].id, [], {}), /từ 1 đến 32 đoạn/);
  await assert.rejects(() => synthesizeBatch(provider, EDGE_TTS_MODEL, EDGE_VIETNAMESE_VOICES[0].id, [''], {}), /từ 1 đến 32 đoạn/);
});
