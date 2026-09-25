import assert from 'node:assert/strict';
import test from 'node:test';
import { isLikelyVietnamese, KOKORO_ENGLISH_VOICES } from '../../shared/kokoroVoices';
import { KOKORO_LOCAL_MODEL, languageForKokoroVoice, testConnection as testKokoroConnection } from './kokoroLocal';
import { listModels, listVoices, synthesize } from './index';
import type { AIProvider } from '../types';

const provider: AIProvider = {
  id: 'kokoro-local', name: 'Kokoro TTS Local', baseUrl: 'local://kokoro', enabled: true,
  models: [], providerType: 'kokoro-local', authType: 'none', capabilities: { tts: true },
};

test('Kokoro exposes the local model and English preset voices without starting its runtime', async () => {
  assert.equal((await listModels(provider))[0]?.id, KOKORO_LOCAL_MODEL);
  const voices = await listVoices(provider);
  assert.equal(voices.length, 27);
  assert.equal(voices[0]?.id, 'af_alloy');
  assert.equal(voices.at(-1)?.id, 'bm_lewis');
  assert.equal(languageForKokoroVoice('af_sarah'), 'en-us');
  assert.equal(languageForKokoroVoice('bf_emma'), 'en-gb');
  assert.equal(languageForKokoroVoice('vi-VN-HoaiMyNeural'), undefined);
  assert.match((await testKokoroConnection(provider)).warning, /354 MB/);
  assert.equal(KOKORO_ENGLISH_VOICES.length, voices.length);
  assert.equal(isLikelyVietnamese('Xin chào, bạn.'), true);
  assert.equal(isLikelyVietnamese('Tell me one surprising detail.'), false);
  await assert.rejects(synthesize(provider, KOKORO_LOCAL_MODEL, 'af_sarah', 'Xin chào bạn, đây là tiếng Việt.', {}), /có vẻ là tiếng Việt/);
});
