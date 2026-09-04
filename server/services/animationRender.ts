import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, workdir } from './ffmpeg';

export async function transcodeAnimationRecording(projectId: string, recording: Buffer, requestedCacheKey?: string) {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Project id không hợp lệ.');
  if (!recording.length) throw new Error('Bản ghi animation đang trống.');
  const directory = path.join(workdir, 'animation-projects', projectId, 'renders');
  const cacheDirectory = path.join(workdir, 'animation-render-cache');
  const hash = requestedCacheKey && /^[a-f0-9]{64}$/i.test(requestedCacheKey) ? requestedCacheKey.toLowerCase() : createHash('sha256').update(recording).digest('hex');
  const cached = path.join(cacheDirectory, `${hash}.mp4`);
  try { return { path: cached, size: (await stat(cached)).size, cached: true }; } catch { /* cache miss */ }
  await mkdir(directory, { recursive: true }); await mkdir(cacheDirectory, { recursive: true });
  const input = path.join(directory, `${randomUUID()}.webm`); await writeFile(input, recording);
  await run('ffmpeg', ['-y', '-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cached]);
  return { path: cached, size: (await stat(cached)).size, cached: false };
}

export interface AnimationRenderJob { id: string; projectId: string; cacheKey?: string; status: 'queued' | 'rendering' | 'completed' | 'failed'; progress: number; createdAt: string; updatedAt: string; cached?: boolean; result?: { path: string; size: number }; error?: string }
const root = path.join(workdir, 'animation-render-jobs'); const jobs = new Map<string, AnimationRenderJob>(); const queue: string[] = []; let running = false;
const jobDirectory = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
const jobFile = (id: string) => path.join(jobDirectory(id), 'job.json'); const recordingFile = (id: string) => path.join(jobDirectory(id), 'recording.webm');
async function saveJob(job: AnimationRenderJob) { jobs.set(job.id, job); await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(jobFile(job.id), JSON.stringify(job, null, 2), 'utf8'); return job; }
async function patchJob(id: string, change: Partial<AnimationRenderJob>) { return saveJob({ ...jobs.get(id)!, ...change, updatedAt: new Date().toISOString() }); }
async function drainQueue() { if (running) return; running = true; try { while (queue.length) { const id = queue.shift()!; const job = jobs.get(id); if (!job) continue; await patchJob(id, { status: 'rendering', progress: 20 }); try { const result = await transcodeAnimationRecording(job.projectId, await readFile(recordingFile(id)), job.cacheKey); await patchJob(id, { status: 'completed', progress: 100, cached: result.cached, result: { path: result.path, size: result.size }, error: undefined }); } catch (error) { await patchJob(id, { status: 'failed', progress: 100, error: error instanceof Error ? error.message : String(error) }); } } } finally { running = false; } }
export async function initializeAnimationRenderJobs() { await mkdir(root, { recursive: true }); for (const entry of await readdir(root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; try { let job = JSON.parse(await readFile(jobFile(entry.name), 'utf8')) as AnimationRenderJob; if (job.status === 'queued' || job.status === 'rendering') { job = await saveJob({ ...job, status: 'queued', progress: 0, error: undefined, updatedAt: new Date().toISOString() }); queue.push(job.id); } else jobs.set(job.id, job); } catch { /* ignore broken job record */ } } void drainQueue(); }
export async function enqueueAnimationRender(projectId: string, recording: Buffer, cacheKey?: string) { if (!/^[a-f0-9-]{36}$/i.test(projectId) || !recording.length) throw new Error('Project hoặc bản ghi render không hợp lệ.'); const now = new Date().toISOString(); const job: AnimationRenderJob = { id: randomUUID(), projectId, cacheKey: cacheKey && /^[a-f0-9]{64}$/i.test(cacheKey) ? cacheKey : undefined, status: 'queued', progress: 0, createdAt: now, updatedAt: now }; await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(recordingFile(job.id), recording); await saveJob(job); queue.push(job.id); void drainQueue(); return job; }
export function getAnimationRenderJob(id: string) { const job = jobs.get(id); if (!job) throw new Error('Không tìm thấy render job.'); return job; }
export function listAnimationRenderJobs() { return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
