import type { AIModel, AIProvider, ProviderAuthType, ProviderCapabilities, ProviderEndpoints, ProviderType } from '../types';

export const providerTypeOptions: Array<[ProviderType, string]> = [
  ['auto', 'Auto detect'],
  ['vieneu-local', 'VieNeu Local Clone (giọng Việt)'],
  ['openai-compatible', 'OpenAI-compatible'],
  ['groq', 'Groq'],
  ['elevenlabs', 'ElevenLabs'],
  ['whisper-local', 'Whisper Local (không quota)'],
  ['edge-tts', 'Microsoft Edge TTS (2 giọng Việt)'],
  ['hiiu-tts', 'HiiuTTS'],
  ['capcut-tts', 'CapCut TTS (local bridge)'],
  ['vbee', 'Vbee'],
  ['custom', 'Custom'],
];

export type DetectedProviderType = Exclude<ProviderType, 'auto'>;

export function detectProviderType(baseUrl: string): DetectedProviderType | undefined {
  let hostname = '';
  try { hostname = new URL(/^https?:\/\//i.test(baseUrl.trim()) ? baseUrl.trim() : `https://${baseUrl.trim()}`).hostname.toLowerCase(); } catch { return undefined; }
  if (hostname === 'api.groq.com') return 'groq';
  if (hostname === 'api.elevenlabs.io') return 'elevenlabs';
  if (hostname === 'hiiu-tts.netlify.app') return 'hiiu-tts';
  return undefined;
}

export function inferProviderType(baseUrl: string): DetectedProviderType {
  return detectProviderType(baseUrl) || 'openai-compatible';
}

export function resolvedProviderType(provider: Pick<AIProvider, 'providerType' | 'baseUrl'>): DetectedProviderType {
  return provider.providerType === 'auto' ? inferProviderType(provider.baseUrl) : provider.providerType;
}

export function isPresetProvider(providerType: ProviderType) {
  return providerType === 'groq' || providerType === 'elevenlabs' || providerType === 'whisper-local' || providerType === 'edge-tts' || providerType === 'vieneu-local' || providerType === 'hiiu-tts' || providerType === 'capcut-tts';
}

export function hasKnownPreset(provider: Pick<AIProvider, 'providerType' | 'baseUrl'>) {
  return isPresetProvider(provider.providerType === 'auto' ? detectProviderType(provider.baseUrl) || 'custom' : provider.providerType);
}

export function presetCapabilities(providerType: ProviderType): ProviderCapabilities {
  if (providerType === 'groq') return { chat: true, stt: true, tts: true };
  if (providerType === 'elevenlabs') return { stt: true, tts: true };
  if (providerType === 'whisper-local') return { stt: true };
  if (providerType === 'edge-tts') return { tts: true };
  if (providerType === 'vieneu-local') return { tts: true };
  if (providerType === 'hiiu-tts') return { tts: true };
  if (providerType === 'capcut-tts') return { tts: true };
  return {};
}

export function presetAuthType(providerType: ProviderType): ProviderAuthType {
  return providerType === 'elevenlabs' ? 'custom-header' : providerType === 'whisper-local' || providerType === 'edge-tts' || providerType === 'vieneu-local' || providerType === 'hiiu-tts' || providerType === 'capcut-tts' ? 'none' : 'bearer';
}

export function presetAuth(providerType: ProviderType) {
  if (providerType === 'elevenlabs') return { authType: 'custom-header' as const, authHeaderName: 'xi-api-key', authPrefix: '' };
  if (providerType === 'whisper-local') return { authType: 'none' as const, authHeaderName: undefined, authPrefix: undefined };
  if (providerType === 'edge-tts') return { authType: 'none' as const, authHeaderName: undefined, authPrefix: undefined };
  if (providerType === 'vieneu-local') return { authType: 'none' as const, authHeaderName: undefined, authPrefix: undefined };
  if (providerType === 'hiiu-tts') return { authType: 'none' as const, authHeaderName: undefined, authPrefix: undefined };
  if (providerType === 'capcut-tts') return { authType: 'none' as const, authHeaderName: undefined, authPrefix: undefined };
  return { authType: 'bearer' as const, authHeaderName: undefined, authPrefix: 'Bearer' };
}

export function presetEndpoints(providerType: ProviderType): ProviderEndpoints {
  if (providerType === 'elevenlabs') return { models: '/models', voices: '/voices', stt: '/speech-to-text', tts: '/text-to-speech/{voice_id}' };
  if (providerType === 'whisper-local') return {};
  if (providerType === 'edge-tts') return {};
  if (providerType === 'vieneu-local') return {};
  if (providerType === 'hiiu-tts') return { models: '/tts/models', tts: '/audio/speech' };
  if (providerType === 'capcut-tts') return { models: '/models', voices: '/voices', tts: '/audio/speech' };
  if (providerType === 'groq' || providerType === 'openai-compatible' || providerType === 'vbee') return { models: '/models', chat: '/chat/completions', stt: '/audio/transcriptions', tts: '/audio/speech' };
  return {};
}

export function presetBaseUrl(providerType: ProviderType, current = '') {
  if (providerType === 'groq') return 'https://api.groq.com/openai/v1';
  if (providerType === 'elevenlabs') return 'https://api.elevenlabs.io/v1';
  if (providerType === 'whisper-local') return 'local://whisper.cpp';
  if (providerType === 'edge-tts') return 'local://edge-tts';
  if (providerType === 'vieneu-local') return 'local://vieneu';
  if (providerType === 'hiiu-tts') return 'https://hiiu-tts.netlify.app/v1';
  if (providerType === 'capcut-tts') return 'local://capcut-tts';
  return current;
}

/** Built-in CPU-only STT. Runtime and the selected model are downloaded once by the backend. */
export function createWhisperLocalProvider(): AIProvider {
  return normalizeProvider({
    id: 'whisper-local',
    name: 'Whisper Local',
    baseUrl: 'local://whisper.cpp',
    enabled: true,
    models: [
      { id: 'small-q5_1', name: 'Whisper Small Q5 · 181 MiB · khuyên dùng', capabilities: { stt: true }, raw: { detail: 'Nhanh · tự tải lần đầu' } },
      { id: 'medium-q5_0', name: 'Whisper Medium Q5 · 514 MiB · chính xác hơn', capabilities: { stt: true }, raw: { detail: 'Chậm hơn · tự tải lần đầu' } },
    ],
    providerType: 'whisper-local',
    authType: 'none',
    capabilities: { stt: true },
  });
}

export function createEdgeTtsProvider(): AIProvider {
  return normalizeProvider({
    id: 'edge-tts-local',
    name: 'Microsoft Edge TTS',
    baseUrl: 'local://edge-tts',
    enabled: true,
    models: [{ id: 'edge-tts', name: 'Microsoft Edge TTS', capabilities: { tts: true } }],
    providerType: 'edge-tts',
    authType: 'none',
    capabilities: { tts: true },
    voices: [
      { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My · Nữ', language: 'vi-VN' },
      { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh · Nam', language: 'vi-VN' },
    ],
  });
}

export function createVieneuLocalProvider(): AIProvider {
  return normalizeProvider({
    id: 'vieneu-local',
    name: 'VieNeu Local Clone',
    baseUrl: 'local://vieneu',
    enabled: true,
    models: [{ id: 'vieneu-v3-turbo', name: 'VieNeu-TTS v3 Turbo · CPU/ONNX · 48 kHz', capabilities: { tts: true } }],
    providerType: 'vieneu-local',
    authType: 'none',
    capabilities: { tts: true },
    voices: [],
  });
}

export function ensureBuiltInProviders(providers: AIProvider[]) {
  const output = [...providers];
  if (!output.some((provider) => provider.providerType === 'whisper-local' || provider.id === 'whisper-local')) output.push(createWhisperLocalProvider());
  if (!output.some((provider) => provider.providerType === 'edge-tts' || provider.id === 'edge-tts-local')) output.push(createEdgeTtsProvider());
  if (!output.some((provider) => provider.providerType === 'vieneu-local' || provider.id === 'vieneu-local')) output.push(createVieneuLocalProvider());
  if (!output.some((provider) => provider.providerType === 'capcut-tts' || provider.id === 'capcut-tts-local')) output.push(createCapCutTtsProvider());
  return output;
}

export function isRequiredTtsProvider(provider: Pick<AIProvider, 'id' | 'providerType'>) {
  return provider.providerType === 'vieneu-local'
    || provider.id === 'vieneu-local'
    || provider.providerType === 'capcut-tts'
    || provider.id === 'capcut-tts-local';
}

/** Built-in local provider entry. It becomes usable after the bridge dependency is installed. */
export function createCapCutTtsProvider(): AIProvider {
  return normalizeProvider({
    id: 'capcut-tts-local',
    name: 'CapCut TTS',
    baseUrl: 'local://capcut-tts',
    enabled: true,
    models: [{ id: 'capcut-tts', name: 'CapCut TTS', capabilities: { tts: true } }],
    providerType: 'capcut-tts',
    authType: 'none',
    capabilities: { tts: true },
    voices: [
      { id: 'BV421_vivn_streaming', name: 'Nhỏ Ngọt Ngào', language: 'vi-VN', resourceId: '7252594014782755330' },
      { id: 'vi_female_huong', name: 'Giọng Nữ Phổ Thông', language: 'vi-VN', resourceId: '7264854897953083905' },
      { id: 'BV074_streaming', name: 'Cô Gái Hoạt Ngôn', language: 'vi-VN', resourceId: '7102355709945188865' },
      { id: 'BV562_streaming', name: 'Mai', language: 'vi-VN', resourceId: '7483736254694035984' },
    ],
  });
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
