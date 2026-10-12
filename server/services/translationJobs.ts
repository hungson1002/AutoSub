import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider, TranslationItem, TranslationMemoryItem } from '../types';
import { translateBatch, TranslationValidationError } from '../adapters';
import { workdir } from './ffmpeg';

export type TranslationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TranslationJobInput {
  provider: AIProvider;
  model: string;
  items: TranslationItem[];
  sourceLanguage: string;
  targetLanguage: string;
  style: string;
  customPrompt: string;
  glossary: Array<{ source: string; target: string }>;
  translationMemory: TranslationMemoryItem[];
  translationGuide: string;
}

export interface TranslationJob {
  id: string;
  status: TranslationJobStatus;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  stage: string;
  input: TranslationJobInput;
  result?: {
    items: Array<{ id: string; translation: string }>;
    pendingCueIds: string[];
    warning?: string;
  };
  error?: string;
}

const jobsRoot = path.join(workdir, 'translation-jobs');
const jobFile = (id: string) => path.join(jobsRoot, id, 'job.json');
const now = () => new Date().toISOString();

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, file);
}

async function readJob(id: string) {
  return JSON.parse(await readFile(jobFile(id), 'utf8')) as TranslationJob;
}

const runners = new Map<string, { controller: AbortController; promise: Promise<void> }>();

async function persist(job: TranslationJob, patch: Partial<TranslationJob>) {
  Object.assign(job, patch, { updatedAt: now() });
  await writeJsonAtomic(jobFile(job.id), job);
}

async function runTranslationJob(id: string, controller: AbortController) {
  const job = await readJob(id);
  if (job.status === 'cancelled' || job.status === 'completed') return;
  await persist(job, { status: 'running', stage: 'Đang dịch batch', error: undefined, attempt: (job.attempt || 0) + 1 });
  const result = new Map<string, { id: string; translation: string }>();
  let pending = [...job.input.items];
  let lastValidationMessage = '';
  try {
    for (let attempt = 0; attempt < 3 && pending.length; attempt += 1) {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      try {
        const translated = await translateBatch(
          job.input.provider,
          job.input.model,
          pending,
          job.input.sourceLanguage,
          job.input.targetLanguage,
          job.input.style,
          job.input.customPrompt,
          job.input.glossary,
          job.input.translationMemory,
          job.input.translationGuide,
        );
        translated.forEach((item) => result.set(item.id, item));
        pending = pending.filter((item) => !result.has(item.id));
      } catch (error) {
        if (error instanceof TranslationValidationError) {
          lastValidationMessage = error.message;
          error.partialItems.forEach((item) => result.set(item.id, item));
          pending = pending.filter((item) => !result.has(item.id));
        } else if (attempt === 2) {
          throw error;
        }
      }
    }
    const items = job.input.items.map((item) => result.get(item.id)!).filter(Boolean);
    const warning = pending.length
      ? `${lastValidationMessage || 'Translation chưa hoàn tất.'} Còn ${pending.length} cue chưa dịch sau 3 lần retry.`
      : undefined;
    await persist(job, {
      status: 'completed',
      stage: pending.length ? 'Đã hoàn tất batch với một số cue cần thử lại' : 'Đã hoàn tất batch dịch',
      result: { items, pendingCueIds: pending.map((item) => item.id), ...(warning ? { warning } : {}) },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const current = await readJob(id).catch(() => job);
      if (current.status !== 'cancelled') await persist(current, { status: 'queued', stage: 'Đang chờ backend tiếp tục job' });
      return;
    }
    await persist(job, {
      status: 'failed',
      stage: 'Dịch batch thất bại',
      error: error instanceof Error ? error.message : 'Translation request thất bại.',
    });
  }
}

export async function createTranslationJob(input: TranslationJobInput, requestedId?: string) {
  await mkdir(jobsRoot, { recursive: true });
  const requested = requestedId?.trim() || '';
  const id = /^translation-[A-Za-z0-9-]{8,120}$/.test(requested) ? requested : `translation-${randomUUID()}`;
  const existing = await readJob(id).catch(() => undefined);
  if (existing) {
    if (existing.status === 'queued' || existing.status === 'running') startTranslationJob(existing.id);
    return existing;
  }
  const createdAt = now();
  const job: TranslationJob = {
    id,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    attempt: 0,
    stage: 'Đã xếp hàng dịch',
    input,
  };
  await writeJsonAtomic(jobFile(id), job);
  startTranslationJob(id);
  return job;
}

export function startTranslationJob(id: string) {
  if (runners.has(id)) return;
  const controller = new AbortController();
  const promise = runTranslationJob(id, controller).finally(() => runners.delete(id));
  runners.set(id, { controller, promise });
}

export async function getTranslationJob(id: string) {
  return readJob(id);
}

export async function cancelTranslationJob(id: string) {
  const runner = runners.get(id);
  runner?.controller.abort();
  const job = await readJob(id);
  await persist(job, { status: 'cancelled', stage: 'Đã hủy dịch theo yêu cầu người dùng' });
  return readJob(id);
}

export async function initializeTranslationJobs() {
  await mkdir(jobsRoot, { recursive: true });
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await readJob(entry.name).catch(() => undefined);
    if (!job || job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') continue;
    if (job.status === 'running') {
      job.status = 'queued';
      job.stage = 'Backend đã khởi động lại, đang tiếp tục batch';
      job.updatedAt = now();
      await writeJsonAtomic(jobFile(job.id), job);
    }
    startTranslationJob(job.id);
  }
}

export async function cleanupTranslationJob(id: string) {
  const runner = runners.get(id);
  runner?.controller.abort();
  runners.delete(id);
  await rm(path.join(jobsRoot, id), { recursive: true, force: true });
}
