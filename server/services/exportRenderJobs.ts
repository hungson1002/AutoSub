import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, workdir } from './ffmpeg';

export type PersistentExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface PersistentExportJob {
  id: string;
  status: PersistentExportStatus;
  percent: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  args: string[];
  stagedOutput: string;
  output: string;
  expectedDurationSeconds: number;
  cleanupDir?: string;
  error?: string;
}

const jobsRoot = path.join(workdir, 'export-jobs');
const jobDir = (id: string) => path.join(jobsRoot, id);
const jobFile = (id: string) => path.join(jobDir(id), 'job.json');
const now = () => new Date().toISOString();

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temporary, file);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows readers/scanners can briefly prevent replacement of job.json.
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(code || '') || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

async function readJob(id: string) {
  return JSON.parse(await readFile(jobFile(id), 'utf8')) as PersistentExportJob;
}

const runners = new Map<string, { controller: AbortController; promise: Promise<PersistentExportJob> }>();
let exportQueue: Promise<void> = Promise.resolve();

async function persist(job: PersistentExportJob, patch: Partial<PersistentExportJob>) {
  Object.assign(job, patch, { updatedAt: now() });
  await writeJsonAtomic(jobFile(job.id), job);
}

async function validateRenderedOutput(job: PersistentExportJob, signal: AbortSignal) {
  const probe = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:stream=codec_type',
    '-of', 'json',
    job.stagedOutput,
  ], signal);
  let info: {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  try {
    info = JSON.parse(probe.stdout) as typeof info;
  } catch {
    throw new Error('FFmpeg tạo file MP4 chưa hoàn chỉnh; không thể xác minh trước khi tải.');
  }
  const hasVideo = info.streams?.some((stream) => stream.codec_type === 'video');
  const validMp4 = info.format?.format_name?.split(',').includes('mp4');
  const renderedDuration = Number(info.format?.duration);
  if (!hasVideo || !validMp4 || !Number.isFinite(renderedDuration) || renderedDuration <= 0) {
    throw new Error('FFmpeg tạo file MP4 chưa hoàn chỉnh; AutoSub đã chặn tải file lỗi.');
  }
  const minimumCompleteDuration = Math.max(
    0,
    job.expectedDurationSeconds - Math.max(3, job.expectedDurationSeconds * 0.001),
  );
  if (renderedDuration < minimumCompleteDuration) {
    throw new Error(
      `FFmpeg chỉ render được ${renderedDuration.toFixed(1)}s / ${job.expectedDurationSeconds.toFixed(1)}s; AutoSub đã chặn tải video bị cắt ngắn.`,
    );
  }
}

async function execute(job: PersistentExportJob, controller: AbortController) {
  if (job.status === 'cancelled' || job.status === 'completed') return job;
  await mkdir(path.dirname(job.output), { recursive: true });
  await persist(job, {
    status: 'running',
    percent: Math.max(45, job.percent || 45),
    stage: 'FFmpeg đang render video và âm thanh',
    error: undefined,
  });

  let progressBuffer = '';
  let renderSpeed = '';
  let renderStalled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      renderStalled = true;
      controller.abort();
    }, 180_000);
  };

  try {
    armStallTimer();
    await run('ffmpeg', job.args, controller.signal, (chunk) => {
      armStallTimer();
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        const speedMatch = /^speed=([^\s]+)/.exec(trimmed);
        if (speedMatch) renderSpeed = speedMatch[1];
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(trimmed);
        if (!match) continue;
        const renderedMs = Number(match[1]) / 1000;
        const percent = Math.round(Math.min(96, Math.max(45, 45 + (renderedMs / Math.max(1, job.expectedDurationSeconds * 1000)) * 51)));
        const stage = renderSpeed ? `FFmpeg đang render video và âm thanh · ${renderSpeed}` : 'FFmpeg đang render video và âm thanh';
        job.percent = percent;
        job.stage = stage;
        job.updatedAt = now();
        void writeJsonAtomic(jobFile(job.id), job).catch(() => undefined);
      }
    });
    if (stallTimer) clearTimeout(stallTimer);
    await persist(job, { percent: 97, stage: 'Đã mã hóa xong, đang kiểm tra file MP4', status: 'running' });
    await validateRenderedOutput(job, controller.signal);
    await persist(job, { percent: 99, stage: 'File hợp lệ, đang hoàn tất', status: 'running' });
    await rename(job.stagedOutput, job.output);
    await stat(job.output);
    await persist(job, { percent: 100, stage: 'Đã render xong video', status: 'completed' });
    return job;
  } catch (error) {
    if (stallTimer) clearTimeout(stallTimer);
    const current = await readJob(job.id).catch(() => job);
    if (current.status === 'cancelled') return current;
    if (renderStalled) {
      await persist(current, {
        status: 'failed',
        stage: 'Render bị treo',
        error: 'FFmpeg không tạo thêm dữ liệu trong 3 phút nên AutoSub đã dừng job bị treo.',
      });
      return current;
    }
    if (controller.signal.aborted) {
      // Process shutdown/restart is recoverable. Explicit user cancellation sets
      // status=cancelled before aborting, so every other abort returns to queue.
      await persist(current, { status: 'queued', stage: 'Backend gián đoạn, đang chờ tự tiếp tục' });
      return current;
    }
    await persist(current, {
      status: 'failed',
      stage: 'Render thất bại',
      error: error instanceof Error ? error.message : 'FFmpeg không thể render video.',
    });
    return current;
  }
}

export async function createPersistentExportJob(input: {
  id: string;
  args: string[];
  stagedOutput: string;
  output: string;
  expectedDurationSeconds: number;
  cleanupDir?: string;
  stage?: string;
}) {
  await mkdir(jobsRoot, { recursive: true });
  const existing = await readJob(input.id).catch(() => undefined);
  if (existing) return existing;
  const createdAt = now();
  const job: PersistentExportJob = {
    id: input.id,
    status: 'queued',
    percent: 45,
    stage: 'Đã xếp hàng render',
    createdAt,
    updatedAt: createdAt,
    args: input.args,
    stagedOutput: input.stagedOutput,
    output: input.output,
    expectedDurationSeconds: input.expectedDurationSeconds,
    cleanupDir: input.cleanupDir,
  };
  await writeJsonAtomic(jobFile(job.id), job);
  return job;
}

export async function startPersistentExportJob(id: string) {
  const existing = runners.get(id);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const promise = exportQueue.then(() => readJob(id))
    .then((job) => execute(job, controller))
    .finally(() => runners.delete(id));
  runners.set(id, { controller, promise });
  exportQueue = promise.then(() => undefined, () => undefined);
  return promise;
}

export async function getPersistentExportJob(id: string) {
  return readJob(id);
}

export async function listPersistentExportJobs() {
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
  const jobs = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => readJob(entry.name).catch(() => undefined)));
  return jobs.flatMap(job => job ? [{
    id: job.id, kind: 'video-export' as const,
    name: path.basename(job.args.includes('-i') ? job.args[job.args.indexOf('-i') + 1] || job.output : job.output),
    status: job.status, progress: job.percent, stage: job.stage,
    createdAt: job.createdAt, updatedAt: job.updatedAt, error: job.error,
  }] : []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function cancelPersistentExportJob(id: string) {
  const job = await readJob(id);
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
  await persist(job, { status: 'cancelled', stage: 'Đã hủy render theo yêu cầu người dùng' });
  runners.get(id)?.controller.abort();
  return readJob(id);
}

export async function initializePersistentExportJobs() {
  await mkdir(jobsRoot, { recursive: true });
  const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
  const pending: PersistentExportJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const job = await readJob(entry.name).catch(() => undefined);
    if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') continue;
    if (job.status === 'running') {
      job.status = 'queued';
      job.stage = 'Backend đã khởi động lại, đang tự tiếp tục render';
      job.updatedAt = now();
      await writeJsonAtomic(jobFile(job.id), job);
    }
    pending.push(job);
  }
  pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const job of pending) void startPersistentExportJob(job.id).catch(() => undefined);
}

export async function openPersistentExportResult(id: string, range?: { start: number; end: number }) {
  const job = await readJob(id);
  if (job.status !== 'completed') throw new Error('Export job chưa hoàn tất.');
  const file = await stat(job.output);
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  return {
    job,
    stream: createReadStream(job.output, { start, end }),
    size: end - start + 1,
    totalSize: file.size,
    start,
    end,
  };
}
