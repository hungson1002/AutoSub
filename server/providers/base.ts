import type { AIProvider, ProviderAuthType, ProviderCapability, ProviderType } from '../types';

export function inferProviderType(baseUrl: string): Exclude<ProviderType, 'auto'> {
  let hostname = '';
  try { hostname = new URL(/^https?:\/\//i.test(baseUrl.trim()) ? baseUrl.trim() : `https://${baseUrl.trim()}`).hostname.toLowerCase(); } catch { return 'openai-compatible'; }
  if (hostname === 'api.groq.com') return 'groq';
  if (hostname === 'api.elevenlabs.io') return 'elevenlabs';
  if (hostname === 'hiiu-tts.netlify.app') return 'hiiu-tts';
  return 'openai-compatible';
}

export function resolveProviderType(provider: Pick<AIProvider, 'providerType' | 'baseUrl'>): Exclude<ProviderType, 'auto'> {
  return provider.providerType === 'auto' ? inferProviderType(provider.baseUrl) : provider.providerType;
}

export function buildAuthHeaders(provider: AIProvider): Record<string, string> {
  const apiKey = provider.apiKey?.trim();
  const providerType = resolveProviderType(provider);
  const presetType: ProviderAuthType = providerType === 'elevenlabs' ? 'custom-header' : providerType === 'whisper-local' || providerType === 'edge-tts' || providerType === 'vieneu-local' || providerType === 'hiiu-tts' || providerType === 'capcut-tts' ? 'none' : 'bearer';
  const useOverride = provider.providerType === 'custom' || provider.overrideAuthentication === true;
  const type: ProviderAuthType = useOverride ? provider.authType || presetType : presetType;
  if (!apiKey || type === 'none' || type === 'query-param') return {};
  if (type === 'xi-api-key') return { 'xi-api-key': apiKey };
  if (type === 'x-api-key') return { 'x-api-key': apiKey };
  if (type === 'api-key') return { 'api-key': apiKey };
  if (type === 'custom-header') {
    const name = (useOverride ? provider.authHeaderName : providerType === 'elevenlabs' ? 'xi-api-key' : provider.authHeaderName)?.trim();
    if (!name) return {};
    const prefix = useOverride ? provider.authPrefix : providerType === 'elevenlabs' ? '' : provider.authPrefix;
    return { [name]: prefix ? `${prefix} ${apiKey}` : apiKey };
  }
  return { Authorization: `${useOverride ? provider.authPrefix || 'Bearer' : 'Bearer'} ${apiKey}` };
}

export function withAuthQuery(url: string, provider: AIProvider): string {
  if (!(provider.providerType === 'custom' || provider.overrideAuthentication === true) || provider.authType !== 'query-param' || !provider.apiKey?.trim() || !provider.queryParamName?.trim()) return url;
  const output = new URL(url);
  output.searchParams.set(provider.queryParamName.trim(), provider.apiKey.trim());
  return output.toString();
}

export function providerBase(provider: AIProvider): string {
  let raw = provider.baseUrl.trim().replace(/\/+$/, '');
  try {
    const url = new URL(raw);
    const type = resolveProviderType(provider);
    if (type === 'openai-compatible' && (url.hostname === 'api.opencode.ai' || (url.hostname === 'opencode.ai' && !url.pathname.startsWith('/zen/')))) return 'https://opencode.ai/zen/v1';
    const endpointSuffixes = ['/audio/speech', '/audio/transcriptions', '/audio/translations', '/chat/completions', '/text-to-speech', '/speech-to-text', '/tts/models', '/models', '/voices'];
    const suffix = endpointSuffixes.find((item) => url.pathname.toLowerCase().endsWith(item));
    if (suffix) {
      url.pathname = url.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
      raw = `${url.origin}${url.pathname}`;
    }
  } catch { /* Keep the original URL so the provider error is explicit. */ }
  return raw;
}

export function endpoint(provider: AIProvider, key: keyof NonNullable<AIProvider['endpoints']>, fallback: string): string {
  const type = resolveProviderType(provider);
  const canOverride = provider.providerType === 'custom' || provider.overrideEndpoints === true;
  const preset: Partial<Record<keyof NonNullable<AIProvider['endpoints']>, string>> = type === 'elevenlabs'
    ? { models: '/models', voices: '/voices', stt: '/speech-to-text', tts: '/text-to-speech/{voice_id}' }
    : type === 'hiiu-tts'
      ? { models: '/tts/models', tts: '/audio/speech' }
      : type === 'capcut-tts'
        ? { models: '/models', voices: '/voices', tts: '/audio/speech' }
      : { models: '/models', chat: '/chat/completions', stt: '/audio/transcriptions', tts: '/audio/speech' };
  const configured = canOverride ? provider.endpoints?.[key] : undefined;
  const target = configured || preset[key] || fallback;
  if (/^https?:\/\//i.test(target)) return target.replace(/\/+$/, '');
  return `${providerBase(provider)}${target.startsWith('/') ? target : `/${target}`}`;
}

export function supportsProviderCapability(provider: AIProvider, capability: ProviderCapability) {
  return provider.capabilities?.[capability] === true;
}
