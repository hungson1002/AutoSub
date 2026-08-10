import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AIProvider } from '../types';
import { CAPCUT_TTS_MODEL, capCutTtsFailure, capcutVoiceResourceId, listModels, synthesize } from './capcut';
import { capCutBridgeEnvironment } from '../services/capcutTtsBridge';

const provider: AIProvider = {
  id: 'capcut-local', name: 'CapCut TTS', baseUrl: 'local://capcut-tts', enabled: true,
  models: [], providerType: 'capcut-tts', authType: 'none', capabilities: { tts: true },
};

test('exposes the built-in CapCut TTS model without a remote models request', async () => {
  assert.deepEqual(await listModels(provider), [{ id: CAPCUT_TTS_MODEL, name: 'CapCut TTS', capabilities: { tts: true } }]);
});

test('requires a selected CapCut voice before spawning the bridge', async () => {
  await assert.rejects(() => synthesize(provider, CAPCUT_TTS_MODEL, '', 'Xin chào', {}), /cần chọn Voice ID/i);
});

test('preserves the stable CapCut resource id for a selected voice', () => {
  assert.equal(capcutVoiceResourceId({ ...provider, voices: [{ id: 'BV074_streaming', resourceId: '710235489' }] }, 'BV074_streaming'), '710235489');
  assert.equal(capcutVoiceResourceId(provider, 'missing'), undefined);
});

test('turns CapCut invalid-text payloads into a non-retryable Vietnamese error', () => {
  const error = capCutTtsFailure(new Error("CapCut TTS task failed: {'err_code': 40402002, 'err_msg': 'TTSInvalidText'}"));
  assert.equal(error.status, 422);
  assert.match(error.message, /không đọc được nội dung/i);
  assert.match(error.detail || '', /TTSInvalidText/);
});

test('forces UTF-8 at the Node to Python bridge boundary', () => {
  const environment = capCutBridgeEnvironment({ PYTHONIOENCODING: 'cp1258' });
  assert.equal(environment.PYTHONIOENCODING, 'utf-8');
  assert.equal(environment.PYTHONUTF8, '1');
});
