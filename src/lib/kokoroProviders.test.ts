import assert from 'node:assert/strict';
import test from 'node:test';
import { createKokoroLocalProvider, ensureBuiltInProviders, isPresetProvider, presetBaseUrl, presetCapabilities, presetAuthType } from './providers';

test('Kokoro is registered as an optional built-in local TTS provider', () => {
  const provider = createKokoroLocalProvider();
  assert.equal(provider.providerType, 'kokoro-local');
  assert.equal(provider.baseUrl, 'local://kokoro');
  assert.equal(provider.capabilities.tts, true);
  assert.equal(provider.voices?.length, 27);
  assert.equal(isPresetProvider('kokoro-local'), true);
  assert.equal(presetBaseUrl('kokoro-local'), 'local://kokoro');
  assert.equal(presetCapabilities('kokoro-local').tts, true);
  assert.equal(presetAuthType('kokoro-local'), 'none');
  assert.ok(ensureBuiltInProviders([]).some((item) => item.providerType === 'kokoro-local'));
});
