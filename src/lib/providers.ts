import type { AIModel, AIProvider, ProviderAuthType, ProviderCapabilities, ProviderEndpoints, ProviderType } from '../types';

export const providerTypeOptions: Array<[ProviderType, string]> = [
  ['auto', 'Auto detect'],
  ['openai-compatible', 'OpenAI-compatible'],
  ['groq', 'Groq'],
  ['elevenlabs', 'ElevenLabs'],
  ['vbee', 'Vbee'],
  ['custom', 'Custom'],
];

export type DetectedProviderType = Exclude<ProviderType, 'auto'>;

export function detectProviderType(baseUrl: string): DetectedProviderType | undefined {
  let hostname = '';
  try { hostname = new URL(/^https?:\/\//i.test(baseUrl.trim()) ? baseUrl.trim() : `https://${baseUrl.trim()}`).hostname.toLowerCase(); } catch { return undefined; }
  if (hostname === 'api.groq.com') return 'groq';
  if (hostname === 'api.elevenlabs.io') return 'elevenlabs';
  return undefined;
}

export function inferProviderType(baseUrl: string): DetectedProviderType {
  return detectProviderType(baseUrl) || 'openai-compatible';
}

export function resolvedProviderType(provider: Pick<AIProvider, 'providerType' | 'baseUrl'>): DetectedProviderType {
  return provider.providerType === 'auto' ? inferProviderType(provider.baseUrl) : provider.providerType;
}

export function isPresetProvider(providerType: ProviderType) {
  return providerType === 'groq' || providerType === 'elevenlabs';
}

export function hasKnownPreset(provider: Pick<AIProvider, 'providerType' | 'baseUrl'>) {
  return isPresetProvider(provider.providerType === 'auto' ? detectProviderType(provider.baseUrl) || 'custom' : provider.providerType);
}

export function presetCapabilities(providerType: ProviderType): ProviderCapabilities {
  if (providerType === 'groq') return { chat: true, stt: true, tts: true };
  if (providerType === 'elevenlabs') return { stt: true, tts: true };
  return {};
}

export function presetAuthType(providerType: ProviderType): ProviderAuthType {
  return providerType === 'elevenlabs' ? 'custom-header' : 'bearer';
}

export function presetAuth(providerType: ProviderType) {
  if (providerType === 'elevenlabs') return { authType: 'custom-header' as const, authHeaderName: 'xi-api-key', authPrefix: '' };
  return { authType: 'bearer' as const, authHeaderName: undefined, authPrefix: 'Bearer' };
}

export function presetEndpoints(providerType: ProviderType): ProviderEndpoints {
  if (providerType === 'elevenlabs') return { models: '/models', voices: '/voices', stt: '/speech-to-text', tts: '/text-to-speech/{voice_id}' };
  if (providerType === 'groq' || providerType === 'openai-compatible' || providerType === 'vbee') return { models: '/models', chat: '/chat/completions', stt: '/audio/transcriptions', tts: '/audio/speech' };
  return {};
}

export function presetBaseUrl(providerType: ProviderType, current = '') {
  if (providerType === 'groq') return 'https://api.groq.com/openai/v1';
  if (providerType === 'elevenlabs') return 'https://api.elevenlabs.io/v1';
  return current;
}

export function inferModelCapabilities(id: string): ProviderCapabilities {
  const value = id.toLowerCase();
  if (value.includes('whisper') || value.includes('transcri')) return { stt: true };
  if (value.includes('tts') || value.includes('orpheus') || value.includes('speech')) return { tts: true };
  if (value.includes('vision') || value.includes('vl')) return { chat: true, vision: true };
  return { chat: true };
}

function normalizeModels(models: AIModel[]) {
  return models.map((model) => ({ ...model, capabilities: model.capabilities && Object.keys(model.capabilities).length ? model.capabilities : inferModelCapabilities(model.id) }));
}

export function normalizeProvider(provider: Partial<AIProvider> & Pick<AIProvider, 'id' | 'name' | 'baseUrl' | 'enabled' | 'models'>): AIProvider {
  const providerType = provider.providerType || 'auto';
  const detected = providerType === 'auto' ? detectProviderType(provider.baseUrl) : providerType;
  const resolved = detected || 'openai-compatible';
  const knownPreset = Boolean(detected && isPresetProvider(detected));
  const overrideAuthentication = provider.overrideAuthentication ?? providerType === 'custom';
  const overrideCapabilities = provider.overrideCapabilities ?? (knownPreset ? false : providerType !== 'auto');
  const preset = presetAuth(resolved);
  const suppliedCapabilities: ProviderCapabilities = {
    ...(typeof provider.capabilities?.chat === 'boolean' ? { chat: provider.capabilities.chat } : {}),
    ...(typeof provider.capabilities?.vision === 'boolean' ? { vision: provider.capabilities.vision } : {}),
    ...(typeof provider.capabilities?.stt === 'boolean' ? { stt: provider.capabilities.stt } : {}),
    ...(typeof provider.capabilities?.tts === 'boolean' ? { tts: provider.capabilities.tts } : {}),
  };
  const defaultOpenAIChat = providerType === 'openai-compatible' && typeof provider.capabilities?.chat !== 'boolean' ? { chat: true } : {};
  const capabilities = knownPreset && !overrideCapabilities
    ? presetCapabilities(resolved)
    : providerType === 'auto' && !overrideCapabilities
      ? {}
      : { ...defaultOpenAIChat, ...suppliedCapabilities };
  return {
    ...provider,
    providerType,
    authType: overrideAuthentication ? provider.authType || preset.authType : preset.authType,
    authHeaderName: overrideAuthentication ? provider.authHeaderName : preset.authHeaderName,
    authPrefix: overrideAuthentication ? provider.authPrefix : preset.authPrefix,
    overrideAuthentication,
    overrideCapabilities,
    overrideEndpoints: provider.overrideEndpoints ?? providerType === 'custom',
    capabilities,
    models: normalizeModels(provider.models || []),
  };
}
