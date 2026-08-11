import test from 'node:test';
import assert from 'node:assert/strict';
import type { AIProvider, ModelPreferences } from '../types';
import { isCapabilityModelPassed, passedModelOptions } from './modelTests';

const provider: AIProvider = {
  id: 'provider-1',
  name: 'Provider 1',
  baseUrl: 'https://example.test/v1',
  enabled: true,
  models: [{ id: 'tested-model', name: 'Tested Model' }, { id: 'unknown-model' }],
  providerType: 'openai-compatible',
  authType: 'bearer',
  capabilities: { chat: true, vision: true, stt: true },
};

test('only returns models that passed the requested capability test', () => {
  const preferences: ModelPreferences = {
    'provider-1::vision::tested-model': { bookmarked: false, status: 'passed' },
    'provider-1::vision::unknown-model': { bookmarked: false, status: 'failed' },
  };

  assert.deepEqual(passedModelOptions(provider, 'vision', preferences).map((option) => option.value), ['tested-model']);
  assert.equal(isCapabilityModelPassed(preferences, provider.id, 'stt', 'tested-model'), false);
});

test('keeps the legacy passed status only for Translation', () => {
  const preferences: ModelPreferences = {
    'provider-1::tested-model': { bookmarked: false, status: 'passed' },
  };

  assert.equal(isCapabilityModelPassed(preferences, provider.id, 'translation', 'tested-model'), true);
  assert.equal(isCapabilityModelPassed(preferences, provider.id, 'vision', 'tested-model'), false);
});

test('includes a manually configured model after it passes testing', () => {
  const preferences: ModelPreferences = {
    'provider-1::stt::manual-model': { bookmarked: false, status: 'passed' },
  };

  assert.deepEqual(passedModelOptions(provider, 'stt', preferences, ['manual-model']).map((option) => option.value), ['manual-model']);
});
