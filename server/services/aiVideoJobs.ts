import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AIProvider } from '../types';
import { chat } from '../adapters';
import { generateGoogleFlowVideo, FLOW_VIDEO_MODELS, type FlowVideoAspectRatio, type FlowVideoModel } from './googleFlow';
import { run, workdir } from './ffmpeg';

export type AiVideoScene = { index: number; title: string; narration: string; visualPrompt: string; status: 'pending' | 'generating' | 'completed' | 'failed' };
export type AiVideoJob = { id: string; status: 'queued' | 'planning' | 'generating' | 'composing' | 'completed' | 'failed' | 'cancelled'; stage: string; progressPercent: number; createdAt: string; updatedAt: string; brief: string; durationSeconds: number; model: FlowVideoModel; aspectRatio: FlowVideoAspectRatio; scenes: AiVideoScene[]; result?: { videoFile: string; durationMs: number }; error?: string };
export type CreateAiVideoInput = { brief: string; durationSeconds: number; model?: FlowVideoModel; aspectRatio?: FlowVideoAspectRatio; script: { provider: AIProvider; model: string }; flowCredentials?: { nanoApiKey?: string; veoToken?: string; veoCookie?: string } };
const root = path.join(workdir, 'ai-video-jobs'), jobs = new Map<string, AiVideoJob>(), controllers = new Map<string, AbortController>();
const jobDir = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
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

async function execute(id: string, input: CreateAiVideoInput, signal: AbortSignal) {
  try {
    const clipCount = Math.ceil(input.durationSeconds / 10);
    const sceneDurations = Array.from({ length: clipCount }, (_, index) => Math.min(10, input.durationSeconds - index * 10));
    await patch(id, { status: 'planning', stage: 'AI đang phát triển ý tưởng và chia cảnh', progressPercent: 8 });
    const raw = await chat(input.script.provider, input.script.model, [{ role: 'system', content: `Return JSON only: {"productionBible":{"characters":"","wardrobeProps":"","worldLighting":"","cameraColor":"","audioVoice":""},"scenes":[{"title":"","narration":"","visualPrompt":""}]}. Create exactly ${clipCount} connected vertical 9:16 text-to-video scenes with these durations in order: ${sceneDurations.join(', ')} seconds. Each scene may be at most 10 seconds. The productionBible is immutable and must identify every recurring character precisely, including face, hair, age, body, wardrobe and props; lock location, time, lighting, lens language, palette and Vietnamese voice identity. Repeat all relevant locked details inside every production-ready English visualPrompt. narration is the exact concise Vietnamese line spoken in that scene; use natural punctuation and unambiguous words for clear pronunciation. No captions, logos or watermarks.` }, { role: 'user', content: `Create a ${input.durationSeconds}-second polished cinematic video from this Vietnamese brief or script:\n\n${input.brief}` }], signal, Math.max(2200, clipCount * 550));
    const plan = parsePlan(raw, clipCount); let scenes = plan.scenes; await patch(id, { scenes, progressPercent: 18 });
    const clipsDir = path.join(jobDir(id), 'clips'); await mkdir(clipsDir, { recursive: true });
    let referenceFrame: string | undefined;
    for (let index = 0; index < scenes.length; index += 1) {
      scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'generating' } : scene);
      await patch(id, { status: 'generating', stage: `Flow đang tạo cảnh ${index + 1}/${scenes.length}`, scenes, progressPercent: Math.round(18 + index / scenes.length * 66) });
      try { const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = flowSafePrompt(`IMMUTABLE PRODUCTION BIBLE:\n${plan.productionBible}\n\nSHOT ${index + 1}:\n${scenes[index].visualPrompt}\nExact Vietnamese speech: "${scenes[index].narration}". Speak naturally, clearly and at an intelligible pace. The shot must last ${sceneDurations[index]} seconds.`); await generateGoogleFlowVideo(prompt, clipFile, input.model as FlowVideoModel, input.flowCredentials, referenceFrame, input.aspectRatio, signal); const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await run('ffmpeg', ['-y', '-sseof', '-0.12', '-i', clipFile, '-frames:v', '1', '-q:v', '2', nextReference]); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); }
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
export async function createAiVideoJob(input: CreateAiVideoInput) { const brief = String(input?.brief || '').trim().slice(0, 20_000); if (brief.length < 20) throw new Error('Kịch bản hoặc ý tưởng cần ít nhất 20 ký tự.'); if (!input.script?.provider || !input.script.model) throw new Error('Thiếu provider/model để phát triển ý tưởng.'); const nanoApiKey = '', veoToken = String(input.flowCredentials?.veoToken || '').trim(), veoCookie = String(input.flowCredentials?.veoCookie || '').trim(); if (!veoToken && !process.env.VEO_TOKEN?.trim()) throw new Error('Hãy nhập Google Flow accessToken.'); const durationSeconds = Math.max(4, Math.min(120, Math.round(Number(input.durationSeconds)))); const model = FLOW_VIDEO_MODELS.includes(input.model as FlowVideoModel) ? input.model as FlowVideoModel : 'Veo 3.1 - Lite [Lower Priority]'; const aspectRatio: FlowVideoAspectRatio = input.aspectRatio === '16:9' ? '16:9' : '9:16'; const now = new Date().toISOString(); const job: AiVideoJob = { id: randomUUID(), status: 'queued', stage: 'Đã xếp hàng', progressPercent: 1, createdAt: now, updatedAt: now, brief, durationSeconds, model, aspectRatio, scenes: [] }; await save(job); const controller = new AbortController(); controllers.set(job.id, controller); void execute(job.id, { ...input, brief, durationSeconds, model, aspectRatio, flowCredentials: { nanoApiKey, veoToken, veoCookie } }, controller.signal); return job; }

export async function cancelAiVideoJob(id: string) { const job = await getAiVideoJob(id); if (!['queued', 'planning', 'generating', 'composing'].includes(job.status)) return job; controllers.get(id)?.abort(); controllers.delete(id); return patch(id, { status: 'cancelled', stage: 'Đã dừng theo yêu cầu', error: undefined, scenes: job.scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene) }); }

async function generateResumeClip(prompt: string, clipFile: string, model: FlowVideoModel, credentials: CreateAiVideoInput['flowCredentials'], referenceFrame: string | undefined, aspectRatio: FlowVideoAspectRatio) {
  try { await generateGoogleFlowVideo(prompt, clipFile, model, credentials, referenceFrame, aspectRatio); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}. AutoSub đã dừng ngay để tránh trừ thêm credit; chỉ thử lại khi bạn chủ động bấm tiếp tục.`); }
}

export async function resumeAiVideoJob(id: string, flowCredentials: CreateAiVideoInput['flowCredentials'], requestedModel?: FlowVideoModel) {
  const job = await getAiVideoJob(id); if (job.status !== 'failed') throw new Error('Chỉ có thể tiếp tục job đã thất bại.');
  const failedIndex = job.scenes.findIndex((scene) => scene.status !== 'completed'); if (failedIndex < 0) throw new Error('Job không còn cảnh lỗi để tiếp tục.');
  const resumeModel = FLOW_VIDEO_MODELS.includes(requestedModel as FlowVideoModel) ? requestedModel as FlowVideoModel : job.model;
  const input: CreateAiVideoInput = { brief: job.brief, durationSeconds: job.durationSeconds, model: resumeModel, aspectRatio: job.aspectRatio || '9:16', script: { provider: {} as AIProvider, model: '' }, flowCredentials };
  let scenes = job.scenes.map((scene, index) => index === failedIndex ? { ...scene, status: 'generating' as const } : scene);
  const resumed = await patch(id, { status: 'generating', stage: `Đang tạo lại cảnh ${failedIndex + 1}/${job.scenes.length} bằng ${resumeModel}`, model: resumeModel, error: undefined, scenes });
  void (async () => { try {
    const clipsDir = path.join(jobDir(id), 'clips'); let referenceFrame = failedIndex ? path.join(clipsDir, `${String(failedIndex).padStart(3, '0')}-continuity.jpg`) : undefined;
    for (let index = failedIndex; index < scenes.length; index += 1) { if (scenes[index].status === 'completed') continue; const seconds = Math.min(10, job.durationSeconds - index * 10); const clipFile = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`); const prompt = flowSafePrompt(`${scenes[index].visualPrompt}\nExact Vietnamese speech: "${scenes[index].narration}". Speak naturally and clearly. The shot must last ${seconds} seconds.`); await generateResumeClip(prompt, clipFile, resumeModel, input.flowCredentials, referenceFrame, input.aspectRatio || '9:16'); const nextReference = path.join(clipsDir, `${String(index + 1).padStart(3, '0')}-continuity.jpg`); await run('ffmpeg', ['-y', '-sseof', '-0.12', '-i', clipFile, '-frames:v', '1', '-q:v', '2', nextReference]); referenceFrame = nextReference; scenes = scenes.map((scene, i) => i === index ? { ...scene, status: 'completed' } : scene); await patch(id, { scenes, progressPercent: Math.round(18 + (index + 1) / scenes.length * 66) }); }
    await patch(id, { status: 'composing', stage: 'Đang ghép lại các cảnh đã lưu', progressPercent: 88, scenes }); const concat = path.join(clipsDir, 'concat.txt'); await writeFile(concat, scenes.map((_, index) => `file '${path.join(clipsDir, `${String(index + 1).padStart(3, '0')}.mp4`).replace(/\\/g, '/')}'`).join('\n')); const output = path.join(jobDir(id), 'ai-video.mp4'); await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-t', String(job.durationSeconds), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output]); const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]); await patch(id, { status: 'completed', stage: 'Đã tiếp tục và ghép xong video', progressPercent: 100, scenes, result: { videoFile: output, durationMs: Math.round(Number(probe.stdout.trim()) * 1000) } });
  } catch (error) { scenes = scenes.map((scene) => scene.status === 'generating' ? { ...scene, status: 'failed' as const } : scene); await patch(id, { status: 'failed', stage: 'Tiếp tục video thất bại', scenes, error: error instanceof Error ? error.message : String(error) }); } })(); return resumed;
}
