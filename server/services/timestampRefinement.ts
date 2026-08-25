import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cleanupUploadSession, createTemporarySession } from './uploads';
import { run, workdir } from './ffmpeg';
import { normalizeCueTimeline } from './subtitles';

export interface SpeechRegion {
  startMs: number;
  endMs: number;
}

export type TimestampRefinementMethod = 'auto' | 'silero-vad' | 'ffmpeg-silencedetect' | 'silencedetect';

export interface TimestampRefinementConfig {
  enabled: boolean;
  method: TimestampRefinementMethod;
  searchPaddingBeforeMs: number;
  searchPaddingAfterMs: number;
  minSpeechMs: number;
  minSilenceGapMs: number;
  speechPadBeforeMs: number;
  speechPadAfterMs: number;
  vadThreshold: number;
  silenceThresholdDb: number;
  minSilenceDurationMs: number;
}

export interface TimestampRefinementCue {
  startMs: number;
  endMs: number;
  [key: string]: unknown;
}

export interface TimestampRefinementCueDetail {
  cue: number;
  providerStartMs: number;
  providerEndMs: number;
  refinedStartMs: number;
  refinedEndMs: number;
  timestampRefined: boolean;
  refinementConfidence: 'high' | 'medium' | 'low';
}

export interface TimestampRefinementMetadata {
  enabled: boolean;
  method: string;
  refinedCount: number;
  fallbackCount: number;
  analysisMs: number;
  speechRegions?: SpeechRegion[];
  details?: TimestampRefinementCueDetail[];
  error?: string;
}

export interface TimestampRefinementResult<T extends TimestampRefinementCue> {
  cues: T[];
  metadata: TimestampRefinementMetadata;
}

export const DEFAULT_TIMESTAMP_REFINEMENT: TimestampRefinementConfig = {
  enabled: true,
  method: 'auto',
  searchPaddingBeforeMs: 750,
  searchPaddingAfterMs: 750,
  minSpeechMs: 120,
  minSilenceGapMs: 250,
  speechPadBeforeMs: 100,
  speechPadAfterMs: 150,
  vadThreshold: 0.5,
  silenceThresholdDb: -35,
  minSilenceDurationMs: 180,
};

export type RefinementConfidence = TimestampRefinementCueDetail['refinementConfidence'];
type SpeechScanMethod = 'silero-vad' | 'ffmpeg-silencedetect';

export interface SpeechRegionScan {
  method: SpeechScanMethod;
  regions: SpeechRegion[];
  durationMs: number;
  confidence: RefinementConfidence;
  analysisMs: number;
  cached?: boolean;
}

export type SpeechRegionDetector = (audioPath: string, config: TimestampRefinementConfig) => Promise<SpeechRegionScan>;

const debugRefinement = (scope: string, value: Record<string, unknown>) => {
  if (process.env.AUTOSUB_DEBUG_UPLOADS === '1') console.info(`[${scope}] ${JSON.stringify(value)}`);
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function durationMsFromAudio(duration: string) {
  const seconds = Number(duration.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('FFprobe không đọc được thời lượng audio cho timestamp refinement.');
  return Math.max(1, Math.round(seconds * 1000));
}

function addRegion(regions: SpeechRegion[], startMs: number, endMs: number) {
  const start = Math.max(0, Math.round(startMs));
  const end = Math.max(start, Math.round(endMs));
  if (end > start) regions.push({ startMs: start, endMs: end });
}

/** Convert FFmpeg silencedetect events into sorted non-silent regions. */
export function parseSpeechRegions(stderr: string, durationMs: number) {
  const events: Array<{ type: 'start' | 'end'; atMs: number }> = [];
  const eventPattern = /silence_(start|end):\s*([0-9]+(?:\.[0-9]+)?)/g;
  for (const match of stderr.matchAll(eventPattern)) {
    events.push({ type: match[1] as 'start' | 'end', atMs: Math.max(0, Math.round(Number(match[2]) * 1000)) });
  }

  const regions: SpeechRegion[] = [];
  let cursorMs = 0;
  let inSilence = false;
  for (const event of events) {
    if (event.type === 'start') {
      if (!inSilence) addRegion(regions, cursorMs, Math.min(event.atMs, durationMs));
      inSilence = true;
    } else if (inSilence) {
      cursorMs = Math.max(cursorMs, Math.min(event.atMs, durationMs));
      inSilence = false;
    }
  }
  if (!inSilence) addRegion(regions, cursorMs, durationMs);
  return { regions, hadSilenceEvents: events.length > 0 };
}

/** Merge frame-level VAD output and add small boundary padding without loading audio. */
export function mergeSpeechRegions(regions: SpeechRegion[], durationMs: number, config: TimestampRefinementConfig = DEFAULT_TIMESTAMP_REFINEMENT) {
  const sorted = regions
    .filter((region) => finite(region.startMs) && finite(region.endMs) && region.endMs > region.startMs)
    .map((region) => ({ startMs: Math.max(0, Math.round(region.startMs)), endMs: Math.min(durationMs, Math.round(region.endMs)) }))
    .filter((region) => region.endMs > region.startMs)
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: SpeechRegion[] = [];
  const maxGap = Math.max(0, Math.round(config.minSilenceGapMs));
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && region.startMs - previous.endMs <= maxGap) {
      previous.endMs = Math.max(previous.endMs, region.endMs);
    } else {
      merged.push({ ...region });
    }
  }
  return merged
    .filter((region) => region.endMs - region.startMs >= Math.max(1, config.minSpeechMs))
    .map((region) => ({
      startMs: Math.max(0, region.startMs - Math.max(0, Math.round(config.speechPadBeforeMs))),
      endMs: Math.min(durationMs, region.endMs + Math.max(0, Math.round(config.speechPadAfterMs))),
    }))
    .filter((region) => region.endMs > region.startMs);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseBridgeRegions(stdout: string) {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.speechRegions)) throw new Error('Silero VAD bridge trả về metadata không hợp lệ.');
  return parsed.speechRegions.filter(isRecord).map((region) => ({
    startMs: Number(region.startMs),
    endMs: Number(region.endMs),
  }));
}

interface PythonCommand {
  command: string;
  prefix: string[];
}

const bridgePath = path.join(process.cwd(), 'server', 'services', 'silero_vad_bridge.py');
let pythonCommandPromise: Promise<PythonCommand> | undefined;

async function resolvePythonCommand(): Promise<PythonCommand> {
  const configured = process.env.AUTOSUB_SILERO_PYTHON;
  const candidates: PythonCommand[] = configured
    ? [{ command: configured, prefix: [] }]
    : process.platform === 'win32'
      ? [{ command: 'py', prefix: ['-3.12'] }, { command: 'python', prefix: [] }]
      : [{ command: 'python3', prefix: [] }, { command: 'python', prefix: [] }];
  for (const candidate of candidates) {
    try {
      await run(candidate.command, [...candidate.prefix, bridgePath, '--check']);
      debugRefinement('VAD METHOD', { method: 'silero-vad', python: candidate.command, available: true });
      return candidate;
    } catch {
      // Try the next known Python executable and let the caller use the safe fallback.
    }
  }
  throw new Error('Speech VAD unavailable; falling back to FFmpeg refinement.');
}

async function getPythonCommand() {
  if (!pythonCommandPromise) pythonCommandPromise = resolvePythonCommand();
  return pythonCommandPromise;
}

async function probeDuration(audioPath: string) {
  const duration = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', audioPath]);
  return durationMsFromAudio(duration.stdout);
}

async function prepareVADAudio(audioPath: string) {
  const temporaryDir = await createTemporarySession('vad-');
  const normalizedPath = path.join(temporaryDir, 'vad-input.wav');
  try {
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', audioPath, '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', normalizedPath,
    ]);
    return { temporaryDir, normalizedPath };
  } catch (error) {
    await cleanupUploadSession(temporaryDir);
    throw error;
  }
}

async function scanWithSilero(audioPath: string, config: TimestampRefinementConfig): Promise<SpeechRegionScan> {
  const startedAt = Date.now();
  const durationMs = await probeDuration(audioPath);
  const prepared = await prepareVADAudio(audioPath);
  try {
    const python = await getPythonCommand();
    const result = await run(python.command, [
      ...python.prefix,
      bridgePath,
      prepared.normalizedPath,
      '--threshold', String(config.vadThreshold),
      '--min-speech-ms', String(Math.max(1, Math.round(config.minSpeechMs))),
      // Keep model frame boundaries finer than the Node-side merge policy.
      '--min-silence-ms', String(Math.max(50, Math.min(120, Math.round(config.minSilenceGapMs)))),
    ]);
    const rawRegions = parseBridgeRegions(result.stdout);
    const regions = mergeSpeechRegions(rawRegions, durationMs, config);
    const scan = { method: 'silero-vad' as const, regions, durationMs, confidence: 'high' as const, analysisMs: Date.now() - startedAt };
    debugRefinement('VAD SPEECH REGIONS', { method: scan.method, audioPath, durationMs, regionCount: regions.length, regions: regions.slice(0, 10), confidence: scan.confidence, analysisMs: scan.analysisMs });
    return scan;
  } finally {
    await cleanupUploadSession(prepared.temporaryDir);
  }
}

async function scanWithSilenceDetect(audioPath: string, config: TimestampRefinementConfig): Promise<SpeechRegionScan> {
  const startedAt = Date.now();
  const durationMs = await probeDuration(audioPath);
  const noise = `${config.silenceThresholdDb}dB`;
  const silenceDuration = (Math.max(1, config.minSilenceDurationMs) / 1000).toFixed(3);
  const result = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-i', audioPath, '-map', '0:a:0',
    '-af', `silencedetect=noise=${noise}:d=${silenceDuration}`,
    '-f', 'null', '-',
  ]);
  const parsed = parseSpeechRegions(result.stderr, durationMs);
  const broadRegion = parsed.regions.some((region) => region.endMs - region.startMs > Math.max(30000, durationMs * 0.75));
  // silencedetect reports non-silence, not speech. It is deliberately never
  // high-confidence; broad output is retained only as a diagnostic fallback.
  const confidence: RefinementConfidence = parsed.hadSilenceEvents && parsed.regions.length && !broadRegion ? 'medium' : 'low';
  const scan = { method: 'ffmpeg-silencedetect' as const, regions: parsed.regions, durationMs, confidence, analysisMs: Date.now() - startedAt };
  debugRefinement('VAD SPEECH REGIONS', { method: scan.method, audioPath, durationMs, regionCount: parsed.regions.length, regions: parsed.regions.slice(0, 10), confidence, broadRegion, analysisMs: scan.analysisMs });
  return scan;
}

interface CachedSpeechScan extends SpeechRegionScan {
  cacheKey: string;
}

function cacheKeyFor(audioPath: string, details: { size: number; mtimeMs: number }, config: TimestampRefinementConfig) {
  return createHash('sha1').update(JSON.stringify({
    audioPath: path.resolve(audioPath),
    size: details.size,
    mtimeMs: details.mtimeMs,
    method: config.method,
    minSpeechMs: config.minSpeechMs,
    minSilenceGapMs: config.minSilenceGapMs,
    speechPadBeforeMs: config.speechPadBeforeMs,
    speechPadAfterMs: config.speechPadAfterMs,
    vadThreshold: config.vadThreshold,
    silenceThresholdDb: config.silenceThresholdDb,
    minSilenceDurationMs: config.minSilenceDurationMs,
    algorithmVersion: 2,
  })).digest('hex');
}

async function readCachedScan(cacheFile: string, cacheKey: string): Promise<SpeechRegionScan | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(cacheFile, 'utf8'));
    if (!isRecord(parsed) || parsed.cacheKey !== cacheKey || !Array.isArray(parsed.regions) || typeof parsed.method !== 'string') return undefined;
    const regions = parsed.regions.filter(isRecord).map((region) => ({ startMs: Number(region.startMs), endMs: Number(region.endMs) })).filter((region) => finite(region.startMs) && finite(region.endMs));
    if (!finite(parsed.durationMs) || typeof parsed.confidence !== 'string' || !['high', 'medium', 'low'].includes(parsed.confidence)) return undefined;
    return {
      method: parsed.method as SpeechScanMethod,
      regions,
      durationMs: parsed.durationMs,
      confidence: parsed.confidence as RefinementConfidence,
      analysisMs: 0,
      cached: true,
    };
  } catch {
    return undefined;
  }
}

async function writeCachedScan(cacheFile: string, scan: SpeechRegionScan, cacheKey: string) {
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    const value: CachedSpeechScan = { ...scan, cacheKey };
    await writeFile(cacheFile, JSON.stringify(value), 'utf8');
  } catch (error) {
    debugRefinement('VAD CACHE', { cacheFile, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function detectSpeechRegions(audioPath: string, config: TimestampRefinementConfig = DEFAULT_TIMESTAMP_REFINEMENT): Promise<SpeechRegionScan> {
  const file = await stat(audioPath);
  const cacheKey = cacheKeyFor(audioPath, file, config);
  const cacheFile = path.join(workdir, 'timestamp-vad-cache', `${cacheKey}.json`);
  const cached = await readCachedScan(cacheFile, cacheKey);
  if (cached) {
    debugRefinement('VAD METHOD', { method: cached.method, cached: true, audioPath, regionCount: cached.regions.length });
    return cached;
  }

  let scan: SpeechRegionScan | undefined;
  if (config.method !== 'ffmpeg-silencedetect' && config.method !== 'silencedetect') {
    try {
      scan = await scanWithSilero(audioPath, config);
    } catch (error) {
      debugRefinement('VAD METHOD', { method: 'silero-vad', available: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!scan) {
    scan = await scanWithSilenceDetect(audioPath, config);
    debugRefinement('VAD METHOD', { method: scan.method, fallback: true, confidence: scan.confidence });
  }
  await writeCachedScan(cacheFile, scan, cacheKey);
  return scan;
}

function lowerBound(regions: SpeechRegion[], value: number) {
  let low = 0;
  let high = regions.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (regions[middle].startMs < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function intersectionLength(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function distanceBetween(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  if (leftEnd >= rightStart && rightEnd >= leftStart) return 0;
  return leftEnd < rightStart ? rightStart - leftEnd : leftStart - rightEnd;
}

function selectSpeechRegion(regions: SpeechRegion[], cue: TimestampRefinementCue, config: TimestampRefinementConfig, minimumRegionIndex: number, usedRegions: Set<SpeechRegion>, nextCue?: TimestampRefinementCue) {
  const providerStartMs = Math.max(0, Math.round(cue.startMs));
  const providerEndMs = Math.max(providerStartMs + 1, Math.round(cue.endMs));
  const searchStartMs = Math.max(0, providerStartMs - Math.max(0, config.searchPaddingBeforeMs));
  const searchEndMs = providerEndMs + Math.max(0, config.searchPaddingAfterMs);
  const first = Math.max(minimumRegionIndex, lowerBound(regions, searchStartMs) - 1);
  const candidates: Array<{ index: number; region: SpeechRegion; overlapMs: number; distanceMs: number; score: number }> = [];
  for (let index = first; index < regions.length && regions[index].startMs < searchEndMs; index += 1) {
    const region = regions[index];
    if (region.endMs <= searchStartMs || usedRegions.has(region)) continue;
    const overlapMs = intersectionLength(region.startMs, region.endMs, providerStartMs, providerEndMs);
    const distanceMs = distanceBetween(region.startMs, region.endMs, providerStartMs, providerEndMs);
    const durationDistanceMs = Math.abs((region.endMs - region.startMs) - (providerEndMs - providerStartMs));
    const score = overlapMs * 1000 - Math.abs(region.endMs - providerEndMs) * 2 - durationDistanceMs * 0.25;
    candidates.push({ index, region, overlapMs, distanceMs, score });
  }
  candidates.sort((left, right) => right.score - left.score || right.overlapMs - left.overlapMs || left.distanceMs - right.distanceMs || left.index - right.index);
  const best = candidates[0];
  if (!best) return undefined;
  const overlapping = candidates.filter((candidate) => candidate.overlapMs > 0);
  let selected = best;
  let usedLateOnset = false;
  if (overlapping.length > 1) {
    // A provider segment can span a long silence and several unrelated VAD
    // regions. Once an earlier cue has consumed the first region, the latest
    // onset inside this provider span is the safe boundary for the next cue.
    // This prevents an uncertain earlier refinement from collapsing the next
    // cue back to the previous cue's end.
    const lateOnset = minimumRegionIndex > 0
      ? candidates
        .filter((candidate) => candidate.index >= minimumRegionIndex && candidate.region.startMs > providerStartMs && candidate.region.startMs < providerEndMs)
        .sort((left, right) => right.region.startMs - left.region.startMs)[0]
      : undefined;
    if (!lateOnset) return undefined;
    const boundedEndMs = Math.min(providerEndMs, lateOnset.region.endMs);
    if (boundedEndMs <= lateOnset.region.startMs) return undefined;
    selected = { ...lateOnset, region: { startMs: lateOnset.region.startMs, endMs: boundedEndMs } };
    usedLateOnset = true;
  }
  const second = candidates[1];
  const ambiguous = !usedLateOnset && Boolean(second && best.overlapMs > 0 && second.overlapMs > 0 && best.score - second.score < Math.max(1, config.minSpeechMs));
  if (ambiguous) return undefined;
  if (selected.overlapMs <= 0 && selected.distanceMs > Math.max(config.searchPaddingBeforeMs, config.searchPaddingAfterMs)) return undefined;
  const providerDurationMs = providerEndMs - providerStartMs;
  const rawRegionDurationMs = selected.region.endMs - selected.region.startMs;
  if (!usedLateOnset && rawRegionDurationMs > Math.max(providerDurationMs * 4, providerDurationMs + 5000)) return undefined;
  if (!usedLateOnset && rawRegionDurationMs - providerDurationMs > Math.max(3000, providerDurationMs * 0.75)) return undefined;
  const boundedRegion = selected.region.startMs <= providerStartMs && selected.region.endMs > providerEndMs
    ? { ...selected.region, endMs: providerEndMs }
    : selected.region;
  const regionDurationMs = boundedRegion.endMs - boundedRegion.startMs;
  // A VAD region that reaches into the following provider cue contains more
  // than one utterance. Consuming it here would push/collapse every later cue.
  if (nextCue) {
    const nextStartMs = Math.max(0, Math.round(nextCue.startMs));
    const nextEndMs = Math.max(nextStartMs + 1, Math.round(nextCue.endMs));
    if (boundedRegion.startMs >= nextStartMs || boundedRegion.endMs >= nextEndMs) return undefined;
  }
  // A long CJK sentence cannot fit into a tiny VAD fragment. Keep genuinely
  // short utterances, but reject collapsed windows such as 15 characters in
  // 570 ms that would be unreadable and are usually the tail of another cue.
  const cueText = typeof cue.originalText === 'string' ? cue.originalText : typeof cue.text === 'string' ? cue.text : '';
  const cjkLength = [...cueText.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)].length;
  if (cjkLength >= 4 && regionDurationMs < cjkLength * 70) return undefined;
  if (regionDurationMs > Math.max(providerDurationMs * 4, providerDurationMs + 5000)) return undefined;
  // A materially longer region is usually music/ambient audio or multiple
  // utterances joined together. Keep the provider hint instead of making a
  // confident-looking bad match.
  if (regionDurationMs - providerDurationMs > Math.max(3000, providerDurationMs * 0.75)) return undefined;
  return { ...selected, region: boundedRegion, confidence: usedLateOnset ? 'medium' as const : selected.overlapMs > 0 ? 'high' as const : 'medium' as const };
}

function fallbackDetail(index: number, cue: TimestampRefinementCue, confidence: RefinementConfidence = 'low'): TimestampRefinementCueDetail {
  return {
    cue: index + 1,
    providerStartMs: cue.startMs,
    providerEndMs: cue.endMs,
    refinedStartMs: cue.startMs,
    refinedEndMs: cue.endMs,
    timestampRefined: false,
    refinementConfidence: confidence,
  };
}

export function refineCuesWithSpeechRegions<T extends TimestampRefinementCue>(cues: T[], speechRegions: SpeechRegion[], config: TimestampRefinementConfig = DEFAULT_TIMESTAMP_REFINEMENT, scanConfidence: RefinementConfidence = 'high', method: string = 'silero-vad'): TimestampRefinementResult<T> {
  if (!config.enabled) {
    return { cues: [...cues], metadata: { enabled: false, method: 'bypass', refinedCount: 0, fallbackCount: cues.length, analysisMs: 0, details: cues.map((cue, index) => fallbackDetail(index, cue)) } };
  }

  const details: TimestampRefinementCueDetail[] = [];
  let minimumRegionIndex = 0;
  const usedRegions = new Set<SpeechRegion>();
  const refined = cues.map((cue, index) => {
    const selected = scanConfidence !== 'low' ? selectSpeechRegion(speechRegions, cue, config, minimumRegionIndex, usedRegions, cues[index + 1]) : undefined;
    if (!selected || selected.region.endMs <= selected.region.startMs) {
      details.push(fallbackDetail(index, cue, scanConfidence));
      debugRefinement('TIMESTAMP MATCH', { cue: index + 1, provider: [cue.startMs, cue.endMs], refined: false, confidence: scanConfidence });
      return { ...cue };
    }
    usedRegions.add(selected.region);
    minimumRegionIndex = selected.index + 1;
    const next = { ...cue, startMs: selected.region.startMs, endMs: selected.region.endMs };
    details.push({ cue: index + 1, providerStartMs: cue.startMs, providerEndMs: cue.endMs, refinedStartMs: next.startMs, refinedEndMs: next.endMs, timestampRefined: true, refinementConfidence: selected.confidence });
    debugRefinement('TIMESTAMP MATCH', { cue: index + 1, provider: [cue.startMs, cue.endMs], candidate: [selected.region.startMs, selected.region.endMs], score: selected.score, confidence: selected.confidence, refined: true });
    return next;
  });
  const normalized = normalizeCueTimeline(refined);
  const finalDetails = details.map((detail, index) => ({
    ...detail,
    refinedStartMs: normalized[index].startMs,
    refinedEndMs: normalized[index].endMs,
    timestampRefined: detail.timestampRefined && normalized[index].startMs === detail.refinedStartMs && normalized[index].endMs === detail.refinedEndMs,
  }));
  const finalRefinedCount = finalDetails.filter((detail) => detail.timestampRefined).length;
  debugRefinement('REFINEMENT SUMMARY', { method, total: cues.length, refined: finalRefinedCount, fallback: cues.length - finalRefinedCount, analysisMs: 0 });
  return { cues: normalized, metadata: { enabled: true, method, refinedCount: finalRefinedCount, fallbackCount: cues.length - finalRefinedCount, analysisMs: 0, details: finalDetails } };
}

export async function refineSttTimestamps<T extends TimestampRefinementCue>(audioPath: string, cues: T[], config: TimestampRefinementConfig = DEFAULT_TIMESTAMP_REFINEMENT, detector: SpeechRegionDetector = detectSpeechRegions): Promise<TimestampRefinementResult<T>> {
  if (!config.enabled) return refineCuesWithSpeechRegions(cues, [], config, 'low', 'bypass');
  const startedAt = Date.now();
  try {
    const scan = await detector(audioPath, config);
    const result = refineCuesWithSpeechRegions(cues, scan.regions, config, scan.confidence, scan.method);
    return { ...result, metadata: { ...result.metadata, analysisMs: scan.cached ? 0 : Date.now() - startedAt, speechRegions: scan.regions } };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Timestamp refinement thất bại.';
    debugRefinement('TIMESTAMP REFINEMENT', { error: message, fallbackCount: cues.length });
    return {
      cues: cues.map((cue) => ({ ...cue })),
      metadata: {
        enabled: true,
        method: 'fallback',
        refinedCount: 0,
        fallbackCount: cues.length,
        analysisMs: Date.now() - startedAt,
        error: message,
        details: cues.map((cue, index) => fallbackDetail(index, cue)),
      },
    };
  }
}
