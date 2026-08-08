export type VoiceGroup = 'G1' | 'G2' | 'G3';
export type Capability = 'translation' | 'vision' | 'stt' | 'tts';
export type ProviderCapability = 'chat' | 'vision' | 'stt' | 'tts';
export type ProviderType = 'auto' | 'openai-compatible' | 'groq' | 'elevenlabs' | 'vbee' | 'custom';
export type ProviderAuthType = 'bearer' | 'xi-api-key' | 'x-api-key' | 'api-key' | 'query-param' | 'none' | 'custom-header';
export type ProviderCapabilities = Partial<Record<ProviderCapability, boolean>>;

export interface ProviderEndpoints {
  models?: string;
  voices?: string;
  chat?: string;
  vision?: string;
  stt?: string;
  tts?: string;
}

export interface AIVoice { id: string; name?: string; language?: string; }

export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
  voiceGroup: VoiceGroup;
  enabled: boolean;
  dubbing?: DubbingMetadata;
}

export interface DubbingMetadata {
  cueId: string;
  originalText: string;
  translatedText: string;
  finalDubbingText: string;
  originalDurationMs: number;
  targetDurationMs: number;
  ttsDurationMs: number;
  finalAudioDurationMs: number;
  rewriteAttempts: number;
  speedApplied: number;
  extensionMs: number;
  warning?: string;
}

export type DubbingJobState = 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';
export interface DubbingJobStatus {
  id: string;
  videoId?: string;
  status: DubbingJobState;
  createdAt: string;
  updatedAt: string;
  totalCues: number;
  doneCues: number;
  failedCues: number;
  currentBatch: number;
  config: { timingMode: 'natural' | 'strict'; batchSize: number; ttsConcurrency: number; llmConcurrency: number; maxRetries: number; audioMix: { keepOriginal: boolean; originalVolume: number }; rewriteProviderRef?: string; rewriteModel?: string };
  providerInfo: Array<{ ref: string; providerId: string; name: string; baseUrl: string }>;
  warnings: string[];
  progressPercent: number;
  failedCueIds: string[];
  failedCueErrors: Array<{ id: string; index: number; stage: 'pending' | 'translating' | 'rewriting' | 'tts' | 'fitting' | 'done' | 'failed'; attempts: number; error: string }>;
  result?: { audioFile: string; metadataFile: string; durationMs: number };
}

export interface AIModel { id: string; name?: string; capabilities?: ProviderCapabilities; raw?: unknown; }
export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled: boolean;
  models: AIModel[];
  providerType: ProviderType;
  authType: ProviderAuthType;
  authHeaderName?: string;
  authPrefix?: string;
  queryParamName?: string;
  overrideAuthentication?: boolean;
  overrideCapabilities?: boolean;
  overrideEndpoints?: boolean;
  capabilities: ProviderCapabilities;
  endpoints?: ProviderEndpoints;
  voices?: AIVoice[];
}
export interface ProviderAssignment { providerId: string; model: string; }
export type ModelTestStatus = 'unknown' | 'passed' | 'failed';
export interface ModelPreference { bookmarked: boolean; status: ModelTestStatus; lastTestedAt?: number; error?: string; }
export type ModelPreferences = Record<string, ModelPreference>;

export interface SubtitleStyle {
  visible: boolean;
  content: 'original' | 'translated' | 'both';
  fontFamily: string;
  fontSize: number;
  outlineWidth?: number;
  textColor: string;
  outlineColor: string;
  background: 'outline' | 'box' | 'none';
  backgroundColor?: string;
  backgroundOpacity: number;
  bold: boolean;
  italic: boolean;
  position: 'top' | 'middle' | 'bottom' | 'custom';
  customX?: number;
  customY?: number;
}

export interface AppSettings {
  assignments: Record<Capability, ProviderAssignment>;
  subtitleStyle: SubtitleStyle;
  workdir: string;
}

export interface BlurRegion {
  id: string;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  startMs: number;
  endMs: number;
  wholeVideo: boolean;
  mode: 'blur' | 'neighbor';
  blurStrength: number;
  expandTop: number;
  expandBottom: number;
}

export interface GlossaryEntry { id: string; source: string; target: string; enabled: boolean; }
export interface PronunciationEntry { id: string; source: string; reading: string; enabled: boolean; }
export interface VideoAsset { name: string; path?: string; url: string; type: string; file?: File; durationMs?: number; }
export type LogoPosition = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'custom';
export interface LogoOverlay { name: string; url?: string; file?: File; enabled: boolean; kind: 'image' | 'text'; text: string; fontFamily: string; fontSize: number; textColor: string; outlineColor: string; position: LogoPosition; xPercent: number; yPercent: number; widthPercent: number; opacity: number; }

export const defaultStyle: SubtitleStyle = {
  visible: true, content: 'translated', fontFamily: 'Arial', fontSize: 32, outlineWidth: 2, textColor: '#ffffff', outlineColor: '#10141b', background: 'outline', backgroundColor: '#10141b', backgroundOpacity: 0.72, bold: false, italic: false, position: 'bottom', customX: 50, customY: 82,
};
export const defaultSettings: AppSettings = {
  assignments: { translation: { providerId: '', model: '' }, vision: { providerId: '', model: '' }, stt: { providerId: '', model: '' }, tts: { providerId: '', model: '' } },
  subtitleStyle: defaultStyle, workdir: 'workdir',
};
