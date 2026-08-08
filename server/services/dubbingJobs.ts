import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { chat, ProviderError, synthesize } from '../adapters';
import { run, workdir } from './ffmpeg';

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
  timingMode: TimingMode;
  batchSize: number;
  ttsConcurrency: number;
  llmConcurrency: number;
  maxRetries: number;
  audioMix: { keepOriginal: boolean; originalVolume: number };
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
  result?: { audioFile: string; metadataFile: string; durationMs: number };
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
}

interface CreateJobInput {
  videoId?: string;
  cues?: DubbingCueInput[];
  timingMode?: TimingMode;
  batchSize?: number;
  ttsConcurrency?: number;
  llmConcurrency?: number;
  maxRetries?: number;
  audioMix?: { keepOriginal?: boolean; originalVolume?: number };
  rewrite?: { provider?: AIProvider; model?: string };
}

const jobsRoot = path.join(workdir, 'jobs');
const DEFAULTS = {
  maxCueExtensionPercent: 0.15,
  maxCueExtensionMs: 400,
  safetyGapMs: 80,
  idealSpeedMin: 0.95,
  idealSpeedMax: 1.10,
  acceptableSpeedMax: 1.15,
  hardSpeedMax: 1.20,
  minSpeed: 0.90,
  maxRewriteAttempts: 2,
  batchSize: 30,
  ttsConcurrency: 3,
  llmConcurrency: 2,
  maxRetries: 3,
} as const;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const now = () => new Date().toISOString();
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'item';
const normalizeAudioMix = (value?: { keepOriginal?: boolean; originalVolume?: number }) => ({ keepOriginal: value?.keepOriginal ?? true, originalVolume: clamp(Number(value?.originalVolume ?? 0.25), 0, 1) });
const jobDir = (id: string) => path.join(jobsRoot, safeName(id));
const cueDir = (id: string) => path.join(jobDir(id), 'cues');
const providerDir = (id: string) => path.join(jobDir(id), 'providers');
const cacheDir = (id: string) => path.join(jobDir(id), 'cache', 'tts');
const timelineDir = (id: string) => path.join(jobDir(id), 'timeline');
const resultDir = (id: string) => path.join(jobDir(id), 'result');
const jobFile = (id: string) => path.join(jobDir(id), 'job.json');
const cueFile = (jobId: string, cueId: string) => path.join(cueDir(jobId), `${safeName(cueId)}.json`);
const audioFile = (jobId: string, cueId: string) => path.join(cueDir(jobId), `${safeName(cueId)}.wav`);

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

async function readJson<T>(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function probeDuration(file: string) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
  const seconds = Number(probe.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('FFprobe could not read the generated audio duration.');
  return Math.round(seconds * 1000);
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

export function isUsefulDubbingRewrite(currentText: string, rewrittenText: string) {
  const current = currentText.trim();
  const rewritten = normalizeRewrite(rewrittenText);
  return rewritten.length >= 2 && rewritten.length < current.length;
}

async function rewriteTranslation(cue: StoredCue, provider: AIProvider, model: string, currentText: string, targetDurationMs: number, signal: AbortSignal) {
  const seconds = (targetDurationMs / 1000).toFixed(2);
  const system = 'You are a Vietnamese dubbing dialogue editor. Return exactly one natural Vietnamese sentence, without markdown or explanation.';
  const prompt = `Rewrite the dialogue below to be concise while preserving its meaning and context. It must sound natural when spoken in about ${seconds} seconds.\n\nOriginal: ${cue.input.originalText}\nCurrent translation: ${currentText}\nPrevious: ${cue.input.previousText || '(none)'}\nNext: ${cue.input.nextText || '(none)'}\nTarget duration: ${seconds} seconds.`;
  const result = normalizeRewrite(await chat(provider, model, [{ role: 'system', content: system }, { role: 'user', content: prompt }], signal));
  if (!result || result.length < 2) throw new Error('LLM did not return a valid shorter sentence.');
  return result;
}

function tempoFilter(tempo: number, targetDurationMs?: number) {
  const filters: string[] = [];
  if (Math.abs(tempo - 1) > 0.005) filters.push(`atempo=${tempo.toFixed(3)}`);
  if (targetDurationMs !== undefined) {
    const targetSeconds = (targetDurationMs / 1000).toFixed(3);
    filters.push(`apad=pad_dur=${targetSeconds}`, `atrim=duration=${targetSeconds}`);
  }
  return filters.join(',') || 'anull';
}

export function isTransientDubbingError(error: unknown) {
  if (error instanceof ProviderError) return error.status === 429 || error.status >= 500;
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

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(new Error('Dubbing job cancelled.')); };
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
  extensionMs: timing.extensionMs,
  ...(warning ? { warning } : {}),
});

function providerReference(provider: AIProvider) {
  return safeName(provider.id || provider.name || createHash('sha1').update(provider.baseUrl).digest('hex').slice(0, 10));
}

async function saveCue(jobId: string, cue: StoredCue) {
  cue.updatedAt = now();
  await writeJsonAtomic(cueFile(jobId, cue.id), cue);
}

async function loadCues(jobId: string) {
  const files = await readdir(cueDir(jobId));
  const cues: StoredCue[] = [];
  for (const file of files.filter((item) => item.endsWith('.json'))) cues.push(await readJson<StoredCue>(path.join(cueDir(jobId), file)));
  return cues.sort((left, right) => left.index - right.index);
}

async function loadProvider(jobId: string, ref: string) {
  return readJson<AIProvider>(path.join(providerDir(jobId), `${safeName(ref)}.json`));
}

export async function createDubbingJob(input: CreateJobInput) {
  if (!input.cues?.length) throw new Error('No cues were supplied for the dubbing job.');
  const id = `dub-${Date.now()}-${createHash('sha1').update(`${Math.random()}-${Date.now()}`).digest('hex').slice(0, 8)}`;
  const rewriteProvider = input.rewrite?.provider;
  const rewriteModel = input.rewrite?.model?.trim();
  const rewriteProviderRef = rewriteProvider && rewriteModel ? providerReference(rewriteProvider) : undefined;
  const config: DubbingJobConfig = {
    timingMode: input.timingMode === 'strict' ? 'strict' : 'natural',
    batchSize: clamp(Math.round(input.batchSize || DEFAULTS.batchSize), 1, 100),
    ttsConcurrency: clamp(Math.round(input.ttsConcurrency || DEFAULTS.ttsConcurrency), 1, 16),
    llmConcurrency: clamp(Math.round(input.llmConcurrency || DEFAULTS.llmConcurrency), 1, 8),
    maxRetries: clamp(Math.round(input.maxRetries ?? DEFAULTS.maxRetries), 0, 3),
    audioMix: normalizeAudioMix(input.audioMix),
    ...(rewriteProviderRef && rewriteModel ? { rewriteProviderRef, rewriteModel } : {}),
  };
  const providers = new Map<string, AIProvider>();
  if (rewriteProviderRef && rewriteProvider) providers.set(rewriteProviderRef, rewriteProvider);
  const storedCues: StoredCue[] = [];
  for (const [index, cue] of input.cues.entries()) {
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
  for (const cue of storedCues) await saveCue(id, cue);
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
    progressPercent: job.totalCues ? Math.round((job.doneCues / job.totalCues) * 100) : 0,
    failedCueIds: failed.map((cue) => cue.id),
    failedCueErrors: failed.map((cue) => ({ id: cue.id, index: cue.index, stage: cue.errorStage || 'failed', attempts: cue.attempts, error: cue.error || 'Unknown cue error.' })),
  };
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
    let finalText = cue.input.text.trim();
    let rewriteAttempts = 0;
    let ttsDurationMs = 0;
    let requiredSpeed = 1;
    let rawPath = '';
    let rewriteWarning: string | undefined;

    for (let attempt = 0; attempt <= DEFAULTS.maxRewriteAttempts; attempt += 1) {
      const ttsSpeed = clamp(Number(cue.input.speed) || 1, DEFAULTS.minSpeed, DEFAULTS.hardSpeedMax);
      const cacheKey = createHash('sha256').update(JSON.stringify([provider.id, provider.baseUrl, cue.input.model, cue.input.voice, finalText, ttsSpeed, 'wav'])).digest('hex');
      rawPath = path.join(cacheDir(this.job.id), `${cacheKey}.wav`);
      try {
        await stat(rawPath);
      } catch {
        await this.setCueStatus(cue, 'tts');
        const generated = await this.ttsSemaphore.use(() => retryDubbingOperation(() => synthesize(provider, cue.input.model, cue.input.voice, finalText, { speed: ttsSpeed, format: 'wav', signal: this.controller.signal }), this.job.config.maxRetries, this.controller.signal));
        await writeBufferAtomic(rawPath, generated);
      }
      ttsDurationMs = await probeDuration(rawPath);
      requiredSpeed = ttsDurationMs / timing.targetDurationMs;
      if (requiredSpeed <= DEFAULTS.acceptableSpeedMax || attempt >= DEFAULTS.maxRewriteAttempts) break;
      if (cue.skipRewrite || !rewriteProvider || !this.job.config.rewriteModel) {
        rewriteWarning = cue.skipRewrite
          ? `Cue ${cue.index}: the previous AI rewrite was not shorter; keeping the original text and capping speed at ${DEFAULTS.hardSpeedMax.toFixed(2)}x.`
          : `Cue ${cue.index} is too long, but no Chat/Translation provider is configured for rewriting; speed will be capped at ${DEFAULTS.hardSpeedMax.toFixed(2)}x.`;
        break;
      }
      await this.setCueStatus(cue, 'rewriting');
      let rewritten: string;
      try {
        rewritten = await this.llmSemaphore.use(() => retryDubbingOperation(() => rewriteTranslation(cue, rewriteProvider, this.job.config.rewriteModel as string, finalText, timing.targetDurationMs, this.controller.signal), this.job.config.maxRetries, this.controller.signal));
      } catch (error) {
        if (!isRewriteUnavailableError(error)) throw error;
        rewriteWarning = `Cue ${cue.index} could not use the configured provider for rewriting; speed will be capped at ${DEFAULTS.hardSpeedMax.toFixed(2)}x.`;
        break;
      }
      if (!isUsefulDubbingRewrite(finalText, rewritten)) {
        rewriteWarning = `Cue ${cue.index}: AI rewrite did not produce a shorter sentence; keeping the original text and capping speed at ${DEFAULTS.hardSpeedMax.toFixed(2)}x.`;
        break;
      }
      finalText = rewritten;
      rewriteAttempts += 1;
    }

    const finalTempo = requiredSpeed > DEFAULTS.hardSpeedMax
      ? DEFAULTS.hardSpeedMax
      : requiredSpeed < DEFAULTS.idealSpeedMin
        ? clamp(requiredSpeed, DEFAULTS.minSpeed, DEFAULTS.idealSpeedMin)
        : requiredSpeed > DEFAULTS.idealSpeedMax ? requiredSpeed : 1;
    const needsHardLimit = requiredSpeed > DEFAULTS.hardSpeedMax;
    const warning = rewriteWarning || (needsHardLimit ? `Cue ${cue.index} remains over duration after ${rewriteAttempts} rewrite attempts; speed capped at ${DEFAULTS.hardSpeedMax.toFixed(2)}x.` : (rewriteAttempts > 0 ? `Cue ${cue.index} was rewritten to fit its speaking window.` : undefined));
    await this.setCueStatus(cue, 'fitting');
    const finalPath = audioFile(this.job.id, cue.id);
    const temporary = `${finalPath}.${process.pid}.${Date.now()}.tmp.wav`;
    await run('ffmpeg', ['-y', '-i', rawPath, '-filter:a', tempoFilter(finalTempo, needsHardLimit ? undefined : timing.targetDurationMs), '-ar', '48000', '-ac', '2', temporary], this.controller.signal);
    await rename(temporary, finalPath).catch(async (error) => { await rm(finalPath, { force: true }); await rename(temporary, finalPath).catch(() => { throw error; }); });
    const finalAudioDurationMs = await probeDuration(finalPath);
    const metadata = metadataFor(cue, timing, finalText, ttsDurationMs, finalAudioDurationMs, rewriteAttempts, finalTempo, warning);
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

  private async buildTimeline(cues: StoredCue[]) {
    const completed = cues.filter((cue) => cue.status === 'done' && cue.audioFile && cue.metadata);
    if (completed.length !== this.job.totalCues) throw new Error('Cannot render the final timeline until every required cue is done.');
    await rm(timelineDir(this.job.id), { recursive: true, force: true });
    await mkdir(timelineDir(this.job.id), { recursive: true });
    const segments: string[] = [];
    const batchSize = this.job.config.batchSize;
    for (let offset = 0; offset < completed.length; offset += batchSize) {
      const batch = completed.slice(offset, offset + batchSize);
      const nextStart = completed[offset + batch.length]?.input.startMs;
      const segmentStart = offset === 0 ? 0 : batch[0].input.startMs;
      const segmentEnd = nextStart ?? Math.max(...batch.map((cue) => cue.input.startMs + (cue.metadata?.targetDurationMs || cue.input.endMs - cue.input.startMs)));
      const durationMs = Math.max(segmentEnd - segmentStart, 100);
      const args: string[] = ['-y'];
      const filters: string[] = [];
      batch.forEach((cue, index) => {
        const delay = Math.max(0, Math.round(cue.input.startMs - segmentStart));
        args.push('-i', path.join(jobDir(this.job.id), cue.audioFile as string));
        filters.push(`[${index}:a]volume=${clamp(cue.input.volume ?? 1, 0, 2).toFixed(3)},adelay=${delay}|${delay}[a${index}]`);
      });
      const mixed = batch.map((_cue, index) => `[a${index}]`).join('');
      filters.push(`${mixed}amix=inputs=${batch.length}:duration=longest:dropout_transition=0,apad,atrim=duration=${(durationMs / 1000).toFixed(3)},asetpts=N/SR/TB[out]`);
      const output = path.join(timelineDir(this.job.id), `segment-${String(segments.length).padStart(5, '0')}.wav`);
      await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output], this.controller.signal);
      segments.push(output);
    }
    const listFile = path.join(timelineDir(this.job.id), 'concat.txt');
    await writeFile(listFile, segments.map((file) => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const finalPath = path.join(resultDir(this.job.id), 'dub-track.wav');
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', finalPath], this.controller.signal);
    const durationMs = await probeDuration(finalPath);
    const metadata = completed.map((cue) => cue.metadata);
    await writeJsonAtomic(path.join(resultDir(this.job.id), 'metadata.json'), metadata);
    return { audioFile: path.relative(jobDir(this.job.id), finalPath), metadataFile: path.relative(jobDir(this.job.id), path.join(resultDir(this.job.id), 'metadata.json')), durationMs };
  }

  private async run() {
    try {
      await this.recoverProcessing();
      await this.commit((job) => { job.status = 'running'; });
      while (true) {
        if (this.cancelRequested) throw new Error('Dubbing job cancelled.');
        if (this.pauseRequested) { await this.commit((job) => { job.status = 'paused'; }); return; }
        const cues = await loadCues(this.job.id);
        const pending = cues.filter((cue) => cue.status === 'pending');
        if (!pending.length) {
          if (cues.some((cue) => cue.status === 'failed')) {
            await this.commit((job) => { job.status = 'completed_with_errors'; job.warnings = [`${cues.filter((cue) => cue.status === 'failed').length} cue failed and must be retried.`]; });
            return;
          }
          const result = await this.buildTimeline(cues);
          await this.commit((job) => { job.status = 'completed'; job.result = result; job.warnings = cues.flatMap((cue) => cue.metadata?.warning ? [cue.metadata.warning] : []); });
          return;
        }
        const batch = pending.slice(0, this.job.config.batchSize);
        await this.commit((job) => { job.currentBatch += 1; });
        await Promise.all(batch.map((cue) => this.processCue(cue, cues)));
      }
    } catch (error) {
      if (this.cancelRequested || this.controller.signal.aborted) await this.commit((job) => { job.status = 'cancelled'; });
      else await this.commit((job) => { job.status = 'failed'; job.warnings = [error instanceof Error ? error.message : 'Dubbing job failed.']; });
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
export async function retryFailedDubbingJob(id: string) {
  const cues = await loadCues(id);
  for (const cue of cues) if (cue.status === 'failed') {
    const skipRewrite = cue.skipRewrite || /LLM did not make the sentence shorter/i.test(cue.error || '');
    await saveCue(id, { ...cue, status: 'pending', error: undefined, errorStage: undefined, skipRewrite, attempts: cue.attempts + 1 });
  }
  const job = await readDubbingJob(id);
  job.status = 'queued'; job.failedCues = 0; job.warnings = [];
  await writeJsonAtomic(jobFile(id), job);
  return startDubbingJob(id);
}

export async function getDubbingResult(id: string) {
  const job = await readDubbingJob(id);
  if (job.status !== 'completed' || !job.result) throw new Error('Dubbing job is not completed yet.');
  const metadata = await readJson<DubbingMetadata[]>(path.join(jobDir(id), job.result.metadataFile));
  return { job, metadata, audioFile: path.join(jobDir(id), job.result.audioFile) };
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

export async function openDubbingAudio(id: string) {
  const result = await getDubbingResult(id);
  const file = await stat(result.audioFile);
  return { stream: createReadStream(result.audioFile), size: file.size };
}

export async function legacyTrackJob(input: CreateJobInput) {
  const job = await createDubbingJob(input);
  await startDubbingJob(job.id);
  return getDubbingJobStatus(job.id);
}
