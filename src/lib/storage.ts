import type {
  AIProvider,
  AppSettings,
  BlurRegion,
  GlossaryEntry,
  LogoOverlay,
  ModelPreferences,
  PronunciationEntry,
  SubtitleCue,
  VideoAsset,
  VideoEditState,
} from "../types";
import { defaultSettings } from "../types";
import { ensureBuiltInProviders, normalizeProvider } from "./providers";
import { normalizeSettings } from "./settings";

export type ExtractionRunStatus =
  | "idle"
  | "uploading"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export interface ExtractionRunState {
  status: ExtractionRunStatus;
  mode?: "ocr" | "stt" | "smart";
  fileName?: string;
  cueCount?: number;
  updatedAt?: number;
}
export type TranslationRunStatus =
  | "idle"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export interface TranslationRunState {
  status: TranslationRunStatus;
  fileName?: string;
  total?: number;
  translated?: number;
  remaining?: number;
  message?: string;
  progress?: number;
  stage?: string;
  updatedAt?: number;
}

const keys = {
  providers: "autosub.providers",
  settings: "autosub.settings",
  cues: "autosub.cues",
  asset: "autosub.asset",
  videoEdits: "autosub.video-edits",
  videoBlurRegions: "autosub.video-blur-regions",
  videoLogos: "autosub.video-logos",
  dubbingJobs: "autosub.dubbing-jobs",
  glossary: "autosub.glossary",
  pronunciation: "autosub.pronunciation",
  modelPreferences: "autosub.model-preferences",
};
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}
const cueDebug = (cues: SubtitleCue[]) =>
  cues.slice(0, 5).map((cue) => ({
    text: cue.originalText,
    startMs: cue.startMs,
    endMs: cue.endMs,
  }));
type StoredVideoAsset = Pick<
  VideoAsset,
  | "name"
  | "type"
  | "uploadId"
  | "storedPath"
  | "durationMs"
  | "size"
  | "sourceMode"
>;
type StoredLogoOverlay = Omit<LogoOverlay, "file">;

export const storage = {
  providers: () =>
    ensureBuiltInProviders(
      read<AIProvider[]>(keys.providers, []).map((provider) =>
        normalizeProvider(provider),
      ),
    ),
  saveProviders: (v: AIProvider[]) =>
    write(
      keys.providers,
      ensureBuiltInProviders(v.map((provider) => normalizeProvider(provider))),
    ),
  settings: () =>
    normalizeSettings(
      read<Partial<AppSettings>>(keys.settings, defaultSettings),
    ),
  saveSettings: (v: AppSettings) => write(keys.settings, normalizeSettings(v)),
  cues: () => {
    const value = read<SubtitleCue[]>(keys.cues, []);
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
      console.info(
        `[AUTOSAVE LOAD] ${JSON.stringify({ cueCount: value.length, cues: cueDebug(value) })}`,
      );
    return value;
  },
  saveCues: (v: SubtitleCue[]) => {
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
      console.info(
        `[AUTOSAVE SAVE] ${JSON.stringify({ cueCount: v.length, cues: cueDebug(v) })}`,
      );
    write(keys.cues, v);
  },
  asset: (): VideoAsset | undefined => {
    const value = read<StoredVideoAsset | undefined>(keys.asset, undefined);
    return value?.uploadId
      ? {
          ...value,
          url: `/api/uploads/${encodeURIComponent(value.uploadId)}/media`,
        }
      : undefined;
  },
  saveAsset: (value?: VideoAsset) => {
    if (!value?.uploadId) {
      localStorage.removeItem(keys.asset);
      return;
    }
    write<StoredVideoAsset>(keys.asset, {
      name: value.name,
      type: value.type,
      uploadId: value.uploadId,
      storedPath: value.storedPath,
      durationMs: value.durationMs,
      size: value.size,
      sourceMode: value.sourceMode,
    });
  },
  videoEdit: (uploadId?: string): VideoEditState =>
    uploadId
      ? read<Record<string, VideoEditState>>(keys.videoEdits, {})[uploadId] || {
          aspectRatio: "original",
          trimStartMs: 0,
        }
      : { aspectRatio: "original", trimStartMs: 0 },
  saveVideoEdit: (uploadId: string, value: VideoEditState) =>
    write(keys.videoEdits, {
      ...read<Record<string, VideoEditState>>(keys.videoEdits, {}),
      [uploadId]: value,
    }),
  blurRegions: (uploadId?: string): BlurRegion[] =>
    uploadId
      ? read<Record<string, BlurRegion[]>>(keys.videoBlurRegions, {})[
          uploadId
        ] || []
      : [],
  saveBlurRegions: (uploadId: string, value: BlurRegion[]) =>
    write(keys.videoBlurRegions, {
      ...read<Record<string, BlurRegion[]>>(keys.videoBlurRegions, {}),
      [uploadId]: value,
    }),
  logo: (uploadId?: string): LogoOverlay | undefined =>
    uploadId
      ? read<Record<string, StoredLogoOverlay | undefined>>(
          keys.videoLogos,
          {},
        )[uploadId]
      : undefined,
  saveLogo: (uploadId: string, value?: LogoOverlay) => {
    const logos = read<Record<string, StoredLogoOverlay | undefined>>(
      keys.videoLogos,
      {},
    );
    if (!value) delete logos[uploadId];
    else {
      logos[uploadId] = {
        name: value.name,
        url: value.url,
        enabled: value.enabled,
        kind: value.kind,
        text: value.text,
        fontFamily: value.fontFamily,
        fontSize: value.fontSize,
        textColor: value.textColor,
        outlineColor: value.outlineColor,
        position: value.position,
        xPercent: value.xPercent,
        yPercent: value.yPercent,
        widthPercent: value.widthPercent,
        opacity: value.opacity,
      };
    }
    write(keys.videoLogos, logos);
  },
  dubbingJob: (uploadId: string) =>
    read<Record<string, string>>(keys.dubbingJobs, {})[uploadId],
  saveDubbingJob: (uploadId: string, jobId: string) =>
    write(keys.dubbingJobs, {
      ...read<Record<string, string>>(keys.dubbingJobs, {}),
      [uploadId]: jobId,
    }),
  removeDubbingJob: (uploadId: string, jobId?: string) => {
    const jobs = read<Record<string, string>>(keys.dubbingJobs, {});
    if (!jobs[uploadId] || (jobId && jobs[uploadId] !== jobId)) return;
    delete jobs[uploadId];
    write(keys.dubbingJobs, jobs);
  },
  glossary: () => read<GlossaryEntry[]>(keys.glossary, []),
  saveGlossary: (v: GlossaryEntry[]) => write(keys.glossary, v),
  pronunciation: () => read<PronunciationEntry[]>(keys.pronunciation, []),
  savePronunciation: (v: PronunciationEntry[]) => write(keys.pronunciation, v),
  modelPreferences: () => read<ModelPreferences>(keys.modelPreferences, {}),
  saveModelPreferences: (v: ModelPreferences) => {
    write(keys.modelPreferences, v);
    window.dispatchEvent(new Event("autosub:model-preferences-changed"));
  },
};

const extractionStatusKey = "autosub.extraction-status";
export const extractionStatusStorage = {
  load: () => read<ExtractionRunState>(extractionStatusKey, { status: "idle" }),
  save: (value: ExtractionRunState) => write(extractionStatusKey, value),
};

const translationStatusKey = "autosub.translation-status";
export const translationStatusStorage = {
  load: () =>
    read<TranslationRunState>(translationStatusKey, { status: "idle" }),
  save: (value: TranslationRunState) => write(translationStatusKey, value),
};
