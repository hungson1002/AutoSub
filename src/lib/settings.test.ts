import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, type AppSettings } from '../types';
import { capabilityAssignments, normalizeSettings, updateCapabilityAssignments } from './settings';

const assignment = (providerId: string, model: string) => ({ providerId, model });

test('normalizes legacy single assignments into per-capability provider lists', () => {
  const settings = normalizeSettings({
    assignments: { ...defaultSettings.assignments, translation: assignment('legacy', 'legacy-model') },
  });

  assert.deepEqual(settings.providersByCapability.translation, [assignment('legacy', 'legacy-model')]);
  assert.deepEqual(capabilityAssignments(settings, 'translation'), [assignment('legacy', 'legacy-model')]);
});

test('stores multiple provider/model choices and keeps the first as default', () => {
  const initial = normalizeSettings(defaultSettings);
  const choices = [assignment('groq', 'whisper-large-v3'), assignment('local', 'whisper-medium')];
  const settings = updateCapabilityAssignments(initial, 'stt', choices);

  assert.deepEqual(settings.providersByCapability.stt, choices);
  assert.deepEqual(settings.assignments.stt, choices[0]);
  assert.deepEqual(capabilityAssignments(settings, 'stt'), choices);
});

test('keeps settings compatible when only providersByCapability is supplied', () => {
  const partial: Partial<AppSettings> = { providersByCapability: { ...defaultSettings.providersByCapability, tts: [assignment('local', 'piper')] } };
  const settings = normalizeSettings(partial);

  assert.deepEqual(settings.assignments.tts, assignment('local', 'piper'));
});
