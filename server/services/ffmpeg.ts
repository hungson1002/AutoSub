import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const workdir = path.resolve(process.env.AUTOSUB_WORKDIR?.trim() || path.join(process.cwd(), 'workdir'));
export const temporaryRoot = path.resolve(process.env.AUTOSUB_TEMP_DIR?.trim() || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AutoSub', 'temp'));
export async function ensureWorkdir() {
  await Promise.all([
    ...['uploads', 'audio', 'audio-mastering', 'frames', 'subtitles', 'tts', 'exports'].map((name) => mkdir(path.join(workdir, name), { recursive: true })),
    mkdir(path.join(temporaryRoot, 'sessions'), { recursive: true }),
  ]);
}
const mediaExecutableCache = new Map<string, string>();
export type H264Encoder = 'libx264' | 'h264_amf';
let h264EncoderPromise: Promise<H264Encoder> | undefined;

async function resolveMediaCommand(command: string) {
  if (process.platform !== 'win32' || (command !== 'ffmpeg' && command !== 'ffprobe')) return command;
  const cached = mediaExecutableCache.get(command);
  if (cached) return cached;
  const explicit = command === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  const candidates = explicit ? [explicit] : [];
  // Winget installs FFmpeg under LocalAppData, but an already-open terminal
  // can retain an old PATH until Windows is restarted. Discover that install
  // directly so `npm run dev` does not randomly lose FFmpeg/FFprobe.
  const wingetRoot = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe');
  const packageDirectories = await readdir(wingetRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of packageDirectories) {
    if (!entry.isDirectory()) continue;
    candidates.push(path.join(wingetRoot, entry.name, 'bin', `${command}.exe`));
  }
  for (const candidate of candidates) {
    try { await stat(candidate); mediaExecutableCache.set(command, candidate); return candidate; } catch { /* try next location */ }
  }
  return command;
}

export async function run(command: string, args: string[], signal?: AbortSignal, onStderr?: (chunk: string) => void) {
  const executable = await resolveMediaCommand(command);
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && (command === 'ffmpeg' || command === 'ffprobe')) {
        reject(new Error(`Không tìm thấy ${command === 'ffprobe' ? 'FFprobe' : 'FFmpeg'}. Hãy cài FFmpeg hoặc đặt ${command === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH'} tới file .exe.`));
        return;
      }
      reject(error);
    };
    const abort = () => { child.kill(); fail(new Error(`${command} cancelled`)); };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      // FFmpeg progress can be effectively unbounded. Keep only the tail for
      // diagnostics so a runaway process cannot also exhaust Node memory or
      // persist a multi-megabyte error message in a job record.
      stderr = (stderr + text).slice(-128 * 1024);
      onStderr?.(text);
    });
    child.on('error', (error) => fail(error));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}
export async function available(command: string) { try { await run(command, ['-version']); return true; } catch { return false; } }

export async function preferredH264Encoder(): Promise<H264Encoder> {
  const configured = process.env.AUTOSUB_VIDEO_ENCODER?.trim().toLowerCase();
  if (configured === 'libx264') return 'libx264';
  if (h264EncoderPromise) return h264EncoderPromise;
  h264EncoderPromise = (async () => {
    if (process.platform !== 'win32' && configured !== 'h264_amf') return 'libx264';
    const benchmark = async (encoderArgs: string[]) => {
      const startedAt = performance.now();
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30', '-t', '2',
        ...encoderArgs, '-pix_fmt', 'yuv420p', '-f', 'null', '-',
      ]);
      return performance.now() - startedAt;
    };
    try {
      const hardwareArgs = ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'qvbr', '-qvbr_quality_level', '20', '-vbaq', 'true', '-preanalysis', 'true'];
      const hardwareMs = await benchmark(hardwareArgs);
      if (configured === 'h264_amf') return 'h264_amf';
      const softwareMs = await benchmark(['-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast']);
      return hardwareMs < softwareMs * 0.9 ? 'h264_amf' : 'libx264';
    } catch {
      return 'libx264';
    }
  })();
  return h264EncoderPromise;
}
export async function cleanWorkdir() { await rm(workdir, { recursive: true, force: true }); await ensureWorkdir(); }

export interface TemporaryCleanupResult { removedFiles: number; removedDirectories: number; freedBytes: number; skippedActiveJobs: number; skippedRecentFiles: number }

const terminalJobStatuses = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

export async function cleanupTemporaryFiles(root = workdir, minimumAgeMs = 10 * 60_000): Promise<TemporaryCleanupResult> {
  const result: TemporaryCleanupResult = { removedFiles: 0, removedDirectories: 0, freedBytes: 0, skippedActiveJobs: 0, skippedRecentFiles: 0 };
  const safeMinimumAgeMs = Math.max(0, minimumAgeMs);
  const cutoff = Date.now() - safeMinimumAgeMs;

  const removePath = async (target: string) => {
    const info = await stat(target).catch(() => undefined);
    if (!info) return;
    if (info.isDirectory()) {
      const files = await readdir(target, { withFileTypes: true }).catch(() => []);
      for (const item of files) await removePath(path.join(target, item.name));
      await rm(target, { recursive: true, force: true }).then(() => { result.removedDirectories += 1; }).catch(() => undefined);
      return;
    }
    await rm(target, { force: true }).then(() => { result.removedFiles += 1; result.freedBytes += info.size; }).catch(() => undefined);
  };

  const removeStaleContents = async (directory: string) => {
    const items = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const target = path.join(directory, item.name);
      const info = await stat(target).catch(() => undefined);
      if (!info) continue;
      if (safeMinimumAgeMs > 0 && info.mtimeMs > cutoff) { result.skippedRecentFiles += 1; continue; }
      await removePath(target);
    }
  };

  // These folders contain regenerable extraction/export caches. Recent paths
  // are retained so clicking cleanup cannot disrupt a request still running.
  for (const name of ['audio', 'audio-mastering', 'frames', 'subtitles', 'tts', 'exports', 'timestamp-vad-cache', 'text-audio-alignment-cache', 'diagnostics', 'demucs-smoke', 'export-smoke', 'upload-flow-smoke', 'video-compare', path.join('vieneu', 'tmp'), path.join('vieneu', 'reference-uploads')]) {
    await removeStaleContents(path.join(root, name));
  }

  // Keep every uploaded source and every final dub result. For terminal jobs,
  // only remove data that can be regenerated without affecting preview.
  const jobsDirectory = path.join(root, 'jobs');
  const jobs = await readdir(jobsDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of jobs) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(jobsDirectory, entry.name);
    const stored = await readFile(path.join(directory, 'job.json'), 'utf8').then((value) => JSON.parse(value) as { status?: string }).catch(() => undefined);
    if (!stored || !terminalJobStatuses.has(String(stored.status))) { result.skippedActiveJobs += 1; continue; }
    for (const disposable of ['cache', 'timeline', 'source-stems']) await removePath(path.join(directory, disposable));
    const leftovers = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const leftover of leftovers) {
      if (!leftover.isFile() || !/\.tmp(?:\.|$)/i.test(leftover.name)) continue;
      await removePath(path.join(directory, leftover.name));
    }
  }

  // Review jobs keep the final MP4, subtitles and editorial metadata, but the
  // extracted speech chunks and intermediate clips can be rebuilt and often
  // consume considerably more disk space than the deliverable.
  const reviewJobsDirectory = path.join(root, 'review-jobs');
  const reviewJobs = await readdir(reviewJobsDirectory, { withFileTypes: true }).catch(() => []);
  for (const entry of reviewJobs) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(reviewJobsDirectory, entry.name);
    const stored = await readFile(path.join(directory, 'job.json'), 'utf8').then((value) => JSON.parse(value) as { status?: string }).catch(() => undefined);
    if (!stored || !terminalJobStatuses.has(String(stored.status))) { result.skippedActiveJobs += 1; continue; }
    for (const disposable of ['clips', 'narration', 'transcription', 'visual-analysis']) await removePath(path.join(directory, disposable));
  }

  await ensureWorkdir();
  return result;
}
export async function probeDimensions(filePath: string) { const result = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', filePath]); const [width, height] = result.stdout.trim().split('x').map(Number); return { width: width || 1920, height: height || 1080 }; }
export async function extractAudio(input: string, output: string, signal?: AbortSignal) { await run('ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], signal); }
export async function extractRoiFrames(input: string, outputPattern: string, fps: number, roi: { x: number; y: number; w: number; h: number }) { const filter = `fps=${fps},crop=iw*${roi.w / 100}:ih*${roi.h / 100}:iw*${roi.x / 100}:ih*${roi.y / 100}`; await run('ffmpeg', ['-y', '-i', input, '-vf', filter, '-q:v', '4', outputPattern]); }
