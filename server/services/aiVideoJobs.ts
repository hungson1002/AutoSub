import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { chat } from '../adapters';
import { generateGoogleFlowVideo, FLOW_VIDEO_MODELS, validateGoogleFlowSession, type FlowVideoAspectRatio, type FlowVideoModel } from './googleFlow';
import { run, workdir } from './ffmpeg';
import { resolveUpload } from './uploads';

export type AiVideoScene = { index: number; title: string; narration: string; visualPrompt: string; status: 'pending' | 'generating' | 'completed' | 'failed' };
export type AiVideoJob = { id: string; status: 'queued' | 'planning' | 'generating' | 'composing' | 'completed' | 'failed' | 'cancelled'; stage: string; progressPercent: number; createdAt: string; updatedAt: string; brief: string; durationSeconds: number; model: FlowVideoModel; aspectRatio: FlowVideoAspectRatio; characterReference?: { filename: string }; productionBible?: string; scenes: AiVideoScene[]; result?: { videoFile: string; durationMs: number }; error?: string };
export type CreateAiVideoInput = { brief: string; durationSeconds: number; model?: FlowVideoModel; aspectRatio?: FlowVideoAspectRatio; characterReferenceUploadId?: string; script: { provider: AIProvider; model: string } };
const FLOW_CLIP_SECONDS = 8;
const root = path.join(workdir, 'ai-video-jobs'), jobs = new Map<string, AiVideoJob>(), controllers = new Map<string, AbortController>();
let creatingJob = false;
const jobDir = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
async function save(job: AiVideoJob) { jobs.set(job.id, job); await mkdir(jobDir(job.id), { recursive: true }); await writeFile(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2)); }
export async function getAiVideoJob(id: string) {
  if (jobs.has(id)) return jobs.get(id)!;
  let job = JSON.parse(await readFile(path.join(jobDir(id), 'job.json'), 'utf8')) as AiVideoJob;
  if (['queued', 'planning', 'generating', 'composing'].includes(job.status) && !controllers.has(id)) {
    job = { ...job, status: 'failed', stage: 'Job bị gián đoạn khi AutoSub khởi động lại', error: 'Tiến trình nền đã bị gián đoạn. Bấm tiếp tục để khôi phục từ cảnh gần nhất.', updatedAt: new Date().toISOString() };
    await save(job);
  } else jobs.set(id, job);
  return job;
}
async function patch(id: string, value: Partial<AiVideoJob>) { const next = { ...await getAiVideoJob(id), ...value, updatedAt: new Date().toISOString() }; await save(next); return next; }
export async function getAiVideoResult(id: string) { const job = await getAiVideoJob(id); if (!job.result) throw new Error('Video AI chưa sẵn sàng.'); const info = await stat(job.result.videoFile); return { path: job.result.videoFile, size: info.size }; }
export async function getAiVideoClip(id: string, sceneIndex: number) {
  const job = await getAiVideoJob(id);
  const scene = job.scenes.find((item) => item.index === sceneIndex);
  if (!scene || scene.status !== 'completed') throw new Error('Cảnh video chưa sẵn sàng.');
  const file = path.join(jobDir(id), 'clips', `${String(sceneIndex).padStart(3, '0')}.mp4`);
  const info = await stat(file);
  return { path: file, size: info.size };
}
function parsePlan(raw: string, count: number): { productionBible: string; scenes: AiVideoScene[] } { const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')) as { productionBible?: Record<string, unknown>; scenes?: Array<Record<string, unknown>> }; if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== count) throw new Error(`AI phải trả đúng ${count} cảnh.`); const productionBible = Object.entries(parsed.productionBible || {}).map(([key, value]) => `${key}: ${String(value)}`).join('\n').slice(0, 4000); if (productionBible.length < 40) throw new Error('AI chưa tạo production bible đủ chi tiết để khóa continuity.'); const scenes: AiVideoScene[] = parsed.scenes.map((scene, index) => ({ index: index + 1, title: String(scene.title || `Cảnh ${index + 1}`).slice(0, 100), narration: String(scene.narration || '').slice(0, 600), visualPrompt: String(scene.visualPrompt || '').trim().slice(0, 4000), status: 'pending' })); return { productionBible, scenes }; }

function flowSafePrompt(prompt: string) {
  return prompt
    .replace(/pitch-black hollow eye sockets devoid of eyes/gi, 'eyes hidden completely in deep supernatural shadow')
    .replace(/dried dark residue running down (?:the )?cheeks/gi, 'rain streaks across the cheeks')
    .replace(/jagged teeth/gi, 'an unsettling rigid expression')
    .replace(/bloodless pale/gi, 'unnaturally pale')
    .replace(/deathly pale/gi, 'ghostly pale')
    .replace(/visible spider-web purple veins/gi, 'subtle porcelain-like texture')
    .replace(/catastrophic psychological jump scare/gi, 'intense cinematic supernatural reveal')
    .replace(/lunges? abruptly into (?:the )?camera lens/gi, 'moves suddenly toward the foreground before a cut to black');
}

function buildFlowPrompt(productionBible: string, scene: AiVideoScene, sceneIndex: number, seconds: number) {
  const continuity = productionBible.trim().slice(0, 650);
  const header = `${sceneIndex > 1 ? 'Continue directly from the attached final frame. Preserve the exact same character identity, face, wardrobe, location geometry, screen direction, lighting and color grade.\n' : ''}IMMUTABLE CONTINUITY:\n${continuity}\n\nSHOT ${sceneIndex} — one major action only:\n`;
  const suffix = `\nDialogue (Vietnamese): "${scene.narration.slice(0, 180)}". Natural delivery; no subtitles or on-screen text. Duration: ${seconds} seconds.`;
  const available = Math.max(360, 1600 - header.length - suffix.length);
  return flowSafePrompt(`${header}${scene.visualPrompt.slice(0, available)}${suffix}`);
}

export function parseBlurScore(stderr: string) {
  const values = Array.from(stderr.matchAll(/blur mean:\s*([\d.]+)/gi), (match) => Number(match[1])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.POSITIVE_INFINITY;
}

async function selectContinuityFrame(clipFile: string, outputFile: string) {
  const offsets = ['-1', '-0.75', '-0.5', '-0.25'];
  const files = offsets.map((_, index) => `${outputFile}.candidate-${index}.jpg`);
  try {
    const candidates = await Promise.all(offsets.map(async (offset, index) => {
      const file = files[index];
      await run('ffmpeg', ['-y', '-sseof', offset, '-i', clipFile, '-frames:v', '1', '-q:v', '2', file]);
      const measured = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blurdetect', '-f', 'null', '-']).catch(() => undefined);
      return { file, score: measured ? parseBlurScore(measured.stderr) : Number.POSITIVE_INFINITY };
    }));
    const selected = candidates.reduce((best, item) => item.score < best.score ? item : best, candidates[candidates.length - 1]);
    await copyFile(selected.file, outputFile);
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
}

const characterReferencePath = (id: string) => path.join(jobDir(id), 'character-reference.png');

export function isRetryableNoChargeFlowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /không thành công|chưa (?:bị )?tính phí|generation failed|weren't charged|were not charged/i.test(message);
}

function retryDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Đã dừng tác vụ.', 'AbortError'));
    }, { once: true });
  });
}

async function generateFlowClipWithRetry(
  generate: () => Promise<unknown>,
  signal: AbortSignal,
  onRetry?: (attempt: number, totalAttempts: number) => Promise<unknown>,
) {
  const totalAttempts = 3;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try { return await generate(); }
    catch (error) {
      if (signal.aborted || !isRetryableNoChargeFlowError(error) || attempt === totalAttempts) throw error;
      await onRetry?.(attempt + 1, totalAttempts);
      await retryDelay(attempt === 1 ? 8_000 : 20_000, signal);
    }
  }
}

async function execute(id: string, input: CreateAiVideoInput, signal: AbortSignal) {
  try {
    const clipCount = Math.ceil(input.durationSeconds / FLOW_CLIP_SECONDS);
    const sceneDurations = Array.from({ length: clipCount }, (_, index) => Math.min(FLOW_CLIP_SECONDS, input.durationSeconds - index * FLOW_CLIP_SECONDS));
    await patch(id, { status: 'planning', stage: 'AI đang phát triển ý tưởng và chia cảnh', progressPercent: 8 });
    const systemPrompt = `Return valid JSON only: {"productionBible":{"characters":"","wardrobeProps":"","worldLighting":"","cameraColor":"","audioVoice":""},"scenes":[{"title":"","narration":"","visualPrompt":""}]}. Create exactly ${clipCount} connected vertical 9:16 shots with these durations in order: ${sceneDurations.join(', ')} seconds. Treat them as one continuous film, not unrelated clips. Each shot has one major action, one camera movement, a starting state inherited from the prior shot, and an ending composition leading into the next shot. Lock recurring faces, body, wardrobe, props, location geometry, screen direction, lighting, lens, palette and voice. Keep productionBible under 1,200 characters, every visualPrompt between 500 and 900 characters, and every narration under 160 characters. Use concise concrete film language; do not repeat the whole bible in every shot. No captions, logos or watermarks.`;
    const userPrompt = `Create a ${input.durationSeconds}-second polished cinematic video from this Vietnamese brief or script:\n\n${input.brief}`;
    let raw = await chat(input.script.provider, input.script.model, [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], signal, Math.max(3600, clipCount * 700));
    let plan: ReturnType<typeof parsePlan>;
    try { plan = parsePlan(raw, clipCount); }
    catch {
      await patch(id, { stage: 'AI đang tạo lại kế hoạch phim ở dạng JSON gọn', progressPercent: 10 });
      raw = await chat(input.script.provider, input.script.model, [{ role: 'system', content: `${systemPrompt} STRICT RETRY: the previous response was truncated. Keep the complete JSON under ${Math.max(7000, clipCount * 1100)} characters. Close every string, array and object.` }, { role: 'user', content: userPrompt }], signal, Math.max(3600, clipCount * 650));
      plan = parsePlan(raw, clipCount);
    }
    let scenes = plan.scenes; await patch(id, { productionBible: plan.productionBible, scenes, progressPercent: 18 });
    const clipsDir = path.join(jobDir(id), 'clips'); await mkdir(clipsDir, { recursive: true });
    let referenceFrame: string | undefined;
    let characterReference = await stat(characterReferencePath(id)).then(() => characterReferencePath(id)).catch(() => undefined);
    for (let index = 0; index < scenes.length; index += 1) {
      scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'generating' } : scene);
      await patch(id, { status: 'generating', stage: `Flow đang tạo cảnh ${index + 1}/${scenes.length}`, scenes, progressPercent: Math.round(18 + index / scenes.length * 66) });
      try { const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = buildFlowPrompt(plan.productionBible, scenes[index], index + 1, sceneDurations[index]); const references = referenceFrame ? { startImagePath: referenceFrame } : characterReference ? { referenceImagePaths: [characterReference] } : {}; await generateFlowClipWithRetry(() => generateGoogleFlowVideo(prompt, clipFile, input.model as FlowVideoModel, undefined, references, input.aspectRatio, signal, true), signal, (attempt, total) => patch(id, { stage: `Flow Agent chưa tính phí; tự thử lại cảnh ${index + 1} (${attempt}/${total})` })); if (index === 0 && !characterReference) { characterReference = path.join(clipsDir, '001-character.jpg'); await run('ffmpeg', ['-y', '-ss', '1', '-i', clipFile, '-frames:v', '1', '-q:v', '2', characterReference]); } const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await selectContinuityFrame(clipFile, nextReference); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); }
      catch (error) { scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'failed' } : scene); await patch(id, { scenes }); throw error; }
    }
    await patch(id, { status: 'composing', stage: 'Đang ghép các cảnh thành video hoàn chỉnh', scenes, progressPercent: 88 });
    const concat = path.join(clipsDir, 'concat.txt'); await writeFile(concat, scenes.map((_, index) => `file '${path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`).replace(/\\/g, '/')}'`).join('\n'));
    const temp = path.join(jobDir(id), 'joined.mp4'), output = path.join(jobDir(id), 'ai-video.mp4');
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-t', String(input.durationSeconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', temp]); await rename(temp, output);
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output]); const media = JSON.parse(probe.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> }; const durationMs = Math.round(Number(media.format?.duration) * 1000); const streamTypes = new Set((media.streams || []).map((stream) => stream.codec_type)); if (!streamTypes.has('video') || !streamTypes.has('audio')) throw new Error('Hậu kiểm thất bại: video cuối phải có cả hình và tiếng.'); if (!Number.isFinite(durationMs) || durationMs < input.durationSeconds * 900) throw new Error(`Hậu kiểm thất bại: video chỉ dài ${(durationMs / 1000).toFixed(1)} giây, thấp hơn mục tiêu ${input.durationSeconds} giây.`); const volume = await run('ffmpeg', ['-hide_banner', '-i', output, '-af', 'volumedetect', '-f', 'null', '-']); const meanVolume = Number(volume.stderr.match(/mean_volume:\s*(-?[\d.]+) dB/i)?.[1]); if (!Number.isFinite(meanVolume) || meanVolume < -35) throw new Error('Hậu kiểm thất bại: âm thanh quá nhỏ hoặc không đọc được.');
    await patch(id, { status: 'completed', stage: 'Đã tạo xong và vượt qua hậu kiểm', progressPercent: 100, scenes, result: { videoFile: output, durationMs } });
  } catch (error) { if (!signal.aborted) await patch(id, { status: 'failed', stage: 'Tạo video AI thất bại', error: error instanceof Error ? error.message : String(error) }); }
  finally { controllers.delete(id); }
}
export async function createAiVideoJob(input: CreateAiVideoInput) {
  if (creatingJob || controllers.size) throw new Error('Đang có một job AI Video hoạt động. Hãy chờ hoặc dừng job hiện tại trước khi tạo job mới.');
  creatingJob = true;
  try {
  const brief = String(input?.brief || '').trim().slice(0, 20_000);
  if (brief.length < 20) throw new Error('Kịch bản hoặc ý tưởng cần ít nhất 20 ký tự.');
  if (!input.script?.provider || !input.script.model) throw new Error('Thiếu provider/model để phát triển ý tưởng.');
  await validateGoogleFlowSession();
  const durationSeconds = Math.max(4, Math.min(120, Math.round(Number(input.durationSeconds))));
  const model = FLOW_VIDEO_MODELS.includes(input.model as FlowVideoModel) ? input.model as FlowVideoModel : 'Flow Agent Auto';
  const aspectRatio: FlowVideoAspectRatio = input.aspectRatio === '16:9' ? '16:9' : '9:16';
  const now = new Date().toISOString(), id = randomUUID();
  let characterReference: AiVideoJob['characterReference'];
  if (input.characterReferenceUploadId) {
    const upload = await resolveUpload(input.characterReferenceUploadId);
    if (!/\.(?:png|jpe?g|webp)$/i.test(upload.filename) || upload.size > 20 * 1024 * 1024) throw new Error('Ảnh nhân vật phải là PNG, JPG hoặc WebP và không vượt quá 20 MB.');
    await mkdir(jobDir(id), { recursive: true });
    await run('ffmpeg', ['-y', '-i', upload.absolutePath, '-frames:v', '1', characterReferencePath(id)]);
    characterReference = { filename: upload.filename };
  }
  const job: AiVideoJob = { id, status: 'queued', stage: 'Đã xếp hàng', progressPercent: 1, createdAt: now, updatedAt: now, brief, durationSeconds, model, aspectRatio, characterReference, scenes: [] };
  await save(job);
  const controller = new AbortController();
  controllers.set(job.id, controller);
  void execute(job.id, { ...input, brief, durationSeconds, model, aspectRatio }, controller.signal);
  return job;
  } finally {
    creatingJob = false;
  }
}

export async function cancelAiVideoJob(id: string) { const job = await getAiVideoJob(id); if (!['queued', 'planning', 'generating', 'composing'].includes(job.status)) return job; controllers.get(id)?.abort(); controllers.delete(id); return patch(id, { status: 'cancelled', stage: 'Đã dừng theo yêu cầu', error: undefined, scenes: job.scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene) }); }

async function generateResumeClip(prompt: string, clipFile: string, model: FlowVideoModel, references: { startImagePath?: string; referenceImagePaths?: string[] }, aspectRatio: FlowVideoAspectRatio, signal: AbortSignal) {
  try { await generateFlowClipWithRetry(() => generateGoogleFlowVideo(prompt, clipFile, model, undefined, references, aspectRatio, signal, true), signal); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}. AutoSub đã dừng ngay để tránh trừ thêm credit; chỉ thử lại khi bạn chủ động bấm tiếp tục.`); }
}

export async function resumeAiVideoJob(id: string, requestedModel?: FlowVideoModel, script?: CreateAiVideoInput['script']) {
  const job = await getAiVideoJob(id); if (!['failed', 'cancelled'].includes(job.status)) throw new Error('Chỉ có thể tiếp tục job đã thất bại hoặc đã dừng.');
  if (controllers.size) throw new Error('Đang có một job AI Video hoạt động. Hãy chờ hoặc dừng job hiện tại trước khi tiếp tục job khác.');
  if (!job.scenes.length) {
    if (!script?.provider || !script.model) throw new Error('Thiếu provider/model để tạo lại kế hoạch phim.');
    const controller = new AbortController(); controllers.set(id, controller);
    const restarted = await patch(id, { status: 'queued', stage: 'Đang tạo lại kế hoạch phim', progressPercent: 5, error: undefined });
    void execute(id, { brief: job.brief, durationSeconds: job.durationSeconds, model: requestedModel || job.model, aspectRatio: job.aspectRatio, script }, controller.signal);
    return restarted;
  }
  const detectedFailedIndex = job.scenes.findIndex((scene) => scene.status !== 'completed');
  const recomposeOnly = detectedFailedIndex < 0;
  const failedIndex = recomposeOnly ? job.scenes.length : detectedFailedIndex;
  const resumeFromIndex = failedIndex;
  const resumeModel = FLOW_VIDEO_MODELS.includes(requestedModel as FlowVideoModel) ? requestedModel as FlowVideoModel : job.model;
  await validateGoogleFlowSession();
  const input: CreateAiVideoInput = { brief: job.brief, durationSeconds: job.durationSeconds, model: resumeModel, aspectRatio: job.aspectRatio || '9:16', script: { provider: {} as AIProvider, model: '' } };
  const controller = new AbortController();
  const { signal } = controller;
  let scenes = job.scenes.map((scene, index) => index === failedIndex ? { ...scene, status: 'generating' as const } : scene);
  const resumed = await patch(id, { status: recomposeOnly ? 'composing' : 'generating', stage: recomposeOnly ? 'Đang ghép lại các cảnh đã hoàn thành' : `Đang tạo lại cảnh ${failedIndex + 1}/${job.scenes.length} bằng ${resumeModel}`, model: resumeModel, error: undefined, scenes });
  controllers.set(id, controller);
  void (async () => { try {
    const clipsDir = path.join(jobDir(id), 'clips'); let referenceFrame = resumeFromIndex ? path.join(clipsDir, `${String(resumeFromIndex).padStart(3, '0')}-continuity.jpg`) : undefined; const uploadedCharacter = characterReferencePath(id); const generatedCharacter = path.join(clipsDir, '001-character.jpg'); const characterReference = await stat(uploadedCharacter).then(() => uploadedCharacter).catch(() => stat(generatedCharacter).then(() => generatedCharacter).catch(() => undefined));
    for (let index = failedIndex; index < scenes.length; index += 1) { if (scenes[index].status === 'completed') continue; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'generating' as const } : scene); await patch(id, { stage: `Flow Agent đang tạo cảnh ${index + 1}/${scenes.length}`, scenes }); const seconds = Math.min(FLOW_CLIP_SECONDS, job.durationSeconds - index * FLOW_CLIP_SECONDS); const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = buildFlowPrompt(job.productionBible || '', scenes[index], index + 1, seconds); const references = referenceFrame ? { startImagePath: referenceFrame } : characterReference ? { referenceImagePaths: [characterReference] } : {}; await generateResumeClip(prompt, clipFile, resumeModel, references, input.aspectRatio || '9:16', signal); const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await selectContinuityFrame(clipFile, nextReference); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); await patch(id, { scenes, progressPercent: Math.round(18 + (index + 1) / scenes.length * 66) }); }
    await patch(id, { status: 'composing', stage: 'Đang ghép lại các cảnh đã lưu', progressPercent: 88, scenes }); const concat = path.join(clipsDir, 'concat.txt'); await writeFile(concat, scenes.map((_, index) => `file '${path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`).replace(/\\/g, '/')}'`).join('\n')); const output = path.join(jobDir(id), 'ai-video.mp4'); await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-t', String(job.durationSeconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]); const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]); await patch(id, { status: 'completed', stage: 'Đã tiếp tục và ghép xong video', progressPercent: 100, scenes, result: { videoFile: output, durationMs: Math.round(Number(probe.stdout.trim()) * 1000) } });
  } catch (error) { if (!signal.aborted) { scenes = scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene); await patch(id, { status: 'failed', stage: 'Tiếp tục video thất bại', scenes, error: error instanceof Error ? error.message : String(error) }); } } finally { controllers.delete(id); } })(); return resumed;
}
