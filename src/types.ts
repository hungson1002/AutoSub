export type VoiceGroup = "G1" | "G2" | "G3";
/** Safe source-audio choices supported by the dubbing pipeline. */
export type OriginalAudioMode = "mute" | "original" | "background";
export type Capability = "translation" | "vision" | "stt" | "tts";
export type ProviderCapability = "chat" | "vision" | "stt" | "tts";
export type ProviderType =
  | "auto"
  | "openai-compatible"
  | "groq"
  | "elevenlabs"
  | "whisper-local"
  | "edge-tts"
  | "vieneu-local"
  | "hiiu-tts"
  | "capcut-tts"
  | "vbee"
  | "custom";
export type ProviderAuthType =
  | "bearer"
  | "xi-api-key"
  | "x-api-key"
  | "api-key"
  | "query-param"
  | "none"
  | "custom-header";
export type ProviderCapabilities = Partial<Record<ProviderCapability, boolean>>;

export interface ProviderEndpoints {
  models?: string;
  voices?: string;
  chat?: string;
  vision?: string;
  stt?: string;
  tts?: string;
}

export interface AIVoice {
  id: string;
  name?: string;
  language?: string;
  resourceId?: string;
  source?: 'preset' | 'clone';
  description?: string;
}
export interface VoiceCloneProfile {
  id: string;
  name: string;
  language: "vi-VN";
  durationMs: number;
  createdAt: string;
  sourceName: string;
  authorized: true;
  referenceVersion?: number;
}

export interface SubtitleCue {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
  voiceGroup: VoiceGroup;
  enabled: boolean;
  sourceKind?: "subtitle" | "onscreen-text";
  textOrigin?: "ocr" | "manual";
  screenPosition?: { xPercent: number; yPercent: number };
  styleOverrides?: Partial<SubtitleStyle>;
  timelineLane?: number;
  words?: Array<{
    word?: string;
    text?: string;
    start?: number;
    end?: number;
    startMs?: number;
    endMs?: number;
    probability?: number;
    confidence?: number;
  }>;
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
  adaptiveFitVersion?: number;
  extensionMs: number;
  timelineStartMs?: number;
  timelineEndMs?: number;
  timelineShiftMs?: number;
  warning?: string;
}

export type DubbingJobState =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "completed_with_errors"
  | "cancelled"
  | "failed";
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
  config: {
    timingMode: "natural" | "strict";
    batchSize: number;
    ttsConcurrency: number;
    llmConcurrency: number;
    maxRetries: number;
    slowVideoToMatchSpeech?: boolean;
    audioMix: {
      mode: OriginalAudioMode;
      keepOriginal: boolean;
      originalVolume: number;
      separateVocals?: boolean;
    };
    rewriteProviderRef?: string;
    rewriteModel?: string;
  };
  providerInfo: Array<{
    ref: string;
    providerId: string;
    name: string;
    baseUrl: string;
  }>;
  warnings: string[];
  progressPercent: number;
  failedCueIds: string[];
  failedCueErrors: Array<{
    id: string;
    index: number;
    stage:
      | "pending"
      | "translating"
      | "rewriting"
      | "tts"
      | "fitting"
      | "done"
      | "failed";
    attempts: number;
    error: string;
  }>;
  result?: {
    audioFile: string;
    metadataFile: string;
    durationMs: number;
    masteringVersion?: number;
  };
}

export interface AIModel {
  id: string;
  name?: string;
  capabilities?: ProviderCapabilities;
  raw?: unknown;
}
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
export interface ProviderAssignment {
  providerId: string;
  model: string;
}
export type CapabilityAssignments = Record<Capability, ProviderAssignment[]>;
export type ModelTestStatus = "unknown" | "passed" | "failed";
export interface ModelPreference {
  bookmarked: boolean;
  status: ModelTestStatus;
  lastTestedAt?: number;
  error?: string;
}
export type ModelPreferences = Record<string, ModelPreference>;

export interface SubtitleStyle {
  visible: boolean;
  content: "original" | "translated" | "both";
  fontFamily: string;
  fontSize: number;
  outlineWidth?: number;
  textColor: string;
  outlineColor: string;
  background: "outline" | "box" | "none";
  backgroundColor?: string;
  backgroundOpacity: number;
  boxPaddingX?: number;
  boxPaddingY?: number;
  boxBorderColor?: string;
  boxBorderWidth?: number;
  bold: boolean;
  italic: boolean;
  position: "top" | "middle" | "bottom" | "custom";
  customX?: number;
  customY?: number;
}

export interface AppSettings {
  assignments: Record<Capability, ProviderAssignment>;
  /**
   * Provider/model choices available for each capability. `assignments` is
   * kept as the default choice for backwards compatibility with old local
   * settings.
   */
  providersByCapability: CapabilityAssignments;
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
  mode: "blur" | "neighbor";
  blurStrength: number;
  borderRadius?: number;
  expandTop: number;
  expandBottom: number;
}

export interface GlossaryEntry {
  id: string;
  source: string;
  target: string;
  enabled: boolean;
}
export interface PronunciationEntry {
  id: string;
  source: string;
  reading: string;
  enabled: boolean;
}
export interface VideoAsset {
  name: string;
  path?: string;
  url: string;
  type: string;
  file?: File;
  uploadId?: string;
  storedPath?: string;
  durationMs?: number;
  size?: number;
  sourceMode?: "copied" | "linked";
}
export type VideoAspectRatio = "original" | "16:9" | "9:16" | "1:1" | "4:5";
export interface VideoCropRegion {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}
export interface VideoEditState {
  aspectRatio: VideoAspectRatio;
  trimStartMs: number;
  trimEndMs?: number;
  crop?: VideoCropRegion;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
}
export type LogoPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "middle-left"
  | "center"
  | "middle-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "custom";
export interface LogoOverlay {
  name: string;
  url?: string;
  file?: File;
  enabled: boolean;
  kind: "image" | "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  outlineColor: string;
  position: LogoPosition;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  opacity: number;
}

export type ReviewAspectRatio = "original" | "16:9" | "9:16";
export type ReviewJobState =
  | "queued"
  | "transcribing"
  | "scripting"
  | "voicing"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";
export type ReviewYouTubeState =
  | "idle"
  | "uploading"
  | "processing"
  | "manual_check_required"
  | "passed"
  | "claimed"
  | "rejected"
  | "failed";
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

export type ProductAdPlatform = "tiktok" | "youtube-shorts" | "both";
export type ProductAdOutputMode = "render" | "veo3-script";
export type ProductAdJobState =
  | "queued"
  | "analyzing"
  | "scripting"
  | "voicing"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export interface ProductAdScene {
  id: string;
  imageIndex: number;
  headline: string;
  narration: string;
  visualPrompt?: string;
  continuity?: string;
}

export interface ProductAdPlan {
  title: string;
  caption: string;
  disclosure: string;
  hashtags: string[];
  scenes: ProductAdScene[];
}

export interface Veo3PromptClip {
  id: string;
  index: number;
  imageIndex: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  headline: string;
  narration: string;
  prompt: string;
}

export interface Veo3PromptPack {
  model: "Veo 3";
  aspectRatio: "9:16";
  clipLimitSeconds: 10;
  totalDurationSeconds: number;
  clips: Veo3PromptClip[];
}

export interface ProductAdJobStatus {
  id: string;
  status: ProductAdJobState;
  stage: string;
  progressPercent: number;
  createdAt: string;
  updatedAt: string;
  productName: string;
  imageNames: string[];
  imageUploadIds?: string[];
  outputMode: ProductAdOutputMode;
  warnings: string[];
  error?: string;
  plan?: ProductAdPlan;
  veo3Pack?: Veo3PromptPack;
  result?: { videoFile: string; subtitleFile: string; durationMs: number };
}

/** Provider-neutral video model id. Flow remains the built-in adapter. */
export type FilmVideoModel = string;
/** Kept for older callers that only expose the built-in Flow model. */
export type FlowVideoModel = 'Flow Agent Auto';
export type FlowVideoAspectRatio = '9:16' | '16:9';
export type AiVideoShotSize = 'EWS' | 'WS' | 'MS' | 'MCU' | 'CU' | 'ECU' | 'OTS' | 'POV' | 'INSERT';
export type AiVideoEditMotivation = 'action' | 'eyeline' | 'sound' | 'reveal' | 'graphic' | 'emotion' | 'scene-change';
export type FilmContentReview = { status: 'pass' | 'needs-review' | 'unavailable'; checks: Array<{ criterion: string; verdict: 'pass' | 'fail' | 'uncertain'; evidence: string }>; correction: string; model?: string; createdAt: string };
export type AiVideoCandidate = { attempt: number; fileName: string; status: 'needs-review' | 'accepted'; issue?: string; createdAt: string; contentReview?: FilmContentReview };
export interface AiVideoScene { primaryAction?: string; openingState?: string; closingState?: string; successCriteria?: string; storyboardReview?: FilmContentReview; }
export interface AiVideoScene { index: number; durationSeconds?: number; title: string; narration: string; visualPrompt: string; dramaticBeat?: string; shotSize?: AiVideoShotSize; lensMm?: number; cameraAngle?: string; cameraMovement?: string; editMotivation?: AiVideoEditMotivation; charactersInShot?: string[]; shotPlan?: string; blocking?: string; transition?: 'continue' | 'cut'; continuityIn?: string; continuityOut?: string; soundDesign?: string; keeper?: string; editorHandoff?: string; negativeConstraints?: string; storyboardReady?: boolean; designDirty?: boolean; lastCandidate?: AiVideoCandidate; status: 'pending' | 'generating' | 'completed' | 'failed' }
export interface AiVideoCharacter { index: number; name: string; description: string; sheetReady?: boolean; designDirty?: boolean }
export interface AiVideoJobStatus { id: string; status: 'queued' | 'planning' | 'designing' | 'reviewing' | 'generating' | 'composing' | 'completed' | 'failed' | 'cancelled'; stage: string; progressPercent: number; createdAt: string; updatedAt: string; brief: string; durationSeconds: number; shotDurationSeconds?: number; model: FilmVideoModel; imageModel?: string; aspectRatio: FlowVideoAspectRatio; directionMode?: 'cinematic' | 'documentary' | 'commercial' | 'social-realism'; workflowMode?: 'review-first' | 'direct'; automationMode?: 'automatic' | 'manual'; characterReference?: { filename: string }; characters?: AiVideoCharacter[]; characterSheetReady?: boolean; characterDesignDirty?: boolean; productionBible?: string; scenes: AiVideoScene[]; result?: { videoFile: string; durationMs: number }; error?: string }

export type DouyinItemState =
  | "pending"
  | "resolving"
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";
export type BilibiliQuality = 64 | 16;
export interface DouyinBatchItem {
  id: string;
  originalUrl: string;
  platform?: "douyin" | "bilibili";
  bilibiliQuality?: BilibiliQuality;
  videoId?: string;
  title?: string;
  author?: string;
  authorAvatar?: string;
  coverUrl?: string;
  duration?: number;
  status: DouyinItemState;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadSpeedBytesPerSecond?: number;
  etaSeconds?: number;
  error?: string;
  uploadId?: string;
  storedPath?: string;
  filename?: string;
  fileSize?: number;
}
export interface DouyinBatchJob {
  id: string;
  status:
    | "queued"
    | "running"
    | "completed"
    | "completed_with_errors"
    | "cancelled"
    | "failed";
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  items: DouyinBatchItem[];
}

export const defaultStyle: SubtitleStyle = {
  visible: true,
  content: "translated",
  fontFamily: "Arial",
  fontSize: 32,
  outlineWidth: 2,
  textColor: "#ffffff",
  outlineColor: "#10141b",
  background: "outline",
  backgroundColor: "#10141b",
  backgroundOpacity: 0.72,
  boxPaddingX: 10,
  boxPaddingY: 4,
  boxBorderColor: "#ffffff",
  boxBorderWidth: 0,
  bold: false,
  italic: false,
  position: "bottom",
  customX: 50,
  customY: 82,
};
export const defaultSettings: AppSettings = {
  assignments: {
    translation: { providerId: "", model: "" },
    vision: { providerId: "", model: "" },
    stt: { providerId: "", model: "" },
    tts: { providerId: "", model: "" },
  },
  providersByCapability: { translation: [], vision: [], stt: [], tts: [] },
  subtitleStyle: defaultStyle,
  workdir: "workdir",
};
