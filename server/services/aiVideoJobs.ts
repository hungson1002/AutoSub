import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { chat } from '../adapters';
import { generateGoogleFlowVideo, FLOW_VIDEO_MODELS, validateGoogleFlowSession, type FlowVideoAspectRatio, type FlowVideoModel } from './googleFlow';
import { run, workdir } from './ffmpeg';
import { flowBridgeStatus } from './flowBridge';
import { recoverLatestViaFlowBridge } from './flowBridge';

export type AiVideoScene = { index: number; title: string; narration: string; visualPrompt: string; status: 'pending' | 'generating' | 'completed' | 'failed' };
export type AiVideoJob = { id: string; status: 'queued' | 'planning' | 'generating' | 'composing' | 'completed' | 'failed' | 'cancelled'; stage: string; progressPercent: number; createdAt: string; updatedAt: string; brief: string; durationSeconds: number; model: FlowVideoModel; aspectRatio: FlowVideoAspectRatio; productionBible?: string; scenes: AiVideoScene[]; result?: { videoFile: string; durationMs: number }; error?: string };
export type CreateAiVideoInput = { brief: string; durationSeconds: number; model?: FlowVideoModel; aspectRatio?: FlowVideoAspectRatio; script: { provider: AIProvider; model: string }; flowCredentials?: { nanoApiKey?: string; veoToken?: string; veoCookie?: string } };
const root = path.join(workdir, 'ai-video-jobs'), jobs = new Map<string, AiVideoJob>(), controllers = new Map<string, AbortController>();
const jobDir = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
async function waitForFlowBridge(timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (!flowBridgeStatus().connected && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 300));
  return flowBridgeStatus().connected;
}
async function save(job: AiVideoJob) { jobs.set(job.id, job); await mkdir(jobDir(job.id), { recursive: true }); await writeFile(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2)); }
export async function getAiVideoJob(id: string) { if (jobs.has(id)) return jobs.get(id)!; const job = JSON.parse(await readFile(path.join(jobDir(id), 'job.json'), 'utf8')) as AiVideoJob; jobs.set(id, job); return job; }
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

async function execute(id: string, input: CreateAiVideoInput, signal: AbortSignal) {
  try {
    const clipCount = Math.ceil(input.durationSeconds / 10);
    const sceneDurations = Array.from({ length: clipCount }, (_, index) => Math.min(10, input.durationSeconds - index * 10));
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
    let characterReference: string | undefined;
    for (let index = 0; index < scenes.length; index += 1) {
      scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'generating' } : scene);
      await patch(id, { status: 'generating', stage: `Flow đang tạo cảnh ${index + 1}/${scenes.length}`, scenes, progressPercent: Math.round(18 + index / scenes.length * 66) });
      try { const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = buildFlowPrompt(plan.productionBible, scenes[index], index + 1, sceneDurations[index]); const references = [characterReference, referenceFrame].filter((value): value is string => Boolean(value)); await generateGoogleFlowVideo(prompt, clipFile, input.model as FlowVideoModel, input.flowCredentials, references, input.aspectRatio, signal, true); if (index === 0) { characterReference = path.join(clipsDir, '001-character.jpg'); await run('ffmpeg', ['-y', '-ss', '1', '-i', clipFile, '-frames:v', '1', '-q:v', '2', characterReference]); } const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await run('ffmpeg', ['-y', '-sseof', '-0.12', '-i', clipFile, '-frames:v', '1', '-q:v', '2', nextReference]); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); }
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
export async function createAiVideoJob(input: CreateAiVideoInput) { const brief = String(input?.brief || '').trim().slice(0, 20_000); if (brief.length < 20) throw new Error('Kịch bản hoặc ý tưởng cần ít nhất 20 ký tự.'); if (!input.script?.provider || !input.script.model) throw new Error('Thiếu provider/model để phát triển ý tưởng.'); const nanoApiKey = String(input.flowCredentials?.nanoApiKey || '').trim(), veoToken = String(input.flowCredentials?.veoToken || '').trim(), veoCookie = String(input.flowCredentials?.veoCookie || '').trim(); if (!flowBridgeStatus().connected) await validateGoogleFlowSession({ nanoApiKey, veoToken, veoCookie }); const durationSeconds = Math.max(4, Math.min(120, Math.round(Number(input.durationSeconds)))); const model = FLOW_VIDEO_MODELS.includes(input.model as FlowVideoModel) ? input.model as FlowVideoModel : 'Veo 3.1 - Lite [Lower Priority]'; const aspectRatio: FlowVideoAspectRatio = input.aspectRatio === '16:9' ? '16:9' : '9:16'; const now = new Date().toISOString(); const job: AiVideoJob = { id: randomUUID(), status: 'queued', stage: 'Đã xếp hàng', progressPercent: 1, createdAt: now, updatedAt: now, brief, durationSeconds, model, aspectRatio, scenes: [] }; await save(job); const controller = new AbortController(); controllers.set(job.id, controller); void execute(job.id, { ...input, brief, durationSeconds, model, aspectRatio, flowCredentials: { nanoApiKey, veoToken, veoCookie } }, controller.signal); return job; }

export async function cancelAiVideoJob(id: string) { const job = await getAiVideoJob(id); if (!['queued', 'planning', 'generating', 'composing'].includes(job.status)) return job; controllers.get(id)?.abort(); controllers.delete(id); return patch(id, { status: 'cancelled', stage: 'Đã dừng theo yêu cầu', error: undefined, scenes: job.scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene) }); }

async function generateResumeClip(prompt: string, clipFile: string, model: FlowVideoModel, credentials: CreateAiVideoInput['flowCredentials'], referenceFrames: string[], aspectRatio: FlowVideoAspectRatio) {
  try { await generateGoogleFlowVideo(prompt, clipFile, model, credentials, referenceFrames, aspectRatio, undefined, true); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}. AutoSub đã dừng ngay để tránh trừ thêm credit; chỉ thử lại khi bạn chủ động bấm tiếp tục.`); }
}

export async function resumeAiVideoJob(id: string, flowCredentials: CreateAiVideoInput['flowCredentials'], requestedModel?: FlowVideoModel, script?: CreateAiVideoInput['script']) {
  const job = await getAiVideoJob(id); if (!['failed', 'cancelled'].includes(job.status)) throw new Error('Chỉ có thể tiếp tục job đã thất bại hoặc đã dừng.');
  if (!job.scenes.length) {
    if (!script?.provider || !script.model) throw new Error('Thiếu provider/model để tạo lại kế hoạch phim.');
    const controller = new AbortController(); controllers.set(id, controller);
    const restarted = await patch(id, { status: 'queued', stage: 'Đang tạo lại kế hoạch phim', progressPercent: 5, error: undefined });
    void execute(id, { brief: job.brief, durationSeconds: job.durationSeconds, model: requestedModel || job.model, aspectRatio: job.aspectRatio, script, flowCredentials }, controller.signal);
    return restarted;
  }
  const failedIndex = job.scenes.findIndex((scene) => scene.status !== 'completed'); if (failedIndex < 0) throw new Error('Job không còn cảnh lỗi để tiếp tục.');
  const resumeModel = FLOW_VIDEO_MODELS.includes(requestedModel as FlowVideoModel) ? requestedModel as FlowVideoModel : job.model;
  if (!await waitForFlowBridge()) await validateGoogleFlowSession(flowCredentials);
  const input: CreateAiVideoInput = { brief: job.brief, durationSeconds: job.durationSeconds, model: resumeModel, aspectRatio: job.aspectRatio || '9:16', script: { provider: {} as AIProvider, model: '' }, flowCredentials };
  let scenes = job.scenes.map((scene, index) => index === failedIndex ? { ...scene, status: 'generating' as const } : scene);
  const resumed = await patch(id, { status: 'generating', stage: `Đang tạo lại cảnh ${failedIndex + 1}/${job.scenes.length} bằng ${resumeModel}`, model: resumeModel, error: undefined, scenes });
  void (async () => { try {
    const clipsDir = path.join(jobDir(id), 'clips'); let referenceFrame = failedIndex ? path.join(clipsDir, `${String(failedIndex).padStart(3, '0')}-continuity.jpg`) : undefined; const characterCandidate = path.join(clipsDir, '001-character.jpg'); const characterReference = await stat(characterCandidate).then(() => characterCandidate).catch(() => undefined);
    if (job.status === 'cancelled' || /hiển thị video mới|media mới|hết thời gian chờ|không thấy request video|không tìm thấy nguồn video/i.test(job.error || '')) {
      const sceneNumber = failedIndex + 1;
      await patch(id, { stage: `Đang khôi phục cảnh ${sceneNumber} đã tạo từ thư viện Flow`, progressPercent: Math.round(18 + failedIndex / scenes.length * 66) });
      const recoveredClip = path.join(clipsDir, `${String(sceneNumber).padStart(3, '0')}.mp4`);
      await recoverLatestViaFlowBridge(recoveredClip);
      const recoveredReference = path.join(clipsDir, `${String(sceneNumber).padStart(3, '0')}-continuity.jpg`);
      await run('ffmpeg', ['-y', '-sseof', '-0.12', '-i', recoveredClip, '-frames:v', '1', '-q:v', '2', recoveredReference]);
      referenceFrame = recoveredReference;
      scenes = scenes.map((scene, index) => index === failedIndex ? { ...scene, status: 'completed' as const } : scene);
      await patch(id, { scenes, progressPercent: Math.round(18 + sceneNumber / scenes.length * 66) });
    }
    for (let index = failedIndex; index < scenes.length; index += 1) { if (scenes[index].status === 'completed') continue; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'generating' as const } : scene); await patch(id, { stage: `Flow đang tạo cảnh ${index + 1}/${scenes.length}`, scenes }); const seconds = Math.min(10, job.durationSeconds - index * 10); const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = buildFlowPrompt(job.productionBible || '', scenes[index], index + 1, seconds); const references = [characterReference, referenceFrame].filter((value): value is string => Boolean(value)); await generateResumeClip(prompt, clipFile, resumeModel, input.flowCredentials, references, input.aspectRatio || '9:16'); const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await run('ffmpeg', ['-y', '-sseof', '-0.12', '-i', clipFile, '-frames:v', '1', '-q:v', '2', nextReference]); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); await patch(id, { scenes, progressPercent: Math.round(18 + (index + 1) / scenes.length * 66) }); }
    await patch(id, { status: 'composing', stage: 'Đang ghép lại các cảnh đã lưu', progressPercent: 88, scenes }); const concat = path.join(clipsDir, 'concat.txt'); await writeFile(concat, scenes.map((_, index) => `file '${path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`).replace(/\\/g, '/')}'`).join('\n')); const output = path.join(jobDir(id), 'ai-video.mp4'); await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-t', String(job.durationSeconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]); const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]); await patch(id, { status: 'completed', stage: 'Đã tiếp tục và ghép xong video', progressPercent: 100, scenes, result: { videoFile: output, durationMs: Math.round(Number(probe.stdout.trim()) * 1000) } });
  } catch (error) { scenes = scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene); await patch(id, { status: 'failed', stage: 'Tiếp tục video thất bại', scenes, error: error instanceof Error ? error.message : String(error) }); } })(); return resumed;
}
