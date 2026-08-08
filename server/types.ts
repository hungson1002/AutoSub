export type ProviderCapability = 'chat' | 'vision' | 'stt' | 'tts';
export type ProviderType = 'auto' | 'openai-compatible' | 'groq' | 'elevenlabs' | 'vbee' | 'custom';
export type ProviderAuthType = 'bearer' | 'xi-api-key' | 'x-api-key' | 'api-key' | 'query-param' | 'none' | 'custom-header';
export type ProviderCapabilities = Partial<Record<ProviderCapability, boolean>>;
export interface ProviderEndpoints { models?: string; voices?: string; chat?: string; vision?: string; stt?: string; tts?: string; }
export interface AIVoice { id: string; name?: string; language?: string; }
export interface AIModel { id: string; name?: string; capabilities?: ProviderCapabilities; raw?: unknown; }
export interface AIProvider { id: string; name: string; baseUrl: string; apiKey?: string; enabled: boolean; models: AIModel[]; providerType: ProviderType; authType: ProviderAuthType; authHeaderName?: string; authPrefix?: string; queryParamName?: string; overrideAuthentication?: boolean; overrideCapabilities?: boolean; overrideEndpoints?: boolean; capabilities: ProviderCapabilities; endpoints?: ProviderEndpoints; voices?: AIVoice[]; }
export type Capability = 'translation' | 'vision' | 'stt' | 'tts';
export interface TranslationItem { id: string; text: string; durationMs?: number; targetDurationMs?: number; previousText?: string; nextText?: string; }
export interface SubtitleSegment { id?: string; start?: number; end?: number; text?: string; }
