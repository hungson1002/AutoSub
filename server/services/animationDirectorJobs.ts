import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AnimationProject } from '../../shared/animationStudio';
import { directAnimationProject, type DirectAnimationInput } from './animationDirector';
import { animationCheckpointKey } from './animationCheckpoint';
import { workdir } from './ffmpeg';

export interface AnimationDirectorJob {
  id: string; projectId: string; fingerprint: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  stage: string; createdAt: string; updatedAt: string; error?: string; hasResult?: boolean;
}
type Runner = (input: DirectAnimationInput, onStage: (stage: string) => Promise<void>) => Promise<AnimationProject>;
const activeStates = new Set(['queued', 'running']);
const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id);
function fingerprint(input: DirectAnimationInput) {
  const provider = (value: DirectAnimationInput['provider'] | undefined) => value && { id: value.id, baseUrl: value.baseUrl, providerType: value.providerType };
  return animationCheckpointKey({ project: input.project, brief: input.brief, model: input.model, provider: provider(input.provider), duration: input.targetDurationSeconds, image: input.assetGeneration && { ...input.assetGeneration, provider: provider(input.assetGeneration.provider) }, narration: input.narration && { ...input.narration, provider: provider(input.narration.provider) } });
}

// Credentials remain only in the running closure. A restart never schedules
// unknown external operations again; the user resubmits current credentials.
export class AnimationDirectorJobStore {
  private jobs = new Map<string, AnimationDirectorJob>();
  private cancelled = new Set<string>();
  private tasks = new Map<string, Promise<void>>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private runner: Runner = directAnimationProject) {}
  private file(id: string, name: string) {
    if (!validId(id)) throw new Error('Invalid animation job id.');
    return path.join(this.directory, id, name);
  }
  private async atomic(file: string, value: unknown) {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(value), 'utf8'); await rename(temporary, file); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  private patch(id: string, changes: Partial<AnimationDirectorJob>) {
    const next = this.writes.then(async () => {
      const job = { ...this.jobs.get(id)!, ...changes, updatedAt: new Date().toISOString() };
      await this.atomic(this.file(id, 'job.json'), job);
      this.jobs.set(id, job);
      return job;
    });
    this.writes = next.catch(() => undefined);
    return next;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    for (const entry of await readdir(this.directory)) {
      if (!validId(entry) || this.tasks.has(entry)) continue;
      try {
        const job = JSON.parse(await readFile(this.file(entry, 'job.json'), 'utf8')) as AnimationDirectorJob;
        if (job.id !== entry) continue;
        this.jobs.set(entry, job);
        if (activeStates.has(job.status)) await this.patch(entry, { status: 'interrupted', stage: 'Backend đã khởi động lại. Kiểm tra tác vụ provider trước khi tiếp tục.' });
      } catch { /* keep damaged records on disk for diagnosis */ }
    }
  }
  get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Không tìm thấy job Animation.');
    return { ...job };
  }
  list(projectId?: string) {
    return [...this.jobs.values()].filter((job) => !projectId || job.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((job) => ({ ...job }));
  }
  async result(id: string) {
    if (!this.get(id).hasResult) throw new Error('Job chưa có project kết quả.');
    return JSON.parse(await readFile(this.file(id, 'result.json'), 'utf8')) as AnimationProject;
  }
  async input(id: string) {
    this.get(id);
    return JSON.parse(await readFile(this.file(id, 'input.json'), 'utf8')) as DirectAnimationInput;
  }
  async start(input: DirectAnimationInput, resumeId?: string) {
    if (!input?.project?.id || !input.provider || !input.model || String(input.brief || '').trim().length < 10) throw new Error('Thiếu project, brief hoặc provider/model.');
    const key = fingerprint(input);
    const existing = [...this.jobs.values()].find((job) => job.fingerprint === key && activeStates.has(job.status));
    if (existing) return { ...existing };
    let job: AnimationDirectorJob;
    if (resumeId) {
      job = this.get(resumeId);
      if (job.fingerprint !== key) throw new Error('Đầu vào đã đổi. Hãy tạo job mới để không trộn kết quả.');
      if (this.tasks.has(job.id)) throw new Error('Tác vụ hiện tại chưa dừng xong.');
      if (job.status === 'completed') return job;
    } else {
      const now = new Date().toISOString();
      job = { id: randomUUID(), projectId: input.project.id, fingerprint: key, status: 'queued', stage: 'Đang xếp tác vụ', createdAt: now, updatedAt: now };
      // Reserve synchronously before the first await to collapse double-clicks.
      this.jobs.set(job.id, job);
    }
    this.cancelled.delete(job.id);
    const redact = (value: DirectAnimationInput['provider']): DirectAnimationInput['provider'] => ({ id: value.id, name: value.name, baseUrl: '', enabled: true, models: [], capabilities: {}, providerType: value.providerType, authType: 'none' });
    const safeInput = { ...input, provider: redact(input.provider), assetGeneration: input.assetGeneration && { ...input.assetGeneration, provider: input.assetGeneration.provider && redact(input.assetGeneration.provider) }, narration: input.narration && { ...input.narration, provider: redact(input.narration.provider) } };
    try {
      await this.atomic(this.file(job.id, 'input.json'), safeInput);
      job = await this.patch(job.id, { status: 'queued', stage: 'Đang xếp tác vụ', error: undefined });
    }
    catch (error) { this.jobs.delete(job.id); throw error; }
    const snapshot = structuredClone(input);
    const task = this.execute(job.id, snapshot);
    this.tasks.set(job.id, task);
    void task.finally(() => this.tasks.delete(job.id));
    return job;
  }
  private async execute(id: string, input: DirectAnimationInput) {
    try {
      await this.patch(id, { status: 'running', stage: 'Đang lập kế hoạch' });
      const result = await this.runner(input, async (stage) => {
        if (this.cancelled.has(id)) { const error = new Error('Đã dừng scheduling; giữ tài nguyên đã tạo.'); error.name = 'AbortError'; throw error; }
        await this.patch(id, { stage });
      });
      await this.atomic(this.file(id, 'result.json'), result);
      await this.patch(id, { status: this.cancelled.has(id) ? 'cancelled' : 'completed', stage: this.cancelled.has(id) ? 'Đã dừng; kết quả vừa nhận được vẫn được giữ' : 'Đã dựng project; xem cảnh báo chất lượng trước khi xuất', hasResult: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await this.patch(id, { status: this.cancelled.has(id) ? 'cancelled' : 'failed', stage: 'Đã dừng, giữ checkpoint và tài nguyên', error: message }); }
      catch { this.jobs.set(id, { ...this.jobs.get(id)!, status: 'failed', error: 'Không ghi được trạng thái job. Kiểm tra dung lượng/quyền ghi.', updatedAt: new Date().toISOString() }); }
    }
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (!activeStates.has(job.status)) return job;
    this.cancelled.add(id);
    return this.patch(id, { stage: 'Đang dừng; chờ tác vụ provider đang chạy trả về' });
  }
}

export const animationDirectorJobs = new AnimationDirectorJobStore(path.join(workdir, 'animation-director-jobs'));
