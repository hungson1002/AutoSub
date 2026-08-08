import type { AIProvider, AppSettings, GlossaryEntry, ModelPreferences, PronunciationEntry, SubtitleCue } from '../types';
import { defaultSettings } from '../types';
import { normalizeProvider } from './providers';
import { normalizeSettings } from './settings';

export type ExtractionRunStatus = 'idle' | 'uploading' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface ExtractionRunState { status: ExtractionRunStatus; mode?: 'ocr' | 'stt'; fileName?: string; cueCount?: number; updatedAt?: number; }

const keys = { providers: 'autosub.providers', settings: 'autosub.settings', cues: 'autosub.cues', glossary: 'autosub.glossary', pronunciation: 'autosub.pronunciation', modelPreferences: 'autosub.model-preferences' };
function read<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } }
function write<T>(key: string, value: T) { localStorage.setItem(key, JSON.stringify(value)); }
const cueDebug = (cues: SubtitleCue[]) => cues.slice(0, 5).map((cue) => ({ text: cue.originalText, startMs: cue.startMs, endMs: cue.endMs }));
export const storage = { providers: () => read<AIProvider[]>(keys.providers, []).map((provider) => normalizeProvider(provider)), saveProviders: (v: AIProvider[]) => write(keys.providers, v.map((provider) => normalizeProvider(provider))), settings: () => normalizeSettings(read<Partial<AppSettings>>(keys.settings, defaultSettings)), saveSettings: (v: AppSettings) => write(keys.settings, normalizeSettings(v)), cues: () => { const value = read<SubtitleCue[]>(keys.cues, []); if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.info(`[AUTOSAVE LOAD] ${JSON.stringify({ cueCount: value.length, cues: cueDebug(value) })}`); return value; }, saveCues: (v: SubtitleCue[]) => { if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) console.info(`[AUTOSAVE SAVE] ${JSON.stringify({ cueCount: v.length, cues: cueDebug(v) })}`); write(keys.cues, v); }, glossary: () => read<GlossaryEntry[]>(keys.glossary, []), saveGlossary: (v: GlossaryEntry[]) => write(keys.glossary, v), pronunciation: () => read<PronunciationEntry[]>(keys.pronunciation, []), savePronunciation: (v: PronunciationEntry[]) => write(keys.pronunciation, v), modelPreferences: () => read<ModelPreferences>(keys.modelPreferences, {}), saveModelPreferences: (v: ModelPreferences) => { write(keys.modelPreferences, v); window.dispatchEvent(new Event('autosub:model-preferences-changed')); } };

const extractionStatusKey = 'autosub.extraction-status';
export const extractionStatusStorage = {
  load: () => read<ExtractionRunState>(extractionStatusKey, { status: 'idle' }),
  save: (value: ExtractionRunState) => write(extractionStatusKey, value),
};
