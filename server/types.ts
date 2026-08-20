export type ProviderCapability = 'chat' | 'vision' | 'stt' | 'tts';
export type ProviderType = 'auto' | 'openai-compatible' | 'groq' | 'elevenlabs' | 'whisper-local' | 'edge-tts' | 'vieneu-local' | 'hiiu-tts' | 'capcut-tts' | 'vbee' | 'custom';
export type ProviderAuthType = 'bearer' | 'xi-api-key' | 'x-api-key' | 'api-key' | 'query-param' | 'none' | 'custom-header';
export type ProviderCapabilities = Partial<Record<ProviderCapability, boolean>>;
export interface ProviderEndpoints { models?: string; voices?: string; chat?: string; vision?: string; stt?: string; tts?: string; }
export interface AIVoice { id: string; name?: string; language?: string; resourceId?: string; source?: 'preset' | 'clone'; description?: string; }
export interface AIModel { id: string; name?: string; capabilities?: ProviderCapabilities; raw?: unknown; }
export interface AIProvider { id: string; name: string; baseUrl: string; apiKey?: string; enabled: boolean; models: AIModel[]; providerType: ProviderType; authType: ProviderAuthType; authHeaderName?: string; authPrefix?: string; queryParamName?: string; overrideAuthentication?: boolean; overrideCapabilities?: boolean; overrideEndpoints?: boolean; capabilities: ProviderCapabilities; endpoints?: ProviderEndpoints; voices?: AIVoice[]; }
export type Capability = 'translation' | 'vision' | 'stt' | 'tts';
export interface TranslationItem {
  id: string;
  text: string;
  durationMs?: number;
  targetDurationMs?: number;
  previousText?: string;
  nextText?: string;
  contextBefore?: string[];
  contextAfter?: string[];
}
export interface TranslationMemoryItem { source: string; translation: string; }
export interface SubtitleWord { word?: string; text?: string; start?: number; end?: number; startMs?: number; endMs?: number; probability?: number; confidence?: number; }
export interface SubtitleSegment { id?: string; start?: number; end?: number; text?: string; words?: SubtitleWord[]; }

export type ReviewAspectRatio = 'original' | '16:9' | '9:16';
export type ReviewJobState = 'queued' | 'transcribing' | 'scripting' | 'voicing' | 'rendering' | 'completed' | 'failed' | 'cancelled';
export type ReviewYouTubeState = 'idle' | 'uploading' | 'processing' | 'manual_check_required' | 'passed' | 'claimed' | 'rejected' | 'failed';

export interface ReviewPlanSegment {
  id: string;
  sourceStartMs: number;
  sourceEndMs: number;
  narration: string;
}

export interface ReviewCharacter {
  name: string;
  aliases: string[];
  role: string;
}

export interface ReviewPlan {
  title: string;
  description: string;
  movieTitle?: string;
  lesson?: string;
  characters?: ReviewCharacter[];
  segments: ReviewPlanSegment[];
}

export interface ReviewYouTubeStatus {
  state: ReviewYouTubeState;
  videoId?: string;
  watchUrl?: string;
  studioUrl?: string;
  uploadStatus?: string;
  rejectionReason?: string;
  blockedRegions?: string[];
  lastCheckedAt?: string;
  error?: string;
}

export interface ReviewJobStatus {
  id: string;
  status: ReviewJobState;
  stage: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
  sourceName: string;
  warnings: string[];
  error?: string;
  plan?: ReviewPlan;
  result?: { videoFile: string; subtitleFile: string; durationMs: number };
  youtube: ReviewYouTubeStatus;
}
