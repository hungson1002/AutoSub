import type { AIProvider, Capability, ModelPreferences } from '../types';

export function isCapabilityModelPassed(preferences: ModelPreferences, providerId: string, capability: Capability, modelId: string) {
  if (!providerId || !modelId) return false;
  if (preferences[`${providerId}::${capability}::${modelId}`]?.status === 'passed') return true;
  return capability === 'translation' && preferences[`${providerId}::${modelId}`]?.status === 'passed';
}

export function passedModelOptions(provider: AIProvider | undefined, capability: Capability, preferences: ModelPreferences, extraModelIds: string[] = []) {
  if (!provider) return [];
  const providerModels = new Map(provider.models.map((model) => [model.id, model]));
  const candidateIds = [...providerModels.keys(), ...extraModelIds];
  return [...new Set(candidateIds)]
    .filter((modelId) => isCapabilityModelPassed(preferences, provider.id, capability, modelId))
    .map((modelId) => {
      const model = providerModels.get(modelId);
      const capabilityLabel = capability === 'vision' ? 'Vision' : capability === 'stt' ? 'STT' : capability === 'tts' ? 'TTS' : 'Translation';
      return {
        value: modelId,
        label: model?.name || modelId,
        description: model?.name && model.name !== modelId ? `${modelId} · ${capabilityLabel} đã test` : `${capabilityLabel} đã test`,
      };
    });
}
