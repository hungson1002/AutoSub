import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { chat, ProviderError, synthesize } from '../adapters';
import { run, workdir } from './ffmpeg';
import { resolveUpload } from './uploads';
import { DUB_MASTERING_VERSION, masterDubFile } from './audioMastering';
import { verbalizeOcrSymbols } from './subtitles';
import { sliceDubbingPcm } from './dubbingPcm';

export type TimingMode = 'natural' | 'strict';
export type CueStatus = 'pending' | 'translating' | 'rewriting' | 'tts' | 'fitting' | 'done' | 'failed';
export type JobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_errors' | 'cancelled' | 'failed';

export interface DubbingCueInput {
  id: string;
  index?: number;
  startMs: number;
  endMs: number;
  originalText: string;
  translatedText: string;
  text: string;
  previousText?: string;
  nextText?: string;
  provider: AIProvider;
  model: string;
  voice: string;
  speed: number;
  volume: number;
}

export interface DubbingJobConfig {
  speechMode?: 'continuous-first' | 'cue-first';
  timingMode: TimingMode;
  batchSize: number;
  ttsConcurrency: number;
  llmConcurrency: number;
  maxRetries: number;
  slowVideoToMatchSpeech: boolean;
  audioMix: { mode: 'mute' | 'original' | 'background'; keepOriginal: boolean; originalVolume: number; separateVocals: boolean };
  rewriteProviderRef?: string;
  rewriteModel?: string;
}

export interface ProviderInfoReference {
  ref: string;
  providerId: string;
  name: string;
  baseUrl: string;
}

export interface DubbingJob {
  id: string;
  videoId?: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  totalCues: number;
  doneCues: number;
  failedCues: number;
  currentBatch: number;
  config: DubbingJobConfig;
  providerInfo: ProviderInfoReference[];
  warnings: string[];
  finalization?: { stage: 'continuous' | 'mixing' | 'mastering'; completed: number; total: number };
  result?: { audioFile: string; metadataFile: string; durationMs: number; masteringVersion?: number };
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

export interface DubbingTimelineItem {
  cueId: string;
  startMs: number;
  endMs: number;
  audioDurationMs: number;
}

export interface PlannedDubbingTimelineItem extends DubbingTimelineItem {
  timelineStartMs: number;
  timelineEndMs: number;
  timelineShiftMs: number;
}

export interface AdaptiveTempoItem extends DubbingTimelineItem {
  targetDurationMs: number;
}

export interface ContinuousSpeechItem {
  cueId: string;
  startMs: number;
  endMs: number;
  providerRef: string;
  model: string;
  voice: string;
  speed: number;
  volume: number;
  text: string;
}

export interface ContinuousSpeechGroup {
  id: string;
  cueIds: string[];
  startMs: number;
  endMs: number;
  text: string;
  providerRef: string;
  model: string;
  voice: string;
  speed: number;
  volume: number;
}

interface StoredCue {
  id: string;
  index: number;
  status: CueStatus;
  providerRef: string;
  input: Omit<DubbingCueInput, 'provider'>;
  attempts: number;
  updatedAt: string;
  audioFile?: string;
  metadata?: DubbingMetadata;
  error?: string;
  errorStage?: CueStatus;
  skipRewrite?: boolean;
  continuousGroupFile?: string;
}

function continuousInputSignature(cues: StoredCue[]) {
  return createHash('sha256').update(JSON.stringify(cues.map((cue) => [cue.id, cue.providerRef,
    cue.input.model, cue.input.voice, cue.input.speed, cue.input.volume,
    cue.input.text, cue.input.startMs, cue.input.endMs]))).digest('hex');
}

interface DubbingRenderCueTiming {
  startMs: number;
  endMs: number;
}

interface DubbingRenderUnit {
  id: string;
  cues: StoredCue[];
  startMs: number;
  endMs: number;
  audioFile: string;
  audioDurationMs: number;
  volume: number;
  tempo: number;
  continuous: boolean;
  cueTimings?: Record<string, DubbingRenderCueTiming>;
}

interface CreateJobInput {
  videoId?: string;
  cues?: DubbingCueInput[];
  speechMode?: 'continuous-first' | 'cue-first';
  timingMode?: TimingMode;
  batchSize?: number;
  ttsConcurrency?: number;
  llmConcurrency?: number;
  maxRetries?: number;
  slowVideoToMatchSpeech?: boolean;
  audioMix?: { components?: Partial<LegacySourceAudioComponents>; mode?: 'mute' | 'original' | 'background'; keepOriginal?: boolean; originalVolume?: number; separateVocals?: boolean };
  rewrite?: { provider?: AIProvider; model?: string };
}

export function collapseRepeatedOcrDubbingCues(cues: DubbingCueInput[]) {
  const output: DubbingCueInput[] = [];
  for (const cue of cues) {
    const previous = output.at(-1);
    const sameOcrLine = Boolean(previous)
      && previous!.id.startsWith('ocr-')
      && cue.id.startsWith('ocr-')
      && previous!.text.normalize('NFC').replace(/\s+/g, ' ').trim() === cue.text.normalize('NFC').replace(/\s+/g, ' ').trim()
      && previous!.provider.id === cue.provider.id
      && previous!.model === cue.model
      && previous!.voice === cue.voice
      && cue.startMs - previous!.endMs <= 750;
    if (!sameOcrLine) {
      output.push(cue);
      continue;
    }
    output[output.length - 1] = {
      ...previous!,
      endMs: Math.max(previous!.endMs, cue.endMs),
      nextText: cue.nextText,
    };
  }
  return output;
}

const jobsRoot = path.join(workdir, 'jobs');
const DEFAULTS = {
  maxCueExtensionPercent: 0.15,
  maxCueExtensionMs: 400,
  safetyGapMs: 80,
  acceptableSpeedMax: 1.08,
  // Respect the voice speed selected by the user. Apply an additional tempo
  // only when the generated speech is actually longer than its cue window.
  narrationTempo: 1,
  // Prefer a shorter, meaning-preserving Vietnamese line over making an
  // entire speech block sound rushed. Rewriting is optional and falls back to
  // bounded time-stretch when no Translation provider is configured.
  rewriteTriggerSpeed: 1.15,
  // Keep dialogue aligned with the source before allowing delay to accumulate.
  // 1.25x remains inside FFmpeg atempo's clean single-filter range and is only
  // used for cues whose generated speech cannot finish at the original pace.
  hardSpeedMax: 1.25,
  pressuredSpeedMax: 1.25,
  // This is the speed explicitly selected by the user in the voice panel;
  // unlike automatic fitting it may intentionally be faster.
  maxProviderSpeed: 1.2,
  // Subtitle/STT cuts often leave a false 0.3-1.0 s hole inside continuous
  // narration. Let the preceding line use that room, but keep a real breath
  // and treat larger gaps as hard scene/dialogue anchors.
  adaptiveMaxGapMs: 900,
  clusterReservedPauseMs: 120,
  clusterTempoBlend: 0.15,
  // A sub-frame-perfect target made every line race. Human dubbing sounds more
  // natural with a tiny bounded delay than with a permanent 10-16% speed-up.
  maxTimelineDriftMs: 120,
  emergencyTimelineDriftMs: 250,
  joinedCueGapMs: 0,
  minSpeed: 0.90,
  maxRewriteAttempts: 2,
  // Closely spaced subtitle rows are often one uninterrupted spoken thought.
  // Re-synthesizing the whole block lets VieNeu keep prosody across subtitle
  // boundaries instead of restarting its acoustic state on every row.
  continuousSpeechGapMs: 420,
  continuousSpeechMaxDurationMs: 12_000,
  continuousSpeechMaxChars: 720,
  continuousSpeechMaxCues: 8,
  continuousSpeechMaxTempo: 1.18,
  continuousSpeechMaxOverflowMs: 280,
  batchSize: 30,
  ttsConcurrency: 6,
  llmConcurrency: 3,
  maxRetries: 3,
} as const;

// Do not reuse audio generated before CapCut request serialization and stable
// resource IDs were introduced. Old cache entries can contain a mismatched
// provider response even though their file format is valid.
// Invalidate clips enrolled with the pre-3.6 custom speaker frontend. Reusing
// those files would hide the voice-clone quality upgrade on existing jobs.
const TTS_CACHE_VERSION = 'tts-v12-vieneu-official-speaker-encoder';
const SPEECH_PREP_VERSION = 'speech-v3-pop-free-edges';
export const ADAPTIVE_FIT_VERSION = 15;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const now = () => new Date().toISOString();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'item';
interface LegacySourceAudioComponents { voice: boolean; music: boolean; effects: boolean; }

const normalizeAudioMix = (value?: CreateJobInput['audioMix']) => {
  const legacy = value?.components;
  // Older jobs could select music and effects independently. Demucs cannot
  // do that faithfully, so migrate them to the nearest reliable mode.
  const mode = value?.mode
    ?? (value?.keepOriginal === false || (legacy && !legacy.voice && !legacy.music && !legacy.effects)
      ? 'mute'
      : value?.separateVocals || (legacy && !legacy.voice && (legacy.music || legacy.effects))
        ? 'background'
      : 'mute');
  const keepOriginal = mode !== 'mute';
  return {
    mode,
    keepOriginal,
    originalVolume: keepOriginal ? clamp(Number(value?.originalVolume ?? 0.25), 0, 1) : 0,
    separateVocals: mode === 'background',
  };
};
const jobDir = (id: string) => path.join(jobsRoot, safeName(id));
const cueDir = (id: string) => path.join(jobDir(id), 'cues');
const providerDir = (id: string) => path.join(jobDir(id), 'providers');
const cacheDir = (id: string) => path.join(jobDir(id), 'cache', 'tts');
const timelineDir = (id: string) => path.join(jobDir(id), 'timeline');
const continuousCacheDir = (id: string) => path.join(jobDir(id), 'cache', 'continuous-speech');
const resultDir = (id: string) => path.join(jobDir(id), 'result');
const jobFile = (id: string) => path.join(jobDir(id), 'job.json');
const cueFile = (jobId: string, cueId: string) => path.join(cueDir(jobId), `${safeName(cueId)}.json`);
const audioFile = (jobId: string, cueId: string) => path.join(cueDir(jobId), `${safeName(cueId)}.wav`);
const timelineRenderConcurrency = () => clamp(Math.round(Number(process.env.AUTOSUB_TIMELINE_CONCURRENCY) || 4), 1, 4);
const TIMELINE_SEGMENT_CACHE_VERSION = 5;
const CONTINUOUS_SPEECH_VERSION = 1;

export const buildTimelineMixFilter = (inputCount: number, durationMs: number) => {
  const count = Math.max(1, Math.floor(inputCount));
  const mixed = Array.from({ length: count }, (_value, index) => `[a${index}]`).join('');
  const duration = Math.max(durationMs, 100);
  const seconds = (duration / 1000).toFixed(3);
  return `${mixed}amix=inputs=${count}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.891:level=false:latency=true,apad=whole_dur=${seconds},atrim=end=${seconds},asetpts=N/SR/TB[out]`;
};

export const cueBoundaryFades = (durationMs: number) => {
  const safeDurationMs = Math.max(1, Number(durationMs) || 1);
  // The cached TTS is already clean PCM. A true micro-fade is enough to avoid
  // a discontinuity at digital silence without swallowing the first consonant.
  const fadeInDuration = Math.min(0.012, Math.max(0.002, safeDurationMs / 8_000));
  const fadeOutDuration = Math.min(0.012, Math.max(0.002, safeDurationMs / 8_000));
  return {
    fadeInDuration,
    fadeOutDuration,
    fadeOutStart: Math.max(0, safeDurationMs / 1000 - fadeOutDuration),
  };
};

export const cueBoundaryFadeFilter = (durationMs: number) => {
  const fades = cueBoundaryFades(durationMs);
  // Fade the tail from the actual last sample. A timestamp derived from ffprobe
  // can be rounded by a few samples and leave a non-zero edge that clicks.
  return `afade=t=in:st=0:d=${fades.fadeInDuration.toFixed(3)},areverse,afade=t=in:st=0:d=${fades.fadeOutDuration.toFixed(3)},areverse`;
};

export const buildSeparatedAudioMixFilter = (durationMs: number, originalVolume: number) => {
  return buildStemAudioMixFilter(durationMs, originalVolume, 1);
};

export const buildStemAudioMixFilter = (durationMs: number, originalVolume: number, stemCount: number) => {
  const seconds = (Math.max(100, durationMs) / 1000).toFixed(3);
  const volume = clamp(Number(originalVolume), 0, 1).toFixed(3);
  const count = Math.max(1, Math.floor(stemCount));
  const stemLabels = Array.from({ length: count }, (_value, index) => `stem${index}`);
  const preparation = stemLabels.map((label, index) => `[${index + 1}:a]apad=whole_dur=${seconds},atrim=end=${seconds},asetpts=N/SR/TB[${label}]`).join(';');
  const background = count === 1
    ? `[stem0]volume=${volume}[background]`
    : `${stemLabels.map((label) => `[${label}]`).join('')}amix=inputs=${count}:duration=longest:dropout_transition=0:normalize=0,volume=${volume}[background]`;
  return {
    duration: seconds,
    // Demucs can leave faint vocal residue in no_vocals.wav. Duck that stem
    // only while the dub voice is active so it cannot sound like a second,
    // reverberant speaker, while retaining the background between cues.
    filter: `[0:a]apad=whole_dur=${seconds},atrim=end=${seconds},asetpts=N/SR/TB,asplit=2[dub][sidechain];${preparation};${background};[background][sidechain]sidechaincompress=threshold=0.002:ratio=20:attack=2:release=240:makeup=1[ducked];[dub][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.891:level=false[audioout]`,
  };
};

export function planDubbingTimeline(items: DubbingTimelineItem[], joinedCueGapMs = DEFAULTS.joinedCueGapMs): PlannedDubbingTimelineItem[] {
  const ordered = [...items].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const planned: PlannedDubbingTimelineItem[] = [];
  let previousEndMs: number | undefined;
  for (const item of ordered) {
    const sourceStartMs = Math.max(0, Math.round(item.startMs));
    // SRT timing is the source of truth. A long prior cue may delay the next
    // cue, but no cue may be pulled into a source pause or spoken early.
    const timelineStartMs = Math.max(
      sourceStartMs,
      previousEndMs === undefined ? 0 : previousEndMs + Math.max(0, Math.round(joinedCueGapMs)),
    );
    const timelineEndMs = timelineStartMs + Math.max(1, Math.round(item.audioDurationMs));
    planned.push({
      ...item,
      timelineStartMs,
      timelineEndMs,
      timelineShiftMs: timelineStartMs - sourceStartMs,
    });
    previousEndMs = timelineEndMs;
  }
  return planned;
}

export function planSlowVideoTimeline(items: DubbingTimelineItem[]): PlannedDubbingTimelineItem[] {
  let accumulatedExtensionMs = 0;
  return [...items]
    .sort((left, right) => left.startMs - right.startMs)
    .map((item) => {
      const cueDurationMs = Math.max(1, item.endMs - item.startMs);
      const audioDurationMs = Math.max(1, item.audioDurationMs);
      const timelineStartMs = item.startMs + accumulatedExtensionMs;
      const extensionMs = Math.max(0, audioDurationMs - cueDurationMs);
      const timelineEndMs = timelineStartMs + Math.max(cueDurationMs, audioDurationMs);
      const planned = { ...item, timelineStartMs, timelineEndMs, timelineShiftMs: accumulatedExtensionMs };
      accumulatedExtensionMs += extensionMs;
      return planned;
    });
}

export function planAdaptiveCueTempos(items: AdaptiveTempoItem[], maxSpeed: number = DEFAULTS.hardSpeedMax, _pressuredMaxSpeed: number = DEFAULTS.pressuredSpeedMax) {
  const ordered = [...items].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const availableDurationsMs: number[] = [];
  const localTempos = ordered.map((item, index) => {
    const next = ordered[index + 1];
    const sourceDurationMs = Math.max(1, item.endMs - item.startMs);
    // Match the source speech window first. The former planner treated the
    // following silence as free duration, so 1.00x clips routinely finished
    // after the original actor and made every later cue increasingly late.
    const configuredDurationMs = sourceDurationMs;
    let availableDurationMs = configuredDurationMs;
    if (next) {
      const sourceGapMs = Math.max(0, next.startMs - item.endMs);
      const reservedGapMs = sourceGapMs <= DEFAULTS.adaptiveMaxGapMs
        ? Math.min(sourceGapMs, DEFAULTS.clusterReservedPauseMs)
        : sourceGapMs;
      availableDurationMs = Math.max(configuredDurationMs, sourceDurationMs + sourceGapMs - reservedGapMs);
    }
    availableDurationsMs.push(availableDurationMs);
    const requiredTempo = item.audioDurationMs / Math.max(availableDurationMs, 1);
    return fittingTempo(requiredTempo, maxSpeed);
  });

  // A dub actor does not suddenly race for one subtitle and return to normal
  // on the next. Share a small amount of timing pressure with adjacent cues in
  // the same dialogue cluster. Hard pauses remain untouched anchors.
  const blendedTempos = localTempos.map((tempo, index) => {
    const previousIsJoined = index > 0 && ordered[index].startMs - ordered[index - 1].endMs <= DEFAULTS.adaptiveMaxGapMs;
    const nextIsJoined = index + 1 < ordered.length && ordered[index + 1].startMs - ordered[index].endMs <= DEFAULTS.adaptiveMaxGapMs;
    const previousTempo = previousIsJoined ? localTempos[index - 1] : tempo;
    const nextTempo = nextIsJoined ? localTempos[index + 1] : tempo;
    const blend = DEFAULTS.clusterTempoBlend;
    return fittingTempo(tempo * (1 - blend * 2) + previousTempo * blend + nextTempo * blend, maxSpeed);
  });

  // Keep each cue at or after its source timestamp, then add only the tempo
  // needed to stop a local delay from accumulating across the cluster.
  let previousEndMs: number | undefined;
  return ordered.map((item, index) => {
    const timelineStartMs = Math.max(item.startMs, previousEndMs ?? item.startMs);
    const latestNaturalEndMs = Math.max(
      item.endMs + DEFAULTS.emergencyTimelineDriftMs,
      item.startMs + availableDurationsMs[index],
    );
    const catchUpTempo = item.audioDurationMs / Math.max(1, latestNaturalEndMs - timelineStartMs);
    const tempo = fittingTempo(Math.max(blendedTempos[index], catchUpTempo), maxSpeed);
    previousEndMs = timelineStartMs + item.audioDurationMs / tempo;
    return { cueId: item.cueId, tempo };
  });
}

function normalizedContinuousText(value: string) {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export type ContinuousSpeechSilence = { startMs: number; endMs: number; durationMs: number };

export function parseContinuousSpeechSilences(stderr: string): ContinuousSpeechSilence[] {
  const silences: ContinuousSpeechSilence[] = [];
  let startMs: number | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) {
      startMs = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
    if (!end) continue;
    const endMs = Math.max(0, Math.round(Number(end[1]) * 1000));
    const durationMs = Math.max(0, Math.round(Number(end[2]) * 1000));
    const resolvedStartMs = startMs ?? Math.max(0, endMs - durationMs);
    startMs = undefined;
    if (endMs > resolvedStartMs) silences.push({ startMs: resolvedStartMs, endMs, durationMs });
  }
  return silences;
}

function continuousSpeechWeight(text: string) {
  const spoken = normalizedContinuousText(text)
    .replace(/\[(?:cười|thở dài|hắng giọng)\]/giu, '')
    .trim();
  const words = spoken.match(/[\p{L}\p{N}]+/gu) || [];
  const letters = words.reduce((sum, word) => sum + word.length, 0);
  const strongPauses = (spoken.match(/[.!?…]+/gu) || []).length;
  const weakPauses = (spoken.match(/[,;:]+/gu) || []).length;
  return Math.max(0.6, words.length + letters * 0.045 + strongPauses * 0.55 + weakPauses * 0.18);
}

export function planContinuousCueTimings(
  cues: Array<{ id: string; startMs: number; endMs: number; text: string }>,
  audioDurationMs: number,
  silences: ContinuousSpeechSilence[] = [],
) {
  if (!cues.length) return {} as Record<string, DubbingRenderCueTiming>;
  if (cues.length === 1) return { [cues[0]!.id]: { startMs: 0, endMs: Math.max(1, Math.round(audioDurationMs)) } };
  const durationMs = Math.max(cues.length, Math.round(audioDurationMs));
  const sourceStartMs = cues[0]!.startMs;
  const sourceDurationMs = Math.max(1, cues[cues.length - 1]!.endMs - sourceStartMs);
  const weights = cues.map((cue) => continuousSpeechWeight(cue.text));
  const totalWeight = Math.max(0.001, weights.reduce((sum, weight) => sum + weight, 0));
  const cleanSilences = silences
    .filter((silence) => silence.durationMs >= 35 && silence.startMs > 50 && silence.endMs < durationMs - 50)
    .sort((left, right) => left.startMs - right.startMs);
  const boundaries: Array<{ previousEndMs: number; nextStartMs: number }> = [];
  let consumedSilenceEndMs = 0;
  let cumulativeWeight = 0;

  for (let index = 0; index < cues.length - 1; index += 1) {
    cumulativeWeight += weights[index]!;
    const textExpectedMs = durationMs * (cumulativeWeight / totalWeight);
    const sourceBoundaryRatio = Math.max(0, Math.min(1, (cues[index]!.endMs - sourceStartMs) / sourceDurationMs));
    const sourceExpectedMs = durationMs * sourceBoundaryRatio;
    // Vietnamese TTS cadence should dominate, while the source timing still
    // provides a weak anchor for scene/dialogue rhythm.
    const expectedMs = textExpectedMs * 0.78 + sourceExpectedMs * 0.22;
    const searchRadiusMs = Math.max(260, Math.min(850, durationMs * 0.12));
    const candidate = cleanSilences
      .filter((silence) => silence.startMs >= consumedSilenceEndMs)
      .map((silence) => ({ silence, distance: Math.abs((silence.startMs + silence.endMs) / 2 - expectedMs) }))
      .filter((item) => item.distance <= searchRadiusMs)
      .sort((left, right) => left.distance - right.distance || right.silence.durationMs - left.silence.durationMs)[0]?.silence;
    if (candidate) {
      boundaries.push({ previousEndMs: candidate.startMs, nextStartMs: candidate.endMs });
      consumedSilenceEndMs = candidate.endMs;
    } else {
      const boundaryMs = Math.max(consumedSilenceEndMs, Math.min(durationMs - 1, Math.round(expectedMs)));
      boundaries.push({ previousEndMs: boundaryMs, nextStartMs: boundaryMs });
      consumedSilenceEndMs = boundaryMs;
    }
  }

  const output: Record<string, DubbingRenderCueTiming> = {};
  for (let index = 0; index < cues.length; index += 1) {
    const startMs = index === 0 ? 0 : boundaries[index - 1]!.nextStartMs;
    const endMs = index === cues.length - 1 ? durationMs : boundaries[index]!.previousEndMs;
    output[cues[index]!.id] = {
      startMs: Math.max(0, Math.min(durationMs - 1, Math.round(startMs))),
      endMs: Math.max(Math.round(startMs) + 1, Math.min(durationMs, Math.round(endMs))),
    };
  }
  return output;
}

async function measureContinuousCueTimings(
  cues: StoredCue[],
  audioPath: string,
  audioDurationMs: number,
  signal: AbortSignal,
) {
  let silences: ContinuousSpeechSilence[] = [];
  try {
    const detection = await run('ffmpeg', [
      '-hide_banner', '-nostats', '-i', audioPath,
      '-af', 'silencedetect=noise=-42dB:d=0.040',
      '-f', 'null', '-',
    ], signal);
    silences = parseContinuousSpeechSilences(detection.stderr);
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return planContinuousCueTimings(cues.map((cue) => ({
    id: cue.id,
    startMs: cue.input.startMs,
    endMs: cue.input.endMs,
    text: cue.metadata?.finalDubbingText || cue.input.text,
  })), audioDurationMs, silences);
}

function canJoinContinuousSpeech(previous: ContinuousSpeechItem, next: ContinuousSpeechItem, currentTextLength: number, currentStartMs: number, currentCueCount: number) {
  const gapMs = next.startMs - previous.endMs;
  if (gapMs < -250 || gapMs > DEFAULTS.continuousSpeechGapMs) return false;
  if (previous.providerRef !== next.providerRef || previous.model !== next.model || previous.voice !== next.voice) return false;
  if (Math.abs(previous.speed - next.speed) > 0.001 || Math.abs(previous.volume - next.volume) > 0.001) return false;
  if (/\[pause(?:\s+[^\]]+)?\]/iu.test(previous.text) || /\[pause(?:\s+[^\]]+)?\]/iu.test(next.text)) return false;
  if (currentCueCount >= DEFAULTS.continuousSpeechMaxCues) return false;
  if (next.endMs - currentStartMs > DEFAULTS.continuousSpeechMaxDurationMs) return false;
  return currentTextLength + normalizedContinuousText(next.text).length + 1 <= DEFAULTS.continuousSpeechMaxChars;
}

export function planContinuousSpeechGroups(items: ContinuousSpeechItem[]): ContinuousSpeechGroup[] {
  const ordered = [...items]
    .filter((item) => normalizedContinuousText(item.text))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const groups: ContinuousSpeechGroup[] = [];
  let current: ContinuousSpeechItem[] = [];

  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    const last = current[current.length - 1]!;
    groups.push({
      id: `continuous-${first.cueId}-${last.cueId}`,
      cueIds: current.map((item) => item.cueId),
      startMs: first.startMs,
      endMs: last.endMs,
      text: current.map((item) => normalizedContinuousText(item.text)).join(' '),
      providerRef: first.providerRef,
      model: first.model,
      voice: first.voice,
      speed: first.speed,
      volume: first.volume,
    });
    current = [];
  };

  for (const item of ordered) {
    if (!current.length) {
      current = [item];
      continue;
    }
    const previous = current[current.length - 1]!;
    const textLength = current.reduce((sum, cue) => sum + normalizedContinuousText(cue.text).length, Math.max(0, current.length - 1));
    if (canJoinContinuousSpeech(previous, item, textLength, current[0]!.startMs, current.length)) current.push(item);
    else {
      flush();
      current = [item];
    }
  }
  flush();
  return groups;
}

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(temporary, file);
  } catch (error) {
    // Windows cannot replace an existing file with rename on every filesystem.
    // The temporary file is still completed before the small replacement step.
    await rm(file, { force: true });
    await rename(temporary, file).catch(() => { throw error; });
  }
}

async function writeBufferAtomic(file: string, value: Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value);
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(file, { force: true });
    await rename(temporary, file).catch(() => { throw error; });
  }
}

async function replacePreparedFile(temporary: string, destination: string) {
  try {
    await rename(temporary, destination);
  } catch (error) {
    // Windows cannot atomically replace an existing destination on every
    // filesystem. Remove only after the replacement file is fully written.
    await rm(destination, { force: true });
    await rename(temporary, destination).catch(() => { throw error; });
  }
}

async function readJson<T>(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function probeDuration(file: string) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const seconds = Number(probe.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('FFprobe không đọc được thời lượng audio đã tạo.');
  return Math.round(seconds * 1000);
}

async function probeAudioIntegrity(file: string, signal?: AbortSignal) {
  const result = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'astats=metadata=0:reset=0', '-f', 'null', '-'], signal);
  const integrity = parseAudioIntegrity(result.stderr);
  if (integrity.peakLevelDb === Number.NEGATIVE_INFINITY && integrity.maxDifference === 0) {
    throw new Error(`FFmpeg không thể đo tính toàn vẹn của audio ${path.basename(file)}.`);
  }
  return integrity;
}

function nextCueStart(cues: StoredCue[], cue: StoredCue) {
  const ordered = [...cues].sort((left, right) => left.input.startMs - right.input.startMs);
  const position = ordered.findIndex((item) => item.id === cue.id);
  return position >= 0 ? ordered.slice(position + 1).find((item) => item.input.startMs >= cue.input.endMs)?.input.startMs : undefined;
}

function timingFor(cues: StoredCue[], cue: StoredCue, mode: TimingMode) {
  const originalDurationMs = Math.max(cue.input.endMs - cue.input.startMs, 50);
  if (mode === 'strict') return { originalDurationMs, extensionMs: 0, targetDurationMs: originalDurationMs };
  const nextStart = nextCueStart(cues, cue);
  const safeGapAfter = nextStart === undefined ? Number.POSITIVE_INFINITY : Math.max(0, nextStart - cue.input.endMs - DEFAULTS.safetyGapMs);
  const extensionMs = Math.round(Math.min(originalDurationMs * DEFAULTS.maxCueExtensionPercent, DEFAULTS.maxCueExtensionMs, safeGapAfter));
  return { originalDurationMs, extensionMs, targetDurationMs: originalDurationMs + extensionMs };
}

function normalizeRewrite(value: string) {
  return value.replace(/^```(?:text|plaintext)?\s*/i, '').replace(/\s*```$/i, '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function comparableWords(value: string) {
  return normalizeRewrite(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

function repeatsAdjacentPhrase(candidate: string, adjacent: string) {
  const candidateWords = comparableWords(candidate);
  const adjacentWords = comparableWords(adjacent);
  if (candidateWords.length < 3 || adjacentWords.length < 3) return false;
  if (candidateWords.join(' ') === adjacentWords.join(' ')) return true;
  let longest = 0;
  for (let start = 0; start < candidateWords.length; start += 1) {
    for (let adjacentStart = 0; adjacentStart < adjacentWords.length; adjacentStart += 1) {
      let length = 0;
      while (candidateWords[start + length] && candidateWords[start + length] === adjacentWords[adjacentStart + length]) length += 1;
      longest = Math.max(longest, length);
    }
  }
  return longest >= 3 && longest >= Math.ceil(Math.min(candidateWords.length, adjacentWords.length) * 0.5);
}

export function isUsefulDubbingRewrite(currentText: string, rewrittenText: string, forbiddenTexts: string[] = []) {
  const current = currentText.trim();
  const rewritten = normalizeRewrite(rewrittenText);
  return rewritten.length >= 2
    && rewritten.length < current.length
    && !forbiddenTexts.some((text) => repeatsAdjacentPhrase(rewritten, text));
}

export function dubbingRewriteWordLimit(currentText: string, targetDurationMs: number, measuredDurationMs: number, requestNumber: number) {
  const currentWords = comparableWords(currentText).length;
  if (currentWords <= 2) return Math.max(1, currentWords - 1);
  const fitRatio = clamp(
    (Math.max(targetDurationMs, 1) * DEFAULTS.acceptableSpeedMax) / Math.max(measuredDurationMs, 1),
    0.15,
    0.92,
  );
  const measuredLimit = Math.floor(currentWords * fitRatio * 0.92);
  const cadenceLimit = Math.floor((targetDurationMs / 1000) * 2.7) - Math.max(0, requestNumber - 1);
  return clamp(Math.min(currentWords - 1, measuredLimit, cadenceLimit), 2, currentWords - 1);
}

async function rewriteTranslation(cue: StoredCue, provider: AIProvider, model: string, currentText: string, targetDurationMs: number, measuredDurationMs: number, requestNumber: number, rejectedRewrites: string[], signal: AbortSignal) {
  const seconds = (targetDurationMs / 1000).toFixed(2);
  const maxWords = dubbingRewriteWordLimit(currentText, targetDurationMs, measuredDurationMs, requestNumber);
  const system = 'You are a Vietnamese dubbing dialogue editor. Return exactly one natural Vietnamese sentence, without markdown or explanation. Never copy or borrow content from another subtitle cue. The result will replace the visible subtitle, so it must preserve the cue meaning while obeying the word limit.';
  const rejected = rejectedRewrites.length ? `\nDo not repeat these rejected answers: ${rejectedRewrites.map((value) => JSON.stringify(value)).join(', ')}.` : '';
  const prompt = `Adapt ONLY the current dialogue for clear Vietnamese speech in ${seconds} seconds. The current TTS audio measures ${(measuredDurationMs / 1000).toFixed(2)} seconds and does not fit. This is shortening request ${requestNumber}. Use at most ${maxWords} words; this word limit is mandatory. Keep the main meaning, subject, action, names and important numbers; remove repetition and filler first. Do not merge it with another cue, do not continue it with the next cue, and do not use wording from adjacent cues.${rejected}\n\nOriginal source cue: ${cue.input.originalText}\nCurrent Vietnamese subtitle: ${currentText}\nAdjacent cues are boundaries only: previous=${cue.input.previousText ? '[present]' : '[none]'}, next=${cue.input.nextText ? '[present]' : '[none]'}\nReturn one Vietnamese sentence of no more than ${maxWords} words.`;
  const result = normalizeRewrite(await chat(provider, model, [{ role: 'system', content: system }, { role: 'user', content: prompt }], signal));
  if (!result || result.length < 2) throw new Error('AI không trả về câu rút gọn hợp lệ.');
  return { text: result, maxWords };
}

export function tempoFilter(tempo: number) {
  const filters: string[] = [];
  // This filter is used for speech, not music. Rubber Band preserves pitch
  // well but its phase reconstruction can leave a short chorus/echo on some
  // stretched syllables. FFmpeg's atempo is cleaner for the bounded speech
  // range used here (0.90x-1.18x), so keep every cue in one stable voice path.
  if (Math.abs(tempo - 1) > 0.005) filters.push(`atempo=${clamp(tempo, 0.5, 2).toFixed(3)}`);
  // Limiting belongs to the completed timeline, not every individual cue.
  // Applying it here and again after mixing caused avoidable pumping/distortion.
  return filters.join(',') || 'anull';
}

export function fallbackTempoFilter(tempo: number) {
  return Math.abs(tempo - 1) > 0.005 ? `atempo=${clamp(tempo, 0.5, 2).toFixed(3)}` : 'anull';
}

export type AudioIntegrity = { peakLevelDb: number; maxDifference: number };

export function parseAudioIntegrity(stderr: string): AudioIntegrity {
  const values = (label: string) => [...stderr.matchAll(new RegExp(`${label}:\\s*(-?inf|[-+]?\\d+(?:\\.\\d+)?)`, 'gi'))]
    .map((match) => match[1].toLowerCase() === '-inf' ? Number.NEGATIVE_INFINITY : Number(match[1]))
    .filter((value) => !Number.isNaN(value));
  return {
    peakLevelDb: Math.max(...values('Peak level dB'), Number.NEGATIVE_INFINITY),
    maxDifference: Math.max(...values('Max difference'), 0),
  };
}

export function timeStretchIntroducedArtifacts(source: AudioIntegrity, output: AudioIntegrity) {
  const newFullScalePeak = output.peakLevelDb >= -0.001 && source.peakLevelDb < -0.05;
  const newImpulse = output.maxDifference >= 16_384 && output.maxDifference > Math.max(source.maxDifference * 1.5, source.maxDifference + 2_048);
  return newFullScalePeak || newImpulse;
}

export function canFitSpeechWithoutCut(ttsDurationMs: number, targetDurationMs: number, maxSpeed = DEFAULTS.hardSpeedMax) {
  return ttsDurationMs <= Math.max(targetDurationMs, 1) * maxSpeed + 20;
}

export function shouldUseContinuousSpeech(config: Pick<DubbingJobConfig, 'slowVideoToMatchSpeech' | 'timingMode'>, cueCount: number) {
  return cueCount >= 2 && !config.slowVideoToMatchSpeech && config.timingMode !== 'strict';
}

export function fittingTempo(requiredSpeed: number, maxSpeed: number = DEFAULTS.hardSpeedMax) {
  return clamp(Math.max(requiredSpeed, DEFAULTS.narrationTempo), 1, maxSpeed);
}

// CapCut returns a small amount of encoder silence around each phrase. It is
// safe to remove only the leading/trailing silence; internal pauses are part
// of the actor's delivery and must remain intact.
// Keep a short piece of the provider's natural room tone at both ends. Cutting
// exactly at the first/last voiced sample creates a broadband click whenever
// adjacent CapCut MP3 responses are placed on the dubbing timeline.
// Nonzero start_silence produces a one-sample spike at the retained-silence
// boundary on affected FFmpeg builds. Edge fades are applied when mixing cues.
export const speechTrimFilter = 'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0,areverse';

export function isTransientDubbingError(error: unknown) {
  if (error instanceof ProviderError) {
    const providerText = `${error.message} ${error.detail || ''}`;
    if (/usage[_ -]?exceeded|insufficient[_ -]?quota|quota.{0,24}(exceed|exhaust|limit|empty)|(?:credit|credits).{0,24}(exhaust|used|limit|insufficient)|billing|monthly limit|plan limit/i.test(providerText)) return false;
    return error.status === 429 || error.status >= 500;
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error) return /timeout|timed out|network|fetch failed|socket|ECONN|ETIMEDOUT/i.test(error.message);
  return false;
}

export function isRewriteUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = error instanceof ProviderError ? error.status : undefined;
  return (status === undefined || [400, 404, 405, 422].includes(status))
    && /(?:capability\s+chat|chat\s+capability)|(?:chat|capability).*(?:unsupported|not supported|unavailable)/i.test(error.message);
}

export function shouldAttemptDubbingRewrite(mode: TimingMode, requiredSpeed: number, attempt: number) {
  // Strict mode keeps imported subtitle text and timestamps authoritative. A
  // locally long cue may still fit naturally once its whole block is planned.
  return mode !== 'strict'
    && requiredSpeed > DEFAULTS.rewriteTriggerSpeed
    && attempt < DEFAULTS.maxRewriteAttempts;
}

export function shouldFallbackDubbingRewrite(error: unknown, aborted: boolean) {
  if (aborted) return false;
  return !(error instanceof Error && error.name === 'AbortError');
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(new Error('Dubbing job đã được hủy.')); };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export async function retryDubbingOperation<T>(task: () => Promise<T>, maxRetries: number, signal: AbortSignal) {
  for (let retryIndex = 0; ; retryIndex += 1) {
    try {
      return await task();
    } catch (error) {
      if (signal.aborted || !isTransientDubbingError(error) || retryIndex >= maxRetries) throw error;
      await sleep(Math.min(12_000, 500 * 2 ** retryIndex), signal);
    }
  }
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async use<T>(task: () => Promise<T>) {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    try { return await task(); } finally { this.active -= 1; this.queue.shift()?.(); }
  }
}

// Pipeline at most two groups: the next TTS can run while FFmpeg processes
// the previous group. Await all started work before returning on failure.
export async function runContinuousSpeechPipeline<T>(items: T[], task: (item: T) => Promise<void>, signal: AbortSignal) {
  const semaphore = new Semaphore(2);
  const results = await Promise.allSettled(items.map((item) => semaphore.use(async () => {
    signal.throwIfAborted();
    await task(item);
  })));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export function dubbingProgressPercent(job: Pick<DubbingJob, 'status' | 'doneCues' | 'totalCues' | 'finalization'>) {
  if (job.status === 'completed') return 100;
  if (!job.totalCues) return 0;
  if (job.doneCues < job.totalCues) return Math.min(85, Math.round(job.doneCues / job.totalCues * 85));
  if (job.finalization?.stage === 'mastering') return 98;
  if (job.finalization?.stage === 'mixing') return 96;
  const phase = job.finalization;
  return phase?.total ? 85 + Math.min(10, Math.floor(phase.completed / phase.total * 10)) : 85;
}

const metadataFor = (cue: StoredCue, timing: ReturnType<typeof timingFor>, text: string, ttsDurationMs: number, finalAudioDurationMs: number, rewriteAttempts: number, speedApplied: number, warning?: string): DubbingMetadata => ({
  cueId: cue.id,
  originalText: cue.input.originalText,
  translatedText: cue.input.translatedText,
  finalDubbingText: text,
  originalDurationMs: timing.originalDurationMs,
  targetDurationMs: timing.targetDurationMs,
  ttsDurationMs,
  finalAudioDurationMs,
  rewriteAttempts,
  speedApplied,
  adaptiveFitVersion: 0,
  extensionMs: timing.extensionMs,
  ...(warning ? { warning } : {}),
});

function providerReference(provider: AIProvider) {
  return safeName(provider.id || provider.name || createHash('sha1').update(provider.baseUrl).digest('hex').slice(0, 10));
}

function isCapCutProvider(provider: AIProvider) {
  return provider.providerType === 'capcut-tts' || provider.baseUrl.trim().toLowerCase() === 'local://capcut-tts';
}

function isVieneuProvider(provider: AIProvider) {
  return provider.providerType === 'vieneu-local' || provider.baseUrl.trim().toLowerCase() === 'local://vieneu';
}

function jobUsesCapCut(job: DubbingJob) {
  return job.providerInfo.some((provider) => provider.baseUrl.trim().toLowerCase() === 'local://capcut-tts');
}

export function effectiveTtsConcurrency(cues: DubbingCueInput[], requested?: number) {
  const normal = clamp(Math.round(requested || DEFAULTS.ttsConcurrency), 1, 16);
  return cues.some((cue) => isCapCutProvider(cue.provider)) ? 1 : normal;
}

async function saveCue(jobId: string, cue: StoredCue) {
  cue.updatedAt = now();
  await writeJsonAtomic(cueFile(jobId, cue.id), cue);
}

async function loadCues(jobId: string) {
  const files = await readdir(cueDir(jobId));
  const cues: StoredCue[] = [];
  const cueFiles = files.filter((item) => item.endsWith('.json'));
  for (let offset = 0; offset < cueFiles.length; offset += 32) {
    cues.push(...await Promise.all(cueFiles.slice(offset, offset + 32)
      .map((file) => readJson<StoredCue>(path.join(cueDir(jobId), file)))));
  }
  return cues.sort((left, right) => left.index - right.index);
}

async function loadProvider(jobId: string, ref: string) {
  return readJson<AIProvider>(path.join(providerDir(jobId), `${safeName(ref)}.json`));
}

function ttsCacheFiles(jobId: string, provider: AIProvider, input: StoredCue['input'], text: string) {
  const speed = clamp(Number(input.speed) || 1, DEFAULTS.minSpeed, DEFAULTS.maxProviderSpeed);
  const cacheKey = createHash('sha256').update(JSON.stringify([TTS_CACHE_VERSION, provider.id, provider.baseUrl, input.model, input.voice, text, speed, 'wav'])).digest('hex');
  const speechKey = createHash('sha256').update(JSON.stringify([cacheKey, SPEECH_PREP_VERSION])).digest('hex');
  return {
    speed,
    rawPath: path.join(cacheDir(jobId), `${cacheKey}.wav`),
    speechPath: path.join(cacheDir(jobId), `${speechKey}.speech.wav`),
  };
}

async function ensurePreparedSpeech(rawPath: string, speechPath: string, signal: AbortSignal) {
  const prepared = await stat(speechPath).catch(() => undefined);
  if (prepared?.isFile()) return;
  await stat(rawPath);
  await run('ffmpeg', ['-y', '-i', rawPath, '-af', speechTrimFilter, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', speechPath], signal);
}

export async function createDubbingJob(input: CreateJobInput) {
  if (!input.cues?.length) throw new Error('Chưa có cue nào để tạo dubbing job.');
  if (input.slowVideoToMatchSpeech && input.audioMix?.separateVocals) throw new Error('Chế độ video chậm theo cue chưa hỗ trợ tách nhạc nền. Hãy giữ toàn bộ audio gốc hoặc tắt audio gốc.');
  const normalizedCues = collapseRepeatedOcrDubbingCues(input.cues);
  const id = `dub-${Date.now()}-${createHash('sha1').update(`${Math.random()}-${Date.now()}`).digest('hex').slice(0, 8)}`;
  const rewriteProvider = input.rewrite?.provider;
  const rewriteModel = input.rewrite?.model?.trim();
  const rewriteProviderRef = rewriteProvider && rewriteModel ? providerReference(rewriteProvider) : undefined;
  const config: DubbingJobConfig = {
    speechMode: input.speechMode === 'cue-first' ? 'cue-first' : 'continuous-first',
    timingMode: input.timingMode === 'strict' ? 'strict' : 'natural',
    batchSize: clamp(Math.round(input.batchSize || DEFAULTS.batchSize), 1, 100),
    ttsConcurrency: effectiveTtsConcurrency(normalizedCues, input.ttsConcurrency),
    llmConcurrency: clamp(Math.round(input.llmConcurrency || DEFAULTS.llmConcurrency), 1, 8),
    maxRetries: clamp(Math.round(input.maxRetries ?? DEFAULTS.maxRetries), 0, 3),
    slowVideoToMatchSpeech: input.slowVideoToMatchSpeech === true,
    audioMix: normalizeAudioMix(input.audioMix),
    ...(rewriteProviderRef && rewriteModel ? { rewriteProviderRef, rewriteModel } : {}),
  };
  const providers = new Map<string, AIProvider>();
  if (rewriteProviderRef && rewriteProvider) providers.set(rewriteProviderRef, rewriteProvider);
  const storedCues: StoredCue[] = [];
  for (const [index, cue] of normalizedCues.entries()) {
    if (!cue.id || !cue.provider?.baseUrl || !cue.model || !cue.voice || !cue.text?.trim()) throw new Error(`Cue ${index + 1} is missing provider, model, voice, or text.`);
    const ref = providerReference(cue.provider);
    providers.set(ref, cue.provider);
    const { provider: _provider, ...cueInput } = cue;
    storedCues.push({ id: cue.id, index: cue.index ?? index + 1, status: 'pending', providerRef: ref, input: cueInput, attempts: 0, updatedAt: now() });
  }
  const job: DubbingJob = { id, ...(input.videoId ? { videoId: input.videoId } : {}), status: 'queued', createdAt: now(), updatedAt: now(), totalCues: storedCues.length, doneCues: 0, failedCues: 0, currentBatch: 0, config, providerInfo: [...providers.entries()].map(([ref, provider]) => ({ ref, providerId: provider.id, name: provider.name, baseUrl: provider.baseUrl })), warnings: [] };
  await mkdir(cueDir(id), { recursive: true });
  await mkdir(providerDir(id), { recursive: true });
  await mkdir(cacheDir(id), { recursive: true });
  await mkdir(timelineDir(id), { recursive: true });
  await mkdir(resultDir(id), { recursive: true });
  for (const [ref, provider] of providers) await writeJsonAtomic(path.join(providerDir(id), `${safeName(ref)}.json`), provider);
  for (let offset = 0; offset < storedCues.length; offset += 32) {
    await Promise.all(storedCues.slice(offset, offset + 32).map((cue) => saveCue(id, cue)));
  }
  await writeJsonAtomic(jobFile(id), job);
  return job;
}

export interface DubbingJobStatus extends DubbingJob {
  progressPercent: number;
  failedCueIds: string[];
  failedCueErrors: Array<{ id: string; index: number; stage: CueStatus; attempts: number; error: string }>;
}

export async function readDubbingJob(id: string) {
  const job = await readJson<DubbingJob>(jobFile(id));
  job.config = { ...job.config, audioMix: normalizeAudioMix(job.config?.audioMix) };
  return job;
}

export async function getDubbingJobStatus(id: string): Promise<DubbingJobStatus> {
  const job = await readDubbingJob(id);
  const cues = await loadCues(id);
  const doneCues = cues.filter((cue) => cue.status === 'done').length;
  const failed = cues.filter((cue) => cue.status === 'failed');
  if (doneCues !== job.doneCues || failed.length !== job.failedCues) {
    job.doneCues = doneCues;
    job.failedCues = failed.length;
    job.updatedAt = now();
    await writeJsonAtomic(jobFile(id), job);
  }
  return {
    ...job,
    progressPercent: dubbingProgressPercent(job),
    failedCueIds: failed.map((cue) => cue.id),
    failedCueErrors: failed.map((cue) => ({ id: cue.id, index: cue.index, stage: cue.errorStage || 'failed', attempts: cue.attempts, error: cue.error || 'Unknown cue error.' })),
  };
}

export async function findLatestDubbingJobByVideoId(videoId: string): Promise<DubbingJobStatus | undefined> {
  const normalizedVideoId = videoId.trim();
  if (!normalizedVideoId) return undefined;
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
  const jobs = (await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('dub-'))
    .map((entry) => readDubbingJob(entry.name).catch(() => undefined))))
    .filter((job): job is DubbingJob => Boolean(job?.videoId === normalizedVideoId))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return jobs[0] ? getDubbingJobStatus(jobs[0].id) : undefined;
}

export async function recoverDubbingJob(id: string) {
  const job = await readDubbingJob(id);
  const cues = await loadCues(id);
  for (const cue of cues) if (cue.status !== 'pending' && cue.status !== 'done' && cue.status !== 'failed') await saveCue(id, { ...cue, status: 'pending', error: undefined });
  const refreshed = await loadCues(id);
  job.status = job.status === 'running' ? 'queued' : job.status;
  job.doneCues = refreshed.filter((cue) => cue.status === 'done').length;
  job.failedCues = refreshed.filter((cue) => cue.status === 'failed').length;
  job.updatedAt = now();
  await writeJsonAtomic(jobFile(id), job);
  return getDubbingJobStatus(id);
}

class DubbingRunner {
  private active = false;
  private pauseRequested = false;
  private cancelRequested = false;
  private readonly controller = new AbortController();
  private readonly ttsSemaphore: Semaphore;
  private readonly llmSemaphore: Semaphore;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly job: DubbingJob, private readonly onFinish: () => void) {
    this.ttsSemaphore = new Semaphore(job.config.ttsConcurrency);
    this.llmSemaphore = new Semaphore(job.config.llmConcurrency);
  }

  start() {
    if (this.active) return;
    this.active = true;
    void this.run();
  }

  pause() { this.pauseRequested = true; }
  resume() { this.pauseRequested = false; if (!this.active) this.start(); }
  cancel() { this.cancelRequested = true; this.controller.abort(); }

  private async commit(mutator: (job: DubbingJob) => void) {
    const next = this.persistChain.then(async () => { mutator(this.job); this.job.updatedAt = now(); await writeJsonAtomic(jobFile(this.job.id), this.job); });
    this.persistChain = next.then(() => undefined, () => undefined);
    await next;
  }

  private async setCueStatus(cue: StoredCue, status: CueStatus, patch: Partial<StoredCue> = {}) {
    const previous = cue.status;
    Object.assign(cue, patch, { status });
    await saveCue(this.job.id, cue);
    await this.commit((job) => {
      if (previous === 'done') job.doneCues -= 1;
      if (previous === 'failed') job.failedCues -= 1;
      if (status === 'done') job.doneCues += 1;
      if (status === 'failed') job.failedCues += 1;
    });
  }

  private async recoverProcessing() {
    const cues = await loadCues(this.job.id);
    for (const cue of cues) if (cue.status !== 'pending' && cue.status !== 'done' && cue.status !== 'failed') await saveCue(this.job.id, { ...cue, status: 'pending', error: undefined });
    const refreshed = await loadCues(this.job.id);
    await this.commit((job) => { job.status = 'queued'; job.doneCues = refreshed.filter((cue) => cue.status === 'done').length; job.failedCues = refreshed.filter((cue) => cue.status === 'failed').length; });
  }

  private async processCueAttempt(cue: StoredCue, allCues: StoredCue[]) {
    const provider = await loadProvider(this.job.id, cue.providerRef);
    const rewriteProvider = this.job.config.rewriteProviderRef && this.job.config.rewriteModel
      ? await loadProvider(this.job.id, this.job.config.rewriteProviderRef)
      : undefined;
    const timing = timingFor(allCues, cue, this.job.config.timingMode);
    await this.setCueStatus(cue, 'translating', { error: undefined });
    // Existing subtitle jobs may still contain raw OCR digits/operators. TTS
    // must receive spoken Vietnamese, not depend on each provider guessing how
    // to pronounce symbols and numbers.
    let finalText = verbalizeOcrSymbols(cue.input.text.trim(), 'vi');
    let rewriteAttempts = 0;
    let ttsDurationMs = 0;
    let requiredSpeed = 1;
    let rawPath = '';
    let speechPath = '';
    let rewriteWarning: string | undefined;
    let rewriteRequests = 0;
    const rejectedRewrites: string[] = [];

    for (let attempt = 0; attempt <= DEFAULTS.maxRewriteAttempts; attempt += 1) {
      const cached = ttsCacheFiles(this.job.id, provider, cue.input, finalText);
      const ttsSpeed = cached.speed;
      rawPath = cached.rawPath;
      speechPath = cached.speechPath;
      try {
        await stat(rawPath);
      } catch {
        await this.setCueStatus(cue, 'tts');
        const generated = await this.ttsSemaphore.use(() => retryDubbingOperation(() => synthesize(provider, cue.input.model, cue.input.voice, finalText, { speed: ttsSpeed, format: 'wav', signal: this.controller.signal }), this.job.config.maxRetries, this.controller.signal));
        await writeBufferAtomic(rawPath, generated);
      }
      await ensurePreparedSpeech(rawPath, speechPath, this.controller.signal);
      ttsDurationMs = await probeDuration(speechPath);
      requiredSpeed = ttsDurationMs / timing.targetDurationMs;
      if (!shouldAttemptDubbingRewrite(this.job.config.timingMode, requiredSpeed, attempt)) break;
      if (cue.skipRewrite || !rewriteProvider || !this.job.config.rewriteModel) {
        rewriteWarning = cue.skipRewrite
          ? `Cue ${cue.index}: lần rút gọn trước không ngắn hơn; AutoSub giữ nguyên nội dung và sẽ cân nhịp theo cụm.`
          : `Cue ${cue.index} quá dài nhưng chưa cấu hình provider Dịch/Chat để rút gọn; AutoSub sẽ ưu tiên cân tốc độ và khoảng trống trong cụm.`;
        break;
      }
      await this.setCueStatus(cue, 'rewriting');
      let rewritten: { text: string; maxWords: number };
      rewriteRequests += 1;
      try {
        rewritten = await this.llmSemaphore.use(() => retryDubbingOperation(() => rewriteTranslation(cue, rewriteProvider, this.job.config.rewriteModel as string, finalText, timing.targetDurationMs, ttsDurationMs, rewriteRequests, rejectedRewrites, this.controller.signal), this.job.config.maxRetries, this.controller.signal));
      } catch (error) {
        if (!shouldFallbackDubbingRewrite(error, this.controller.signal.aborted)) throw error;
        rewriteWarning = `Cue ${cue.index} không dùng được provider đã chọn để rút gọn; AutoSub sẽ ưu tiên cân tốc độ và khoảng trống trong cụm.`;
        break;
      }
      if (!isUsefulDubbingRewrite(finalText, rewritten.text, [cue.input.previousText || '', cue.input.nextText || ''])) {
        rejectedRewrites.push(rewritten.text);
        rewriteWarning = `Cue ${cue.index}: rewrite request ${rewriteRequests} was not shorter; trying again with a stricter word limit.`;
        continue;
      }
      finalText = rewritten.text;
      rewriteAttempts += 1;
    }

    // The provider already receives the user-selected voice speed. Do not add a
    // second baseline speed-up here; fit only audio that truly exceeds its cue.
    const warnings = [
      rewriteAttempts > 0 ? `Cue ${cue.index} đã được rút gọn để đọc tự nhiên hơn.` : undefined,
      rewriteWarning,
      !canFitSpeechWithoutCut(ttsDurationMs, timing.targetDurationMs)
        ? `Cue ${cue.index} vẫn dài hơn cửa sổ thoại; AutoSub giữ trọn lời và sẽ cân tốc độ cùng timeline theo cụm để tránh chồng tiếng.`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    const warning = warnings.join(' ') || undefined;
    await this.setCueStatus(cue, 'fitting');
    const finalPath = audioFile(this.job.id, cue.id);
    const temporary = `${finalPath}.${process.pid}.${Date.now()}.tmp.wav`;
    // speechPath is already normalized PCM 48 kHz stereo. A byte-for-byte copy
    // avoids launching FFmpeg once per cue before group-aware fitting.
    await copyFile(speechPath, temporary);
    await replacePreparedFile(temporary, finalPath);
    const finalAudioDurationMs = ttsDurationMs;
    const metadata = metadataFor(cue, timing, finalText, ttsDurationMs, finalAudioDurationMs, rewriteAttempts, 1, warning);
    await this.setCueStatus(cue, 'done', { audioFile: path.relative(jobDir(this.job.id), finalPath), metadata, error: undefined });
  }

  private async processCue(cue: StoredCue, allCues: StoredCue[]) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        cue.attempts += 1;
        await this.processCueAttempt(cue, allCues);
        return;
      } catch (error) {
        if (this.cancelRequested || this.controller.signal.aborted) throw error;
        if (!isTransientDubbingError(error) || attempt >= this.job.config.maxRetries) {
          const message = error instanceof ProviderError ? error.message : error instanceof Error ? error.message : 'Cue processing failed.';
          await this.setCueStatus(cue, 'failed', { error: message, errorStage: cue.status });
          return;
        }
        await sleep(Math.min(12_000, 500 * 2 ** attempt), this.controller.signal);
      }
    }
  }

  private async loadContinuousCheckpoints(cues: StoredCue[]): Promise<DubbingRenderUnit[]> {
    const units: DubbingRenderUnit[] = [];
    for (const file of new Set(cues.flatMap((cue) => cue.continuousGroupFile ? [cue.continuousGroupFile] : []))) {
      try {
        const stored = await readJson<Omit<DubbingRenderUnit, 'cues'> & { cueIds: string[]; signature: string }>(path.join(jobDir(this.job.id), file));
        const peers = stored.cueIds.map((id) => cues.find((cue) => cue.id === id));
        if (peers.some((cue) => !cue || cue.status !== 'done' || cue.continuousGroupFile !== file)) continue;
        const groupCues = peers as StoredCue[];
        if (stored.signature !== continuousInputSignature(groupCues)) continue;
        const audioPath = path.join(jobDir(this.job.id), stored.audioFile);
        if (!(await stat(audioPath)).isFile()) continue;
        units.push({ ...stored, cues: groupCues, audioFile: audioPath });
      } catch { /* Invalid checkpoints keep the existing per-cue fallback. */ }
    }
    return units;
  }

  private async buildContinuousRenderUnits(completed: StoredCue[], firstPass = false): Promise<DubbingRenderUnit[]> {
    const individualUnits = completed.filter((cue) => cue.status === 'done' && cue.audioFile && cue.metadata).map((cue): DubbingRenderUnit => ({
      id: cue.id,
      cues: [cue],
      startMs: cue.input.startMs,
      endMs: cue.input.endMs,
      audioFile: path.join(jobDir(this.job.id), cue.audioFile as string),
      audioDurationMs: cue.metadata?.finalAudioDurationMs || cue.input.endMs - cue.input.startMs,
      volume: clamp(cue.input.volume ?? 1, 0, 2),
      tempo: cue.metadata?.speedApplied || 1,
      continuous: false,
    }));
    if (!shouldUseContinuousSpeech(this.job.config, completed.length)) return individualUnits;

    const checkpoints = await this.loadContinuousCheckpoints(completed);
    const checkpointCueIds = new Set(checkpoints.flatMap((unit) => unit.cues.map((cue) => cue.id)));
    // New jobs have already attempted groups before individual fallback. Never
    // synthesize rejected groups again during final export or cached rebuild.
    if (!firstPass && this.job.config.speechMode === 'continuous-first' && !this.job.config.rewriteProviderRef) {
      return [...individualUnits.filter((unit) => !checkpointCueIds.has(unit.id)), ...checkpoints]
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.cues[0]!.index - b.cues[0]!.index);
    }
    const groups = planContinuousSpeechGroups(completed.map((cue) => ({
      cueId: cue.id,
      startMs: cue.input.startMs,
      endMs: cue.input.endMs,
      providerRef: cue.providerRef,
      model: cue.input.model,
      voice: cue.input.voice,
      speed: clamp(Number(cue.input.speed) || 1, DEFAULTS.minSpeed, DEFAULTS.maxProviderSpeed),
      volume: clamp(cue.input.volume ?? 1, 0, 2),
      text: cue.metadata?.finalDubbingText || verbalizeOcrSymbols(cue.input.text.trim(), 'vi'),
    }))).filter((group) => group.cueIds.length >= 2 && (!firstPass || (
      group.cueIds.some((id) => completed.find((cue) => cue.id === id)?.status === 'pending')
      && group.cueIds.every((id) => {
        const cue = completed.find((item) => item.id === id)!;
        return cue.status === 'pending' || (cue.status === 'done' && Boolean(cue.continuousGroupFile));
      })
    )));
    if (!groups.length) return individualUnits;

    await mkdir(continuousCacheDir(this.job.id), { recursive: true });
    const cueById = new Map(completed.map((cue) => [cue.id, cue]));
    const providerCache = new Map<string, AIProvider>();
    const replacementUnits: DubbingRenderUnit[] = [];
    const replacedCueIds = new Set<string>();
    let failedClusters = 0;
    // Keep synthesis serialized, retaining the existing CPU/model footprint.
    const synthesisSemaphore = new Semaphore(1);
    const cacheLocks = new Map<string, Semaphore>();
    await this.commit((job) => {
      if (job.finalization && job.finalization.stage !== 'continuous') return;
      const completed = job.finalization?.stage === 'continuous' ? job.finalization.completed : 0;
      job.finalization = { stage: 'continuous', completed, total: groups.length };
    });
    let finishedGroups = 0;
    await runContinuousSpeechPipeline(groups, async (group) => {
      try {
      if (firstPass && this.pauseRequested) return;
      const groupCues = group.cueIds.map((id) => cueById.get(id)).filter((cue): cue is StoredCue => Boolean(cue));
      if (groupCues.length !== group.cueIds.length) return;
      let provider = providerCache.get(group.providerRef);
      if (!provider) {
        provider = await loadProvider(this.job.id, group.providerRef);
        providerCache.set(group.providerRef, provider);
      }
      // VieNeu v3 Turbo is explicitly designed for long-form text and performs
      // its own punctuation-aware chunk joining. Other providers keep their
      // existing per-cue path until their long-form behavior is verified.
      if (!isVieneuProvider(provider)) return;

      const cacheKey = createHash('sha256').update(JSON.stringify([
        CONTINUOUS_SPEECH_VERSION,
        TTS_CACHE_VERSION,
        provider.id,
        provider.baseUrl,
        group.model,
        group.voice,
        group.speed,
        group.text,
      ])).digest('hex');
      const rawPath = path.join(continuousCacheDir(this.job.id), `${cacheKey}.raw.wav`);
      const speechPath = path.join(continuousCacheDir(this.job.id), `${cacheKey}.speech.wav`);
      let cacheLock = cacheLocks.get(cacheKey);
      if (!cacheLock) { cacheLock = new Semaphore(1); cacheLocks.set(cacheKey, cacheLock); }
      await cacheLock.use(async () => {
      try {
          const selectedProvider = provider;
          await synthesisSemaphore.use(async () => {
          if ((await stat(rawPath).catch(() => undefined))?.isFile()) return;
          const generated = await this.ttsSemaphore.use(() => retryDubbingOperation(
            () => synthesize(selectedProvider, group.model, group.voice, group.text, {
              speed: group.speed,
              format: 'wav',
              signal: this.controller.signal,
            }),
            this.job.config.maxRetries,
            this.controller.signal,
          ));
          await writeBufferAtomic(rawPath, generated);
          });
        await ensurePreparedSpeech(rawPath, speechPath, this.controller.signal);
        const cleanDurationMs = await probeDuration(speechPath);
        const sourceDurationMs = Math.max(1, group.endMs - group.startMs);
        const requiredTempo = cleanDurationMs / sourceDurationMs;
        const tempo = fittingTempo(requiredTempo, DEFAULTS.continuousSpeechMaxTempo);
        const projectedDurationMs = cleanDurationMs / tempo;
        if (projectedDurationMs - sourceDurationMs > DEFAULTS.continuousSpeechMaxOverflowMs) return;

        let outputPath = speechPath;
        let finalDurationMs = cleanDurationMs;
        if (Math.abs(tempo - 1) > 0.005) {
          const fittedPath = path.join(continuousCacheDir(this.job.id), `${cacheKey}.${tempo.toFixed(3)}.fit.wav`);
          if (!(await stat(fittedPath).catch(() => undefined))?.isFile()) {
            const temporary = `${fittedPath}.${process.pid}.${Date.now()}.tmp.wav`;
            try {
              const sourceIntegrity = await probeAudioIntegrity(speechPath, this.controller.signal);
              await run('ffmpeg', ['-y', '-i', speechPath, '-filter:a', tempoFilter(tempo), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', temporary], this.controller.signal);
              const fittedIntegrity = await probeAudioIntegrity(temporary, this.controller.signal);
              if (timeStretchIntroducedArtifacts(sourceIntegrity, fittedIntegrity)) {
                await rm(temporary, { force: true });
                throw new Error('continuous speech stretch introduced artifacts');
              }
              await replacePreparedFile(temporary, fittedPath);
            } finally {
              await rm(temporary, { force: true });
            }
          }
          outputPath = fittedPath;
          finalDurationMs = await probeDuration(fittedPath);
        }

        const cueTimings = await measureContinuousCueTimings(
          groupCues,
          outputPath,
          finalDurationMs,
          this.controller.signal,
        );
        const unit: DubbingRenderUnit = {
          id: group.id,
          cues: groupCues,
          startMs: group.startMs,
          endMs: group.endMs,
          audioFile: outputPath,
          audioDurationMs: finalDurationMs,
          volume: group.volume,
          tempo,
          continuous: true,
          cueTimings,
        };
        if (firstPass) {
          const wav = await readFile(outputPath);
          // Validate all preview slices before committing any cue in the group.
          const clips = groupCues.map((cue) => {
            const timing = cueTimings[cue.id]!;
            return sliceDubbingPcm(wav, timing.startMs, timing.endMs);
          });
          const checkpointPath = path.join(continuousCacheDir(this.job.id), `${safeName(group.id)}.group.json`);
          const checkpointFile = path.relative(jobDir(this.job.id), checkpointPath);
          await writeJsonAtomic(checkpointPath, {
            ...unit, cues: undefined, cueIds: group.cueIds,
            audioFile: path.relative(jobDir(this.job.id), outputPath),
            signature: continuousInputSignature(groupCues),
          });
          for (const [index, cue] of groupCues.entries()) {
            const clip = clips[index]!;
            const clipDurationMs = (clip.length - 44) * 1000 / clip.readUInt32LE(28);
            const target = audioFile(this.job.id, cue.id);
            await writeBufferAtomic(target, clip);
            const metadata = metadataFor(cue, timingFor(completed, cue, this.job.config.timingMode),
              verbalizeOcrSymbols(cue.input.text.trim(), 'vi'), clipDurationMs * tempo, clipDurationMs, 0, tempo);
            metadata.adaptiveFitVersion = ADAPTIVE_FIT_VERSION;
            await this.setCueStatus(cue, 'done', {
              audioFile: path.relative(jobDir(this.job.id), target), metadata,
              continuousGroupFile: checkpointFile, error: undefined,
            });
          }
        }
        replacementUnits.push(unit);
        group.cueIds.forEach((id) => replacedCueIds.add(id));
      } catch (error) {
        if (this.controller.signal.aborted) throw error;
        failedClusters += 1;
      }
      });
      } finally {
        finishedGroups += 1;
        await this.commit((job) => {
          if (job.finalization?.stage === 'continuous') job.finalization.completed = Math.max(job.finalization.completed, finishedGroups);
        });
      }
    }, this.controller.signal);

    if (failedClusters) {
      await this.commit((job) => {
        const warning = `${failedClusters} cụm thoại liên tục không dựng được bằng long-form VieNeu; AutoSub đã tự dùng audio từng cue làm fallback.`;
        if (!job.warnings.includes(warning)) job.warnings.push(warning);
      });
    }

    return [
      ...individualUnits.filter((unit) => !replacedCueIds.has(unit.id)),
      ...replacementUnits,
    ].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.cues[0]!.index - right.cues[0]!.index);
  }

  private async buildTimeline(cues: StoredCue[]) {
    const completed = cues
      .filter((cue) => cue.status === 'done' && cue.audioFile && cue.metadata)
      .sort((left, right) => left.input.startMs - right.input.startMs || left.index - right.index);
    if (completed.length !== this.job.totalCues) throw new Error('Chưa thể dựng timeline cuối vì vẫn còn cue chưa hoàn tất.');
    const providers = new Map<string, AIProvider>();
    for (const cue of completed) {
      if (!cue.metadata || cue.metadata.adaptiveFitVersion === ADAPTIVE_FIT_VERSION) continue;
      let provider = providers.get(cue.providerRef);
      if (!provider) {
        provider = await loadProvider(this.job.id, cue.providerRef);
        providers.set(cue.providerRef, provider);
      }
      const cached = ttsCacheFiles(this.job.id, provider, cue.input, cue.metadata.finalDubbingText);
      await ensurePreparedSpeech(cached.rawPath, cached.speechPath, this.controller.signal);
      const cleanDurationMs = await probeDuration(cached.speechPath);
      cue.metadata = {
        ...cue.metadata,
        ttsDurationMs: cleanDurationMs,
        finalAudioDurationMs: cleanDurationMs,
        speedApplied: 1,
        adaptiveFitVersion: 0,
      };
    }
    const adaptiveTempoById = new Map((this.job.config.slowVideoToMatchSpeech
      ? completed.map((cue) => ({ cueId: cue.id, tempo: 1 }))
      : planAdaptiveCueTempos(completed.map((cue) => ({
      cueId: cue.id,
      startMs: cue.input.startMs,
      endMs: cue.input.endMs,
      audioDurationMs: cue.metadata?.ttsDurationMs || cue.input.endMs - cue.input.startMs,
      targetDurationMs: cue.metadata?.targetDurationMs || cue.input.endMs - cue.input.startMs,
    })))).map((item) => [item.cueId, item.tempo]));
    const fitConcurrency = timelineRenderConcurrency();
    for (let offset = 0; offset < completed.length; offset += fitConcurrency) {
      const results = await Promise.allSettled(completed.slice(offset, offset + fitConcurrency).map(async (cue) => {
      if (!cue.audioFile || !cue.metadata || cue.metadata.adaptiveFitVersion === ADAPTIVE_FIT_VERSION) return;
      const tempo = adaptiveTempoById.get(cue.id) || 1;
      const sourcePath = path.join(jobDir(this.job.id), cue.audioFile);
      let provider = providers.get(cue.providerRef);
      if (!provider) {
        provider = await loadProvider(this.job.id, cue.providerRef);
        providers.set(cue.providerRef, provider);
      }
      const cached = ttsCacheFiles(this.job.id, provider, cue.input, cue.metadata.finalDubbingText);
      const cleanSpeechPath = cached.speechPath;
      const cleanSpeech = await stat(cleanSpeechPath).catch(() => undefined);
      if (cleanSpeech?.isFile()) {
        const restore = `${sourcePath}.${process.pid}.${Date.now()}.restore.wav`;
        try {
          await copyFile(cleanSpeechPath, restore);
          await replacePreparedFile(restore, sourcePath);
        } finally {
          await rm(restore, { force: true });
        }
      } else if ((cue.metadata.adaptiveFitVersion ?? 0) > 0) {
        throw new Error(`Cue ${cue.index} cần bản speech sạch để sửa bản co giãn cũ. Hãy tạo lại voice của cue này.`);
      }
      if (Math.abs(tempo - 1) > 0.005) {
        const temporary = `${sourcePath}.${process.pid}.${Date.now()}.fit.wav`;
        try {
          const sourceIntegrity = await probeAudioIntegrity(sourcePath, this.controller.signal);
          let needsFallback = false;
          try {
            await run('ffmpeg', ['-y', '-i', sourcePath, '-filter:a', tempoFilter(tempo), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', temporary], this.controller.signal);
            needsFallback = timeStretchIntroducedArtifacts(sourceIntegrity, await probeAudioIntegrity(temporary, this.controller.signal));
          } catch (error) {
            if (this.controller.signal.aborted) throw error;
            needsFallback = true;
          }
          if (needsFallback) {
            await rm(temporary, { force: true });
            await run('ffmpeg', ['-y', '-i', sourcePath, '-filter:a', fallbackTempoFilter(tempo), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', temporary], this.controller.signal);
            const fallbackIntegrity = await probeAudioIntegrity(temporary, this.controller.signal);
            if (timeStretchIntroducedArtifacts(sourceIntegrity, fallbackIntegrity)) {
              throw new Error(`Cue ${cue.index} bị biến dạng sau cả hai bộ co giãn audio; AutoSub đã dừng lại thay vì lưu file lỗi.`);
            }
          }
          await replacePreparedFile(temporary, sourcePath);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      cue.metadata = {
        ...cue.metadata,
        speedApplied: tempo,
        // At natural speed sourcePath is a byte-for-byte copy of the clean
        // speech measured above; only stretched audio needs another probe.
        finalAudioDurationMs: Math.abs(tempo - 1) > 0.005
          ? await probeDuration(sourcePath)
          : cue.metadata.ttsDurationMs,
        adaptiveFitVersion: ADAPTIVE_FIT_VERSION,
      };
      await saveCue(this.job.id, cue);
      }));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }
    const renderUnits = await this.buildContinuousRenderUnits(completed);
    await this.commit((job) => { if (job.finalization?.stage !== 'mastering') job.finalization = { stage: 'mixing', completed: 0, total: 1 }; });
    const timelineItems = renderUnits.map((unit) => ({
      cueId: unit.id,
      startMs: unit.startMs,
      endMs: unit.endMs,
      audioDurationMs: unit.audioDurationMs,
    }));
    const planById = new Map((this.job.config.slowVideoToMatchSpeech
      ? planSlowVideoTimeline(timelineItems)
      : planDubbingTimeline(timelineItems)).map((item) => [item.cueId, item]));
    const unitByCueId = new Map<string, DubbingRenderUnit>();
    for (const unit of renderUnits) for (const cue of unit.cues) unitByCueId.set(cue.id, unit);

    const metadataWrites: Array<Promise<void>> = [];
    const metadataWriteSemaphore = new Semaphore(16);
    for (const cue of completed) {
      const unit = unitByCueId.get(cue.id);
      const plan = unit ? planById.get(unit.id) : undefined;
      if (!unit || !plan || !cue.metadata) continue;
      const sourceUnitDurationMs = Math.max(1, unit.endMs - unit.startMs);
      const scale = unit.audioDurationMs / sourceUnitDurationMs;
      const measuredTiming = unit.cueTimings?.[cue.id];
      const relativeStartMs = unit.continuous
        ? measuredTiming?.startMs ?? Math.max(0, Math.round((cue.input.startMs - unit.startMs) * scale))
        : 0;
      const relativeEndMs = unit.continuous
        ? measuredTiming?.endMs ?? Math.max(relativeStartMs + 1, Math.round((cue.input.endMs - unit.startMs) * scale))
        : unit.audioDurationMs;
      const timelineStartMs = unit.continuous ? plan.timelineStartMs + relativeStartMs : plan.timelineStartMs;
      const timelineEndMs = unit.continuous
        ? Math.min(plan.timelineEndMs, plan.timelineStartMs + relativeEndMs)
        : plan.timelineEndMs;
      const timelineShiftMs = plan.timelineStartMs - unit.startMs;
      if (
        cue.metadata.timelineStartMs === timelineStartMs
        && cue.metadata.timelineEndMs === timelineEndMs
        && cue.metadata.timelineShiftMs === timelineShiftMs
        && cue.metadata.speedApplied === unit.tempo
      ) continue;
      cue.metadata = {
        ...cue.metadata,
        speedApplied: unit.tempo,
        timelineStartMs,
        timelineEndMs,
        timelineShiftMs,
      };
      metadataWrites.push(metadataWriteSemaphore.use(() => saveCue(this.job.id, cue)));
    }
    await Promise.all(metadataWrites);
    await mkdir(timelineDir(this.job.id), { recursive: true });
    const batchSize = this.job.config.batchSize;
    const segmentSemaphore = new Semaphore(timelineRenderConcurrency());
    const segmentTasks: Array<Promise<{ file: string; startMs: number; durationMs: number }>> = [];
    for (let offset = 0; offset < renderUnits.length; offset += batchSize) {
      const batch = renderUnits.slice(offset, offset + batchSize);
      const firstPlan = planById.get(batch[0]!.id);
      const segmentStart = offset === 0 ? 0 : firstPlan?.timelineStartMs ?? batch[0]!.startMs;
      const segmentEnd = Math.max(...batch.map((unit) => planById.get(unit.id)?.timelineEndMs ?? unit.endMs));
      const durationMs = Math.max(segmentEnd - segmentStart, 100);
      const segmentIndex = segmentTasks.length;
      segmentTasks.push(segmentSemaphore.use(async () => {
        const args: string[] = ['-y'];
        const filters: string[] = [];
        const fingerprints = [];
        for (const [index, unit] of batch.entries()) {
          const source = unit.audioFile;
          const sourceStat = await stat(source);
          const delay = Math.max(0, Math.round((planById.get(unit.id)?.timelineStartMs ?? unit.startMs) - segmentStart));
          const unitDurationMs = unit.audioDurationMs;
          const fades = cueBoundaryFades(unitDurationMs);
          const volume = clamp(unit.volume, 0, 2).toFixed(3);
          args.push('-i', source);
          filters.push(`[${index}:a]volume=${volume},${cueBoundaryFadeFilter(unitDurationMs)},adelay=${delay}|${delay}[a${index}]`);
          fingerprints.push([unit.id, sourceStat.size, sourceStat.mtimeMs, delay, unitDurationMs, volume, fades, unit.continuous]);
        }
        filters.push(buildTimelineMixFilter(batch.length, durationMs));
        const output = path.join(timelineDir(this.job.id), `segment-${String(segmentIndex).padStart(5, '0')}.wav`);
        const cacheFile = `${output}.json`;
        const signature = createHash('sha256').update(JSON.stringify([TIMELINE_SEGMENT_CACHE_VERSION, segmentStart, durationMs, fingerprints])).digest('hex');
        const cached = await readJson<{ signature: string }>(cacheFile).catch(() => undefined);
        if (cached?.signature === signature && (await stat(output).catch(() => undefined))?.isFile()) {
          return { file: output, startMs: segmentStart, durationMs };
        }
        const temporary = `${output}.${process.pid}.${Date.now()}.tmp.wav`;
        try {
          await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', temporary], this.controller.signal);
          await replacePreparedFile(temporary, output);
          await writeJsonAtomic(cacheFile, { signature });
        } finally {
          await rm(temporary, { force: true });
        }
        return { file: output, startMs: segmentStart, durationMs };
      }));
    }
    const segments = await Promise.all(segmentTasks);
    const rawFinalPath = path.join(resultDir(this.job.id), 'dub-track-raw.wav');
    const finalPath = path.join(resultDir(this.job.id), 'dub-track.wav');
    const masteredTemporary = `${finalPath}.${process.pid}.${Date.now()}.master.wav`;
    const timelineDurationMs = Math.max(...segments.map((segment) => segment.startMs + segment.durationMs), 100);
    const finalArgs: string[] = ['-y'];
    const finalFilters: string[] = [];
    segments.forEach((segment, index) => {
      finalArgs.push('-i', segment.file);
      const delay = Math.max(0, Math.round(segment.startMs));
      finalFilters.push(`[${index}:a]adelay=${delay}|${delay}[a${index}]`);
    });
    finalFilters.push(buildTimelineMixFilter(segments.length, timelineDurationMs));
    await run('ffmpeg', [...finalArgs, '-filter_complex', finalFilters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', rawFinalPath], this.controller.signal);
    await this.commit((job) => { job.finalization = { stage: 'mastering', completed: 0, total: 1 }; });
    try {
      await masterDubFile(rawFinalPath, masteredTemporary, this.controller.signal);
      await replacePreparedFile(masteredTemporary, finalPath);
    } finally {
      await rm(rawFinalPath, { force: true });
      await rm(masteredTemporary, { force: true });
    }
    let outputPath = finalPath;
    if (this.job.config.audioMix.separateVocals) {
      if (!this.job.videoId) throw new Error('Tách lời gốc cần video nguồn đã được upload trong Editor.');
      const source = await resolveUpload(this.job.videoId);
      const separationDir = path.join(jobDir(this.job.id), 'source-stems');
      const sourceBase = path.parse(source.absolutePath).name;
      const stemPaths = [path.join(separationDir, 'htdemucs', sourceBase, 'no_vocals.wav')];
      const mixedPath = path.join(resultDir(this.job.id), 'dub-track-mixed.wav');
      const temporaryMixedPath = `${mixedPath}.${process.pid}.${Date.now()}.tmp.wav`;
      await rm(separationDir, { recursive: true, force: true });
      await mkdir(separationDir, { recursive: true });
      try {
        await run('py', ['-3.12', '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '--out', separationDir, source.absolutePath], this.controller.signal);
        await Promise.all(stemPaths.map((stemPath) => stat(stemPath)));
        const originalVolume = clamp(this.job.config.audioMix.originalVolume, 0, 1);
        const sourceDurationMs = await probeDuration(source.absolutePath);
        const finiteMix = buildStemAudioMixFilter(sourceDurationMs, originalVolume, stemPaths.length);
        await run('ffmpeg', ['-y', '-i', finalPath, ...stemPaths.flatMap((stemPath) => ['-i', stemPath]), '-filter_complex', finiteMix.filter, '-map', '[audioout]', '-t', finiteMix.duration, '-ar', '48000', '-ac', '2', temporaryMixedPath], this.controller.signal);
        await rm(mixedPath, { force: true });
        await rename(temporaryMixedPath, mixedPath);
        outputPath = mixedPath;
      } finally {
        await rm(separationDir, { recursive: true, force: true });
        await rm(temporaryMixedPath, { force: true });
      }
    }
    const durationMs = await probeDuration(outputPath);
    const metadata = completed.map((cue) => cue.metadata);
    await writeJsonAtomic(path.join(resultDir(this.job.id), 'metadata.json'), metadata);
    return { audioFile: path.relative(jobDir(this.job.id), outputPath), metadataFile: path.relative(jobDir(this.job.id), path.join(resultDir(this.job.id), 'metadata.json')), durationMs, masteringVersion: DUB_MASTERING_VERSION };
  }

  private async run() {
    try {
      await this.recoverProcessing();
      await this.commit((job) => { job.status = 'running'; });
      if (this.job.config.speechMode === 'continuous-first' && shouldUseContinuousSpeech(this.job.config, this.job.totalCues) && !this.job.config.rewriteProviderRef) {
        await this.buildContinuousRenderUnits(await loadCues(this.job.id), true);
      }
      while (true) {
        if (this.cancelRequested) throw new Error('Dubbing job đã được hủy.');
        if (this.pauseRequested) { await this.commit((job) => { job.status = 'paused'; }); return; }
        const cues = await loadCues(this.job.id);
        const pending = cues.filter((cue) => cue.status === 'pending');
        if (!pending.length) {
          if (cues.some((cue) => cue.status === 'failed')) {
            const failedCount = cues.filter((cue) => cue.status === 'failed').length;
            const successfulCount = cues.length - failedCount;
            await this.commit((job) => {
              job.status = 'completed_with_errors';
              job.result = undefined;
              job.warnings = [`${failedCount} cue failed and must be retried. ${successfulCount} completed cue${successfulCount === 1 ? '' : 's'} were kept.`];
            });
            return;
          }
          const result = await this.buildTimeline(cues);
          await this.commit((job) => { job.status = 'completed'; job.result = result; job.warnings = cues.flatMap((cue) => cue.metadata?.warning ? [cue.metadata.warning] : []); });
          return;
        }
        const batch = pending.slice(0, this.job.config.batchSize);
        await this.commit((job) => { job.currentBatch += 1; });
        // CapCut is intentionally processed cue-by-cue.  The provider's
        // unofficial endpoint is serialized already, but serializing the
        // complete cue lifecycle also prevents a whole batch from appearing
        // to fail at once in the editor when CapCut rejects invalid text.
        if (jobUsesCapCut(this.job)) {
          for (const cue of batch) {
            if (this.cancelRequested || this.pauseRequested) break;
            await this.processCue(cue, cues);
          }
        } else {
          await Promise.all(batch.map((cue) => this.processCue(cue, cues)));
        }
      }
    } catch (error) {
      if (this.cancelRequested || this.controller.signal.aborted) await this.commit((job) => { job.status = 'cancelled'; });
      else await this.commit((job) => { job.status = 'failed'; job.warnings = [error instanceof Error ? error.message : 'Dubbing job thất bại.']; });
    } finally {
      this.active = false;
      this.onFinish();
    }
  }
}

const runners = new Map<string, DubbingRunner>();

async function runnerFor(id: string) {
  const existing = runners.get(id);
  if (existing) return existing;
  const job = await readDubbingJob(id);
  const runner = new DubbingRunner(job, () => { if (runners.get(id) === runner) runners.delete(id); });
  runners.set(id, runner);
  return runner;
}

export async function startDubbingJob(id: string) { const runner = await runnerFor(id); runner.start(); return getDubbingJobStatus(id); }
export async function pauseDubbingJob(id: string) { const runner = runners.get(id); if (runner) runner.pause(); else { const job = await readDubbingJob(id); job.status = 'paused'; await writeJsonAtomic(jobFile(id), job); } return getDubbingJobStatus(id); }
export async function resumeDubbingJob(id: string) { const runner = await runnerFor(id); runner.resume(); return getDubbingJobStatus(id); }
export async function cancelDubbingJob(id: string) { const runner = runners.get(id); if (runner) runner.cancel(); else { const job = await readDubbingJob(id); job.status = 'cancelled'; await writeJsonAtomic(jobFile(id), job); } return getDubbingJobStatus(id); }
export async function rebuildDubbingJobResult(id: string) {
  if (runners.has(id)) throw new Error('Dubbing job đang chạy, không thể dựng lại kết quả cùng lúc.');
  const job = await readDubbingJob(id);
  const cues = await loadCues(id);
  if (cues.length !== job.totalCues || cues.some((cue) => cue.status !== 'done' || !cue.audioFile || !cue.metadata)) {
    throw new Error('Chỉ có thể dựng lại kết quả khi toàn bộ cue đã hoàn tất.');
  }
  job.status = 'queued';
  job.currentBatch = 0;
  job.finalization = undefined;
  job.warnings = [];
  job.updatedAt = now();
  await writeJsonAtomic(jobFile(id), job);
  return startDubbingJob(id);
}
export async function retryFailedDubbingJob(id: string, patches: Array<{ id: string } & Partial<Pick<DubbingCueInput, 'startMs' | 'endMs' | 'originalText' | 'translatedText' | 'text' | 'previousText' | 'nextText'>>> = []) {
  const cues = await loadCues(id);
  const patchesById = new Map(patches.map((patch) => [patch.id, patch]));
  for (const cue of cues) if (cue.status === 'failed') {
    const skipRewrite = cue.skipRewrite || /LLM did not make the sentence shorter/i.test(cue.error || '');
    const patch = patchesById.get(cue.id);
    const { id: _id, ...inputPatch } = patch || { id: cue.id };
    await saveCue(id, { ...cue, input: { ...cue.input, ...inputPatch }, status: 'pending', error: undefined, errorStage: undefined, skipRewrite, attempts: cue.attempts + 1 });
  }
  const job = await readDubbingJob(id);
  job.status = 'queued'; job.failedCues = 0; job.result = undefined; job.warnings = []; job.finalization = undefined;
  await writeJsonAtomic(jobFile(id), job);
  return startDubbingJob(id);
}

export async function queueDubbingCueRegeneration(id: string, cueId: string, patch: Partial<Pick<DubbingCueInput, 'startMs' | 'endMs' | 'originalText' | 'translatedText' | 'text' | 'previousText' | 'nextText'>>) {
  const job = await readDubbingJob(id);
  if (['queued', 'running', 'paused'].includes(job.status)) throw new Error('Job đang chạy. Hãy đợi job hiện tại hoàn tất trước khi tạo lại một cue.');
  const cues = await loadCues(id);
  const cue = cues.find((item) => item.id === cueId);
  if (!cue) throw new Error('Không tìm thấy cue cần tạo lại voice trong dubbing job này.');
  const nextInput = { ...cue.input, ...patch };
  nextInput.startMs = Math.max(0, Math.round(Number(nextInput.startMs)));
  nextInput.endMs = Math.max(nextInput.startMs + 1, Math.round(Number(nextInput.endMs)));
  nextInput.text = String(nextInput.text || '').trim();
  if (!nextInput.text) throw new Error('Cue chưa có nội dung để tạo voice.');

  await saveCue(id, {
    ...cue,
    status: 'pending',
    input: nextInput,
    attempts: 0,
    audioFile: undefined,
    metadata: undefined,
    continuousGroupFile: undefined,
    error: undefined,
    errorStage: undefined,
    skipRewrite: false,
  });
  const refreshed = await loadCues(id);
  job.status = 'queued';
  job.doneCues = refreshed.filter((item) => item.status === 'done').length;
  job.finalization = undefined;
  job.failedCues = refreshed.filter((item) => item.status === 'failed').length;
  job.currentBatch = 0;
  job.result = undefined;
  job.warnings = [];
  job.updatedAt = now();
  await writeJsonAtomic(jobFile(id), job);
  return getDubbingJobStatus(id);
}

export async function regenerateDubbingCue(id: string, cueId: string, patch: Partial<Pick<DubbingCueInput, 'startMs' | 'endMs' | 'originalText' | 'translatedText' | 'text' | 'previousText' | 'nextText'>>) {
  await queueDubbingCueRegeneration(id, cueId, patch);
  return startDubbingJob(id);
}

const resultMastering = new Map<string, Promise<DubbingJob>>();

async function ensureMasteredDubbingResult(job: DubbingJob) {
  if (!job.result || (job.result.masteringVersion ?? 0) >= DUB_MASTERING_VERSION) return job;
  const active = resultMastering.get(job.id);
  if (active) return active;
  const task = (async () => {
    const current = await readDubbingJob(job.id);
    if (!current.result || (current.result.masteringVersion ?? 0) >= DUB_MASTERING_VERSION) return current;
    const source = path.join(jobDir(current.id), current.result.audioFile);
    const masteredName = `dub-track-mastered-v${DUB_MASTERING_VERSION}.wav`;
    const mastered = path.join(resultDir(current.id), masteredName);
    const temporary = `${mastered}.${process.pid}.${Date.now()}.tmp.wav`;
    try {
      if (!(await stat(mastered).catch(() => undefined))?.isFile()) {
        await masterDubFile(source, temporary);
        await rename(temporary, mastered);
      }
      current.result = {
        ...current.result,
        audioFile: path.relative(jobDir(current.id), mastered),
        masteringVersion: DUB_MASTERING_VERSION,
      };
      current.updatedAt = now();
      await writeJsonAtomic(jobFile(current.id), current);
      return current;
    } finally {
      await rm(temporary, { force: true });
    }
  })().finally(() => resultMastering.delete(job.id));
  resultMastering.set(job.id, task);
  return task;
}

export async function getDubbingResult(id: string) {
  let job = await readDubbingJob(id);
  if (job.status !== 'completed' || !job.result) throw new Error('Dubbing job chưa hoàn tất.');
  job = await ensureMasteredDubbingResult(job);
  const result = job.result;
  if (!result) throw new Error('Dubbing job chưa có file kết quả.');
  const metadata = await readJson<DubbingMetadata[]>(path.join(jobDir(id), result.metadataFile));
  return { job, metadata, audioFile: path.join(jobDir(id), result.audioFile) };
}

export async function initializeDubbingJobs() {
  await mkdir(jobsRoot, { recursive: true });
  const entries = await readdir(jobsRoot, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      const job = await readDubbingJob(entry.name);
      if (job.status === 'running') { const runner = await runnerFor(job.id); runner.start(); }
    } catch { /* An incomplete directory is ignored and can be inspected manually. */ }
  }
}

export async function openDubbingAudio(id: string, range?: { start: number; end: number }) {
  const result = await getDubbingResult(id);
  const file = await stat(result.audioFile);
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  return { stream: createReadStream(result.audioFile, { start, end }), size: end - start + 1, totalSize: file.size, start, end };
}

export async function legacyTrackJob(input: CreateJobInput) {
  const job = await createDubbingJob(input);
  await startDubbingJob(job.id);
  return getDubbingJobStatus(job.id);
}
