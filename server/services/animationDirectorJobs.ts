import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AnimationProject } from '../../shared/animationStudio';
import { directAnimationProject, type DirectAnimationInput } from './animationDirector';
import { animationCheckpointKey } from './animationCheckpoint';
import { workdir } from './ffmpeg';
import { writeJsonFileResilient } from './resilientFileWrite';
import { FlowSessionError } from './googleFlow';

export interface AnimationDirectorJob {
  id: string; projectId: string; fingerprint: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled';
  stage: string; createdAt: string; updatedAt: string; error?: string; hasResult?: boolean;
  /** Coarse end-to-end progress. Image progress is based on completed assets, not the task currently retrying. */
  progressPercent?: number;
  progressLabel?: string;
  progressCurrent?: number;
  progressTotal?: number;
}
type Runner = (input: DirectAnimationInput, onStage: (stage: string) => Promise<void>) => Promise<AnimationProject>;
type RecoveryDelay = (attempt: number, kind: 'provider' | 'bridge' | 'uncertain') => number;

const defaultRecoveryDelay: RecoveryDelay = (attempt, kind) => {
  const base = kind === 'uncertain' ? 500 : 1_000;
  return Math.min(60_000, base * 2 ** Math.min(20, Math.max(0, attempt - 1)));
};

function progressFromStage(stage: string, previous: AnimationDirectorJob) {
  const doneImages = /^Ảnh\s+(\d+)\/(\d+)\b/iu.exec(stage);
  if (doneImages) {
    const current = Math.max(0, Number(doneImages[1]) || 0);
    const total = Math.max(1, Number(doneImages[2]) || 1);
    return { progressPercent: Math.min(94, Math.max(20, Math.round(20 + 74 * current / total))), progressLabel: `${current}/${total} ảnh đã xong`, progressCurrent: current, progressTotal: total };
  }
  const restoredImages = /Đã khôi phục ảnh\s+(\d+)\/(\d+)/iu.exec(stage);
  if (restoredImages) {
    const current = Math.max(0, Number(restoredImages[1]) || 0);
    const total = Math.max(1, Number(restoredImages[2]) || 1);
    return { progressPercent: Math.min(94, Math.max(20, Math.round(20 + 74 * current / total))), progressLabel: `${current}/${total} ảnh đã xong`, progressCurrent: current, progressTotal: total };
  }
  const castLocked = /Đã khóa\s+(\d+)\s+nhân vật phụ bằng ảnh tham chiếu/iu.exec(stage);
  if (castLocked) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Đã khóa ${castLocked[1]} nhân vật phụ · bắt đầu tạo cảnh` };
  const castReference = /(?:Tạo|Làm sạch) ảnh nhận diện (CAST_[A-Z0-9_]+)(?:\s*·\s*sửa\s+(\d+)\/(\d+))?/iu.exec(stage);
  if (castReference) return {
    progressPercent: Math.max(previous.progressPercent || 0, 20),
    progressLabel: castReference[2]
      ? `Đang sửa ảnh nhận diện ${castReference[1]} · lượt ${castReference[2]}/${castReference[3]}`
      : `Đang tạo ảnh nhận diện ${castReference[1]}`,
  };
  const imageStart = /Đang tạo\s+(\d+)\s+ảnh\b(?:.*?đã khôi phục\s+(\d+)\/(\d+))?/iu.exec(stage);
  if (imageStart) {
    const total = Math.max(1, Number(imageStart[1]) || 1);
    const current = Math.max(0, Number(imageStart[2]) || 0);
    return { progressPercent: Math.min(94, Math.max(previous.progressPercent || 0, Math.round(20 + 74 * current / total))), progressLabel: `${current}/${total} ảnh đã xong`, progressCurrent: current, progressTotal: total };
  }
  const lockedStoryboard = /Đã khóa storyboard:\s*(\d+)\s+visual\s*·\s*(\d+)\s+ảnh AI/iu.exec(stage);
  if (lockedStoryboard) return { progressPercent: Math.max(previous.progressPercent || 0, 14), progressLabel: `${lockedStoryboard[1]} visual · ${lockedStoryboard[2]} ảnh AI` };
  if (/Đang viết storyboard/iu.test(stage)) return { progressPercent: Math.max(previous.progressPercent || 0, 8), progressLabel: 'Đang viết storyboard' };
  if (/Đang căn kịch bản|Lời đọc còn ngắn|Đã khóa kịch bản/iu.test(stage)) return { progressPercent: Math.max(previous.progressPercent || 0, 15), progressLabel: 'Đang khóa lời đọc theo thời lượng' };
  const narrationFit = /Đang chỉnh lời đọc theo timeline cố định \((\d+)\/(\d+)\)/iu.exec(stage);
  if (narrationFit) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Đang căn thời lượng lời đọc (${narrationFit[1]}/${narrationFit[2]})` };
  const narrationFitChunk = /Đang căn lời đọc nhóm\s+(\d+)\/(\d+)\s+·\s+cảnh\s+(\d+)-(\d+)/iu.exec(stage);
  if (narrationFitChunk) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Đang căn lời đọc nhóm ${narrationFitChunk[1]}/${narrationFitChunk[2]} · cảnh ${narrationFitChunk[3]}-${narrationFitChunk[4]}` };
  const narrationPreflight = /Preflight lời đọc:\s*ước tính\s*([\d.]+)s\s*\/\s*([\d.]+)s/iu.exec(stage);
  if (narrationPreflight) return { progressPercent: Math.max(previous.progressPercent || 0, 16), progressLabel: `Preflight script · ${narrationPreflight[1]}s / ${narrationPreflight[2]}s` };
  const narrationBudget = /Đã khóa ngân sách lời đọc:\s*(\d+)\s+cảnh\s*·\s*~?(\d+)\s+từ/iu.exec(stage);
  if (narrationBudget) return { progressPercent: Math.max(previous.progressPercent || 0, 14), progressLabel: `Đã khóa time/word budget · ${narrationBudget[1]} cảnh · ~${narrationBudget[2]} từ` };
  const narrationLocalRepair = /Sửa cục bộ lời đọc\s+(\d+)\/(\d+)\s+·\s+cảnh\s+(.+)/iu.exec(stage);
  if (narrationLocalRepair) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Sửa cục bộ voice ${narrationLocalRepair[1]}/${narrationLocalRepair[2]} · cảnh ${narrationLocalRepair[3]}` };
  const narrationMeasuredRepair = /Voice thật lệch\s*([\d.]+)s\s*·\s*sửa cục bộ\s*(\d+)\s*cảnh/iu.exec(stage);
  if (narrationMeasuredRepair) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Voice lệch ${narrationMeasuredRepair[1]}s · sửa ${narrationMeasuredRepair[2]} cảnh` };
  const narrationRepairDone = /Local repair xong\s*·\s*voice\s*([\d.]+)s\s*\/\s*([\d.]+)s/iu.exec(stage);
  if (narrationRepairDone) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Local repair xong · ${narrationRepairDone[1]}s / ${narrationRepairDone[2]}s` };
  const deterministicGuard = /Storyboard guard phát hiện\s*(\d+)\s*lỗi(?:.*?scene\s*(\d+))?/iu.exec(stage);
  if (deterministicGuard) return {
    progressPercent: Math.max(previous.progressPercent || 0, 14),
    progressLabel: deterministicGuard[2]
      ? `Đang sửa ${deterministicGuard[1]} lỗi storyboard · scene ${deterministicGuard[2]}`
      : `Đang sửa ${deterministicGuard[1]} lỗi storyboard cứng`,
  };
  const deterministicGuardRetry = /JSON sửa storyboard scene\s*(\d+)\s*bị cắt/iu.exec(stage);
  if (deterministicGuardRetry) return { progressPercent: Math.max(previous.progressPercent || 0, 14), progressLabel: `JSON scene ${deterministicGuardRetry[1]} bị cắt · đang tự thử lại` };
  const narrationFitSplit = /JSON căn lời đọc nhóm\s+(\d+)-(\d+)\s+chưa hoàn chỉnh/iu.exec(stage);
  if (narrationFitSplit) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `JSON cảnh ${narrationFitSplit[1]}-${narrationFitSplit[2]} bị cắt · đang tự chia nhỏ` };
  const narrationFitRetry = /JSON căn lời đọc cảnh\s+(\d+)\s+bị cắt/iu.exec(stage);
  if (narrationFitRetry) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `JSON cảnh ${narrationFitRetry[1]} bị cắt · đang tự thử lại` };
  const narrationProcessed = /Đã xử lý\s+(\d+)\/(\d+)\s+(?:câu|cảnh) lời đọc/iu.exec(stage);
  if (narrationProcessed) {
    const current = Math.max(0, Number(narrationProcessed[1]) || 0);
    const total = Math.max(1, Number(narrationProcessed[2]) || 1);
    return { progressPercent: Math.min(20, Math.max(previous.progressPercent || 15, Math.round(15 + 5 * current / total))), progressLabel: `${current}/${total} cảnh voice đã kiểm tra` };
  }
  const narrationMeasureStart = /Đang kiểm tra cache và đo voice:\s*(\d+)\s*(?:câu|cảnh)/iu.exec(stage);
  if (narrationMeasureStart) return { progressPercent: Math.max(previous.progressPercent || 0, 15), progressLabel: `Đang đo voice · 0/${Math.max(1, Number(narrationMeasureStart[1]) || 1)} cảnh` };
  const narrationMeasured = /Voice đã đo:\s*(\d+)\s+cảnh dùng cache\s*·\s*(\d+)\s+cảnh TTS mới/iu.exec(stage);
  if (narrationMeasured) return { progressPercent: Math.max(previous.progressPercent || 0, 20), progressLabel: `Voice đã đo · ${narrationMeasured[1]} cache · ${narrationMeasured[2]} TTS mới` };
  const doneNarration = /Đã tạo\s+(\d+)\/(\d+)\s+(?:câu|cảnh) lời đọc/iu.exec(stage);
  if (doneNarration) {
    const current = Math.max(0, Number(doneNarration[1]) || 0);
    const total = Math.max(1, Number(doneNarration[2]) || 1);
    return { progressPercent: Math.min(20, Math.max(previous.progressPercent || 15, Math.round(15 + 5 * current / total))), progressLabel: `${current}/${total} cảnh lời đọc` };
  }
  const narrationStart = /Lời đọc Turbo:\s*(\d+)\s*(?:câu|cảnh)/iu.exec(stage);
  if (narrationStart) return { progressPercent: Math.max(previous.progressPercent || 0, 15), progressLabel: `0/${Math.max(1, Number(narrationStart[1]) || 1)} cảnh lời đọc` };
  if (/tạo lời đọc/iu.test(stage)) return { progressPercent: Math.max(previous.progressPercent || 0, 15), progressLabel: 'Đang tạo voiceover' };
  if (/Đang hoàn tất project/iu.test(stage)) return { progressPercent: Math.max(previous.progressPercent || 0, 99), progressLabel: 'Đang hoàn tất project' };
  return {};
}
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
  private creativeRecoveryAttempts = new Map<string, number>();
  private providerRecoveryAttempts = new Map<string, number>();
  private uncertainRecoveryAttempts = new Map<string, number>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private directory: string, private runner: Runner = directAnimationProject, private recoveryDelay: RecoveryDelay = defaultRecoveryDelay) {}
  private file(id: string, name: string) {
    if (!validId(id)) throw new Error('Invalid animation job id.');
    return path.join(this.directory, id, name);
  }
  private async atomic(file: string, value: unknown) {
    await writeJsonFileResilient(file, value);
  }
  private patch(id: string, changes: Partial<AnimationDirectorJob>) {
    const next = this.writes.then(async () => {
      const current = this.jobs.get(id)!;
      const monotonicProgress = changes.progressPercent === undefined
        ? {}
        : { progressPercent: Math.max(current.progressPercent || 0, changes.progressPercent) };
      const job = { ...current, ...changes, ...monotonicProgress, updatedAt: new Date().toISOString() };
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
      job = { id: randomUUID(), projectId: input.project.id, fingerprint: key, status: 'queued', stage: 'Đang xếp tác vụ', createdAt: now, updatedAt: now, progressPercent: 1, progressLabel: 'Đang xếp tác vụ' };
      // Reserve synchronously before the first await to collapse double-clicks.
      this.jobs.set(job.id, job);
    }
    this.cancelled.delete(job.id);
    const redact = (value: DirectAnimationInput['provider']): DirectAnimationInput['provider'] => ({ id: value.id, name: value.name, baseUrl: '', enabled: true, models: [], capabilities: {}, providerType: value.providerType, authType: 'none' });
    const safeInput = { ...input, provider: redact(input.provider), assetGeneration: input.assetGeneration && { ...input.assetGeneration, provider: input.assetGeneration.provider && redact(input.assetGeneration.provider) }, narration: input.narration && { ...input.narration, provider: redact(input.narration.provider) } };
    try {
      await this.atomic(this.file(job.id, 'input.json'), safeInput);
      job = await this.patch(job.id, {
        status: 'queued',
        stage: resumeId ? 'Đang khôi phục checkpoint đã lưu' : 'Đang xếp tác vụ',
        error: undefined,
        ...(resumeId ? {
          progressLabel: job.progressCurrent !== undefined && job.progressTotal
            ? `Đang tiếp tục từ checkpoint · giữ ${job.progressCurrent}/${job.progressTotal} ảnh đã xong`
            : `Đang tiếp tục từ checkpoint · giữ ${job.progressPercent || 0}% tiến độ`,
        } : {}),
      });
    }
    catch (error) { this.jobs.delete(job.id); throw error; }
    const snapshot = structuredClone(input);
    const task = this.execute(job.id, snapshot, 0, Boolean(resumeId));
    this.tasks.set(job.id, task);
    void task.finally(() => this.tasks.delete(job.id));
    return job;
  }
  private async execute(id: string, input: DirectAnimationInput, trafficAttempt = 0, resuming = false): Promise<void> {
    try {
      if (this.cancelled.has(id)) { const error = new Error('Đã dừng tác vụ.'); error.name = 'AbortError'; throw error; }
      await this.patch(id, {
        status: 'running',
        stage: trafficAttempt || resuming ? 'Đang khôi phục phần còn thiếu từ checkpoint' : 'Đang lập kế hoạch',
        progressPercent: Math.max(this.jobs.get(id)?.progressPercent || 0, 3),
      });
      const result = await this.runner(input, async (stage) => {
        if (this.cancelled.has(id)) { const error = new Error('Đã dừng scheduling; giữ tài nguyên đã tạo.'); error.name = 'AbortError'; throw error; }
        const current = this.jobs.get(id)!;
        await this.patch(id, { stage, ...progressFromStage(stage, current) });
      });
      await this.atomic(this.file(id, 'result.json'), result);
      const beforeComplete = this.jobs.get(id)!;
      const imageTotal = beforeComplete.progressTotal;
      this.creativeRecoveryAttempts.delete(id);
      this.providerRecoveryAttempts.delete(id);
      this.uncertainRecoveryAttempts.delete(id);
      await this.patch(id, {
        status: this.cancelled.has(id) ? 'cancelled' : 'completed',
        stage: this.cancelled.has(id) ? 'Đã dừng; kết quả vừa nhận được vẫn được giữ' : 'Đã dựng project; xem cảnh báo chất lượng trước khi xuất',
        hasResult: true,
        progressPercent: 100,
        progressLabel: this.cancelled.has(id) ? 'Đã dừng' : imageTotal ? `${imageTotal}/${imageTotal} ảnh đã xong` : 'Hoàn tất',
        ...(imageTotal ? { progressCurrent: imageTotal, progressTotal: imageTotal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Retry explicit upstream traffic rejection with its shared cooldown.
      // Outcome-unknown image failures are reconciled separately below using
      // the same durable asset idempotency key and checkpoint.
      if (!this.cancelled.has(id) && error instanceof FlowSessionError
        && error.code === 'FLOW_IMAGE_TRAFFIC_THROTTLED' && trafficAttempt < 2
        && Number.isFinite(error.retryAt)) {
        const retryAt = error.retryAt!;
        let lastSeconds = -1;
        while (!this.cancelled.has(id)) {
          const remaining = retryAt - Date.now();
          const seconds = Math.max(0, Math.ceil(remaining / 1000));
          if (seconds !== lastSeconds && (lastSeconds < 0 || seconds % 5 === 0)) {
            lastSeconds = seconds;
            await this.patch(id, {
              status: 'running', error: undefined,
              stage: `Flow đang giới hạn lưu lượng · tự tiếp tục sau ${seconds}s (${trafficAttempt + 1}/2) · giữ ảnh đã xong`,
              progressLabel: `Đang chờ Flow ${seconds}s · sẽ tiếp tục tự động`,
            });
          }
          if (remaining <= 0) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining)));
        }
        if (!this.cancelled.has(id)) return this.execute(id, input, trafficAttempt + 1, true);
      }
      const retryableUncertainOutcome = error instanceof FlowSessionError && error.code === 'FLOW_GENERATION_OUTCOME_UNKNOWN';
      if (!this.cancelled.has(id) && retryableUncertainOutcome && (this.uncertainRecoveryAttempts.get(id) || 0) < 1) {
        const attempt = (this.uncertainRecoveryAttempts.get(id) || 0) + 1;
        this.uncertainRecoveryAttempts.set(id, attempt);
        const delayMs = this.recoveryDelay(attempt, 'uncertain');
        await this.patch(id, {
          status: 'running',
          stage: `Flow chưa xác nhận ảnh · đối soát cùng khóa từ checkpoint sau ${Math.ceil(delayMs / 1000)}s (lượt ${attempt})`,
          error: undefined,
          progressLabel: this.jobs.get(id)?.progressCurrent !== undefined && this.jobs.get(id)?.progressTotal
            ? `Đang đối soát Flow · giữ ${this.jobs.get(id)!.progressCurrent}/${this.jobs.get(id)!.progressTotal} ảnh đã xong`
            : `Đang đối soát Flow · giữ ${this.jobs.get(id)?.progressPercent || 0}% tiến độ`,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.execute(id, input, trafficAttempt, true);
      }

      const retryableFlowSessionPool = error instanceof FlowSessionError
        && ['FLOW_NO_AUTHENTICATED_WORKERS', 'FLOW_SESSION_REFRESH_FAILED'].includes(error.code);
      if (!this.cancelled.has(id) && retryableFlowSessionPool) {
        const attempt = (this.providerRecoveryAttempts.get(id) || 0) + 1;
        this.providerRecoveryAttempts.set(id, attempt);
        const delayMs = this.recoveryDelay(attempt, 'provider');
        const savedImages = this.jobs.get(id)?.progressCurrent;
        const totalImages = this.jobs.get(id)?.progressTotal;
        await this.patch(id, {
          status: 'running',
          stage: `Flow chưa tìm thấy worker có phiên xác thực · đang dò lại pool Flow sau ${Math.ceil(delayMs / 1000)}s (lượt ${attempt}) · giữ checkpoint`,
          error: undefined,
          progressLabel: savedImages !== undefined && totalImages
            ? `Đang dò lại worker Flow · giữ ${savedImages}/${totalImages} ảnh`
            : `Đang dò lại worker Flow · giữ ${this.jobs.get(id)?.progressPercent || 0}% tiến độ`,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.execute(id, input, trafficAttempt, true);
      }
      const retryableProviderBridge = error instanceof FlowSessionError && error.code === 'FLOW_EXTENSION_NOT_CONNECTED'
        || /FLOW_NO_HEALTHY_ALTERNATE_WORKER|mất kết nối trình duyệt|extension is not connected/iu.test(message);
      if (!this.cancelled.has(id) && retryableProviderBridge) {
        const attempt = (this.providerRecoveryAttempts.get(id) || 0) + 1;
        this.providerRecoveryAttempts.set(id, attempt);
        const delayMs = this.recoveryDelay(attempt, 'bridge');
        await this.patch(id, {
          status: 'running',
          stage: `Flow worker tạm mất bridge · tự khôi phục sau ${Math.ceil(delayMs / 1000)}s (lượt ${attempt}) · giữ checkpoint`,
          error: undefined,
          progressLabel: this.jobs.get(id)?.progressCurrent !== undefined && this.jobs.get(id)?.progressTotal
            ? `Đang tự nối lại Flow · giữ ${this.jobs.get(id)!.progressCurrent}/${this.jobs.get(id)!.progressTotal} ảnh`
            : `Đang tự nối lại Flow · giữ ${this.jobs.get(id)?.progressPercent || 0}% tiến độ`,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.execute(id, input, trafficAttempt, true);
      }
      const retryableCreativeQc = /STYLE_GRAMMAR_BLOCK|Calibration phong cách|same[- ]artist grammar|style\/character grammar|Storyboard sau narration-fit|post[- ]narration[- ]fit.*visual/iu.test(message);
      if (!this.cancelled.has(id) && retryableCreativeQc) {
        const attempt = (this.creativeRecoveryAttempts.get(id) || 0) + 1;
        if (attempt <= 3) {
          this.creativeRecoveryAttempts.set(id, attempt);
          await this.patch(id, {
            status: 'running',
            stage: `Creative QC chưa đạt · tự phục hồi từ checkpoint (${attempt}/3)`,
            error: undefined,
            progressLabel: `Tự sửa style/QC · lượt ${attempt}/3`,
          });
          await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
          return this.execute(id, input, trafficAttempt, true);
        }
      }
      this.creativeRecoveryAttempts.delete(id);
      this.providerRecoveryAttempts.delete(id);
      this.uncertainRecoveryAttempts.delete(id);
      try { await this.patch(id, {
        status: this.cancelled.has(id) ? 'cancelled' : 'failed',
        stage: 'Đã dừng, giữ checkpoint và tài nguyên',
        error: error instanceof FlowSessionError && error.code === 'FLOW_IMAGE_TRAFFIC_THROTTLED' && trafficAttempt >= 2
          ? `${message} Đã tự chờ và tiếp tục 2 lần nhưng Google vẫn giới hạn. Kiểm tra tài khoản Flow trước khi tiếp tục; ứng dụng đã giữ checkpoint.`
          : message,
        progressLabel: this.cancelled.has(id)
          ? 'Đã dừng'
          : this.jobs.get(id)?.progressCurrent !== undefined && this.jobs.get(id)?.progressTotal
            ? `Đã dừng · checkpoint giữ ${this.jobs.get(id)!.progressCurrent}/${this.jobs.get(id)!.progressTotal} ảnh · có thể tiếp tục`
            : `Đã dừng · checkpoint giữ ${this.jobs.get(id)?.progressPercent || 0}% tiến độ · có thể tiếp tục`,
      }); }
      catch { this.jobs.set(id, { ...this.jobs.get(id)!, status: 'failed', error: 'Không ghi được trạng thái job. Kiểm tra dung lượng/quyền ghi.', updatedAt: new Date().toISOString() }); }
    }
  }
  async cancel(id: string) {
    this.creativeRecoveryAttempts.delete(id);
    this.providerRecoveryAttempts.delete(id);
    this.uncertainRecoveryAttempts.delete(id);
    const job = this.get(id);
    if (!activeStates.has(job.status)) return job;
    this.cancelled.add(id);
    return this.patch(id, { stage: 'Đang dừng; chờ tác vụ provider đang chạy trả về' });
  }
}

export const animationDirectorJobs = new AnimationDirectorJobStore(path.join(workdir, 'animation-director-jobs'));
