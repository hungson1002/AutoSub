import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { AnimationProject } from '../../shared/animationStudio';
import { assertAnimationProject } from '../../shared/animationStudio';
import { renderDurationInFrames } from '../../src/remotion/timeline';
import { run, workdir } from './ffmpeg';

export async function validateAnimationOutput(file: string, expected?: { width: number; height: number; fps: number; durationInFrames: number }) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const metadata = JSON.parse(probe.stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
  const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(video?.duration || metadata.format?.duration);
  if (!video || !video.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error('Bản xuất không có luồng video hợp lệ.');
  if (expected && (video.width !== expected.width || video.height !== expected.height || Math.abs(duration - expected.durationInFrames / expected.fps) > 2 / expected.fps)) {
    throw new Error('Kích thước hoặc thời lượng bản xuất không khớp timeline. Giữ project để xuất lại.');
  }
  return { width: video.width, height: video.height, durationSeconds: duration };
}

export async function transcodeAnimationRecording(projectId: string, recording: Buffer, requestedCacheKey?: string) {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Project id không hợp lệ.');
  if (!recording.length) throw new Error('Bản ghi animation đang trống.');
  const directory = path.join(workdir, 'animation-projects', projectId, 'renders');
  const cacheDirectory = path.join(workdir, 'animation-render-cache');
  const hash = createHash('sha256').update('browser-recording-v2').update(requestedCacheKey || '').update(recording).digest('hex');
  const cached = path.join(cacheDirectory, `${hash}.mp4`);
  try { await validateAnimationOutput(cached); return { path: cached, size: (await stat(cached)).size, cached: true }; } catch { /* missing or invalid cache */ }
  await mkdir(directory, { recursive: true }); await mkdir(cacheDirectory, { recursive: true });
  const input = path.join(directory, `${randomUUID()}.webm`); await writeFile(input, recording);
  const temporary = path.join(cacheDirectory, `${hash}.${randomUUID()}.partial.mp4`);
  try {
    await run('ffmpeg', ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary]);
    await validateAnimationOutput(temporary);
    await rename(temporary, cached);
  } finally {
    await rm(temporary, { force: true });
    await rm(input, { force: true });
  }
  return { path: cached, size: (await stat(cached)).size, cached: false };
}

let remotionBundle: Promise<string> | undefined;

function resolveBrowserExecutable() {
  const candidates = [
    process.env.AUTOSUB_CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

async function getRemotionBundle() {
  if (!remotionBundle) {
    const entryPoint = fileURLToPath(new URL('../../src/remotion/index.tsx', import.meta.url));
    remotionBundle = bundle(entryPoint, undefined, { rootDir: path.resolve(path.dirname(entryPoint), '../..'), publicDir: null })
      .catch((error) => { remotionBundle = undefined; throw error; });
  }
  return remotionBundle;
}

export async function renderAnimationProject(project: AnimationProject, showSubtitles: boolean, requestedCacheKey?: string, onProgress?: (progress: number) => void) {
  assertAnimationProject(project);
  if (!project.scenes.length) throw new Error('Project chưa có cảnh để xuất.');
  const missingVideo = project.scenes.find((scene) => scene.renderMode === 'generated-video' && !scene.source?.uri);
  if (missingVideo) throw new Error(`Cảnh “${missingVideo.name}” chưa có video nguồn. Không thể xuất bản đầy đủ.`);
  const normalized = { ...project, assetManifest: undefined, createdAt: '', updatedAt: '', assets: project.assets.map((asset) => ({ ...asset, createdAt: '' })) };
  // A client key must never override the actual project/subtitle/engine fingerprint.
  const hash = createHash('sha256').update(JSON.stringify({ project: normalized, showSubtitles, engine: 'remotion-v3-mixed-scenes', requestedCacheKey })).digest('hex');
  const cacheDirectory = path.join(workdir, 'animation-render-cache');
  const cached = path.join(cacheDirectory, `${hash}.mp4`);
  try {
    await validateAnimationOutput(cached, { width: project.width, height: project.height, fps: project.fps, durationInFrames: renderDurationInFrames(project) });
    return { path: cached, size: (await stat(cached)).size, cached: true };
  } catch { /* missing or invalid cache */ }
  await mkdir(cacheDirectory, { recursive: true });
  const serveUrl = await getRemotionBundle();
  const executable = resolveBrowserExecutable();
  const inputProps = { project, showSubtitles, assetOrigin: `http://127.0.0.1:${Number(process.env.AUTOSUB_PORT || 8787)}` };
  const browserOptions = executable ? { browserExecutable: executable } : {};
  const composition = await selectComposition({ serveUrl, id: 'AutoSubAnimation', inputProps, logLevel: 'warn', timeoutInMilliseconds: 120_000, ...browserOptions });
  const temporary = path.join(cacheDirectory, `${hash}.${randomUUID()}.partial.mp4`);
  try {
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    crf: 21,
    x264Preset: 'veryfast',
    audioBitrate: '192k',
    outputLocation: temporary,
    overwrite: true,
    concurrency: 2,
    logLevel: 'warn',
    timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => onProgress?.(Math.max(0, Math.min(1, progress))),
    ...browserOptions,
  });
  await validateAnimationOutput(temporary, { width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames });
  await rename(temporary, cached);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: cached, size: (await stat(cached)).size, cached: false };
}

export interface AnimationRenderJob { id: string; projectId: string; engine?: 'browser-recording' | 'remotion'; showSubtitles?: boolean; cacheKey?: string; status: 'queued' | 'rendering' | 'completed' | 'failed'; progress: number; createdAt: string; updatedAt: string; cached?: boolean; result?: { path: string; size: number }; error?: string }
const root = path.join(workdir, 'animation-render-jobs'); const jobs = new Map<string, AnimationRenderJob>(); const queue: string[] = []; let running = false;
const jobDirectory = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
const jobFile = (id: string) => path.join(jobDirectory(id), 'job.json'); const recordingFile = (id: string) => path.join(jobDirectory(id), 'recording.webm'); const projectFile = (id: string) => path.join(jobDirectory(id), 'project.json');
let jobWrites: Promise<unknown> = Promise.resolve();
async function saveJob(job: AnimationRenderJob) {
  const terminal = job.status === 'completed' || job.status === 'failed';
  if (!terminal) jobs.set(job.id, job);
  const write = jobWrites.catch(() => undefined).then(async () => {
    await mkdir(jobDirectory(job.id), { recursive: true });
    const temporary = `${jobFile(job.id)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(job, null, 2), 'utf8');
      await rename(temporary, jobFile(job.id));
    } finally { await rm(temporary, { force: true }); }
  });
  jobWrites = write;
  await write;
  if (terminal) jobs.set(job.id, job);
  return job;
}
async function patchJob(id: string, change: Partial<AnimationRenderJob>) { return saveJob({ ...jobs.get(id)!, ...change, updatedAt: new Date().toISOString() }); }
async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      try {
        await patchJob(id, { status: 'rendering', progress: 5 });
        // Progress is transient: persist stage boundaries, not every rendered frame.
        const reportProgress = (progress: number) => {
          const current = jobs.get(id);
          if (current?.status === 'rendering') jobs.set(id, { ...current, progress: Math.max(current.progress, 8, Math.round(progress * 90)), updatedAt: new Date().toISOString() });
        };
        const result = job.engine === 'remotion'
          ? await renderAnimationProject(JSON.parse(await readFile(projectFile(id), 'utf8')) as AnimationProject, job.showSubtitles !== false, job.cacheKey, reportProgress)
          : await transcodeAnimationRecording(job.projectId, await readFile(recordingFile(id)), job.cacheKey);
        await patchJob(id, { status: 'completed', progress: 100, cached: result.cached, result: { path: result.path, size: result.size }, error: undefined });
      } catch (error) {
        const failed: AnimationRenderJob = { ...jobs.get(id)!, status: 'failed', progress: 100, error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() };
        // A disk failure must not become an unhandled rejection or abandon later jobs.
        try { await saveJob(failed); } catch (writeError) { jobs.set(id, failed); console.error('Cannot persist animation render failure', id, writeError); }
      }
    }
  } finally { running = false; }
}
export async function initializeAnimationRenderJobs() { await mkdir(root, { recursive: true }); for (const entry of await readdir(root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; try { let job = JSON.parse(await readFile(jobFile(entry.name), 'utf8')) as AnimationRenderJob; if (job.status === 'queued' || job.status === 'rendering') { job = await saveJob({ ...job, status: 'queued', progress: 0, error: undefined, updatedAt: new Date().toISOString() }); queue.push(job.id); } else jobs.set(job.id, job); } catch { /* ignore broken job record */ } } void drainQueue(); }
export async function enqueueAnimationRender(projectId: string, recording: Buffer, cacheKey?: string) { if (!/^[a-f0-9-]{36}$/i.test(projectId) || !recording.length) throw new Error('Project hoặc bản ghi render không hợp lệ.'); const now = new Date().toISOString(); const job: AnimationRenderJob = { id: randomUUID(), projectId, cacheKey: cacheKey && /^[a-f0-9]{64}$/i.test(cacheKey) ? cacheKey : undefined, status: 'queued', progress: 0, createdAt: now, updatedAt: now }; await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(recordingFile(job.id), recording); await saveJob(job); queue.push(job.id); void drainQueue(); return job; }
export async function enqueueAnimationProjectRender(projectId: string, project: AnimationProject, showSubtitles = true, cacheKey?: string) { if (!/^[a-f0-9-]{36}$/i.test(projectId) || project.id !== projectId) throw new Error('Project render không hợp lệ.'); assertAnimationProject(project); const now = new Date().toISOString(); const job: AnimationRenderJob = { id: randomUUID(), projectId, engine: 'remotion', showSubtitles, cacheKey: cacheKey && /^[a-f0-9]{64}$/i.test(cacheKey) ? cacheKey : undefined, status: 'queued', progress: 0, createdAt: now, updatedAt: now }; await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(projectFile(job.id), JSON.stringify(project), 'utf8'); await saveJob(job); queue.push(job.id); void drainQueue(); return job; }
export function getAnimationRenderJob(id: string) { const job = jobs.get(id); if (!job) throw new Error('Không tìm thấy render job.'); return job; }
export function listAnimationRenderJobs() { return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
