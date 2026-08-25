import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_TIMESTAMP_REFINEMENT,
  detectSpeechRegions,
  refineCuesWithSpeechRegions,
  type RefinementConfidence,
  type SpeechRegion,
  type TimestampRefinementConfig,
  type TimestampRefinementCue,
} from './timestampRefinement';
import { normalizeCueTimeline } from './subtitles';
import { workdir } from './ffmpeg';

export type TimestampSource = 'provider-segment' | 'provider-word' | 'aligned' | 'fallback';
export type AlignmentMethod = 'provider-word' | 'speech-region-sequence' | 'provider-segment-fallback';

export interface AlignmentWord {
  word?: string;
  text?: string;
  start?: number;
  end?: number;
  startMs?: number;
  endMs?: number;
  probability?: number;
  confidence?: number;
}

export interface AlignmentCue extends TimestampRefinementCue {
  originalText?: string;
  text?: string;
  words?: AlignmentWord[];
}

export interface AlignTranscriptToAudioInput<T extends AlignmentCue = AlignmentCue> {
  audioPath: string;
  cues: T[];
  language?: string;
  speechRegions?: SpeechRegion[];
  speechConfidence?: RefinementConfidence;
  refinementConfig?: TimestampRefinementConfig;
}

export interface AlignedTranscriptEntry {
  text: string;
  providerStartMs: number;
  providerEndMs: number;
  alignedStartMs: number;
  alignedEndMs: number;
  confidence: number;
  alignmentMethod: AlignmentMethod;
  timestampSource: TimestampSource;
}

export interface TextAudioAlignmentMetadata {
  enabled: boolean;
  method: string;
  alignmentMethod: AlignmentMethod;
  alignmentConfidence: number;
  timestampSource: TimestampSource;
  refinedCount: number;
  fallbackCount: number;
  analysisMs: number;
  speechRegions?: SpeechRegion[];
  cacheHit?: boolean;
  error?: string;
}

export interface AlignTranscriptToAudioResult<T extends AlignmentCue> {
  cues: T[];
  entries: AlignedTranscriptEntry[];
  metadata: TextAudioAlignmentMetadata;
}

const ALIGNER_VERSION = 2;
const debugAlignment = (scope: string, value: Record<string, unknown>) => {
  if (process.env.AUTOSUB_DEBUG_UPLOADS === '1') console.info(`[${scope}] ${JSON.stringify(value)}`);
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function cueText(cue: AlignmentCue) {
  return typeof cue.originalText === 'string' ? cue.originalText : typeof cue.text === 'string' ? cue.text : '';
}

function wordTimeMs(word: AlignmentWord, field: 'start' | 'end') {
  const millisecond = word[`${field}Ms`];
  if (finite(millisecond)) return Math.round(millisecond);
  const second = word[field];
  return finite(second) ? Math.round(second * 1000) : undefined;
}

function usableWords(cue: AlignmentCue) {
  if (!Array.isArray(cue.words)) return [];
  return cue.words
    .map((word) => ({ word, startMs: wordTimeMs(word, 'start'), endMs: wordTimeMs(word, 'end') }))
    .filter((item): item is { word: AlignmentWord; startMs: number; endMs: number } => finite(item.startMs) && finite(item.endMs) && item.endMs > item.startMs);
}

export function hasUsableWordTimestamps(cues: AlignmentCue[]) {
  return cues.some((cue) => usableWords(cue).length > 0);
}

function wordConfidence(words: Array<{ word: AlignmentWord; startMs: number; endMs: number }>) {
  const values = words.map(({ word }) => word.confidence ?? word.probability).filter(finite);
  return values.length ? Math.max(0, Math.min(1, values.reduce((sum, value) => sum + value, 0) / values.length)) : 0.96;
}

function summarySource(entries: AlignedTranscriptEntry[]): TimestampSource {
  if (!entries.length) return 'fallback';
  if (entries.every((entry) => entry.timestampSource === 'provider-word')) return 'provider-word';
  if (entries.some((entry) => entry.timestampSource === 'aligned')) return 'aligned';
  if (entries.every((entry) => entry.timestampSource === 'provider-segment')) return 'provider-segment';
  return 'fallback';
}

function summaryMethod(entries: AlignedTranscriptEntry[]): AlignmentMethod {
  if (entries.some((entry) => entry.alignmentMethod === 'provider-word')) return 'provider-word';
  if (entries.some((entry) => entry.alignmentMethod === 'speech-region-sequence')) return 'speech-region-sequence';
  return 'provider-segment-fallback';
}

function averageConfidence(entries: AlignedTranscriptEntry[]) {
  return entries.length ? entries.reduce((sum, entry) => sum + entry.confidence, 0) / entries.length : 0;
}

function providerEntry<T extends AlignmentCue>(cue: T, source: TimestampSource = 'fallback'): AlignedTranscriptEntry {
  return {
    text: cueText(cue),
    providerStartMs: cue.startMs,
    providerEndMs: cue.endMs,
    alignedStartMs: cue.startMs,
    alignedEndMs: cue.endMs,
    confidence: source === 'provider-segment' ? 0.35 : 0.2,
    alignmentMethod: 'provider-segment-fallback',
    timestampSource: source,
  };
}

function alignByProviderWords<T extends AlignmentCue>(cues: T[]): AlignTranscriptToAudioResult<T> {
  const aligned = cues.map((cue) => {
    const words = usableWords(cue);
    if (!words.length) return { cue: { ...cue }, entry: providerEntry(cue) };
    const startMs = words[0].startMs;
    const endMs = words[words.length - 1].endMs;
    return {
      cue: { ...cue, startMs, endMs },
      entry: {
        text: cueText(cue),
        providerStartMs: cue.startMs,
        providerEndMs: cue.endMs,
        alignedStartMs: startMs,
        alignedEndMs: endMs,
        confidence: wordConfidence(words),
        alignmentMethod: 'provider-word' as const,
        timestampSource: 'provider-word' as const,
      },
    };
  });
  const normalized = normalizeCueTimeline(aligned.map((item) => item.cue));
  const entries = aligned.map((item, index) => ({ ...item.entry, alignedStartMs: normalized[index].startMs, alignedEndMs: normalized[index].endMs }));
  return {
    cues: normalized,
    entries,
    metadata: {
      enabled: true,
      method: 'provider-word',
      alignmentMethod: summaryMethod(entries),
      alignmentConfidence: averageConfidence(entries),
      timestampSource: summarySource(entries),
      refinedCount: entries.filter((entry) => entry.timestampSource === 'provider-word').length,
      fallbackCount: entries.filter((entry) => entry.timestampSource === 'fallback').length,
      analysisMs: 0,
    },
  };
}

function alignBySpeechRegions<T extends AlignmentCue>(cues: T[], speechRegions: SpeechRegion[], config: TimestampRefinementConfig, confidence: RefinementConfidence, method: string): AlignTranscriptToAudioResult<T> {
  const refined = refineCuesWithSpeechRegions(cues, speechRegions, config, confidence, method);
  const details = refined.metadata.details || [];
  const entries = refined.cues.map((cue, index) => {
    const detail = details[index];
    const aligned = Boolean(detail?.timestampRefined);
    return {
      text: cueText(cues[index]),
      providerStartMs: cues[index].startMs,
      providerEndMs: cues[index].endMs,
      alignedStartMs: cue.startMs,
      alignedEndMs: cue.endMs,
      confidence: aligned ? (detail.refinementConfidence === 'high' ? 0.82 : 0.65) : 0.2,
      alignmentMethod: aligned ? 'speech-region-sequence' as const : 'provider-segment-fallback' as const,
      timestampSource: aligned ? 'aligned' as const : 'fallback' as const,
    };
  });
  return {
    cues: refined.cues,
    entries,
    metadata: {
      enabled: true,
      method,
      alignmentMethod: summaryMethod(entries),
      alignmentConfidence: averageConfidence(entries),
      timestampSource: summarySource(entries),
      refinedCount: entries.filter((entry) => entry.timestampSource === 'aligned').length,
      fallbackCount: entries.filter((entry) => entry.timestampSource === 'fallback').length,
      analysisMs: 0,
      speechRegions,
    },
  };
}

function transcriptHash(cues: AlignmentCue[]) {
  return createHash('sha1').update(JSON.stringify(cues.map((cue) => ({
    text: cueText(cue),
    startMs: cue.startMs,
    endMs: cue.endMs,
    words: cue.words || [],
  })))).digest('hex');
}

async function cacheFileFor(input: AlignTranscriptToAudioInput, speechRegions: SpeechRegion[]) {
  const file = await stat(input.audioPath);
  const key = createHash('sha1').update(JSON.stringify({
    audioPath: path.resolve(input.audioPath),
    size: file.size,
    mtimeMs: file.mtimeMs,
    transcript: transcriptHash(input.cues),
    language: input.language || 'Auto Detect',
    speechRegions,
    refinementConfig: input.refinementConfig ? {
      method: input.refinementConfig.method,
      searchPaddingBeforeMs: input.refinementConfig.searchPaddingBeforeMs,
      searchPaddingAfterMs: input.refinementConfig.searchPaddingAfterMs,
      minSpeechMs: input.refinementConfig.minSpeechMs,
      minSilenceGapMs: input.refinementConfig.minSilenceGapMs,
    } : undefined,
    alignerVersion: ALIGNER_VERSION,
  })).digest('hex');
  return { file: path.join(workdir, 'text-audio-alignment-cache', `${key}.json`), key };
}

async function readCached<T extends AlignmentCue>(file: string, key: string): Promise<AlignTranscriptToAudioResult<T> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { cacheKey?: string; cues?: T[]; entries?: AlignedTranscriptEntry[]; metadata?: TextAudioAlignmentMetadata };
    if (parsed.cacheKey !== key || !Array.isArray(parsed.cues) || !Array.isArray(parsed.entries) || !parsed.metadata) return undefined;
    return { cues: parsed.cues, entries: parsed.entries, metadata: { ...parsed.metadata, cacheHit: true, analysisMs: 0 } };
  } catch {
    return undefined;
  }
}

async function writeCached<T extends AlignmentCue>(file: string, key: string, result: AlignTranscriptToAudioResult<T>) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ cacheKey: key, cues: result.cues, entries: result.entries, metadata: result.metadata }), 'utf8');
  } catch (error) {
    debugAlignment('ALIGNMENT', { cacheWriteError: error instanceof Error ? error.message : String(error) });
  }
}

export async function alignTranscriptToAudio<T extends AlignmentCue>(input: AlignTranscriptToAudioInput<T>): Promise<AlignTranscriptToAudioResult<T>> {
  const startedAt = Date.now();
  const config = input.refinementConfig || DEFAULT_TIMESTAMP_REFINEMENT;
  const wordsAvailable = hasUsableWordTimestamps(input.cues);
  if (wordsAvailable) {
    const result = alignByProviderWords(input.cues);
    try {
      const cache = await cacheFileFor(input, []);
      const cached = await readCached<T>(cache.file, cache.key);
      if (cached) return cached;
      result.metadata.analysisMs = Date.now() - startedAt;
      await writeCached(cache.file, cache.key, result);
    } catch {
      // Word timestamps remain usable even when the audio is temporary/missing.
    }
    debugAlignment('ALIGNMENT', { method: 'provider-word', cueCount: input.cues.length, confidence: result.metadata.alignmentConfidence });
    return result;
  }

  let speechRegions = input.speechRegions || [];
  let scanMethod = speechRegions.length ? 'speech-region-sequence' : 'provider-segment-fallback';
  let scanConfidence = input.speechConfidence || 'low' as RefinementConfidence;
  let scanError: string | undefined;
  if (!input.speechRegions) {
    try {
      const scan = await detectSpeechRegions(input.audioPath, config);
      speechRegions = scan.regions;
      scanMethod = scan.method;
      scanConfidence = scan.confidence;
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
    }
  }

  let cache: { file: string; key: string } | undefined;
  try {
    cache = await cacheFileFor(input, speechRegions);
    const cached = await readCached<T>(cache.file, cache.key);
    if (cached) {
      debugAlignment('ALIGNMENT', { cacheHit: true, method: cached.metadata.alignmentMethod, cueCount: input.cues.length });
      return cached;
    }
  } catch {
    // Alignment must remain usable when the source file is temporary/missing.
  }

  const result = speechRegions.length
    ? alignBySpeechRegions(input.cues, speechRegions, config, scanConfidence, scanMethod)
    : {
      cues: input.cues.map((cue) => ({ ...cue })),
      entries: input.cues.map((cue) => providerEntry(cue)),
      metadata: {
        enabled: true,
        method: scanMethod,
        alignmentMethod: 'provider-segment-fallback' as const,
        alignmentConfidence: 0.2,
        timestampSource: 'fallback' as const,
        refinedCount: 0,
        fallbackCount: input.cues.length,
        analysisMs: 0,
      },
    };
  result.metadata.analysisMs = Date.now() - startedAt;
  if (speechRegions.length) result.metadata.speechRegions = speechRegions;
  if (scanError) result.metadata.error = scanError;
  if (cache) await writeCached(cache.file, cache.key, result);
  debugAlignment('ALIGNMENT', {
    method: result.metadata.alignmentMethod,
    cueCount: input.cues.length,
    confidence: result.metadata.alignmentConfidence,
    refinedCount: result.metadata.refinedCount,
    fallbackCount: result.metadata.fallbackCount,
  });
  return result;
}
