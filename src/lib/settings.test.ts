import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, type AppSettings } from '../types';
import { capabilityAssignments, configuredAssignmentChoices, normalizeSettings, updateCapabilityAssignments, reconcileLocalSttAssignments } from './settings';

test('removed local STT models fall back without changing cloud or other capabilities', () => {
  const original = updateCapabilityAssignments(defaultSettings, 'stt', [{ providerId: 'qwen', model: 'qwen3-asr-1.7b' }]);
  const updated = reconcileLocalSttAssignments(original, new Map([['qwen', []], ['whisper', [{ id: 'faster-small-int8' }]]]));
  assert.deepEqual(updated.assignments.stt, { providerId: 'whisper', model: 'faster-small-int8' });
  assert.equal(updated.assignments.tts, original.assignments.tts);
  const cloud = updateCapabilityAssignments(defaultSettings, 'stt', [{ providerId: 'groq', model: 'cloud-stt' }]);
  assert.equal(reconcileLocalSttAssignments(cloud, new Map([['qwen', []]])), cloud);
  assert.equal(reconcileLocalSttAssignments(original, new Map()), original); // Offline backend cannot remove choices.
});

test('configured choices hide an empty duplicate when the provider already has a model', () => {
  assert.deepEqual(configuredAssignmentChoices([
    assignment('vieneu', 'vieneu-v3-turbo'),
    assignment('vieneu', ''),
    assignment('edge', 'edge-tts'),
    assignment('edge', ''),
    assignment('unfinished', ''),
  ]), [
    assignment('vieneu', 'vieneu-v3-turbo'),
    assignment('edge', 'edge-tts'),
    assignment('unfinished', ''),
  ]);
});

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
